import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { t } from '../i18n';
import { makeLock, PIN_RE, pinMatches, readLock, removeLock, saveLock, type LockConfig } from '../pin';
import { useApp } from '../state';
import { Sheet, useOverlay } from './Overlays';
import { Card, Field, FormError, SaveButton, SectionTitle } from './ui';

const MINUTES = [0, 1, 5, 15];
const minutesLabel = (m: number) => (m === 0 ? t('Right away') : m === 1 ? t('After 1 minute') : t('After {n} minutes', { n: m }));

/** Settings → App lock: a PIN for this phone only. */
export default function AppLockSettings() {
  const { user } = useApp();
  const { toast } = useOverlay();
  const [cfg, setCfg] = useState<LockConfig | null>(() => readLock(user.id));
  const [sheet, setSheet] = useState<'set' | 'change' | 'off' | null>(null);

  const setMinutes = (minutes: number) => {
    if (!cfg) return;
    const next = { ...cfg, minutes };
    saveLock(user.id, next);
    setCfg(next);
  };

  return (
    <Card>
      <SectionTitle trailing={<Lock size={18} className="mute" />}>{t('App lock')}</SectionTitle>
      <p className="small mute">
        {t('Ask for a PIN when the app is opened again. The PIN stays on this phone and is separate from your password.')}
      </p>
      {cfg ? (
        <div className="stack" style={{ marginTop: 10 }}>
          <Field label={t('Lock the app')}>
            <select className="input" value={cfg.minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn tonal block" onClick={() => setSheet('change')}>
            {t('Change PIN')}
          </button>
          <button className="btn outline block" onClick={() => setSheet('off')}>
            {t('Turn off app lock')}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 10 }}>
          <button className="btn tonal block" onClick={() => setSheet('set')}>
            <Lock size={18} /> {t('Set a PIN')}
          </button>
        </div>
      )}

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'off' ? t('Turn off app lock') : sheet === 'change' ? t('Change PIN') : t('Set a PIN')}>
        {sheet && (
          <PinForm
            mode={sheet}
            current={cfg}
            onDone={(next, message) => {
              setCfg(next);
              setSheet(null);
              toast(message);
            }}
          />
        )}
      </Sheet>
    </Card>
  );
}

function PinForm({ mode, current, onDone }: { mode: 'set' | 'change' | 'off'; current: LockConfig | null; onDone: (cfg: LockConfig | null, message: string) => void }) {
  const { user } = useApp();
  const [old, setOld] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [minutes, setMinutes] = useState(current?.minutes ?? 5);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode !== 'set') {
      if (!current || !(await pinMatches(old, current))) return setErr(t('That PIN is not right.'));
      if (mode === 'off') {
        removeLock(user.id);
        return onDone(null, t('App lock is off.'));
      }
    }
    if (!PIN_RE.test(pin)) return setErr(t('Use 4 to 6 digits.'));
    if (pin !== again) return setErr(t('The two PINs do not match.'));
    setBusy(true);
    const cfg = await makeLock(pin, mode === 'change' ? (current?.minutes ?? minutes) : minutes);
    saveLock(user.id, cfg);
    onDone(cfg, mode === 'change' ? t('PIN changed.') : t('App lock is on.'));
  };

  const pinInput = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <Field label={label}>
      <input
        className="input pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        dir="ltr"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="form">
      {mode !== 'set' && pinInput(t('Current PIN'), old, setOld, true)}
      {mode !== 'off' && (
        <>
          {pinInput(t('New PIN (4–6 digits)'), pin, setPin, mode === 'set')}
          {pinInput(t('Repeat the PIN'), again, setAgain)}
        </>
      )}
      {mode === 'set' && (
        <Field label={t('Lock the app')}>
          <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {mode !== 'off' && <p className="tiny mute">{t('Forgot it later? Sign out and back in with your password; the lock is removed.')}</p>}
      <FormError text={err} />
      <SaveButton label={mode === 'off' ? t('Turn off') : mode === 'change' ? t('Change PIN') : t('Turn on app lock')} busy={busy} />
    </form>
  );
}
