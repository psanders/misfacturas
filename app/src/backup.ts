// "Respaldo" (BRIEF.md §5.12): one ZIP with data.json + photos/<facturaId>.<ext>. Restore merges with LWW.
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { db } from './db';
import { applyRemote, isDemo, load, putPhoto } from './store';
import { seed } from './seed';
import { TABLES, type TableName, type Tables } from './types';

const extOf = (mime: string) => (mime.includes('svg') ? 'svg' : mime.includes('png') ? 'png' : 'jpg');
const mimeOf = (name: string) => (name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'image/jpeg');

export async function exportBackup(): Promise<void> {
  const d = await db();
  const data: Record<string, unknown> = { app: 'mis-facturas', version: 1, exportedAt: new Date().toISOString() };
  for (const t of TABLES) data[t] = await d.getAll(t);
  const files: Record<string, Uint8Array> = { 'data.json': strToU8(JSON.stringify(data, null, 1)) };
  for (const p of await d.getAll('photos')) files[`photos/${p.facturaId}.${extOf(p.blob.type)}`] = new Uint8Array(await p.blob.arrayBuffer());
  const zip = zipSync(files, { level: 0 }); // photos are already compressed
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  a.download = `mis-facturas-respaldo-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Returns false when the file isn't a backup. Imported rows merge by last-write-wins and are not re-pushed. */
export async function importBackup(file: Blob): Promise<boolean> {
  let files: Record<string, Uint8Array>;
  let data: Record<string, unknown>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    data = JSON.parse(strFromU8(files['data.json']));
    if (data.app !== 'mis-facturas') return false;
  } catch { return false; }
  const rows: Partial<{ [K in TableName]: Tables[K][] }> = {};
  for (const t of TABLES) if (Array.isArray(data[t])) (rows as Record<string, unknown>)[t] = data[t];
  await applyRemote(rows);
  if (!isDemo()) {
    // Queue everything for push so a restore into a fresh Sheet repopulates it. The server's
    // last-write-wins skips rows it already has with the same or a newer updatedAt.
    const d = await db();
    const tx = d.transaction('outbox', 'readwrite');
    for (const t of TABLES) for (const r of (rows[t] ?? []) as Tables[TableName][]) {
      const { createdBy: _c, updatedBy: _u, syncedAt: _s, ...wire } = r;
      await tx.store.add({ op: 'upsert', table: t, record: wire as Tables[TableName] });
    }
    await tx.done;
  }
  for (const [name, bytes] of Object.entries(files)) {
    const m = /^photos\/(.+)\.(jpg|png|svg)$/.exec(name);
    if (!m) continue;
    const hasDriveCopy = !!(rows.facturas ?? []).find(f => f.id === m[1])?.photoId;
    await putPhoto({ facturaId: m[1], blob: new Blob([bytes as BlobPart], { type: mimeOf(name) }), pending: !isDemo() && !hasDriveCopy });
  }
  return true;
}

/** Demo mode only: wipe and reseed. */
export async function resetDemo(): Promise<void> {
  if (!isDemo()) return;
  const d = await db();
  for (const t of [...TABLES, 'photos', 'outbox'] as const) await d.clear(t);
  await loadSeed();
}
export async function loadSeed(): Promise<void> {
  const s = seed();
  const d = await db();
  for (const t of TABLES) for (const r of s[t]) await d.put(t, r as never);
  for (const p of s.photos) await d.put('photos', { ...p, pending: false });
  await load();
}
