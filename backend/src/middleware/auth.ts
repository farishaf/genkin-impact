import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/tokens.js";
import { env } from "../env.js";
import { AppError } from "./errorHandler.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;
  if (!token) {
    next(new AppError(401, "unauthenticated", "Not signed in."));
    return;
  }
  try {
    req.userId = verifyAccessToken(token, env.JWT_SECRET);
    next();
  } catch {
    next(new AppError(401, "unauthenticated", "Session expired."));
  }
}
