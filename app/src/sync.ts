// Offline-first sync worker (BRIEF.md §6, docs/API.md): photos → push outbox → pull.
import { api, ApiError } from './api';
import { SYNC_EVERY_MS } from './config';
import { db, getMeta, setMeta } from './db';
import { ym } from './format';
import { base64ToBlob, blobToBase64 } from './photo';
import { applyRemote, applyRenumber, isDemo, putPhoto, S, save, setAfterLocalChange } from './store';

export type SyncState = 'ok' | 'pending' | 'offline' | 'error';
let state: SyncState = 'pending';
const subs = new Set<(s: SyncState) => void>();
export const onSyncState = (fn: (s: SyncState) => void) => { subs.add(fn); fn(state); return () => subs.delete(fn); };
const setState = (s: SyncState) => { state = s; subs.forEach(fn => fn(s)); };
export const syncState = () => state;

let onAuthLost: () => void = () => {};
export const setOnAuthLost = (fn: () => void) => { onAuthLost = fn; };

async function creds() {
  const [url, key, userId] = [await getMeta('apiUrl'), await getMeta('key'), await getMeta('userId')];
  return url && key && userId ? { url, key, userId } : null;
}

async function pendingCount(): Promise<number> {
  const d = await db();
  const photos = (await d.getAll('photos')).filter(p => p.pending).length;
  return (await d.count('outbox')) + photos;
}

async function uploadPhotos(url: string, key: string, userId: string) {
  const d = await db();
  for (const p of (await d.getAll('photos')).filter(x => x.pending)) {
    const f = S.facturas.find(x => x.id === p.facturaId);
    if (!f || f.deleted) { await d.delete('photos', p.facturaId); continue; }
    const prov = S.suplidores.find(s => s.id === f.prov)?.name ?? f.prov;
    const name = `${ym(f.entered)}_${prov}_${f.num}.jpg`.replace(/[\\/:*?"<>|]/g, '-');
    const { photoId } = await api.photo(url, key, userId, f.id, name, p.blob.type || 'image/jpeg', await blobToBase64(p.blob));
    await putPhoto({ ...p, pending: false, photoId });
    await save('facturas', { ...f, photoId }); // queues the invoice update with its Drive id
  }
}

async function push(url: string, key: string, userId: string) {
  const d = await db();
  const ops = await d.getAll('outbox', undefined, 200);
  if (!ops.length) return;
  const res = await api.push(url, key, userId, ops);
  const tx = d.transaction('outbox', 'readwrite');
  for (const op of ops) await tx.store.delete(op.seq!);
  await tx.done;
  for (const r of res.renumbered) await applyRenumber(r.id, r.num);
  if (ops.length === 200) await push(url, key, userId);
}

// The first pull after each app start is a full one, so rows typed by hand in the Sheet
// (which have no syncedAt) still reach the device. Tables are small, so this is cheap.
let fullPullDone = false;
async function pull(url: string, key: string) {
  const since = fullPullDone ? ((await getMeta('lastSync')) ?? null) : null;
  const res = await api.pull(url, key, since);
  await applyRemote(res, res.usuarios);
  await setMeta('lastSync', res.now);
  fullPullDone = true;
}

let running: Promise<void> | null = null;
let again = false;
export function syncNow(): Promise<void> {
  if (isDemo()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        const c = await creds();
        if (!c) return;
        if (!navigator.onLine) { setState('offline'); return; }
        await uploadPhotos(c.url, c.key, c.userId);
        await push(c.url, c.key, c.userId);
        await pull(c.url, c.key);
        await setMeta('lastSyncOkAt', Date.now());
      } while (again);
      setState((await pendingCount()) ? 'pending' : 'ok');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'bad_key' || e.code === 'bad_user')) { setState('error'); onAuthLost(); }
      else setState(e instanceof ApiError && e.code === 'network' ? 'offline' : 'error');
      console.warn('[sync]', e);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Download a photo another device uploaded, once, and keep it locally. */
const fetching = new Set<string>();
export async function ensurePhoto(facturaId: string, photoId: string): Promise<void> {
  if (isDemo() || !photoId || fetching.has(facturaId)) return;
  const d = await db();
  if (await d.get('photos', facturaId)) return;
  const c = await creds();
  if (!c || !navigator.onLine) return;
  fetching.add(facturaId);
  try {
    const r = await api.getPhoto(c.url, c.key, photoId);
    await putPhoto({ facturaId, blob: base64ToBlob(r.base64, r.mime), pending: false, photoId });
  } catch (e) {
    console.warn('[photo]', e);
  } finally {
    fetching.delete(facturaId);
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
export function startSync(): void {
  setAfterLocalChange(() => {
    setState('pending');
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 800);
  });
  if (isDemo()) { setState('ok'); return; }
  addEventListener('online', () => syncNow());
  addEventListener('offline', () => setState('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, SYNC_EVERY_MS);
  syncNow();
}
