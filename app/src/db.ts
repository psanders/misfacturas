// IndexedDB: the source of truth for the UI (BRIEF.md §6). One database per mode, so ?demo never touches real data.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Factura, Movimiento, OutboxOp, Pago, Suplidor, Usuario } from './types';

export interface PhotoRow {
  facturaId: string;
  blob: Blob;
  /** true until uploaded to Drive; then photoId is set. Downloaded photos are never pending. */
  pending: boolean;
  photoId?: string;
}

export interface MetaValues {
  apiUrl: string;
  key: string; // sheet password
  userId: string;
  pinHash: string;
  pinSalt: string;
  pinTries: number;
  lastSync: string; // server `now` from the last pull
  lastSyncOkAt: number; // device time, for "Última sincronización: hace…"
  persisted: boolean;
}

interface Schema extends DBSchema {
  suplidores: { key: string; value: Suplidor };
  facturas: { key: string; value: Factura };
  pagos: { key: string; value: Pago };
  caja: { key: string; value: Movimiento };
  usuarios: { key: string; value: Usuario };
  photos: { key: string; value: PhotoRow };
  outbox: { key: number; value: OutboxOp };
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<Schema>;
let dbp: Promise<DB> | null = null;

export const dbName = (demo: boolean) => (demo ? 'misfacturas-demo' : 'misfacturas');

export function openDb(name: string): Promise<DB> {
  dbp = openDB<Schema>(name, 1, {
    upgrade(db) {
      for (const t of ['suplidores', 'facturas', 'pagos', 'caja', 'usuarios'] as const) db.createObjectStore(t, { keyPath: 'id' });
      db.createObjectStore('photos', { keyPath: 'facturaId' });
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('meta');
    },
  });
  return dbp;
}

export function db(): Promise<DB> {
  if (!dbp) throw new Error('openDb() first');
  return dbp;
}

export async function getMeta<K extends keyof MetaValues>(k: K): Promise<MetaValues[K] | undefined> {
  return (await (await db()).get('meta', k)) as MetaValues[K] | undefined;
}
export async function setMeta<K extends keyof MetaValues>(k: K, v: MetaValues[K]): Promise<void> {
  await (await db()).put('meta', v, k);
}
export async function delMeta(...ks: (keyof MetaValues)[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('meta', 'readwrite');
  await Promise.all([...ks.map(k => tx.store.delete(k)), tx.done]);
}
