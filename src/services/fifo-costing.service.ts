import { prisma } from "../lib/prisma.js";

type CostEstimateItem = {
  productVariantId: string;
  quantity: number;
  unitPrice: number;
};

export const fifoCostingService = {
  /**
   * Previews the estimated Cost of Goods Sold (COGS) and profit margins for a list of items.
   */
  async estimateCOGS(
    organizationId: string,
    branchId: string,
    items: CostEstimateItem[]
  ) {
    const results: Array<{
      productVariantId: string;
      quantity: number;
      estimatedCOGS: number;
      estimatedMargin: number;
      details: Array<{
        batchNumber: string | null;
        quantity: number;
        landedUnitCost: number;
      }>;
    }> = [];

    let totalSalesValue = 0;
    let totalCOGS = 0;

    for (const item of items) {
      let remaining = item.quantity;
      let itemCOGS = 0;
      const details: Array<{
        batchNumber: string | null;
        quantity: number;
        landedUnitCost: number;
      }> = [];

      // Fetch active batches for the variant
      const batches = await prisma.inventoryBatch.findMany({
        where: {
          organizationId,
          branchId,
          productVariantId: item.productVariantId,
          quantityOnHand: { gt: 0 }
        },
        orderBy: [
          { expiryDate: "asc" },
          { createdAt: "asc" }
        ]
      });

      for (const batch of batches) {
        if (remaining <= 0) break;
        const batchQty = Number(batch.quantityOnHand);
        const allocated = Math.min(batchQty, remaining);

        const landedCost = Number(batch.landedUnitCost);
        itemCOGS += allocated * landedCost;
        details.push({
          batchNumber: batch.batchNumber,
          quantity: allocated,
          landedUnitCost: landedCost
        });

        remaining -= allocated;
      }

      // If there is still remaining quantity, fallback to the average cost or variant default cost
      if (remaining > 0) {
        const balance = await prisma.inventoryBalance.findFirst({
          where: { organizationId, branchId, productVariantId: item.productVariantId }
        });

        const fallbackCost = balance ? Number(balance.averageUnitCost) : 0;
        itemCOGS += remaining * fallbackCost;
        details.push({
          batchNumber: "FALLBACK/AVG",
          quantity: remaining,
          landedUnitCost: fallbackCost
        });
      }

      const salesVal = item.quantity * item.unitPrice;
      totalSalesValue += salesVal;
      totalCOGS += itemCOGS;

      const margin = salesVal > 0 ? ((salesVal - itemCOGS) / salesVal) * 100 : 0;

      results.push({
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        estimatedCOGS: Math.round(itemCOGS * 100) / 100,
        estimatedMargin: Math.round(margin * 100) / 100,
        details
      });
    }

    const totalMargin = totalSalesValue > 0 ? ((totalSalesValue - totalCOGS) / totalSalesValue) * 100 : 0;

    return {
      items: results,
      totalSalesValue: Math.round(totalSalesValue * 100) / 100,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      totalMarginPercentage: Math.round(totalMargin * 100) / 100
    };
  }
};
