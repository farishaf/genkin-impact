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
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/mailer.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

export const authRouter = Router();

const DEFAULT_CATEGORIES: Array<{ name: string; kind: "expense" | "income" }> = [
  { name: "Delivery", kind: "expense" },
  { name: "Pet", kind: "expense" },
  { name: "Gasoline", kind: "expense" },
  { name: "Fruit", kind: "expense" },
  { name: "Health", kind: "expense" },
  { name: "Travel", kind: "expense" },
  { name: "Salary", kind: "income" },
  { name: "Bonus", kind: "income" },
  { name: "Refund", kind: "income" },
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

// Computed lazily, once, and cached — used to pay the same Argon2id verify
// cost on a nonexistent-email login attempt as a real wrong-password attempt,
// so response timing can't be used to enumerate accounts.
let dummyPasswordHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = hashPassword("dummy-password-for-constant-time-comparison");
  }
  return dummyPasswordHashPromise;
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
          `INSERT INTO categories (id, user_id, name, kind, sort_order, is_system) VALUES ($1, $2, $3, $4, $5, true)`,
          [newId(), userId, cat.name, cat.kind, i]
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
      // The pre-check above is a fast-path only; two concurrent registrations
      // for the same email can both pass it and race to INSERT. Translate the
      // resulting unique-violation into the same 409 the pre-check produces,
      // instead of letting a raw Postgres error fall through to a 500.
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(409, "email_taken", "An account with this email already exists.");
      }
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

    // Always run one real verifyPassword call before responding, whether or
    // not the user exists, so the two failure paths are timing-indistinguishable.
    const valid = user
      ? await verifyPassword(user.password_hash, password)
      : await verifyPassword(await getDummyPasswordHash(), password);
    if (!user || !valid) throw genericError();

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
      `SELECT s.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_SECONDS = 60;

function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Always answers { ok: true } so the endpoint can't be used to discover which emails have accounts.
authRouter.post("/forgot-password", validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
    const userRes = await pool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    const user = userRes.rows[0];

    if (user) {
      // One email per account per cooldown window, so the form can't be used to flood an inbox.
      // Check-and-insert in one statement so near-simultaneous requests don't each pass the check.
      const rawToken = randomBytes(32).toString("base64url");
      const inserted = await pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM password_reset_tokens
           WHERE user_id = $2 AND created_at > now() - make_interval(secs => $5)
         )
         RETURNING id`,
        [newId(), user.id, hashResetToken(rawToken), new Date(Date.now() + RESET_TOKEN_TTL_MS), RESET_REQUEST_COOLDOWN_SECONDS]
      );
      if (inserted.rows.length > 0) {
        const resetUrl = `${env.APP_ORIGIN}/reset-password?token=${rawToken}`;
        // Best-effort, like verification: a broken SMTP config must not change the response.
        sendPasswordResetEmail(email, resetUrl).catch((err) => console.error("failed to send password reset email", err));
        // Read process.env, not env: env.NODE_ENV defaults to "development" when unset, and a
        // deploy that forgot NODE_ENV must never write live reset links to its logs.
        if (process.env.NODE_ENV === "development") {
          // Seeded/demo accounts use addresses that can't receive mail; surface the link locally.
          console.info(`[dev] password reset link for ${email}: ${resetUrl}`);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Password must be at least 10 characters."),
});

authRouter.post("/reset-password", validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body as z.infer<typeof resetPasswordSchema>;
    const tokenHash = hashResetToken(token);
    // Cheap lock-free check first, so random tokens can't make us burn an Argon2 hash each.
    // The locked re-check inside the transaction stays the source of truth.
    const precheck = await pool.query(
      "SELECT 1 FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
      [tokenHash]
    );
    if (precheck.rows.length === 0) throw new AppError(400, "invalid_token", "This reset link is invalid or has expired.");
    // Hash before opening the transaction so the row lock below is held only briefly.
    const passwordHash = await hashPassword(password);

    const client = await pool.connect();
    let userId: string;
    try {
      await client.query("BEGIN");
      // FOR UPDATE serialises concurrent uses of one token: the second request re-checks
      // used_at after the first commits and finds nothing.
      const tokenRes = await client.query(
        `SELECT t.id, t.user_id FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.deleted_at IS NULL
         FOR UPDATE OF t`,
        [tokenHash]
      );
      const row = tokenRes.rows[0];
      if (!row) throw new AppError(400, "invalid_token", "This reset link is invalid or has expired.");
      userId = row.user_id;

      // Following an emailed link also proves the address, so count it as verified.
      await client.query(
        "UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2",
        [passwordHash, userId]
      );
      // Burn this token and any other outstanding ones for the account.
      await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
      // Whoever knew the old password is signed out everywhere.
      await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await issueSession(userId, req, res);
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    res.json({ user: toPublicUser(userRes.rows[0]) });
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
