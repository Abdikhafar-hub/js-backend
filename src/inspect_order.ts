import { prisma } from "./lib/prisma.js";

async function main() {
  const order = await prisma.onlineOrder.findFirst({
    where: { orderNumber: "ONL-000001" },
    include: {
      items: true,
      dispatch: true,
      customer: true,
      paymentAttempts: true,
    }
  });
  console.log("=== ONLINE ORDER ===");
  console.log(JSON.stringify(order, null, 2));

  if (order) {
    const pickingTasks = await prisma.pickingTask.findMany({
      where: { onlineOrderId: order.id },
      include: { items: true }
    });
    console.log("=== PICKING TASKS ===");
    console.log(JSON.stringify(pickingTasks, null, 2));

    const packingTasks = await prisma.packingTask.findMany({
      where: { onlineOrderId: order.id },
      include: { assignedTo: true, branch: true }
    });
    console.log("=== PACKING TASKS ===");
    console.log(JSON.stringify(packingTasks, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
