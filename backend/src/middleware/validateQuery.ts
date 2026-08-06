import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errorHandler.js";

// Express 5's req.query is a getter-only accessor on the request prototype (no setter),
// so unlike validateBody's `req.body = result.data`, we can't reassign req.query directly —
// under ESM's implicit strict mode that throws "Cannot set property query of ... which has
// only a getter" at request time. Stash the parsed/coerced result on a separate property
// instead, and have route handlers read from req.validatedQuery.
declare global {
  namespace Express {
    interface Request {
      validatedQuery?: unknown;
    }
  }
}

export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new AppError(400, "validation_error", result.error.issues.map((i) => i.message).join("; ")));
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}
