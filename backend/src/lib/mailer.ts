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
