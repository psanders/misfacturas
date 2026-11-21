import { describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import {
  balanceOf, cajaSummary, invoiceSummary, movesIn, olderUnpaid, paidDate, paidIn, statusOf, toPay,
} from '../src/model';
import type { Factura, Pago } from '../src/types';

// Same "today" as the designs: 21 nov 2026.
const s = seed(new Date(2026, 10, 21));
const byNum = (n: string) => s.facturas.find(f => f.num === n)!;

describe('derived invoice values', () => {
  it('matches the numbers in the designs for November', () => {
    const sum = invoiceSummary(s.facturas, s.pagos, '2026-11');
    expect(sum.owed).toBe(18405.5);
    expect(sum.urgent).toBe(3);
    expect(sum.paidInMonth).toBe(6500);
  });
  it('orders Por pagar by priority, then entry date', () => {
    const order = toPay(s.facturas, s.pagos, '2026-11').map(f => f.num);
    expect(order).toEqual(['F-006', 'F-007', 'F-008', 'F-005', 'F-009', 'F-004']);
  });
  it('computes status, balance and paid-on date', () => {
    expect(statusOf(byNum('F-006'), s.pagos)).toBe('pendiente');
    expect(statusOf(byNum('F-008'), s.pagos)).toBe('abonada');
    expect(balanceOf(byNum('F-008'), s.pagos)).toBe(4320.5);
    expect(statusOf(byNum('F-003'), s.pagos)).toBe('pagada');
    expect(paidDate(byNum('F-003'), s.pagos)).toBe('2026-10-26');
    expect(paidDate(byNum('F-008'), s.pagos)).toBeNull();
  });
  it('lists October paid invoices newest first and counts older unpaid', () => {
    expect(paidIn(s.facturas, s.pagos, '2026-10').map(f => f.num)).toEqual(['F-003', 'F-001', 'F-002']);
    expect(olderUnpaid(s.facturas, s.pagos, '2026-11')).toBe(0);
    expect(olderUnpaid(s.facturas, s.pagos, '2026-12')).toBe(6);
  });
  it('ignores deleted payments and invoices', () => {
    const f: Factura = { ...byNum('F-006') };
    const pagos: Pago[] = [{ id: 'x', factura: f.id, date: '2026-11-21', amount: 4850, updatedAt: '', deleted: true }];
    expect(statusOf(f, pagos)).toBe('pendiente');
    const facturas = s.facturas.map(x => (x.id === f.id ? { ...x, deleted: true } : x));
    expect(invoiceSummary(facturas, s.pagos, '2026-11').owed).toBe(18405.5 - 4850);
  });
});

describe('caja', () => {
  it('matches the November balance in the designs', () => {
    const sum = cajaSummary(movesIn(s.caja, '2026-11'));
    expect(sum).toEqual({ inTotal: 223514, outTotal: 65550, balance: 157964 });
  });
  it('sorts newest day first, entries before exits', () => {
    const xs = movesIn(s.caja, '2026-11');
    expect(xs[0].date).toBe('2026-11-21');
    const d20 = xs.filter(m => m.date === '2026-11-20').map(m => m.type);
    expect(d20).toEqual(['in', 'out']);
  });
});
