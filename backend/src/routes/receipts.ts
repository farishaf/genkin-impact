import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const receiptsRouter = Router();

// The photo only passes through: it is read in memory, sent to the model, and never written to disk.
// (Attaching it to the logged expense still goes through /transactions/:id/attachments.)
// DeepSeek reads JPEG, PNG, GIF and WebP; HEIC is not accepted.
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_MIME.has(file.mimetype)),
});

// The model's reply is untrusted input: everything is re-checked here before it reaches the form.
const scanSchema = z.object({
  store: z.string().max(120).catch(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).catch(""),
  currency: z.string().max(3).catch(""),
  total: z.number().nonnegative().nullable().catch(null),
  items: z
    .array(
      z.object({
        name: z.string().max(200),
        qty: z.number().positive().catch(1),
        unit_price: z.number().nonnegative(),
        category_id: z.string().optional(),
      })
    )
    .max(100),
});
export type ReceiptScan = z.infer<typeof scanSchema>;

const PROMPT = `You read a photo of a shopping receipt and reply with json only, in exactly this shape:
{"store": "Superindo", "date": "2026-11-08", "currency": "IDR", "total": 37500, "items": [{"name": "Milk", "qty": 2, "unit_price": 12500, "category_id": "<id>"}]}
- store: the shop name as printed, or "".
- date: the purchase date as YYYY-MM-DD, or "" if not printed.
- currency: ISO 4217 code if you can tell (e.g. IDR, JPY, USD), else "".
- total: the final amount paid as printed, or null.
- items: one entry per purchased line. qty is the count (1 if not printed). unit_price is the price of ONE unit after any per-item discount.
  Put tax or service charge as its own item. Spread a whole-receipt discount over the items it applies to; never return negative prices.
- All amounts are plain numbers in the receipt's currency with no thousands separators: "Rp 12.500" is 12500, "¥1,280" is 1280, "$3.49" is 3.49.
- category_id: the id of the closest of the user's categories listed below, or leave it out if none fit.
Do not invent lines that are not on the receipt.`;

async function askModel(image: Express.Multer.File, categories: { id: string; name: string }[]): Promise<ReceiptScan> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY!}` },
    // ponytail: deepseek-flash answers in ~3s; the slack covers peak-hour queues.
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL,
      // Reading a receipt needs no reasoning: thinking off is faster and cheaper.
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${PROMPT}\n\nCategories (id: name):\n${categories.map((c) => `${c.id}: ${c.name}`).join("\n")}` },
        {
          // Images are only accepted in user messages.
          role: "user",
          content: [
            { type: "text", text: "Read this receipt as json." },
            { type: "image_url", image_url: { url: `data:${image.mimetype};base64,${image.buffer.toString("base64")}` } },
          ],
        },
      ],
    }),
  }).catch((e: unknown) => {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    console.error(`receipt scan: ${timedOut ? "timed out" : "fetch failed"}`);
    throw new AppError(504, "scan_failed", timedOut ? "The receipt reader took too long. Try again, or fill it in by hand." : "Couldn't reach the receipt reader. Try again.");
  });

  if (!res.ok) {
    // The provider's error message says why (bad key, no balance, unknown model); the request body is never logged.
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    console.error(`receipt scan: model returned ${res.status}${detail ? `: ${detail}` : ""}`);
    throw new AppError(502, "scan_failed", "The receipt reader failed. Try again, or fill it in by hand.");
  }
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
  const text = body?.choices?.[0]?.message?.content ?? "";
  let parsed: ReceiptScan;
  try {
    parsed = scanSchema.parse(JSON.parse(text));
  } catch {
    throw new AppError(502, "scan_failed", "Couldn't read that receipt. Try a sharper photo, or fill it in by hand.");
  }
  const known = new Set(categories.map((c) => c.id));
  return { ...parsed, items: parsed.items.map((it) => ({ ...it, category_id: it.category_id && known.has(it.category_id) ? it.category_id : undefined })) };
}

receiptsRouter.post("/scan", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!env.DEEPSEEK_API_KEY) throw new AppError(503, "scan_unavailable", "Receipt scanning isn't set up. Add DEEPSEEK_API_KEY to the server env.");
    if (!req.file) throw new AppError(400, "invalid_file", "Send a receipt photo (jpeg, png, webp or gif, max 5 MB).");
    const categories = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM categories WHERE user_id = $1 AND kind = 'expense' AND deleted_at IS NULL ORDER BY sort_order",
      [req.userId]
    );
    res.json({ scan: await askModel(req.file, categories.rows) });
  } catch (err) {
    next(err);
  }
});
