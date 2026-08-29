import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { houseProducts } from "./seed-data/storefront/house-catalog.js";

const execFileAsync = promisify(execFile);
const SOURCE_DIR = path.resolve("prisma/seed-data/storefront/media-sources/house");
const MEDIA_DIR = path.resolve("prisma/seed-data/storefront/media");
const GALLERY_CATEGORIES = new Set(["perfumes", "ouds", "gift-sets"]);

const imageDimensions = async (file: string) => {
  const { stdout } = await execFileAsync("identify", ["-format", "%w %h", file]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!width || !height) throw new Error(`Could not read dimensions for ${file}`);
  return { width, height };
};

const shortLabel = (name: string) => name
  .replace(/^JS Perfumes /, "")
  .replace(/ \d+(?:ml|g)$/, "")
  .replace(/ Eau de Parfum$/, " EDP");

const sourceGrid = (category: string, batch: number) => ({
  columns: 5,
  rows: batch === 2 && ["perfumes", "ouds"].includes(category) ? 1 : 4
});

const renderCell = async (options: {
  source: string;
  destination: string;
  index: number;
  columns: number;
  rows: number;
  label: string;
}) => {
  const { width, height } = await imageDimensions(options.source);
  const cellWidth = Math.floor(width / options.columns);
  const cellHeight = Math.floor(height / options.rows);
  const column = options.index % options.columns;
  const row = Math.floor(options.index / options.columns);
  const inset = 4;
  const cropWidth = cellWidth - inset * 2;
  const cropHeight = cellHeight - inset * 2;
  const x = column * cellWidth + inset;
  const y = row * cellHeight + inset;

  if (cropWidth < 240 || cropHeight < 240) {
    throw new Error(`Source cell below 240px threshold: ${options.source} (${cropWidth}x${cropHeight})`);
  }

  await fs.mkdir(path.dirname(options.destination), { recursive: true });
  await execFileAsync("convert", [
    options.source,
    "-crop", `${cropWidth}x${cropHeight}+${x}+${y}`,
    "+repage",
    "-gravity", "south",
    "-font", "DejaVu-Sans",
    "-pointsize", "11",
    "-fill", "#17120f",
    "-undercolor", "#fffaf0e8",
    "-annotate", "+0+4", `JS PERFUMES · ${options.label}`,
    "-strip",
    "-sampling-factor", "4:2:0",
    "-quality", "92",
    options.destination
  ]);

  const output = await imageDimensions(options.destination);
  const stats = await fs.stat(options.destination);
  if (output.width < 240 || output.height < 240 || stats.size === 0) {
    throw new Error(`Rendered media failed validation: ${options.destination}`);
  }
};

export const buildStorefrontHouseMedia = async () => {
  const categoryOffsets = new Map<string, number>();
  let rendered = 0;

  for (const product of houseProducts) {
    const index = categoryOffsets.get(product.category) ?? 0;
    categoryOffsets.set(product.category, index + 1);
    const batch = Math.floor(index / 20) + 1;
    const indexWithinBatch = index % 20;
    const grid = sourceGrid(product.category, batch);
    const views = [
      { sourceView: "primary", destination: product.mediaFile },
      ...(product.galleryMedia ?? []).map((media, galleryIndex) => ({
        sourceView: `gallery-${galleryIndex + 1}`,
        destination: media.mediaFile
      }))
    ];

    for (const view of views) {
      if (!GALLERY_CATEGORIES.has(product.category) && view.sourceView !== "primary") continue;
      const source = path.join(SOURCE_DIR, `${product.category}-${view.sourceView}-${batch}.png`);
      const destination = path.join(MEDIA_DIR, view.destination);
      await renderCell({
        source,
        destination,
        index: indexWithinBatch,
        ...grid,
        label: shortLabel(product.name)
      });
      rendered += 1;
    }
  }

  return { products: houseProducts.length, rendered };
};

const main = async () => {
  const summary = await buildStorefrontHouseMedia();
  console.log(JSON.stringify({ success: true, summary }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
