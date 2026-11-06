import nodemailer from "nodemailer";
import { env } from "../env.js";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await transport.sendMail({
    from: env.CONTACT_EMAIL_FROM,
    to,
    subject: "Verify your Genkin-Impact email",
    text: `Welcome to Genkin-Impact. Verify your email: ${verifyUrl}`,
    html: `<p>Welcome to Genkin-Impact.</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await transport.sendMail({
    from: env.CONTACT_EMAIL_FROM,
    to,
    subject: "Reset your Genkin-Impact password",
    text: `Reset your password: ${resetUrl}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Reset your password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  });
}
