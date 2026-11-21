// Thin client for the Apps Script web app. Contract: docs/API.md.
import type { Movimiento, Factura, Pago, Suplidor, Usuario, OutboxOp } from './types';

export type ApiErrorCode = 'bad_key' | 'bad_user' | 'bad_request' | 'server' | 'network';
export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message?: string) { super(message || code); }
}

export interface PullResult {
  now: string;
  suplidores: Suplidor[]; facturas: Factura[]; pagos: Pago[]; caja: Movimiento[];
  usuarios: Usuario[];
}
export interface PushResult { now: string; applied: string[]; renumbered: { id: string; num: string }[] }

async function call<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    // text/plain avoids the CORS preflight that Apps Script cannot answer.
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  } catch (e) {
    throw new ApiError('network', String(e));
  }
  let data: { ok: boolean; error?: ApiErrorCode; message?: string } & T;
  try { data = await res.json(); } catch { throw new ApiError('server', 'Respuesta no válida (HTTP ' + res.status + ')'); }
  if (!data.ok) throw new ApiError(data.error || 'server', data.message);
  return data;
}

export const api = {
  verify: (url: string, key: string) => call<{ users: { id: string; name: string }[] }>(url, { action: 'verify', key }),
  pull: (url: string, key: string, since: string | null) => call<PullResult>(url, { action: 'pull', key, since }),
  push: (url: string, key: string, userId: string, ops: OutboxOp[]) =>
    call<PushResult>(url, { action: 'push', key, userId, ops: ops.map(({ op, table, record }) => ({ op, table, record })) }),
  photo: (url: string, key: string, userId: string, facturaId: string, name: string, mime: string, base64: string) =>
    call<{ photoId: string }>(url, { action: 'photo', key, userId, facturaId, name, mime, base64 }),
  getPhoto: (url: string, key: string, id: string) => call<{ mime: string; base64: string }>(url, { action: 'getPhoto', key, id }),
};
