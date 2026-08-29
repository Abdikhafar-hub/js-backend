export const PERMISSIONS = {
  organizationRead: "organization.read",
  organizationUpdate: "organization.update",
  branchCreate: "branch.create",
  branchManagerAssign: "branch_managers.assign",
  branchReadAll: "branch.read.all",
  branchReadAssigned: "branch.read.assigned",
  branchUpdate: "branch.update",
  userCreate: "user.create",
  userUpdate: "user.update",
  auditRead: "audit.read",
  productRead: "catalog.product.read",
  productCreate: "catalog.product.create",
  productUpdate: "catalog.product.update",
  productReadAll: "catalog.product.read.all",
  productCreateDraft: "catalog.product.createDraft",
  productUpdateOwnDraft: "catalog.product.updateOwnDraft",
  productSubmit: "catalog.product.submit",
  productApprove: "catalog.product.approve",
  productReject: "catalog.product.reject",
  productRequestCorrection: "catalog.product.requestCorrection",
  productMerge: "catalog.product.merge",
  productUpdateMaster: "catalog.product.updateMaster",
  productAddToBranch: "catalog.product.addToBranch",
  productConfigureBranch: "catalog.product.configureBranch",
  variantCreateDraft: "catalog.variant.createDraft",
  variantApprove: "catalog.variant.approve",
  mediaPropose: "catalog.media.propose",
  priceUpdate: "price.update",
  inventoryRead: "inventory.read",
  inventoryValuation: "inventory.valuation",
  inventoryAdjust: "inventory.adjust",
  adjustmentRead: "inventory.adjustment.read",
  adjustmentCreate: "inventory.adjustment.create",
  adjustmentSubmit: "inventory.adjustment.submit",
  adjustmentApprove: "inventory.adjustment.approve",
  adjustmentReject: "inventory.adjustment.reject",
  adjustmentPost: "inventory.adjustment.post",
  adjustmentCancel: "inventory.adjustment.cancel",
  stockCountCreate: "stock_count.create",
  stockCountSubmit: "stock_count.submit",
  stockCountApprove: "stock_count.approve",
  stockCountPost: "stock_count.post",
  stockIssueReport: "stock.issue.report",
  stockIssueReview: "stock.issue.review",
  saleReadAll: "sale.read.all",
  saleReadBranch: "sale.read.branch",
  saleReadOwn: "sale.read.own",
  posOperate: "pos.operate",
  
  // Supplier permissions
  supplierRead: "supplier.read",
  supplierLookup: "supplier.lookup",
  supplierWrite: "supplier.write",

  // Customer permissions
  customerRead: "customer.read",
  customerWrite: "customer.write",
  customerFinancialRead: "customer.financial.read",
  customerCreditManage: "customer.credit.manage",

  // Procurement permissions
  procurementRequest: "procurement.request",
  procurementApprove: "procurement.approve",
  procurementReceive: "procurement.receive",

  // Transfer permissions
  transferRequest: "transfer.request",
  transferApprove: "transfer.approve",
  transferReceive: "transfer.receive",

  // Shift & Cash management permissions
  shiftManage: "shift.manage",
  shiftOperate: "shift.operate",

  // Expense permissions
  expenseRequest: "expense.request",
  expenseApprove: "expense.approve",
  expenseReverse: "expense.reverse",

  // Notification permissions
  notificationRead: "notification.read",

  // Sensitive finance/administration permissions
  mpesaConfigManage: "mpesa.config.manage",
  reconciliationRead: "reconciliation.read",
  reconciliationApprove: "reconciliation.approve",

  // Report permissions
  reportRead: "report.read",
  reportExport: "report.export",

  // Storefront permissions
  storefrontCatalogManage: "storefront.catalog.manage",
  storefrontSettingsWrite: "storefront.settings.write",

  // Online Store permissions
  onlineOrderRead: "online_order.read",
  onlineOrderUpdate: "online_order.update",
  deliveryZoneWrite: "delivery_zone.write"
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
