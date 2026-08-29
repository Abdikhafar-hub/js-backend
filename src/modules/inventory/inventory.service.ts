import { assertBranchAccess, buildUserScope } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../../types/auth.js";

export const inventoryService = {
  list(auth: AuthContext) {
    const scope = buildUserScope(auth);
    return prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  },

  byBranch(auth: AuthContext, branchId: string) {
    assertBranchAccess(auth, branchId);
    const scope = buildUserScope(auth);
    return prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        branchId,
        ...(scope.branchIds ? { branchId } : {})
      },
      include: {
        productVariant: {
          include: {
            product: true
          }
        }
      }
    });
  },

  async productStock(auth: AuthContext, branchId: string, productVariantId: string) {
    assertBranchAccess(auth, branchId);
    const scope = buildUserScope(auth);

    const balance = await prisma.inventoryBalance.findUnique({
      where: {
        organizationId_branchId_productVariantId: {
          organizationId: scope.organizationId,
          branchId,
          productVariantId
        }
      }
    });

    const batches = await prisma.inventoryBatch.findMany({
      where: {
        organizationId: scope.organizationId,
        branchId,
        productVariantId,
        status: "ACTIVE"
      },
      orderBy: {
        expiryDate: "asc"
      }
    });

    return {
      balance: balance ? {
        quantityOnHand: Number(balance.quantityOnHand),
        quantityReserved: Number(balance.quantityReserved),
        quantityAvailable: Number(balance.quantityAvailable),
        averageUnitCost: Number(balance.averageUnitCost)
      } : {
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAvailable: 0,
        averageUnitCost: 0
      },
      batches: batches.map(b => ({
        id: b.id,
        batchNumber: b.batchNumber,
        quantityOnHand: Number(b.quantityOnHand),
        quantityReserved: Number(b.quantityReserved),
        quantityAvailable: Math.max(0, Number(b.quantityOnHand) - Number(b.quantityReserved)),
        unitCost: Number(b.unitCost),
        landedUnitCost: Number(b.landedUnitCost),
        expiryDate: b.expiryDate
      }))
    };
  },

  byVariant(auth: AuthContext, variantId: string) {
    const scope = buildUserScope(auth);
    return prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        productVariantId: variantId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      include: {
        branch: true
      }
    });
  },

  movements(auth: AuthContext, branchId?: string) {
    if (branchId) {
      assertBranchAccess(auth, branchId);
    }

    const scope = buildUserScope(auth);
    return prisma.inventoryMovement.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(branchId ? { branchId } : {}),
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        },
        inventoryBatch: true
      },
      orderBy: {
        occurredAt: "desc"
      },
      take: 100
    });
  },

  lowStock(auth: AuthContext, branchId?: string) {
    if (branchId) {
      assertBranchAccess(auth, branchId);
    }

    const scope = buildUserScope(auth);
    return prisma.inventoryBalance
      .findMany({
      where: {
        organizationId: scope.organizationId,
        ...(branchId ? { branchId } : {}),
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      include: {
        branch: true,
        productVariant: {
          include: {
            product: true
          }
        }
      }
      })
      .then((balances) =>
        balances.filter(
          (balance) => Number(balance.quantityAvailable) <= Number(balance.productVariant.reorderLevel)
        )
      );
  },

  async valuation(auth: AuthContext, branchId?: string) {
    if (branchId) {
      assertBranchAccess(auth, branchId);
    }

    const scope = buildUserScope(auth);
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(branchId ? { branchId } : {}),
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {})
      },
      select: {
        quantityOnHand: true,
        averageUnitCost: true
      }
    });

    const totalValuationCost = balances.reduce(
      (accumulator, balance) => accumulator + Number(balance.quantityOnHand) * Number(balance.averageUnitCost),
      0
    );

    const totalQtyOnHand = balances.reduce(
      (accumulator, balance) => accumulator + Number(balance.quantityOnHand),
      0
    );

    return {
      totalQtyOnHand,
      totalValuationCost
    };
  }
};
