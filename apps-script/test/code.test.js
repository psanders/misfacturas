// Run: node --test apps-script/test/code.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCode } = require('./gas-mocks');

const KEY = 'mango-playa-nube-47';

// A fresh backend with setup() already run and a known key.
function fresh() {
  const env = loadCode({ props: { SHEET_KEY: KEY } });
  env.ctx.setup();
  env.setNow('2026-11-21T12:00:00.000Z');
  return env;
}

function factura(over = {}) {
  return { id: 'fa-1', prov: 'P-001', num: 'F-001', entered: '2026-11-05', amount: 1500.5, prio: 2, photoId: '',
    updatedAt: '2026-11-21T10:00:00.000Z', deleted: false, ...over };
}
const upsert = (table, record) => ({ op: 'upsert', table, record });
const push = (env, ops, ...user) => env.post({ action: 'push', key: KEY, userId: user.length ? user[0] : 'U-001', ops });
const pull = (env, since = null) => env.post({ action: 'pull', key: KEY, since });
const tab = (env, name) => env.ss.getSheetByName(name);
const history = (env) => tab(env, 'Historial')._objects();

// ---------- transport / auth ----------

test('doGet and malformed bodies answer bad_request', () => {
  const env = fresh();
  assert.deepEqual(JSON.parse(env.ctx.doGet({}).getContent()), { ok: false, error: 'bad_request', message: 'Use POST' });
  assert.equal(env.post('not json').error, 'bad_request');
  assert.equal(env.post('[1,2]').error, 'bad_request');
  assert.equal(env.ctx.doPost({}).getContent().includes('bad_request'), true);
  assert.equal(env.post({ action: 'nope', key: KEY }).error, 'bad_request');
  assert.equal(env.post({ action: 'toString', key: KEY }).error, 'bad_request');
});

test('bad key on every action', () => {
  const env = fresh();
  const bodies = [
    { action: 'verify' },
    { action: 'pull', since: null },
    { action: 'push', userId: 'U-001', ops: [upsert('facturas', factura())] },
    { action: 'photo', userId: 'U-001', facturaId: 'fa-1', name: 'a.jpg', mime: 'image/jpeg', base64: 'AAEC' },
    { action: 'getPhoto', id: 'x' },
    { action: 'unknown' }
  ];
  for (const b of bodies) {
    for (const key of [undefined, '', 'wrong', KEY + ' ', KEY.toUpperCase(), 123]) {
      const res = env.post({ ...b, key });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'bad_key', `${b.action} with key ${key}`);
    }
  }
  assert.equal(tab(env, 'Facturas').getLastRow(), 1, 'nothing written');
  assert.equal(history(env).length, 0);
  assert.equal(env.drive.files.size, 0);
});

test('every call is bad_key while SHEET_KEY is not set', () => {
  const env = loadCode();
  assert.equal(env.post({ action: 'verify', key: '' }).error, 'bad_key');
  assert.equal(env.post({ action: 'verify', key: 'anything' }).error, 'bad_key');
});

test('verify returns only active users, in Sheet order', () => {
  const env = fresh();
  const users = tab(env, 'Usuarios');
  users.getRange(3, 3).setValues([['FALSE']]);            // Admin inactive (string → boolean false)
  users.appendRow(['U-004', 'Tía', 'TRUE']);
  users.appendRow(['U-005', 'Nadie', '']);                  // empty active = not active
  const res = env.post({ action: 'verify', key: KEY });
  assert.deepEqual(res, { ok: true, users: [{ id: 'U-001', name: 'Mamá' }, { id: 'U-003', name: 'Primo' }, { id: 'U-004', name: 'Tía' }] });
});

test('bad, unknown or inactive userId on push and photo', () => {
  const env = fresh();
  tab(env, 'Usuarios').getRange(4, 3).setValues([[false]]); // U-003 inactive
  for (const userId of [undefined, '', 'U-999', 'U-003', 42]) {
    assert.equal(push(env, [upsert('facturas', factura())], userId).error, 'bad_user', `push ${userId}`);
    const p = env.post({ action: 'photo', key: KEY, userId, facturaId: 'fa-1', name: 'a.jpg', mime: 'image/jpeg', base64: 'AAEC' });
    assert.equal(p.error, 'bad_user', `photo ${userId}`);
  }
  assert.equal(tab(env, 'Facturas').getLastRow(), 1);
  assert.equal(history(env).length, 0);
  assert.equal(env.drive.files.size, 0);
});

// ---------- push ----------

test('push insert stamps createdBy/updatedBy/syncedAt and ignores client values', () => {
  const env = fresh();
  const rec = factura({ createdBy: 'U-666', updatedBy: 'U-666', syncedAt: '1999-01-01T00:00:00.000Z', extra: 'nope' });
  const res = push(env, [upsert('facturas', rec)]);
  assert.deepEqual(res, { ok: true, now: '2026-11-21T12:00:00.000Z', applied: ['fa-1'], renumbered: [] });
  const [row] = tab(env, 'Facturas')._objects();
  assert.equal(row.createdBy, 'U-001');
  assert.equal(row.updatedBy, 'U-001');
  assert.equal(row.syncedAt, '2026-11-21T12:00:00.000Z');
  assert.equal(row.entered, '2026-11-05', 'text column keeps the date as a string');
  assert.equal(row.amount, 1500.5);
  assert.equal(row.deleted, false);
  assert.equal(row.photoId, '');
  assert.ok(!('extra' in row));

  // Update by another user keeps createdBy.
  env.setNow('2026-11-21T13:00:00.000Z');
  const r2 = push(env, [upsert('facturas', factura({ amount: 2000, updatedAt: '2026-11-21T12:30:00.000Z', createdBy: 'U-003' }))], 'U-002');
  assert.deepEqual(r2.applied, ['fa-1']);
  const [row2] = tab(env, 'Facturas')._objects();
  assert.equal(row2.createdBy, 'U-001');
  assert.equal(row2.updatedBy, 'U-002');
  assert.equal(row2.syncedAt, '2026-11-21T13:00:00.000Z');
  assert.equal(row2.amount, 2000);
  assert.equal(tab(env, 'Facturas').getLastRow(), 2, 'updated in place, not appended');
});

test('last-write-wins: older or equal updatedAt is skipped, not applied, not logged', () => {
  const env = fresh();
  push(env, [upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-11-10', amount: 100, updatedAt: '2026-11-21T10:00:00.000Z', deleted: false })]);
  env.setNow('2026-11-21T14:00:00.000Z');
  const res = push(env, [
    upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-11-10', amount: 999, updatedAt: '2026-11-21T09:59:59.999Z', deleted: false }),
    upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-11-10', amount: 888, updatedAt: '2026-11-21T10:00:00.000Z', deleted: false })
  ], 'U-002');
  assert.deepEqual(res.applied, []);
  const [row] = tab(env, 'Pagos')._objects();
  assert.equal(row.amount, 100);
  assert.equal(row.updatedBy, 'U-001');
  assert.equal(row.syncedAt, '2026-11-21T12:00:00.000Z');
  assert.equal(history(env).length, 1);

  const newer = push(env, [upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-11-10', amount: 120, updatedAt: '2026-11-21T10:00:00.001Z', deleted: false })]);
  assert.deepEqual(newer.applied, ['pa-1']);
  assert.equal(tab(env, 'Pagos')._objects()[0].amount, 120);
});

test('Historial: create, update, delete transition, undelete', () => {
  const env = fresh();
  const s = (over) => ({ id: 'P-001', name: 'Edenorte', desc: 'La luz', prio: 1, deleted: false, ...over });
  push(env, [upsert('suplidores', s({ updatedAt: '2026-11-21T10:00:00Z' }))]);
  env.setNow('2026-11-21T12:01:00.000Z');
  push(env, [upsert('suplidores', s({ name: 'Edenorte SA', updatedAt: '2026-11-21T10:01:00Z' }))], 'U-002');
  env.setNow('2026-11-21T12:02:00.000Z');
  push(env, [upsert('suplidores', s({ deleted: true, updatedAt: '2026-11-21T10:02:00Z' }))]);
  env.setNow('2026-11-21T12:03:00.000Z');
  push(env, [upsert('suplidores', s({ deleted: true, desc: 'x', updatedAt: '2026-11-21T10:03:00Z' }))]);
  env.setNow('2026-11-21T12:04:00.000Z');
  push(env, [upsert('suplidores', s({ deleted: false, updatedAt: '2026-11-21T10:04:00Z' }))]);
  push(env, [upsert('caja', { id: 'c-1', type: 'out', cat: 'Luz', amount: 50, date: '2026-11-21', note: '', deleted: true, updatedAt: '2026-11-21T10:00:00Z' })]);

  assert.deepEqual(history(env), [
    { at: '2026-11-21T12:00:00.000Z', userId: 'U-001', table: 'suplidores', recordId: 'P-001', op: 'create' },
    { at: '2026-11-21T12:01:00.000Z', userId: 'U-002', table: 'suplidores', recordId: 'P-001', op: 'update' },
    { at: '2026-11-21T12:02:00.000Z', userId: 'U-001', table: 'suplidores', recordId: 'P-001', op: 'delete' },
    { at: '2026-11-21T12:03:00.000Z', userId: 'U-001', table: 'suplidores', recordId: 'P-001', op: 'update' },
    { at: '2026-11-21T12:04:00.000Z', userId: 'U-001', table: 'suplidores', recordId: 'P-001', op: 'update' },
    { at: '2026-11-21T12:04:00.000Z', userId: 'U-001', table: 'caja', recordId: 'c-1', op: 'create' }
  ]);
});

test('facturas numbering: collision renumbers to max+1 over all F-### incl. deleted; updates cannot change num', () => {
  const env = fresh();
  push(env, [
    upsert('facturas', factura({ id: 'a', num: 'F-001' })),
    upsert('facturas', factura({ id: 'b', num: 'F-002' })),
    upsert('facturas', factura({ id: 'c', num: 'F-010', deleted: true })),
    upsert('facturas', factura({ id: 'd', num: 'VIEJA-77' }))
  ]);
  const res = push(env, [
    upsert('facturas', factura({ id: 'e', num: 'F-002' })),   // collides → F-011
    upsert('facturas', factura({ id: 'f', num: 'F-005' })),   // free → kept
    upsert('facturas', factura({ id: 'g', num: 'F-005' })),   // collides with f in the same push → F-012
    upsert('facturas', factura({ id: 'h', num: 'F-010' }))    // collides with a deleted row → F-013
  ]);
  assert.deepEqual(res.applied, ['e', 'f', 'g', 'h']);
  assert.deepEqual(res.renumbered, [{ id: 'e', num: 'F-011' }, { id: 'g', num: 'F-012' }, { id: 'h', num: 'F-013' }]);
  const nums = Object.fromEntries(tab(env, 'Facturas')._objects().map((r) => [r.id, r.num]));
  assert.deepEqual(nums, { a: 'F-001', b: 'F-002', c: 'F-010', d: 'VIEJA-77', e: 'F-011', f: 'F-005', g: 'F-012', h: 'F-013' });

  const upd = push(env, [upsert('facturas', factura({ id: 'a', num: 'F-999', amount: 7, updatedAt: '2026-11-21T11:00:00.000Z' }))]);
  assert.deepEqual(upd.applied, ['a']);
  assert.deepEqual(upd.renumbered, []);
  const a = tab(env, 'Facturas')._objects().find((r) => r.id === 'a');
  assert.equal(a.num, 'F-001');
  assert.equal(a.amount, 7);
});

test('unknown table or op → bad_request and nothing written', () => {
  const env = fresh();
  for (const bad of [
    upsert('usuarios', { id: 'U-009', name: 'x', active: true, updatedAt: '2026-11-21T10:00:00Z' }),
    upsert('historial', { id: 'h', updatedAt: '2026-11-21T10:00:00Z' }),
    upsert('Facturas', factura({ id: 'z' })),
    upsert('constructor', factura({ id: 'z' })),
    { op: 'delete', table: 'facturas', record: factura({ id: 'z' }) },
    upsert('facturas', factura({ id: '' })),
    upsert('facturas', factura({ id: 'z', updatedAt: 'yesterday' })),
    upsert('facturas', null)
  ]) {
    const res = push(env, [upsert('facturas', factura()), bad]);
    assert.equal(res.error, 'bad_request', JSON.stringify(bad));
  }
  assert.equal(push(env, 'not-an-array').error, 'bad_request');
  assert.equal(tab(env, 'Facturas').getLastRow(), 1);
  assert.equal(tab(env, 'Usuarios').getLastRow(), 4);
  assert.equal(history(env).length, 0);
  assert.deepEqual(push(env, []), { ok: true, now: '2026-11-21T12:00:00.000Z', applied: [], renumbered: [] });
});

test('text that looks like a formula is stored as text and read back unchanged', () => {
  const env = fresh();
  push(env, [upsert('caja', { id: 'c-1', type: 'in', cat: 'Otro ingreso', amount: 1, date: '2026-11-01', note: '=IMPORTXML("http://x")', deleted: false, updatedAt: '2026-11-21T10:00:00Z' })]);
  const raw = tab(env, 'Caja')._objects()[0];
  assert.equal(typeof raw.note, 'string');
  assert.equal(pull(env).caja[0].note, '=IMPORTXML("http://x")');
});

// ---------- pull ----------

test('pull since=null returns everything incl. deleted; usuarios always in full', () => {
  const env = fresh();
  tab(env, 'Usuarios').getRange(3, 3).setValues([[false]]);
  push(env, [
    upsert('facturas', factura()),
    upsert('facturas', factura({ id: 'fa-2', num: 'F-002', deleted: true })),
    upsert('suplidores', { id: 'P-001', name: 'Edenorte', desc: '', prio: 1, deleted: false, updatedAt: '2026-11-21T10:00:00Z' })
  ]);
  env.setNow('2026-11-21T15:00:00.000Z');
  const res = pull(env, null);
  assert.equal(res.ok, true);
  assert.equal(res.now, '2026-11-21T14:59:59.999Z');
  assert.deepEqual(res.facturas.map((f) => [f.id, f.deleted]), [['fa-1', false], ['fa-2', true]]);
  assert.deepEqual(res.facturas[0], {
    id: 'fa-1', prov: 'P-001', num: 'F-001', entered: '2026-11-05', amount: 1500.5, prio: 2, photoId: '',
    updatedAt: '2026-11-21T10:00:00.000Z', deleted: false, createdBy: 'U-001', updatedBy: 'U-001', syncedAt: '2026-11-21T12:00:00.000Z'
  });
  assert.equal(res.suplidores.length, 1);
  assert.deepEqual(res.pagos, []);
  assert.deepEqual(res.caja, []);
  assert.deepEqual(res.usuarios, [
    { id: 'U-001', name: 'Mamá', active: true }, { id: 'U-002', name: 'Admin', active: false }, { id: 'U-003', name: 'Primo', active: true }
  ]);
  assert.equal(env.post({ action: 'pull', key: KEY, since: 'ayer' }).error, 'bad_request');
});

test('pull since filters on syncedAt (server clock), not updatedAt (device clock)', () => {
  const env = fresh();
  // Device with a clock far in the past pushes at 12:00 server time.
  push(env, [upsert('facturas', factura({ id: 'old-clock', updatedAt: '2020-01-01T00:00:00.000Z' }))]);
  env.setNow('2026-11-21T13:00:00.000Z');
  const first = pull(env, null);
  // Device with a clock far in the future pushed earlier; a later push from a skewed device:
  env.setNow('2026-11-21T14:00:00.000Z');
  push(env, [upsert('facturas', factura({ id: 'late', num: 'F-002', updatedAt: '2019-06-01T00:00:00.000Z' }))]);
  env.setNow('2026-11-21T15:00:00.000Z');
  const second = pull(env, first.now);
  assert.deepEqual(second.facturas.map((f) => f.id), ['late']);
  assert.equal(second.usuarios.length, 3);
  // A future updatedAt synced before `since` is not returned again.
  assert.deepEqual(pull(env, '2026-11-21T14:00:00.000Z').facturas, []);
  assert.deepEqual(pull(env, '2026-11-21T13:59:59.999Z').facturas.map((f) => f.id), ['late']);
});

test('a push in the same millisecond right after a pull is not lost', () => {
  const env = fresh();
  env.setNow('2026-11-21T16:00:00.000Z');
  const p = pull(env, null);
  push(env, [upsert('facturas', factura({ id: 'same-ms' }))]);
  assert.deepEqual(pull(env, p.now).facturas.map((f) => f.id), ['same-ms']);
});

test('normalizes values Sheets converted (columns not formatted as text)', () => {
  const env = loadCode({ props: { SHEET_KEY: KEY } });
  // Tabs made by hand: headers only, no '@' formats → Sheets turns strings into Dates/booleans/numbers.
  const headers = {
    Suplidores: ['id', 'name', 'desc', 'prio'], Facturas: ['id', 'prov', 'num', 'entered', 'amount', 'prio', 'photoId'],
    Pagos: ['id', 'factura', 'date', 'amount'], Caja: ['id', 'type', 'cat', 'amount', 'date', 'note']
  };
  for (const [name, h] of Object.entries(headers)) env.ss.insertSheet(name).appendRow([...h, 'updatedAt', 'deleted', 'createdBy', 'updatedBy', 'syncedAt']);
  env.ss.insertSheet('Usuarios').appendRow(['id', 'name', 'active']);
  env.ss.getSheetByName('Usuarios').appendRow(['U-001', 'Mamá', 'TRUE']);
  env.ss.insertSheet('Historial').appendRow(['at', 'userId', 'table', 'recordId', 'op']);
  env.setNow('2026-11-21T12:00:00.000Z');

  push(env, [
    upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-01-31', amount: '250.75', updatedAt: '2026-11-21T10:00:00.000Z', deleted: false }),
    upsert('facturas', factura({ prio: '3', photoId: null, desc: undefined }))
  ]);
  const raw = tab(env, 'Pagos')._rows()[1];
  assert.ok(raw[2] instanceof Date, 'mock really turned the date into a Date');
  assert.ok(raw[4] instanceof Date, 'and the timestamp too');
  assert.ok(tab(env, 'Historial')._rows()[1][0] instanceof Date);

  const res = pull(env, '2026-11-21T11:00:00.000Z');
  assert.deepEqual(res.pagos, [{ id: 'pa-1', factura: 'fa-1', date: '2026-01-31', amount: 250.75, updatedAt: '2026-11-21T10:00:00.000Z',
    deleted: false, createdBy: 'U-001', updatedBy: 'U-001', syncedAt: '2026-11-21T12:00:00.000Z' }]);
  assert.equal(res.facturas[0].entered, '2026-11-05');
  assert.equal(res.facturas[0].prio, 3);
  assert.equal(res.facturas[0].photoId, '');
  assert.deepEqual(res.usuarios, [{ id: 'U-001', name: 'Mamá', active: true }]);

  // LWW still works when the stored updatedAt is a Date.
  assert.deepEqual(push(env, [upsert('pagos', { id: 'pa-1', factura: 'fa-1', date: '2026-01-31', amount: 1, updatedAt: '2026-11-21T10:00:00.000Z', deleted: false })]).applied, []);

  // Hand-typed rows: blank cells → "" / false, numeric ids → strings, extra blank rows ignored.
  tab(env, 'Caja').appendRow([123, 'in', 'Venta del día', 50, '2026-11-20', '', '', '', '', '', '']);
  tab(env, 'Caja').appendRow(['', '', '', '', '', '', '', '', '', '', '']);
  const all = pull(env, null).caja;
  assert.deepEqual(all, [{ id: '123', type: 'in', cat: 'Venta del día', amount: 50, date: '2026-11-20', note: '',
    updatedAt: '', deleted: false, createdBy: '', updatedBy: '', syncedAt: '' }]);
});

test('missing tab → server error', () => {
  const env = loadCode({ props: { SHEET_KEY: KEY } });
  const res = env.post({ action: 'verify', key: KEY });
  assert.equal(res.error, 'server');
  assert.match(res.message, /setup/);
});

test('lock not available → server error, nothing written', () => {
  const env = fresh();
  env.lock.available = false;
  assert.equal(push(env, [upsert('facturas', factura())]).error, 'server');
  assert.equal(pull(env).error, 'server');
  assert.equal(tab(env, 'Facturas').getLastRow(), 1);
  env.lock.available = true;
  assert.equal(push(env, [upsert('facturas', factura())]).ok, true);
  assert.equal(env.lock.held, false, 'lock released');
});

// ---------- photos ----------

test('photo upload creates the file in the folder, logs Historial, getPhoto round-trips', () => {
  const env = fresh();
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0x7f, 0x01]);
  const base64 = bytes.toString('base64');
  const res = env.post({ action: 'photo', key: KEY, userId: 'U-002', facturaId: 'fa-1', name: '2026-11_Farmacia Central_F-008.jpg', mime: 'image/jpeg', base64 });
  assert.equal(res.ok, true);
  const file = env.drive.files.get(res.photoId);
  assert.ok(file);
  const folderId = env.props.get('PHOTO_FOLDER_ID');
  assert.equal(file.parent.getId(), folderId);
  assert.equal(env.drive.folders.get(folderId).getName(), 'Mis Facturas — Fotos');
  assert.equal(file.getName(), '2026-11_Farmacia Central_F-008.jpg');
  assert.equal(file.getMimeType(), 'image/jpeg');
  assert.deepEqual(history(env), [{ at: '2026-11-21T12:00:00.000Z', userId: 'U-002', table: 'facturas', recordId: 'fa-1', op: 'photo' }]);
  assert.equal(tab(env, 'Facturas').getLastRow(), 1, 'factura row untouched');

  const back = env.post({ action: 'getPhoto', key: KEY, id: res.photoId });
  assert.deepEqual(back, { ok: true, mime: 'image/jpeg', base64 });

  // Second upload reuses the folder; a data: prefix is tolerated.
  const res2 = env.post({ action: 'photo', key: KEY, userId: 'U-001', facturaId: 'fa-2', name: 'b.jpg', mime: 'image/jpeg', base64: 'data:image/jpeg;base64,' + base64 });
  assert.equal(env.drive.folders.size, 1);
  assert.equal(env.post({ action: 'getPhoto', key: KEY, id: res2.photoId }).base64, base64);
});

test('photo: bad input, folder recreated when trashed, getPhoto only serves the photos folder', () => {
  const env = fresh();
  const base = { action: 'photo', key: KEY, userId: 'U-001', facturaId: 'fa-1', name: 'a.jpg', mime: 'image/jpeg' };
  assert.equal(env.post({ ...base, base64: '' }).error, 'bad_request');
  assert.equal(env.post({ ...base, base64: '!!!not base64' }).error, 'bad_request');
  assert.equal(env.post({ ...base, facturaId: undefined, base64: 'AAEC' }).error, 'bad_request');
  assert.equal(history(env).length, 0);

  const first = env.post({ ...base, base64: 'AAEC' });
  const oldFolder = env.props.get('PHOTO_FOLDER_ID');
  env.drive.folders.get(oldFolder).setTrashed(true);
  env.post({ ...base, base64: 'AAEC' });
  assert.notEqual(env.props.get('PHOTO_FOLDER_ID'), oldFolder);
  assert.equal(env.post({ action: 'getPhoto', key: KEY, id: first.photoId }).error, 'bad_request', 'old folder no longer served');

  const stranger = env.drive.createFile(env.ctx.Utilities.newBlob([1, 2, 3], 'application/pdf', 'banco.pdf'));
  assert.equal(env.post({ action: 'getPhoto', key: KEY, id: stranger.getId() }).error, 'bad_request');
  assert.equal(env.post({ action: 'getPhoto', key: KEY, id: 'does-not-exist' }).error, 'bad_request');
  assert.equal(env.post({ action: 'getPhoto', key: KEY }).error, 'bad_request');
});

// ---------- setup ----------

test('setup() creates tabs, formats, seed users and a key once; running again changes nothing', () => {
  const env = loadCode();
  env.ctx.setup();
  const names = env.ss.getSheets().map((s) => s.getName());
  assert.deepEqual(names, ['Suplidores', 'Facturas', 'Pagos', 'Caja', 'Usuarios', 'Historial']);
  assert.deepEqual(tab(env, 'Facturas')._rows()[0],
    ['id', 'prov', 'num', 'entered', 'amount', 'prio', 'photoId', 'updatedAt', 'deleted', 'createdBy', 'updatedBy', 'syncedAt']);
  assert.deepEqual(tab(env, 'Historial')._rows()[0], ['at', 'userId', 'table', 'recordId', 'op']);
  for (const s of env.ss.getSheets()) assert.equal(s.frozenRows, 1);
  const f = tab(env, 'Facturas');
  assert.equal(f.formatAt(2, 1), '@');            // id
  assert.equal(f.formatAt(2, 4), '@');            // entered
  assert.equal(f.formatAt(2, 5), '"RD$ "#,##0.00'); // amount
  assert.equal(f.formatAt(2, 6), null);           // prio stays a number
  assert.equal(f.formatAt(2, 8), '@');            // updatedAt
  assert.deepEqual(tab(env, 'Usuarios')._objects(), [
    { id: 'U-001', name: 'Mamá', active: true }, { id: 'U-002', name: 'Admin', active: true }, { id: 'U-003', name: 'Primo', active: true }
  ]);
  const key = env.props.get('SHEET_KEY');
  assert.match(key, /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
  assert.ok(env.logs.some((l) => l.includes(key)));

  // Admin edits, then setup() runs again.
  tab(env, 'Usuarios').getRange(2, 2).setValues([['Doña Carmen']]);
  env.setNow('2026-11-21T12:00:00.000Z');
  env.post({ action: 'push', key, userId: 'U-001', ops: [upsert('facturas', factura())] });
  const before = JSON.stringify(env.ss.sheets.map((s) => [s.name, s.cells, s.formats]));
  env.logs.length = 0;
  env.ctx.setup();
  assert.equal(JSON.stringify(env.ss.sheets.map((s) => [s.name, s.cells, s.formats])), before);
  assert.equal(env.props.get('SHEET_KEY'), key);
  assert.ok(!env.logs.some((l) => l.includes(key)), 'existing key is not logged again');

  // A different run generates a different key.
  const other = loadCode();
  other.ctx.setup();
  assert.notEqual(other.props.get('SHEET_KEY'), key);
});

test('setup() keeps a SHEET_KEY that already exists and an existing tab with data', () => {
  const env = loadCode({ props: { SHEET_KEY: 'mi-clave' } });
  const u = env.ss.insertSheet('Usuarios');
  u.appendRow(['id', 'name', 'active']);
  u.appendRow(['U-001', 'Abuela', true]);
  env.ctx.setup();
  assert.equal(env.props.get('SHEET_KEY'), 'mi-clave');
  assert.deepEqual(u._objects(), [{ id: 'U-001', name: 'Abuela', active: true }]);
  assert.equal(env.ss.getSheets().length, 6);
});
