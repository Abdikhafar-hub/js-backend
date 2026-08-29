import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { authService } from "./auth.service.js";

export const authController = {
  login: asyncHandler(async (request, response) => {
    const result = await authService.login(request.body, {
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      requestId: request.requestContext.requestId
    });

    sendSuccess(response, "Login successful", result, undefined, { preserveKeys: ["refreshToken"] });
  }),

  refresh: asyncHandler(async (request, response) => {
    const result = await authService.refresh(request.body.refreshToken, {
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
      requestId: request.requestContext.requestId
    });

    sendSuccess(response, "Token refreshed successfully", result, undefined, { preserveKeys: ["refreshToken"] });
  }),

  logout: asyncHandler(async (request, response) => {
    await authService.logout(request.auth!);
    sendSuccess(response, "Logged out successfully", {});
  }),

  logoutAll: asyncHandler(async (request, response) => {
    await authService.logoutAll(request.auth!);
    sendSuccess(response, "All sessions have been revoked", {});
  }),

  forgotPassword: asyncHandler(async (request, response) => {
    const result = await authService.forgotPassword(request.body);
    sendSuccess(response, "If the account exists, a reset token has been issued", result);
  }),

  resetPassword: asyncHandler(async (request, response) => {
    await authService.resetPassword(request.body);
    sendSuccess(response, "Password reset successfully", {});
  }),

  changePassword: asyncHandler(async (request, response) => {
    await authService.changePassword(request.auth!, request.body);
    sendSuccess(response, "Password changed successfully", {});
  }),

  me: asyncHandler(async (request, response) => {
    const me = await authService.me(request.auth!);
    sendSuccess(response, "Authenticated user profile fetched successfully", me);
  }),

  sessions: asyncHandler(async (request, response) => {
    const sessions = await authService.listSessions(request.auth!);
    sendSuccess(response, "Sessions fetched successfully", sessions);
  }),

  revokeSession: asyncHandler(async (request, response) => {
    await authService.revokeSession(request.auth!, request.params.sessionId!);
    sendSuccess(response, "Session revoked successfully", {});
  })
};
