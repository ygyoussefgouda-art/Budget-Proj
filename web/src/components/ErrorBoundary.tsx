import { RotateCw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../errors';
import { t } from '../i18n';
import { clearOfflineCache } from '../persist';
import { APP_NAME, APP_VERSION, MARK, VERSION_KEY } from '../version';

/** Reload without the offline copy: if bad saved data caused the crash, it must not come back. */
async function reloadFresh() {
  await Promise.race([clearOfflineCache(), new Promise((r) => setTimeout(r, 1500))]);
  window.location.reload();
}

interface State {
  failed: boolean;
}

/**
 * Last line of defence: if a screen crashes while drawing, show a friendly page with a Reload button
 * instead of a blank white screen, and send a short report to the server log.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError('render', error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash crash" role="alert">
        <TriangleAlert size={40} aria-hidden="true" />
        <h1>{t('Something went wrong')}</h1>
        <p>{t('The app hit a problem and stopped. Your data is safe on the server. Reload to continue.')}</p>
        <button className="btn primary" onClick={() => void reloadFresh()}>
          <RotateCw size={18} aria-hidden="true" /> {t('Reload')}
        </button>
        <p className="mute small">
          {t(APP_NAME)} {t(VERSION_KEY, { mark: MARK, v: APP_VERSION })}
        </p>
      </div>
    );
  }
}
