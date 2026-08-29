import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import request from "supertest";

import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  STOREFRONT_SEED_ORGANIZATION_ID,
  categories as requiredCategories,
  collections as requiredCollections,
  products as seedProducts
} from "./seed-data/storefront/catalog.js";

const SEED_MARKER = "storefront-catalog-seed:v1";
const STOREFRONT_ROOT = path.resolve("../js-perfumes-kenya-luxury-fragrances/src");
const COMPLETE_MEDIA_PROVENANCE_REPORT = path.resolve("../docs/STOREFRONT_COMPLETE_MEDIA_PROVENANCE.md");
const COMPLETE_MEDIA_VALIDATION_REPORT = path.resolve("../docs/STOREFRONT_COMPLETE_MEDIA_VALIDATION.md");
const REQUIRED_CATEGORY_MINIMUM = 20;
const REQUIRED_AUDIENCE_MINIMUM = 40;
const REQUIRED_COLLECTION_MINIMUMS = new Map([
  ["new-arrivals", 20], ["best-sellers", 20], ["arabic-collection", 40], ["niche-fragrances", 20],
  ["offers", 20], ["wedding-gifts", 20], ["eid-gifts", 20], ["birthday-gifts", 20],
  ["corporate-gifts", 20], ["premium-gift-boxes", 20]
]);
const CATEGORY_PRODUCT_TYPES = new Map<string, Set<string>>([
  ["perfumes", new Set(["PERFUME"])], ["ouds", new Set(["OUD"])], ["bakhoor", new Set(["BAKHOOR"])],
  ["burners", new Set(["BURNER"])], ["perfume-oils", new Set(["OIL"])],
  ["air-fresheners", new Set(["BODY_SPRAY"])], ["room-sprays", new Set(["BODY_SPRAY"])],
  ["linen-sprays", new Set(["BODY_SPRAY"])], ["car-fragrances", new Set(["ACCESSORIES"])],
  ["creams", new Set(["LOTION"])], ["home-scents", new Set(["ACCESSORIES"])],
  ["gift-sets", new Set(["GIFT_SET"])], ["gift-vouchers", new Set(["GIFT_SET"])]
]);

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return files.flat();
};

const validateSource = async () => {
  const files = await collectSourceFiles(STOREFRONT_ROOT);
  const forbidden = [
    "FALLBACK_PRODUCTS",
    "Operating in fallback mode",
    "@/data/products",
    "getProductsByCategory",
    "rating ?? 0",
    "products.find((p) => p.id",
    "Explore {items.length} current picks",
    "results.length > 0 ? results : items"
  ];
  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const token of forbidden) {
      if (source.includes(token)) violations.push(`${path.relative(STOREFRONT_ROOT, file)} contains ${token}`);
    }
  }
  return violations;
};

const main = async () => {
  const errors: string[] = [];
  const organizationId = STOREFRONT_SEED_ORGANIZATION_ID;
  const app = createApp();
  const headers = { "X-Organization-Id": organizationId };

  const seededProducts = await prisma.product.findMany({
    where: { organizationId, notes: SEED_MARKER },
    include: {
      brand: true,
      category: true,
      media: { where: { isPublished: true }, orderBy: { displayOrder: "asc" } },
      storefrontProfile: true,
      variants: {
        include: {
          storefrontProfile: true,
          barcodes: true,
          inventoryBalances: true,
          priceListItems: { include: { priceList: true } }
        }
      },
      collectionItems: true,
      sectionPlacements: true
    }
  });

  if (seededProducts.length !== seedProducts.length) {
    errors.push(`Expected ${seedProducts.length} seeded products, found ${seededProducts.length}`);
  }

  const categoryCoverage = Object.fromEntries(requiredCategories.map(([, slug]) => [
    slug,
    seededProducts.filter((product) => product.category?.slug === slug && product.storefrontProfile?.isPublished).length
  ]));
  for (const [slug, count] of Object.entries(categoryCoverage)) {
    if (count < REQUIRED_CATEGORY_MINIMUM) errors.push(`Category ${slug} has ${count}; minimum is ${REQUIRED_CATEGORY_MINIMUM}`);
  }

  const audienceCoverage = seededProducts.reduce<Record<string, number>>((counts, product) => {
    counts[product.genderTarget] = (counts[product.genderTarget] ?? 0) + 1;
    return counts;
  }, {});
  for (const audience of ["MEN", "WOMEN", "UNISEX"]) {
    if ((audienceCoverage[audience] ?? 0) < REQUIRED_AUDIENCE_MINIMUM) {
      errors.push(`${audience} audience has ${audienceCoverage[audience] ?? 0}; minimum is ${REQUIRED_AUDIENCE_MINIMUM}`);
    }
  }

  const duplicate = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);
  const slugs = seededProducts.map((product) => product.storefrontProfile?.slug ?? "").filter(Boolean);
  const variants = seededProducts.flatMap((product) => product.variants);
  const skus = variants.map((variant) => variant.sku);
  if (duplicate(slugs).length) errors.push(`Duplicate slugs: ${duplicate(slugs).join(", ")}`);
  if (duplicate(skus).length) errors.push(`Duplicate SKUs: ${duplicate(skus).join(", ")}`);
  const variantPrimaryBarcodes = variants.map((variant) => variant.barcode).filter((value): value is string => Boolean(value));
  if (duplicate(variantPrimaryBarcodes).length) errors.push(`Duplicate variant barcodes: ${duplicate(variantPrimaryBarcodes).join(", ")}`);

  for (const product of seededProducts) {
    if (!product.brand) errors.push(`${product.slug} has no brand`);
    if (!product.category) errors.push(`${product.slug} has no category`);
    const allowedTypes = product.category ? CATEGORY_PRODUCT_TYPES.get(product.category.slug) : undefined;
    if (allowedTypes && (!product.productType || !allowedTypes.has(product.productType))) errors.push(`${product.slug} has unrelated type ${product.productType} for ${product.category?.slug}`);
    if (!product.storefrontProfile?.isPublished) errors.push(`${product.slug} is not published`);
    if (!product.media.some((media) => media.isPrimary && media.width && media.height)) errors.push(`${product.slug} has no validated primary image`);
    if (product.media.filter((media) => media.isPrimary).length !== 1) errors.push(`${product.slug} must have exactly one published primary image`);
    const publishedVariants = product.variants.filter((variant) => variant.storefrontProfile?.isPublishedOnline);
    if (!publishedVariants.length) errors.push(`${product.slug} has no published variant`);
    for (const variant of publishedVariants) {
      const onlinePrice = variant.priceListItems.find((item) => item.priceList.type === "ONLINE_RETAIL" && item.priceList.status === "ACTIVE");
      if (!onlinePrice) errors.push(`${variant.sku} has no active Online Retail price`);
      const available = variant.inventoryBalances.reduce((sum, balance) => sum + Number(balance.quantityAvailable), 0);
      if (available <= 0) errors.push(`${variant.sku} has no available inventory`);
      if (!variant.barcode || !variant.barcodes.some((entry) => entry.barcode === variant.barcode)) errors.push(`${variant.sku} barcode record is missing`);
    }
  }

  const placements = await prisma.storefrontSectionPlacement.findMany({ where: { organizationId }, include: { product: true, section: true } });
  for (const placement of placements) {
    if (!placement.product || !placement.section) errors.push(`Unresolved section placement ${placement.id}`);
  }
  const collectionItems = await prisma.storefrontCollectionItem.findMany({ where: { collection: { organizationId } }, include: { product: true, collection: true } });
  for (const item of collectionItems) {
    if (!item.product || !item.collection) errors.push(`Unresolved collection item ${item.id}`);
  }

  const cards = await prisma.storefrontContentCard.findMany({ where: { organizationId, isActive: true } });
  const validRouteSlugs = new Set([
    ...(await prisma.productCategory.findMany({ where: { organizationId, status: "ACTIVE" }, select: { slug: true } })).map((entry) => entry.slug),
    ...(await prisma.storefrontCollection.findMany({ where: { organizationId, isPublished: true }, select: { slug: true } })).map((entry) => entry.slug)
  ]);
  for (const card of cards) {
    if (card.destinationType === "ROUTE" && card.destinationValue?.startsWith("/category/")) {
      const slug = card.destinationValue.slice("/category/".length);
      if (!validRouteSlugs.has(slug)) errors.push(`Content card ${card.title} points to invalid route ${card.destinationValue}`);
    }
  }

  const seedProductBySlug = new Map(seedProducts.map((product) => [product.slug, product]));
  const mediaValidationRows: string[] = [];
  const mediaProvenanceRows: string[] = [];
  const mediaHashProducts = new Map<string, string[]>();
  let validImages = 0;
  let brokenImages = 0;
  for (const product of seededProducts) {
    const seedProduct = seedProductBySlug.get(product.slug);
    for (const [mediaIndex, media] of product.media.entries()) {
      const seedMedia = mediaIndex === 0
        ? seedProduct && { mediaFile: seedProduct.mediaFile, mediaSource: seedProduct.mediaSource }
        : seedProduct?.galleryMedia?.[mediaIndex - 1];
      let validation = "PASS";
      let hash = "REMOTE";
      let mime = `image/${media.format ?? "unknown"}`;

      if (!media.altText?.trim()) {
        validation = "FAIL: missing alt text";
        errors.push(`${product.slug} media ${media.id} has no alt text`);
      }
      if (!media.width || !media.height || media.width < 240 || media.height < 240 || !media.bytes) {
        validation = "FAIL: invalid dimensions or bytes";
        errors.push(`${product.slug} media ${media.id} has invalid dimensions or byte size`);
      }

      if (media.url.startsWith("/uploads/")) {
        const filename = path.basename(media.url);
        const file = path.resolve("uploads", filename);
        const buffer = await fs.readFile(file).catch(() => null);
        if (!buffer?.length || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
          validation = "FAIL: missing or non-JPEG local file";
          errors.push(`${product.slug} image does not exist or is not JPEG: ${media.url}`);
        } else {
          hash = createHash("sha256").update(buffer).digest("hex");
          mime = "image/jpeg";
          const mappedProducts = mediaHashProducts.get(hash) ?? [];
          mappedProducts.push(product.slug);
          mediaHashProducts.set(hash, mappedProducts);
          const publicResponse = await request(app).get(media.url).set(headers);
          if (publicResponse.status !== 200 || !publicResponse.headers["content-type"]?.startsWith("image/")) {
            validation = "FAIL: public local-media response invalid";
            errors.push(`${product.slug} public image returned ${publicResponse.status}: ${media.url}`);
          }
        }
      } else {
        const response = await fetch(media.url, { method: "HEAD", redirect: "follow" }).catch(() => null);
        if (!response?.ok || !response.headers.get("content-type")?.startsWith("image/")) {
          validation = "FAIL: remote image unavailable";
          errors.push(`${product.slug} image does not load: ${media.url}`);
        } else {
          mime = response.headers.get("content-type") ?? mime;
        }
      }

      if (validation === "PASS") validImages += 1;
      else brokenImages += 1;
      const role = media.isPrimary ? "PRIMARY" : "GALLERY";
      mediaValidationRows.push(`| ${product.name} | ${media.url} | ${media.width ?? 0} | ${media.height ?? 0} | ${mime} | ${media.bytes ?? 0} | ${role} | ${media.displayOrder} | ${hash} | ${validation} |`);
      const generated = seedMedia?.mediaSource.startsWith("Original AI-assisted") ?? false;
      mediaProvenanceRows.push(`| ${product.name} | ${generated ? "Original AI-assisted house-brand mockup" : "Existing project or manufacturer-referenced media"} | ${seedMedia?.mediaSource ?? "Source reference unavailable"} | ${media.url} | Active seed media | ${generated ? "Commercial packaging and licensing review required" : "Commercial usage/license review required unless client documentation exists"} |`);
    }
  }

  const duplicateHashes = [...mediaHashProducts.entries()].filter(([, productSlugs]) => productSlugs.length > 1);
  for (const [hash, productSlugs] of duplicateHashes) errors.push(`Image hash ${hash} is duplicated: ${productSlugs.join(", ")}`);

  const premiumProducts = seededProducts.filter((product) => ["perfumes", "ouds", "gift-sets"].includes(product.category?.slug ?? ""));
  const premiumWithGallery = premiumProducts.filter((product) => product.media.length >= 2).length;
  const galleryCoveragePercent = premiumProducts.length ? premiumWithGallery / premiumProducts.length * 100 : 0;
  if (galleryCoveragePercent < 70) errors.push(`Perfume, oud and gift-set gallery coverage is ${galleryCoveragePercent.toFixed(1)}%; minimum is 70%`);

  const catalogStartedAt = performance.now();
  const catalog = await request(app).get("/api/v1/storefront/products?limit=20&page=1").set(headers);
  const catalogDurationMs = performance.now() - catalogStartedAt;
  if (catalog.status !== 200) errors.push(`Public catalog returned ${catalog.status}`);
  const catalogData = catalog.body?.data;
  if (!(catalogData?.pagination?.total > 20 && catalogData?.pagination?.totalPages > 1)) errors.push("Shop pagination does not exceed 20 products");

  const homeStartedAt = performance.now();
  const home = await request(app).get("/api/v1/storefront/home").set(headers);
  const homeDurationMs = performance.now() - homeStartedAt;
  if (home.status !== 200) errors.push(`Homepage API returned ${home.status}`);
  for (const key of ["HOME_NEW_IN_STORE", "HOME_ON_OFFER", "HOME_BEST_SELLERS"]) {
    const section = home.body?.data?.sections?.find((entry: { key: string }) => entry.key === key);
    if (!section?.products?.length) errors.push(`${key} has no public products`);
  }

  const routeSlugs = [
    ...requiredCategories.map(([, slug]) => slug),
    ...requiredCollections.map((collection) => collection.slug),
    "men", "women", "unisex",
    "bakhoors", "incense-burners", "home-fragrance"
  ];
  const routeCoverage: Record<string, number> = {};
  const routeDurations: number[] = [];
  for (const slug of new Set(routeSlugs)) {
    const routeStartedAt = performance.now();
    const response = await request(app).get(`/api/v1/storefront/routes/${slug}?limit=24`).set(headers);
    routeDurations.push(performance.now() - routeStartedAt);
    if (response.status !== 200) {
      errors.push(`Route ${slug} returned ${response.status}`);
      continue;
    }
    const total = Number(response.body?.data?.pagination?.total ?? 0);
    routeCoverage[slug] = total;
    if (total < REQUIRED_CATEGORY_MINIMUM) errors.push(`Route ${slug} has ${total}; minimum is ${REQUIRED_CATEGORY_MINIMUM}`);
  }

  for (const product of seededProducts) {
    const response = await request(app).get(`/api/v1/storefront/products/${product.storefrontProfile?.slug}`).set(headers);
    if (response.status !== 200 || response.body?.data?.product?.slug !== product.storefrontProfile?.slug) errors.push(`Direct PDP failed for ${product.slug}`);
  }

  errors.push(...(await validateSource()));

  const collectionSummary = await prisma.storefrontCollection.findMany({
    where: { organizationId, isPublished: true },
    select: { slug: true, items: { select: { product: { select: { name: true } } }, orderBy: { displayOrder: "asc" } } },
    orderBy: { displayOrder: "asc" }
  });
  const collectionCounts = Object.fromEntries(collectionSummary.map((collection) => [collection.slug, collection.items.length]));
  for (const seedCollection of requiredCollections) {
    const minimum = REQUIRED_COLLECTION_MINIMUMS.get(seedCollection.slug);
    if (minimum && (collectionCounts[seedCollection.slug] ?? 0) < minimum) {
      errors.push(`Collection ${seedCollection.slug} has ${collectionCounts[seedCollection.slug] ?? 0}; minimum is ${minimum}`);
    }
  }

  const inventoryMovementVariantIds = new Set((await prisma.inventoryMovement.findMany({
    where: {
      organizationId,
      productVariantId: { in: variants.map((variant) => variant.id) },
      referenceType: "STOREFRONT_CATALOG_SEED"
    },
    select: { productVariantId: true }
  })).map((movement) => movement.productVariantId));
  for (const variant of variants.filter((entry) => entry.storefrontProfile?.isPublishedOnline)) {
    if (!inventoryMovementVariantIds.has(variant.id)) errors.push(`${variant.sku} has no seed inventory movement history`);
  }

  const placementCounts = Object.fromEntries((await prisma.storefrontSection.findMany({
    where: { organizationId, key: { in: ["HOME_NEW_IN_STORE", "HOME_ON_OFFER", "HOME_BEST_SELLERS"] } },
    select: { key: true, placements: { select: { id: true } } }
  })).map((section) => [section.key, section.placements.length]));
  for (const sectionKey of ["HOME_NEW_IN_STORE", "HOME_ON_OFFER", "HOME_BEST_SELLERS"]) {
    if ((placementCounts[sectionKey] ?? 0) !== 8) errors.push(`${sectionKey} has ${placementCounts[sectionKey] ?? 0} placements; expected 8`);
  }

  const summary = {
    products: seededProducts.length,
    variants: variants.length,
    brands: new Set(seededProducts.map((product) => product.brandId)).size,
    categories: new Set(seededProducts.map((product) => product.categoryId)).size,
    media: seededProducts.reduce((sum, product) => sum + product.media.length, 0),
    galleryImages: seededProducts.reduce((sum, product) => sum + product.media.filter((media) => !media.isPrimary).length, 0),
    validImages,
    brokenImages,
    duplicateHashes: duplicateHashes.length,
    premiumGalleryCoverage: `${premiumWithGallery}/${premiumProducts.length} (${galleryCoveragePercent.toFixed(1)}%)`,
    collections: collectionSummary.length,
    placements: placements.length,
    placementCounts,
    contentCards: cards.length,
    categoryCoverage,
    routeCoverage,
    audienceCoverage,
    pricing: {
      minimum: Math.min(...seedProducts.map((product) => product.price)),
      maximum: Math.max(...seedProducts.map((product) => product.price)),
      offers: seedProducts.filter((product) => product.compareAtPrice).length
    },
    apiPerformance: {
      shopPage20: { durationMs: Number(catalogDurationMs.toFixed(1)), responseBytes: Buffer.byteLength(JSON.stringify(catalog.body)) },
      homepage: { durationMs: Number(homeDurationMs.toFixed(1)), responseBytes: Buffer.byteLength(JSON.stringify(home.body)) },
      routeAverageMs: Number((routeDurations.reduce((sum, value) => sum + value, 0) / Math.max(routeDurations.length, 1)).toFixed(1)),
      routeMaximumMs: Number(Math.max(...routeDurations).toFixed(1))
    },
    collectionCounts,
    collectionsWithProducts: Object.fromEntries(collectionSummary.map((collection) => [collection.slug, collection.items.map((item) => item.product.name)]))
  };

  const generatedAt = new Date().toISOString();
  const provenanceReport = [
    "# Storefront Complete Media Provenance", "", `Generated: ${generatedAt}`, "",
    "This report records source claims; it does not grant or certify commercial rights. AI-assisted JS Perfumes house mockups require packaging, trademark and commercial-use review before production. Existing project/manufacturer-referenced assets require client license documentation.", "",
    "| Product | Source type | Source reference | Storage location | Usage status | Review |",
    "|---|---|---|---|---|---|", ...mediaProvenanceRows, ""
  ].join("\n");
  const validationReport = [
    "# Storefront Complete Media Validation", "", `Generated: ${generatedAt}`, "",
    `Valid images: ${validImages}`, `Broken images: ${brokenImages}`, `Duplicate hashes: ${duplicateHashes.length}`,
    `Products with multiple media in perfume, oud and gift sets: ${premiumWithGallery}/${premiumProducts.length} (${galleryCoveragePercent.toFixed(1)}%)`, "",
    "| Product | Public URL | Width | Height | MIME | Bytes | Role | Order | SHA-256 | Result |",
    "|---|---|---:|---:|---|---:|---|---:|---|---|", ...mediaValidationRows, ""
  ].join("\n");
  await fs.mkdir(path.dirname(COMPLETE_MEDIA_PROVENANCE_REPORT), { recursive: true });
  await Promise.all([
    fs.writeFile(COMPLETE_MEDIA_PROVENANCE_REPORT, provenanceReport, "utf8"),
    fs.writeFile(COMPLETE_MEDIA_VALIDATION_REPORT, validationReport, "utf8")
  ]);

  if (errors.length) {
    console.error(JSON.stringify({ success: false, errors, summary }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ success: true, errors: [], summary }, null, 2));
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
