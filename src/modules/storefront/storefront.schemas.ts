import {
  StorefrontCollectionType,
  StorefrontDestinationType
} from "@prisma/client";
import { z } from "zod";

const nullableDateTime = z.string().datetime().optional().nullable().or(z.literal(""));

const collectionAssignmentSchema = z.object({
  collectionId: z.string().cuid(),
  displayOrder: z.coerce.number().int().optional(),
  isPinned: z.boolean().optional(),
  startsAt: nullableDateTime,
  endsAt: nullableDateTime
});

const sectionPlacementSchema = z.object({
  sectionKey: z.string().min(1),
  displayOrder: z.coerce.number().int().optional(),
  isPinned: z.boolean().optional(),
  startsAt: nullableDateTime,
  endsAt: nullableDateTime,
  titleOverride: z.string().optional().nullable(),
  subtitleOverride: z.string().optional().nullable(),
  mediaOverrideId: z.string().cuid().optional().nullable().or(z.literal(""))
});

const storefrontVariantSchema = z.object({
  variantId: z.string().cuid(),
  isPublishedOnline: z.boolean().default(false),
  isDefaultWebsiteVariant: z.boolean().default(false),
  compareAtPrice: z.coerce.number().nullable().optional(),
  maximumOnlineQuantity: z.coerce.number().int().positive().nullable().optional(),
  allowBackorder: z.boolean().optional(),
  lowStockThreshold: z.coerce.number().int().nonnegative().nullable().optional(),
  websiteLabel: z.string().nullable().optional(),
  displayOrder: z.coerce.number().int().default(0),
  onlinePrice: z.coerce.number().nonnegative().nullable().optional()
});

export const productIdParamSchema = z.object({
  params: z.object({
    productId: z.string().cuid()
  })
});

export const mediaIdParamSchema = z.object({
  params: z.object({
    mediaId: z.string().cuid()
  })
});

export const collectionIdParamSchema = z.object({
  params: z.object({
    collectionId: z.string().cuid()
  })
});

export const sectionKeyParamSchema = z.object({
  params: z.object({
    sectionKey: z.string().min(1)
  })
});

export const updateStorefrontProfileSchema = z.object({
  params: z.object({
    productId: z.string().cuid()
  }),
  body: z.object({
    websiteTitle: z.string().nullable().optional(),
    slug: z.string().min(1),
    shortDescription: z.string().nullable().optional(),
    longDescription: z.string().nullable().optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    searchKeywords: z.array(z.string()).default([]),
    isPublished: z.boolean().default(false),
    publishFrom: nullableDateTime,
    publishUntil: nullableDateTime,
    isFeatured: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    isBestSeller: z.boolean().default(false),
    displayOrder: z.coerce.number().int().default(0),
    variants: z.array(storefrontVariantSchema).optional(),
    collectionAssignments: z.array(collectionAssignmentSchema).optional(),
    sectionPlacements: z.array(sectionPlacementSchema).optional()
  })
});

export const updateProductMediaSchema = z.object({
  params: z.object({
    mediaId: z.string().cuid()
  }),
  body: z.object({
    altText: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    displayOrder: z.coerce.number().int().optional(),
    isPrimary: z.boolean().optional(),
    isPublished: z.boolean().optional()
  })
});

const collectionItemSchema = z.object({
  productId: z.string().cuid(),
  displayOrder: z.coerce.number().int().optional(),
  isPinned: z.boolean().optional(),
  startsAt: nullableDateTime,
  endsAt: nullableDateTime
});

export const createCollectionSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().nullable().optional(),
    shortDescription: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    type: z.nativeEnum(StorefrontCollectionType),
    isPublished: z.boolean().default(false),
    displayOrder: z.coerce.number().int().default(0),
    ruleConfig: z.record(z.any()).optional(),
    items: z.array(collectionItemSchema).optional()
  })
});

export const updateCollectionSchema = z.object({
  params: z.object({
    collectionId: z.string().cuid()
  }),
  body: createCollectionSchema.shape.body.partial().extend({
    items: z.array(collectionItemSchema).optional()
  })
});

export const replaceSectionPlacementsSchema = z.object({
  params: z.object({
    sectionKey: z.string().min(1)
  }),
  body: z.object({
    placements: z.array(
      z.object({
        productId: z.string().cuid(),
        displayOrder: z.coerce.number().int().optional(),
        isPinned: z.boolean().optional(),
        startsAt: nullableDateTime,
        endsAt: nullableDateTime,
        titleOverride: z.string().optional().nullable(),
        subtitleOverride: z.string().optional().nullable(),
        mediaOverrideId: z.string().cuid().optional().nullable().or(z.literal(""))
      })
    )
  })
});

export const replaceSectionContentCardsSchema = z.object({
  params: z.object({
    sectionKey: z.string().min(1)
  }),
  body: z.object({
    cards: z.array(
      z.object({
        title: z.string().min(1),
        subtitle: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        eyebrow: z.string().optional().nullable(),
        imageUrl: z.string().optional().nullable(),
        destinationType: z.nativeEnum(StorefrontDestinationType).optional(),
        destinationValue: z.string().optional().nullable(),
        ctaLabel: z.string().optional().nullable(),
        displayOrder: z.coerce.number().int().optional(),
        isActive: z.boolean().optional(),
        startsAt: nullableDateTime,
        endsAt: nullableDateTime,
        settings: z.record(z.any()).optional().nullable()
      })
    )
  })
});

export const updateSectionSchema = z.object({
  params: z.object({
    sectionKey: z.string().min(1)
  }),
  body: z.object({
    title: z.string().optional().nullable(),
    subtitle: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    imageUrl: z.string().optional().nullable(),
    ctaLabel: z.string().optional().nullable(),
    ctaHref: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    maxItems: z.coerce.number().int().nonnegative().optional(),
    displayOrder: z.coerce.number().int().optional(),
    settings: z.record(z.any()).optional().nullable()
  })
});
