// In-memory view of IndexedDB + local mutations. Every change: write locally → append to outbox → notify UI → sync.
import { db, type PhotoRow } from './db';
import { FIELDS, TABLES, type TableName, type Tables, type Usuario } from './types';

type State = { [K in TableName]: Tables[K][] } & { usuarios: Usuario[] };
export const S: State = { suplidores: [], facturas: [], pagos: [], caja: [], usuarios: [] };

let demoMode = false;
export const isDemo = () => demoMode;
export const setDemo = (v: boolean) => { demoMode = v; };

const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn());

let afterLocalChange: () => void = () => {};
/** sync.ts registers itself here so a local change triggers a push. */
export const setAfterLocalChange = (fn: () => void) => { afterLocalChange = fn; };

export async function load(): Promise<void> {
  const d = await db();
  for (const t of TABLES) (S[t] as Tables[typeof t][]) = await d.getAll(t);
  S.usuarios = await d.getAll('usuarios');
  emit();
}

/** A timestamp strictly after `prev`, even if the device clock went backwards. */
function nextStamp(prev?: string): string {
  const now = Date.now();
  const p = prev ? Date.parse(prev) : 0;
  return new Date(Math.max(now, p + 1)).toISOString();
}

/** Create or update a record. Returns the stored record. */
export async function save<K extends TableName>(table: K, rec: Omit<Tables[K], 'updatedAt' | 'deleted'> & { deleted?: boolean }): Promise<Tables[K]> {
  const list = S[table] as Tables[K][];
  const prev = list.find(x => x.id === rec.id);
  const clean: Record<string, unknown> = {};
  for (const f of FIELDS[table]) clean[f as string] = (rec as Record<string, unknown>)[f as string];
  const stored = {
    ...(prev ?? {}),
    ...clean,
    deleted: rec.deleted ?? prev?.deleted ?? false,
    updatedAt: nextStamp(prev?.updatedAt),
  } as unknown as Tables[K];
  const d = await db();
  const tx = d.transaction([table, 'outbox'], 'readwrite');
  await tx.objectStore(table).put(stored as never);
  if (!demoMode) {
    const { createdBy: _c, updatedBy: _u, syncedAt: _s, ...wire } = stored;
    await tx.objectStore('outbox').add({ op: 'upsert', table, record: wire as Tables[K] });
  }
  await tx.done;
  const i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = stored; else list.push(stored);
  emit();
  afterLocalChange();
  return stored;
}

export async function remove<K extends TableName>(table: K, id: string): Promise<void> {
  const prev = (S[table] as Tables[K][]).find(x => x.id === id);
  if (prev) await save(table, { ...prev, deleted: true });
}

/** Merge rows from the server with last-write-wins on updatedAt. Ties go to the server (it carries the stamps). */
export async function applyRemote(data: Partial<{ [K in TableName]: Tables[K][] }>, usuarios?: Usuario[]): Promise<number> {
  const d = await db();
  let n = 0;
  for (const t of TABLES) {
    const rows = data[t] as Tables[typeof t][] | undefined;
    if (!rows?.length) continue;
    const tx = d.transaction(t, 'readwrite');
    for (const row of rows) {
      const local = await tx.store.get(row.id);
      if (local && local.updatedAt > row.updatedAt) continue; // local change still waiting in the outbox
      await tx.store.put(row as never);
      n++;
    }
    await tx.done;
  }
  if (usuarios) {
    const tx = d.transaction('usuarios', 'readwrite');
    await tx.store.clear();
    for (const u of usuarios) await tx.store.put(u);
    await tx.done;
  }
  await load();
  return n;
}

/** Server renumbered an invoice (two devices picked the same F-xxx offline). Not a user change: no outbox op. */
export async function applyRenumber(id: string, num: string): Promise<void> {
  const d = await db();
  const f = await d.get('facturas', id);
  if (!f) return;
  f.num = num;
  await d.put('facturas', f);
  const local = S.facturas.find(x => x.id === id);
  if (local) local.num = num;
  emit();
}

// ---- photos (blobs live in IndexedDB, object URLs are cached in memory) ----
const urls = new Map<string, string>();
export async function putPhoto(row: PhotoRow): Promise<void> {
  await (await db()).put('photos', row);
  const old = urls.get(row.facturaId);
  if (old) URL.revokeObjectURL(old);
  urls.delete(row.facturaId);
  emit();
}
export async function photoUrl(facturaId: string): Promise<string | null> {
  if (urls.has(facturaId)) return urls.get(facturaId)!;
  const row = await (await db()).get('photos', facturaId);
  if (!row) return null;
  const u = URL.createObjectURL(row.blob);
  urls.set(facturaId, u);
  return u;
}
export const cachedPhotoUrl = (facturaId: string) => urls.get(facturaId) ?? null;
