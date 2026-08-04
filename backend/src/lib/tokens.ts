import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function signAccessToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: ACCESS_TOKEN_TTL_MS / 1000 });
}

export function verifyAccessToken(token: string, secret: string): string {
  const payload = jwt.verify(token, secret);
  if (typeof payload !== "object" || payload === null || typeof (payload as any).sub !== "string") {
    throw new Error("invalid token payload");
  }
  return (payload as any).sub;
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}
