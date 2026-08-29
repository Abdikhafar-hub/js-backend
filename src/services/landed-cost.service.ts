import { LandedCostAllocationMethod } from "@prisma/client";

type ShipmentItemInput = {
  productVariantId: string;
  quantity: number;
  unitCost: number; // in supplier currency
  weight?: number;  // optional weight per unit
};

type CostInput = {
  amount: number;      // in invoice currency
  exchangeRate: number; // rate to convert to base currency (e.g. KES)
  allocationMethod: LandedCostAllocationMethod;
};

export const landedCostService = {
  /**
   * Allocates shipment-level costs to individual items.
   * Returns a map of productVariantId to allocated cost in base currency.
   */
  allocateCosts(
    items: ShipmentItemInput[],
    costs: CostInput[]
  ): Record<string, number> {
    const allocations: Record<string, number> = {};
    for (const item of items) {
      allocations[item.productVariantId] = 0;
    }

    if (items.length === 0) return allocations;

    // Total purchase value and quantity calculations
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPurchaseValue = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
    const totalWeight = items.reduce((sum, item) => sum + (item.quantity * (item.weight || 0)), 0);

    for (const cost of costs) {
      const baseCost = cost.amount * cost.exchangeRate;
      if (baseCost <= 0) continue;

      let method = cost.allocationMethod;
      if (method === LandedCostAllocationMethod.BY_WEIGHT && totalWeight <= 0) {
        // Fallback to BY_QUANTITY if weight allocation is requested but no weight is available
        method = LandedCostAllocationMethod.BY_QUANTITY;
      }

      let allocatedSum = 0;
      const costAllocations: Record<string, number> = {};

      if (method === LandedCostAllocationMethod.BY_QUANTITY) {
        if (totalQty > 0) {
          for (const item of items) {
            const share = item.quantity / totalQty;
            const amt = Math.round(baseCost * share * 100) / 100;
            costAllocations[item.productVariantId] = amt;
            allocatedSum += amt;
          }
        }
      } else if (method === LandedCostAllocationMethod.BY_PURCHASE_VALUE) {
        if (totalPurchaseValue > 0) {
          for (const item of items) {
            const itemVal = item.quantity * item.unitCost;
            const share = itemVal / totalPurchaseValue;
            const amt = Math.round(baseCost * share * 100) / 100;
            costAllocations[item.productVariantId] = amt;
            allocatedSum += amt;
          }
        }
      } else if (method === LandedCostAllocationMethod.BY_WEIGHT) {
        for (const item of items) {
          const itemWeight = item.quantity * (item.weight || 0);
          const share = itemWeight / totalWeight;
          const amt = Math.round(baseCost * share * 100) / 100;
          costAllocations[item.productVariantId] = amt;
          allocatedSum += amt;
        }
      } else {
        // MANUAL allocation method: splits equally as default unless specified.
        // For backend logic, manual costs are typically pre-calculated. We fallback to quantity.
        if (totalQty > 0) {
          for (const item of items) {
            const share = item.quantity / totalQty;
            const amt = Math.round(baseCost * share * 100) / 100;
            costAllocations[item.productVariantId] = amt;
            allocatedSum += amt;
          }
        }
      }

      // Rounding reconciliation (distribute difference to the item with the largest allocation)
      const diff = baseCost - allocatedSum;
      if (Math.abs(diff) > 0 && items.length > 0) {
        const sortedIds = Object.keys(costAllocations).sort(
          (a, b) => (costAllocations[b] || 0) - (costAllocations[a] || 0)
        );
        const targetId = sortedIds[0] || (items[0] ? items[0].productVariantId : "");
        if (targetId) {
          costAllocations[targetId] = Math.round(((costAllocations[targetId] || 0) + diff) * 100) / 100;
        }
      }

      // Add to overall allocations
      for (const item of items) {
        allocations[item.productVariantId] = (allocations[item.productVariantId] || 0) + (costAllocations[item.productVariantId] || 0);
      }
    }

    // final round to 2 decimals
    for (const key of Object.keys(allocations)) {
      allocations[key] = Math.round((allocations[key] || 0) * 100) / 100;
    }

    return allocations;
  }
};
