import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import request from "supertest";

import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { STOREFRONT_SEED_ORGANIZATION_ID } from "./seed-data/storefront/catalog.js";

const PRODUCT_SLUG = "lattafa-asad-eau-de-parfum-100ml";
const SECTION_KEY = "HOME_NEW_IN_STORE";
const API = "/api/v1";

const main = async () => {
  const app = createApp();
  const login = await request(app).post(`${API}/auth/login`).send({
    email: "gm@pulseperfumes.test",
    password: "General123!",
    deviceId: "storefront-dynamic-verification"
  });
  assert.equal(login.status, 200, "General Manager login failed");
  assert.equal(login.body.data.user.role, "GENERAL_MANAGER");
  const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };

  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, slug: PRODUCT_SLUG },
    include: {
      storefrontProfile: true,
      media: { where: { isPrimary: true }, orderBy: { createdAt: "asc" }, take: 1 },
      variants: { include: { storefrontProfile: true } }
    }
  });
  const profile = product.storefrontProfile;
  const variant = product.variants[0];
  const variantProfile = variant?.storefrontProfile;
  const media = product.media[0];
  assert(profile && variant && variantProfile && media, "Seeded Asad catalog record is incomplete");

  const onlinePriceList = await prisma.priceList.findFirstOrThrow({
    where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, type: "ONLINE_RETAIL", status: "ACTIVE" }
  });
  const priceItem = await prisma.priceListItem.findUniqueOrThrow({
    where: {
      priceListId_productVariantId_minimumQuantity: {
        priceListId: onlinePriceList.id,
        productVariantId: variant.id,
        minimumQuantity: 1
      }
    }
  });
  const originalPrice = Number(priceItem.unitPrice);

  const profileBody = (isPublished: boolean, onlinePrice = originalPrice) => ({
    websiteTitle: profile.websiteTitle,
    slug: profile.slug,
    shortDescription: profile.shortDescription,
    longDescription: profile.longDescription,
    seoTitle: profile.seoTitle,
    seoDescription: profile.seoDescription,
    searchKeywords: profile.searchKeywords,
    isPublished,
    publishFrom: profile.publishFrom?.toISOString() ?? null,
    publishUntil: profile.publishUntil?.toISOString() ?? null,
    isFeatured: profile.isFeatured,
    isNewArrival: profile.isNewArrival,
    isBestSeller: profile.isBestSeller,
    displayOrder: profile.displayOrder,
    variants: [
      {
        variantId: variant.id,
        isPublishedOnline: variantProfile.isPublishedOnline,
        isDefaultWebsiteVariant: variantProfile.isDefaultWebsiteVariant,
        compareAtPrice: variantProfile.compareAtPrice ? Number(variantProfile.compareAtPrice) : null,
        maximumOnlineQuantity: variantProfile.maximumOnlineQuantity,
        allowBackorder: variantProfile.allowBackorder,
        lowStockThreshold: variantProfile.lowStockThreshold,
        websiteLabel: variantProfile.websiteLabel,
        displayOrder: variantProfile.displayOrder,
        onlinePrice
      }
    ]
  });

  const changedPrice = originalPrice + 111;
  let response = await request(app)
    .post(`${API}/storefront/products/${product.id}/profile`)
    .set(auth)
    .send(profileBody(true, changedPrice));
  assert.equal(response.status, 200, "ERP price update failed");
  response = await request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`);
  assert.equal(response.body.data.product.variants[0].price, changedPrice, "PDP did not reflect ERP price update");
  await request(app)
    .post(`${API}/storefront/products/${product.id}/profile`)
    .set(auth)
    .send(profileBody(true, originalPrice))
    .expect(200);

  const section = await prisma.storefrontSection.findFirstOrThrow({
    where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, key: SECTION_KEY },
    include: { placements: { orderBy: { displayOrder: "asc" } } }
  });
  assert(section.placements.length >= 2, "New In Store needs at least two placements");
  const placementPayload = section.placements.map((placement, index) => ({
    productId: placement.productId,
    displayOrder: index,
    isPinned: placement.isPinned,
    startsAt: placement.startsAt?.toISOString() ?? null,
    endsAt: placement.endsAt?.toISOString() ?? null,
    titleOverride: placement.titleOverride,
    subtitleOverride: placement.subtitleOverride,
    mediaOverrideId: placement.mediaOverrideId
  }));
  const reordered = [placementPayload[1], placementPayload[0], ...placementPayload.slice(2)].map(
    (placement, displayOrder) => ({ ...placement, displayOrder })
  );
  await request(app)
    .put(`${API}/storefront/sections/${SECTION_KEY}/placements`)
    .set(auth)
    .send({ placements: reordered })
    .expect(200);
  response = await request(app).get(`${API}/storefront/home`);
  const changedSection = response.body.data.sections.find((entry: { key: string }) => entry.key === SECTION_KEY);
  assert(changedSection?.products?.[0] && reordered[0], "Homepage section did not resolve after reordering");
  assert.equal(changedSection.products[0].id, reordered[0].productId, "Homepage placement order did not update");
  await request(app)
    .put(`${API}/storefront/sections/${SECTION_KEY}/placements`)
    .set(auth)
    .send({ placements: placementPayload })
    .expect(200);

  const bestSellersCollection = await prisma.storefrontCollection.findFirstOrThrow({
    where: { organizationId: STOREFRONT_SEED_ORGANIZATION_ID, slug: "best-sellers" },
    include: { items: { orderBy: { displayOrder: "asc" } } }
  });
  assert(bestSellersCollection.items.some((item) => item.productId === product.id), "Asad is not assigned to Best Sellers");
  const collectionItemsPayload = bestSellersCollection.items.map((item) => ({
    productId: item.productId,
    displayOrder: item.displayOrder,
    isPinned: item.isPinned,
    startsAt: item.startsAt?.toISOString() ?? null,
    endsAt: item.endsAt?.toISOString() ?? null
  }));
  const collectionProfile = {
    name: bestSellersCollection.name,
    slug: bestSellersCollection.slug,
    description: bestSellersCollection.description,
    shortDescription: bestSellersCollection.shortDescription,
    imageUrl: bestSellersCollection.imageUrl,
    type: bestSellersCollection.type,
    isPublished: bestSellersCollection.isPublished,
    displayOrder: bestSellersCollection.displayOrder,
    ruleConfig: bestSellersCollection.ruleConfig
  };
  await request(app)
    .patch(`${API}/storefront/collections/${bestSellersCollection.id}`)
    .set(auth)
    .send({ ...collectionProfile, items: collectionItemsPayload.filter((item) => item.productId !== product.id) })
    .expect(200);
  const [collectionWithoutProduct, stillInShop, stillOnPdp] = await Promise.all([
    request(app).get(`${API}/storefront/collections/best-sellers?limit=48`),
    request(app).get(`${API}/storefront/products?search=${encodeURIComponent(product.name)}&limit=48`),
    request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`)
  ]);
  assert(!JSON.stringify(collectionWithoutProduct.body.data).includes(PRODUCT_SLUG), "Product remained in Best Sellers after removal");
  assert(JSON.stringify(stillInShop.body.data).includes(PRODUCT_SLUG), "Collection removal incorrectly removed product from Shop");
  assert.equal(stillOnPdp.status, 200, "Collection removal incorrectly removed the PDP");
  await request(app)
    .patch(`${API}/storefront/collections/${bestSellersCollection.id}`)
    .set(auth)
    .send({ ...collectionProfile, items: collectionItemsPayload })
    .expect(200);
  response = await request(app).get(`${API}/storefront/collections/best-sellers?limit=48`);
  assert(JSON.stringify(response.body.data).includes(PRODUCT_SLUG), "Best Sellers assignment was not restored");

  await request(app)
    .post(`${API}/storefront/products/${product.id}/profile`)
    .set(auth)
    .send(profileBody(false, originalPrice))
    .expect(200);
  const [shop, home, men, bestSellers, unavailablePdp] = await Promise.all([
    request(app).get(`${API}/storefront/products?limit=48`),
    request(app).get(`${API}/storefront/home`),
    request(app).get(`${API}/storefront/routes/men?limit=48`),
    request(app).get(`${API}/storefront/collections/best-sellers?limit=48`),
    request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`)
  ]);
  for (const surface of [shop, home, men, bestSellers]) {
    assert(!JSON.stringify(surface.body.data).includes(PRODUCT_SLUG), "Unpublished product remained public");
  }
  assert.equal(unavailablePdp.status, 404, "Unpublished PDP remained directly accessible");
  await request(app)
    .post(`${API}/storefront/products/${product.id}/profile`)
    .set(auth)
    .send(profileBody(true, originalPrice))
    .expect(200);
  await request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`).expect(200);

  const mediaSnapshot = {
    url: media.url,
    storageKey: media.storageKey,
    storageProvider: media.storageProvider,
    resourceType: media.resourceType,
    format: media.format,
    bytes: media.bytes,
    width: media.width,
    height: media.height,
    altText: media.altText,
    title: media.title,
    displayOrder: media.displayOrder,
    isPrimary: media.isPrimary,
    isPublished: media.isPublished,
    productVariantId: media.productVariantId
  };
  const replacementPath = path.resolve("prisma/seed-data/storefront/media/lattafa-khamrah.jpg");
  const originalPath = path.resolve("prisma/seed-data/storefront/media/lattafa-asad.jpg");
  await request(app)
    .put(`${API}/storefront/media/${media.id}/file`)
    .set(auth)
    .attach("image", replacementPath)
    .expect(200);
  response = await request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`);
  const replacementUrl = response.body.data.product.image;
  assert.notEqual(replacementUrl, mediaSnapshot.url, "Public product image URL did not change");
  await request(app)
    .put(`${API}/storefront/media/${media.id}/file`)
    .set(auth)
    .attach("image", originalPath)
    .expect(200);
  const transientMedia = await prisma.productMedia.findUniqueOrThrow({ where: { id: media.id } });

  if (mediaSnapshot.storageProvider === "local" && mediaSnapshot.storageKey) {
    await fs.mkdir(path.dirname(path.resolve("uploads", mediaSnapshot.storageKey)), { recursive: true });
    await fs.copyFile(originalPath, path.resolve("uploads", mediaSnapshot.storageKey));
  }
  await prisma.productMedia.update({ where: { id: media.id }, data: mediaSnapshot });
  await prisma.product.update({ where: { id: product.id }, data: { imageUrl: mediaSnapshot.url, galleryImages: [mediaSnapshot.url] } });
  await prisma.productStorefrontProfile.update({ where: { productId: product.id }, data: { primaryMediaId: media.id } });
  if (
    transientMedia.storageProvider === "local" &&
    transientMedia.storageKey &&
    transientMedia.storageKey !== mediaSnapshot.storageKey
  ) {
    await fs.rm(path.resolve("uploads", transientMedia.storageKey), { force: true });
  }
  response = await request(app).get(`${API}/storefront/products/${PRODUCT_SLUG}`);
  assert(
    response.body.data.product.image.endsWith(mediaSnapshot.url),
    "Original product image was not restored"
  );

  const cart = await request(app).post(`${API}/storefront/cart`).send({}).expect(200);
  const cartAdd = await request(app)
    .post(`${API}/storefront/cart/${cart.body.data.token}/items`)
    .send({ productVariantId: variant.id, quantity: 1 })
    .expect(200);
  assert.match(
    cartAdd.body.data.items[0]?.variant?.product?.media?.[0]?.url ?? "",
    /^https?:\/\//,
    "Cart product media URL was not public and absolute"
  );

  console.log(
    JSON.stringify(
      {
        success: true,
        product: product.name,
        proofs: {
          generalManagerLogin: "PASS",
          priceChangedAndRestored: "PASS",
          placementChangedAndRestored: "PASS",
          collectionRemovedOnlyFromBestSellersAndRestored: "PASS",
          unpublishedAcrossAllPublicSurfacesAndRepublished: "PASS",
          primaryImageReplacedAndRestored: "PASS",
          addToCart: "PASS"
        }
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
