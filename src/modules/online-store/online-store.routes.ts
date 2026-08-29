import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { PERMISSIONS } from "../../policies/permissions.js";
import { onlineStoreController } from "./online-store.controller.js";
import { onlineStoreFulfilmentController } from "./online-store-fulfilment.controller.js";

export const onlineStoreRouter = Router();

// All online store admin actions require authentication
onlineStoreRouter.use(authenticate);

// Orders
onlineStoreRouter.get(
  "/orders",
  requirePermission(PERMISSIONS.onlineOrderRead),
  onlineStoreController.listOrders
);

onlineStoreRouter.get(
  "/orders/:id",
  requirePermission(PERMISSIONS.onlineOrderRead),
  onlineStoreController.getOrder
);

onlineStoreRouter.put(
  "/orders/:id/status",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreController.updateOrderStatus
);

// Fulfilment Operations
onlineStoreRouter.post(
  "/orders/:id/confirm",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.confirmOrder
);

onlineStoreRouter.post(
  "/orders/:id/reject",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.rejectOrder
);

onlineStoreRouter.post(
  "/orders/:id/reserve",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.reserveStock
);

onlineStoreRouter.post(
  "/orders/:id/release-reservation",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.releaseReservation
);

onlineStoreRouter.post(
  "/orders/:id/assign-picker",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.assignPicker
);

onlineStoreRouter.post(
  "/orders/:id/start-picking",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.startPicking
);

onlineStoreRouter.post(
  "/orders/:id/pick-items",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.pickItems
);

onlineStoreRouter.post(
  "/orders/:id/complete-picking",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.completePicking
);

onlineStoreRouter.post(
  "/orders/:id/assign-packer",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.assignPacker
);

onlineStoreRouter.post(
  "/orders/:id/complete-packing",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.completePacking
);

onlineStoreRouter.post(
  "/orders/:id/ready-for-dispatch",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.readyForDispatch
);

onlineStoreRouter.post(
  "/orders/:id/dispatch",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.dispatchOrder
);

onlineStoreRouter.post(
  "/orders/:id/confirm-delivery",
  requirePermission(PERMISSIONS.onlineOrderUpdate),
  onlineStoreFulfilmentController.confirmDelivery
);

// Delivery Zones
onlineStoreRouter.get(
  "/delivery-zones",
  requirePermission(PERMISSIONS.onlineOrderRead),
  onlineStoreController.listDeliveryZones
);

onlineStoreRouter.post(
  "/delivery-zones",
  requirePermission(PERMISSIONS.deliveryZoneWrite),
  onlineStoreController.createDeliveryZone
);

onlineStoreRouter.put(
  "/delivery-zones/:id",
  requirePermission(PERMISSIONS.deliveryZoneWrite),
  onlineStoreController.updateDeliveryZone
);
