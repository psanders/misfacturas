// Record shapes. Field names and order match docs/API.md and the Sheet headers.

export type Prio = 1 | 2 | 3;

/** Fields every synced record carries. createdBy/updatedBy/syncedAt are set by the server only. */
export interface Meta {
  id: string;
  updatedAt: string;
  deleted: boolean;
  createdBy?: string;
  updatedBy?: string;
  syncedAt?: string;
}

export interface Suplidor extends Meta { name: string; desc: string; prio: Prio }
export interface Factura extends Meta {
  prov: string;
  num: string;
  entered: string; // YYYY-MM-DD
  amount: number;
  prio: Prio;
  photoId: string; // Drive file id, '' when none (local photos live in the `photos` store)
}
export interface Pago extends Meta { factura: string; date: string; amount: number }
export type MoveType = 'in' | 'out';
export interface Movimiento extends Meta { type: MoveType; cat: string; amount: number; date: string; note: string }
export interface Usuario { id: string; name: string; active: boolean }

export interface Tables {
  suplidores: Suplidor;
  facturas: Factura;
  pagos: Pago;
  caja: Movimiento;
}
export type TableName = keyof Tables;
export const TABLES: TableName[] = ['suplidores', 'facturas', 'pagos', 'caja'];

/** Own fields per table, in Sheet order (common fields follow). Used to strip unknown keys before pushing. */
export const FIELDS: { [K in TableName]: (keyof Tables[K])[] } = {
  suplidores: ['id', 'name', 'desc', 'prio'],
  facturas: ['id', 'prov', 'num', 'entered', 'amount', 'prio', 'photoId'],
  pagos: ['id', 'factura', 'date', 'amount'],
  caja: ['id', 'type', 'cat', 'amount', 'date', 'note'],
};

export interface OutboxOp { seq?: number; op: 'upsert'; table: TableName; record: Tables[TableName] }
