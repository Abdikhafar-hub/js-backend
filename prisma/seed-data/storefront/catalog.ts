import type {
  ConcentrationType,
  FragranceFamily,
  GenderTarget,
  PackagingType,
  ProductType,
  VolumeUnit
} from "@prisma/client";

import { houseProducts } from "./house-catalog.js";

export type StorefrontSeedProduct = {
  slug: string;
  name: string;
  brand: string;
  category: string;
  productType: ProductType;
  gender: GenderTarget;
  family?: FragranceFamily;
  concentration?: ConcentrationType;
  size: number;
  unit: VolumeUnit;
  packaging?: PackagingType;
  sku: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  cost: number;
  mediaFile: string;
  mediaSource: string;
  galleryMedia?: Array<{
    mediaFile: string;
    mediaSource: string;
    altText: string;
  }>;
  shortDescription: string;
  description: string;
  keywords: string[];
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  fragranceNotes?: {
    top?: string;
    heart?: string;
    base?: string;
  };
};

export const STOREFRONT_SEED_ORGANIZATION_ID = "org_pulse_perfumes";
export const STOREFRONT_SEED_GM_EMAIL = "gm@pulseperfumes.test";
export const STOREFRONT_SEED_BRANCH_CODE = "NBI-CBD";

export const categories = [
  ["Perfumes", "perfumes", "Eau de parfum, eau de toilette and parfum fragrances."],
  ["Ouds", "ouds", "Oud-led fragrances and agarwood compositions."],
  ["Bakhoor", "bakhoor", "Traditional scented incense for home fragrance rituals."],
  ["Burners", "burners", "Mabkharas and electric incense burners."],
  ["Perfume Oils and Attars", "perfume-oils", "Concentrated perfume oils and attars."],
  ["Air Fresheners", "air-fresheners", "Ready-to-use ambient fragrance sprays."],
  ["Room Sprays", "room-sprays", "Room fragrance sprays for living spaces."],
  ["Linen Sprays", "linen-sprays", "Fabric-safe fragrance sprays for linens and rooms."],
  ["Car Fragrances", "car-fragrances", "Compact diffusers created for vehicle interiors."],
  ["Creams and Lotions", "creams", "Perfumed body creams and moisturizing lotions."],
  ["Home Scents", "home-scents", "Reed diffusers and continuous home fragrance."],
  ["Gift Sets", "gift-sets", "Presentation-ready fragrance gift sets."],
  ["Gift Vouchers", "gift-vouchers", "JS Perfumes gift vouchers."],
] as const;

export const brands = [
  "Afnan",
  "Ajmal",
  "Al Haramain",
  "Almeri Oud",
  "Amouage",
  "Arabian Oud",
  "Armaf",
  "Creed",
  "Initio Parfums Privés",
  "Jo Malone London",
  "JS Perfumes",
  "Lattafa",
  "Maison Francis Kurkdjian",
  "Nishane",
  "Oudie",
  "Rasasi",
  "Swiss Arabian",
  "Tom Ford",
  "Xerjoff",
  "Yves Saint Laurent"
] as const;

const projectMedia = (filename: string) =>
  `Existing verified project media: js-perfumes-kenya-luxury-fragrances/public/products/${filename}`;

const lattafaMedia = (path: string) => `https://lattafa.com/product/${path}/`;

export const coreProducts: StorefrontSeedProduct[] = [
  {
    slug: "lattafa-asad-eau-de-parfum-100ml", name: "Lattafa Asad Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "SPICY", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-ASAD-100", price: 4500, compareAtPrice: 5200, stock: 28, cost: 2800, mediaFile: "lattafa-asad.jpg", mediaSource: lattafaMedia("asad"), shortDescription: "Warm spice, coffee, amber and vanilla.", description: "A bold amber-spicy Eau de Parfum built around black pepper, coffee, dry woods and a smooth vanilla base.", keywords: ["lattafa", "asad", "men", "amber", "spicy"], isBestSeller: true, fragranceNotes: { top: "Black pepper, pineapple, tobacco", heart: "Coffee, iris, patchouli", base: "Amber, vanilla, dry woods" }
  },
  {
    slug: "lattafa-khamrah-eau-de-parfum-100ml", name: "Lattafa Khamrah Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "UNISEX", family: "GOURMAND", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-KHAMRAH-100", price: 6200, stock: 22, cost: 3900, mediaFile: "lattafa-khamrah.jpg", mediaSource: lattafaMedia("khamrah"), shortDescription: "Cinnamon, dates, praline and vanilla.", description: "A rich unisex gourmand fragrance with warm spice, a date-and-praline heart and a resinous vanilla drydown.", keywords: ["lattafa", "khamrah", "unisex", "gourmand"], isBestSeller: true, fragranceNotes: { top: "Bergamot, cinnamon, nutmeg", heart: "Dates, praline, tuberose", base: "Vanilla, benzoin, amber wood" }
  },
  {
    slug: "lattafa-yara-eau-de-parfum-100ml", name: "Lattafa Yara Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "WOMEN", family: "FLORAL", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-YARA-100", price: 4200, stock: 31, cost: 2500, mediaFile: "lattafa-yara.jpg", mediaSource: lattafaMedia("yara"), shortDescription: "Soft florals, tropical fruit and creamy vanilla.", description: "A feminine Eau de Parfum balancing delicate florals and tropical fruit with a creamy, musky vanilla base.", keywords: ["lattafa", "yara", "women", "floral", "vanilla"], isBestSeller: true
  },
  {
    slug: "lattafa-fakhar-black-eau-de-parfum-100ml", name: "Lattafa Fakhar Black Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "FRESH", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-FAKHAR-BLK-100", price: 4800, compareAtPrice: 5600, stock: 19, cost: 3000, mediaFile: "lattafa-fakhar-black.jpg", mediaSource: lattafaMedia("fakhar-lattafa-men"), shortDescription: "Bergamot, marine notes, violet and patchouli.", description: "A fresh aromatic fragrance with bright bergamot, a clean marine accord and a polished mossy-woody finish.", keywords: ["lattafa", "fakhar", "men", "fresh"], isBestSeller: true, fragranceNotes: { top: "Bergamot, orris, marine accord", heart: "Violet, amber", base: "Oak moss, patchouli" }
  },
  {
    slug: "lattafa-khamrah-qahwa-eau-de-parfum-100ml", name: "Lattafa Khamrah Qahwa Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "UNISEX", family: "GOURMAND", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-KHAM-QAHWA-100", price: 6800, stock: 17, cost: 4200, mediaFile: "lattafa-khamrah-qahwa.jpg", mediaSource: lattafaMedia("khamrah-qahwa"), shortDescription: "Cardamom, praline, coffee and tonka.", description: "A coffee-accented interpretation of Khamrah, pairing lively spice and candied fruit with tonka, musk and vanilla.", keywords: ["lattafa", "khamrah qahwa", "coffee", "unisex"], isNewArrival: true, fragranceNotes: { top: "Ginger, cinnamon, cardamom", heart: "Praline, candied fruits, white flowers", base: "Coffee, tonka, musk, vanilla" }
  },
  {
    slug: "lattafa-asad-zanzibar-eau-de-parfum-100ml", name: "Lattafa Asad Zanzibar Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "SPICY", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-ASAD-ZAN-100", price: 5200, stock: 14, cost: 3200, mediaFile: "lattafa-asad-zanzibar.jpg", mediaSource: lattafaMedia("asad-zanzibar"), shortDescription: "Black pepper, sea lavender, coconut and incense.", description: "A tropical-spicy men’s fragrance with pepper and sea lavender over coconut water, iris, vanilla and incense.", keywords: ["lattafa", "asad zanzibar", "men", "coconut"], isNewArrival: true, fragranceNotes: { top: "Black pepper, sea lavender", heart: "Coconut water, iris", base: "Vanilla, incense" }
  },
  {
    slug: "lattafa-maahir-legacy-eau-de-parfum-100ml", name: "Lattafa Maahir Legacy Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "CITRUS", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-MAAHIR-LEG-100", price: 5500, stock: 13, cost: 3400, mediaFile: "lattafa-maahir-legacy.jpg", mediaSource: lattafaMedia("maahir-legacy"), shortDescription: "Citrus, aromatic herbs and clean woods.", description: "A bright aromatic fragrance led by citrus and herbs, settling into a clean woody-musky base suited to daytime wear.", keywords: ["lattafa", "maahir legacy", "men", "citrus"], isNewArrival: true
  },
  {
    slug: "lattafa-nebras-eau-de-parfum-100ml", name: "Lattafa Nebras Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "UNISEX", family: "GOURMAND", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-NEBRAS-100", price: 6500, stock: 12, cost: 4000, mediaFile: "lattafa-nebras.jpg", mediaSource: lattafaMedia("nebras"), shortDescription: "Red berries, cacao, vanilla and amber.", description: "A smooth unisex gourmand centered on berries, cacao and vanilla with a softly ambered, musky finish.", keywords: ["lattafa", "nebras", "unisex", "cacao", "vanilla"], isNewArrival: true
  },
  {
    slug: "lattafa-eclaire-eau-de-parfum-100ml", name: "Lattafa Eclaire Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "WOMEN", family: "GOURMAND", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-ECLAIRE-100", price: 7200, stock: 11, cost: 4500, mediaFile: "lattafa-eclaire.jpg", mediaSource: lattafaMedia("eclaire"), shortDescription: "Caramel, milk, honey and vanilla.", description: "A creamy gourmand Eau de Parfum blending caramel, milk and honey with white flowers, vanilla and soft musk.", keywords: ["lattafa", "eclaire", "women", "gourmand"], isNewArrival: true
  },
  {
    slug: "lattafa-yara-tous-eau-de-parfum-100ml", name: "Lattafa Yara Tous Eau de Parfum 100ml", brand: "Lattafa", category: "perfumes", productType: "PERFUME", gender: "WOMEN", family: "FLORAL", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-YARA-TOUS-100", price: 4900, stock: 16, cost: 3000, mediaFile: "lattafa-yara-tous.jpg", mediaSource: lattafaMedia("yara-tous"), shortDescription: "Mango, coconut, jasmine and vanilla.", description: "A sunny tropical floral featuring mango and coconut, a white-floral heart and a soft vanilla-musk base.", keywords: ["lattafa", "yara tous", "women", "tropical"], isNewArrival: true
  },
  {
    slug: "lattafa-badee-al-oud-amethyst-edp-100ml", name: "Lattafa Bade'e Al Oud Amethyst Eau de Parfum 100ml", brand: "Lattafa", category: "ouds", productType: "OUD", gender: "UNISEX", family: "ORIENTAL", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-BADEE-AMY-100", price: 5900, stock: 18, cost: 3600, mediaFile: "lattafa-badee-amethyst.jpg", mediaSource: projectMedia("badee-al-oud-amethyst.jpg"), shortDescription: "Pink pepper, rose, oud, amber and vanilla.", description: "A rose-forward oud composition with bright pepper, dense florals and an amber-vanilla foundation.", keywords: ["lattafa", "badee al oud", "amethyst", "oud"], fragranceNotes: { top: "Pink pepper, bergamot", heart: "Turkish rose, Bulgarian rose, jasmine", base: "Oud, amber, vanilla" }
  },
  {
    slug: "lattafa-badee-al-oud-honor-and-glory-100ml", name: "Lattafa Bade'e Al Oud Honor & Glory Eau de Parfum 100ml", brand: "Lattafa", category: "ouds", productType: "OUD", gender: "UNISEX", family: "GOURMAND", concentration: "EDP", size: 100, unit: "ML", sku: "LAT-BADEE-HG-100", price: 6200, stock: 15, cost: 3800, mediaFile: "lattafa-badee-honor-glory.jpg", mediaSource: projectMedia("badee-al-oud-glory.png"), shortDescription: "Pineapple, crème brûlée, spice and woods.", description: "A modern sweet-woody scent pairing pineapple and a creamy gourmand accord with spice, moss and woods.", keywords: ["lattafa", "honor and glory", "unisex", "oud"], isNewArrival: true
  },
  {
    slug: "armaf-club-de-nuit-intense-man-105ml", name: "Armaf Club de Nuit Intense Man Eau de Toilette 105ml", brand: "Armaf", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "CITRUS", concentration: "EDT", size: 105, unit: "ML", sku: "ARM-CDNIM-105", price: 7200, compareAtPrice: 8200, stock: 24, cost: 4600, mediaFile: "armaf-cdn-intense.jpg", mediaSource: projectMedia("armaf-cdn-intense.jpg"), shortDescription: "Citrus, fruit, birch and woods.", description: "A strong citrus-woody men’s fragrance with a fruity opening, smoky birch character and a musky drydown.", keywords: ["armaf", "club de nuit intense", "men"], isBestSeller: true
  },
  {
    slug: "creed-aventus-eau-de-parfum-100ml", name: "Creed Aventus Eau de Parfum 100ml", brand: "Creed", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "OTHER", concentration: "EDP", size: 100, unit: "ML", sku: "CRE-AVENTUS-100", price: 39500, stock: 7, cost: 29000, mediaFile: "creed-aventus.jpg", mediaSource: projectMedia("creed-aventus.jpg"), shortDescription: "Bergamot, fruit, birch and oakmoss.", description: "A premium fruity-woody Eau de Parfum with a bright opening and a structured birch, musk and oakmoss base.", keywords: ["creed", "aventus", "men", "premium"], isBestSeller: true
  },
  {
    slug: "creed-royal-oud-eau-de-parfum-100ml", name: "Creed Royal Oud Eau de Parfum 100ml", brand: "Creed", category: "ouds", productType: "OUD", gender: "MEN", family: "WOODY", concentration: "EDP", size: 100, unit: "ML", sku: "CRE-ROYAL-OUD-100", price: 40000, stock: 6, cost: 29500, mediaFile: "creed-royal-oud.jpg", mediaSource: projectMedia("creed-royal-oud.jpg"), shortDescription: "Citrus, cedar, spice and oud.", description: "A refined woody fragrance where citrus and spice introduce a polished cedar-and-oud composition.", keywords: ["creed", "royal oud", "men", "premium"]
  },
  {
    slug: "tom-ford-oud-wood-eau-de-parfum-100ml", name: "Tom Ford Oud Wood Eau de Parfum 100ml", brand: "Tom Ford", category: "ouds", productType: "OUD", gender: "UNISEX", family: "WOODY", concentration: "EDP", size: 100, unit: "ML", sku: "TF-OUWOOD-100", price: 38000, stock: 8, cost: 27500, mediaFile: "tom-ford-oud-wood.jpg", mediaSource: projectMedia("tom-ford-oud-wood.jpg"), shortDescription: "Oud, rosewood, cardamom and sandalwood.", description: "A smooth unisex woody fragrance with cardamom, rosewood, oud, sandalwood and warm amber tones.", keywords: ["tom ford", "oud wood", "unisex", "premium"], isBestSeller: true
  },
  {
    slug: "tom-ford-oud-wood-intense-100ml", name: "Tom Ford Oud Wood Intense Eau de Parfum 100ml", brand: "Tom Ford", category: "ouds", productType: "OUD", gender: "MEN", family: "WOODY", concentration: "EDP", size: 100, unit: "ML", sku: "TF-OUWOOD-INT-100", price: 40000, stock: 5, cost: 30000, mediaFile: "tom-ford-oud-wood-intense.jpg", mediaSource: projectMedia("tf-oud-wood-intense.jpg"), shortDescription: "Dense woods, cypress, juniper and oud.", description: "A deeper woody composition with cypress, juniper and oud for a dark, assertive profile.", keywords: ["tom ford", "oud wood intense", "men"]
  },
  {
    slug: "mfk-oud-satin-mood-eau-de-parfum-70ml", name: "Maison Francis Kurkdjian Oud Satin Mood Eau de Parfum 70ml", brand: "Maison Francis Kurkdjian", category: "ouds", productType: "OUD", gender: "UNISEX", family: "ORIENTAL", concentration: "EDP", size: 70, unit: "ML", sku: "MFK-OUD-SATIN-70", price: 40000, stock: 5, cost: 30000, mediaFile: "mfk-oud-satin-mood.jpg", mediaSource: projectMedia("mfk-oud-satin.jpg"), shortDescription: "Rose, violet, vanilla and oud.", description: "A rich unisex Eau de Parfum pairing rose and violet with vanilla, amber and oud.", keywords: ["maison francis kurkdjian", "oud satin mood", "unisex"]
  },
  {
    slug: "jo-malone-oud-and-bergamot-cologne-intense-100ml", name: "Jo Malone Oud & Bergamot Cologne Intense 100ml", brand: "Jo Malone London", category: "ouds", productType: "OUD", gender: "UNISEX", family: "CITRUS", concentration: "EDC", size: 100, unit: "ML", sku: "JML-OUD-BERG-100", price: 26500, stock: 9, cost: 19000, mediaFile: "jo-malone-oud-bergamot.jpg", mediaSource: projectMedia("jm-oud-bergamot.jpg"), shortDescription: "Bergamot, cedarwood and oud.", description: "A clear, elegant contrast of sparkling bergamot and dry cedarwood over a warm oud base.", keywords: ["jo malone", "oud bergamot", "unisex"]
  },
  {
    slug: "initio-oud-for-greatness-eau-de-parfum-90ml", name: "Initio Oud for Greatness Eau de Parfum 90ml", brand: "Initio Parfums Privés", category: "ouds", productType: "OUD", gender: "UNISEX", family: "SPICY", concentration: "EDP", size: 90, unit: "ML", sku: "INI-OUD-GREAT-90", price: 40000, stock: 6, cost: 30000, mediaFile: "initio-oud-greatness.jpg", mediaSource: projectMedia("initio-oud-greatness.jpg"), shortDescription: "Saffron, nutmeg, lavender and oud.", description: "A concentrated unisex oud fragrance framed by saffron, nutmeg, lavender, patchouli and musk.", keywords: ["initio", "oud for greatness", "unisex"]
  },
  {
    slug: "swiss-arabian-shaghaf-oud-75ml", name: "Swiss Arabian Shaghaf Oud Eau de Parfum 75ml", brand: "Swiss Arabian", category: "ouds", productType: "OUD", gender: "UNISEX", family: "ORIENTAL", concentration: "EDP", size: 75, unit: "ML", sku: "SWI-SHAGHAF-OUD-75", price: 7800, stock: 20, cost: 4900, mediaFile: "swiss-arabian-shaghaf-oud.jpg", mediaSource: projectMedia("shaghaf-oud.jpg"), shortDescription: "Saffron, rose, praline, vanilla and oud.", description: "A warm oriental composition layering saffron and rose over praline, vanilla and oud.", keywords: ["swiss arabian", "shaghaf oud", "unisex"], isBestSeller: true
  },
  {
    slug: "swiss-arabian-shaghaf-oud-aswad-75ml", name: "Swiss Arabian Shaghaf Oud Aswad Eau de Parfum 75ml", brand: "Swiss Arabian", category: "ouds", productType: "OUD", gender: "UNISEX", family: "ORIENTAL", concentration: "EDP", size: 75, unit: "ML", sku: "SWI-SHAGHAF-ASW-75", price: 8200, stock: 16, cost: 5200, mediaFile: "swiss-arabian-shaghaf-oud-aswad.jpg", mediaSource: projectMedia("shaghaf-oud-aswad.png"), shortDescription: "Rose, saffron, patchouli, amber and oud.", description: "A dark rose-and-oud Eau de Parfum with spicy saffron, earthy patchouli and a warm amber base.", keywords: ["swiss arabian", "shaghaf oud aswad", "unisex"]
  },
  {
    slug: "al-haramain-amber-oud-gold-edition-120ml", name: "Al Haramain Amber Oud Gold Edition Eau de Parfum 120ml", brand: "Al Haramain", category: "ouds", productType: "OUD", gender: "UNISEX", family: "OTHER", concentration: "EDP", size: 120, unit: "ML", sku: "ALH-AMBER-OUD-G-120", price: 11500, compareAtPrice: 13200, stock: 18, cost: 7500, mediaFile: "al-haramain-amber-oud-gold.jpg", mediaSource: projectMedia("amber-oud-gold.png"), shortDescription: "Fruity amber, vanilla and musk.", description: "A bright amber-fruity fragrance with a sweet vanilla and musk finish in the Amber Oud collection.", keywords: ["al haramain", "amber oud gold", "unisex"], isBestSeller: true
  },
  {
    slug: "afnan-supremacy-oud-eau-de-parfum-100ml", name: "Afnan Supremacy in Oud Eau de Parfum 100ml", brand: "Afnan", category: "ouds", productType: "OUD", gender: "UNISEX", family: "WOODY", concentration: "EDP", size: 100, unit: "ML", sku: "AFN-SUPREMACY-OUD-100", price: 9200, stock: 14, cost: 5900, mediaFile: "afnan-supremacy-oud.jpg", mediaSource: projectMedia("supremacy-oud.png"), shortDescription: "Saffron, spice, oud and amber.", description: "A dense woody-spicy fragrance with saffron, aromatic spice, oud and a warm amber trail.", keywords: ["afnan", "supremacy in oud", "unisex"]
  },
  {
    slug: "nishane-hundred-silent-ways-extrait-50ml", name: "Nishane Hundred Silent Ways Extrait de Parfum 50ml", brand: "Nishane", category: "perfumes", productType: "PERFUME", gender: "UNISEX", family: "FLORAL", concentration: "PARFUM", size: 50, unit: "ML", sku: "NIS-HSW-50", price: 28500, compareAtPrice: 32000, stock: 7, cost: 20500, mediaFile: "nishane-hundred-silent-ways.jpg", mediaSource: projectMedia("nishane-100-silent.jpg"), shortDescription: "White florals, peach, vanilla and woods.", description: "A concentrated floral-gourmand with soft fruit, white flowers and a smooth vanilla-woody base.", keywords: ["nishane", "hundred silent ways", "unisex", "extrait"]
  },
  {
    slug: "ysl-libre-eau-de-parfum-90ml", name: "Yves Saint Laurent Libre Eau de Parfum 90ml", brand: "Yves Saint Laurent", category: "perfumes", productType: "PERFUME", gender: "WOMEN", family: "FLORAL", concentration: "EDP", size: 90, unit: "ML", sku: "YSL-LIBRE-90", price: 23500, stock: 9, cost: 16800, mediaFile: "ysl-libre.jpg", mediaSource: projectMedia("ysl-libre.jpg"), shortDescription: "Lavender, orange blossom, vanilla and musk.", description: "A modern floral Eau de Parfum contrasting aromatic lavender with orange blossom and a warm vanilla base.", keywords: ["ysl", "libre", "women", "floral"], isBestSeller: true
  },
  {
    slug: "rasasi-la-yuqawam-ambergris-showers-75ml", name: "Rasasi La Yuqawam Ambergris Showers Eau de Parfum 75ml", brand: "Rasasi", category: "perfumes", productType: "PERFUME", gender: "MEN", family: "LEATHER", concentration: "EDP", size: 75, unit: "ML", sku: "RAS-LY-AMBER-75", price: 13500, stock: 10, cost: 8800, mediaFile: "rasasi-la-yuqawam-ambergris.jpg", mediaSource: projectMedia("la-yuqawam-ambergris.png"), shortDescription: "Ambergris, leather, spice and woods.", description: "A polished masculine leather fragrance with spicy woods and an ambergris-style mineral warmth.", keywords: ["rasasi", "la yuqawam", "men", "leather"]
  },
  {
    slug: "arabian-oud-kalemat-black-eau-de-parfum-100ml", name: "Arabian Oud Kalemat Black Eau de Parfum 100ml", brand: "Arabian Oud", category: "ouds", productType: "OUD", gender: "UNISEX", family: "ORIENTAL", concentration: "EDP", size: 100, unit: "ML", sku: "ARO-KALEMAT-BLK-100", price: 16500, stock: 11, cost: 11000, mediaFile: "arabian-oud-kalemat-black.jpg", mediaSource: projectMedia("kalemat-black.png"), shortDescription: "Fruit, honey, musk and oud.", description: "A full-bodied oriental fragrance balancing dark fruit and honeyed warmth with musk and oud.", keywords: ["arabian oud", "kalemat black", "unisex"]
  },
  {
    slug: "xerjoff-alexandria-ii-eau-de-parfum-50ml", name: "Xerjoff Alexandria II Eau de Parfum 50ml", brand: "Xerjoff", category: "ouds", productType: "OUD", gender: "UNISEX", family: "WOODY", concentration: "EDP", size: 50, unit: "ML", sku: "XER-ALEX-II-50", price: 40000, stock: 5, cost: 30000, mediaFile: "xerjoff-alexandria-ii.jpg", mediaSource: projectMedia("xerjoff-alexandria-ii.jpg"), shortDescription: "Lavender, cinnamon, rose and oud.", description: "A premium woody oriental fragrance combining aromatic lavender, warm spice, rose and oud.", keywords: ["xerjoff", "alexandria ii", "unisex"]
  },
  {
    slug: "amouage-epic-man-eau-de-parfum-100ml", name: "Amouage Epic Man Eau de Parfum 100ml", brand: "Amouage", category: "ouds", productType: "OUD", gender: "MEN", family: "SPICY", concentration: "EDP", size: 100, unit: "ML", sku: "AMO-EPIC-MAN-100", price: 40000, stock: 6, cost: 29500, mediaFile: "amouage-epic-man.jpg", mediaSource: projectMedia("amouage-epic-man.jpg"), shortDescription: "Spice, frankincense, myrrh and oud.", description: "A rich masculine spicy-woody fragrance shaped by incense, resins, leather and oud.", keywords: ["amouage", "epic man", "men", "incense"]
  },
  {
    slug: "afnan-bukhoor-incense-50g", name: "Afnan Bukhoor Incense 50g", brand: "Afnan", category: "bakhoor", productType: "BAKHOOR", gender: "NOT_APPLICABLE", size: 50, unit: "GRAM", sku: "AFN-BKH-050", price: 1800, stock: 48, cost: 900, mediaFile: "afnan-bukhoor.jpg", mediaSource: projectMedia("bukhoor-afnan.jpg"), shortDescription: "Warm floral woods for traditional incense burning.", description: "A ready-to-burn scented bakhoor blend for mabkhara use, presented in a practical 50g pack.", keywords: ["afnan", "bakhoor", "incense", "home"]
  },
  {
    slug: "afnan-al-dirham-bakhoor-40g", name: "Afnan Al Dirham Bakhoor 40g", brand: "Afnan", category: "bakhoor", productType: "BAKHOOR", gender: "NOT_APPLICABLE", size: 40, unit: "GRAM", sku: "AFN-DIRHAM-BKH-040", price: 2100, stock: 37, cost: 1100, mediaFile: "afnan-al-dirham-bakhoor.jpg", mediaSource: projectMedia("afnan-al-dirham-bukhoor.jpg"), shortDescription: "Rose, jasmine and warm oud incense.", description: "A compact 40g bakhoor presentation with floral and woody character for home fragrance rituals.", keywords: ["afnan", "al dirham", "bakhoor"]
  },
  {
    slug: "silver-hanging-mabkhara-incense-burner", name: "Silver Hanging Mabkhara Incense Burner", brand: "JS Perfumes", category: "burners", productType: "BURNER", gender: "NOT_APPLICABLE", size: 1, unit: "PIECE", sku: "JSP-MAB-SILVER-001", price: 4800, stock: 12, cost: 2600, mediaFile: "silver-hanging-mabkhara.jpg", mediaSource: projectMedia("custom-gold-burner.jpg"), shortDescription: "Decorative hanging mabkhara with electric heating base.", description: "A decorative silver-tone mabkhara designed for controlled indoor bukhoor and incense use.", keywords: ["mabkhara", "burner", "silver", "bakhoor"]
  },
  {
    slug: "electric-charcoal-incense-burner", name: "Electric Charcoal Incense Burner", brand: "JS Perfumes", category: "burners", productType: "BURNER", gender: "NOT_APPLICABLE", size: 1, unit: "PIECE", sku: "JSP-BURNER-ELEC-001", price: 3200, stock: 21, cost: 1700, mediaFile: "electric-charcoal-burner.jpg", mediaSource: projectMedia("traditional-mabkhara.jpg"), shortDescription: "Compact electric hot-plate burner for incense charcoal.", description: "A compact electric heating plate for preparing incense charcoal without an open stove flame.", keywords: ["electric burner", "charcoal", "incense"]
  },
  {
    slug: "ajmal-dahn-al-oudh-perfume-oil-75ml", name: "Ajmal Dahn Al Oudh Concentrated Perfume Oil 75ml", brand: "Ajmal", category: "perfume-oils", productType: "OIL", gender: "UNISEX", family: "WOODY", concentration: "PERFUME_OIL", size: 75, unit: "ML", sku: "AJM-DAHN-OUDH-75", price: 18000, stock: 8, cost: 12500, mediaFile: "ajmal-dahn-al-oudh.jpg", mediaSource: projectMedia("dahn-al-oudh.png"), shortDescription: "Concentrated woody oud perfume oil.", description: "A concentrated unisex perfume oil centered on deep woody oud character; apply sparingly to pulse points.", keywords: ["ajmal", "dahn al oudh", "perfume oil", "attar"]
  },
  {
    slug: "afnan-musk-abiyad-perfume-oil-20ml", name: "Afnan Musk Abiyad Concentrated Perfume Oil 20ml", brand: "Afnan", category: "perfume-oils", productType: "OIL", gender: "UNISEX", family: "MUSKY", concentration: "PERFUME_OIL", size: 20, unit: "ML", sku: "AFN-MUSK-ABIYAD-20", price: 3200, stock: 34, cost: 1800, mediaFile: "afnan-musk-abiyad-oil.jpg", mediaSource: projectMedia("musk-abiyad-oil.jpg"), shortDescription: "White musk, soft woods and rose.", description: "A compact concentrated perfume oil with clean musk, delicate rose and a soft woody base.", keywords: ["afnan", "musk abiyad", "oil", "attar"]
  },
  {
    slug: "lattafa-ramz-air-freshener-300ml", name: "Lattafa Ramz Air Freshener 300ml", brand: "Lattafa", category: "air-fresheners", productType: "BODY_SPRAY", gender: "NOT_APPLICABLE", size: 300, unit: "ML", sku: "LAT-RAMZ-AF-300", price: 1800, compareAtPrice: 2200, stock: 56, cost: 950, mediaFile: "lattafa-ramz-air-freshener.jpg", mediaSource: lattafaMedia("ramz-lattafa-air-freshener"), shortDescription: "Ramz-inspired ambient fragrance spray.", description: "A 300ml Lattafa ambient spray for quickly refreshing rooms and shared spaces.", keywords: ["lattafa", "ramz", "air freshener", "home"], isNewArrival: true
  },
  {
    slug: "lattafa-fakhar-men-air-freshener-300ml", name: "Lattafa Fakhar Men Air Freshener 300ml", brand: "Lattafa", category: "air-fresheners", productType: "BODY_SPRAY", gender: "NOT_APPLICABLE", size: 300, unit: "ML", sku: "LAT-FAKHAR-AF-300", price: 1800, stock: 49, cost: 950, mediaFile: "lattafa-fakhar-men-air-freshener.jpg", mediaSource: lattafaMedia("fakhar-lattafa-men-air-freshener"), shortDescription: "Fresh aromatic Fakhar ambient spray.", description: "A 300ml home air freshener carrying the clean aromatic character of Fakhar Lattafa Men.", keywords: ["lattafa", "fakhar", "air freshener"]
  },
  {
    slug: "lattafa-yara-room-spray-300ml", name: "Lattafa Yara Room Spray 300ml", brand: "Lattafa", category: "room-sprays", productType: "BODY_SPRAY", gender: "NOT_APPLICABLE", size: 300, unit: "ML", sku: "LAT-YARA-ROOM-300", price: 1900, stock: 45, cost: 1000, mediaFile: "lattafa-yara-room-spray.jpg", mediaSource: projectMedia("lattafa-yara-room-spray.jpg"), shortDescription: "Sweet floral and creamy vanilla room fragrance.", description: "A room spray with the soft floral, tropical and creamy character associated with Lattafa Yara.", keywords: ["lattafa", "yara", "room spray"]
  },
  {
    slug: "almeri-magical-oud-room-and-linen-spray-250ml", name: "Almeri Oud Magical Oud Room & Linen Spray 250ml", brand: "Almeri Oud", category: "linen-sprays", productType: "BODY_SPRAY", gender: "NOT_APPLICABLE", size: 250, unit: "ML", sku: "ALM-MAG-OUD-LINEN-250", price: 2600, stock: 32, cost: 1400, mediaFile: "almeri-magical-oud-linen-spray.jpg", mediaSource: "https://almerioud.id/products/magical-oud-linen-spray", shortDescription: "Water-based oud room and linen spray.", description: "A 250ml water-based room and linen spray with blackberry, saffron, florals, cinnamon and oud character.", keywords: ["almeri oud", "linen spray", "room spray", "oud"]
  },
  {
    slug: "oudie-black-cube-car-diffuser-8ml", name: "Oudie Black Cube Car Fragrance Diffuser 8ml", brand: "Oudie", category: "car-fragrances", productType: "ACCESSORIES", gender: "NOT_APPLICABLE", size: 8, unit: "ML", sku: "OUDIE-CAR-BLK-008", price: 2400, stock: 41, cost: 1250, mediaFile: "oudie-car-diffuser.jpg", mediaSource: "https://www.oudie.ca/products/deluxe-oudie-car-freshner", shortDescription: "Compact hanging car fragrance diffuser.", description: "A refillable 8ml black-cube car diffuser designed to release fragrance gradually inside the vehicle.", keywords: ["oudie", "car diffuser", "car fragrance"]
  },
  {
    slug: "lattafa-yara-perfumed-body-cream-45g", name: "Lattafa Yara Perfumed Body Cream 45g", brand: "Lattafa", category: "creams", productType: "LOTION", gender: "WOMEN", size: 45, unit: "GRAM", sku: "LAT-YARA-CREAM-045", price: 1900, stock: 44, cost: 950, mediaFile: "lattafa-yara-body-cream.jpg", mediaSource: projectMedia("yara-body-cream.jpg"), shortDescription: "Yara-scented moisturizing body cream.", description: "A compact perfumed body cream with Yara’s sweet floral and creamy vanilla character.", keywords: ["lattafa", "yara", "body cream", "women"]
  },
  {
    slug: "musk-silk-moisturizing-body-lotion-250ml", name: "Musk Silk Moisturizing Body Lotion 250ml", brand: "JS Perfumes", category: "creams", productType: "LOTION", gender: "UNISEX", size: 250, unit: "ML", sku: "JSP-MUSK-SILK-250", price: 2200, stock: 38, cost: 1100, mediaFile: "musk-silk-body-lotion.jpg", mediaSource: projectMedia("musk-silk-cream.jpg"), shortDescription: "Lightly perfumed white-musk body lotion.", description: "A daily moisturizing lotion with a soft white-musk scent and a non-overpowering finish.", keywords: ["musk", "body lotion", "unisex"]
  },
  {
    slug: "arabian-oud-rosewood-reed-diffuser-145ml", name: "Arabian Oud Rosewood Reed Diffuser 145ml", brand: "Arabian Oud", category: "home-scents", productType: "ACCESSORIES", gender: "NOT_APPLICABLE", size: 145, unit: "ML", sku: "ARO-ROSEWOOD-DIFF-145", price: 12500, stock: 13, cost: 7800, mediaFile: "arabian-oud-rosewood-diffuser.jpg", mediaSource: "https://sa.arabianoud.com/en/0304010003-rosewood-reed-diffuser", shortDescription: "Continuous rosewood-inspired home fragrance.", description: "A 145ml reed diffuser that releases a steady rosewood-inspired Arabian Oud fragrance into home or office spaces.", keywords: ["arabian oud", "rosewood", "reed diffuser", "home scent"]
  },
  {
    slug: "lattafa-asad-three-piece-gift-set", name: "Lattafa Asad Three-Piece Gift Set", brand: "Lattafa", category: "gift-sets", productType: "GIFT_SET", gender: "MEN", size: 1, unit: "SET", packaging: "GIFT_SET", sku: "LAT-ASAD-GIFT-SET", price: 12500, compareAtPrice: 14500, stock: 9, cost: 7800, mediaFile: "lattafa-asad-gift-set.jpg", mediaSource: lattafaMedia("gift-set-asad-3-pcs-spray-deo-af"), shortDescription: "Asad fragrance, deodorant and air freshener set.", description: "A presentation-ready three-piece Asad set containing fragrance, deodorant and matching air freshener.", keywords: ["lattafa", "asad", "gift set", "men"], isNewArrival: true
  },
  {
    slug: "lattafa-yara-tous-gift-set", name: "Lattafa Yara Tous Gift Set", brand: "Lattafa", category: "gift-sets", productType: "GIFT_SET", gender: "WOMEN", size: 1, unit: "SET", packaging: "GIFT_SET", sku: "LAT-YARA-TOUS-GIFT", price: 14800, stock: 8, cost: 9200, mediaFile: "lattafa-yara-tous-gift-set.jpg", mediaSource: lattafaMedia("lattafa-gift-set-yara-tous-100ml-12ml-hairmist"), shortDescription: "Yara Tous 100ml, travel spray and hair mist.", description: "A feminine Yara Tous presentation set with a 100ml fragrance, travel spray and coordinating hair mist.", keywords: ["lattafa", "yara tous", "gift set", "women"], isNewArrival: true
  },
  {
    slug: "lattafa-badee-al-oud-amethyst-gift-set", name: "Lattafa Bade'e Al Oud Amethyst Gift Set", brand: "Lattafa", category: "gift-sets", productType: "GIFT_SET", gender: "UNISEX", size: 1, unit: "SET", packaging: "GIFT_SET", sku: "LAT-AMETHYST-GIFT", price: 15800, stock: 7, cost: 9800, mediaFile: "lattafa-amethyst-gift-set.jpg", mediaSource: lattafaMedia("lattafa-badee-al-oud-amethyest-giftset-perfume-deo-air-freshener"), shortDescription: "Amethyst perfume, deodorant and air freshener set.", description: "A coordinated Bade'e Al Oud Amethyst gift set with perfume, deodorant and home air freshener.", keywords: ["lattafa", "amethyst", "gift set", "unisex"]
  },
  {
    slug: "js-perfumes-gift-voucher-kes-5000", name: "JS Perfumes Gift Voucher KSh 5,000", brand: "JS Perfumes", category: "gift-vouchers", productType: "GIFT_SET", gender: "NOT_APPLICABLE", size: 1, unit: "PIECE", packaging: "GIFT_SET", sku: "JSP-VOUCHER-5000", price: 5000, stock: 50, cost: 5000, mediaFile: "js-perfumes-gift-voucher.jpg", mediaSource: projectMedia("gift-voucher.jpg"), shortDescription: "Redeemable JS Perfumes gift voucher.", description: "A KSh 5,000 JS Perfumes voucher for gifting fragrance choice; redemption terms are provided at purchase.", keywords: ["js perfumes", "gift voucher", "gift"]
  }
];

export const products: StorefrontSeedProduct[] = [...coreProducts, ...houseProducts];

const uniqueSlugs = (...groups: string[][]) => [...new Set(groups.flat())];
const byCategory = (slug: string) => products.filter((product) => product.category === slug).map((product) => product.slug);
const houseByCategory = (slug: string) => houseProducts.filter((product) => product.category === slug).map((product) => product.slug);
const giftSetSlugs = byCategory("gift-sets");
const voucherSlugs = byCategory("gift-vouchers");

export const collections = [
  { slug: "new-arrivals", name: "New Arrivals", type: "NEW_ARRIVALS", products: products.filter((product) => product.isNewArrival).map((product) => product.slug) },
  { slug: "best-sellers", name: "Best Sellers", type: "BEST_SELLERS", products: products.filter((product) => product.isBestSeller).map((product) => product.slug) },
  { slug: "arabic-collection", name: "Arabic Collection", type: "ARABIC", products: uniqueSlugs(
    products.filter((product) => ["Lattafa", "Afnan", "Ajmal", "Al Haramain", "Arabian Oud", "Rasasi", "Swiss Arabian", "Amouage", "Almeri Oud"].includes(product.brand)).map((product) => product.slug),
    houseByCategory("ouds").slice(0, 12), houseByCategory("bakhoor").slice(0, 8), houseByCategory("perfume-oils").slice(0, 8)
  ) },
  { slug: "niche-fragrances", name: "Niche Fragrances", type: "NICHE", products: uniqueSlugs(
    products.filter((product) => ["Creed", "Initio Parfums Privés", "Maison Francis Kurkdjian", "Nishane", "Xerjoff", "Amouage"].includes(product.brand)).map((product) => product.slug),
    houseByCategory("perfumes").slice(0, 13)
  ) },
  { slug: "offers", name: "On Offer", type: "MANUAL", products: products.filter((product) => product.compareAtPrice).map((product) => product.slug) },
  { slug: "wedding-gifts", name: "Wedding Gifts", type: "MANUAL", products: uniqueSlugs(
    giftSetSlugs.filter((slug) => /wedding|bride|groom|anniversary|bridal|groomsmen|rose|celebration/.test(slug)), giftSetSlugs.slice(0, 20)
  ).slice(0, 20) },
  { slug: "eid-gifts", name: "Eid Gifts", type: "MANUAL", products: uniqueSlugs(
    giftSetSlugs.filter((slug) => /eid|ramadan|oud|bakhoor|ritual|festive|majlis/.test(slug)),
    voucherSlugs.filter((slug) => slug.includes("eid")), giftSetSlugs.slice(0, 20)
  ).slice(0, 20) },
  { slug: "birthday-gifts", name: "Birthday Gifts", type: "MANUAL", products: uniqueSlugs(
    giftSetSlugs.filter((slug) => /birthday|celebration|discovery|congratulations|thank-you/.test(slug)),
    voucherSlugs.filter((slug) => /birthday|celebration|discovery/.test(slug)), giftSetSlugs.slice(0, 20)
  ).slice(0, 20) },
  { slug: "corporate-gifts", name: "Corporate Gifts", type: "MANUAL", products: uniqueSlugs(
    giftSetSlugs.filter((slug) => /executive|corporate|client|thank-you|premium|welcome/.test(slug)),
    voucherSlugs.filter((slug) => /corporate|thank-you|premium/.test(slug)), giftSetSlugs.slice(18, 37)
  ).slice(0, 20) },
  { slug: "premium-gift-boxes", name: "Premium Gift Boxes", type: "MANUAL", products: uniqueSlugs(
    giftSetSlugs.filter((slug) => /premium|luxury|royal|signature|velvet|wardrobe|reserve|oud/.test(slug)), giftSetSlugs.slice(0, 24)
  ).slice(0, 20) }
] as const;

export const homepagePlacements = {
  HOME_NEW_IN_STORE: products.filter((product) => product.isNewArrival).slice(0, 8).map((product) => product.slug),
  HOME_ON_OFFER: products.filter((product) => product.compareAtPrice).slice(0, 8).map((product) => product.slug),
  HOME_BEST_SELLERS: products.filter((product) => product.isBestSeller).slice(0, 8).map((product) => product.slug)
} as const;

export const contentCards = [
  ["HOME_FEATURED_COLLECTION_CARDS", "Niche Fragrances", "Rare artistic compositions", "/categories/cat-niche.jpg", "/category/niche-fragrances"],
  ["HOME_FEATURED_COLLECTION_CARDS", "MEN", "Fragrances selected for him", "/categories/cat-men.jpg", "/category/men"],
  ["HOME_FEATURED_COLLECTION_CARDS", "WOMEN", "Fragrances selected for her", "/categories/cat-women.jpg", "/category/women"],
  ["HOME_OUD_RITUAL_CARDS", "Oud", "Deep, layered agarwood compositions", "/categories/ouds.jpg", "/category/ouds"],
  ["HOME_OUD_RITUAL_CARDS", "Bakhoor", "Traditional incense for the home", "/categories/bukhoors.jpg", "/category/bakhoor"],
  ["HOME_OUD_RITUAL_CARDS", "Burners", "Mabkharas and electric burners", "/categories/incense-burners.jpg", "/category/burners"],
  ["HOME_OUD_RITUAL_CARDS", "Perfume Oils", "Concentrated oils and attars", "/categories/perfume-oils.jpg", "/category/perfume-oils"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Air Fresheners", "Quick ambient fragrance", "/categories/air-fresheners.jpg", "/category/air-fresheners"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Room Sprays", "Fragrance for living spaces", "/categories/room-sprays.jpg", "/category/room-sprays"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Linen Sprays", "Fresh fragrance for fabrics", "/categories/linen-sprays.jpg", "/category/linen-sprays"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Car Fragrances", "A refined drive, every day", "/categories/car-fragrances.jpg", "/category/car-fragrances"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Creams", "Perfumed body care", "/categories/creams.jpg", "/category/creams"],
  ["HOME_SCENTS_FOR_EVERY_SPACE_CARDS", "Home Scents", "Reed diffusers for continuous scent", "/categories/home-fragrance.jpg", "/category/home-scents"],
  ["HOME_GIFT_CARDS", "Gift Sets", "Presentation-ready fragrance and home scent sets", "/lifestyle/hero-3.jpg", "/category/gift-sets"],
  ["HOME_GIFT_CARDS", "Wedding Gifts", "Presentation-ready fragrance gifts", "/categories/cat-women.jpg", "/category/wedding-gifts"],
  ["HOME_GIFT_CARDS", "Eid Gifts", "Fragrance and ritual gifts", "/categories/ouds.jpg", "/category/eid-gifts"],
  ["HOME_GIFT_CARDS", "Birthday Gifts", "Thoughtful fragrance selections", "/categories/cat-niche.jpg", "/category/birthday-gifts"],
  ["HOME_GIFT_CARDS", "Corporate Gifts", "Curated business gifting", "/lifestyle/about-store-interior.png", "/category/corporate-gifts"],
  ["HOME_GIFT_CARDS", "Premium Gift Boxes", "Complete fragrance presentations", "/lifestyle/hero-3.jpg", "/category/premium-gift-boxes"],
  ["HOME_GIFT_CARDS", "Gift Vouchers", "Give the freedom to choose", "/lifestyle/hero-1.jpg", "/category/gift-vouchers"]
] as const;
