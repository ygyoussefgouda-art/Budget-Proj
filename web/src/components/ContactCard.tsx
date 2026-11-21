import { Bug, Lightbulb, Mail } from 'lucide-react';
import { t, useI18n } from '../i18n';
import { APP_NAME, APP_VERSION } from '../version';
import { Card, SectionTitle } from './ui';

export const CONTACT_EMAIL = 'youssefgoudawork@gmail.com';

/**
 * A mailto: link with the subject and a short template filled in. Only the app version and
 * language are included (no account details), so the user decides what else to share.
 */
export function contactLink(kind: 'bug' | 'idea', lang: string) {
  const version = `${APP_NAME} ${APP_VERSION} (${lang})`;
  const subject = kind === 'bug' ? `[Bug] ${APP_NAME} ${APP_VERSION}` : `[Idea] ${APP_NAME} ${APP_VERSION}`;
  const body =
    kind === 'bug'
      ? `${t('What happened?')}\n\n\n${t('What did you expect?')}\n\n\n${t('Steps to make it happen again:')}\n1.\n2.\n\n---\n${version}`
      : `${t('What would you like the app to do?')}\n\n\n${t('Why would it help you?')}\n\n\n---\n${version}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Settings → Contact us: report a bug or suggest a feature by email. */
export default function ContactCard() {
  const { lang } = useI18n();
  return (
    <Card>
      <SectionTitle trailing={<Mail size={18} className="mute" />}>{t('Contact us')}</SectionTitle>
      <p className="small mute">{t('Found a bug or have an idea for a feature? Send us an email, we read every one.')}</p>
      <div className="stack" style={{ marginTop: 10 }}>
        <a className="btn tonal block" href={contactLink('bug', lang)}>
          <Bug size={18} /> {t('Report a bug')}
        </a>
        <a className="btn tonal block" href={contactLink('idea', lang)}>
          <Lightbulb size={18} /> {t('Suggest a feature')}
        </a>
      </div>
      <p className="tiny mute" style={{ marginTop: 8 }}>
        {t('Or write to')}{' '}
        <a className="link" href={`mailto:${CONTACT_EMAIL}`} dir="ltr">
          {CONTACT_EMAIL}
        </a>
      </p>
    </Card>
  );
}
