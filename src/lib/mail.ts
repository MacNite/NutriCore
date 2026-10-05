import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";

export type MailConfiguration = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  source: "environment" | "administrator" | "none";
};

const booleanValue = (value: string | undefined, fallback = false) =>
  value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());

const encryptionKey = () => createHash("sha256").update(process.env.APP_SECRET ?? "").digest();

export function encryptMailPassword(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptMailPassword(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Environment SMTP_HOST selects environment configuration and takes precedence. */
export async function getMailConfiguration(): Promise<MailConfiguration> {
  if (process.env.SMTP_HOST) {
    return {
      enabled: booleanValue(process.env.SMTP_ENABLED, true),
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: booleanValue(process.env.SMTP_SECURE),
      username: process.env.SMTP_USERNAME ?? "",
      password: process.env.SMTP_PASSWORD ?? "",
      fromEmail: process.env.SMTP_FROM_EMAIL ?? "",
      fromName: process.env.SMTP_FROM_NAME ?? "NutriCore",
      source: "environment",
    };
  }

  const stored = await prisma.mailSettings.findUnique({ where: { id: "default" } });
  if (!stored) return { enabled: false, host: "", port: 587, secure: false, username: "", password: "", fromEmail: "", fromName: "NutriCore", source: "none" };
  let password = "";
  if (stored.passwordEncrypted) {
    try { password = decryptMailPassword(stored.passwordEncrypted); } catch { password = ""; }
  }
  return {
    enabled: stored.enabled,
    host: stored.host ?? "",
    port: stored.port,
    secure: stored.secure,
    username: stored.username ?? "",
    password,
    fromEmail: stored.fromEmail ?? "",
    fromName: stored.fromName ?? "NutriCore",
    source: "administrator",
  };
}

async function mailTransport() {
  const config = await getMailConfiguration();
  if (!config.enabled) return null;
  if (!config.host || !config.fromEmail) throw new Error("SMTP host and sender address are required");
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
  });
  return { transport, from: { name: config.fromName || "NutriCore", address: config.fromEmail } };
}

export async function sendInvitationMail(input: { to: string; name?: string | null; inviteUrl: string; expiresAt: Date }) {
  const mail = await mailTransport();
  if (!mail) return { sent: false as const, reason: "disabled" as const };

  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  await mail.transport.sendMail({
    from: mail.from,
    to: input.to,
    subject: "Your NutriCore invitation",
    text: `${greeting}\n\nYou have been invited to NutriCore. Create your account here:\n${input.inviteUrl}\n\nThis link expires ${input.expiresAt.toISOString()}.`,
    html: `<p>${escapeHtml(greeting)}</p><p>You have been invited to NutriCore.</p><p><a href="${escapeHtml(input.inviteUrl)}">Create your account</a></p><p>This link expires ${escapeHtml(input.expiresAt.toISOString())}.</p>`,
  });
  return { sent: true as const };
}

/**
 * Security notice to the address an account used to sign in with. The new
 * address is deliberately left out: if the change was not the owner's doing,
 * the notice must not hand the intruder's address to whoever reads it, and the
 * owner needs only to know that it happened.
 */
export async function sendEmailChangedMail(input: { to: string; name?: string | null; changedAt: Date }) {
  const mail = await mailTransport();
  if (!mail) return { sent: false as const, reason: "disabled" as const };

  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const body = `The sign-in email address of your NutriCore account was changed on ${input.changedAt.toISOString()}. This address will no longer be used for your account.`;
  const advice = "If you did not make this change, contact your NutriCore administrator immediately.";
  await mail.transport.sendMail({
    from: mail.from,
    to: input.to,
    subject: "Your NutriCore email address was changed",
    text: `${greeting}\n\n${body}\n\n${advice}`,
    html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p>${escapeHtml(advice)}</p>`,
  });
  return { sent: true as const };
}

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
