import { StatusCodes } from "http-status-codes";

import type { ErrorCode } from "./error-codes.js";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = StatusCodes.BAD_REQUEST,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
