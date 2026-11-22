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
 * Email from the environment. Any SMTP server works, including free ones:
 *  - Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true, SMTP_USER=you@gmail.com,
 *    SMTP_PASS=<16-character app password> (Google Account → Security → App passwords; free, ~500 mails/day)
 *  - Brevo free plan: SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 (300 mails/day)
 * MAIL_OUTBOX_DIR (development and tests only) writes each mail as a JSON file instead of sending it.
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const from = env.MAIL_FROM || env.SMTP_USER || 'Budget me <no-reply@localhost>';
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
  if (!env.SMTP_HOST) return noMailer;
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    requireTLS: port !== 465, // never send a code over an unencrypted connection
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
    subject: `Budget me: your password reset code ${code}`,
    text: [
      `Hi ${username},`,
      '',
      `Your Budget me password reset code is: ${code}`,
      `It works once, for ${minutes} minutes. On the sign-in screen tap "Forgot password?", enter the code and choose a new password.`,
      "If you didn't ask for this, ignore this email: your password stays the same.",
      '',
      '—',
      '',
      `أهلاً ${username}،`,
      `كود إعادة تعيين الباسورد بتاعك في Budget me: ${code}`,
      `الكود بيشتغل مرة واحدة، لمدة ${minutes} دقيقة. من شاشة الدخول دوس "نسيت الباسورد؟" واكتب الكود واختار باسورد جديد.`,
      'لو مش انت اللي طلبت ده، تجاهل الرسالة: الباسورد بتاعك مش هيتغير.',
    ].join('\n'),
  };
}

/** Send without making the request wait (and without revealing whether the address exists). */
export function sendInBackground(mailer: Mailer, m: MailMessage) {
  mailer.send(m).catch((err: Error) => log.error({ err: { message: err.message } }, 'sending email failed'));
}
