import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./lib/prisma.js";
import { attachRequestContext } from "./middleware/request-context.middleware.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { notFoundHandler } from "./middleware/not-found.middleware.js";
import { requestLogger } from "./middleware/request-logger.middleware.js";
import { apiRouter } from "./routes/index.js";
import { registerDocs } from "./config/swagger.js";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.CORS_ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("CORS origin not allowed"));
      },
      credentials: true
    })
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => env.NODE_ENV === "development"
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(
    "/uploads",
    express.static("uploads", {
      setHeaders: (response) => {
        response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      }
    })
  );
  app.use(attachRequestContext);
  app.use(requestLogger);

  app.get("/health", (_request, response) => {
    response.status(200).json({
      success: true,
      message: "Service is healthy",
      data: {
        status: "ok",
        environment: env.NODE_ENV
      }
    });
  });

  app.get("/health/ready", async (_request, response, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      response.status(200).json({
        success: true,
        message: "Service is ready",
        data: {
          status: "ready"
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/v1", apiRouter);
  registerDocs(app);
  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info("Application configured");
  return app;
};
