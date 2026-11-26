import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n';
import { applyUpdate, useUpdateReady } from '../swUpdate';

/** "New version ready, Reload": shown when a newer app version has downloaded in the background. */
export function UpdateBar() {
  const ready = useUpdateReady();
  const [hidden, setHidden] = useState(false);
  if (!ready || hidden) return null;
  return (
    <div className="update-bar" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <span className="grow">{t('A new version is ready.')}</span>
      <button className="btn ghost small" onClick={() => setHidden(true)}>
        {t('Later')}
      </button>
      <button className="btn primary small" onClick={applyUpdate}>
        {t('Reload')}
      </button>
    </div>
  );
}
