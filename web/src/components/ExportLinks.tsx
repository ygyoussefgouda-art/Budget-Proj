import { FileSpreadsheet, FileText } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { periodRange } from '../domain/calc';
import { t, useI18n } from '../i18n';
import { isNative, saveFile } from '../native';
import { thisMonth, useApp } from '../state';
import { useOverlay } from './Overlays';
import { Field, Segmented } from './ui';

type Kind = 'expenses' | 'loans' | 'savings';

/** In the Android app a link can't download a file: fetch it and hand it to the share sheet instead. */
async function nativeSave(e: MouseEvent<HTMLAnchorElement>, href: string, toast: (m: string) => void) {
  if (!isNative()) return; // browsers download the link themselves
  e.preventDefault();
  try {
    const res = await fetch(href, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const name = /filename="?([^";]+)/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'budget-me-export';
    await saveFile(await res.blob(), name);
  } catch {
    toast(t('Export failed. Check your connection and try again.'));
  }
}

/**
 * Download buttons (CSV and Excel) for an export. Plain links: the browser downloads the file
 * with the sign-in cookie, nothing is built in the page. Headers follow the app language.
 */
export function ExportLinks({ kind, filters }: { kind: Kind; filters: Record<string, string | undefined> }) {
  const { lang } = useI18n();
  const { toast } = useOverlay();
  const url = (format: 'csv' | 'xlsx') => {
    const p = new URLSearchParams({ kind, format, lang });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return `/api/export?${p}`;
  };
  return (
    <div className="stack">
      <a className="btn tonal block" href={url('csv')} download onClick={(e) => nativeSave(e, url('csv'), toast)}>
        <FileText size={18} /> {t('Download CSV')}
      </a>
      <a className="btn tonal block" href={url('xlsx')} download onClick={(e) => nativeSave(e, url('xlsx'), toast)}>
        <FileSpreadsheet size={18} /> {t('Download Excel (.xlsx)')}
      </a>
      <p className="tiny mute">{t('CSV opens in Excel, Google Sheets or Numbers; Arabic text shows correctly.')}</p>
    </div>
  );
}

/** Settings → Export: pick what and which dates (empty = everything). */
export function ExportCardBody() {
  const { startDay } = useApp();
  const r = periodRange(thisMonth(startDay), startDay);
  const [kind, setKind] = useState<Kind>('expenses');
  const [from, setFrom] = useState(r.from);
  const [to, setTo] = useState(r.last);
  return (
    <>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expenses', label: t('Expenses') },
          { value: 'loans', label: t('Loans') },
          { value: 'savings', label: t('Savings') },
        ]}
      />
      <div className="grid2" style={{ marginTop: 10 }}>
        <Field label={t('From')}>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('To')}>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <p className="tiny mute" style={{ margin: '0 0 10px' }}>
        {t('Clear both dates to export everything.')}
      </p>
      <ExportLinks kind={kind} filters={{ from, to }} />
    </>
  );
}
