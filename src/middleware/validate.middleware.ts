import type { NextFunction, Request, Response } from "express";
import type { AnyZodObject, ZodEffects, ZodTypeAny } from "zod";

type Schema = AnyZodObject | ZodEffects<AnyZodObject> | ZodTypeAny;

export const validateRequest =
  (schema: Schema) =>
  async (request: Request, _response: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: request.body,
        query: request.query,
        params: request.params,
        headers: request.headers
      });

      next();
    } catch (error) {
      next(error);
    }
  };
