// Demo data (BRIEF.md §10), only for ?demo. Dates relative to the current month.
import { ymd } from './format';
import type { Factura, Movimiento, Pago, Prio, Suplidor } from './types';

const T0 = '2000-01-01T00:00:00.000Z';
const base = { updatedAt: T0, deleted: false };

export function fakePhoto(prov: string, num: string, amt: number, date: string): Blob {
  const e = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const rows = [0, 1, 2, 3, 4].map(i => `<rect x="60" y="${290 + i * 60}" width="${300 - i * 30}" height="16" fill="#ddd"/><rect x="440" y="${290 + i * 60}" width="100" height="16" fill="#ddd"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#fbfaf6"/><rect x="40" y="40" width="520" height="90" fill="#e9e6dd"/><text x="60" y="98" font-family="Arial" font-size="34" font-weight="bold" fill="#333">${e(prov)}</text><text x="60" y="190" font-family="Arial" font-size="24" fill="#555">FACTURA ${e(num)}</text><text x="60" y="226" font-family="Arial" font-size="22" fill="#777">Fecha: ${e(date)}</text>${rows}<line x1="60" y1="620" x2="540" y2="620" stroke="#999" stroke-width="2"/><text x="60" y="680" font-family="Arial" font-size="30" font-weight="bold" fill="#222">TOTAL</text><text x="540" y="680" text-anchor="end" font-family="Arial" font-size="30" font-weight="bold" fill="#222">RD$ ${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export interface Seed { suplidores: Suplidor[]; facturas: Factura[]; pagos: Pago[]; caja: Movimiento[]; photos: { facturaId: string; blob: Blob }[] }

export function seed(now = new Date()): Seed {
  const d = (day: number, mo = 0) => ymd(new Date(now.getFullYear(), now.getMonth() + mo, Math.min(day, 28)));
  const suplidores: Suplidor[] = ([
    ['P-001', 'Compañía de Luz', 'La luz de la casa · contrato 44-7182', 1],
    ['P-002', 'Acueducto', 'Servicio de agua', 1],
    ['P-003', 'Teléfono e Internet', 'Internet y teléfono fijo de la casa', 2],
    ['P-004', 'Farmacia Central', 'Medicinas del mes, a crédito', 1],
    ['P-005', 'Colmado Don Pepe', 'Lo fiao del mes', 2],
    ['P-006', 'Don José (jardinero)', 'Jardín, dos veces al mes', 3],
  ] as [string, string, string, Prio][]).map(([id, name, desc, prio]) => ({ ...base, id, name, desc, prio }));

  // [supplier, printed number (on the photo), day, month offset, amount, payments [day, monthOffset, amount]]
  const raw: [string, string, number, number, number, [number, number, number][]][] = [
    ['P-001', 'E-0091204', 3, -1, 4620, [[9, -1, 4620]]],
    ['P-002', 'W-54410', 4, -1, 1260, [[9, -1, 1260]]],
    ['P-004', 'FC-2140', 5, -1, 6900, [[12, -1, 4000], [26, -1, 2900]]],
    ['P-006', 'JOSE-11', 1, 0, 3000, [[8, 0, 1500]]],
    ['P-003', 'PI-118842', 2, 0, 2995, []],
    ['P-001', 'E-0093381', 3, 0, 4850, []],
    ['P-002', 'W-55120', 4, 0, 1260, []],
    ['P-004', 'FC-2211', 5, 0, 7320.5, [[10, 0, 3000]]],
    ['P-005', 'CDP-0412', 6, 0, 5480, [[10, 0, 2000]]],
  ];
  const facturas: Factura[] = [], pagos: Pago[] = [], photos: Seed['photos'] = [];
  raw.forEach(([prov, printed, day, mo, amount, pays], i) => {
    const p = suplidores.find(s => s.id === prov)!;
    const id = 'demo-f' + (i + 1);
    facturas.push({ ...base, id, prov, num: 'F-' + String(i + 1).padStart(3, '0'), entered: d(day, mo), amount, prio: p.prio, photoId: '' });
    photos.push({ facturaId: id, blob: fakePhoto(p.name, printed, amount, d(day, mo)) });
    pays.forEach(([pd, pm, a], k) => pagos.push({ ...base, id: `${id}-p${k}`, factura: id, date: d(pd, pm), amount: a }));
  });

  const caja: Movimiento[] = [];
  let x = 11;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  let n = 0;
  const mv = (type: 'in' | 'out', cat: string, amount: number, date: string, note = '') =>
    caja.push({ ...base, id: 'demo-m' + ++n, type, cat, amount, date, note });
  for (const mo of [-1, 0]) {
    const last = mo < 0 ? new Date(now.getFullYear(), now.getMonth(), 0).getDate() : now.getDate();
    const D = (day: number) => ymd(new Date(now.getFullYear(), now.getMonth() + mo, day));
    for (let day = 1; day <= last; day++) {
      if (new Date(now.getFullYear(), now.getMonth() + mo, day).getDay() === 0) continue;
      mv('in', 'Venta del día', Math.round(7500 + rnd() * 9000), D(day));
    }
    ([[1, 'out', 'Alquiler', 15000, 'Local'], [8, 'out', 'Luz', 3900, ''], [12, 'out', 'Mercancía', 22400, 'Pedido al distribuidor'],
      [15, 'out', 'Salarios', 18000, 'Quincena'], [20, 'out', 'Impuestos', 6250, 'ITBIS'], [24, 'in', 'Otro ingreso', 2500, 'Encargo especial'],
      [30, 'out', 'Salarios', 18000, 'Quincena']] as [number, 'in' | 'out', string, number, string][])
      .forEach(([day, t, c, a, note]) => { if (day <= last) mv(t, c, a, D(day), note); });
  }
  return { suplidores, facturas, pagos, caja, photos };
}
