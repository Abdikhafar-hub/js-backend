import { onlineStoreFulfilmentService } from "../../services/online-store-fulfilment.service.js";
import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";

export const onlineStoreFulfilmentController = {
  confirmOrder: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.confirmOrder(req.auth!, id!, requestDetails);
    sendSuccess(res, "Order confirmed operationally", result);
  }),

  rejectOrder: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.rejectOrder(req.auth!, id!, reason, requestDetails);
    sendSuccess(res, "Order rejected operationally", result);
  }),

  reserveStock: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.reserveStock(req.auth!, id!, requestDetails);
    sendSuccess(res, "Inventory stock reserved successfully", result);
  }),

  releaseReservation: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.releaseReservation(req.auth!, id!, reason, requestDetails);
    sendSuccess(res, "Inventory reservation released", result);
  }),

  assignPicker: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { pickerId } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.assignPicker(req.auth!, id!, pickerId, requestDetails);
    sendSuccess(res, "Picker assigned to order", result);
  }),

  startPicking: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.startPicking(req.auth!, id!, requestDetails);
    sendSuccess(res, "Picking task started", result);
  }),

  pickItems: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { items } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.pickItems(req.auth!, id!, items, requestDetails);
    sendSuccess(res, "Picked items logged successfully", result);
  }),

  completePicking: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.completePicking(req.auth!, id!, requestDetails);
    sendSuccess(res, "Picking task completed", result);
  }),

  assignPacker: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { packerId } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.assignPacker(req.auth!, id!, packerId, requestDetails);
    sendSuccess(res, "Packer assigned to order", result);
  }),

  completePacking: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { packageCount, totalWeight, notes } = req.body;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.completePacking(req.auth!, id!, { packageCount, totalWeight, notes }, requestDetails);
    sendSuccess(res, "Packing task completed", result);
  }),

  readyForDispatch: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.readyForDispatch(req.auth!, id!, requestDetails);
    sendSuccess(res, "Order marked ready for dispatch", result);
  }),

  dispatchOrder: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.dispatchOrder(req.auth!, id!, req.body, requestDetails);
    sendSuccess(res, "Order dispatched successfully", result);
  }),

  confirmDelivery: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requestDetails = {
      ip: req.ip,
      userAgent: req.header("user-agent"),
      requestId: req.requestContext.requestId
    };
    const result = await onlineStoreFulfilmentService.confirmDelivery(req.auth!, id!, req.body, requestDetails);
    sendSuccess(res, "Delivery outcome processed successfully", result);
  })
};
