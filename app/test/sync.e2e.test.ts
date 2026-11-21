// End-to-end: the app's store + sync code against the real apps-script/Code.gs running on the Sheet mocks.
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMeta, openDb, setMeta } from '../src/db';
import { putPhoto, S, save, load } from '../src/store';
import { setOnAuthLost, syncNow } from '../src/sync';

const require = createRequire(import.meta.url);
const { loadCode } = require('../../apps-script/test/gas-mocks.js');
const KEY = 'mango-playa-nube-47';
type Env = { ctx: { setup(): void }; ss: { getSheetByName(n: string): { _objects(): Record<string, unknown>[] } }; post(b: unknown): any; drive: unknown };
let env: Env;
const rows = (tab: string) => env.ss.getSheetByName(tab)._objects();

beforeAll(async () => {
  env = loadCode({ props: { SHEET_KEY: KEY } });
  env.ctx.setup();
  globalThis.fetch = (async (_url: string, init: RequestInit) =>
    new Response(JSON.stringify(env.post(init.body as string)), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  if (!('onLine' in navigator)) Object.defineProperty(navigator, 'onLine', { value: true });
  await openDb('e2e');
  await setMeta('apiUrl', 'https://script.google.com/macros/s/test/exec');
  await setMeta('key', KEY);
  await setMeta('userId', 'U-002');
  await load();
});

describe('sync against Code.gs', () => {
  it('pushes local records, stamped with who changed them, and logs Historial', async () => {
    await save('suplidores', { id: 'P-001', name: 'Compañía de Luz', desc: '', prio: 1 });
    const f = await save('facturas', { id: 'f-a', prov: 'P-001', num: 'F-001', entered: '2026-11-03', amount: 4850, prio: 1, photoId: '' });
    await save('pagos', { id: 'p-a', factura: f.id, date: '2026-11-10', amount: 1000 });
    await syncNow();
    const fr = rows('Facturas').find(r => r.id === 'f-a')!;
    expect(fr).toMatchObject({ num: 'F-001', amount: 4850, createdBy: 'U-002', updatedBy: 'U-002', entered: '2026-11-03' });
    expect(rows('Historial').filter(h => h.userId === 'U-002' && h.op === 'create')).toHaveLength(3);
    expect(await getMeta('lastSync')).toBeTruthy();
  });

  it('pulls what another person wrote, and renumbers an offline F-xxx collision', async () => {
    // Mamá (U-001) saved F-002 from her iPad first…
    const r = env.post({ action: 'push', key: KEY, userId: 'U-001', ops: [{ op: 'upsert', table: 'facturas',
      record: { id: 'f-mama', prov: 'P-001', num: 'F-002', entered: '2026-11-04', amount: 1260, prio: 1, photoId: '', updatedAt: new Date().toISOString(), deleted: false } }] });
    expect(r.ok).toBe(true);
    // …while this device, offline, also picked F-002.
    await save('facturas', { id: 'f-mine', prov: 'P-001', num: 'F-002', entered: '2026-11-05', amount: 999, prio: 2, photoId: '' });
    await syncNow();
    expect(S.facturas.find(f => f.id === 'f-mama')).toMatchObject({ num: 'F-002', createdBy: 'U-001' });
    expect(S.facturas.find(f => f.id === 'f-mine')!.num).toBe('F-003');
    expect(rows('Facturas').find(r => r.id === 'f-mine')!.num).toBe('F-003');
  });

  it('propagates deletes as soft deletes', async () => {
    const p = S.pagos.find(x => x.id === 'p-a')!;
    await save('pagos', { ...p, deleted: true });
    await syncNow();
    expect(rows('Pagos').find(r => r.id === 'p-a')!.deleted).toBe(true);
    expect(rows('Historial').some(h => h.recordId === 'p-a' && h.op === 'delete')).toBe(true);
  });

  it('uploads a pending photo and records its Drive id on the invoice', async () => {
    await putPhoto({ facturaId: 'f-a', blob: new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' }), pending: true });
    await syncNow();
    const photoId = rows('Facturas').find(r => r.id === 'f-a')!.photoId as string;
    expect(photoId).toBeTruthy();
    const back = env.post({ action: 'getPhoto', key: KEY, id: photoId });
    expect(back.base64).toBe(Buffer.from([255, 216, 255, 1, 2, 3]).toString('base64'));
  });

  it('keeps a newer local edit over an older server row (last write wins)', async () => {
    const f = S.facturas.find(x => x.id === 'f-a')!;
    env.post({ action: 'push', key: KEY, userId: 'U-001', ops: [{ op: 'upsert', table: 'facturas',
      record: { ...f, prio: 3, updatedAt: '2020-01-01T00:00:00.000Z' } }] }); // stale write: server ignores it
    await save('facturas', { ...f, prio: 2 });
    await syncNow();
    expect(S.facturas.find(x => x.id === 'f-a')!.prio).toBe(2);
    expect(rows('Facturas').find(r => r.id === 'f-a')!.prio).toBe(2);
  });

  it('reports a changed sheet password so the app can go back to onboarding', async () => {
    let lost = false;
    setOnAuthLost(() => { lost = true; });
    await setMeta('key', 'wrong');
    await save('caja', { id: 'm-1', type: 'in', cat: 'Venta del día', amount: 100, date: '2026-11-21', note: '' });
    await syncNow();
    expect(lost).toBe(true);
    expect(rows('Caja')).toHaveLength(0); // nothing written with a bad key; the op stays queued
  });
});
