import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { log } from './log.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  /** False when no way to send email is set up: "Forgot password?" falls back to admin codes. */
  enabled: boolean;
  send(m: MailMessage): Promise<void>;
}

export const noMailer: Mailer = { enabled: false, send: async () => undefined };

/**
 * A mail server on this machine or its private Docker network: a bare service name ("mail"), localhost
 * or a loopback address. Only these may be reached without TLS (SMTP_REQUIRE_TLS=false).
 */
export function isLocalMailHost(host: string | undefined) {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(h) || h === '127.0.0.1' || h === '::1';
}

/** The sender when MAIL_FROM is not set. */
export const DEFAULT_FROM = 'Masrofy <no-reply@masrofy.online>';

/**
 * Email from the environment.
 *  - Production (docker-compose): the app's own mail server, the `mail` service (Postfix) on the private
 *    Docker network: SMTP_HOST=mail SMTP_PORT=25 SMTP_REQUIRE_TLS=false. That hop never leaves the VPS;
 *    Postfix then delivers to Gmail etc. over TLS when they offer it, signed with DKIM. See DEPLOY.md.
 *  - Any other SMTP server works too (Gmail with an app password, Brevo's free plan...).
 * SMTP_REQUIRE_TLS=false is only for that private hop: every other connection must be encrypted.
 * MAIL_OUTBOX_DIR (development and tests only) writes each mail as a JSON file instead of sending it.
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const from = env.MAIL_FROM || DEFAULT_FROM;
  if (env.MAIL_OUTBOX_DIR) {
    const dir = path.resolve(env.MAIL_OUTBOX_DIR);
    mkdirSync(dir, { recursive: true });
    let n = 0;
    return {
      enabled: true,
      async send(m) {
        writeFileSync(path.join(dir, `${Date.now()}-${n++}.json`), JSON.stringify({ from, ...m }));
      },
    };
  }
  if (!env.SMTP_HOST || ['off', 'none', 'false'].includes(env.SMTP_HOST.trim().toLowerCase())) return noMailer;
  const port = Number(env.SMTP_PORT) || 587;
  const plainLocalHop = env.SMTP_REQUIRE_TLS === 'false' && isLocalMailHost(env.SMTP_HOST);
  if (env.SMTP_REQUIRE_TLS === 'false' && !plainLocalHop) {
    log.warn({ host: env.SMTP_HOST }, 'mail: SMTP_REQUIRE_TLS=false is ignored for a server outside this machine; TLS stays required');
  }
  if (plainLocalHop) log.info({ host: env.SMTP_HOST }, 'mail: plain SMTP to the local mail server (private Docker network only)');
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    requireTLS: !plainLocalHop && port !== 465, // never send a code over an unencrypted connection to another server
    ignoreTLS: plainLocalHop,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });
  return {
    enabled: true,
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

/** The "Forgot password?" email, in English and Egyptian Arabic (we don't know the reader's language). */
export function resetCodeMail(to: string, username: string, code: string, minutes: number): MailMessage {
  return {
    to,
    subject: `Masrofy: your password reset code ${code}`,
    text: [
      `Hi ${username},`,
      '',
      `Your Masrofy password reset code is: ${code}`,
      `It works once, for ${minutes} minutes. On the sign-in screen tap "Forgot password?", enter the code and choose a new password.`,
      "If you didn't ask for this, ignore this email: your password stays the same.",
      '',
      '—',
      '',
      `أهلاً ${username}،`,
      `كود إعادة تعيين الباسورد بتاعك في مصروفي: ${code}`,
      `الكود بيشتغل مرة واحدة، لمدة ${minutes} دقيقة. من شاشة الدخول دوس "نسيت الباسورد؟" واكتب الكود واختار باسورد جديد.`,
      'لو مش انت اللي طلبت ده، تجاهل الرسالة: الباسورد بتاعك مش هيتغير.',
      '',
      '—',
      'Masrofy · مصروفي',
      'This is an automatic message from no-reply@masrofy.online; replies are not read.',
    ].join('\n'),
  };
}

/** Send without making the request wait (and without revealing whether the address exists). */
export function sendInBackground(mailer: Mailer, m: MailMessage) {
  mailer.send(m).catch((err: Error) => log.error({ err: { message: err.message } }, 'sending email failed'));
}
