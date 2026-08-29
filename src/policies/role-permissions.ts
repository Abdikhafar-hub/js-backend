import { UserRole } from "@prisma/client";

import { PERMISSIONS, type Permission } from "./permissions.js";

export const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.GENERAL_MANAGER]: Object.values(PERMISSIONS).filter(
    (permission) => permission !== PERMISSIONS.posOperate && permission !== PERMISSIONS.shiftOperate
  ),
  [UserRole.BRANCH_MANAGER]: [
    PERMISSIONS.branchReadAssigned,
    PERMISSIONS.userCreate,
    PERMISSIONS.userUpdate,
    PERMISSIONS.productRead,
    PERMISSIONS.productCreateDraft,
    PERMISSIONS.productUpdateOwnDraft,
    PERMISSIONS.productSubmit,
    PERMISSIONS.productAddToBranch,
    PERMISSIONS.productConfigureBranch,
    PERMISSIONS.variantCreateDraft,
    PERMISSIONS.mediaPropose,
    PERMISSIONS.inventoryRead,
    PERMISSIONS.inventoryValuation,
    PERMISSIONS.inventoryAdjust,
    PERMISSIONS.adjustmentRead,
    PERMISSIONS.adjustmentCreate,
    PERMISSIONS.adjustmentSubmit,
    PERMISSIONS.adjustmentApprove,
    PERMISSIONS.adjustmentReject,
    PERMISSIONS.adjustmentPost,
    PERMISSIONS.adjustmentCancel,
    PERMISSIONS.stockCountCreate,
    PERMISSIONS.stockCountSubmit,
    PERMISSIONS.stockIssueReport,
    PERMISSIONS.stockIssueReview,
    PERMISSIONS.saleReadBranch,
    PERMISSIONS.saleReadOwn,
    PERMISSIONS.posOperate,
    
    // Additional ERP permissions
    PERMISSIONS.supplierLookup,
    PERMISSIONS.customerRead,
    PERMISSIONS.customerWrite,
    PERMISSIONS.customerFinancialRead,
    PERMISSIONS.procurementRequest,
    PERMISSIONS.procurementReceive,
    PERMISSIONS.transferRequest,
    PERMISSIONS.transferReceive,
    PERMISSIONS.shiftManage,
    PERMISSIONS.shiftOperate,
    PERMISSIONS.expenseRequest,
    PERMISSIONS.expenseApprove,
    PERMISSIONS.notificationRead,
    PERMISSIONS.reportRead,
    PERMISSIONS.reconciliationRead,
    PERMISSIONS.onlineOrderRead,
    PERMISSIONS.onlineOrderUpdate
  ],
  [UserRole.SALES_ATTENDANT]: [
    PERMISSIONS.branchReadAssigned,
    PERMISSIONS.productRead,
    PERMISSIONS.stockIssueReport,
    PERMISSIONS.saleReadOwn,
    PERMISSIONS.posOperate,
    PERMISSIONS.customerRead,
    PERMISSIONS.customerWrite,
    
    // Additional ERP permissions
    PERMISSIONS.shiftOperate,
    PERMISSIONS.notificationRead,
    PERMISSIONS.onlineOrderRead,
    PERMISSIONS.onlineOrderUpdate
  ]
};

export const hasPermission = (role: UserRole, permission: Permission) =>
  rolePermissions[role]?.includes(permission) ?? false;
