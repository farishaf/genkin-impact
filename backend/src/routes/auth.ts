import { Router, type Response, type Request } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
} from "../lib/tokens.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const authRouter = Router();

const DEFAULT_CATEGORIES: Array<{ name: string; emoji: string; kind: "expense" | "income" }> = [
  { name: "Delivery", emoji: "🍕", kind: "expense" },
  { name: "Pet", emoji: "🐸", kind: "expense" },
  { name: "Gasoline", emoji: "⛽", kind: "expense" },
  { name: "Fruit", emoji: "🥝", kind: "expense" },
  { name: "Health", emoji: "🧬", kind: "expense" },
  { name: "Travel", emoji: "⛱️", kind: "expense" },
  { name: "Salary", emoji: "", kind: "income" },
  { name: "Bonus", emoji: "", kind: "income" },
  { name: "Refund", emoji: "", kind: "income" },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const secure = env.NODE_ENV === "production";
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_MS,
  });
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function toPublicUser(row: any) {
  const { password_hash, email_verification_token_hash, ...rest } = row;
  return rest;
}

async function issueSession(userId: string, req: Request, res: Response) {
  const accessToken = signAccessToken(userId, env.JWT_SECRET);
  const refresh = generateRefreshToken();
  await pool.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), userId, refresh.hash, req.headers["user-agent"] ?? null, req.ip ?? null, refresh.expiresAt]
  );
  setAuthCookies(res, accessToken, refresh.raw);
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters."),
  display_name: z.string().min(1).max(80),
});

authRouter.post("/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, display_name } = req.body as z.infer<typeof registerSchema>;

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      throw new AppError(409, "email_taken", "An account with this email already exists.");
    }

    const passwordHash = await hashPassword(password);
    const userId = newId();
    const rawVerifyToken = randomBytes(24).toString("base64url");
    const verifyTokenHash = createHash("sha256").update(rawVerifyToken).digest("hex");
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, email_verification_token_hash, email_verification_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, email, passwordHash, display_name, verifyTokenHash, verifyExpiresAt]
      );

      for (const [i, cat] of DEFAULT_CATEGORIES.entries()) {
        await client.query(
          `INSERT INTO categories (id, user_id, name, emoji, kind, sort_order, is_system) VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [newId(), userId, cat.name, cat.emoji, cat.kind, i]
        );
      }

      await client.query(
        `INSERT INTO members (id, user_id, name, initials, is_default) VALUES ($1, $2, $3, $4, true)`,
        [newId(), userId, display_name, initialsOf(display_name)]
      );

      await client.query("COMMIT");

      const user = userRes.rows[0];

      // Best-effort: a broken SMTP config must never block registration.
      const verifyUrl = `${env.APP_ORIGIN}/verify-email?token=${rawVerifyToken}`;
      sendVerificationEmail(email, verifyUrl).catch((err) => console.error("failed to send verification email", err));

      await issueSession(userId, req, res);
      res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    const user = result.rows[0];

    const genericError = () => new AppError(401, "invalid_credentials", "Email or password is incorrect.");

    if (!user) throw genericError();
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) throw genericError();

    await issueSession(user.id, req, res);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new AppError(401, "unauthenticated", "No refresh token.");

    const hash = hashRefreshToken(rawToken);
    const sessionRes = await pool.query(
      `SELECT * FROM sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash]
    );
    const session = sessionRes.rows[0];
    if (!session) throw new AppError(401, "unauthenticated", "Session expired or revoked.");

    await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [session.id]);
    await issueSession(session.user_id, req, res);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      const hash = hashRefreshToken(rawToken);
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL", [hash]);
    }
    res.clearCookie("access_token", { path: "/" });
    res.clearCookie("refresh_token", { path: "/" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [req.userId]);
    const user = result.rows[0];
    if (!user) throw new AppError(401, "unauthenticated", "User not found.");
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({ token: z.string().min(1) });

authRouter.post("/verify", validateBody(verifySchema), async (req, res, next) => {
  try {
    const { token } = req.body as z.infer<typeof verifySchema>;
    const hash = createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      `UPDATE users SET email_verified_at = now(), email_verification_token_hash = NULL
       WHERE email_verification_token_hash = $1 AND email_verification_expires_at > now()
       RETURNING id`,
      [hash]
    );
    if (result.rows.length === 0) throw new AppError(400, "invalid_token", "This verification link is invalid or expired.");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
