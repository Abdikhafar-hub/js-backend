import type { RequestHandler } from "express";

import { logger } from "../config/logger.js";

export const requestLogger: RequestHandler = (request, response, next) => {
  const startedAt = Date.now();

  response.on("finish", () => {
    logger.info(
      {
        requestId: request.requestContext.requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      },
      "HTTP request completed"
    );
  });

  next();
};
