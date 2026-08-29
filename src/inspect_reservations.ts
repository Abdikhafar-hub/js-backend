import { prisma } from "./lib/prisma.js";

async function main() {
  const reservations = await prisma.inventoryReservation.findMany({
    where: { sourceId: "cmrmwv7df000dtnaaf7ycghvm" },
    include: {
      branch: true,
      productVariant: true
    }
  });
  console.log("=== RESERVATIONS ===");
  console.log(JSON.stringify(reservations, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
