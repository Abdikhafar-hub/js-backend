import type { Response } from "express";

import { sanitizePrivateResponseFields } from "../lib/safe-response.js";
import { shapeOperationalResponse } from "../lib/response-scope.js";
import type { AuthContext } from "../types/auth.js";

export const sendSuccess = <T>(
  response: Response,
  message: string,
  data: T,
  meta?: Record<string, unknown>,
  options?: { preserveKeys?: readonly string[] }
) => {
  const sanitized = sanitizePrivateResponseFields(data, options?.preserveKeys);
  const auth = response.locals.auth as AuthContext | undefined;
  return response.json({
    success: true,
    message,
    data: auth ? shapeOperationalResponse(auth, sanitized) : sanitized,
    meta: sanitizePrivateResponseFields(meta)
  });
};
