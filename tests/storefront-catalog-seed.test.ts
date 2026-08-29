import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deterministicBarcode } from "../prisma/seed-storefront-catalog.js";
import {
  brands,
  categories,
  collections,
  contentCards,
  homepagePlacements,
  products,
} from "../prisma/seed-data/storefront/catalog.js";

describe("storefront catalog seed definition", () => {
  it("contains a curated catalog with complete product-domain records", () => {
    expect(products.length).toBeGreaterThanOrEqual(260);
    expect(products.length).toBeLessThanOrEqual(400);

    for (const product of products) {
      expect(product.name).not.toMatch(/^(product|sample|test item)\b/i);
      expect(product.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(product.sku).toMatch(/^[A-Z0-9-]+$/);
      expect(product.price).toBeGreaterThan(0);
      expect(product.stock).toBeGreaterThan(0);
      expect(product.shortDescription.length).toBeGreaterThan(10);
      expect(product.description.length).toBeGreaterThan(30);
      expect(product.keywords.length).toBeGreaterThan(1);
      expect(brands).toContain(product.brand as (typeof brands)[number]);
      expect(categories.map(([, slug]) => slug)).toContain(product.category);
      expect(fs.existsSync(path.resolve("prisma/seed-data/storefront/media", product.mediaFile))).toBe(true);
      for (const media of product.galleryMedia ?? []) {
        expect(fs.existsSync(path.resolve("prisma/seed-data/storefront/media", media.mediaFile))).toBe(true);
      }
    }
  });

  it("generates stable unique SKUs, GTIN-style barcodes and storefront slugs", () => {
    const slugs = products.map((product) => product.slug);
    const skus = products.map((product) => product.sku);
    const barcodes = products.map((product) => deterministicBarcode(product.sku));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(barcodes).size).toBe(barcodes.length);
    expect(barcodes.every((barcode) => /^\d{13}$/.test(barcode))).toBe(true);
    expect(products.map((product) => deterministicBarcode(product.sku))).toEqual(barcodes);
  });

  it("covers every taxonomy, audience, collection and homepage placement reference", () => {
    const productSlugs = new Set(products.map((product) => product.slug));
    const usedCategories = new Set(products.map((product) => product.category));
    for (const [, slug] of categories) {
      expect(usedCategories.has(slug)).toBe(true);
      expect(products.filter((product) => product.category === slug).length).toBeGreaterThanOrEqual(20);
    }
    for (const audience of ["MEN", "WOMEN", "UNISEX"] as const) {
      expect(products.filter((product) => product.gender === audience).length).toBeGreaterThanOrEqual(40);
    }
    expect(products.some((product) => product.gender === "NOT_APPLICABLE")).toBe(true);
    const collectionMinimums: Record<string, number> = {
      "new-arrivals": 20, "best-sellers": 20, "arabic-collection": 40, "niche-fragrances": 20,
      offers: 20, "wedding-gifts": 20, "eid-gifts": 20, "birthday-gifts": 20,
      "corporate-gifts": 20, "premium-gift-boxes": 20
    };
    for (const collection of collections) {
      expect(collection.products.length).toBeGreaterThanOrEqual(collectionMinimums[collection.slug] ?? 1);
      expect(collection.products.every((slug) => productSlugs.has(slug))).toBe(true);
    }
    for (const placements of Object.values(homepagePlacements)) {
      expect(new Set(placements).size).toBe(placements.length);
      expect(placements.every((slug) => productSlugs.has(slug))).toBe(true);
    }
    expect(contentCards.length).toBeGreaterThanOrEqual(19);
  });

  it("provides distinct multi-image galleries for at least 70% of perfume, oud and gift products", () => {
    const premiumProducts = products.filter((product) => ["perfumes", "ouds", "gift-sets"].includes(product.category));
    const withGallery = premiumProducts.filter((product) => (product.galleryMedia?.length ?? 0) >= 1);
    expect(withGallery.length / premiumProducts.length).toBeGreaterThanOrEqual(0.7);
    const mediaFiles = products.flatMap((product) => [product.mediaFile, ...(product.galleryMedia ?? []).map((media) => media.mediaFile)]);
    expect(new Set(mediaFiles).size).toBe(mediaFiles.length);
  });

  it("uses compare-at pricing only for genuine markdowns", () => {
    const offers = products.filter((product) => product.compareAtPrice !== undefined);
    expect(offers.length / products.length).toBeGreaterThanOrEqual(0.15);
    expect(offers.length / products.length).toBeLessThanOrEqual(0.3);
    expect(offers.every((product) => product.compareAtPrice! > product.price)).toBe(true);
  });
});
