import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const attachmentsRouter = Router();

// ponytail: local disk storage, no S3 config in this repo yet. storage_key is just the
// filename on disk, so swapping to an S3-backed multer storage engine later is a one-file change.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${newId()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

async function loadOwnedTransaction(userId: string, transactionId: string) {
  const res = await pool.query(
    `SELECT id FROM transactions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [transactionId, userId]
  );
  if (res.rows.length === 0) throw new AppError(404, "not_found", "Transaction not found.");
  return res.rows[0];
}

async function loadOwnedAttachment(userId: string, attachmentId: string) {
  const res = await pool.query(
    `SELECT a.* FROM attachments a
     JOIN transactions t ON t.id = a.transaction_id
     WHERE a.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
    [attachmentId, userId]
  );
  if (res.rows.length === 0) throw new AppError(404, "not_found", "Attachment not found.");
  return res.rows[0];
}

attachmentsRouter.post("/transactions/:id/attachments", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    await loadOwnedTransaction(req.userId!, String(req.params.id));
    if (!req.file) {
      throw new AppError(400, "invalid_file", "File missing, too large, or not an allowed type (jpeg, png, webp, pdf, max 5MB).");
    }
    const id = newId();
    const result = await pool.query(
      `INSERT INTO attachments (id, transaction_id, storage_key, mime_type, byte_size)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, String(req.params.id), req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ attachment: result.rows[0] });
  } catch (err) {
    if (req.file) fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
    next(err);
  }
});

attachmentsRouter.get("/attachments/:id", requireAuth, async (req, res, next) => {
  try {
    const attachment = await loadOwnedAttachment(req.userId!, String(req.params.id));
    res.setHeader("Content-Type", attachment.mime_type);
    res.sendFile(path.join(UPLOAD_DIR, attachment.storage_key));
  } catch (err) {
    next(err);
  }
});

attachmentsRouter.delete("/attachments/:id", requireAuth, async (req, res, next) => {
  try {
    const attachment = await loadOwnedAttachment(req.userId!, String(req.params.id));
    await pool.query("DELETE FROM attachments WHERE id = $1", [attachment.id]);
    fs.unlink(path.join(UPLOAD_DIR, attachment.storage_key), () => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
