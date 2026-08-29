import { prisma } from "./lib/prisma.js";
import { reportsService } from "./modules/reports/reports.service.js";
import { UserRole } from "@prisma/client";

async function run() {
  const gmUser = await prisma.user.findFirst({
    where: { role: UserRole.GENERAL_MANAGER },
    include: { branchAssignments: { include: { branch: true } } }
  });

  if (!gmUser) {
    console.error("No GM user found");
    return;
  }

  const authContext = {
    userId: gmUser.id,
    role: gmUser.role,
    organizationId: gmUser.organizationId,
    branchIds: gmUser.branchAssignments.map(a => a.branch.id),
    sessionId: "report-diagnostic",
    tokenVersion: gmUser.tokenVersion
  };

  console.log("Mocking AuthContext:", authContext);

  const start = new Date(new Date().setDate(new Date().getDate() - 30));
  const end = new Date();

  console.log("\n--- Testing getSalesReport ---");
  try {
    const res = await reportsService.getSalesReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
    if (err.stack) console.error(err.stack);
  }

  console.log("\n--- Testing getGrossProfitReport ---");
  try {
    const res = await reportsService.getGrossProfitReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }

  console.log("\n--- Testing getBranchReport ---");
  try {
    const res = await reportsService.getBranchReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }

  console.log("\n--- Testing getProductReport ---");
  try {
    const res = await reportsService.getProductReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }

  console.log("\n--- Testing getPaymentReport ---");
  try {
    const res = await reportsService.getPaymentReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }

  console.log("\n--- Testing getReconciliationReport ---");
  try {
    const res = await reportsService.getReconciliationReport(authContext, start, end);
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }

  await prisma.$disconnect();
}

run();
