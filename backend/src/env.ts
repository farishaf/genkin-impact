import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  SMTP_HOST: required("SMTP_HOST"),
  SMTP_PORT: Number(required("SMTP_PORT")),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: required("SMTP_USER"),
  SMTP_PASS: required("SMTP_PASS"),
  CONTACT_EMAIL_FROM: required("CONTACT_EMAIL_FROM"),
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV ?? "development",
  // Receipt scanning. Optional: without a key, POST /receipts/scan answers 503 and the form stays manual.
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || undefined,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "deepseek-flash",
  // Fuel AI inputs (meal photos, text parsing). Optional: without a key those paths answer 503 and manual entry stays.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
  // Optional: per-100g data for AI-listed foods. Without it, saved foods and the model's estimate are used.
  USDA_API_KEY: process.env.USDA_API_KEY || undefined,
  // Monthly AI spend cap per user, in USD. When reached, AI paths turn off and manual paths keep working.
  AI_MONTHLY_CAP_USD: Number(process.env.AI_MONTHLY_CAP_USD ?? 5),
  // Open Food Facts asks every client to identify itself.
  OFF_USER_AGENT: process.env.OFF_USER_AGENT || "Hitsune/0.1 (+https://mainichi.splitz.web.id)",
};
