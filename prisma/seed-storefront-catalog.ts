import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PriceListStatus,
  PriceListType,
  ProductMediaType,
  StorefrontDestinationType,
  StorefrontSectionSourceType
} from "@prisma/client";
import type { ProductMedia, StorefrontCollectionType } from "@prisma/client";

import { prisma } from "../src/lib/prisma.js";
import { inventoryWriteService } from "../src/services/inventory-write.service.js";
import { getStorageProvider } from "../src/services/storage.service.js";
import { ensureStorefrontDefaults } from "../src/modules/storefront/storefront.defaults.js";
import {
  STOREFRONT_SEED_BRANCH_CODE,
  STOREFRONT_SEED_GM_EMAIL,
  STOREFRONT_SEED_ORGANIZATION_ID,
  brands,
  categories,
  collections,
  contentCards,
  homepagePlacements,
  products,
  type StorefrontSeedProduct
} from "./seed-data/storefront/catalog.js";

const SEED_MARKER = "storefront-catalog-seed:v1";
const MEDIA_DIR = path.resolve("prisma/seed-data/storefront/media");
const UPLOAD_DIR = path.resolve("uploads");

const getJpegDimensions = (buffer: Buffer) => {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("Unable to read JPEG dimensions");
};

export const deterministicBarcode = (sku: string) => {
  const digest = createHash("sha256").update(`js-perfumes:${sku}`).digest("hex");
  const body = BigInt(`0x${digest.slice(0, 14)}`).toString().slice(0, 12).padStart(12, "0");
  const weightedTotal = body
    .split("")
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (weightedTotal % 10)) % 10}`;
};

type SeedMediaInput = {
  mediaFile: string;
  mediaSource: string;
  altText: string;
  displayOrder: number;
  isPrimary: boolean;
};

const productMediaInputs = (product: StorefrontSeedProduct): SeedMediaInput[] => [
  {
    mediaFile: product.mediaFile,
    mediaSource: product.mediaSource,
    altText: `${product.name} product image`,
    displayOrder: 0,
    isPrimary: true
  },
  ...(product.galleryMedia ?? []).map((media, index) => ({
    ...media,
    displayOrder: index + 1,
    isPrimary: false
  }))
];

const storeSeedMedia = async (product: StorefrontSeedProduct, mediaInput: SeedMediaInput) => {
  const sourcePath = path.join(MEDIA_DIR, mediaInput.mediaFile);
  const buffer = await fs.readFile(sourcePath);
  const dimensions = getJpegDimensions(buffer);

  if (dimensions.width < 240 || dimensions.height < 240 || buffer.length === 0) {
    throw new Error(`Seed image is below the usable threshold: ${mediaInput.mediaFile}`);
  }

  const suffix = mediaInput.isPrimary ? "" : `-gallery-${mediaInput.displayOrder}`;

  const provider = getStorageProvider();
  if (provider.name === "local") {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const storageKey = `seed-storefront-${product.slug}${suffix}.jpg`;
    await fs.copyFile(sourcePath, path.join(UPLOAD_DIR, storageKey));
    return {
      url: `/uploads/${storageKey}`,
      storageKey,
      storageProvider: "local",
      resourceType: "image",
      format: "jpg",
      bytes: buffer.length,
      ...dimensions
    };
  }

  const stored = await provider.uploadFile({
    file: {
      buffer,
      originalname: mediaInput.mediaFile,
      mimetype: "image/jpeg",
      size: buffer.length
    },
    category: "product-image",
    folderSegments: ["storefront", "products"],
    publicId: `storefront-products-${product.slug}${suffix}`,
    resourceType: "image"
  });

  return {
    url: stored.secureUrl || stored.url,
    storageKey: stored.storageKey,
    storageProvider: stored.storageProvider,
    resourceType: stored.resourceType,
    format: stored.format ?? "jpg",
    bytes: stored.bytes ?? buffer.length,
    width: stored.width ?? dimensions.width,
    height: stored.height ?? dimensions.height
  };
};

const routeCollections = () => {
  const byCategory = (slug: string) => products.filter((product) => product.category === slug).map((product) => product.slug);
  const byGender = (gender: StorefrontSeedProduct["gender"]) => products.filter((product) => product.gender === gender).map((product) => product.slug);
  const requiredCollection = (slug: string) => collections.find((collection) => collection.slug === slug)?.products ?? [];
  const freshAndAquatic = products
    .filter((product) => /coastal|ocean|fresh|citrus|neroli|green|eucalyptus|mint|water|bamboo|rain|pine|linen/i.test(product.name))
    .slice(0, 20)
    .map((product) => product.slug);

  return [
    { slug: "perfumes", name: "Perfumes", type: "CATEGORY", products: byCategory("perfumes") },
    { slug: "men", name: "Men", type: "MEN", products: byGender("MEN") },
    { slug: "women", name: "Women", type: "WOMEN", products: byGender("WOMEN") },
    { slug: "unisex", name: "Unisex", type: "MANUAL", products: byGender("UNISEX") },
    { slug: "ouds", name: "Ouds", type: "OUD", products: byCategory("ouds") },
    { slug: "bakhoors", name: "Bakhoor", type: "BAKHOOR", products: byCategory("bakhoor") },
    { slug: "bukhoors", name: "Bakhoor", type: "BAKHOOR", products: byCategory("bakhoor") },
    { slug: "incense-burners", name: "Burners", type: "MANUAL", products: byCategory("burners") },
    { slug: "perfume-oils", name: "Perfume Oils and Attars", type: "MANUAL", products: byCategory("perfume-oils") },
    { slug: "air-fresheners", name: "Air Fresheners", type: "MANUAL", products: byCategory("air-fresheners") },
    { slug: "room-sprays", name: "Room Sprays", type: "MANUAL", products: byCategory("room-sprays") },
    { slug: "linen-sprays", name: "Linen Sprays", type: "MANUAL", products: byCategory("linen-sprays") },
    { slug: "car-fragrances", name: "Car Fragrances", type: "MANUAL", products: byCategory("car-fragrances") },
    { slug: "creams", name: "Creams and Lotions", type: "MANUAL", products: byCategory("creams") },
    { slug: "home-fragrance", name: "Home Scents", type: "MANUAL", products: [...byCategory("home-scents"), ...byCategory("air-fresheners"), ...byCategory("room-sprays"), ...byCategory("linen-sprays")] },
    { slug: "gift-sets", name: "Gift Sets", type: "MANUAL", products: byCategory("gift-sets") },
    { slug: "gift-vouchers", name: "Gift Vouchers", type: "MANUAL", products: byCategory("gift-vouchers") },
    { slug: "niche", name: "Niche Fragrances", type: "NICHE", products: requiredCollection("niche-fragrances") },
    { slug: "luxury-gifting", name: "Luxury Gifting", type: "MANUAL", products: [...byCategory("gift-sets"), ...byCategory("gift-vouchers")] },
    { slug: "aqua", name: "Fresh and Aquatic", type: "MANUAL", products: freshAndAquatic }
  ];
};

export const seedStorefrontCatalog = async () => {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_STOREFRONT_CATALOG_SEED !== "true") {
    throw new Error("Production catalog seeding requires ALLOW_STOREFRONT_CATALOG_SEED=true.");
  }

  const [organization, generalManager, branch] = await Promise.all([
    prisma.organization.findUnique({ where: { id: STOREFRONT_SEED_ORGANIZATION_ID } }),
    prisma.user.findFirst({ where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, email: STOREFRONT_SEED_GM_EMAIL, role: "GENERAL_MANAGER", status: "ACTIVE" } }),
    prisma.branch.findFirst({ where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, code: STOREFRONT_SEED_BRANCH_CODE, status: "ACTIVE" } })
  ]);

  if (!organization || !generalManager || !branch) {
    throw new Error("Base organization, active General Manager, or NBI-CBD branch is missing. Run npm run prisma:seed first.");
  }

  await ensureStorefrontDefaults(organization.id, generalManager.id);

  const verificationProducts = await prisma.product.findMany({
    where: { organizationId: organization.id, name: { startsWith: "Verification " } },
    select: { id: true }
  });
  const verificationProductIds = verificationProducts.map((product) => product.id);

  await prisma.productStorefrontProfile.updateMany({
    where: {
      organizationId: organization.id,
      isPublished: true,
      product: { name: { startsWith: "Verification " } }
    },
    data: { isPublished: false, publishedAt: null, updatedById: generalManager.id }
  });
  if (verificationProductIds.length > 0) {
    await prisma.storefrontCollectionItem.deleteMany({ where: { productId: { in: verificationProductIds } } });
    await prisma.storefrontSectionPlacement.deleteMany({ where: { organizationId: organization.id, productId: { in: verificationProductIds } } });
  }

  const categoryBySlug = new Map<string, string>();
  for (const [name, slug, description] of categories) {
    const category = await prisma.productCategory.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug } },
      update: { name, description, status: "ACTIVE", updatedById: generalManager.id },
      create: { organizationId: organization.id, name, slug, description, status: "ACTIVE", normalizedName: name.toLowerCase(), createdById: generalManager.id, updatedById: generalManager.id }
    });
    categoryBySlug.set(slug, category.id);
  }

  const fragranceAttributeByCategory = new Map<string, Map<"top" | "heart" | "base", string>>();
  for (const categorySlug of ["perfumes", "ouds"] as const) {
    const categoryId = categoryBySlug.get(categorySlug);
    if (!categoryId) throw new Error(`Missing fragrance category ${categorySlug}`);
    const definitionIds = new Map<"top" | "heart" | "base", string>();
    for (const [displayOrder, [noteKey, label]] of ([
      ["top", "Top notes"],
      ["heart", "Heart notes"],
      ["base", "Base notes"]
    ] as const).entries()) {
      const definition = await prisma.productAttributeDefinition.upsert({
        where: {
          organizationId_categoryId_key: {
            organizationId: organization.id,
            categoryId,
            key: `${noteKey}Notes`
          }
        },
        update: { label, dataType: "TEXT", isRequired: false, displayOrder, isActive: true },
        create: {
          organizationId: organization.id,
          categoryId,
          key: `${noteKey}Notes`,
          label,
          dataType: "TEXT",
          isRequired: false,
          displayOrder,
          isActive: true
        }
      });
      definitionIds.set(noteKey, definition.id);
    }
    fragranceAttributeByCategory.set(categorySlug, definitionIds);
  }

  const brandByName = new Map<string, string>();
  for (const name of brands) {
    const brand = await prisma.brand.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { status: "ACTIVE", normalizedName: name.toLowerCase() },
      create: { organizationId: organization.id, name, normalizedName: name.toLowerCase(), status: "ACTIVE" }
    });
    brandByName.set(name, brand.id);
  }

  const onlinePriceList = await prisma.priceList.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "Online Retail" } },
    update: { type: PriceListType.ONLINE_RETAIL, currencyCode: "KES", status: PriceListStatus.ACTIVE, branchId: null },
    create: { organizationId: organization.id, name: "Online Retail", type: PriceListType.ONLINE_RETAIL, currencyCode: "KES", status: PriceListStatus.ACTIVE, isDefault: false }
  });

  const productIdBySlug = new Map<string, string>();
  const mediaReport: Array<Record<string, unknown>> = [];
  const publishedAt = new Date("2026-07-16T09:00:00.000Z");

  for (const [displayOrder, seedProduct] of products.entries()) {
    const categoryId = categoryBySlug.get(seedProduct.category);
    const brandId = brandByName.get(seedProduct.brand);
    if (!categoryId || !brandId) throw new Error(`Missing taxonomy for ${seedProduct.slug}`);

    const product = await prisma.product.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: seedProduct.slug } },
      update: {
        brandId, categoryId, name: seedProduct.name, normalizedName: seedProduct.name.toLowerCase(), shortDescription: seedProduct.shortDescription,
        fullDescription: seedProduct.description, description: seedProduct.description, productType: seedProduct.productType,
        fragranceFamily: seedProduct.family, genderTarget: seedProduct.gender, concentrationType: seedProduct.concentration,
        isActive: true, isStockTracked: true, approvalStatus: "APPROVED", approvedById: generalManager.id, approvedAt: publishedAt,
        notes: SEED_MARKER
      },
      create: {
        organizationId: organization.id, brandId, categoryId, name: seedProduct.name, slug: seedProduct.slug,
        normalizedName: seedProduct.name.toLowerCase(), shortDescription: seedProduct.shortDescription, fullDescription: seedProduct.description,
        description: seedProduct.description, productType: seedProduct.productType, fragranceFamily: seedProduct.family,
        genderTarget: seedProduct.gender, concentrationType: seedProduct.concentration, isActive: true, isStockTracked: true,
        approvalStatus: "APPROVED", originatingBranchId: branch.id, createdById: generalManager.id, approvedById: generalManager.id,
        approvedAt: publishedAt, notes: SEED_MARKER
      }
    });
    productIdBySlug.set(seedProduct.slug, product.id);

    const fragranceDefinitions = fragranceAttributeByCategory.get(seedProduct.category);
    if (fragranceDefinitions && seedProduct.fragranceNotes) {
      for (const [noteKey, value] of Object.entries(seedProduct.fragranceNotes) as Array<["top" | "heart" | "base", string]>) {
        const definitionId = fragranceDefinitions.get(noteKey);
        if (!definitionId || !value) continue;
        await prisma.productAttributeValue.upsert({
          where: { productId_definitionId: { productId: product.id, definitionId } },
          update: { value },
          create: { productId: product.id, definitionId, value }
        });
      }
    }

    const barcode = deterministicBarcode(seedProduct.sku);
    const variant = await prisma.productVariant.upsert({
      where: { organizationId_sku: { organizationId: organization.id, sku: seedProduct.sku } },
      update: {
        productId: product.id, name: `${seedProduct.size}${seedProduct.unit.toLowerCase()}`, barcode,
        volumeValue: seedProduct.size, volumeUnit: seedProduct.unit, unitOfMeasure: seedProduct.unit,
        concentrationType: seedProduct.concentration, packagingType: seedProduct.packaging ?? "SEALED", defaultCost: seedProduct.cost,
        retailPrice: seedProduct.price, status: "ACTIVE"
      },
      create: {
        organizationId: organization.id, productId: product.id, name: `${seedProduct.size}${seedProduct.unit.toLowerCase()}`,
        sku: seedProduct.sku, barcode, volumeValue: seedProduct.size, volumeUnit: seedProduct.unit, unitOfMeasure: seedProduct.unit,
        concentrationType: seedProduct.concentration, packagingType: seedProduct.packaging ?? "SEALED", defaultCost: seedProduct.cost,
        retailPrice: seedProduct.price, reorderLevel: 5, reorderQuantity: 12, status: "ACTIVE"
      }
    });

    await prisma.productBarcode.upsert({
      where: { productVariantId_barcode: { productVariantId: variant.id, barcode } },
      update: {},
      create: { productVariantId: variant.id, barcode }
    });

    await prisma.productStorefrontProfile.upsert({
      where: { productId: product.id },
      update: {
        websiteTitle: seedProduct.name, slug: seedProduct.slug, shortDescription: seedProduct.shortDescription,
        longDescription: seedProduct.description, seoTitle: `${seedProduct.name} | JS Perfumes Kenya`,
        seoDescription: `Shop ${seedProduct.name} from JS Perfumes Kenya. Published price, availability and delivery options online.`,
        searchKeywords: seedProduct.keywords, isPublished: true, publishedAt, publishFrom: null, publishUntil: null,
        isFeatured: seedProduct.isBestSeller ?? false, isNewArrival: seedProduct.isNewArrival ?? false,
        isBestSeller: seedProduct.isBestSeller ?? false, displayOrder, updatedById: generalManager.id
      },
      create: {
        organizationId: organization.id, productId: product.id, websiteTitle: seedProduct.name, slug: seedProduct.slug,
        shortDescription: seedProduct.shortDescription, longDescription: seedProduct.description,
        seoTitle: `${seedProduct.name} | JS Perfumes Kenya`, seoDescription: `Shop ${seedProduct.name} from JS Perfumes Kenya. Published price, availability and delivery options online.`,
        searchKeywords: seedProduct.keywords, isPublished: true, publishedAt, isFeatured: seedProduct.isBestSeller ?? false,
        isNewArrival: seedProduct.isNewArrival ?? false, isBestSeller: seedProduct.isBestSeller ?? false,
        displayOrder, createdById: generalManager.id, updatedById: generalManager.id
      }
    });

    await prisma.productVariantStorefrontProfile.upsert({
      where: { productVariantId: variant.id },
      update: {
        isPublishedOnline: true, isDefaultWebsiteVariant: true, compareAtPrice: seedProduct.compareAtPrice,
        maximumOnlineQuantity: Math.min(seedProduct.stock, 10), allowBackorder: false, lowStockThreshold: 5,
        websiteLabel: `${seedProduct.size}${seedProduct.unit === "GRAM" ? "g" : seedProduct.unit === "ML" ? "ml" : seedProduct.unit === "SET" ? " set" : " piece"}`,
        displayOrder: 0
      },
      create: {
        organizationId: organization.id, productVariantId: variant.id, isPublishedOnline: true,
        isDefaultWebsiteVariant: true, compareAtPrice: seedProduct.compareAtPrice, maximumOnlineQuantity: Math.min(seedProduct.stock, 10),
        allowBackorder: false, lowStockThreshold: 5,
        websiteLabel: `${seedProduct.size}${seedProduct.unit === "GRAM" ? "g" : seedProduct.unit === "ML" ? "ml" : seedProduct.unit === "SET" ? " set" : " piece"}`,
        displayOrder: 0
      }
    });

    await prisma.priceListItem.upsert({
      where: { priceListId_productVariantId_minimumQuantity: { priceListId: onlinePriceList.id, productVariantId: variant.id, minimumQuantity: 1 } },
      update: { unitPrice: seedProduct.price, validFrom: publishedAt, validUntil: null },
      create: { priceListId: onlinePriceList.id, productVariantId: variant.id, minimumQuantity: 1, unitPrice: seedProduct.price, validFrom: publishedAt }
    });

    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
      update: { status: "ACTIVE", isActive: true, sellInBranch: true, priceListId: onlinePriceList.id, approvedById: generalManager.id, approvedAt: publishedAt },
      create: { organizationId: organization.id, branchId: branch.id, productId: product.id, priceListId: onlinePriceList.id,
        status: "ACTIVE", isActive: true, sellInBranch: true, requestedById: generalManager.id, requestedAt: publishedAt,
        approvedById: generalManager.id, approvedAt: publishedAt, introductionDate: publishedAt, notes: SEED_MARKER }
    });

    const seededMediaRecords: ProductMedia[] = [];
    const expectedStorageKeys: string[] = [];
    for (const mediaInput of productMediaInputs(seedProduct)) {
      const media = await storeSeedMedia(seedProduct, mediaInput);
      if (media.storageKey) expectedStorageKeys.push(media.storageKey);
      const existingMedia = await prisma.productMedia.findFirst({ where: { organizationId: organization.id, productId: product.id, storageKey: media.storageKey } });
      const mediaRecord = existingMedia
        ? await prisma.productMedia.update({ where: { id: existingMedia.id }, data: {
            ...media, productVariantId: variant.id, type: ProductMediaType.IMAGE, altText: mediaInput.altText,
            title: seedProduct.name, displayOrder: mediaInput.displayOrder, isPrimary: mediaInput.isPrimary,
            isPublished: true, createdById: generalManager.id
          } })
        : await prisma.productMedia.create({ data: {
            organizationId: organization.id, productId: product.id, productVariantId: variant.id, ...media,
            type: ProductMediaType.IMAGE, altText: mediaInput.altText, title: seedProduct.name,
            displayOrder: mediaInput.displayOrder, isPrimary: mediaInput.isPrimary, isPublished: true,
            createdById: generalManager.id
          } });
      seededMediaRecords.push(mediaRecord);
      mediaReport.push({
        product: seedProduct.name, source: mediaInput.mediaSource, sourceFile: mediaInput.mediaFile,
        publicUrl: mediaRecord.url, width: mediaRecord.width, height: mediaRecord.height,
        bytes: mediaRecord.bytes, role: mediaInput.isPrimary ? "PRIMARY" : "GALLERY",
        displayOrder: mediaInput.displayOrder, validation: "PASS"
      });
    }

    await prisma.productMedia.deleteMany({
      where: {
        organizationId: organization.id,
        productId: product.id,
        storageProvider: "local",
        storageKey: { startsWith: `seed-storefront-${seedProduct.slug}`, notIn: expectedStorageKeys }
      }
    });

    const primaryMediaRecord = seededMediaRecords.find((media) => media.isPrimary);
    if (!primaryMediaRecord) throw new Error(`Primary media was not created for ${seedProduct.slug}`);
    const galleryUrls = seededMediaRecords.sort((left, right) => left.displayOrder - right.displayOrder).map((media) => media.url);
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: primaryMediaRecord.url, galleryImages: galleryUrls } });
    await prisma.productStorefrontProfile.update({ where: { productId: product.id }, data: { primaryMediaId: primaryMediaRecord.id } });

    const inventoryReference = `storefront-catalog:${seedProduct.sku}`;
    const priorMovement = await prisma.inventoryMovement.findFirst({ where: { organizationId: organization.id, referenceType: "STOREFRONT_CATALOG_SEED", referenceId: inventoryReference } });
    if (!priorMovement) {
      await prisma.$transaction(async (tx) => {
        await inventoryWriteService.receiveStock(tx, {
          organizationId: organization.id, branchId: branch.id, productVariantId: variant.id,
          quantity: seedProduct.stock, unitCost: seedProduct.cost, landedUnitCost: seedProduct.cost,
          movementType: "OPENING_BALANCE", batchNumber: `SEED-${seedProduct.sku}`,
          referenceType: "STOREFRONT_CATALOG_SEED", referenceId: inventoryReference,
          performedById: generalManager.id, notes: "Opening stock created by the explicit storefront catalog seed"
        });
      });
    }
  }

  const allCollectionSeeds = [...collections, ...routeCollections()];
  const collectionIdBySlug = new Map<string, string>();
  for (const [displayOrder, seedCollection] of allCollectionSeeds.entries()) {
    const collection = await prisma.storefrontCollection.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: seedCollection.slug } },
      update: { name: seedCollection.name, type: seedCollection.type as StorefrontCollectionType, isPublished: true, publishedAt, displayOrder, updatedById: generalManager.id, ruleConfig: { mode: "MANUAL_ONLY", seededBy: SEED_MARKER } },
      create: { organizationId: organization.id, name: seedCollection.name, slug: seedCollection.slug,
        description: `${seedCollection.name} curated by JS Perfumes.`, shortDescription: `${seedCollection.name} collection.`,
        type: seedCollection.type as StorefrontCollectionType, isPublished: true, publishedAt, displayOrder,
        createdById: generalManager.id, updatedById: generalManager.id, ruleConfig: { mode: "MANUAL_ONLY", seededBy: SEED_MARKER } }
    });
    collectionIdBySlug.set(seedCollection.slug, collection.id);
    for (const [itemOrder, productSlug] of seedCollection.products.entries()) {
      const productId = productIdBySlug.get(productSlug);
      if (!productId) throw new Error(`Collection ${seedCollection.slug} references unknown product ${productSlug}`);
      await prisma.storefrontCollectionItem.upsert({
        where: { collectionId_productId: { collectionId: collection.id, productId } },
        update: { displayOrder: itemOrder, isPinned: true, startsAt: null, endsAt: null },
        create: { collectionId: collection.id, productId, displayOrder: itemOrder, isPinned: true }
      });
    }
  }

  for (const [sectionKey, productSlugs] of Object.entries(homepagePlacements)) {
    const section = await prisma.storefrontSection.findFirstOrThrow({ where: { organizationId: organization.id, key: sectionKey } });
    await prisma.storefrontSection.update({ where: { id: section.id }, data: {
      sourceType: StorefrontSectionSourceType.MANUAL, maxItems: productSlugs.length, isActive: true,
      updatedById: generalManager.id, settings: { seededBy: SEED_MARKER }
    } });
    for (const [placementOrder, slug] of productSlugs.entries()) {
      const productId = productIdBySlug.get(slug);
      if (!productId) throw new Error(`Section ${sectionKey} references unknown product ${slug}`);
      await prisma.storefrontSectionPlacement.upsert({
        where: { sectionId_productId: { sectionId: section.id, productId } },
        update: { displayOrder: placementOrder, isPinned: true, startsAt: null, endsAt: null },
        create: { organizationId: organization.id, sectionId: section.id, productId, displayOrder: placementOrder, isPinned: true }
      });
    }
  }

  const cardsBySection = new Map<string, typeof contentCards[number][] >();
  for (const card of contentCards) cardsBySection.set(card[0], [...(cardsBySection.get(card[0]) ?? []), card]);
  for (const [sectionKey, cards] of cardsBySection) {
    const section = await prisma.storefrontSection.findFirstOrThrow({ where: { organizationId: organization.id, key: sectionKey } });
    await prisma.storefrontContentCard.deleteMany({ where: { organizationId: organization.id, sectionId: section.id } });
    await prisma.storefrontContentCard.createMany({ data: cards.map(([, title, subtitle, imageUrl, destinationValue], displayOrder) => ({
      organizationId: organization.id, sectionId: section.id, title, subtitle, imageUrl,
      destinationType: StorefrontDestinationType.ROUTE, destinationValue, ctaLabel: "Shop Now", displayOrder, isActive: true,
      settings: { seededBy: SEED_MARKER }
    })) });
  }

  const brandSection = await prisma.storefrontSection.findFirstOrThrow({ where: { organizationId: organization.id, key: "HOME_BRAND_MARQUEE" } });
  await prisma.storefrontContentCard.deleteMany({ where: { organizationId: organization.id, sectionId: brandSection.id } });
  await prisma.storefrontContentCard.createMany({ data: brands.map((brand, displayOrder) => ({
    organizationId: organization.id, sectionId: brandSection.id, title: brand,
    destinationType: StorefrontDestinationType.ROUTE, destinationValue: `/shop?brand=${encodeURIComponent(brand)}`,
    ctaLabel: "Shop Brand", displayOrder, isActive: true, settings: { presentation: "TEXT", seededBy: SEED_MARKER }
  })) });

  const reportPath = path.resolve("../docs/STOREFRONT_SEEDED_MEDIA_REPORT.md");
  const report = [
    "# Storefront Seeded Media Report", "", `Generated: ${new Date().toISOString()}`, "",
    "The active storage provider was used. Every listed image was decoded before seeding and met the 240px minimum dimension.", "",
    "| Product | Source | Public URL | Width | Height | Bytes | Role | Result |", "|---|---|---|---:|---:|---:|---|---|",
    ...mediaReport.map((row) => `| ${row.product} | ${row.source} | ${row.publicUrl} | ${row.width} | ${row.height} | ${row.bytes} | ${row.role} | ${row.validation} |`), ""
  ].join("\n");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, "utf8");

  return {
    products: products.length,
    variants: products.length,
    brands: brands.length,
    categories: categories.length,
    media: mediaReport.length,
    collections: new Set(allCollectionSeeds.map((collection) => collection.slug)).size,
    placements: Object.values(homepagePlacements).reduce((sum, entries) => sum + entries.length, 0),
    contentCards: contentCards.length + brands.length
  };
};

const main = async () => {
  const summary = await seedStorefrontCatalog();
  console.log(JSON.stringify({ success: true, summary }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
