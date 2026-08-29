import type { RequestHandler } from "express";

import { authorizePermission } from "./authorize.middleware.js";
import type { Permission } from "../policies/permissions.js";

export const requirePermission = (permission: Permission): RequestHandler => (request, _response, next) => {
  authorizePermission(permission)(request);
  next();
};
