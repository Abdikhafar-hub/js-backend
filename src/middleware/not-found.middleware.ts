import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(StatusCodes.NOT_FOUND).json({
    success: false,
    error: {
      code: "RESOURCE_NOT_FOUND",
      message: `Route ${request.method} ${request.originalUrl} not found`,
      requestId: request.requestContext.requestId
    }
  });
};
