import { prisma } from "./lib/prisma.js";

async function main() {
  const assignments = await prisma.userBranchAssignment.findMany({
    where: { branch: { code: "NBI-WH" } },
    include: {
      user: true,
      branch: true
    }
  });
  console.log("=== NBI-WH ASSIGNMENTS ===");
  console.log(JSON.stringify(assignments.map(a => ({
    userId: a.userId,
    name: `${a.user.firstName} ${a.user.lastName}`,
    email: a.user.email,
    role: a.user.role,
    status: a.user.status
  })), null, 2));

  // Also print all active shifts
  const shifts = await prisma.shift.findMany({
    include: {
      user: true,
      branch: true
    }
  });
  console.log("=== SHIFTS ===");
  console.log(JSON.stringify(shifts.map(s => ({
    shiftNumber: s.shiftNumber,
    branch: s.branch.code,
    user: s.user.email,
    status: s.status
  })), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
