// Money, dates and small helpers. Pure functions (tested).

export const r2 = (n: number): number => Math.round(n * 100) / 100;

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number): string => 'RD$ ' + moneyFmt.format(+n || 0);
/** Signed money: "− RD$ 6,250.00" for negatives (uses U+2212 like the designs). */
export const moneySigned = (n: number): string => (n < 0 ? '− ' : '') + money(Math.abs(n));

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): string => ymd(new Date());
export const ym = (date: string): string => date.slice(0, 7);
const atNoon = (s: string) => new Date(s + 'T12:00');

/** "3 nov 2026". Built by hand: browsers disagree on es-DO ("3 nov 2026" vs "3 nov de 2026"). */
export const fmtDate = (s?: string | null): string => {
  if (!s) return '—';
  const d = atNoon(s);
  return `${d.getDate()} ${d.toLocaleDateString('es-DO', { month: 'short' }).replace(/\./g, '')} ${d.getFullYear()}`;
};
/** "noviembre de 2026" */
export const monthName = (m: string): string =>
  atNoon(m + '-15').toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
/** "noviembre" */
export const monthOnly = (m: string): string => atNoon(m + '-15').toLocaleDateString('es-DO', { month: 'long' });
/** "miércoles, 18 nov" */
export const dayLabel = (s: string): string =>
  atNoon(s).toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/\./g, '');
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const addMonths = (m: string, delta: number): string => {
  const [y, mo] = m.split('-').map(Number);
  return ymd(new Date(y, mo - 1 + delta, 1)).slice(0, 7);
};

/** Next "P-007" / "F-010" style id: max numeric suffix + 1, zero-padded to 3. */
export const nextCode = (prefix: string, existing: string[]): string => {
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  const max = existing.reduce((m, c) => { const x = re.exec(c); return x ? Math.max(m, +x[1]) : m; }, 0);
  return prefix + '-' + pad(max + 1, 3);
};

export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
