import { useEffect, useState } from 'react';
import { t } from '../i18n';
import Brand from './Brand';

/** Logo, name, tagline and the hopping dots (same markup as the copy in index.html). */
function BootContent() {
  return (
    <>
      <img className="boot-logo" src="/icon.svg" alt="" width={80} height={80} />
      <div className="boot-name">
        <Brand />
      </div>
      <p className="boot-tagline">{t('Your money, planned')}</p>
      <div className="boot-dots">
        <i />
        <i />
        <i />
      </div>
    </>
  );
}

/**
 * Full-screen loading screen (app start, signing in, loading your data), or an error with "Try again".
 * index.html draws the same screen before the app's code has loaded, so there is no blank flash.
 * `label` is read out by screen readers only.
 */
export default function Splash({ text, retry, label }: { text?: string; retry?: () => void; label?: string }) {
  if (text) {
    return (
      <div className="splash">
        <p>{text}</p>
        {retry && (
          <button className="btn primary" onClick={retry}>
            {t('Try again')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="splash boot" role="status" aria-live="polite">
      <div className="boot-inner" aria-hidden="true">
        <BootContent />
      </div>
      <span className="sr-only">{label ?? t('Loading')}</span>
    </div>
  );
}

/** Shown once when the app appears: the loading screen fades out over Home. Clicks go straight through. */
export function SplashExit() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setOn(false), 500);
    return () => clearTimeout(id);
  }, []);
  if (!on) return null;
  return (
    <div className="splash boot boot-exit" aria-hidden="true">
      <div className="boot-inner">
        <BootContent />
      </div>
    </div>
  );
}
