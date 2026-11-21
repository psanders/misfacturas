import type { Prio } from './types';

/** Apps Script web app URL baked in at build time (app/.env.local → VITE_API_URL). May be empty. */
export const BUILT_IN_API_URL: string = (import.meta.env?.VITE_API_URL ?? '').trim();

export const PIN_LENGTH = 4;
export const MAX_PIN_TRIES = 5;
/** Ask for the PIN again after this long in the background. */
export const LOCK_AFTER_MS = 5 * 60 * 1000;
export const SYNC_EVERY_MS = 60 * 1000;
export const PBKDF2_ITERATIONS = 100_000;

export const PRIO: Record<Prio, { label: string; cls: string }> = {
  1: { label: 'Urgente', cls: 'p1' },
  2: { label: 'Normal', cls: 'p2' },
  3: { label: 'Puede esperar', cls: 'p3' },
};

// Caja categories. Kept here so they're easy to change.
// NOTE: invoice payments deliberately do NOT create Caja movements (owner's decision).
// A future version could link them (BRIEF.md §14).
export const CATS = {
  in: ['Venta del día', 'Otro ingreso'],
  out: ['Impuestos', 'Luz', 'Agua', 'Salarios', 'Alquiler', 'Mercancía', 'Otro gasto'],
} as const;

export const PHOTO_MAX_SIDE = 1100;
export const PHOTO_QUALITY = 0.72;
