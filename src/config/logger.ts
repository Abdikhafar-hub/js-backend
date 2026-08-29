import pino from "pino";

import { env } from "./env.js";

export const logger = pino({
  name: "perfume-erp-backend",
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true
          }
        }
      }
    : {}),
  redact: {
    paths: [
      "req.headers.authorization",
      "request.headers.authorization",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.tokenHash",
      "*.secret",
      "*.passkey"
    ],
    censor: "[REDACTED]"
  }
});
