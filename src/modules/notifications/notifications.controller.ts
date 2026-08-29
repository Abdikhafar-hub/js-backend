import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { notificationsService } from "./notifications.service.js";

export const notificationsController = {
  list: asyncHandler(async (request, response) => {
    const res = await notificationsService.list(request.auth!, request.query);
    sendSuccess(response, "Notifications retrieved", res);
  }),
  markRead: asyncHandler(async (request, response) => {
    const res = await notificationsService.markRead(request.auth!, request.params.id!);
    sendSuccess(response, "Notification marked as read", res);
  }),
  markAllRead: asyncHandler(async (request, response) => {
    const res = await notificationsService.markAllRead(request.auth!);
    sendSuccess(response, "All notifications marked as read", res);
  })
};
