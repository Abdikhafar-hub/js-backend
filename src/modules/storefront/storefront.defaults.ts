import {
  StorefrontCollectionType,
  StorefrontDestinationType,
  StorefrontSectionLayoutType,
  StorefrontSectionSourceType
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";

type DefaultCollectionSeed = {
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  type: StorefrontCollectionType;
  ruleConfig?: Record<string, unknown>;
  imageUrl?: string;
};

type DefaultSectionSeed = {
  key: string;
  page: string;
  title?: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  layoutType: StorefrontSectionLayoutType;
  sourceType: StorefrontSectionSourceType;
  maxItems?: number;
  displayOrder: number;
  settings?: Record<string, unknown>;
};

type DefaultContentCardSeed = {
  title: string;
  subtitle?: string;
  description?: string;
  eyebrow?: string;
  imageUrl?: string;
  destinationType?: StorefrontDestinationType;
  destinationValue?: string;
  ctaLabel?: string;
  displayOrder: number;
  settings?: Record<string, unknown>;
};

export const STOREFRONT_SECTION_KEYS = {
  homeHero: "HOME_HERO",
  homeQuickLinks: "HOME_QUICK_LINKS",
  homeFeaturedCollectionCards: "HOME_FEATURED_COLLECTION_CARDS",
  homeOudRitualCards: "HOME_OUD_RITUAL_CARDS",
  homeArabicCards: "HOME_ARABIC_COLLECTION_CARDS",
  homeSpaceCards: "HOME_SCENTS_FOR_EVERY_SPACE_CARDS",
  homeNewInStore: "HOME_NEW_IN_STORE",
  homeOnOffer: "HOME_ON_OFFER",
  homeBestSellers: "HOME_BEST_SELLERS",
  homeBrandMarquee: "HOME_BRAND_MARQUEE",
  homeOccasions: "HOME_OCCASION_CHIPS",
  homeGiftCards: "HOME_GIFT_CARDS"
} as const;

export const defaultStorefrontCollections: DefaultCollectionSeed[] = [
  {
    name: "Perfumes",
    slug: "perfumes",
    description: "Core perfume catalog route.",
    type: StorefrontCollectionType.CATEGORY,
    ruleConfig: { productTypes: ["PERFUME"] }
  },
  {
    name: "New Arrivals",
    slug: "new-arrivals",
    description: "Recently published products for the storefront.",
    type: StorefrontCollectionType.NEW_ARRIVALS,
    ruleConfig: { mode: "AUTO_RECENT_PUBLISH", fallbackToManual: true }
  },
  {
    name: "Best Sellers",
    slug: "best-sellers",
    description: "Curated or pinned best-selling products.",
    type: StorefrontCollectionType.BEST_SELLERS,
    ruleConfig: { mode: "MANUAL_OR_FLAG" }
  },
  {
    name: "On Offer",
    slug: "offers",
    description: "Products with compare-at pricing or promotional markdowns.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { mode: "AUTO_ON_OFFER", fallbackToManual: true }
  },
  {
    name: "Men",
    slug: "men",
    description: "Products targeted to men.",
    type: StorefrontCollectionType.MEN,
    ruleConfig: { genderTargets: ["MEN"] }
  },
  {
    name: "Women",
    slug: "women",
    description: "Products targeted to women.",
    type: StorefrontCollectionType.WOMEN,
    ruleConfig: { genderTargets: ["WOMEN"] }
  },
  {
    name: "Unisex",
    slug: "unisex",
    description: "Products targeted to everyone.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { genderTargets: ["UNISEX"] }
  },
  {
    name: "Arabic Collection",
    slug: "arabic-collection",
    description: "Arabic fragrance, incense, and ritual products.",
    type: StorefrontCollectionType.ARABIC,
    ruleConfig: { productTypes: ["OUD", "BAKHOOR", "BURNER", "OIL"] }
  },
  {
    name: "Luxury Gifting",
    slug: "luxury-gifting",
    description: "Gift-oriented products and curation.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { productTypes: ["GIFT_SET"] }
  },
  {
    name: "Niche",
    slug: "niche",
    description: "Curated niche fragrances.",
    type: StorefrontCollectionType.NICHE,
    ruleConfig: { mode: "MANUAL_ONLY" }
  },
  {
    name: "Ouds",
    slug: "ouds",
    description: "Oud fragrances and products.",
    type: StorefrontCollectionType.OUD,
    ruleConfig: { productTypes: ["OUD"], categorySlugs: ["ouds"] }
  },
  {
    name: "Bukhoors",
    slug: "bukhoors",
    description: "Traditional bukhoor products.",
    type: StorefrontCollectionType.BAKHOOR,
    ruleConfig: { productTypes: ["BAKHOOR"], categorySlugs: ["bukhoors"] }
  },
  {
    name: "Burners",
    slug: "incense-burners",
    description: "Burners and mabkharas.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { productTypes: ["BURNER"], categorySlugs: ["incense-burners", "burners"] }
  },
  {
    name: "Perfume Oils",
    slug: "perfume-oils",
    description: "Perfume oils and attars.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { productTypes: ["OIL"], categorySlugs: ["perfume-oils", "attars"] }
  },
  {
    name: "Air Fresheners",
    slug: "air-fresheners",
    description: "Air fresheners and household sprays.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["air-fresheners"] }
  },
  {
    name: "Room Sprays",
    slug: "room-sprays",
    description: "Room spray products.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["room-sprays", "air-fresheners"] }
  },
  {
    name: "Linen Sprays",
    slug: "linen-sprays",
    description: "Linen spray products.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["linen-sprays", "air-fresheners"] }
  },
  {
    name: "Car Fragrances",
    slug: "car-fragrances",
    description: "Car fragrance products.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["car-fragrances"] }
  },
  {
    name: "Creams",
    slug: "creams",
    description: "Perfumed body creams.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["creams"], productTypes: ["LOTION"] }
  },
  {
    name: "Home Fragrance",
    slug: "home-fragrance",
    description: "Broader home fragrance assortment.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { categorySlugs: ["home-fragrance", "air-fresheners", "room-sprays", "linen-sprays"] }
  },
  {
    name: "Gift Sets",
    slug: "gift-sets",
    description: "Gift set products.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { productTypes: ["GIFT_SET"], categorySlugs: ["gift-sets"] }
  },
  {
    name: "Aqua Collection",
    slug: "aqua",
    description: "Fresh aquatic fragrance curation.",
    type: StorefrontCollectionType.MANUAL,
    ruleConfig: { mode: "MANUAL_ONLY" }
  }
];

export const defaultStorefrontSections: DefaultSectionSeed[] = [
  {
    key: STOREFRONT_SECTION_KEYS.homeHero,
    page: "HOME",
    title: "Fragrance, Refined.",
    subtitle: "Authentic designer fragrances, rare niche perfumes, and timeless Arabic luxury.",
    layoutType: StorefrontSectionLayoutType.HERO,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 10,
    settings: {
      eyebrow: "EST. NAIROBI & MOMBASA",
      ctaPrimaryLabel: "SHOP COLLECTION",
      ctaPrimaryHref: "/shop",
      ctaSecondaryLabel: "VISIT OUR STORES",
      ctaSecondaryHref: "/about"
    }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeQuickLinks,
    page: "HOME",
    title: "Quick Links",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 20
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeNewInStore,
    page: "HOME",
    title: "New In Store",
    subtitle: "Fresh arrivals. Just landed.",
    ctaLabel: "Show All",
    ctaHref: "/shop",
    layoutType: StorefrontSectionLayoutType.PRODUCT_GRID,
    sourceType: StorefrontSectionSourceType.COLLECTION,
    maxItems: 8,
    displayOrder: 30,
    settings: { collectionSlug: "new-arrivals" }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeFeaturedCollectionCards,
    page: "HOME",
    title: "Featured Collections",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 40
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeOudRitualCards,
    page: "HOME",
    title: "Discover The World Of Oud & Bukhoor",
    subtitle: "Explore rich Arabic fragrance rituals, from premium ouds and traditional bukhoors to elegant burners and concentrated perfume oils.",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 50,
    settings: { eyebrow: "Ritual & Heritage" }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeArabicCards,
    page: "HOME",
    title: "Arabic Luxury Collection",
    subtitle: "Crafted for deep, lasting elegance — sourced from heritage perfumers.",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 60
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeSpaceCards,
    page: "HOME",
    title: "Scents For Every Space",
    subtitle: "Elevate your home, car and daily routine with long-lasting fragrance essentials.",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 70,
    settings: { eyebrow: "Scents For Every Space" }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeOnOffer,
    page: "HOME",
    title: "On Offer",
    subtitle: "Exceptional fragrances. Exceptional value.",
    ctaLabel: "Show All",
    ctaHref: "/category/offers",
    layoutType: StorefrontSectionLayoutType.PRODUCT_GRID,
    sourceType: StorefrontSectionSourceType.COLLECTION,
    maxItems: 4,
    displayOrder: 80,
    settings: { collectionSlug: "offers" }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeBestSellers,
    page: "HOME",
    title: "Best Sellers",
    subtitle: "Loved by our community.",
    ctaLabel: "Show All",
    ctaHref: "/category/best-sellers",
    layoutType: StorefrontSectionLayoutType.PRODUCT_GRID,
    sourceType: StorefrontSectionSourceType.COLLECTION,
    maxItems: 4,
    displayOrder: 90,
    settings: { collectionSlug: "best-sellers" }
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeBrandMarquee,
    page: "HOME",
    title: "SHOP BY BRAND",
    ctaLabel: "View All Brands",
    ctaHref: "/shop",
    layoutType: StorefrontSectionLayoutType.MARQUEE,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 100
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeOccasions,
    page: "HOME",
    title: "A Scent For Every Moment",
    subtitle: "Shop By Occasion",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 110
  },
  {
    key: STOREFRONT_SECTION_KEYS.homeGiftCards,
    page: "HOME",
    title: "Luxury Gifts For Every Occasion",
    subtitle: "Curated fragrance gifts for weddings, Eid, birthdays, corporate gifting and special moments.",
    layoutType: StorefrontSectionLayoutType.CONTENT_GRID,
    sourceType: StorefrontSectionSourceType.CONTENT_ONLY,
    displayOrder: 120,
    settings: { eyebrow: "Exquisite Presents" }
  }
];

export const defaultContentCardsBySectionKey: Record<string, DefaultContentCardSeed[]> = {
  [STOREFRONT_SECTION_KEYS.homeHero]: [
    { title: "Fragrance, Refined.", imageUrl: "/lifestyle/hero-1.jpg", displayOrder: 0, destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop" },
    { title: "Fragrance, Refined.", imageUrl: "/lifestyle/hero-2.jpg", displayOrder: 1, destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop" },
    { title: "Fragrance, Refined.", imageUrl: "/lifestyle/hero-3.jpg", displayOrder: 2, destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop" }
  ],
  [STOREFRONT_SECTION_KEYS.homeQuickLinks]: [
    {
      title: "Unisex",
      subtitle: "Scents without boundaries.",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/unisex",
      ctaLabel: "Shop Now",
      displayOrder: 0
    },
    {
      title: "Niche",
      subtitle: "Rare. Artistic. Distinct.",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/niche",
      ctaLabel: "Shop Now",
      displayOrder: 1
    },
    {
      title: "Gift Sets",
      subtitle: "Thoughtful. Ready to Gift.",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/gift-sets",
      ctaLabel: "Shop Now",
      displayOrder: 2
    }
  ],
  [STOREFRONT_SECTION_KEYS.homeFeaturedCollectionCards]: [
    {
      title: "NICHE FRAGRANCES",
      subtitle: "Rare. Artistic. Unforgettable. Discover unique scent creations crafted for true connoisseurs.",
      eyebrow: "Curated",
      imageUrl: "/categories/cat-niche.jpg",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/niche",
      ctaLabel: "Shop Now",
      displayOrder: 0
    },
    {
      title: "MEN",
      subtitle: "Strength. Presence. Distinction.",
      imageUrl: "/categories/cat-men.jpg",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/men",
      ctaLabel: "Shop Now",
      displayOrder: 1
    },
    {
      title: "WOMEN",
      subtitle: "Elegance in every note.",
      imageUrl: "/categories/cat-women.jpg",
      destinationType: StorefrontDestinationType.ROUTE,
      destinationValue: "/category/women",
      ctaLabel: "Shop Now",
      displayOrder: 2
    }
  ],
  [STOREFRONT_SECTION_KEYS.homeOudRitualCards]: [
    { title: "Premium Ouds", description: "Deep, mysterious woody notes crafted from rich agarwood.", imageUrl: "/lifestyle/hero-2.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/ouds", ctaLabel: "Shop Now", displayOrder: 0 },
    { title: "Traditional Bukhoors", description: "Fine woodchips soaked in fragrant oils to scent your home.", imageUrl: "/categories/bukhoors.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/bukhoors", ctaLabel: "Shop Now", displayOrder: 1 },
    { title: "Luxury Burners", description: "Exquisite metal and wood Mabkharas for incense burning.", imageUrl: "/categories/incense-burners.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/incense-burners", ctaLabel: "Shop Now", displayOrder: 2 },
    { title: "Perfume Oils & Attars", description: "Concentrated, alcohol-free perfume oils that last all day.", imageUrl: "/categories/perfume-oils.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/perfume-oils", ctaLabel: "Shop Now", displayOrder: 3 }
  ],
  [STOREFRONT_SECTION_KEYS.homeArabicCards]: [
    { title: "Ouds", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/ouds", displayOrder: 0 },
    { title: "Bukhoors", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/bukhoors", displayOrder: 1 },
    { title: "Perfume Oils", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/perfume-oils", displayOrder: 2 },
    { title: "Incense Burners", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/incense-burners", displayOrder: 3 },
    { title: "Home Fragrance", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/air-fresheners", displayOrder: 4 },
    { title: "Aqua Perfumes", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/aqua", displayOrder: 5 }
  ],
  [STOREFRONT_SECTION_KEYS.homeSpaceCards]: [
    { title: "Air Fresheners", subtitle: "Long lasting sprays", imageUrl: "/categories/air-fresheners.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/air-fresheners", displayOrder: 0 },
    { title: "Room Sprays", subtitle: "Instant scent refresh", imageUrl: "/categories/room-sprays.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/room-sprays", displayOrder: 1 },
    { title: "Linen Sprays", subtitle: "For fabrics & sheets", imageUrl: "/categories/linen-sprays.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/linen-sprays", displayOrder: 2 },
    { title: "Car Fragrances", subtitle: "Sensory journey", imageUrl: "/categories/car-fragrances.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/car-fragrances", displayOrder: 3 },
    { title: "Creams", subtitle: "Perfumed body hydration", imageUrl: "/categories/creams.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/creams", displayOrder: 4 },
    { title: "Home Scents", subtitle: "Rich ambient aromas", imageUrl: "/categories/home-fragrance.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/home-fragrance", displayOrder: 5 }
  ],
  [STOREFRONT_SECTION_KEYS.homeBrandMarquee]: [
    { title: "Lattafa", imageUrl: "/brands/lattafa.png", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Lattafa", displayOrder: 0 },
    { title: "Armaf", imageUrl: "/brands/armaf.webp", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Armaf", displayOrder: 1 },
    { title: "Rasasi", imageUrl: "/brands/rasasi.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Rasasi", displayOrder: 2 },
    { title: "Dior", imageUrl: "/brands/dior.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Dior", displayOrder: 3 },
    { title: "Chanel", imageUrl: "/brands/chanel.webp", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Chanel", displayOrder: 4 },
    { title: "Creed", imageUrl: "/brands/creed.png", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Creed", displayOrder: 5 },
    { title: "Tom Ford", imageUrl: "/brands/tomford.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Tom Ford", displayOrder: 6 },
    { title: "YSL", imageUrl: "/brands/ysl.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=YSL", displayOrder: 7 },
    { title: "Versace", imageUrl: "/brands/versace.png", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop?brand=Versace", displayOrder: 8 }
  ],
  [STOREFRONT_SECTION_KEYS.homeOccasions]: [
    { title: "Daily Wear", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop", displayOrder: 0 },
    { title: "Office", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop", displayOrder: 1 },
    { title: "Wedding", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/gift-sets", displayOrder: 2 },
    { title: "Eid Gifts", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/luxury-gifting", displayOrder: 3 },
    { title: "Date Night", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/shop", displayOrder: 4 },
    { title: "Corporate Gifts", destinationType: StorefrontDestinationType.URL, destinationValue: "https://wa.me/254799517888?text=Hi%2C%20I%27d%20like%20to%20request%20a%20quote%20for%20corporate%20gifting%20sets.", displayOrder: 5 },
    { title: "Luxury Gifting", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/luxury-gifting", displayOrder: 6 }
  ],
  [STOREFRONT_SECTION_KEYS.homeGiftCards]: [
    { title: "Wedding Gifts", subtitle: "Bridal scent boxes", imageUrl: "/categories/cat-women.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/luxury-gifting", displayOrder: 0 },
    { title: "Eid Gifts", subtitle: "Celebration gift sets", imageUrl: "/lifestyle/hero-3.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/luxury-gifting", displayOrder: 1 },
    { title: "Birthday Gifts", subtitle: "Personalized perfumes", imageUrl: "/categories/cat-gifts.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/gift-sets", displayOrder: 2 },
    { title: "Corporate Gifts", subtitle: "Luxury business gifts", imageUrl: "/lifestyle/moment-gift.jpg", destinationType: StorefrontDestinationType.URL, destinationValue: "https://wa.me/254799517888?text=Hi%2C%20I%27d%20like%20to%20request%20a%20quote%20for%20corporate%20gifting%20sets.", displayOrder: 3 },
    { title: "Premium Gift Boxes", subtitle: "Custom leather wrapping", imageUrl: "/lifestyle/hero-3.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/gift-sets", displayOrder: 4 },
    { title: "Gift Vouchers", subtitle: "Give the gift of choice", imageUrl: "/categories/cat-gifts.jpg", destinationType: StorefrontDestinationType.ROUTE, destinationValue: "/category/gift-vouchers", displayOrder: 5 }
  ]
};

const asJson = (value: Record<string, unknown> | undefined) =>
  value as Prisma.InputJsonValue | undefined;

export const ensureStorefrontDefaults = async (organizationId: string, actorId?: string | null) => {
  const collectionSlugs = defaultStorefrontCollections.map((collection) => collection.slug);
  const existingCollections = await prisma.storefrontCollection.findMany({
    where: {
      organizationId,
      slug: { in: collectionSlugs }
    },
    select: { slug: true }
  });

  const existingCollectionSlugSet = new Set(existingCollections.map((collection) => collection.slug));

  const missingCollections = defaultStorefrontCollections.filter(
    (collection) => !existingCollectionSlugSet.has(collection.slug)
  );

  if (missingCollections.length > 0) {
    await prisma.storefrontCollection.createMany({
      data: missingCollections.map((collection) => ({
        organizationId,
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        shortDescription: collection.shortDescription ?? collection.description,
        imageUrl: collection.imageUrl,
        type: collection.type,
        isPublished: true,
        displayOrder: 0,
        ruleConfig: asJson(collection.ruleConfig),
        publishedAt: new Date(),
        createdById: actorId ?? "system"
      }))
    });
  }

  const sectionKeys = defaultStorefrontSections.map((section) => section.key);
  const existingSections = await prisma.storefrontSection.findMany({
    where: {
      organizationId,
      key: { in: sectionKeys }
    },
    select: { id: true, key: true }
  });

  const existingSectionKeySet = new Set(existingSections.map((section) => section.key));
  const missingSections = defaultStorefrontSections.filter((section) => !existingSectionKeySet.has(section.key));

  if (missingSections.length > 0) {
    await prisma.storefrontSection.createMany({
      data: missingSections.map((section) => ({
        organizationId,
        key: section.key,
        page: section.page,
        title: section.title,
        subtitle: section.subtitle,
        description: section.description,
        imageUrl: section.imageUrl,
        ctaLabel: section.ctaLabel,
        ctaHref: section.ctaHref,
        layoutType: section.layoutType,
        sourceType: section.sourceType,
        maxItems: section.maxItems ?? 0,
        isActive: true,
        displayOrder: section.displayOrder,
        settings: asJson(section.settings),
        createdById: actorId ?? "system"
      }))
    });
  }

  const hydratedSections = await prisma.storefrontSection.findMany({
    where: {
      organizationId,
      key: { in: sectionKeys }
    },
    include: {
      contentCards: {
        select: { id: true }
      }
    }
  });

  for (const section of hydratedSections) {
    const defaultCards = defaultContentCardsBySectionKey[section.key];
    if (!defaultCards || section.contentCards.length > 0) {
      continue;
    }

    await prisma.storefrontContentCard.createMany({
      data: defaultCards.map((card) => ({
        organizationId,
        sectionId: section.id,
        title: card.title,
        subtitle: card.subtitle,
        description: card.description,
        eyebrow: card.eyebrow,
        imageUrl: card.imageUrl,
        destinationType: card.destinationType ?? StorefrontDestinationType.NONE,
        destinationValue: card.destinationValue,
        ctaLabel: card.ctaLabel,
        displayOrder: card.displayOrder,
        isActive: true,
        settings: asJson(card.settings)
      }))
    });
  }
};
