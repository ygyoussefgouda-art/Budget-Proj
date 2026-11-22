import { Check } from 'lucide-react';
import { t } from '../i18n';

/** The same rules the server checks for every new password (server/src/validation.ts passwordProblems). */
export const PASSWORD_RULES: { key: string; label: string; ok: (pw: string) => boolean }[] = [
  { key: 'lowercase', label: 'One lowercase character', ok: (p) => /[a-z]/.test(p) },
  { key: 'special', label: 'One special character', ok: (p) => /[^A-Za-z0-9]/.test(p) },
  { key: 'uppercase', label: 'One uppercase character', ok: (p) => /[A-Z]/.test(p) },
  { key: 'length', label: '8 characters minimum', ok: (p) => p.length >= 8 },
  { key: 'number', label: 'One number', ok: (p) => /[0-9]/.test(p) },
];

export const passwordOk = (pw: string) => PASSWORD_RULES.every((r) => r.ok(pw));

/** Same checks as the server, so the person sees what's wrong before sending. */
export function newPasswordError(password: string, username: string, strong: boolean): string | null {
  if (username && password.toLowerCase() === username.toLowerCase()) return t('Your password must not be the same as your username.');
  if (strong && !passwordOk(password)) return t('Your password does not meet all the rules yet.');
  if (!strong && password.length < 10) return t('Use a password of at least 10 characters.');
  return null;
}

/** Live checklist under a new-password field: each rule turns green with a tick once met. */
export function PasswordRules({ password, id }: { password: string; id?: string }) {
  return (
    <ul className="pw-rules" id={id} aria-label={t('Rules for the new password')}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.ok(password);
        return (
          <li key={r.key} className={ok ? 'ok' : ''}>
            <span className="pw-dot" aria-hidden="true">
              {ok && <Check size={10} strokeWidth={3.5} />}
            </span>
            <span>
              {t(r.label)}
              <span className="sr-only">{ok ? ` (${t('done')})` : ` (${t('missing')})`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
