import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const attachRequestContext: RequestHandler = (request, _response, next) => {
  request.requestContext = {
    requestId: request.header("x-request-id") ?? randomUUID()
  };
  next();
};
