import { sendSuccess } from "../../utils/api-response.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { userService } from "./user.service.js";

export const userController = {
  list: asyncHandler(async (request, response) => {
    const users = await userService.list(request.auth!);
    sendSuccess(response, "Users fetched successfully", users);
  }),
  create: asyncHandler(async (request, response) => {
    const user = await userService.create(request.auth!, request.body, request);
    sendSuccess(response, "User created successfully", user);
  }),
  get: asyncHandler(async (request, response) => {
    const user = await userService.get(request.auth!, request.params.userId!);
    sendSuccess(response, "User fetched successfully", user);
  }),
  update: asyncHandler(async (request, response) => {
    const user = await userService.update(request.auth!, request.params.userId!, request.body, request);
    sendSuccess(response, "User updated successfully", user);
  }),
  assignBranches: asyncHandler(async (request, response) => {
    const user = await userService.assignBranches(request.auth!, request.params.userId!, request.body, request);
    sendSuccess(response, "User branch assignments updated successfully", user);
  }),
  resetPassword: asyncHandler(async (request, response) => {
    await userService.resetPassword(request.auth!, request.params.userId!, request.body.temporaryPassword, request);
    sendSuccess(response, "User password reset successfully", {});
  }),
  activate: asyncHandler(async (request, response) => {
    const user = await userService.activate(request.auth!, request.params.userId!, request);
    sendSuccess(response, "User activated successfully", user);
  }),
  suspend: asyncHandler(async (request, response) => {
    const user = await userService.suspend(request.auth!, request.params.userId!, request);
    sendSuccess(response, "User suspended successfully", user);
  }),
  meProfile: asyncHandler(async (request, response) => {
    const user = await userService.meProfile(request.auth!);
    sendSuccess(response, "Profile fetched successfully", user);
  })
};
