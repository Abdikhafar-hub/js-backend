import type { Request, Response } from "express";
import { PriceListStatus, PriceListType, StorefrontDestinationType, StorefrontSectionSourceType, type ProductMedia, type StorefrontCollection, type StorefrontSection } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../errors/app-error.js";
import { ERROR_CODES } from "../../errors/error-codes.js";
import { prisma } from "../../lib/prisma.js";
import { resolvePublicMediaUrl } from "../../services/storage.service.js";
import { sendSuccess } from "../../utils/api-response.js";
import { slugify } from "../../utils/slugify.js";
import { ensureStorefrontDefaults } from "./storefront.defaults.js";
import { storefrontMediaService } from "./storefront-media.service.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

const productPublicInclude = {
  brand: true,
  category: true,
  media: {
    where: { isPublished: true },
    orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }]
  },
  variants: {
    where: {
      status: "ACTIVE",
      storefrontProfile: {
        is: {
          isPublishedOnline: true
        }
      }
    },
    include: {
      storefrontProfile: true,
      inventoryBalances: true
    }
  },
  storefrontProfile: true
} satisfies Prisma.ProductInclude;

type PublicProductEntity = Prisma.ProductGetPayload<{ include: typeof productPublicInclude }>;

type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  oldPrice?: number;
  image: string;
  notes: string;
  category: string;
  categoryName?: string | null;
  gender: "Men" | "Women" | "Unisex" | "Not Applicable";
  badge?: string;
  description: string;
  gallery: string[];
  variants: Array<{
    id: string;
    sku: string;
    label: string;
    volumeValue: number;
    volumeUnit: string;
    price: number;
    compareAtPrice?: number;
    quantityAvailable: number;
    inStock: boolean;
  }>;
  defaultVariantId: string;
  isInStock: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  productType?: string | null;
};

type CatalogQuery = {
  page: number;
  limit: number;
  search?: string;
  brand?: string;
  gender?: string;
  category?: string;
  collection?: string;
  productType?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onOffer?: boolean;
  publishedAfter?: Date;
};

const getOrganizationId = async (req: Request): Promise<string> => {
  if (req.auth?.organizationId) {
    return req.auth.organizationId;
  }

  const headerId = req.headers["x-organization-id"];
  if (typeof headerId === "string" && headerId.trim()) {
    return headerId;
  }

  const firstOrg = await prisma.organization.findFirst({ select: { id: true } });
  return firstOrg?.id ?? "org_pulse_perfumes";
};

const buildPublicationWindowFilter = (now: Date): Prisma.ProductStorefrontProfileWhereInput => ({
  isPublished: true,
  OR: [{ publishFrom: null }, { publishFrom: { lte: now } }],
  AND: [{ OR: [{ publishUntil: null }, { publishUntil: { gte: now } }] }]
});

const parseBooleanQuery = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const parseNumberQuery = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseDateQuery = (value: unknown) => {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseCatalogQuery = (req: Request): CatalogQuery => {
  const rawPage = parseNumberQuery(req.query.page) ?? DEFAULT_PAGE;
  const rawLimit = parseNumberQuery(req.query.limit) ?? DEFAULT_LIMIT;

  return {
    page: Math.max(1, Math.trunc(rawPage)),
    limit: Math.min(MAX_LIMIT, Math.max(1, Math.trunc(rawLimit))),
    search: typeof req.query.search === "string" ? req.query.search.trim() : typeof req.query.q === "string" ? req.query.q.trim() : undefined,
    brand: typeof req.query.brand === "string" ? req.query.brand.trim() : undefined,
    gender: typeof req.query.gender === "string" ? req.query.gender.trim() : typeof req.query.genderTarget === "string" ? req.query.genderTarget.trim() : undefined,
    category: typeof req.query.category === "string" ? req.query.category.trim() : typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : undefined,
    collection: typeof req.query.collection === "string" ? req.query.collection.trim() : undefined,
    productType: typeof req.query.productType === "string" ? req.query.productType.trim() : undefined,
    sort: typeof req.query.sort === "string" ? req.query.sort.trim() : "latest",
    minPrice: parseNumberQuery(req.query.minPrice),
    maxPrice: parseNumberQuery(req.query.maxPrice),
    inStock: parseBooleanQuery(req.query.inStock),
    onOffer: parseBooleanQuery(req.query.onOffer),
    publishedAfter: parseDateQuery(req.query.publishedAfter)
  };
};

const getMediaImage = (media: ProductMedia[] | undefined, fallback?: string | null) => {
  const primary = media?.find((entry) => entry.isPrimary) ?? media?.[0];
  return resolvePublicMediaUrl(primary?.url) || resolvePublicMediaUrl(fallback) || "";
};

const normalizeMediaRecord = <T extends { url: string }>(media: T): T => ({
  ...media,
  url: resolvePublicMediaUrl(media.url) ?? media.url
});

const normalizeGender = (genderTarget: string | null | undefined): PublicProductCard["gender"] => {
  if (genderTarget === "MEN") return "Men";
  if (genderTarget === "WOMEN") return "Women";
  if (genderTarget === "UNISEX") return "Unisex";
  return "Not Applicable";
};

const isActiveWindow = (now: Date, startsAt?: Date | null, endsAt?: Date | null) => {
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
};

const getOnlinePriceItems = async (organizationId: string, variantIds: string[]) => {
  if (variantIds.length === 0) {
    return new Map<string, number>();
  }

  const now = new Date();
  const items = await prisma.priceListItem.findMany({
    where: {
      productVariantId: { in: variantIds },
      minimumQuantity: 1,
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }],
      priceList: {
        organizationId,
        branchId: null,
        type: PriceListType.ONLINE_RETAIL,
        status: PriceListStatus.ACTIVE,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }]
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  const priceMap = new Map<string, number>();
  for (const item of items) {
    if (!priceMap.has(item.productVariantId)) {
      priceMap.set(item.productVariantId, Number(item.unitPrice));
    }
  }
  return priceMap;
};

const getConfiguredOnlinePriceItems = async (organizationId: string, variantIds: string[]) => {
  if (variantIds.length === 0) {
    return new Map<string, number>();
  }

  const items = await prisma.priceListItem.findMany({
    where: {
      productVariantId: { in: variantIds },
      minimumQuantity: 1,
      priceList: {
        organizationId,
        branchId: null,
        type: PriceListType.ONLINE_RETAIL
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  const priceMap = new Map<string, number>();
  for (const item of items) {
    if (!priceMap.has(item.productVariantId)) {
      priceMap.set(item.productVariantId, Number(item.unitPrice));
    }
  }
  return priceMap;
};

const serializePublicProduct = (
  product: PublicProductEntity,
  onlinePriceMap: Map<string, number>
): PublicProductCard | null => {
  const variants = [...product.variants]
    .sort((left, right) => {
      const leftOrder = left.storefrontProfile?.displayOrder ?? 0;
      const rightOrder = right.storefrontProfile?.displayOrder ?? 0;
      return leftOrder - rightOrder;
    })
    .map((variant) => {
      const onlinePrice = onlinePriceMap.get(variant.id);
      if (onlinePrice === undefined) {
        return null;
      }

      const quantityAvailable = variant.inventoryBalances.reduce(
        (sum, balance) => sum + Number(balance.quantityAvailable ?? 0),
        0
      );

      return {
        id: variant.id,
        sku: variant.sku,
        label:
          variant.storefrontProfile?.websiteLabel ||
          variant.name ||
          `${Number(variant.volumeValue ?? 0)}${variant.volumeUnit ?? "ML"}`,
        volumeValue: Number(variant.volumeValue ?? 0),
        volumeUnit: variant.volumeUnit ?? "ML",
        price: onlinePrice,
        compareAtPrice: variant.storefrontProfile?.compareAtPrice
          ? Number(variant.storefrontProfile.compareAtPrice)
          : undefined,
        quantityAvailable,
        inStock: quantityAvailable > 0 || Boolean(variant.storefrontProfile?.allowBackorder)
      };
    })
    .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));

  if (variants.length === 0) {
    return null;
  }

  const defaultVariant =
    variants.find((variant) =>
      product.variants.find((candidate) => candidate.id === variant.id)?.storefrontProfile?.isDefaultWebsiteVariant
    ) ?? variants[0];

  if (!defaultVariant) {
    return null;
  }

  const image = getMediaImage(product.media as ProductMedia[], product.imageUrl);
  const gallery = (product.media ?? []).map((media) => resolvePublicMediaUrl(media.url) ?? media.url);
  const price = defaultVariant.price;
  const oldPrice = defaultVariant.compareAtPrice;
  const discountBadge =
    oldPrice && oldPrice > price ? `${Math.round(((oldPrice - price) / oldPrice) * 100)}% OFF` : undefined;

  return {
    id: product.id,
    slug: product.storefrontProfile?.slug ?? product.slug,
    name: product.storefrontProfile?.websiteTitle || product.name,
    brand: product.brand?.name || "JS Perfumes",
    price,
    oldPrice,
    image,
    notes: product.storefrontProfile?.shortDescription || product.shortDescription || product.description || "",
    category: product.category?.slug || "perfumes",
    categoryName: product.category?.name,
    gender: normalizeGender(product.genderTarget),
    badge: product.storefrontProfile?.isNewArrival ? "NEW" : discountBadge,
    description: product.storefrontProfile?.longDescription || product.fullDescription || product.description || "",
    gallery: gallery.length > 0 ? gallery : [image],
    variants,
    defaultVariantId: defaultVariant.id,
    isInStock: variants.some((variant) => variant.inStock),
    seoTitle: product.storefrontProfile?.seoTitle,
    seoDescription: product.storefrontProfile?.seoDescription,
    productType: product.productType ?? null
  };
};

const buildBasePublicProductWhere = (
  organizationId: string,
  query: CatalogQuery,
  now: Date
): Prisma.ProductWhereInput => {
  const whereClause: Prisma.ProductWhereInput = {
    organizationId,
    isActive: true,
    approvalStatus: "APPROVED",
    storefrontProfile: {
      is: buildPublicationWindowFilter(now)
    },
    variants: {
      some: {
        status: "ACTIVE",
        storefrontProfile: {
          is: {
            isPublishedOnline: true
          }
        }
      }
    }
  };

  if (query.brand) {
    whereClause.brand = {
      is: {
        name: {
          equals: query.brand,
          mode: "insensitive"
        }
      }
    };
  }

  if (query.gender) {
    const normalized = query.gender.toUpperCase();
    const genderTarget =
      normalized === "MEN"
        ? "MEN"
        : normalized === "WOMEN"
          ? "WOMEN"
          : normalized === "UNISEX"
            ? "UNISEX"
            : undefined;
    if (genderTarget) {
      whereClause.genderTarget = genderTarget;
    }
  }

  if (query.category) {
    whereClause.category = {
      is: {
        slug: query.category.toLowerCase()
      }
    };
  }

  if (query.productType) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    whereClause.productType = query.productType.toUpperCase() as any;
  }

  if (query.search) {
    whereClause.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
      { fullDescription: { contains: query.search, mode: "insensitive" } },
      { brand: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      { storefrontProfile: { is: { websiteTitle: { contains: query.search, mode: "insensitive" } } } },
      { storefrontProfile: { is: { searchKeywords: { has: query.search } } } }
    ];
  }

  if (query.publishedAfter) {
    whereClause.storefrontProfile = {
      is: {
        ...buildPublicationWindowFilter(now),
        publishedAt: {
          gte: query.publishedAfter
        }
      }
    };
  }

  return whereClause;
};

const ensureOnlineRetailPriceList = async (organizationId: string) => {
  const existing = await prisma.priceList.findFirst({
    where: {
      organizationId,
      branchId: null,
      type: PriceListType.ONLINE_RETAIL
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.priceList.create({
    data: {
      organizationId,
      name: "Online Retail",
      type: PriceListType.ONLINE_RETAIL,
      currencyCode: "KES",
      isDefault: false,
      status: PriceListStatus.ACTIVE
    }
  });
};

const getPublicProducts = async (
  organizationId: string,
  query: CatalogQuery,
  overrides?: { forcedProductIds?: string[] }
) => {
  const now = new Date();
  const whereClause = buildBasePublicProductWhere(organizationId, query, now);

  if (overrides?.forcedProductIds) {
    whereClause.id = { in: overrides.forcedProductIds };
  }

  const products = await prisma.product.findMany({
    where: whereClause,
    include: productPublicInclude,
    orderBy: [{ createdAt: "desc" }]
  });

  const onlinePriceMap = await getOnlinePriceItems(
    organizationId,
    products.flatMap((product) => product.variants.map((variant) => variant.id))
  );

  let items = products
    .map((product) => serializePublicProduct(product, onlinePriceMap))
    .filter((product): product is PublicProductCard => Boolean(product));

  if (query.onOffer) {
    items = items.filter((product) => Boolean(product.oldPrice && product.oldPrice > product.price));
  }

  if (query.inStock !== undefined) {
    items = items.filter((product) => product.isInStock === query.inStock);
  }

  if (query.minPrice !== undefined) {
    items = items.filter((product) => product.price >= query.minPrice!);
  }

  if (query.maxPrice !== undefined) {
    items = items.filter((product) => product.price <= query.maxPrice!);
  }

  switch (query.sort) {
    case "price-asc":
      items.sort((left, right) => left.price - right.price);
      break;
    case "price-desc":
      items.sort((left, right) => right.price - left.price);
      break;
    case "title-asc":
      items.sort((left, right) => left.name.localeCompare(right.name));
      break;
    case "title-desc":
      items.sort((left, right) => right.name.localeCompare(left.name));
      break;
    default:
      items.sort((left, right) => right.slug.localeCompare(left.slug));
      break;
  }

  if (overrides?.forcedProductIds?.length) {
    const orderMap = new Map(overrides.forcedProductIds.map((id, index) => [id, index]));
    items.sort((left, right) => (orderMap.get(left.id) ?? 10_000) - (orderMap.get(right.id) ?? 10_000));
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const offset = (query.page - 1) * query.limit;

  return {
    items: items.slice(offset, offset + query.limit),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1
    }
  };
};

const resolveCollectionProducts = async (
  organizationId: string,
  collection: StorefrontCollection,
  query: CatalogQuery
) => {
  const now = new Date();
  const manualProductWhere = buildBasePublicProductWhere(
    organizationId,
    {
      page: 1,
      limit: MAX_LIMIT,
      sort: "latest"
    },
    now
  );

  const collectionItems = await prisma.storefrontCollectionItem.findMany({
    where: {
      collectionId: collection.id,
      product: {
        ...manualProductWhere
      }
    },
    include: {
      product: {
        include: productPublicInclude
      }
    },
    orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }, { createdAt: "asc" }]
  });

  const manualProducts = collectionItems
    .filter((item) => isActiveWindow(now, item.startsAt, item.endsAt))
    .map((item) => item.product);

  const manualPriceMap = await getOnlinePriceItems(
    organizationId,
    manualProducts.flatMap((product) => product.variants.map((variant) => variant.id))
  );

  const manualCards = manualProducts
    .map((product) => serializePublicProduct(product, manualPriceMap))
    .filter((product): product is PublicProductCard => Boolean(product));

  const ruleConfig = (collection.ruleConfig ?? {}) as Record<string, unknown>;
  const manualOnly =
    collection.type === "MANUAL" ||
    ruleConfig.mode === "MANUAL_ONLY" ||
    (collection.type === "BEST_SELLERS" && !ruleConfig.fallbackToManual && manualCards.length > 0);

  if (manualOnly) {
    return manualCards;
  }

  const autoQuery: CatalogQuery = {
    ...query,
    page: 1,
    limit: MAX_LIMIT
  };

  if (collection.type === "NEW_ARRIVALS" && autoQuery.sort === "latest") {
    autoQuery.sort = "latest";
  }

  if (collection.slug === "offers") {
    autoQuery.onOffer = true;
  }

  const forcedWhere: Prisma.ProductWhereInput = {};
  const genderTargets = Array.isArray(ruleConfig.genderTargets)
    ? ruleConfig.genderTargets.map((target) => String(target))
    : [];
  const categorySlugs = Array.isArray(ruleConfig.categorySlugs)
    ? ruleConfig.categorySlugs.map((slug) => String(slug))
    : [];
  const productTypes = Array.isArray(ruleConfig.productTypes)
    ? ruleConfig.productTypes.map((type) => String(type))
    : [];

  if (genderTargets.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forcedWhere.genderTarget = { in: genderTargets as any[] };
  }

  if (categorySlugs.length > 0) {
    forcedWhere.category = {
      is: {
        slug: { in: categorySlugs }
      }
    };
  }

  if (productTypes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forcedWhere.productType = { in: productTypes as any[] };
  }

  const autoWhere = {
    ...buildBasePublicProductWhere(organizationId, autoQuery, now),
    ...forcedWhere,
    id: {
      notIn: manualCards.map((product) => product.id)
    }
  } satisfies Prisma.ProductWhereInput;

  const autoProducts = await prisma.product.findMany({
    where: autoWhere,
    include: productPublicInclude,
    orderBy: [{ createdAt: "desc" }]
  });

  const autoPriceMap = await getOnlinePriceItems(
    organizationId,
    autoProducts.flatMap((product) => product.variants.map((variant) => variant.id))
  );

  const autoCards = autoProducts
    .map((product) => serializePublicProduct(product, autoPriceMap))
    .filter((product): product is PublicProductCard => Boolean(product));

  return [...manualCards, ...autoCards];
};

const resolveSectionProducts = async (
  organizationId: string,
  section: StorefrontSection
) => {
  const now = new Date();
  const isHomepageProductGrid = section.page === "HOME" && section.layoutType === "PRODUCT_GRID";
  const manualProductWhere = buildBasePublicProductWhere(
    organizationId,
    {
      page: 1,
      limit: MAX_LIMIT,
      sort: "latest"
    },
    now
  );
  const placements = await prisma.storefrontSectionPlacement.findMany({
    where: {
      organizationId,
      sectionId: section.id,
      product: {
        ...manualProductWhere
      }
    },
    include: {
      product: {
        include: productPublicInclude
      }
    },
    orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
  });

  const activePlacements = placements.filter((placement) =>
    isActiveWindow(now, placement.startsAt, placement.endsAt)
  );

  const placementPriceMap = await getOnlinePriceItems(
    organizationId,
    activePlacements.flatMap((placement) => placement.product.variants.map((variant) => variant.id))
  );

  const placementProducts = activePlacements
    .map((placement) => serializePublicProduct(placement.product, placementPriceMap))
    .filter((product): product is PublicProductCard => Boolean(product));

  const maxItems = section.maxItems > 0 ? section.maxItems : placementProducts.length;

  if (isHomepageProductGrid || section.sourceType !== StorefrontSectionSourceType.COLLECTION) {
    return placementProducts.slice(0, maxItems);
  }

  const settings = (section.settings ?? {}) as Record<string, unknown>;
  const collectionSlug =
    typeof settings.collectionSlug === "string" ? settings.collectionSlug : undefined;

  if (!collectionSlug || placementProducts.length >= maxItems) {
    return placementProducts.slice(0, maxItems);
  }

  const collection = await prisma.storefrontCollection.findFirst({
    where: {
      organizationId,
      slug: collectionSlug,
      isPublished: true
    }
  });

  if (!collection) {
    return placementProducts.slice(0, maxItems);
  }

  const collectionProducts = await resolveCollectionProducts(organizationId, collection, {
    page: 1,
    limit: maxItems,
    sort: "latest"
  });

  const assignedIds = new Set(placementProducts.map((product) => product.id));
  const supplemental = collectionProducts.filter((product) => !assignedIds.has(product.id));

  return [...placementProducts, ...supplemental].slice(0, maxItems);
};

const calculateStorefrontReadiness = (payload: {
  storefrontProfile: Prisma.ProductStorefrontProfileGetPayload<object> | null;
  mediaCount: number;
  onlineVariantCount: number;
  onlinePriceCount: number;
  hasBrand: boolean;
  hasCategory: boolean;
  collectionCount: number;
  sectionPlacementCount: number;
  isApproved: boolean;
  isActive: boolean;
}) => {
  const checks = [
    { key: "approved", label: "Product approved", passed: payload.isApproved },
    { key: "active", label: "Product active", passed: payload.isActive },
    {
      key: "title",
      label: "Website title",
      passed: Boolean(payload.storefrontProfile?.websiteTitle || payload.storefrontProfile?.slug)
    },
    {
      key: "slug",
      label: "Slug",
      passed: Boolean(payload.storefrontProfile?.slug)
    },
    {
      key: "description",
      label: "Description",
      passed: Boolean(payload.storefrontProfile?.longDescription || payload.storefrontProfile?.shortDescription)
    },
    {
      key: "primaryImage",
      label: "Primary image",
      passed: payload.mediaCount > 0
    },
    {
      key: "variants",
      label: "Published online variant",
      passed: payload.onlineVariantCount > 0
    },
    {
      key: "onlinePrice",
      label: "Online retail price",
      passed: payload.onlinePriceCount > 0
    },
    {
      key: "brand",
      label: "Brand",
      passed: payload.hasBrand
    },
    {
      key: "category",
      label: "Category",
      passed: payload.hasCategory
    },
    {
      key: "destinations",
      label: "At least one destination",
      passed: payload.collectionCount > 0 || payload.sectionPlacementCount > 0
    }
  ];

  return {
    isReady: checks.every((check) => check.passed),
    checks
  };
};

const getAdminStorefrontProfilePayload = async (organizationId: string, productId: string) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId },
    include: {
      brand: true,
      category: true,
      storefrontProfile: true,
      media: {
        orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }]
      },
      variants: {
        include: {
          storefrontProfile: true,
          inventoryBalances: true
        }
      },
      collectionItems: {
        include: {
          collection: true
        },
        orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
      },
      sectionPlacements: {
        include: {
          section: true
        },
        orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
      }
    }
  });

  if (!product) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found", StatusCodes.NOT_FOUND);
  }

  const onlinePriceMap = await getConfiguredOnlinePriceItems(
    organizationId,
    product.variants.map((variant) => variant.id)
  );

  const readiness = calculateStorefrontReadiness({
    storefrontProfile: product.storefrontProfile,
    mediaCount: product.media.length,
    onlineVariantCount: product.variants.filter((variant) => variant.storefrontProfile?.isPublishedOnline).length,
    onlinePriceCount: product.variants.filter((variant) => onlinePriceMap.has(variant.id)).length,
    hasBrand: Boolean(product.brandId),
    hasCategory: Boolean(product.categoryId),
    collectionCount: product.collectionItems.length,
    sectionPlacementCount: product.sectionPlacements.length,
    isApproved: product.approvalStatus === "APPROVED",
    isActive: product.isActive
  });

  return {
    product: {
      id: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      category: product.category,
      productType: product.productType,
      genderTarget: product.genderTarget,
      approvalStatus: product.approvalStatus,
      isActive: product.isActive
    },
    storefrontProfile: product.storefrontProfile,
    media: product.media.map((media) => normalizeMediaRecord(media)),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      volumeValue: variant.volumeValue ? Number(variant.volumeValue) : null,
      volumeUnit: variant.volumeUnit,
      retailPrice: Number(variant.retailPrice),
      onlinePrice: onlinePriceMap.get(variant.id) ?? null,
      quantityAvailable: variant.inventoryBalances.reduce(
        (sum, balance) => sum + Number(balance.quantityAvailable ?? 0),
        0
      ),
      storefrontProfile: variant.storefrontProfile
        ? {
            ...variant.storefrontProfile,
            compareAtPrice: variant.storefrontProfile.compareAtPrice
              ? Number(variant.storefrontProfile.compareAtPrice)
              : null
          }
        : null
    })),
    collectionAssignments: product.collectionItems.map((item) => ({
      id: item.id,
      collectionId: item.collectionId,
      collectionName: item.collection.name,
      collectionSlug: item.collection.slug,
      displayOrder: item.displayOrder,
      isPinned: item.isPinned,
      startsAt: item.startsAt,
      endsAt: item.endsAt
    })),
    sectionPlacements: product.sectionPlacements.map((placement) => ({
      id: placement.id,
      sectionId: placement.sectionId,
      sectionKey: placement.section.key,
      sectionTitle: placement.section.title,
      displayOrder: placement.displayOrder,
      isPinned: placement.isPinned,
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
      titleOverride: placement.titleOverride,
      subtitleOverride: placement.subtitleOverride,
      mediaOverrideId: placement.mediaOverrideId
    })),
    previewDestinations: [
      ...(product.storefrontProfile?.isPublished ? ["Shop"] : []),
      ...product.collectionItems.map((item) => item.collection.name),
      ...product.sectionPlacements.map((placement) => placement.section.title || placement.section.key)
    ],
    readiness
  };
};

const syncCollectionAssignments = async (
  organizationId: string,
  productId: string,
  assignments: Array<{
    collectionId: string;
    displayOrder?: number;
    isPinned?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
  }>
) => {
  const validCollections = await prisma.storefrontCollection.findMany({
    where: {
      organizationId,
      id: { in: assignments.map((assignment) => assignment.collectionId) }
    },
    select: { id: true }
  });

  const validIds = new Set(validCollections.map((collection) => collection.id));

  await prisma.storefrontCollectionItem.deleteMany({
    where: {
      productId,
      collection: {
        organizationId
      }
    }
  });

  if (assignments.length === 0) {
    return;
  }

  await prisma.storefrontCollectionItem.createMany({
    data: assignments
      .filter((assignment) => validIds.has(assignment.collectionId))
      .map((assignment, index) => ({
        collectionId: assignment.collectionId,
        productId,
        displayOrder: assignment.displayOrder ?? index,
        isPinned: Boolean(assignment.isPinned),
        startsAt: assignment.startsAt ? new Date(assignment.startsAt) : null,
        endsAt: assignment.endsAt ? new Date(assignment.endsAt) : null
      }))
  });
};

const syncSectionPlacements = async (
  organizationId: string,
  productId: string,
  placements: Array<{
    sectionKey: string;
    displayOrder?: number;
    isPinned?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    titleOverride?: string | null;
    subtitleOverride?: string | null;
    mediaOverrideId?: string | null;
  }>
) => {
  const sections = await prisma.storefrontSection.findMany({
    where: {
      organizationId,
      key: { in: placements.map((placement) => placement.sectionKey) }
    },
    select: { id: true, key: true }
  });

  const sectionIdByKey = new Map(sections.map((section) => [section.key, section.id]));

  await prisma.storefrontSectionPlacement.deleteMany({
    where: {
      organizationId,
      productId
    }
  });

  if (placements.length === 0) {
    return;
  }

  await prisma.storefrontSectionPlacement.createMany({
    data: placements
      .map((placement, index) => {
        const sectionId = sectionIdByKey.get(placement.sectionKey);
        if (!sectionId) {
          return null;
        }

        return {
          organizationId,
          sectionId,
          productId,
          displayOrder: placement.displayOrder ?? index,
          isPinned: Boolean(placement.isPinned),
          startsAt: placement.startsAt ? new Date(placement.startsAt) : null,
          endsAt: placement.endsAt ? new Date(placement.endsAt) : null,
          titleOverride: placement.titleOverride ?? null,
          subtitleOverride: placement.subtitleOverride ?? null,
          mediaOverrideId: placement.mediaOverrideId ?? null
        };
      })
      .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement))
  });
};

export const storefrontController = {
  getPublicConfig: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { tradingName: true, phone: true, email: true, currencyCode: true, timezone: true }
    });

    if (!organization) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Organization not found", StatusCodes.NOT_FOUND);
    }

    const settings = await prisma.organizationSetting.findUnique({
      where: { organizationId }
    });

    return sendSuccess(res, "Storefront config fetched successfully", {
      tradingName: organization.tradingName,
      phone: organization.phone || "+254799517888",
      email: organization.email,
      currencyCode: organization.currencyCode,
      timezone: organization.timezone,
      cashOnDeliveryEnabled: settings?.cashOnDeliveryEnabled ?? false,
      cashOnDeliveryMaximumOrderAmount: settings?.cashOnDeliveryMaximumOrderAmount
        ? Number(settings.cashOnDeliveryMaximumOrderAmount)
        : null,
      cashOnDeliveryAllowedZoneIds: settings?.cashOnDeliveryAllowedZoneIds ?? []
    });
  },

  listPublicProducts: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);

    const query = parseCatalogQuery(req);
    const data = await getPublicProducts(organizationId, query);
    return sendSuccess(res, "Products fetched successfully", data);
  },

  getPublicProductBySlug: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);
    const slug = req.params.slug ?? "";

    const now = new Date();
    const product = await prisma.product.findFirst({
      where: {
        organizationId,
        isActive: true,
        approvalStatus: "APPROVED",
        storefrontProfile: {
          is: {
            ...buildPublicationWindowFilter(now),
            slug
          }
        }
      },
      include: productPublicInclude
    });

    if (!product) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found", StatusCodes.NOT_FOUND);
    }

    const onlinePriceMap = await getOnlinePriceItems(
      organizationId,
      product.variants.map((variant) => variant.id)
    );
    const serialized = serializePublicProduct(product, onlinePriceMap);

    if (!serialized) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found", StatusCodes.NOT_FOUND);
    }

    const related = await getPublicProducts(
      organizationId,
      {
        page: 1,
        limit: 4,
        category: product.category?.slug ?? undefined,
        sort: "latest"
      },
      undefined
    );

    return sendSuccess(res, "Product fetched successfully", {
      product: serialized,
      relatedProducts: related.items.filter((entry) => entry.id !== serialized.id).slice(0, 4)
    });
  },

  getPublicHome: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);

    const sections = await prisma.storefrontSection.findMany({
      where: {
        organizationId,
        page: "HOME",
        isActive: true
      },
      include: {
        contentCards: {
          where: { isActive: true },
          orderBy: [{ displayOrder: "asc" }]
        }
      },
      orderBy: [{ displayOrder: "asc" }]
    });

    const composition = await Promise.all(
      sections.map(async (section) => ({
        key: section.key,
        title: section.title,
        subtitle: section.subtitle,
        description: section.description,
        imageUrl: resolvePublicMediaUrl(section.imageUrl),
        ctaLabel: section.ctaLabel,
        ctaHref: section.ctaHref,
        layoutType: section.layoutType,
        settings: section.settings,
        contentCards: section.contentCards.map((card) => ({
          id: card.id,
          title: card.title,
          subtitle: card.subtitle,
          description: card.description,
          eyebrow: card.eyebrow,
          imageUrl: resolvePublicMediaUrl(card.imageUrl),
          destinationType: card.destinationType,
          destinationValue: card.destinationValue,
          ctaLabel: card.ctaLabel,
          displayOrder: card.displayOrder,
          settings: card.settings
        })),
        products:
          section.sourceType === StorefrontSectionSourceType.CONTENT_ONLY
            ? []
            : await resolveSectionProducts(organizationId, section)
      }))
    );

    return sendSuccess(res, "Homepage composition fetched successfully", {
      sections: composition
    });
  },

  resolvePublicRoute: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);

    const slug = (req.params.slug ?? "").toLowerCase();
    const query = parseCatalogQuery(req);

    const collection = await prisma.storefrontCollection.findFirst({
      where: {
        organizationId,
        slug,
        isPublished: true
      }
    });

    if (collection) {
      const items = await resolveCollectionProducts(organizationId, collection, query);
      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / query.limit));
      const offset = (query.page - 1) * query.limit;
      return sendSuccess(res, "Route resolved successfully", {
        slug,
        surfaceType: "COLLECTION",
        title: collection.name,
        description: collection.description,
        items: items.slice(offset, offset + query.limit),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
          hasPreviousPage: query.page > 1
        }
      });
    }

    const category = await prisma.productCategory.findFirst({
      where: {
        organizationId,
        slug,
        status: "ACTIVE"
      }
    });

    if (category) {
      const data = await getPublicProducts(organizationId, {
        ...query,
        category: slug
      });

      return sendSuccess(res, "Route resolved successfully", {
        slug,
        surfaceType: "CATEGORY",
        title: category.name,
        description: category.description,
        items: data.items,
        pagination: data.pagination
      });
    }

    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Route not found", StatusCodes.NOT_FOUND);
  },

  listPublicCollections: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);

    const collections = await prisma.storefrontCollection.findMany({
      where: {
        organizationId,
        isPublished: true
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });

    return sendSuccess(res, "Collections fetched successfully", collections);
  },

  getPublicCollectionBySlug: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    await ensureStorefrontDefaults(organizationId);

    const collection = await prisma.storefrontCollection.findFirst({
      where: {
        organizationId,
        slug: req.params.slug,
        isPublished: true
      }
    });

    if (!collection) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Collection not found", StatusCodes.NOT_FOUND);
    }

    const query = parseCatalogQuery(req);
    const items = await resolveCollectionProducts(organizationId, collection, query);
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const offset = (query.page - 1) * query.limit;

    return sendSuccess(res, "Collection fetched successfully", {
      collection,
      items: items.slice(offset, offset + query.limit),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1
      }
    });
  },

  listPublicBrands: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    const now = new Date();

    const brands = await prisma.brand.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        products: {
          some: {
            isActive: true,
            approvalStatus: "APPROVED",
            storefrontProfile: {
              is: buildPublicationWindowFilter(now)
            }
          }
        }
      },
      select: { id: true, name: true, logoUrl: true },
      orderBy: { name: "asc" }
    });

    return sendSuccess(
      res,
      "Brands fetched successfully",
      brands.map((brand) => ({
        ...brand,
        logoUrl: resolvePublicMediaUrl(brand.logoUrl)
      }))
    );
  },

  listPublicCategories: async (req: Request, res: Response) => {
    const organizationId = await getOrganizationId(req);
    const categories = await prisma.productCategory.findMany({
      where: {
        organizationId,
        status: "ACTIVE"
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });

    return sendSuccess(res, "Categories fetched successfully", categories);
  },

  listAdminProducts: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    await ensureStorefrontDefaults(organizationId, req.auth!.userId);

    const products = await prisma.product.findMany({
      where: { organizationId, isActive: true },
      include: {
        brand: true,
        category: true,
        storefrontProfile: true,
        media: true,
        variants: {
          include: {
            storefrontProfile: true
          }
        },
        collectionItems: true,
        sectionPlacements: true
      },
      orderBy: [{ createdAt: "desc" }]
    });

    const onlinePriceMap = await getConfiguredOnlinePriceItems(
      organizationId,
      products.flatMap((product) => product.variants.map((variant) => variant.id))
    );

    return sendSuccess(
      res,
      "Admin products catalog fetched successfully",
      products.map((product) => ({
        ...product,
        media: product.media.map((media) => normalizeMediaRecord(media)),
        onlineVariantCount: product.variants.filter((variant) => variant.storefrontProfile?.isPublishedOnline).length,
        onlinePriceCount: product.variants.filter((variant) => onlinePriceMap.has(variant.id)).length
      }))
    );
  },

  getStorefrontProfile: async (req: Request, res: Response) => {
    const productId = req.params.productId;
    if (!productId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product ID is required", StatusCodes.BAD_REQUEST);
    }

    const payload = await getAdminStorefrontProfilePayload(req.auth!.organizationId, productId);
    return sendSuccess(res, "Storefront profile fetched successfully", payload);
  },

  updateStorefrontProfile: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const productId = req.params.productId;
    const body = req.body;

    if (!productId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product ID is required", StatusCodes.BAD_REQUEST);
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId }
    });

    if (!product) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found", StatusCodes.NOT_FOUND);
    }

    await ensureStorefrontDefaults(organizationId, userId);

    const normalizedSlug = slugify(body.slug || product.slug);

    await prisma.productStorefrontProfile.upsert({
      where: { productId },
      update: {
        websiteTitle: body.websiteTitle || product.name,
        slug: normalizedSlug,
        shortDescription: body.shortDescription,
        longDescription: body.longDescription,
        seoTitle: body.seoTitle,
        seoDescription: body.seoDescription,
        searchKeywords: body.searchKeywords ?? [],
        isPublished: body.isPublished,
        publishFrom: body.publishFrom ? new Date(body.publishFrom) : null,
        publishUntil: body.publishUntil ? new Date(body.publishUntil) : null,
        publishedAt: body.isPublished ? new Date() : null,
        isFeatured: body.isFeatured ?? false,
        isNewArrival: body.isNewArrival ?? false,
        isBestSeller: body.isBestSeller ?? false,
        displayOrder: body.displayOrder ?? 0,
        updatedById: userId
      },
      create: {
        organizationId,
        productId,
        websiteTitle: body.websiteTitle || product.name,
        slug: normalizedSlug,
        shortDescription: body.shortDescription,
        longDescription: body.longDescription,
        seoTitle: body.seoTitle,
        seoDescription: body.seoDescription,
        searchKeywords: body.searchKeywords ?? [],
        isPublished: body.isPublished ?? false,
        publishFrom: body.publishFrom ? new Date(body.publishFrom) : null,
        publishUntil: body.publishUntil ? new Date(body.publishUntil) : null,
        publishedAt: body.isPublished ? new Date() : null,
        isFeatured: body.isFeatured ?? false,
        isNewArrival: body.isNewArrival ?? false,
        isBestSeller: body.isBestSeller ?? false,
        displayOrder: body.displayOrder ?? 0,
        createdById: userId,
        updatedById: userId
      }
    });

    if (Array.isArray(body.variants)) {
      const onlinePriceList = await ensureOnlineRetailPriceList(organizationId);

      for (const [index, variant] of body.variants.entries()) {
        await prisma.productVariantStorefrontProfile.upsert({
          where: { productVariantId: variant.variantId },
          update: {
            isPublishedOnline: variant.isPublishedOnline ?? false,
            isDefaultWebsiteVariant: variant.isDefaultWebsiteVariant ?? index === 0,
            compareAtPrice: variant.compareAtPrice ?? null,
            maximumOnlineQuantity: variant.maximumOnlineQuantity ?? null,
            allowBackorder: variant.allowBackorder ?? false,
            lowStockThreshold: variant.lowStockThreshold ?? null,
            websiteLabel: variant.websiteLabel ?? null,
            displayOrder: variant.displayOrder ?? index
          },
          create: {
            organizationId,
            productVariantId: variant.variantId,
            isPublishedOnline: variant.isPublishedOnline ?? false,
            isDefaultWebsiteVariant: variant.isDefaultWebsiteVariant ?? index === 0,
            compareAtPrice: variant.compareAtPrice ?? null,
            maximumOnlineQuantity: variant.maximumOnlineQuantity ?? null,
            allowBackorder: variant.allowBackorder ?? false,
            lowStockThreshold: variant.lowStockThreshold ?? null,
            websiteLabel: variant.websiteLabel ?? null,
            displayOrder: variant.displayOrder ?? index
          }
        });

        if (variant.onlinePrice !== undefined && variant.onlinePrice !== null && variant.onlinePrice !== "") {
          await prisma.priceListItem.upsert({
            where: {
              priceListId_productVariantId_minimumQuantity: {
                priceListId: onlinePriceList.id,
                productVariantId: variant.variantId,
                minimumQuantity: 1
              }
            },
            update: {
              unitPrice: Number(variant.onlinePrice),
              validFrom: body.publishFrom ? new Date(body.publishFrom) : null,
              validUntil: body.publishUntil ? new Date(body.publishUntil) : null
            },
            create: {
              priceListId: onlinePriceList.id,
              productVariantId: variant.variantId,
              minimumQuantity: 1,
              unitPrice: Number(variant.onlinePrice),
              validFrom: body.publishFrom ? new Date(body.publishFrom) : null,
              validUntil: body.publishUntil ? new Date(body.publishUntil) : null
            }
          });
        } else {
          await prisma.priceListItem.deleteMany({
            where: {
              priceListId: onlinePriceList.id,
              productVariantId: variant.variantId,
              minimumQuantity: 1
            }
          });
        }
      }
    }

    if (Array.isArray(body.collectionAssignments)) {
      await syncCollectionAssignments(organizationId, productId, body.collectionAssignments);
    }

    if (Array.isArray(body.sectionPlacements)) {
      await syncSectionPlacements(organizationId, productId, body.sectionPlacements);
    }

    const payload = await getAdminStorefrontProfilePayload(organizationId, productId);
    return sendSuccess(res, "Storefront profile updated successfully", payload);
  },

  uploadProductMedia: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const productId = req.params.productId;

    if (!productId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product ID is required", StatusCodes.BAD_REQUEST);
    }

    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No file was uploaded", StatusCodes.BAD_REQUEST);
    }

    const media = await storefrontMediaService.uploadProductMedia({
      organizationId,
      userId,
      productId,
      file: req.file,
      productVariantId: req.body.productVariantId || null,
      altText: req.body.altText || null,
      title: req.body.title || null,
      displayOrder: Number(req.body.displayOrder ?? 0),
      isPrimary: req.body.isPrimary === "true",
      isPublished: req.body.isPublished !== "false"
    });

    return sendSuccess(res, "Product media uploaded successfully", media);
  },

  updateProductMedia: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const mediaId = req.params.mediaId;

    if (!mediaId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Media ID is required", StatusCodes.BAD_REQUEST);
    }

    const updated = await storefrontMediaService.updateProductMedia({
      organizationId,
      mediaId,
      altText: req.body.altText ?? null,
      title: req.body.title ?? null,
      displayOrder: req.body.displayOrder,
      isPrimary: req.body.isPrimary,
      isPublished: req.body.isPublished
    });

    return sendSuccess(res, "Product media updated successfully", updated);
  },

  replaceProductMedia: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const mediaId = req.params.mediaId;

    if (!mediaId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Media ID is required", StatusCodes.BAD_REQUEST);
    }

    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No file was uploaded", StatusCodes.BAD_REQUEST);
    }

    const updated = await storefrontMediaService.replaceProductMedia({
      organizationId,
      userId,
      productId: req.body.productId || "",
      mediaId,
      file: req.file,
      productVariantId: req.body.productVariantId || null,
      altText: req.body.altText || null,
      title: req.body.title || null,
      displayOrder: req.body.displayOrder === undefined ? undefined : Number(req.body.displayOrder),
      isPrimary: req.body.isPrimary === undefined ? undefined : req.body.isPrimary === "true",
      isPublished: req.body.isPublished === undefined ? undefined : req.body.isPublished !== "false"
    });

    return sendSuccess(res, "Product media replaced successfully", updated);
  },

  deleteProductMedia: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const mediaId = req.params.mediaId;

    if (!mediaId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Media ID is required", StatusCodes.BAD_REQUEST);
    }

    await storefrontMediaService.deleteProductMedia(organizationId, mediaId);

    return sendSuccess(res, "Product media deleted successfully", { id: mediaId });
  },

  listAdminCollections: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    await ensureStorefrontDefaults(organizationId, req.auth!.userId);

    const collections = await prisma.storefrontCollection.findMany({
      where: { organizationId },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, slug: true }
            }
          },
          orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
        }
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });

    return sendSuccess(res, "Collections fetched successfully", collections);
  },

  getAdminCollection: async (req: Request, res: Response) => {
    const collectionId = req.params.collectionId;
    if (!collectionId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Collection ID is required", StatusCodes.BAD_REQUEST);
    }

    const collection = await prisma.storefrontCollection.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        id: collectionId
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                storefrontProfile: true,
                brand: true,
                category: true
              }
            }
          },
          orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
        }
      }
    });

    if (!collection) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Collection not found", StatusCodes.NOT_FOUND);
    }

    return sendSuccess(res, "Collection fetched successfully", collection);
  },

  createCollection: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const body = req.body;

    const collection = await prisma.storefrontCollection.create({
      data: {
        organizationId,
        name: body.name,
        slug: slugify(body.slug || body.name),
        description: body.description,
        shortDescription: body.shortDescription,
        imageUrl: body.imageUrl,
        type: body.type,
        isPublished: body.isPublished ?? false,
        displayOrder: body.displayOrder ?? 0,
        ruleConfig: body.ruleConfig ?? null,
        publishedAt: body.isPublished ? new Date() : null,
        createdById: userId,
        updatedById: userId
      }
    });

    if (Array.isArray(body.items) && body.items.length > 0) {
      await prisma.storefrontCollectionItem.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: body.items.map((item: any, index: number) => ({
          collectionId: collection.id,
          productId: item.productId,
          displayOrder: item.displayOrder ?? index,
          isPinned: Boolean(item.isPinned),
          startsAt: item.startsAt ? new Date(item.startsAt) : null,
          endsAt: item.endsAt ? new Date(item.endsAt) : null
        }))
      });
    }

    const payload = await prisma.storefrontCollection.findUnique({
      where: { id: collection.id },
      include: {
        items: true
      }
    });

    return sendSuccess(res, "Collection created successfully", payload);
  },

  updateCollection: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const collectionId = req.params.collectionId;

    if (!collectionId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Collection ID is required", StatusCodes.BAD_REQUEST);
    }

    const existing = await prisma.storefrontCollection.findFirst({
      where: { id: collectionId, organizationId }
    });

    if (!existing) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Collection not found", StatusCodes.NOT_FOUND);
    }

    const body = req.body;

    const updated = await prisma.storefrontCollection.update({
      where: { id: collectionId },
      data: {
        name: body.name ?? existing.name,
        slug: body.slug ? slugify(body.slug) : existing.slug,
        description: body.description ?? existing.description,
        shortDescription: body.shortDescription ?? existing.shortDescription,
        imageUrl: body.imageUrl ?? existing.imageUrl,
        type: body.type ?? existing.type,
        isPublished: body.isPublished ?? existing.isPublished,
        displayOrder: body.displayOrder ?? existing.displayOrder,
        ruleConfig: body.ruleConfig ?? existing.ruleConfig,
        publishedAt: body.isPublished === true && !existing.publishedAt ? new Date() : existing.publishedAt,
        updatedById: userId
      }
    });

    if (Array.isArray(body.items)) {
      await prisma.storefrontCollectionItem.deleteMany({
        where: { collectionId }
      });

      if (body.items.length > 0) {
        await prisma.storefrontCollectionItem.createMany({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: body.items.map((item: any, index: number) => ({
            collectionId,
            productId: item.productId,
            displayOrder: item.displayOrder ?? index,
            isPinned: Boolean(item.isPinned),
            startsAt: item.startsAt ? new Date(item.startsAt) : null,
            endsAt: item.endsAt ? new Date(item.endsAt) : null
          }))
        });
      }
    }

    return sendSuccess(res, "Collection updated successfully", updated);
  },

  deleteCollection: async (req: Request, res: Response) => {
    const collectionId = req.params.collectionId;
    if (!collectionId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Collection ID is required", StatusCodes.BAD_REQUEST);
    }

    const collection = await prisma.storefrontCollection.findFirst({
      where: {
        id: collectionId,
        organizationId: req.auth!.organizationId
      }
    });

    if (!collection) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Collection not found", StatusCodes.NOT_FOUND);
    }

    await prisma.storefrontCollection.delete({
      where: { id: collection.id }
    });

    return sendSuccess(res, "Collection deleted successfully", { id: collection.id });
  },

  listAdminSections: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    await ensureStorefrontDefaults(organizationId, req.auth!.userId);

    const sections = await prisma.storefrontSection.findMany({
      where: { organizationId },
      include: {
        contentCards: {
          orderBy: [{ displayOrder: "asc" }]
        },
        placements: {
          include: {
            product: {
              select: { id: true, name: true, slug: true }
            }
          },
          orderBy: [{ isPinned: "desc" }, { displayOrder: "asc" }]
        }
      },
      orderBy: [{ page: "asc" }, { displayOrder: "asc" }]
    });

    return sendSuccess(res, "Sections fetched successfully", sections);
  },

  updateSection: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    const sectionKey = req.params.sectionKey;
    if (!sectionKey) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Section key is required", StatusCodes.BAD_REQUEST);
    }

    const section = await prisma.storefrontSection.findFirst({
      where: {
        organizationId,
        key: sectionKey
      }
    });

    if (!section) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Section not found", StatusCodes.NOT_FOUND);
    }

    const updated = await prisma.storefrontSection.update({
      where: { id: section.id },
      data: {
        title: req.body.title ?? section.title,
        subtitle: req.body.subtitle ?? section.subtitle,
        description: req.body.description ?? section.description,
        imageUrl: req.body.imageUrl ?? section.imageUrl,
        ctaLabel: req.body.ctaLabel ?? section.ctaLabel,
        ctaHref: req.body.ctaHref ?? section.ctaHref,
        isActive: req.body.isActive ?? section.isActive,
        maxItems: req.body.maxItems ?? section.maxItems,
        displayOrder: req.body.displayOrder ?? section.displayOrder,
        settings: req.body.settings ?? section.settings,
        updatedById: userId
      }
    });

    return sendSuccess(res, "Section updated successfully", updated);
  },

  replaceSectionPlacements: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const sectionKey = req.params.sectionKey;
    if (!sectionKey) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Section key is required", StatusCodes.BAD_REQUEST);
    }

    const section = await prisma.storefrontSection.findFirst({
      where: {
        organizationId,
        key: sectionKey
      }
    });

    if (!section) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Section not found", StatusCodes.NOT_FOUND);
    }

    await prisma.storefrontSectionPlacement.deleteMany({
      where: { sectionId: section.id }
    });

    const placements = Array.isArray(req.body.placements) ? req.body.placements : [];

    if (placements.length > 0) {
      await prisma.storefrontSectionPlacement.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: placements.map((placement: any, index: number) => ({
          organizationId,
          sectionId: section.id,
          productId: placement.productId,
          displayOrder: placement.displayOrder ?? index,
          isPinned: Boolean(placement.isPinned),
          startsAt: placement.startsAt ? new Date(placement.startsAt) : null,
          endsAt: placement.endsAt ? new Date(placement.endsAt) : null,
          titleOverride: placement.titleOverride ?? null,
          subtitleOverride: placement.subtitleOverride ?? null,
          mediaOverrideId: placement.mediaOverrideId ?? null
        }))
      });
    }

    return sendSuccess(res, "Section placements replaced successfully", { key: section.key });
  },

  replaceSectionContentCards: async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const sectionKey = req.params.sectionKey;
    if (!sectionKey) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Section key is required", StatusCodes.BAD_REQUEST);
    }

    const section = await prisma.storefrontSection.findFirst({
      where: {
        organizationId,
        key: sectionKey
      }
    });

    if (!section) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Section not found", StatusCodes.NOT_FOUND);
    }

    const cards = Array.isArray(req.body.cards) ? req.body.cards : [];

    await prisma.storefrontContentCard.deleteMany({
      where: { sectionId: section.id }
    });

    if (cards.length > 0) {
      await prisma.storefrontContentCard.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: cards.map((card: any, index: number) => ({
          organizationId,
          sectionId: section.id,
          title: card.title,
          subtitle: card.subtitle ?? null,
          description: card.description ?? null,
          eyebrow: card.eyebrow ?? null,
          imageUrl: card.imageUrl ?? null,
          destinationType: (card.destinationType ?? StorefrontDestinationType.NONE) as StorefrontDestinationType,
          destinationValue: card.destinationValue ?? null,
          ctaLabel: card.ctaLabel ?? null,
          displayOrder: card.displayOrder ?? index,
          isActive: card.isActive ?? true,
          startsAt: card.startsAt ? new Date(card.startsAt) : null,
          endsAt: card.endsAt ? new Date(card.endsAt) : null,
          settings: card.settings ?? null
        }))
      });
    }

    return sendSuccess(res, "Section content cards replaced successfully", { key: section.key });
  }
};
