import {
  ConcentrationType,
  FragranceFamily,
  GenderTarget,
  PackagingType,
  PriceListStatus,
  PriceListType,
  ProductCategoryStatus,
  ProductType,
  ProductVariantStatus,
  VolumeUnit
} from "@prisma/client";
import { z } from "zod";
import { mediaUrlSchema, nullableMediaUrlSchema } from "../../utils/media-url-schema.js";

export const idParamSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  })
});

export const variantIdParamSchema = z.object({
  params: z.object({
    variantId: z.string().cuid()
  })
});

export const barcodeParamSchema = z.object({
  params: z.object({
    barcode: z.string().min(4)
  })
});

export const productSubmissionIdParamSchema = z.object({
  params: z.object({
    submissionId: z.string().cuid()
  })
});

export const branchProductParamSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
    branchId: z.string().cuid()
  })
});

export const createBrandSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    logoUrl: mediaUrlSchema.optional(),
    countryOfOrigin: z.string().optional()
  })
});

export const updateBrandSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    name: z.string().min(2).optional(),
    description: z.string().optional().nullable(),
    logoUrl: nullableMediaUrlSchema,
    countryOfOrigin: z.string().optional().nullable(),
    status: z.nativeEnum(ProductCategoryStatus).optional()
  })
});

const attributeDefinitionSchema = z.object({
  id: z.string().cuid().optional(),
  label: z.string().min(1),
  key: z.string().min(1),
  dataType: z.enum(["TEXT", "NUMBER", "DECIMAL", "DROPDOWN", "MULTI_SELECT", "BOOLEAN", "DATE", "MEASUREMENT", "LONG_TEXT"]),
  isRequired: z.boolean().default(false),
  dropdownOptions: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true)
});

export const createCategorySchema = z.object({
  body: z.object({
    parentId: z.string().cuid().optional().nullable(),
    name: z.string().min(2),
    description: z.string().optional().nullable(),
    sortOrder: z.number().int().optional(),
    status: z.nativeEnum(ProductCategoryStatus).optional(),
    attributeDefinitions: z.array(attributeDefinitionSchema).optional()
  })
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    parentId: z.string().cuid().optional().nullable(),
    name: z.string().min(2).optional(),
    description: z.string().optional().nullable(),
    sortOrder: z.number().int().optional(),
    status: z.nativeEnum(ProductCategoryStatus).optional(),
    attributeDefinitions: z.array(attributeDefinitionSchema).optional()
  })
});

const variantSchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().min(4).optional().nullable().or(z.literal("")),
  volumeValue: z.coerce.number().positive().optional().nullable(),
  volumeUnit: z.nativeEnum(VolumeUnit).optional().nullable(),
  concentrationType: z.nativeEnum(ConcentrationType).optional().nullable(),
  unitOfMeasure: z.nativeEnum(VolumeUnit).optional().nullable(),
  packagingType: z.nativeEnum(PackagingType).optional().nullable(),
  color: z.string().optional().nullable(),
  batchTrackingEnabled: z.boolean().optional(),
  expiryTrackingEnabled: z.boolean().optional(),
  defaultCost: z.coerce.number().nonnegative().optional(),
  retailPrice: z.coerce.number().nonnegative().optional(),
  wholesalePrice: z.coerce.number().nonnegative().optional(),
  minimumWholesaleQuantity: z.coerce.number().positive().optional(),
  wholesaleMinimumQuantity: z.coerce.number().positive().optional(),
  reorderLevel: z.coerce.number().nonnegative().optional(),
  reorderQuantity: z.coerce.number().positive().optional().nullable(),
  maximumStockLevel: z.coerce.number().positive().optional().nullable(),
  status: z.nativeEnum(ProductVariantStatus).optional()
});

const branchConfigurationSchema = z.object({
  branchIds: z.array(z.string().cuid()).optional(),
  sellInBranch: z.boolean().optional(),
  reorderLevel: z.coerce.number().nonnegative().optional().nullable(),
  minimumStock: z.coerce.number().nonnegative().optional().nullable(),
  maximumStock: z.coerce.number().nonnegative().optional().nullable(),
  shelfLocation: z.string().optional().nullable(),
  branchLabel: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  priceListId: z.string().cuid().optional().nullable(),
  introductionDate: z.string().datetime().optional().nullable()
});

const pricingRequestSchema = z.object({
  proposedRetailPrice: z.coerce.number().nonnegative().optional().nullable(),
  proposedWholesalePrice: z.coerce.number().nonnegative().optional().nullable(),
  preferredRetailPriceRequest: z.coerce.number().nonnegative().optional().nullable(),
  preferredWholesalePriceRequest: z.coerce.number().nonnegative().optional().nullable(),
  justification: z.string().optional().nullable(),
  priceJustification: z.string().optional().nullable(),
  priceListId: z.string().cuid().optional().nullable(),
  existingPriceListId: z.string().cuid().optional().nullable()
});

const inventoryIntroductionSchema = z.object({
  pendingGoodsReceiptId: z.string().cuid().optional().nullable(),
  openingStockRequestNote: z.string().optional().nullable()
});

const productBodySchema = z.object({
  brandId: z.string().cuid().optional().nullable(),
  categoryId: z.string().cuid().optional().nullable(),
  requestedBrandName: z.string().optional().nullable(),
  requestedCategoryName: z.string().optional().nullable(),
  name: z.string().min(2),
  internalDisplayName: z.string().optional().nullable(),
  productType: z.nativeEnum(ProductType).optional().nullable(),
  shortDescription: z.string().optional().nullable(),
  fullDescription: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  fragranceFamily: z.nativeEnum(FragranceFamily).optional().nullable(),
  genderTarget: z.nativeEnum(GenderTarget).optional().nullable(),
  concentrationType: z.nativeEnum(ConcentrationType).optional().nullable(),
  countryOfOrigin: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  imageUrl: mediaUrlSchema.optional().or(z.literal("")).nullable(),
  isStockTracked: z.boolean().optional(),
  trackingMethod: z.string().optional().nullable(),
  batchTrackingEnabled: z.boolean().optional(),
  expiryTrackingEnabled: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  attributes: z.record(z.any()).optional(),
  variants: z.array(variantSchema).min(1),
  branchConfiguration: branchConfigurationSchema.optional(),
  pricingRequest: pricingRequestSchema.optional(),
  inventoryIntroduction: inventoryIntroductionSchema.optional()
});

export const createProductSchema = z.object({
  body: productBodySchema
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: productBodySchema.partial().extend({
    variants: z.array(variantSchema).optional()
  })
});

export const createVariantSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: variantSchema.extend({
    sku: z.string().optional().nullable()
  })
});

export const updateVariantSchema = z.object({
  params: z.object({
    variantId: z.string().cuid()
  }),
  body: variantSchema.partial()
});

export const addVariantBarcodeSchema = z.object({
  params: z.object({
    variantId: z.string().cuid()
  }),
  body: z.object({
    barcode: z.string().min(4)
  })
});

export const submitProductSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  })
});

export const approveProductSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    brandId: z.string().cuid().optional().nullable(),
    categoryId: z.string().cuid().optional().nullable(),
    reviewNote: z.string().optional().nullable(),
    approvedRetailPrice: z.coerce.number().nonnegative().optional().nullable(),
    approvedWholesalePrice: z.coerce.number().nonnegative().optional().nullable(),
    isActive: z.boolean().optional()
  })
});

export const rejectProductSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    reason: z.string().min(3)
  })
});

export const requestCorrectionSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    correctionNote: z.string().min(3),
    requestedChanges: z.string().optional().nullable()
  })
});

export const mergeProductSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    targetProductId: z.string().cuid(),
    reason: z.string().optional().nullable()
  })
});

export const listProductSubmissionsSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    type: z.string().optional()
  })
});

export const branchActivationRequestSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    branchId: z.string().cuid().optional(),
    branchIds: z.array(z.string().cuid()).optional(),
    branchConfiguration: branchConfigurationSchema.optional(),
    pricingRequest: pricingRequestSchema.optional()
  })
});

export const activateBranchProductSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
    branchId: z.string().cuid()
  }),
  body: branchConfigurationSchema.partial().extend({
    approvedRetailPrice: z.coerce.number().nonnegative().optional().nullable(),
    approvedWholesalePrice: z.coerce.number().nonnegative().optional().nullable(),
    reason: z.string().optional().nullable()
  })
});

export const updateBranchProductSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
    branchId: z.string().cuid()
  }),
  body: branchConfigurationSchema.partial()
});

export const createPriceListSchema = z.object({
  body: z.object({
    branchId: z.string().cuid().optional(),
    name: z.string().min(2),
    type: z.nativeEnum(PriceListType),
    currencyCode: z.string().length(3),
    isDefault: z.boolean().optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional()
  })
});

export const updatePriceListSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: createPriceListSchema.shape.body.partial().extend({
    status: z.nativeEnum(PriceListStatus).optional()
  })
});

export const addPriceListItemSchema = z.object({
  params: z.object({
    id: z.string().cuid()
  }),
  body: z.object({
    productVariantId: z.string().cuid(),
    minimumQuantity: z.coerce.number().positive().optional(),
    unitPrice: z.coerce.number().nonnegative(),
    maximumDiscountPercent: z.coerce.number().min(0).max(100).optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional()
  })
});
