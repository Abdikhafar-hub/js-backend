/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";

import { ProductSubmissionType, UserRole, type Prisma } from "@prisma/client";
import type { Request } from "express";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { auditService } from "../../services/audit.service.js";
import type { AuthContext } from "../../types/auth.js";
import { slugify } from "../../utils/slugify.js";

const userSummarySelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true
} as const;

const productInclude: Prisma.ProductInclude = {
  brand: true,
  category: {
    include: {
      attributeDefinitions: true
    }
  },
  attributeValues: {
    include: {
      definition: true
    }
  },
  createdBy: {
    select: userSummarySelect
  },
  approvedBy: {
    select: userSummarySelect
  },
  originatingBranch: true,
  variants: {
    include: {
      barcodes: true,
      priceProposals: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  },
  branchProducts: {
    include: {
      branch: true,
      priceList: true,
      requestedBy: {
        select: userSummarySelect
      },
      approvedBy: {
        select: userSummarySelect
      },
      priceProposals: {
        orderBy: {
          createdAt: "desc"
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  },
  submissions: {
    include: {
      originatingBranch: true,
      submittedBy: {
        select: userSummarySelect
      },
      reviewedBy: {
        select: userSummarySelect
      },
      branchProduct: {
        include: {
          branch: true
        }
      },
      priceProposals: {
        orderBy: {
          createdAt: "desc"
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  },
  priceProposals: {
    orderBy: {
      createdAt: "desc"
    }
  }
};

const priceListInclude: Prisma.PriceListInclude = {
  items: {
    include: {
      productVariant: {
        include: {
          product: true
        }
      }
    }
  }
};

const normalizeCatalogName = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() || null;

const cleanString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const optionalString = (value: unknown) => {
  const normalized = cleanString(value);
  return normalized === "" ? null : normalized;
};

const buildCatalogAttributeInput = (
  input: Record<string, any>,
  existingProduct?: {
    genderTarget?: string | null;
    fragranceFamily?: string | null;
    concentrationType?: string | null;
  } | null
) => {
  const attributes = {
    ...(input.attributes && typeof input.attributes === "object" ? input.attributes : {})
  } as Record<string, unknown>;

  const classification = input.classification && typeof input.classification === "object"
    ? input.classification as Record<string, unknown>
    : {};

  const derivedAttributes = {
    genderTarget: optionalString(input.genderTarget ?? classification.genderTarget) ?? existingProduct?.genderTarget ?? null,
    fragranceFamily: optionalString(input.fragranceFamily ?? classification.fragranceFamily) ?? existingProduct?.fragranceFamily ?? null,
    concentrationType: optionalString(input.concentrationType ?? classification.concentrationType) ?? existingProduct?.concentrationType ?? null
  } as const;

  for (const [key, value] of Object.entries(derivedAttributes)) {
    if (attributes[key] === undefined && value !== null) {
      attributes[key] = value;
    }
  }

  return attributes;
};

const toNullableNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

const toNullableDate = (value: unknown) => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildBarcodeList = (variant: any) => {
  const values = new Set<string>();
  if (variant.barcode) values.add(String(variant.barcode));
  for (const barcode of variant.barcodes ?? []) {
    if (barcode.barcode) values.add(String(barcode.barcode));
  }

  return Array.from(values);
};

const mapDuplicateWarnings = (warnings: unknown) => (Array.isArray(warnings) ? warnings : []);

const buildVariantSignature = (variant: Record<string, unknown>) =>
  [
    optionalString(variant.name) ?? "",
    variant.volumeValue ?? "",
    optionalString(variant.volumeUnit) ?? "",
    optionalString(variant.concentrationType) ?? "",
    optionalString(variant.packagingType) ?? ""
  ].join("|");

const buildRequestMetadata = (request?: Request) => ({
  requestId: request?.requestContext.requestId,
  ipAddress: request?.ip,
  userAgent: request?.header("user-agent")
});

const canReadProductRecord = (auth: AuthContext, product: any) => {
  if (auth.role === UserRole.GENERAL_MANAGER) return true;
  if (auth.role === UserRole.BRANCH_MANAGER) {
    if (product.createdById === auth.userId) return true;
    if (product.approvalStatus === "APPROVED") return true;
    if ((product.branchProducts ?? []).some((branchProduct: any) => auth.branchIds.includes(branchProduct.branchId))) return true;
    return false;
  }

  return (
    product.approvalStatus === "APPROVED" &&
    (product.branchProducts ?? []).some((branchProduct: any) => branchProduct.isActive && auth.branchIds.includes(branchProduct.branchId))
  );
};

const canEditDraft = (auth: AuthContext, product: any) =>
  auth.role === UserRole.GENERAL_MANAGER ||
  (
    auth.role === UserRole.BRANCH_MANAGER &&
    product.createdById === auth.userId &&
    ["DRAFT", "CORRECTION_REQUIRED"].includes(product.approvalStatus)
  );

const buildProductResponse = (product: any, branchId?: string) => {
  if (!product) return null;

  const attributes: Record<string, unknown> = {};
  for (const value of product.attributeValues ?? []) {
    let parsed: unknown = value.value;
    if (value.definition.dataType === "NUMBER" || value.definition.dataType === "DECIMAL") {
      parsed = Number(value.value);
    }
    if (value.definition.dataType === "BOOLEAN") {
      parsed = value.value === "true";
    }
    attributes[value.definition.key] = parsed;
  }

  const latestSubmission = product.submissions?.[0] ?? null;
  const branchAvailability = branchId
    ? (product.branchProducts ?? []).find((entry: any) => entry.branchId === branchId) ?? null
    : null;

  return {
    ...product,
    attributes,
    sku: product.variants?.[0]?.sku ?? null,
    barcode: product.variants?.[0]?.barcode ?? null,
    duplicateWarnings: mapDuplicateWarnings(latestSubmission?.duplicateWarnings),
    latestSubmission,
    activeBranches: (product.branchProducts ?? []).filter((entry: any) => entry.isActive).map((entry: any) => entry.branch),
    branchAvailability,
    variants: (product.variants ?? []).map((variant: any) => ({
      ...variant,
      alternateBarcodes: buildBarcodeList(variant)
    }))
  };
};

const buildSubmissionResponse = (submission: any) => ({
  ...submission,
  duplicateWarnings: mapDuplicateWarnings(submission.duplicateWarnings)
});

const buildOrgScopedNotification = (
  input: Pick<Prisma.NotificationCreateManyInput, "organizationId" | "branchId" | "userId" | "role" | "type" | "title" | "message" | "metadata">
) => ({
  organizationId: input.organizationId,
  branchId: input.branchId ?? null,
  userId: input.userId ?? null,
  role: input.role ?? null,
  type: input.type,
  title: input.title,
  message: input.message,
  metadata: input.metadata ?? undefined
});

const buildBranchIds = (auth: AuthContext, requestedBranchIds: unknown): string[] => {
  if (auth.role === UserRole.GENERAL_MANAGER) {
    return Array.isArray(requestedBranchIds)
      ? Array.from(new Set(requestedBranchIds.filter((value): value is string => typeof value === "string" && value !== "")))
      : [];
  }

  const requested = Array.isArray(requestedBranchIds)
    ? Array.from(new Set(requestedBranchIds.filter((value): value is string => typeof value === "string" && value !== "")))
    : [];

  if (requested.length === 0) {
    if (auth.branchIds.length === 0) {
      throw new AppError(ERROR_CODES.BRANCH_ACCESS_DENIED, "No branch assignment found for this user", StatusCodes.FORBIDDEN);
    }

    return [auth.branchIds[0]!];
  }

  for (const branchId of requested) {
    assertBranchAccess(auth, branchId);
  }

  return requested;
};

const buildBranchConfigPayload = (input: Record<string, unknown>) => ({
  sellInBranch: input.sellInBranch === undefined ? true : Boolean(input.sellInBranch),
  reorderLevel: toNullableNumber(input.reorderLevel),
  minimumStock: toNullableNumber(input.minimumStock),
  maximumStock: toNullableNumber(input.maximumStock),
  shelfLocation: optionalString(input.shelfLocation),
  branchLabel: optionalString(input.branchLabel),
  notes: optionalString(input.notes),
  priceListId: optionalString(input.priceListId),
  introductionDate: toNullableDate(input.introductionDate)
});

const buildVariantData = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  variant: Record<string, unknown>,
  existingVariantId?: string
) => {
  const name = optionalString(variant.name);
  let sku = cleanString(variant.sku);

  if (!sku) {
    do {
      sku = `SKU-${randomUUID().slice(0, 8).toUpperCase()}`;
    } while (await tx.productVariant.findFirst({
      where: {
        organizationId: auth.organizationId,
        sku,
        ...(existingVariantId ? { id: { not: existingVariantId } } : {})
      },
      select: { id: true }
    }));
  }

  return {
    name,
    sku,
    barcode: optionalString(variant.barcode),
    volumeValue: toNullableNumber(variant.volumeValue),
    volumeUnit: optionalString(variant.volumeUnit),
    concentrationType: optionalString(variant.concentrationType),
    unitOfMeasure: optionalString(variant.unitOfMeasure) ?? optionalString(variant.volumeUnit),
    packagingType: optionalString(variant.packagingType) ?? "SEALED",
    color: optionalString(variant.color),
    batchTrackingEnabled: variant.batchTrackingEnabled === undefined ? false : Boolean(variant.batchTrackingEnabled),
    expiryTrackingEnabled: variant.expiryTrackingEnabled === undefined ? false : Boolean(variant.expiryTrackingEnabled),
    defaultCost: auth.role === UserRole.GENERAL_MANAGER ? Number(variant.defaultCost ?? 0) : 0,
    retailPrice: Number(variant.retailPrice ?? 0),
    wholesalePrice: Number(variant.wholesalePrice ?? 0),
    minimumWholesaleQuantity: Number(variant.minimumWholesaleQuantity ?? variant.wholesaleMinimumQuantity ?? 1),
    reorderLevel: Number(variant.reorderLevel ?? 0),
    reorderQuantity: toNullableNumber(variant.reorderQuantity),
    maximumStockLevel: toNullableNumber(variant.maximumStockLevel),
    status: optionalString(variant.status) ?? "ACTIVE"
  };
};

const ensureVariantPayloadIsValid = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  productId: string,
  variants: Record<string, unknown>[],
  existingVariantIds: string[] = []
) => {
  if (variants.length === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "At least one variant is required", StatusCodes.BAD_REQUEST);
  }

  const seenSignatures = new Set<string>();
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  for (const variant of variants) {
    const signature = buildVariantSignature(variant);
    if (seenSignatures.has(signature)) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Duplicate variant combinations are not allowed", StatusCodes.BAD_REQUEST);
    }
    seenSignatures.add(signature);

    const sku = cleanString(variant.sku);
    if (sku && seenSkus.has(sku.toLowerCase())) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `Duplicate SKU "${sku}" in submission`, StatusCodes.BAD_REQUEST);
    }
    if (sku) seenSkus.add(sku.toLowerCase());

    const barcode = cleanString(variant.barcode);
    if (barcode && seenBarcodes.has(barcode)) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `Duplicate barcode "${barcode}" in submission`, StatusCodes.BAD_REQUEST);
    }
    if (barcode) seenBarcodes.add(barcode);
  }

  for (const variant of variants) {
    const variantId = optionalString(variant.id);
    const sku = cleanString(variant.sku);
    const barcode = cleanString(variant.barcode);

    if (sku) {
      const existingSku = await tx.productVariant.findFirst({
        where: {
          organizationId: auth.organizationId,
          sku,
          id: variantId ? { not: variantId } : undefined
        },
        select: { id: true, productId: true }
      });
      if (existingSku && existingSku.productId !== productId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, `SKU "${sku}" already exists`, StatusCodes.BAD_REQUEST);
      }
    }

    if (barcode) {
      const existingBarcode = await tx.productVariant.findFirst({
        where: {
          organizationId: auth.organizationId,
          barcode,
          id: variantId ? { not: variantId } : undefined
        },
        select: { id: true, productId: true }
      });
      if (existingBarcode && existingBarcode.productId !== productId) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, `Barcode "${barcode}" already exists`, StatusCodes.BAD_REQUEST);
      }
    }
  }

  for (const existingId of existingVariantIds) {
    const stillPresent = variants.some((variant) => optionalString(variant.id) === existingId);
    if (!stillPresent) continue;
  }
};

const buildSubmittedSnapshot = (input: Record<string, unknown>) => ({
  basicInformation: input.basicInformation ?? {},
  classification: input.classification ?? {},
  variants: Array.isArray(input.variants) ? input.variants : [],
  branchConfiguration: input.branchConfiguration ?? {},
  pricingRequest: input.pricingRequest ?? {},
  inventoryIntroduction: input.inventoryIntroduction ?? {}
});

const detectDuplicateWarnings = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  product: { id: string; name: string; brandId?: string | null; variants: Array<{ sku?: string | null; barcode?: string | null; volumeValue?: unknown; volumeUnit?: string | null }> }
) => {
  const warnings: Array<Record<string, unknown>> = [];
  const normalizedName = normalizeCatalogName(product.name);
  if (!normalizedName) return warnings;

  const exactNameMatches = await tx.product.findMany({
    where: {
      organizationId: auth.organizationId,
      id: { not: product.id },
      normalizedName,
      ...(product.brandId ? { brandId: product.brandId } : {})
    },
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } }
    },
    take: 5
  });

  for (const match of exactNameMatches) {
    warnings.push({
      type: "NAME_MATCH",
      productId: match.id,
      productName: match.name,
      brandName: match.brand?.name ?? null,
      message: "Normalized product name matches an existing catalog item."
    });
  }

  const fuzzyMatches = await tx.product.findMany({
    where: {
      organizationId: auth.organizationId,
      id: { not: product.id },
      OR: [
        { name: { contains: product.name, mode: "insensitive" } },
        { normalizedName: { contains: normalizedName, mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } }
    },
    take: 5
  });

  for (const match of fuzzyMatches) {
    if (warnings.some((warning) => warning.productId === match.id)) continue;
    warnings.push({
      type: "SIMILAR_NAME",
      productId: match.id,
      productName: match.name,
      brandName: match.brand?.name ?? null,
      message: "Similar spelling detected in the organization catalog."
    });
  }

  for (const variant of product.variants) {
    if (variant.sku) {
      const existingSku = await tx.productVariant.findFirst({
        where: {
          organizationId: auth.organizationId,
          sku: String(variant.sku),
          productId: { not: product.id }
        },
        select: {
          id: true,
          product: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
      if (existingSku) {
        warnings.push({
          type: "SKU_MATCH",
          variantId: existingSku.id,
          productId: existingSku.product.id,
          productName: existingSku.product.name,
          message: `SKU ${variant.sku} is already used by another product.`
        });
      }
    }

    if (variant.barcode) {
      const existingBarcode = await tx.productVariant.findFirst({
        where: {
          organizationId: auth.organizationId,
          barcode: String(variant.barcode),
          productId: { not: product.id }
        },
        select: {
          id: true,
          product: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
      if (existingBarcode) {
        warnings.push({
          type: "BARCODE_MATCH",
          variantId: existingBarcode.id,
          productId: existingBarcode.product.id,
          productName: existingBarcode.product.name,
          message: `Barcode ${variant.barcode} is already used by another product.`
        });
      }
    }
  }

  return warnings;
};

const createPriceProposals = async (
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  input: {
    productId: string;
    submissionId?: string | null;
    branchProductId?: string | null;
    branchId: string;
    pricingRequest?: Record<string, unknown>;
  }
) => {
  const pricingRequest = input.pricingRequest ?? {};
  const proposedRetailPrice = toNullableNumber(pricingRequest.proposedRetailPrice ?? pricingRequest.preferredRetailPriceRequest);
  const proposedWholesalePrice = toNullableNumber(pricingRequest.proposedWholesalePrice ?? pricingRequest.preferredWholesalePriceRequest);
  const justification = optionalString(pricingRequest.justification ?? pricingRequest.priceJustification);
  const priceListId = optionalString(pricingRequest.priceListId ?? pricingRequest.existingPriceListId);

  if (proposedRetailPrice === null && proposedWholesalePrice === null && !justification && !priceListId) {
    return [];
  }

  return tx.productPriceProposal.createManyAndReturn({
    data: [{
      organizationId: auth.organizationId,
      productId: input.productId,
      branchId: input.branchId,
      branchProductId: input.branchProductId ?? null,
      submissionId: input.submissionId ?? null,
      priceListId,
      proposedRetailPrice,
      proposedWholesalePrice,
      justification,
      proposedById: auth.userId
    }]
  });
};

const createNotifications = async (tx: Prisma.TransactionClient, notifications: Prisma.NotificationCreateManyInput[]) => {
  if (notifications.length === 0) return;
  await tx.notification.createMany({
    data: notifications
  });
};

const getProductOrThrow = async (auth: AuthContext, id: string) => {
  const product = await prisma.product.findFirstOrThrow({
    where: {
      id,
      organizationId: auth.organizationId
    },
    include: productInclude
  });

  if (!canReadProductRecord(auth, product)) {
    throw new AppError(ERROR_CODES.ACCESS_DENIED, "You do not have access to this product", StatusCodes.FORBIDDEN);
  }

  return product;
};

export const catalogService = {
  listBrands(auth: AuthContext) {
    return prisma.brand.findMany({
      where: {
        organizationId: auth.organizationId
      },
      orderBy: {
        name: "asc"
      }
    });
  },

  async createBrand(auth: AuthContext, input: Record<string, unknown>, request?: Request) {
    const name = cleanString(input.name);
    if (!name) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Brand name is required", StatusCodes.BAD_REQUEST);
    }

    const normalizedName = normalizeCatalogName(name);
    const existing = await prisma.brand.findFirst({
      where: {
        organizationId: auth.organizationId,
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          normalizedName ? { normalizedName } : {}
        ]
      }
    });

    if (existing) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Brand with this name already exists", StatusCodes.BAD_REQUEST);
    }

    const brand = await prisma.brand.create({
      data: {
        organizationId: auth.organizationId,
        name,
        description: optionalString(input.description),
        logoUrl: optionalString(input.logoUrl),
        countryOfOrigin: optionalString(input.countryOfOrigin),
        normalizedName
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "catalog.brand.create",
      entityType: "Brand",
      entityId: brand.id,
      afterData: brand,
      ...buildRequestMetadata(request)
    });

    return brand;
  },

  async updateBrand(auth: AuthContext, id: string, input: Record<string, unknown>, request?: Request) {
    const existing = await prisma.brand.findFirstOrThrow({
      where: {
        id,
        organizationId: auth.organizationId
      }
    });

    const name = input.name === undefined ? existing.name : cleanString(input.name);
    const normalizedName = normalizeCatalogName(name);

    if (normalizedName) {
      const duplicate = await prisma.brand.findFirst({
        where: {
          organizationId: auth.organizationId,
          id: { not: id },
          OR: [
            { name: { equals: name, mode: "insensitive" } },
            { normalizedName }
          ]
        }
      });
      if (duplicate) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "Brand with this name already exists", StatusCodes.BAD_REQUEST);
      }
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        name,
        description: input.description === undefined ? existing.description : optionalString(input.description),
        logoUrl: input.logoUrl === undefined ? existing.logoUrl : optionalString(input.logoUrl),
        countryOfOrigin: input.countryOfOrigin === undefined ? existing.countryOfOrigin : optionalString(input.countryOfOrigin),
        status: input.status === undefined ? existing.status : String(input.status) as never,
        normalizedName
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "catalog.brand.update",
      entityType: "Brand",
      entityId: brand.id,
      beforeData: existing,
      afterData: brand,
      ...buildRequestMetadata(request)
    });

    return brand;
  },

  listCategories(auth: AuthContext) {
    return prisma.productCategory.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null
      },
      include: {
        parent: true,
        children: true,
        attributeDefinitions: {
          orderBy: {
            displayOrder: "asc"
          }
        }
      },
      orderBy: [
        { sortOrder: "asc" },
        { name: "asc" }
      ]
    });
  },

  async createCategory(
    auth: AuthContext,
    input: {
      name: string;
      description?: string | null;
      parentId?: string | null;
      sortOrder?: number;
      status?: "ACTIVE" | "INACTIVE";
      attributeDefinitions?: Array<{
        label: string;
        key: string;
        dataType: string;
        isRequired?: boolean;
        dropdownOptions?: string | null;
        displayOrder?: number;
        isActive?: boolean;
      }>;
    },
    request?: Request
  ) {
    const name = cleanString(input.name);
    const slug = slugify(name);
    const normalizedName = normalizeCatalogName(name);

    const existing = await prisma.productCategory.findFirst({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { slug },
          normalizedName ? { normalizedName } : {}
        ]
      }
    });

    if (existing) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Category with this name already exists", StatusCodes.BAD_REQUEST);
    }

    const category = await prisma.productCategory.create({
      data: {
        organizationId: auth.organizationId,
        parentId: input.parentId ?? null,
        name,
        slug,
        normalizedName,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? "ACTIVE",
        createdById: auth.userId,
        updatedById: auth.userId,
        attributeDefinitions: {
          create: input.attributeDefinitions?.map((attribute) => ({
            organizationId: auth.organizationId,
            label: attribute.label,
            key: attribute.key,
            dataType: attribute.dataType,
            isRequired: attribute.isRequired ?? false,
            dropdownOptions: attribute.dropdownOptions ?? null,
            displayOrder: attribute.displayOrder ?? 0,
            isActive: attribute.isActive ?? true
          })) ?? []
        }
      },
      include: {
        attributeDefinitions: true
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "catalog.category.create",
      entityType: "ProductCategory",
      entityId: category.id,
      afterData: category,
      ...buildRequestMetadata(request)
    });

    return category;
  },

  async updateCategory(
    auth: AuthContext,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      parentId?: string | null;
      sortOrder?: number;
      status?: "ACTIVE" | "INACTIVE";
      attributeDefinitions?: Array<{
        id?: string;
        label: string;
        key: string;
        dataType: string;
        isRequired?: boolean;
        dropdownOptions?: string | null;
        displayOrder?: number;
        isActive?: boolean;
      }>;
    },
    request?: Request
  ) {
    const category = await prisma.productCategory.findFirstOrThrow({
      where: {
        id,
        organizationId: auth.organizationId,
        deletedAt: null
      }
    });

    const name = input.name === undefined ? category.name : cleanString(input.name);
    const slug = slugify(name);
    const normalizedName = normalizeCatalogName(name);

    const duplicate = await prisma.productCategory.findFirst({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        id: { not: id },
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { slug },
          normalizedName ? { normalizedName } : {}
        ]
      }
    });

    if (duplicate) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Category with this name already exists", StatusCodes.BAD_REQUEST);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (input.attributeDefinitions !== undefined) {
        const existingAttributes = await tx.productAttributeDefinition.findMany({
          where: {
            organizationId: auth.organizationId,
            categoryId: id
          }
        });

        const incomingIds = new Set(
          input.attributeDefinitions
            .map((attribute) => attribute.id)
            .filter((attributeId): attributeId is string => Boolean(attributeId))
        );

        const removedIds = existingAttributes.filter((attribute) => !incomingIds.has(attribute.id)).map((attribute) => attribute.id);
        if (removedIds.length > 0) {
          await tx.productAttributeDefinition.updateMany({
            where: {
              id: {
                in: removedIds
              }
            },
            data: {
              isActive: false
            }
          });
        }

        for (const attribute of input.attributeDefinitions) {
          if (attribute.id) {
            await tx.productAttributeDefinition.update({
              where: {
                id: attribute.id
              },
              data: {
                label: attribute.label,
                key: attribute.key,
                dataType: attribute.dataType,
                isRequired: attribute.isRequired ?? false,
                dropdownOptions: attribute.dropdownOptions ?? null,
                displayOrder: attribute.displayOrder ?? 0,
                isActive: attribute.isActive ?? true
              }
            });
          } else {
            await tx.productAttributeDefinition.create({
              data: {
                organizationId: auth.organizationId,
                categoryId: id,
                label: attribute.label,
                key: attribute.key,
                dataType: attribute.dataType,
                isRequired: attribute.isRequired ?? false,
                dropdownOptions: attribute.dropdownOptions ?? null,
                displayOrder: attribute.displayOrder ?? 0,
                isActive: attribute.isActive ?? true
              }
            });
          }
        }
      }

      return tx.productCategory.update({
        where: { id },
        data: {
          parentId: input.parentId === undefined ? category.parentId : input.parentId ?? null,
          name,
          slug,
          normalizedName,
          description: input.description === undefined ? category.description : input.description ?? null,
          sortOrder: input.sortOrder ?? category.sortOrder,
          status: input.status ?? category.status,
          updatedById: auth.userId
        },
        include: {
          attributeDefinitions: {
            orderBy: {
              displayOrder: "asc"
            }
          }
        }
      });
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "catalog.category.update",
      entityType: "ProductCategory",
      entityId: id,
      beforeData: category,
      afterData: updated,
      ...buildRequestMetadata(request)
    });

    return updated;
  },

  async deleteCategory(auth: AuthContext, id: string, request?: Request) {
    const category = await prisma.productCategory.findFirstOrThrow({
      where: {
        id,
        organizationId: auth.organizationId,
        deletedAt: null
      }
    });

    const productCount = await prisma.product.count({
      where: {
        organizationId: auth.organizationId,
        categoryId: id
      }
    });

    if (productCount > 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Cannot delete a category already linked to products.", StatusCodes.BAD_REQUEST);
    }

    const deleted = await prisma.productCategory.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "INACTIVE"
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "catalog.category.delete",
      entityType: "ProductCategory",
      entityId: id,
      beforeData: category,
      afterData: deleted,
      ...buildRequestMetadata(request)
    });

    return deleted;
  },

  async validateAndProcessAttributes(auth: AuthContext, categoryId: string | undefined | null, attributesInput: Record<string, any> | undefined) {
    if (!categoryId) return [];

    const category = await prisma.productCategory.findFirst({
      where: {
        id: categoryId,
        organizationId: auth.organizationId,
        deletedAt: null
      },
      include: {
        attributeDefinitions: true
      }
    });

    if (!category) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found", StatusCodes.NOT_FOUND);
    }

    if (category.status === "INACTIVE") {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Cannot assign an inactive category to a product.", StatusCodes.BAD_REQUEST);
    }

    const definitions = category.attributeDefinitions.filter((definition) => definition.isActive);
    const processedValues: Array<{ definitionId: string; value: string }> = [];
    const attributes = attributesInput || {};

    for (const definition of definitions) {
      const value = attributes[definition.key];

      if (definition.isRequired && (value === undefined || value === null || value === "")) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, `Required attribute "${definition.label}" is missing.`, StatusCodes.BAD_REQUEST);
      }

      if (value !== undefined && value !== null && value !== "") {
        let serializedValue = String(value);

        if (definition.dataType === "NUMBER" || definition.dataType === "DECIMAL") {
          const numeric = Number(value);
          if (Number.isNaN(numeric)) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Attribute "${definition.label}" must be numeric.`, StatusCodes.BAD_REQUEST);
          }
          serializedValue = String(numeric);
        } else if (definition.dataType === "BOOLEAN") {
          if (![true, false, "true", "false"].includes(value)) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Attribute "${definition.label}" must be boolean.`, StatusCodes.BAD_REQUEST);
          }
          serializedValue = String(value === true || value === "true");
        } else if (definition.dataType === "DROPDOWN" && definition.dropdownOptions) {
          const options = definition.dropdownOptions.split(",").map((option) => option.trim().toLowerCase());
          if (!options.includes(String(value).trim().toLowerCase())) {
            throw new AppError(ERROR_CODES.BAD_REQUEST, `Attribute "${definition.label}" value "${value}" is not a valid option.`, StatusCodes.BAD_REQUEST);
          }
        }

        processedValues.push({
          definitionId: definition.id,
          value: serializedValue
        });
      }
    }

    return processedValues;
  },

  async listProducts(auth: AuthContext, query: Record<string, string | undefined>) {
    const branchScopeId = typeof query.branchId === "string" ? query.branchId : undefined;
    if (branchScopeId) {
      assertBranchAccess(auth, branchScopeId);
    }

    const effectiveBranchId =
      auth.role === UserRole.SALES_ATTENDANT && !branchScopeId ? auth.branchIds[0] : branchScopeId;

    const filters: Prisma.ProductWhereInput[] = [{
      organizationId: auth.organizationId
    }];

    const search = cleanString(query.search);
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { internalDisplayName: { contains: search, mode: "insensitive" } },
          { brand: { name: { contains: search, mode: "insensitive" } } },
          {
            variants: {
              some: {
                OR: [
                  { sku: { contains: search, mode: "insensitive" } },
                  { barcode: search },
                  { barcodes: { some: { barcode: search } } }
                ]
              }
            }
          }
        ]
      });
    }

    if (query.brandId) filters.push({ brandId: query.brandId });
    if (query.categoryId) filters.push({ categoryId: query.categoryId });
    if (query.productType) filters.push({ productType: query.productType as never });
    if (query.originatingBranchId) filters.push({ originatingBranchId: query.originatingBranchId });
    if (query.approvalStatus) filters.push({ approvalStatus: query.approvalStatus as never });
    if (query.active === "true") filters.push({ isActive: true });
    if (query.active === "false") filters.push({ isActive: false });

    if (auth.role === UserRole.BRANCH_MANAGER) {
      filters.push({
        OR: [
          { approvalStatus: "APPROVED" },
          { createdById: auth.userId },
          { branchProducts: { some: { branchId: { in: auth.branchIds } } } }
        ]
      });
    }

    if (auth.role === UserRole.SALES_ATTENDANT) {
      filters.push({
        approvalStatus: "APPROVED",
        branchProducts: {
          some: {
            branchId: {
              in: auth.branchIds
            },
            isActive: true
          }
        }
      });
    }

    if (effectiveBranchId) {
      if (auth.role === UserRole.SALES_ATTENDANT) {
        filters.push({
          branchProducts: {
            some: {
              branchId: effectiveBranchId,
              isActive: true
            }
          }
        });
      } else {
        filters.push({
          OR: [
            { branchProducts: { some: { branchId: effectiveBranchId } } },
            { originatingBranchId: effectiveBranchId }
          ]
        });
      }
    }

    if (query.createdByBranchManager === "true") {
      filters.push({
        createdBy: {
          role: UserRole.BRANCH_MANAGER
        }
      });
    }

    if (query.missingBarcode === "true") {
      filters.push({
        variants: {
          some: {
            barcode: null,
            barcodes: {
              none: {}
            }
          }
        }
      });
    }

    const products = await prisma.product.findMany({
      where: {
        AND: filters
      },
      include: productInclude,
      orderBy: {
        createdAt: "desc"
      }
    });

    let mapped = products.map((product) => buildProductResponse(product, effectiveBranchId));

    if (query.duplicateSuspected === "true") {
      mapped = mapped.filter((product) => (product?.duplicateWarnings?.length ?? 0) > 0);
    }

    return mapped;
  },

  async createProduct(auth: AuthContext, input: Record<string, any>, request?: Request) {
    if (auth.role === UserRole.SALES_ATTENDANT) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You do not have permission to create products", StatusCodes.FORBIDDEN);
    }

    const productName = cleanString(input.name || input.productName || input.basicInformation?.name);
    if (!productName) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Product name is required", StatusCodes.BAD_REQUEST);
    }

    const branchConfiguration = (input.branchConfiguration ?? {}) as Record<string, unknown>;
    const requestedBranchIds = buildBranchIds(auth, branchConfiguration.branchIds ?? input.branchIds);
    const originatingBranchId = requestedBranchIds[0] ?? null;

    const requestedBrandName = optionalString(input.requestedBrandName ?? input.basicInformation?.requestedBrandName);
    const requestedCategoryName = optionalString(input.requestedCategoryName ?? input.classification?.requestedCategoryName);
    let brandId = optionalString(input.brandId ?? input.basicInformation?.brandId);
    let categoryId = optionalString(input.categoryId ?? input.classification?.categoryId);

    await prisma.$transaction(async (tx) => {
      if (brandId) {
        const brand = await tx.brand.findFirst({
          where: {
            id: brandId,
            organizationId: auth.organizationId
          }
        });
        if (!brand) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Brand not found", StatusCodes.NOT_FOUND);
        }
      }

      if (categoryId) {
        const category = await tx.productCategory.findFirst({
          where: {
            id: categoryId,
            organizationId: auth.organizationId,
            deletedAt: null
          }
        });
        if (!category) {
          throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found", StatusCodes.NOT_FOUND);
        }
      }

      if (auth.role === UserRole.GENERAL_MANAGER && !brandId && requestedBrandName) {
        const normalizedName = normalizeCatalogName(requestedBrandName);
        const existingBrand = await tx.brand.findFirst({
          where: {
            organizationId: auth.organizationId,
            OR: [
              { name: { equals: requestedBrandName, mode: "insensitive" } },
              normalizedName ? { normalizedName } : {}
            ]
          }
        });
        brandId = existingBrand?.id ?? (await tx.brand.create({
          data: {
            organizationId: auth.organizationId,
            name: requestedBrandName,
            normalizedName,
            status: "ACTIVE"
          }
        })).id;
      }

      if (auth.role === UserRole.GENERAL_MANAGER && !categoryId && requestedCategoryName) {
        const normalizedName = normalizeCatalogName(requestedCategoryName);
        const slug = slugify(requestedCategoryName);
        const existingCategory = await tx.productCategory.findFirst({
          where: {
            organizationId: auth.organizationId,
            deletedAt: null,
            OR: [
              { name: { equals: requestedCategoryName, mode: "insensitive" } },
              { slug },
              normalizedName ? { normalizedName } : {}
            ]
          }
        });

        categoryId = existingCategory?.id ?? (await tx.productCategory.create({
          data: {
            organizationId: auth.organizationId,
            name: requestedCategoryName,
            slug,
            normalizedName,
            status: "ACTIVE",
            createdById: auth.userId,
            updatedById: auth.userId
          }
        })).id;
      }

      const slugBase = slugify(productName) || `product-${randomUUID().slice(0, 6).toLowerCase()}`;
      let slug = slugBase;
      let suffix = 2;
      while (await tx.product.findFirst({
        where: {
          organizationId: auth.organizationId,
          slug
        },
        select: { id: true }
      })) {
        slug = `${slugBase}-${suffix}`;
        suffix += 1;
      }

      const productType = optionalString(input.productType ?? input.basicInformation?.productType);
      const attributes = await this.validateAndProcessAttributes(auth, categoryId, buildCatalogAttributeInput(input));
      const variants = (Array.isArray(input.variants) ? input.variants : []).map((variant) => variant as Record<string, unknown>);

      const product = await tx.product.create({
        data: {
          organizationId: auth.organizationId,
          brandId,
          categoryId,
          name: productName,
          slug,
          normalizedName: normalizeCatalogName(productName),
          internalDisplayName: optionalString(input.internalDisplayName ?? input.basicInformation?.internalDisplayName),
          shortDescription: optionalString(input.shortDescription ?? input.basicInformation?.shortDescription),
          fullDescription: optionalString(input.fullDescription ?? input.basicInformation?.fullDescription),
          description: optionalString(input.description ?? input.fullDescription ?? input.basicInformation?.fullDescription),
          productType: productType as never,
          fragranceFamily: optionalString(input.fragranceFamily ?? input.classification?.fragranceFamily) as never,
          genderTarget: (optionalString(input.genderTarget ?? input.classification?.genderTarget) ?? "NOT_APPLICABLE") as never,
          concentrationType: optionalString(input.concentrationType ?? input.classification?.concentrationType) as never,
          countryOfOrigin: optionalString(input.countryOfOrigin ?? input.classification?.countryOfOrigin),
          manufacturer: optionalString(input.manufacturer ?? input.classification?.manufacturer),
          imageUrl: optionalString(input.imageUrl),
          isStockTracked: input.isStockTracked === undefined ? true : Boolean(input.isStockTracked),
          trackingMethod: optionalString(input.trackingMethod ?? input.basicInformation?.trackingMethod),
          batchTrackingDefault: input.batchTrackingEnabled === undefined ? false : Boolean(input.batchTrackingEnabled),
          expiryTrackingDefault: input.expiryTrackingEnabled === undefined ? false : Boolean(input.expiryTrackingEnabled),
          notes: optionalString(input.notes ?? input.basicInformation?.notes),
          approvalStatus: auth.role === UserRole.GENERAL_MANAGER ? "APPROVED" : "DRAFT",
          originatingBranchId,
          createdById: auth.userId,
          approvedById: auth.role === UserRole.GENERAL_MANAGER ? auth.userId : null,
          approvedAt: auth.role === UserRole.GENERAL_MANAGER ? new Date() : null
        }
      });

      if (attributes.length > 0) {
        await tx.productAttributeValue.createMany({
          data: attributes.map((attribute) => ({
            productId: product.id,
            definitionId: attribute.definitionId,
            value: attribute.value
          }))
        });
      }

      await ensureVariantPayloadIsValid(tx, auth, product.id, variants);
      const createdVariants: any[] = [];
      for (const variant of variants) {
        const variantData = await buildVariantData(tx, auth, variant);
        createdVariants.push(await tx.productVariant.create({
          data: {
            organizationId: auth.organizationId,
            productId: product.id,
            ...variantData
          } as Prisma.ProductVariantUncheckedCreateInput
        }));
      }

      const createdBranchProducts: any[] = [];
      for (const branchId of requestedBranchIds) {
        const config = buildBranchConfigPayload(branchConfiguration);
        createdBranchProducts.push(await tx.branchProduct.create({
          data: {
            organizationId: auth.organizationId,
            branchId,
            productId: product.id,
            priceListId: config.priceListId,
            status: auth.role === UserRole.GENERAL_MANAGER ? "ACTIVE" : "INACTIVE",
            isActive: auth.role === UserRole.GENERAL_MANAGER,
            sellInBranch: config.sellInBranch,
            reorderLevel: config.reorderLevel,
            minimumStock: config.minimumStock,
            maximumStock: config.maximumStock,
            shelfLocation: config.shelfLocation,
            branchLabel: config.branchLabel,
            notes: config.notes,
            introductionDate: config.introductionDate,
            requestedById: auth.userId,
            requestedAt: auth.role === UserRole.GENERAL_MANAGER ? new Date() : null,
            approvedById: auth.role === UserRole.GENERAL_MANAGER ? auth.userId : null,
            approvedAt: auth.role === UserRole.GENERAL_MANAGER ? new Date() : null
          }
        }));
      }

      let submission: any = null;
      if (auth.role === UserRole.BRANCH_MANAGER) {
        submission = await tx.productSubmission.create({
          data: {
            organizationId: auth.organizationId,
            productId: product.id,
            originatingBranchId: originatingBranchId ?? auth.branchIds[0]!,
            submittedById: auth.userId,
            type: ProductSubmissionType.NEW_PRODUCT,
            status: "DRAFT",
            requestedBrandName,
            requestedCategoryName,
            submittedSnapshot: buildSubmittedSnapshot(input)
          }
        });

        if (createdBranchProducts[0]) {
          await createPriceProposals(tx, auth, {
            productId: product.id,
            submissionId: submission.id,
            branchProductId: createdBranchProducts[0].id,
            branchId: createdBranchProducts[0].branchId,
            pricingRequest: input.pricingRequest
          });
        }
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: originatingBranchId,
        userId: auth.userId,
        action: auth.role === UserRole.GENERAL_MANAGER ? "catalog.product.create" : "catalog.product.draft.create",
        entityType: "Product",
        entityId: product.id,
        afterData: {
          product,
          variants: createdVariants,
          branchProducts: createdBranchProducts,
          submission
        },
        ...buildRequestMetadata(request)
      }, tx);
    });

    return this.getProduct(auth, (
      await prisma.product.findFirstOrThrow({
        where: {
          organizationId: auth.organizationId,
          name: productName
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          id: true
        }
      })
    ).id);
  },

  async getProduct(auth: AuthContext, id: string) {
    return buildProductResponse(await getProductOrThrow(auth, id));
  },

  async updateProduct(auth: AuthContext, id: string, input: Record<string, any>, request?: Request) {
    const product = await getProductOrThrow(auth, id);

    if (!canEditDraft(auth, product) && auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot edit this product", StatusCodes.FORBIDDEN);
    }

    const requestedBrandName = optionalString(input.requestedBrandName);
    const requestedCategoryName = optionalString(input.requestedCategoryName);
    const branchConfiguration = (input.branchConfiguration ?? {}) as Record<string, unknown>;

    const updatedProduct = await prisma.$transaction(async (tx) => {
      const brandId = input.brandId === undefined ? product.brandId : optionalString(input.brandId);
      const categoryId = input.categoryId === undefined ? product.categoryId : optionalString(input.categoryId);
      const name = input.name === undefined ? product.name : cleanString(input.name);

      let slug = product.slug;
      if (name !== product.name) {
        const slugBase = slugify(name) || `product-${randomUUID().slice(0, 6).toLowerCase()}`;
        slug = slugBase;
        let suffix = 2;
        while (await tx.product.findFirst({
          where: {
            organizationId: auth.organizationId,
            id: { not: id },
            slug
          },
          select: { id: true }
        })) {
          slug = `${slugBase}-${suffix}`;
          suffix += 1;
        }
      }

      const attributes = await this.validateAndProcessAttributes(
        auth,
        categoryId,
        buildCatalogAttributeInput(input, {
          genderTarget: product.genderTarget,
          fragranceFamily: product.fragranceFamily,
          concentrationType: product.concentrationType
        })
      );
      await tx.product.update({
        where: { id },
        data: {
          brandId,
          categoryId,
          name,
          slug,
          normalizedName: normalizeCatalogName(name),
          internalDisplayName: input.internalDisplayName === undefined ? product.internalDisplayName : optionalString(input.internalDisplayName),
          shortDescription: input.shortDescription === undefined ? product.shortDescription : optionalString(input.shortDescription),
          fullDescription: input.fullDescription === undefined ? product.fullDescription : optionalString(input.fullDescription),
          description: input.description === undefined ? product.description : optionalString(input.description),
          productType: input.productType === undefined ? product.productType : optionalString(input.productType) as never,
          fragranceFamily: input.fragranceFamily === undefined ? product.fragranceFamily : optionalString(input.fragranceFamily) as never,
          genderTarget: input.genderTarget === undefined ? product.genderTarget : (optionalString(input.genderTarget) ?? "NOT_APPLICABLE") as never,
          concentrationType: input.concentrationType === undefined ? product.concentrationType : optionalString(input.concentrationType) as never,
          countryOfOrigin: input.countryOfOrigin === undefined ? product.countryOfOrigin : optionalString(input.countryOfOrigin),
          manufacturer: input.manufacturer === undefined ? product.manufacturer : optionalString(input.manufacturer),
          isStockTracked: input.isStockTracked === undefined ? product.isStockTracked : Boolean(input.isStockTracked),
          trackingMethod: input.trackingMethod === undefined ? product.trackingMethod : optionalString(input.trackingMethod),
          batchTrackingDefault: input.batchTrackingEnabled === undefined ? product.batchTrackingDefault : Boolean(input.batchTrackingEnabled),
          expiryTrackingDefault: input.expiryTrackingEnabled === undefined ? product.expiryTrackingDefault : Boolean(input.expiryTrackingEnabled),
          notes: input.notes === undefined ? product.notes : optionalString(input.notes),
          approvalStatus: auth.role === UserRole.GENERAL_MANAGER ? (input.approvalStatus ?? product.approvalStatus) : product.approvalStatus
        }
      });

      if (
        input.attributes !== undefined ||
        input.categoryId !== undefined ||
        input.genderTarget !== undefined ||
        input.fragranceFamily !== undefined ||
        input.concentrationType !== undefined ||
        input.classification !== undefined
      ) {
        await tx.productAttributeValue.deleteMany({
          where: { productId: id }
        });

        if (attributes.length > 0) {
          await tx.productAttributeValue.createMany({
            data: attributes.map((attribute) => ({
              productId: id,
              definitionId: attribute.definitionId,
              value: attribute.value
            }))
          });
        }
      }

      if (Array.isArray(input.variants)) {
        const variants = input.variants.map((variant: any) => variant as Record<string, unknown>);
        await ensureVariantPayloadIsValid(tx, auth, id, variants, product.variants.map((variant: any) => variant.id));
        const existingVariantIds = new Set(product.variants.map((variant: any) => variant.id));
        const retainedIds = new Set<string>();

        for (const variant of variants) {
          const variantId = optionalString(variant.id);
          const variantData = await buildVariantData(tx, auth, variant, variantId ?? undefined);
          if (variantId && existingVariantIds.has(variantId)) {
            retainedIds.add(variantId);
            await tx.productVariant.update({
              where: { id: variantId },
              data: variantData as object
            });
          } else {
            const createData = {
              organizationId: auth.organizationId,
              productId: id,
              ...variantData
            } as Prisma.ProductVariantUncheckedCreateInput;
            const createdVariant = await tx.productVariant.create({
              data: createData
            });
            retainedIds.add(createdVariant.id);
          }
        }

        const removableIds = product.variants
          .filter((variant: any) => !retainedIds.has(variant.id))
          .map((variant: any) => variant.id);

        if (removableIds.length > 0) {
          await tx.productVariant.deleteMany({
            where: {
              id: {
                in: removableIds
              },
              productId: id
            }
          });
        }
      }

      if (Object.keys(branchConfiguration).length > 0) {
        const targetBranchIds = buildBranchIds(auth, branchConfiguration.branchIds ?? product.branchProducts.map((entry: any) => entry.branchId));
        const config = buildBranchConfigPayload(branchConfiguration);

        for (const branchId of targetBranchIds) {
          const existingBranchProduct = product.branchProducts.find((entry: any) => entry.branchId === branchId);
          if (existingBranchProduct) {
            await tx.branchProduct.update({
              where: {
                id: existingBranchProduct.id
              },
              data: {
                priceListId: config.priceListId,
                sellInBranch: config.sellInBranch,
                reorderLevel: config.reorderLevel,
                minimumStock: config.minimumStock,
                maximumStock: config.maximumStock,
                shelfLocation: config.shelfLocation,
                branchLabel: config.branchLabel,
                notes: config.notes,
                introductionDate: config.introductionDate
              }
            });
          }
        }
      }

      if (auth.role === UserRole.BRANCH_MANAGER) {
        const draftSubmission = product.submissions.find((submission: any) => submission.type === "NEW_PRODUCT") ?? null;
        if (draftSubmission) {
          await tx.productSubmission.update({
            where: {
              id: draftSubmission.id
            },
            data: {
              requestedBrandName,
              requestedCategoryName,
              submittedSnapshot: buildSubmittedSnapshot(input)
            }
          });
        }
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: productInclude
      });
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: updatedProduct.originatingBranchId,
      userId: auth.userId,
      action: canEditDraft(auth, product) && auth.role !== UserRole.GENERAL_MANAGER
        ? "catalog.product.draft.update"
        : "catalog.product.update",
      entityType: "Product",
      entityId: id,
      beforeData: product,
      afterData: updatedProduct,
      ...buildRequestMetadata(request)
    });

    return buildProductResponse(updatedProduct);
  },

  async createVariant(auth: AuthContext, productId: string, input: Record<string, unknown>, request?: Request) {
    const product = await getProductOrThrow(auth, productId);
    if (!canEditDraft(auth, product) && auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot add variants to this product", StatusCodes.FORBIDDEN);
    }

    const created = await prisma.$transaction(async (tx) => {
      await ensureVariantPayloadIsValid(tx, auth, productId, [input]);
      const variantData = await buildVariantData(tx, auth, input);
      const variant = await tx.productVariant.create({
        data: {
          organizationId: auth.organizationId,
          productId,
          ...variantData
        } as Prisma.ProductVariantUncheckedCreateInput
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: product.originatingBranchId,
        userId: auth.userId,
        action: canEditDraft(auth, product) && auth.role !== UserRole.GENERAL_MANAGER
          ? "catalog.variant.draft.create"
          : "catalog.variant.create",
        entityType: "ProductVariant",
        entityId: variant.id,
        afterData: variant,
        ...buildRequestMetadata(request)
      }, tx);

      return variant;
    });

    return created;
  },

  async updateVariant(auth: AuthContext, variantId: string, input: Record<string, unknown>, request?: Request) {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: {
        id: variantId,
        organizationId: auth.organizationId
      },
      include: {
        product: {
          include: {
            branchProducts: true,
            submissions: true
          }
        }
      }
    });

    if (!canEditDraft(auth, variant.product) && auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You cannot update this variant", StatusCodes.FORBIDDEN);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await ensureVariantPayloadIsValid(tx, auth, variant.productId, [{ ...input, id: variantId }], [variantId]);
      const next = await tx.productVariant.update({
        where: { id: variantId },
        data: await buildVariantData(tx, auth, { ...variant, ...input }, variantId) as object
      });

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: variant.product.originatingBranchId,
        userId: auth.userId,
        action: canEditDraft(auth, variant.product) && auth.role !== UserRole.GENERAL_MANAGER
          ? "catalog.variant.draft.update"
          : "catalog.variant.update",
        entityType: "ProductVariant",
        entityId: variantId,
        beforeData: variant,
        afterData: next,
        ...buildRequestMetadata(request)
      }, tx);

      return next;
    });

    return updated;
  },

  async submitProduct(auth: AuthContext, id: string, request?: Request) {
    const product = await getProductOrThrow(auth, id);
    if (!canEditDraft(auth, product)) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You can only submit your own draft products", StatusCodes.FORBIDDEN);
    }

    if (product.variants.length === 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "At least one variant is required before submission", StatusCodes.BAD_REQUEST);
    }

    const submitted = await prisma.$transaction(async (tx) => {
      const warnings = await detectDuplicateWarnings(tx, auth, {
        id: product.id,
        name: product.name,
        brandId: product.brandId,
        variants: product.variants.map((variant: any) => ({
          sku: variant.sku,
          barcode: variant.barcode,
          volumeValue: variant.volumeValue,
          volumeUnit: variant.volumeUnit
        }))
      });

      const submission = product.submissions.find((entry: any) => entry.type === "NEW_PRODUCT");
      const now = new Date();

      await tx.product.update({
        where: { id },
        data: {
          approvalStatus: "PENDING_APPROVAL"
        }
      });

      await tx.branchProduct.updateMany({
        where: {
          productId: id
        },
        data: {
          status: "PENDING_APPROVAL",
          requestedById: auth.userId,
          requestedAt: now
        }
      });

      const nextSubmission = submission
        ? await tx.productSubmission.update({
          where: { id: submission.id },
          data: {
            status: "PENDING_APPROVAL",
            submittedAt: now,
            duplicateWarnings: warnings as Prisma.InputJsonValue
          }
        })
        : await tx.productSubmission.create({
          data: {
            organizationId: auth.organizationId,
            productId: id,
            originatingBranchId: product.originatingBranchId ?? auth.branchIds[0]!,
            submittedById: auth.userId,
            type: ProductSubmissionType.NEW_PRODUCT,
            status: "PENDING_APPROVAL",
            duplicateWarnings: warnings as Prisma.InputJsonValue,
            submittedAt: now
          }
        });

      await createNotifications(tx, [
        buildOrgScopedNotification({
          organizationId: auth.organizationId,
          branchId: product.originatingBranchId,
          role: UserRole.GENERAL_MANAGER,
          type: "PRODUCT_SUBMISSION_CREATED",
          title: "New product submission",
          message: `${product.name} is awaiting approval.`,
          metadata: {
            productId: id,
            submissionId: nextSubmission.id,
            duplicateWarnings: warnings
          } as Prisma.InputJsonValue
        })
      ]);

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: product.originatingBranchId,
        userId: auth.userId,
        action: "catalog.product.submit",
        entityType: "ProductSubmission",
        entityId: nextSubmission.id,
        afterData: nextSubmission,
        metadata: { warnings },
        ...buildRequestMetadata(request)
      }, tx);

      return nextSubmission;
    });

    return {
      product: await this.getProduct(auth, id),
      submission: buildSubmissionResponse(submitted)
    };
  },

  async listProductSubmissions(auth: AuthContext, query: Record<string, string | undefined>) {
    const scope = buildUserScope(auth);
    const submissions = await prisma.productSubmission.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(auth.role === UserRole.GENERAL_MANAGER
          ? {}
          : {
            OR: [
              { submittedById: auth.userId },
              { originatingBranchId: { in: auth.branchIds } }
            ]
          }),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.type ? { type: query.type as never } : {})
      },
      include: {
        product: {
          include: productInclude
        },
        branchProduct: {
          include: {
            branch: true,
            product: true
          }
        },
        originatingBranch: true,
        submittedBy: {
          select: userSummarySelect
        },
        reviewedBy: {
          select: userSummarySelect
        },
        priceProposals: {
          orderBy: {
            createdAt: "desc"
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return submissions.map((submission) => buildSubmissionResponse({
      ...submission,
      product: submission.product ? buildProductResponse(submission.product) : null
    }));
  },

  async getProductSubmission(auth: AuthContext, id: string) {
    const submission = await prisma.productSubmission.findFirstOrThrow({
      where: {
        id,
        organizationId: auth.organizationId
      },
      include: {
        product: {
          include: productInclude
        },
        branchProduct: {
          include: {
            branch: true,
            product: true
          }
        },
        originatingBranch: true,
        submittedBy: {
          select: userSummarySelect
        },
        reviewedBy: {
          select: userSummarySelect
        },
        priceProposals: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    if (
      auth.role !== UserRole.GENERAL_MANAGER &&
      submission.submittedById !== auth.userId &&
      !auth.branchIds.includes(submission.originatingBranchId)
    ) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "You do not have access to this submission", StatusCodes.FORBIDDEN);
    }

    return buildSubmissionResponse({
      ...submission,
      product: submission.product ? buildProductResponse(submission.product) : null
    });
  },

  async approveProduct(auth: AuthContext, id: string, input: Record<string, unknown>, request?: Request) {
    const product = await getProductOrThrow(auth, id);
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can approve products", StatusCodes.FORBIDDEN);
    }

    const submission = product.submissions.find((entry: any) => entry.type === "NEW_PRODUCT" && entry.status === "PENDING_APPROVAL");
    if (!submission) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This product does not have a pending approval request", StatusCodes.BAD_REQUEST);
    }

    await prisma.$transaction(async (tx) => {
      let brandId = product.brandId;
      let categoryId = product.categoryId;

      const mappedBrandId = optionalString(input.brandId);
      const mappedCategoryId = optionalString(input.categoryId);

      if (mappedBrandId) {
        brandId = mappedBrandId;
      } else if (!brandId && submission.requestedBrandName) {
        const normalizedName = normalizeCatalogName(submission.requestedBrandName);
        const existingBrand = await tx.brand.findFirst({
          where: {
            organizationId: auth.organizationId,
            OR: [
              { name: { equals: submission.requestedBrandName, mode: "insensitive" } },
              normalizedName ? { normalizedName } : {}
            ]
          }
        });

        brandId = existingBrand?.id ?? (await tx.brand.create({
          data: {
            organizationId: auth.organizationId,
            name: submission.requestedBrandName,
            normalizedName,
            status: "ACTIVE"
          }
        })).id;
      }

      if (mappedCategoryId) {
        categoryId = mappedCategoryId;
      } else if (!categoryId && submission.requestedCategoryName) {
        const normalizedName = normalizeCatalogName(submission.requestedCategoryName);
        const slug = slugify(submission.requestedCategoryName);
        const existingCategory = await tx.productCategory.findFirst({
          where: {
            organizationId: auth.organizationId,
            deletedAt: null,
            OR: [
              { name: { equals: submission.requestedCategoryName, mode: "insensitive" } },
              { slug },
              normalizedName ? { normalizedName } : {}
            ]
          }
        });

        categoryId = existingCategory?.id ?? (await tx.productCategory.create({
          data: {
            organizationId: auth.organizationId,
            name: submission.requestedCategoryName,
            slug,
            normalizedName,
            status: "ACTIVE",
            createdById: auth.userId,
            updatedById: auth.userId
          }
        })).id;
      }

      await tx.product.update({
        where: { id },
        data: {
          brandId,
          categoryId,
          approvalStatus: "APPROVED",
          approvedById: auth.userId,
          approvedAt: new Date(),
          isActive: input.isActive === undefined ? true : Boolean(input.isActive)
        }
      });

      await tx.branchProduct.updateMany({
        where: {
          productId: id
        },
        data: {
          status: "ACTIVE",
          isActive: true,
          approvedById: auth.userId,
          approvedAt: new Date()
        }
      });

      await tx.productSubmission.update({
        where: {
          id: submission.id
        },
        data: {
          status: "APPROVED",
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          reviewMetadata: {
            mappedBrandId: brandId,
            mappedCategoryId: categoryId,
            reviewNote: optionalString(input.reviewNote)
          }
        }
      });

      await tx.productPriceProposal.updateMany({
        where: {
          submissionId: submission.id,
          status: "PROPOSED"
        },
        data: {
          status: "APPROVED",
          approvedById: auth.userId,
          approvedAt: new Date(),
          approvedRetailPrice: input.approvedRetailPrice === undefined ? undefined : Number(input.approvedRetailPrice),
          approvedWholesalePrice: input.approvedWholesalePrice === undefined ? undefined : Number(input.approvedWholesalePrice),
          reason: optionalString(input.reviewNote)
        }
      });

      await createNotifications(tx, [
        buildOrgScopedNotification({
          organizationId: auth.organizationId,
          branchId: product.originatingBranchId,
          userId: submission.submittedById,
          type: "PRODUCT_SUBMISSION_APPROVED",
          title: "Product approved",
          message: `${product.name} was approved and added to the organization catalog.`,
          metadata: {
            productId: id,
            submissionId: submission.id
          }
        })
      ]);

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: product.originatingBranchId,
        userId: auth.userId,
        action: "catalog.product.approve",
        entityType: "ProductSubmission",
        entityId: submission.id,
        beforeData: submission,
        afterData: {
          productId: id,
          status: "APPROVED"
        },
        ...buildRequestMetadata(request)
      }, tx);
    });

    return this.getProduct(auth, id);
  },

  async rejectProduct(auth: AuthContext, id: string, input: Record<string, unknown>, request?: Request) {
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can reject products", StatusCodes.FORBIDDEN);
    }

    const product = await getProductOrThrow(auth, id);
    const submission = product.submissions.find((entry: any) => entry.type === "NEW_PRODUCT" && entry.status === "PENDING_APPROVAL");
    if (!submission) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This product does not have a pending approval request", StatusCodes.BAD_REQUEST);
    }

    const reason = cleanString(input.reason);
    if (!reason) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "A rejection reason is required", StatusCodes.BAD_REQUEST);
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          approvalStatus: "REJECTED"
        }
      });

      await tx.branchProduct.updateMany({
        where: { productId: id },
        data: {
          status: "REJECTED",
          isActive: false
        }
      });

      await tx.productSubmission.update({
        where: {
          id: submission.id
        },
        data: {
          status: "REJECTED",
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          rejectionReason: reason
        }
      });

      await tx.productPriceProposal.updateMany({
        where: {
          submissionId: submission.id,
          status: "PROPOSED"
        },
        data: {
          status: "REJECTED",
          approvedById: auth.userId,
          approvedAt: new Date(),
          reason
        }
      });

      await createNotifications(tx, [
        buildOrgScopedNotification({
          organizationId: auth.organizationId,
          branchId: product.originatingBranchId,
          userId: submission.submittedById,
          type: "PRODUCT_SUBMISSION_REJECTED",
          title: "Product rejected",
          message: `${product.name} was rejected.`,
          metadata: {
            productId: id,
            submissionId: submission.id,
            reason
          }
        })
      ]);

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: product.originatingBranchId,
        userId: auth.userId,
        action: "catalog.product.reject",
        entityType: "ProductSubmission",
        entityId: submission.id,
        beforeData: submission,
        afterData: { status: "REJECTED", reason },
        ...buildRequestMetadata(request)
      }, tx);
    });

    return this.getProduct(auth, id);
  },

  async requestCorrection(auth: AuthContext, id: string, input: Record<string, unknown>, request?: Request) {
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can request corrections", StatusCodes.FORBIDDEN);
    }

    const product = await getProductOrThrow(auth, id);
    const submission = product.submissions.find((entry: any) => entry.type === "NEW_PRODUCT" && entry.status === "PENDING_APPROVAL");
    if (!submission) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "This product does not have a pending approval request", StatusCodes.BAD_REQUEST);
    }

    const correctionNote = cleanString(input.correctionNote ?? input.note);
    if (!correctionNote) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "A correction note is required", StatusCodes.BAD_REQUEST);
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          approvalStatus: "CORRECTION_REQUIRED"
        }
      });

      await tx.branchProduct.updateMany({
        where: { productId: id },
        data: {
          status: "CORRECTION_REQUIRED",
          isActive: false
        }
      });

      await tx.productSubmission.update({
        where: {
          id: submission.id
        },
        data: {
          status: "CORRECTION_REQUIRED",
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          correctionNote,
          requestedChanges: optionalString(input.requestedChanges)
        }
      });

      await createNotifications(tx, [
        buildOrgScopedNotification({
          organizationId: auth.organizationId,
          branchId: product.originatingBranchId,
          userId: submission.submittedById,
          type: "PRODUCT_SUBMISSION_CORRECTION_REQUIRED",
          title: "Product needs correction",
          message: `${product.name} was returned for correction.`,
          metadata: {
            productId: id,
            submissionId: submission.id,
            correctionNote
          }
        })
      ]);

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: product.originatingBranchId,
        userId: auth.userId,
        action: "catalog.product.request_correction",
        entityType: "ProductSubmission",
        entityId: submission.id,
        beforeData: submission,
        afterData: { status: "CORRECTION_REQUIRED", correctionNote },
        ...buildRequestMetadata(request)
      }, tx);
    });

    return this.getProduct(auth, id);
  },

  async mergeProduct(auth: AuthContext, id: string, input: Record<string, unknown>, request?: Request) {
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can merge products", StatusCodes.FORBIDDEN);
    }

    const sourceProduct = await getProductOrThrow(auth, id);
    const targetProductId = cleanString(input.targetProductId);
    if (!targetProductId || targetProductId === id) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "A different target product is required for merge", StatusCodes.BAD_REQUEST);
    }

    const targetProduct = await prisma.product.findFirstOrThrow({
      where: {
        id: targetProductId,
        organizationId: auth.organizationId
      },
      include: productInclude
    });

    const submission = sourceProduct.submissions.find((entry: any) => entry.type === "NEW_PRODUCT");
    if (!submission) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Draft submission not found for this product", StatusCodes.NOT_FOUND);
    }

    await prisma.$transaction(async (tx) => {
      for (const variant of sourceProduct.variants) {
        const existsOnTarget = targetProduct.variants.some((targetVariant: any) =>
          targetVariant.sku === variant.sku || (variant.barcode && targetVariant.barcode === variant.barcode)
        );

        if (!existsOnTarget) {
          await tx.productVariant.create({
            data: {
              organizationId: auth.organizationId,
              productId: targetProductId,
              name: variant.name,
              sku: variant.sku,
              barcode: variant.barcode,
              volumeValue: variant.volumeValue,
              volumeUnit: variant.volumeUnit,
              concentrationType: variant.concentrationType,
              unitOfMeasure: variant.unitOfMeasure,
              packagingType: variant.packagingType,
              color: variant.color,
              batchTrackingEnabled: variant.batchTrackingEnabled,
              expiryTrackingEnabled: variant.expiryTrackingEnabled,
              defaultCost: variant.defaultCost,
              retailPrice: variant.retailPrice,
              wholesalePrice: variant.wholesalePrice,
              minimumWholesaleQuantity: variant.minimumWholesaleQuantity,
              reorderLevel: variant.reorderLevel,
              reorderQuantity: variant.reorderQuantity,
              maximumStockLevel: variant.maximumStockLevel,
              status: variant.status
            }
          });
        }
      }

      for (const branchProduct of sourceProduct.branchProducts) {
        const existingBranchProduct = await tx.branchProduct.findFirst({
          where: {
            branchId: branchProduct.branchId,
            productId: targetProductId
          }
        });

        if (!existingBranchProduct) {
          await tx.branchProduct.create({
            data: {
              organizationId: auth.organizationId,
              branchId: branchProduct.branchId,
              productId: targetProductId,
              priceListId: branchProduct.priceListId,
              status: "ACTIVE",
              isActive: true,
              sellInBranch: branchProduct.sellInBranch,
              reorderLevel: branchProduct.reorderLevel,
              minimumStock: branchProduct.minimumStock,
              maximumStock: branchProduct.maximumStock,
              shelfLocation: branchProduct.shelfLocation,
              branchLabel: branchProduct.branchLabel,
              notes: branchProduct.notes,
              introductionDate: branchProduct.introductionDate,
              requestedById: branchProduct.requestedById,
              requestedAt: branchProduct.requestedAt,
              approvedById: auth.userId,
              approvedAt: new Date()
            }
          });
        }
      }

      await tx.product.update({
        where: { id },
        data: {
          approvalStatus: "ARCHIVED",
          isActive: false,
          approvedById: auth.userId,
          approvedAt: new Date()
        }
      });

      await tx.branchProduct.updateMany({
        where: {
          productId: id
        },
        data: {
          status: "ARCHIVED",
          isActive: false
        }
      });

      await tx.productSubmission.update({
        where: {
          id: submission.id
        },
        data: {
          status: "APPROVED",
          reviewedById: auth.userId,
          reviewedAt: new Date(),
          reviewMetadata: {
            mergedIntoProductId: targetProductId,
            note: optionalString(input.reason)
          }
        }
      });

      await createNotifications(tx, [
        buildOrgScopedNotification({
          organizationId: auth.organizationId,
          branchId: sourceProduct.originatingBranchId,
          userId: submission.submittedById,
          type: "PRODUCT_SUBMISSION_MERGED",
          title: "Product merged with existing catalog item",
          message: `${sourceProduct.name} was merged into ${targetProduct.name}.`,
          metadata: {
            sourceProductId: id,
            targetProductId,
            submissionId: submission.id
          }
        })
      ]);

      await auditService.create({
        organizationId: auth.organizationId,
        branchId: sourceProduct.originatingBranchId,
        userId: auth.userId,
        action: "catalog.product.merge",
        entityType: "ProductSubmission",
        entityId: submission.id,
        metadata: {
          sourceProductId: id,
          targetProductId
        },
        ...buildRequestMetadata(request)
      }, tx);
    });

    return this.getProduct(auth, targetProductId);
  },

  async requestBranchActivation(auth: AuthContext, productId: string, input: Record<string, unknown>, request?: Request) {
    const product = await getProductOrThrow(auth, productId);
    if (product.approvalStatus !== "APPROVED") {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, "Only approved products can be added to a branch", StatusCodes.BAD_REQUEST);
    }

    const branchIds = buildBranchIds(auth, input.branchIds ?? [input.branchId]);
    const branchConfiguration = (input.branchConfiguration ?? input) as Record<string, unknown>;

    return prisma.$transaction(async (tx) => {
      const created: any[] = [];

      for (const branchId of branchIds) {
        if (auth.role !== UserRole.GENERAL_MANAGER) {
          assertBranchAccess(auth, branchId);
        }

        const config = buildBranchConfigPayload(branchConfiguration);
        const existingBranchProduct = await tx.branchProduct.findFirst({
          where: {
            branchId,
            productId
          }
        });

        if (existingBranchProduct?.isActive) {
          throw new AppError(ERROR_CODES.BAD_REQUEST, "Product is already active in this branch", StatusCodes.BAD_REQUEST);
        }

        const branchProduct = existingBranchProduct
          ? await tx.branchProduct.update({
            where: { id: existingBranchProduct.id },
            data: {
              priceListId: config.priceListId,
              status: auth.role === UserRole.GENERAL_MANAGER ? "ACTIVE" : "PENDING_APPROVAL",
              isActive: auth.role === UserRole.GENERAL_MANAGER,
              sellInBranch: config.sellInBranch,
              reorderLevel: config.reorderLevel,
              minimumStock: config.minimumStock,
              maximumStock: config.maximumStock,
              shelfLocation: config.shelfLocation,
              branchLabel: config.branchLabel,
              notes: config.notes,
              introductionDate: config.introductionDate,
              requestedById: auth.userId,
              requestedAt: new Date(),
              approvedById: auth.role === UserRole.GENERAL_MANAGER ? auth.userId : null,
              approvedAt: auth.role === UserRole.GENERAL_MANAGER ? new Date() : null
            }
          })
          : await tx.branchProduct.create({
            data: {
              organizationId: auth.organizationId,
              branchId,
              productId,
              priceListId: config.priceListId,
              status: auth.role === UserRole.GENERAL_MANAGER ? "ACTIVE" : "PENDING_APPROVAL",
              isActive: auth.role === UserRole.GENERAL_MANAGER,
              sellInBranch: config.sellInBranch,
              reorderLevel: config.reorderLevel,
              minimumStock: config.minimumStock,
              maximumStock: config.maximumStock,
              shelfLocation: config.shelfLocation,
              branchLabel: config.branchLabel,
              notes: config.notes,
              introductionDate: config.introductionDate,
              requestedById: auth.userId,
              requestedAt: new Date(),
              approvedById: auth.role === UserRole.GENERAL_MANAGER ? auth.userId : null,
              approvedAt: auth.role === UserRole.GENERAL_MANAGER ? new Date() : null
            }
          });

        let submission = null;
        if (auth.role !== UserRole.GENERAL_MANAGER) {
          submission = await tx.productSubmission.create({
            data: {
              organizationId: auth.organizationId,
              productId,
              branchProductId: branchProduct.id,
              originatingBranchId: branchId,
              submittedById: auth.userId,
              type: ProductSubmissionType.BRANCH_ACTIVATION,
              status: "PENDING_APPROVAL",
              submittedAt: new Date(),
              submittedSnapshot: {
                branchConfiguration: branchConfiguration
              } as Prisma.InputJsonValue
            }
          });

          await createPriceProposals(tx, auth, {
            productId,
            submissionId: submission.id,
            branchProductId: branchProduct.id,
            branchId,
            pricingRequest: input.pricingRequest as Record<string, unknown> | undefined
          });

          await createNotifications(tx, [
            buildOrgScopedNotification({
              organizationId: auth.organizationId,
              branchId,
              role: UserRole.GENERAL_MANAGER,
              type: "BRANCH_PRODUCT_ACTIVATION_REQUESTED",
              title: "Branch product activation requested",
              message: `${product.name} was requested for branch activation.`,
              metadata: {
                productId,
                branchId,
                branchProductId: branchProduct.id,
                submissionId: submission.id
              }
            })
          ]);
        }

        await auditService.create({
          organizationId: auth.organizationId,
          branchId,
          userId: auth.userId,
          action: auth.role === UserRole.GENERAL_MANAGER
            ? "catalog.branch_product.activate"
            : "catalog.branch_product.request",
          entityType: "BranchProduct",
          entityId: branchProduct.id,
          afterData: branchProduct,
          ...buildRequestMetadata(request)
        }, tx);

        created.push({
          branchProduct,
          submission
        });
      }

      return created;
    });
  },

  async activateBranchProduct(auth: AuthContext, productId: string, branchId: string, input: Record<string, unknown>, request?: Request) {
    if (auth.role !== UserRole.GENERAL_MANAGER) {
      throw new AppError(ERROR_CODES.ACCESS_DENIED, "Only the General Manager can activate products for a branch", StatusCodes.FORBIDDEN);
    }

    const product = await getProductOrThrow(auth, productId);
    const config = buildBranchConfigPayload(input);

    const activated = await prisma.$transaction(async (tx) => {
      const existing = await tx.branchProduct.findFirst({
        where: {
          branchId,
          productId
        }
      });

      const branchProduct = existing
        ? await tx.branchProduct.update({
          where: { id: existing.id },
          data: {
            priceListId: config.priceListId ?? existing.priceListId,
            status: "ACTIVE",
            isActive: true,
            sellInBranch: config.sellInBranch,
            reorderLevel: config.reorderLevel,
            minimumStock: config.minimumStock,
            maximumStock: config.maximumStock,
            shelfLocation: config.shelfLocation,
            branchLabel: config.branchLabel,
            notes: config.notes,
            introductionDate: config.introductionDate,
            approvedById: auth.userId,
            approvedAt: new Date()
          }
        })
        : await tx.branchProduct.create({
          data: {
            organizationId: auth.organizationId,
            branchId,
            productId,
            priceListId: config.priceListId,
            status: "ACTIVE",
            isActive: true,
            sellInBranch: config.sellInBranch,
            reorderLevel: config.reorderLevel,
            minimumStock: config.minimumStock,
            maximumStock: config.maximumStock,
            shelfLocation: config.shelfLocation,
            branchLabel: config.branchLabel,
            notes: config.notes,
            introductionDate: config.introductionDate,
            approvedById: auth.userId,
            approvedAt: new Date()
          }
        });

      const activationSubmission = await tx.productSubmission.findFirst({
        where: {
          productId,
          branchProductId: branchProduct.id,
          type: ProductSubmissionType.BRANCH_ACTIVATION,
          status: "PENDING_APPROVAL"
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      if (activationSubmission) {
        await tx.productSubmission.update({
          where: { id: activationSubmission.id },
          data: {
            status: "APPROVED",
            reviewedById: auth.userId,
            reviewedAt: new Date()
          }
        });

        await tx.productPriceProposal.updateMany({
          where: {
            submissionId: activationSubmission.id,
            status: "PROPOSED"
          },
          data: {
            status: "APPROVED",
            approvedById: auth.userId,
            approvedAt: new Date(),
            approvedRetailPrice: input.approvedRetailPrice === undefined ? undefined : Number(input.approvedRetailPrice),
            approvedWholesalePrice: input.approvedWholesalePrice === undefined ? undefined : Number(input.approvedWholesalePrice),
            reason: optionalString(input.reason)
          }
        });

        await createNotifications(tx, [
          buildOrgScopedNotification({
            organizationId: auth.organizationId,
            branchId,
            userId: activationSubmission.submittedById,
            type: "BRANCH_PRODUCT_ACTIVATED",
            title: "Branch product activated",
            message: `${product.name} is now active in the selected branch.`,
            metadata: {
              productId,
              branchId,
              branchProductId: branchProduct.id,
              submissionId: activationSubmission.id
            }
          })
        ]);
      }

      await auditService.create({
        organizationId: auth.organizationId,
        branchId,
        userId: auth.userId,
        action: "catalog.branch_product.activate",
        entityType: "BranchProduct",
        entityId: branchProduct.id,
        afterData: branchProduct,
        ...buildRequestMetadata(request)
      }, tx);

      return branchProduct;
    });

    return activated;
  },

  async updateBranchProduct(
    auth: AuthContext,
    productId: string,
    branchId: string,
    input: Record<string, unknown>,
    request?: Request
  ) {
    assertBranchAccess(auth, branchId);

    const branchProduct = await prisma.branchProduct.findFirstOrThrow({
      where: {
        organizationId: auth.organizationId,
        branchId,
        productId
      },
      include: {
        branch: true,
        product: true
      }
    });

    const config = buildBranchConfigPayload(input);
    const updated = await prisma.branchProduct.update({
      where: {
        id: branchProduct.id
      },
      data: {
        priceListId: input.priceListId === undefined ? branchProduct.priceListId : config.priceListId,
        sellInBranch: config.sellInBranch,
        reorderLevel: config.reorderLevel,
        minimumStock: config.minimumStock,
        maximumStock: config.maximumStock,
        shelfLocation: config.shelfLocation,
        branchLabel: config.branchLabel,
        notes: config.notes,
        introductionDate: config.introductionDate
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId,
      userId: auth.userId,
      action: "catalog.branch_product.update",
      entityType: "BranchProduct",
      entityId: branchProduct.id,
      beforeData: branchProduct,
      afterData: updated,
      ...buildRequestMetadata(request)
    });

    return updated;
  },

  async variantStock(auth: AuthContext, variantId: string) {
    const scope = buildUserScope(auth);
    return prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        productVariantId: variantId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        }
      }
    });
  },

  async findByBarcode(auth: AuthContext, barcode: string, branchId?: string) {
    if (branchId) {
      assertBranchAccess(auth, branchId);
    }

    const variant = await prisma.productVariant.findFirst({
      where: {
        organizationId: auth.organizationId,
        status: "ACTIVE",
        product: {
          isActive: true,
          approvalStatus: "APPROVED",
          ...(branchId
            ? {
              branchProducts: {
                some: {
                  branchId,
                  isActive: true
                }
              }
            }
            : {})
        },
        OR: [
          { barcode },
          { barcodes: { some: { barcode } } }
        ]
      },
      include: {
        product: true,
        ...(branchId ? { inventoryBalances: { where: { branchId } } } : {})
      }
    });

    if (!variant || !branchId) return variant;

    return {
      ...variant,
      availableQuantity: variant.inventoryBalances.reduce((total, balance) => total + Number(balance.quantityAvailable), 0),
      inventoryBalances: undefined
    };
  },

  async addVariantBarcode(auth: AuthContext, variantId: string, barcode: string, request?: Request) {
    const variant = await prisma.productVariant.findFirst({
      where: {
        id: variantId,
        organizationId: auth.organizationId
      },
      include: {
        product: true
      }
    });

    if (!variant) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product variant not found", StatusCodes.NOT_FOUND);
    }

    const created = await prisma.productBarcode.create({
      data: {
        productVariantId: variantId,
        barcode
      }
    });

    await auditService.create({
      organizationId: auth.organizationId,
      branchId: variant.product.originatingBranchId,
      userId: auth.userId,
      action: "catalog.variant.barcode.add",
      entityType: "ProductBarcode",
      entityId: created.id,
      afterData: created,
      ...buildRequestMetadata(request)
    });

    return created;
  },

  listPriceLists(auth: AuthContext) {
    const scope = buildUserScope(auth);
    return prisma.priceList.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchIds
          ? {
            OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }]
          }
          : {})
      },
      include: priceListInclude,
      orderBy: {
        createdAt: "desc"
      }
    });
  },

  async createPriceList(
    auth: AuthContext,
    input: {
      branchId?: string;
      name: string;
      type: string;
      currencyCode: string;
      isDefault?: boolean;
      validFrom?: string;
      validUntil?: string;
    }
  ) {
    if (input.branchId) {
      assertBranchAccess(auth, input.branchId);
    }

    return prisma.priceList.create({
      data: {
        organizationId: auth.organizationId,
        branchId: input.branchId ?? null,
        name: cleanString(input.name),
        type: input.type as never,
        currencyCode: input.currencyCode,
        isDefault: input.isDefault ?? false,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null
      }
    });
  },

  async updatePriceList(auth: AuthContext, id: string, input: Record<string, unknown>) {
    await prisma.priceList.findFirstOrThrow({
      where: {
        id,
        organizationId: auth.organizationId
      }
    });

    return prisma.priceList.update({
      where: { id },
      data: input as object
    });
  },

  addPriceListItem(
    auth: AuthContext,
    priceListId: string,
    input: {
      productVariantId: string;
      minimumQuantity?: number;
      unitPrice: number;
      maximumDiscountPercent?: number;
      validFrom?: string;
      validUntil?: string;
    }
  ) {
    return Promise.all([
      prisma.priceList.findFirstOrThrow({
        where: {
          id: priceListId,
          organizationId: auth.organizationId
        }
      }),
      prisma.productVariant.findFirstOrThrow({
        where: {
          id: input.productVariantId,
          organizationId: auth.organizationId
        }
      })
    ]).then(() =>
      prisma.priceListItem.create({
        data: {
          priceListId,
          productVariantId: input.productVariantId,
          minimumQuantity: input.minimumQuantity ?? 1,
          unitPrice: input.unitPrice,
          maximumDiscountPercent: input.maximumDiscountPercent ?? null,
          validFrom: input.validFrom ? new Date(input.validFrom) : null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null
        }
      })
    );
  }
};
