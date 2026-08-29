import type { StorefrontSeedProduct } from "./catalog.js";

type HouseCategoryConfig = {
  category: string;
  code: string;
  productType: StorefrontSeedProduct["productType"];
  entries: readonly string[];
  size: (index: number) => { value: number; unit: StorefrontSeedProduct["unit"] };
  price: (index: number) => number;
  stock: (index: number) => number;
  description: (name: string, index: number) => { short: string; long: string; keywords: string[] };
  gender?: (index: number) => StorefrontSeedProduct["gender"];
  family?: (index: number) => StorefrontSeedProduct["family"];
  concentration?: StorefrontSeedProduct["concentration"];
  packaging?: StorefrontSeedProduct["packaging"];
  gallery?: boolean;
};

const slugify = (value: string) => value
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const scentProfile = (name: string) => name
  .replace(/^JS Perfumes /, "")
  .replace(/ (Eau de Parfum|Oud Eau de Parfum|Bakhoor|Perfume Oil|Air Freshener|Room Spray|Linen Spray|Car Fragrance|Body Lotion|Body Cream|Reed Diffuser|Scented Candle|Gift Set).*$/, "")
  .toLowerCase();

const originalMediaSource = (category: string, sheet: number, view: string) =>
  `Original AI-assisted JS Perfumes house-brand product mockup; OpenAI image generation; ${category} source sheet ${sheet}, ${view}; generated 2026-07-17; commercial packaging and licensing review required before production use.`;

const perfumeNames = [
  "Nairobi Nocturne Eau de Parfum", "Savannah Citrus Eau de Parfum", "Coastal Neroli Eau de Parfum",
  "Rift Valley Vetiver Eau de Parfum", "Amber Dusk Eau de Parfum", "Fig and Cedar Eau de Parfum",
  "White Tea Bloom Eau de Parfum", "Mombasa Moon Eau de Parfum", "Scarlet Hibiscus Eau de Parfum",
  "Santal Rain Eau de Parfum", "Acacia Blossom Eau de Parfum", "Midnight Cardamom Eau de Parfum",
  "Golden Tamarind Eau de Parfum", "Jasmine Coast Eau de Parfum", "Velvet Cassis Eau de Parfum",
  "Atlas Cedar Eau de Parfum", "Pink Pepper Silk Eau de Parfum", "Mandarin Suede Eau de Parfum",
  "Vanilla Rooibos Eau de Parfum", "Musk Terrace Eau de Parfum", "Green Fig Reserve Eau de Parfum",
  "Tuberose Dawn Eau de Parfum", "Cacao Tonka Eau de Parfum", "Bergamot Canvas Eau de Parfum",
  "Saffron Orchid Eau de Parfum"
] as const;

const oudNames = [
  "Royal Amber Oud Eau de Parfum", "Rosewood Oud Eau de Parfum", "Saffron Cedar Oud Eau de Parfum",
  "Smoky Vetiver Oud Eau de Parfum", "Velvet Rose Oud Eau de Parfum", "Honeyed Resin Oud Eau de Parfum",
  "Midnight Leather Oud Eau de Parfum", "White Musk Oud Eau de Parfum", "Incense Fig Oud Eau de Parfum",
  "Spiced Plum Oud Eau de Parfum", "Citrus Majlis Oud Eau de Parfum", "Dark Patchouli Oud Eau de Parfum",
  "Vanilla Ember Oud Eau de Parfum", "Jasmine Smoke Oud Eau de Parfum", "Cardamom Suede Oud Eau de Parfum",
  "Sandalwood Oud Eau de Parfum", "Black Tea Oud Eau de Parfum", "Ambergris Oud Eau de Parfum",
  "Rose Saffron Oud Eau de Parfum", "Cocoa Resin Oud Eau de Parfum", "Juniper Oud Eau de Parfum",
  "Mineral Oud Eau de Parfum", "Tobacco Blossom Oud Eau de Parfum", "Cashmere Oud Eau de Parfum",
  "Frankincense Oud Eau de Parfum"
] as const;

const bakhoorNames = [
  "Amber Oud Bakhoor", "Rose Musk Bakhoor", "Saffron Majlis Bakhoor", "Sandalwood Ember Bakhoor",
  "Frankincense Cedar Bakhoor", "White Musk Bakhoor", "Velvet Rose Bakhoor", "Spiced Plum Bakhoor",
  "Vanilla Resin Bakhoor", "Jasmine Oud Bakhoor", "Cardamom Amber Bakhoor", "Patchouli Smoke Bakhoor",
  "Citrus Incense Bakhoor", "Honeyed Wood Bakhoor", "Midnight Oud Bakhoor", "Cashmere Musk Bakhoor",
  "Tobacco Saffron Bakhoor", "Fig and Cedar Bakhoor"
] as const;

const burnerNames = [
  "Royal Brass Mabkhara Burner", "Ivory Arch Electric Burner", "Midnight Ceramic Electric Burner",
  "Marble Halo Electric Burner", "Copper Lattice Mabkhara Burner", "Forest Stoneware Burner",
  "Geometric Gold Mabkhara Burner", "Black Lantern Charcoal Burner", "Pearl Ceramic Charcoal Burner",
  "Hanging Crescent Mabkhara Burner", "Tabletop Dome Brass Burner", "Modern Cube Electric Burner",
  "Sandstone Bowl Charcoal Burner", "Obsidian Teardrop Burner", "White Ribbed Ceramic Burner",
  "Bronze Filigree Mabkhara Burner", "Slate Column Electric Burner", "Gold Frame Ceramic Burner"
] as const;

const oilNames = [
  "Amber Musk Perfume Oil", "Rose Saffron Perfume Oil", "White Oud Perfume Oil", "Vanilla Sandalwood Perfume Oil",
  "Jasmine Silk Perfume Oil", "Citrus Cedar Perfume Oil", "Black Tea Perfume Oil", "Velvet Plum Perfume Oil",
  "Cardamom Suede Perfume Oil", "Fig and Amber Perfume Oil", "Tuberose Musk Perfume Oil", "Incense Vetiver Perfume Oil",
  "Honeyed Resin Perfume Oil", "Green Neroli Perfume Oil", "Cocoa Tonka Perfume Oil", "Cashmere Rose Perfume Oil",
  "Bergamot Oud Perfume Oil", "Midnight Patchouli Perfume Oil"
] as const;

const airNames = [
  "Green Tea Air Freshener", "Lavender Fields Air Freshener", "Ocean Breeze Air Freshener",
  "Rose Garden Air Freshener", "Cotton Cloud Air Freshener", "Lemon Verbena Air Freshener",
  "White Musk Air Freshener", "Vanilla Orchid Air Freshener", "Cedar Mist Air Freshener",
  "Orange Blossom Air Freshener", "Eucalyptus Rain Air Freshener", "Berry Bloom Air Freshener",
  "Sandalwood Air Freshener", "Jasmine Tea Air Freshener", "Fresh Linen Air Freshener",
  "Amber Woods Air Freshener", "Pine Terrace Air Freshener", "Coconut Water Air Freshener"
] as const;

const roomNames = [
  "Vanilla Sandalwood Room Spray", "Rose Musk Room Spray", "Coastal Neroli Room Spray",
  "Amber Cedar Room Spray", "White Tea Room Spray", "Lavender Cashmere Room Spray",
  "Fig Leaf Room Spray", "Saffron Woods Room Spray", "Jasmine Bloom Room Spray",
  "Citrus Grove Room Spray", "Green Vetiver Room Spray", "Black Tea Room Spray",
  "Tuberose Silk Room Spray", "Ocean Mineral Room Spray", "Cardamom Amber Room Spray",
  "Eucalyptus Mint Room Spray", "Cocoa Tonka Room Spray", "Pine and Cedar Room Spray",
  "Orange Blossom Room Spray"
] as const;

const linenNames = [
  "Rose Musk Linen Spray", "Cotton Cloud Linen Spray", "Lavender Cashmere Linen Spray",
  "White Tea Linen Spray", "Coastal Breeze Linen Spray", "Vanilla Orchid Linen Spray",
  "Jasmine Silk Linen Spray", "Cedar Mist Linen Spray", "Orange Blossom Linen Spray",
  "Green Fig Linen Spray", "Sandalwood Linen Spray", "Eucalyptus Rain Linen Spray",
  "Neroli Cotton Linen Spray", "Amber Veil Linen Spray", "Violet Leaf Linen Spray",
  "Lemon Verbena Linen Spray", "Soft Peony Linen Spray", "Fresh Bamboo Linen Spray",
  "Musk Terrace Linen Spray"
] as const;

const carNames = [
  "Ocean Breeze Car Fragrance", "Amber Leather Car Fragrance", "Citrus Cedar Car Fragrance",
  "White Musk Car Fragrance", "Vanilla Suede Car Fragrance", "Green Vetiver Car Fragrance",
  "Rosewood Car Fragrance", "Black Tea Car Fragrance", "Coastal Neroli Car Fragrance",
  "Sandalwood Car Fragrance", "Fresh Linen Car Fragrance", "Pine Terrace Car Fragrance",
  "Cardamom Amber Car Fragrance", "Lavender Road Car Fragrance", "Fig Leaf Car Fragrance",
  "Jasmine Drive Car Fragrance", "Cocoa Tonka Car Fragrance", "Mineral Woods Car Fragrance",
  "Orange Blossom Car Fragrance"
] as const;

const creamNames = [
  "Rose Musk Body Lotion", "Vanilla Sandalwood Body Lotion", "White Tea Body Lotion",
  "Amber Silk Body Cream", "Lavender Cashmere Body Lotion", "Jasmine Bloom Body Cream",
  "Coconut Water Body Lotion", "Orange Blossom Body Lotion", "Green Fig Body Cream",
  "Tuberose Silk Body Lotion", "Cocoa Tonka Body Cream", "Violet Leaf Body Lotion",
  "Neroli Cotton Body Lotion", "Saffron Rose Body Cream", "Fresh Bamboo Body Lotion",
  "Honeyed Amber Body Cream", "Coastal Breeze Body Lotion", "Soft Peony Body Cream"
] as const;

const homeNames = [
  "Amber Cedar Reed Diffuser", "Rose Musk Reed Diffuser", "White Tea Reed Diffuser",
  "Coastal Neroli Reed Diffuser", "Vanilla Sandalwood Reed Diffuser", "Fig Leaf Reed Diffuser",
  "Lavender Cashmere Reed Diffuser", "Jasmine Bloom Reed Diffuser", "Black Tea Reed Diffuser",
  "Citrus Grove Scented Candle", "Saffron Woods Scented Candle", "Green Vetiver Scented Candle",
  "Cocoa Tonka Scented Candle", "Pine Terrace Scented Candle", "Orange Blossom Scented Candle",
  "Cotton Cloud Wax Melt Set", "Amber Resin Wax Melt Set", "Tuberose Silk Aroma Stone Set",
  "Ocean Mineral Diffuser Oil Set"
] as const;

const giftNames = [
  "Amber Oud Celebration Gift Set", "Rose Musk Wedding Gift Set", "Saffron Majlis Gift Set",
  "Coastal Neroli Discovery Gift Set", "White Tea and Linen Gift Set", "Royal Mabkhara Ritual Gift Set",
  "Vanilla Sandalwood Home Gift Set", "Men's Cedar and Vetiver Gift Set", "Women's Jasmine Silk Gift Set",
  "Unisex Amber Wardrobe Gift Set", "Eid Oud and Bakhoor Gift Set", "Ramadan Home Fragrance Gift Set",
  "Wedding Rose and Oud Gift Set", "Bride's Perfume Wardrobe Gift Set", "Groom's Fragrance Gift Set",
  "Anniversary Amber Pair Gift Set", "Birthday Citrus Discovery Gift Set", "Birthday Floral Discovery Gift Set",
  "Executive Desk Fragrance Gift Set", "Corporate Welcome Gift Set", "Client Appreciation Gift Set",
  "Premium Oud Presentation Gift Set", "Signature Perfume Trio Gift Set", "Home Scent Discovery Gift Set",
  "Bakhoor and Burner Ritual Gift Set", "Travel Fragrance Wardrobe Gift Set", "Mother's Rose Garden Gift Set",
  "Father's Cedar Reserve Gift Set", "New Home Fragrance Gift Set", "Thank You White Tea Gift Set",
  "Congratulations Saffron Gift Set", "Bridal Party Mini Fragrance Gift Set", "Groomsmen Amber Gift Set",
  "Festive Incense Collection Gift Set", "Premium Black and Gold Gift Set", "Velvet Rose Luxury Gift Set",
  "Coastal Retreat Premium Gift Set"
] as const;

const voucherNames = [
  "Birthday Gift Voucher KSh 1,000", "Birthday Gift Voucher KSh 2,000", "Birthday Gift Voucher KSh 3,000",
  "Wedding Gift Voucher KSh 2,000", "Wedding Gift Voucher KSh 5,000", "Wedding Gift Voucher KSh 10,000",
  "Eid Gift Voucher KSh 1,000", "Eid Gift Voucher KSh 3,000", "Eid Gift Voucher KSh 5,000",
  "Corporate Gift Voucher KSh 3,000", "Corporate Gift Voucher KSh 5,000", "Corporate Gift Voucher KSh 10,000",
  "Thank You Gift Voucher KSh 1,000", "Thank You Gift Voucher KSh 2,000", "Anniversary Gift Voucher KSh 5,000",
  "New Home Gift Voucher KSh 3,000", "Premium Gift Voucher KSh 7,500", "Fragrance Discovery Voucher KSh 2,000",
  "Celebration Gift Voucher KSh 10,000"
] as const;

const cycle = <T>(values: readonly T[], index: number): T => values[index % values.length]!;

const voucherAmount = (name: string) => Number(name.match(/KSh ([\d,]+)/)?.[1]?.replace(",", "") ?? 1000);

const fragranceDescription = (kind: "perfume" | "oud") => (name: string, index: number) => {
  const profile = scentProfile(name);
  const use = index % 2 === 0 ? "day-to-evening wear" : "evening and occasion wear";
  return {
    short: `A JS Perfumes house composition built around ${profile}.`,
    long: `Created for the JS Perfumes house collection, this ${kind === "oud" ? "oud-led " : ""}Eau de Parfum explores ${profile} in a balanced composition for ${use}. The formula specification is authored for this house line; final regulatory and packaging review remains required before commercial release.`,
    keywords: ["js perfumes", kind, ...profile.split(" ").slice(0, 3)]
  };
};

const configs: HouseCategoryConfig[] = [
  { category: "perfumes", code: "PERF", productType: "PERFUME", entries: perfumeNames, size: (i) => ({ value: cycle([50, 75, 100], i), unit: "ML" }), price: (i) => 5200 + (i % 8) * 800, stock: (i) => 7 + (i * 7) % 24, description: fragranceDescription("perfume"), gender: (i) => cycle(["MEN", "WOMEN", "UNISEX"] as const, i), family: (i) => cycle(["WOODY", "CITRUS", "FLORAL", "FRESH", "SPICY", "GOURMAND", "MUSKY"] as const, i), concentration: "EDP", gallery: true },
  { category: "ouds", code: "OUD", productType: "OUD", entries: oudNames, size: (i) => ({ value: cycle([50, 75, 100], i), unit: "ML" }), price: (i) => 6800 + (i % 9) * 950, stock: (i) => 6 + (i * 5) % 25, description: fragranceDescription("oud"), gender: (i) => cycle(["UNISEX", "MEN", "WOMEN"] as const, i), family: (i) => cycle(["ORIENTAL", "WOODY", "SPICY", "LEATHER", "FLORAL"] as const, i), concentration: "EDP", gallery: true },
  { category: "bakhoor", code: "BAK", productType: "BAKHOOR", entries: bakhoorNames, size: (i) => ({ value: cycle([50, 80, 100], i), unit: "GRAM" }), price: (i) => 1400 + (i % 8) * 550, stock: (i) => 14 + (i * 9) % 47, description: (name, i) => ({ short: `${scentProfile(name)} scented wood-chip incense in a sealed presentation jar.`, long: `${name} is a JS Perfumes house blend of scented wood chips designed for charcoal or temperature-controlled electric burners. Use a small amount in a ventilated room, keep away from children and heat-sensitive surfaces, and never leave burning incense unattended. Packaged in a sealed jar for home fragrance rituals.`, keywords: ["js perfumes", "bakhoor", scentProfile(name), i % 2 ? "electric burner" : "charcoal burner"] }) },
  { category: "burners", code: "BURN", productType: "BURNER", entries: burnerNames, size: () => ({ value: 1, unit: "PIECE" }), price: (i) => 2200 + (i % 9) * 900, stock: (i) => 5 + (i * 3) % 21, description: (name, i) => ({ short: `${i < 8 || [11, 16].includes(i) ? "Electric" : "Charcoal"} incense burner for safe tabletop fragrance rituals.`, long: `${name} is a stable ${i < 8 || [11, 16].includes(i) ? "temperature-controlled electric" : "heat-resistant charcoal"} incense burner for bakhoor and resin incense. Place it on a level heat-safe surface, follow the supplied operating instructions, keep ventilation clear and never leave it unattended while hot.`, keywords: ["js perfumes", "incense burner", "mabkhara", i < 8 ? "electric" : "charcoal"] }) },
  { category: "perfume-oils", code: "OIL", productType: "OIL", entries: oilNames, size: (i) => ({ value: cycle([6, 12, 20, 30], i), unit: "ML" }), price: (i) => 900 + (i % 8) * 380, stock: (i) => 18 + (i * 11) % 63, description: (name) => ({ short: `Concentrated ${scentProfile(name)} roll-on perfume oil.`, long: `${name} is a concentrated JS Perfumes house oil for pulse-point application. Apply sparingly with the roll-on or dabber and avoid eyes, broken skin and fabrics. The production formula and alcohol-free status must be confirmed on the final batch specification.`, keywords: ["js perfumes", "perfume oil", "attar", scentProfile(name)] }), concentration: "PERFUME_OIL" },
  { category: "air-fresheners", code: "AIR", productType: "BODY_SPRAY", entries: airNames, size: (i) => ({ value: cycle([300, 500], i), unit: "ML" }), price: (i) => 950 + (i % 7) * 330, stock: (i) => 20 + (i * 13) % 61, description: (name) => ({ short: `${scentProfile(name)} ambient spray for everyday rooms and shared spaces.`, long: `${name} is a ready-to-use JS Perfumes ambient fragrance for room air. Spray away from faces, flames, polished surfaces, food and pets; ventilate after use and follow the final packaging safety directions.`, keywords: ["js perfumes", "air freshener", scentProfile(name)] }) },
  { category: "room-sprays", code: "ROOM", productType: "BODY_SPRAY", entries: roomNames, size: (i) => ({ value: cycle([300, 500], i), unit: "ML" }), price: (i) => 1200 + (i % 8) * 350, stock: (i) => 17 + (i * 17) % 64, description: (name) => ({ short: `${scentProfile(name)} fine room mist for living and work spaces.`, long: `${name} is a JS Perfumes fine room mist designed for ambient use in living rooms, bedrooms and offices. Spray into open air, avoid direct use on people or delicate surfaces and keep away from heat and flame.`, keywords: ["js perfumes", "room spray", scentProfile(name)] }) },
  { category: "linen-sprays", code: "LINEN", productType: "BODY_SPRAY", entries: linenNames, size: () => ({ value: 500, unit: "ML" }), price: (i) => 1100 + (i % 7) * 300, stock: (i) => 19 + (i * 7) % 62, description: (name) => ({ short: `${scentProfile(name)} fine mist for washable linens and ambient room use.`, long: `${name} is a JS Perfumes fabric and linen mist. Patch test on an inconspicuous area, spray lightly from a distance and allow fabric to dry fully. Do not use on silk, leather or surfaces excluded by the final care label.`, keywords: ["js perfumes", "linen spray", "fabric mist", scentProfile(name)] }) },
  { category: "car-fragrances", code: "CAR", productType: "ACCESSORIES", entries: carNames, size: (i) => ({ value: cycle([8, 10, 12], i), unit: "ML" }), price: (i) => 650 + (i % 7) * 290, stock: (i) => 22 + (i * 9) % 59, description: (name, i) => ({ short: `${scentProfile(name)} ${i % 2 ? "hanging diffuser" : "vent-mounted diffuser"} for vehicle interiors.`, long: `${name} is a compact JS Perfumes ${i % 2 ? "hanging" : "vent-mounted"} vehicle diffuser. Install where it cannot obstruct controls or visibility, keep upright where applicable and wipe spills immediately to protect interior finishes.`, keywords: ["js perfumes", "car fragrance", "car diffuser", scentProfile(name)] }) },
  { category: "creams", code: "CARE", productType: "LOTION", entries: creamNames, size: (i) => ({ value: cycle([200, 250, 300], i), unit: "ML" }), price: (i) => 900 + (i % 8) * 360, stock: (i) => 16 + (i * 11) % 65, description: (name) => ({ short: `Daily perfumed body care with a ${scentProfile(name)} scent profile.`, long: `${name} is a JS Perfumes scented body-care product for external use. Massage a small amount onto clean skin, avoid eyes and discontinue use if irritation occurs. Ingredient, allergen and performance claims are subject to final batch and regulatory review.`, keywords: ["js perfumes", "body lotion", "body cream", scentProfile(name)] }) },
  { category: "home-scents", code: "HOME", productType: "ACCESSORIES", entries: homeNames, size: (i) => ({ value: i < 9 ? 150 : i < 15 ? 220 : 1, unit: i < 15 ? "ML" : "SET" }), price: (i) => 1800 + (i % 9) * 480, stock: (i) => 12 + (i * 13) % 49, description: (name, i) => ({ short: `${scentProfile(name)} home fragrance for steady scent in living spaces.`, long: `${name} is a JS Perfumes ${i < 9 ? "reed diffuser" : i < 15 ? "lidded scented candle" : "home scent set"} for living rooms, bedrooms and reception spaces. Follow the supplied setup and safety instructions, protect finished surfaces and keep away from children, pets and heat sources.`, keywords: ["js perfumes", "home scent", i < 9 ? "reed diffuser" : i < 15 ? "scented candle" : "home fragrance", scentProfile(name)] }) },
  { category: "gift-sets", code: "GIFT", productType: "GIFT_SET", entries: giftNames, size: () => ({ value: 1, unit: "SET" }), price: (i) => 4800 + (i % 12) * 1800, stock: (i) => 5 + (i * 5) % 16, description: (name, i) => ({ short: `Presentation-ready JS Perfumes set curated for ${scentProfile(name)} gifting.`, long: `${name} is supplied in a rigid presentation box and includes ${i % 3 === 0 ? "one house fragrance, a travel spray and a scented body-care item" : i % 3 === 1 ? "a coordinated home scent, room spray and linen mist" : "a curated fragrance, bakhoor and complementary accessory"}. Suitable for the occasion named, with a gift-message card available where supported at checkout.`, keywords: ["js perfumes", "gift set", ...scentProfile(name).split(" ").slice(0, 3)] }), gender: (i) => i < 12 ? "MEN" : i < 30 ? "WOMEN" : "UNISEX", packaging: "GIFT_SET", gallery: true },
  { category: "gift-vouchers", code: "VCHR", productType: "GIFT_SET", entries: voucherNames, size: () => ({ value: 1, unit: "PIECE" }), price: (i) => voucherAmount(voucherNames[i]!), stock: (i) => 40 + (i * 7) % 61, description: (name) => ({ short: `${name} redeemable against eligible JS Perfumes purchases.`, long: `${name} is an occasion-specific JS Perfumes voucher supplied with a presentation card. Redemption scope, validity period, exclusions, balance handling and anti-fraud controls follow the voucher terms issued at purchase.`, keywords: ["js perfumes", "gift voucher", ...scentProfile(name).split(" ").slice(0, 3)] }), packaging: "GIFT_SET" }
];

const makeProducts = (config: HouseCategoryConfig): StorefrontSeedProduct[] => config.entries.map((baseName, index) => {
  const size = config.size(index);
  const isVoucher = config.category === "gift-vouchers";
  const isBurner = config.category === "burners";
  const isGift = config.category === "gift-sets";
  const sizeLabel = size.unit === "ML" ? `${size.value}ml` : size.unit === "GRAM" ? `${size.value}g` : "";
  const name = (isVoucher || isBurner || isGift ? `JS Perfumes ${baseName}` : `JS Perfumes ${baseName} ${sizeLabel}`).trim();
  const slug = slugify(name);
  const sheet = Math.floor(index / 20) + 1;
  const details = config.description(name, index);
  const price = config.price(index);
  const mediaFile = `house/${config.category}/${slug}-primary.jpg`;
  const mediaSource = originalMediaSource(config.category, sheet, "primary catalog view");

  return {
    slug,
    name,
    brand: "JS Perfumes",
    category: config.category,
    productType: config.productType,
    gender: config.gender?.(index) ?? "NOT_APPLICABLE",
    family: config.family?.(index),
    concentration: config.concentration,
    size: size.value,
    unit: size.unit,
    packaging: config.packaging,
    sku: `JSP-${config.code}-${String(index + 1).padStart(3, "0")}`,
    price,
    compareAtPrice: index % 5 === 0 ? Math.ceil((price * 1.2) / 100) * 100 : undefined,
    stock: config.stock(index),
    cost: isVoucher ? price : Math.round(price * 0.58),
    mediaFile,
    mediaSource,
    galleryMedia: config.gallery ? [
      { mediaFile: `house/${config.category}/${slug}-gallery-1.jpg`, mediaSource: originalMediaSource(config.category, sheet, "three-quarter gallery view"), altText: `${name} three-quarter product view` },
      { mediaFile: `house/${config.category}/${slug}-gallery-2.jpg`, mediaSource: originalMediaSource(config.category, sheet, "packaging detail gallery view"), altText: `${name} packaging detail view` }
    ] : undefined,
    shortDescription: details.short,
    description: details.long,
    keywords: details.keywords,
    isNewArrival: index < 2,
    isBestSeller: ["perfumes", "ouds", "gift-sets", "bakhoor", "perfume-oils"].includes(config.category) && index < 2,
    fragranceNotes: ["perfumes", "ouds"].includes(config.category) ? {
      top: `${details.keywords.at(-1)}, bergamot`,
      heart: config.category === "ouds" ? "Saffron, rose, dry woods" : "Aromatic florals, warm spice",
      base: config.category === "ouds" ? "Oud accord, amber, musk" : "Cedar, amber, soft musk"
    } : undefined
  };
});

export const houseProducts: StorefrontSeedProduct[] = configs.flatMap(makeProducts);

export const houseCatalogExpectedCounts = Object.fromEntries(
  configs.map((config) => [config.category, config.entries.length])
);
