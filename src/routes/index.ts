import { Router } from "express";

import { authRouter } from "../modules/auth/auth.routes.js";
import { organizationRouter } from "../modules/organization/organization.routes.js";
import { branchRouter } from "../modules/branches/branch.routes.js";
import { userRouter } from "../modules/users/user.routes.js";
import { catalogRouter } from "../modules/catalog/catalog.routes.js";
import { inventoryRouter } from "../modules/inventory/inventory.routes.js";
import { auditRouter } from "../modules/audit/audit.routes.js";

// ERP routers
import { suppliersRouter } from "../modules/suppliers/suppliers.routes.js";
import { customersRouter } from "../modules/customers/customers.routes.js";
import { procurementRouter } from "../modules/procurement/procurement.routes.js";
import { shipmentsRouter } from "../modules/shipments/shipments.routes.js";
import { goodsReceiptsRouter } from "../modules/goods-receipts/goods-receipts.routes.js";
import { transfersRouter } from "../modules/transfers/transfers.routes.js";
import { countsRouter } from "../modules/counts/counts.routes.js";
import { stockAdjustmentsRouter } from "../modules/stock-adjustments/stock-adjustments.routes.js";
import { stockIssuesRouter } from "../modules/stock-issues/stock-issues.routes.js";
import { salesRouter } from "../modules/sales/sales.routes.js";
import { paymentsRouter } from "../modules/payments/payments.routes.js";
import { shiftsRouter } from "../modules/shifts/shifts.routes.js";
import { loyaltyRouter } from "../modules/loyalty/loyalty.routes.js";
import { targetsRouter } from "../modules/targets/targets.routes.js";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { notificationsRouter } from "../modules/notifications/notifications.routes.js";
import { storefrontRouter } from "../modules/storefront/storefront.routes.js";
import { onlineStoreRouter } from "../modules/online-store/online-store.routes.js";
import { customerAuthRouter } from "../modules/customer-auth/customer-auth.routes.js";
import { storefrontAccountRouter } from "../modules/storefront-account/storefront-account.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/organization", organizationRouter);
apiRouter.use("/branches", branchRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/storefront/auth", customerAuthRouter);
apiRouter.use("/storefront/account", storefrontAccountRouter);
apiRouter.use("/storefront", storefrontRouter);
apiRouter.use("/", catalogRouter);
apiRouter.use("/inventory", inventoryRouter);
apiRouter.use("/audit-logs", auditRouter);

// ERP API routes
apiRouter.use("/suppliers", suppliersRouter);
apiRouter.use("/customers", customersRouter);
apiRouter.use("/procurement", procurementRouter);
apiRouter.use("/shipments", shipmentsRouter);
apiRouter.use("/goods-receipts", goodsReceiptsRouter);
apiRouter.use("/transfers", transfersRouter);
apiRouter.use("/inventory/counts", countsRouter);
apiRouter.use("/inventory/stock-adjustments", stockAdjustmentsRouter);
apiRouter.use("/inventory/stock-issues", stockIssuesRouter);
apiRouter.use("/sales", salesRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/shifts", shiftsRouter);
apiRouter.use("/loyalty", loyaltyRouter);
apiRouter.use("/targets", targetsRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/online-store", onlineStoreRouter);
