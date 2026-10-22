export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-slate-400">–</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Last ${values.length} weeks, from ${values[0]} to ${values.at(-1)} units`}>
      <polyline points={pts} fill="none" stroke="#475569" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
