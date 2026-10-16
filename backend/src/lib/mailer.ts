import nodemailer from "nodemailer";
import { env } from "../env.js";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await transport.sendMail({
    from: env.CONTACT_EMAIL_FROM,
    to,
    subject: "Reset your Genkin password",
    text: `Someone asked to reset the password for this Genkin account. If it was you, open this link within an hour: ${resetUrl}\n\nIf it wasn't you, ignore this email — your password stays the same.`,
    html: `<p>Someone asked to reset the password for this Genkin account.</p><p><a href="${resetUrl}">Choose a new password</a> (link works for one hour).</p><p>If it wasn't you, ignore this email — your password stays the same.</p>`,
  });
}

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await transport.sendMail({
    from: env.CONTACT_EMAIL_FROM,
    to,
    subject: "Verify your Genkin-Impact email",
    text: `Welcome to Genkin-Impact. Verify your email: ${verifyUrl}`,
    html: `<p>Welcome to Genkin-Impact.</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });
}
