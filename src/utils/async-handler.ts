import type { NextFunction, Request, Response, RequestHandler } from "express";

export const asyncHandler =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
