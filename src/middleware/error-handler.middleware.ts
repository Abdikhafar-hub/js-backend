import type { ErrorRequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import { ZodError } from "zod";

import { logger } from "../config/logger.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

export const errorHandler: ErrorRequestHandler = (error, request, response) => {
  if (error instanceof ZodError) {
    response.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Validation failed",
        details: error.flatten(),
        requestId: request.requestContext.requestId
      }
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.requestContext.requestId
      }
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "Uploaded file exceeds the allowed size limit" : "Invalid multipart upload";

    response.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message,
        requestId: request.requestContext.requestId
      }
    });
    return;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const prismaCode = String(error.code);

    if (prismaCode === "P2025") {
      response.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: "Requested record was not found",
          requestId: request.requestContext.requestId
        }
      });
      return;
    }

    if (prismaCode === "P2002") {
      response.status(StatusCodes.CONFLICT).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "A unique constraint was violated",
          requestId: request.requestContext.requestId
        }
      });
      return;
    }
  }

  logger.error({ err: error, requestId: request.requestContext.requestId }, "Unhandled error");

  response.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId: request.requestContext.requestId
    }
  });
};
