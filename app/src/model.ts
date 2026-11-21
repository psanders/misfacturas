// Derived values, never stored (BRIEF.md §4.3). Pure functions over plain arrays (tested).
import { r2, ym } from './format';
import type { Factura, Movimiento, Pago } from './types';

export const live = <T extends { deleted: boolean }>(xs: T[]): T[] => xs.filter(x => !x.deleted);

export const paymentsOf = (f: Factura, pagos: Pago[]): Pago[] =>
  pagos.filter(p => p.factura === f.id && !p.deleted).sort((a, b) => a.date.localeCompare(b.date));
export const paidOf = (f: Factura, pagos: Pago[]): number =>
  r2(paymentsOf(f, pagos).reduce((a, p) => a + (+p.amount || 0), 0));
export const balanceOf = (f: Factura, pagos: Pago[]): number => r2(f.amount - paidOf(f, pagos));
export const isPaid = (f: Factura, pagos: Pago[]): boolean => balanceOf(f, pagos) <= 0;
/** Date of the last payment once fully paid, else null. */
export const paidDate = (f: Factura, pagos: Pago[]): string | null => {
  if (!isPaid(f, pagos)) return null;
  const ps = paymentsOf(f, pagos);
  return ps.length ? ps[ps.length - 1].date : null;
};
export type Status = 'pendiente' | 'abonada' | 'pagada';
export const statusOf = (f: Factura, pagos: Pago[]): Status => {
  const paid = paidOf(f, pagos);
  return paid <= 0 ? 'pendiente' : balanceOf(f, pagos) <= 0 ? 'pagada' : 'abonada';
};

/** month: 'YYYY-MM' or 'all' */
export const inMonth = (date: string | null | undefined, month: string): boolean =>
  month === 'all' || (!!date && ym(date) === month);

/** Unpaid invoices entered in `month`, in payment order: priority, then entered date. */
export const toPay = (facturas: Factura[], pagos: Pago[], month: string): Factura[] =>
  live(facturas)
    .filter(f => !isPaid(f, pagos) && inMonth(f.entered, month))
    .sort((a, b) => a.prio - b.prio || a.entered.localeCompare(b.entered) || a.num.localeCompare(b.num));

/** Unpaid invoices from months before `month` (for the "Hay N facturas…" notice). */
export const olderUnpaid = (facturas: Factura[], pagos: Pago[], month: string): number =>
  month === 'all' ? 0 : live(facturas).filter(f => !isPaid(f, pagos) && ym(f.entered) < month).length;

/** Paid invoices whose paid-on date is in `month`, newest first. */
export const paidIn = (facturas: Factura[], pagos: Pago[], month: string): Factura[] =>
  live(facturas)
    .filter(f => inMonth(paidDate(f, pagos), month))
    .sort((a, b) => paidDate(b, pagos)!.localeCompare(paidDate(a, pagos)!));

export interface InvoiceSummary { owed: number; urgent: number; paidInMonth: number }
export const invoiceSummary = (facturas: Factura[], pagos: Pago[], month: string): InvoiceSummary => {
  const open = toPay(facturas, pagos, month);
  const liveIds = new Set(live(facturas).map(f => f.id));
  return {
    owed: r2(open.reduce((a, f) => a + balanceOf(f, pagos), 0)),
    urgent: open.filter(f => f.prio === 1).length,
    paidInMonth: r2(live(pagos).filter(p => liveIds.has(p.factura) && inMonth(p.date, month)).reduce((a, p) => a + p.amount, 0)),
  };
};

export interface CajaSummary { inTotal: number; outTotal: number; balance: number }
export const movesIn = (caja: Movimiento[], month: string): Movimiento[] =>
  live(caja)
    .filter(m => inMonth(m.date, month))
    .sort((a, b) => b.date.localeCompare(a.date) || (a.type === b.type ? b.updatedAt.localeCompare(a.updatedAt) : a.type === 'in' ? -1 : 1));
export const cajaSummary = (moves: Movimiento[]): CajaSummary => {
  const inTotal = r2(moves.filter(m => m.type === 'in').reduce((a, m) => a + m.amount, 0));
  const outTotal = r2(moves.filter(m => m.type === 'out').reduce((a, m) => a + m.amount, 0));
  return { inTotal, outTotal, balance: r2(inTotal - outTotal) };
};
export const dayNet = (moves: Movimiento[]): number =>
  r2(moves.reduce((a, m) => a + (m.type === 'in' ? m.amount : -m.amount), 0));
