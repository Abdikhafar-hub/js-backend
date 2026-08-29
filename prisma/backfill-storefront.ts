import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start
    .replace(/-+$/, ""); // Trim - from end
};

async function main() {
  console.log("Backfilling storefront profiles for existing products...");

  const products = await prisma.product.findMany({
    include: {
      variants: true,
      storefrontProfile: true
    }
  });

  for (const product of products) {
    const slug = product.storefrontProfile?.slug || slugify(product.name);
    console.log(`Setting up storefront profile for: ${product.name} (slug: ${slug})`);

    // Create/update product storefront profile
    await prisma.productStorefrontProfile.upsert({
      where: { productId: product.id },
      update: {
        websiteTitle: product.name,
        slug,
        shortDescription: product.description || `Premium fragrance from ${product.name}`,
        longDescription: product.description || `Experience the luxurious scent of ${product.name}. A carefully crafted composition with rich notes.`,
        isPublished: true,
        isFeatured: true,
        isNewArrival: true,
        isBestSeller: true
      },
      create: {
        organizationId: product.organizationId,
        productId: product.id,
        websiteTitle: product.name,
        slug,
        shortDescription: product.description || `Premium fragrance from ${product.name}`,
        longDescription: product.description || `Experience the luxurious scent of ${product.name}. A carefully crafted composition with rich notes.`,
        isPublished: true,
        isFeatured: true,
        isNewArrival: true,
        isBestSeller: true,
        createdById: "system"
      }
    });

    // Create/update variant profiles
    for (const [index, variant] of product.variants.entries()) {
      await prisma.productVariantStorefrontProfile.upsert({
        where: { productVariantId: variant.id },
        update: {
          isPublishedOnline: true,
          isDefaultWebsiteVariant: index === 0,
          compareAtPrice: Number(variant.retailPrice) * 1.2, // Seed a mock compare price
          websiteLabel: `${variant.volumeValue}${variant.volumeUnit || "ML"}`
        },
        create: {
          organizationId: variant.organizationId,
          productVariantId: variant.id,
          isPublishedOnline: true,
          isDefaultWebsiteVariant: index === 0,
          compareAtPrice: Number(variant.retailPrice) * 1.2,
          websiteLabel: `${variant.volumeValue}${variant.volumeUnit || "ML"}`
        }
      });
    }
  }

  console.log("Backfill completed successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
