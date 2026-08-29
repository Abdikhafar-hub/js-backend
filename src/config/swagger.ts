import type { Express } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

import { env } from "./env.js";

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Perfume ERP API",
      version: "0.1.0",
      description: "Production-oriented backend foundation for a multi-branch perfume ERP."
    },
    servers: [
      {
        url: env.API_BASE_URL
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    }
  },
  apis: ["./src/modules/**/*.ts"]
});

export const registerDocs = (app: Express) => {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/docs.json", (_request, response) => {
    response.json(swaggerSpec);
  });
};
