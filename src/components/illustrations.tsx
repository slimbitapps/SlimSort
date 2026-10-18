/** Kleine Illustrationen für Einführung und leere Zustände (reines SVG). */

const photo = (x: number, y: number, w: number, h: number, c1: string, c2: string, r = 5, rot = 0, key?: string) => (
  <g key={key} transform={rot ? `rotate(${rot} ${x + w / 2} ${y + h / 2})` : undefined}>
    <rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" stroke="rgba(0,0,0,.08)" />
    <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx={r - 2} fill={c1} />
    <path d={`M${x + 3} ${y + h - 3} l${w * 0.3} ${-h * 0.35} l${w * 0.2} ${h * 0.18} l${w * 0.18} ${-h * 0.12} l${w * 0.32 - 6} ${h * 0.29} z`} fill={c2} />
    <circle cx={x + w * 0.72} cy={y + h * 0.3} r={Math.min(w, h) * 0.09} fill="#fff" opacity=".85" />
  </g>
);

export function IllPickFolder() {
  return (
    <svg width="180" height="110" viewBox="0 0 180 110">
      <path d="M40 30a6 6 0 0 1 6-6h26l8 8h54a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z" fill="#7f9bff" />
      {photo(58, 14, 40, 32, '#ffd27a', '#f39b4a', 5, -12)}
      {photo(86, 10, 42, 34, '#9be3c3', '#3fae7c', 5, 8)}
      <path d="M40 46a6 6 0 0 1 6-6h94a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z" fill="#5b7cfa" />
      <circle cx="148" cy="88" r="15" fill="#fff" stroke="rgba(0,0,0,.08)" />
      <path d="M142 88h12M148 82v12" stroke="#5b7cfa" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const folderChip = (x: number, y: number, color: string, key: string, label: string) => (
  <g key={key}>
    <rect x={x} y={y} width="50" height="58" rx="10" fill="#fff" stroke="rgba(0,0,0,.08)" />
    <path d={`M${x + 10} ${y + 14}a3 3 0 0 1 3-3h9l3 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H${x + 13}a3 3 0 0 1-3-3z`} fill={color} />
    <rect x={x + 15} y={y + 38} width="20" height="14" rx="4" fill="#f3f4f7" stroke="#d6d8de" />
    <text x={x + 25} y={y + 49} textAnchor="middle" fontSize="10" fontWeight="700" fill="#33363d" fontFamily="ui-monospace,monospace">
      {label}
    </text>
  </g>
);

export function IllTargets() {
  return (
    <svg width="180" height="110" viewBox="0 0 180 110">
      {folderChip(8, 26, '#5b7cfa', 'a', '1')}
      {folderChip(65, 26, '#33c37a', 'b', '2')}
      {folderChip(122, 26, '#f6a23c', 'c', '3')}
    </svg>
  );
}

export function IllPressKey() {
  return (
    <svg width="180" height="110" viewBox="0 0 180 110">
      {photo(16, 22, 62, 48, '#ffc2d6', '#e8628f', 6)}
      <path d="M84 46c14-14 28-14 42 0" fill="none" stroke="#5b7cfa" strokeWidth="3" strokeDasharray="5 5" strokeLinecap="round" />
      <path d="M122 40l6 7-9 2z" fill="#5b7cfa" />
      <path d="M118 52a5 5 0 0 1 5-5h14l5 5h17a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5h-36a5 5 0 0 1-5-5z" fill="#5b7cfa" />
      <rect x="36" y="78" width="28" height="24" rx="6" fill="#fff" stroke="#d6d8de" />
      <rect x="36" y="78" width="28" height="21" rx="6" fill="#fff" />
      <text x="50" y="94" textAnchor="middle" fontSize="13" fontWeight="800" fill="#33363d" fontFamily="ui-monospace,monospace">
        1
      </text>
    </svg>
  );
}

export function IllSingle() {
  return (
    <svg width="120" height="70" viewBox="0 0 120 70">
      {photo(26, 6, 68, 50, '#a9c1ff', '#5b7cfa', 6)}
      <rect x="40" y="61" width="8" height="5" rx="1.5" fill="currentColor" opacity=".25" />
      <rect x="52" y="60" width="16" height="7" rx="2" fill="currentColor" opacity=".55" />
      <rect x="72" y="61" width="8" height="5" rx="1.5" fill="currentColor" opacity=".25" />
    </svg>
  );
}

export function IllGrid() {
  const cells = [];
  const colors = [
    ['#ffd27a', '#f39b4a'],
    ['#9be3c3', '#3fae7c'],
    ['#a9c1ff', '#5b7cfa'],
    ['#ffc2d6', '#e8628f'],
    ['#d7c4ff', '#8b5cf6'],
    ['#b8ecf2', '#22a6b8'],
  ];
  for (let i = 0; i < 6; i++) {
    const x = 18 + (i % 3) * 29;
    const y = 8 + Math.floor(i / 3) * 29;
    cells.push(photo(x, y, 26, 26, colors[i][0], colors[i][1], 4, 0, String(i)));
  }
  return (
    <svg width="120" height="70" viewBox="0 0 120 70">
      {cells}
    </svg>
  );
}

export function IllEmptyTargets() {
  return (
    <svg width="120" height="80" viewBox="0 0 120 80">
      <path d="M22 22a6 6 0 0 1 6-6h20l7 7h37a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6z" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeDasharray="5 5" />
      <circle cx="60" cy="46" r="11" fill="currentColor" opacity=".12" />
      <path d="M55 46h10M60 41v10" stroke="currentColor" strokeOpacity=".6" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IllDone() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="40" fill="#33c37a" opacity=".14" />
      <circle cx="48" cy="48" r="28" fill="#33c37a" />
      <path d="M36 48l8 8 16-17" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
