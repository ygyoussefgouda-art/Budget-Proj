/**
 * 2.0.0: small line illustrations (Coinpay-style, drawn as inline SVG: no image files, no glow).
 * Strokes use the text colour, accents the brand colour, so they follow light/dark mode. Decorative only.
 */
type Scene = 'wallet' | 'receipt' | 'goal';

export default function Illustration({ name, size = 132 }: { name: Scene; size?: number }) {
  return (
    <svg className="illustration" width={size} height={size * 0.75} viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--mute)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {name === 'wallet' && (
          <>
            <path d="M30 42h86a8 8 0 0 1 8 8v46a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8V42z" />
            <path d="M30 42l58-22a6 6 0 0 1 8 4l6 18" />
            <path d="M124 62h-22a8 8 0 0 0 0 16h22" />
            <path d="M12 104h136" />
          </>
        )}
        {name === 'receipt' && (
          <>
            <path d="M50 14h60v88l-10-7-10 7-10-7-10 7-10-7-10 7z" />
            <path d="M62 34h36M62 48h36M62 62h22" />
            <path d="M14 104h132" />
          </>
        )}
        {name === 'goal' && (
          <>
            <circle cx="80" cy="58" r="38" />
            <circle cx="80" cy="58" r="24" />
            <path d="M80 58l34-34M106 24h8v8" />
            <path d="M14 108h132" />
          </>
        )}
      </g>
      {/* brand-colour accents: coins */}
      <g fill="var(--accent-text)">
        {name === 'wallet' && (
          <>
            <circle cx="108" cy="70" r="5" />
            <circle cx="132" cy="26" r="9" />
            <circle cx="146" cy="44" r="5" />
          </>
        )}
        {name === 'receipt' && (
          <>
            <circle cx="122" cy="84" r="10" />
            <circle cx="34" cy="70" r="6" />
          </>
        )}
        {name === 'goal' && <circle cx="80" cy="58" r="9" />}
      </g>
    </svg>
  );
}
