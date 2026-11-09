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
};
