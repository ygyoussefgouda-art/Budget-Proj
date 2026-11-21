/** Small dependency-free SVG charts. */
import type { ReactNode } from 'react';

export function Donut({ values, colors, size = 150, thickness = 22, children }: { values: number[]; colors: string[]; size?: number; thickness?: number; children?: ReactNode }) {
  const total = values.reduce((s, v) => s + v, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spending by category">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--card2)' }} strokeWidth={thickness} />
        {total > 0 &&
          values.map((v, i) => {
            const len = (v / total) * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  );
}

/** Pairs of bars per month (spent vs saved). */
export function PairBars({ a, b, labels, colorA, colorB, height = 180 }: { a: number[]; b: number[]; labels: string[]; colorA: string; colorB: string; height?: number }) {
  const max = Math.max(1, ...a, ...b);
  const n = labels.length;
  const w = 320;
  const slot = w / n;
  const bw = Math.min(8, slot / 3);
  const chartH = height - 18;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Monthly spending vs savings">
      {labels.map((l, i) => {
        const x = i * slot + slot / 2;
        const ha = (Math.max(0, a[i]) / max) * (chartH - 4);
        const hb = (Math.max(0, b[i]) / max) * (chartH - 4);
        return (
          <g key={i}>
            <rect x={x - bw - 1} y={chartH - ha} width={bw} height={ha} rx={bw / 2} style={{ fill: colorA }} />
            <rect x={x + 1} y={chartH - hb} width={bw} height={hb} rx={bw / 2} style={{ fill: colorB }} />
            <text x={x} y={height - 3} textAnchor="middle" fontSize="10" style={{ fill: 'var(--mute)' }}>
              {l}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Balance over time; the top of the chart is max(target, highest balance). */
export function LineArea({ points, max, color, height = 160 }: { points: number[]; max: number; color: string; height?: number }) {
  if (points.length < 2) return null;
  const w = 320;
  const pad = 6;
  const top = Math.max(1, max) * 1.05;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - pad * 2), height - pad - (Math.max(0, p) / top) * (height - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${height - pad} L${xy[0][0].toFixed(1)},${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Savings balance over time">
      <path d={area} style={{ fill: color }} fillOpacity={0.12} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth={2.5} strokeLinejoin="round" />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} style={{ fill: color }} />
      ))}
    </svg>
  );
}
