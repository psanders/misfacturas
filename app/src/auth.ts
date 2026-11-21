// Sheet password + per-device PIN (BRIEF.md §7). The PIN only locks this device's UI.
import { MAX_PIN_TRIES, PBKDF2_ITERATIONS, PIN_LENGTH } from './config';
import { delMeta, getMeta, setMeta } from './db';

const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map(x => parseInt(x, 16)));

export async function hashPin(pin: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, base, 256);
  return toHex(bits);
}

export const isValidPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN inválido');
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  await setMeta('pinSalt', salt);
  await setMeta('pinHash', await hashPin(pin, salt));
  await setMeta('pinTries', 0);
}

export type PinResult = 'ok' | 'wrong' | 'reset';
/** Checks the PIN. After MAX_PIN_TRIES wrong tries in a row the PIN and key are forgotten ('reset'). */
export async function checkPin(pin: string): Promise<PinResult> {
  const [hash, salt] = [await getMeta('pinHash'), await getMeta('pinSalt')];
  if (!hash || !salt) return 'reset';
  if ((await hashPin(pin, salt)) === hash) { await setMeta('pinTries', 0); return 'ok'; }
  const tries = ((await getMeta('pinTries')) ?? 0) + 1;
  if (tries >= MAX_PIN_TRIES) { await forgetCredentials(); return 'reset'; }
  await setMeta('pinTries', tries);
  return 'wrong';
}

/** Back to onboarding step 2. Local records and the outbox are kept. */
export async function forgetCredentials(): Promise<void> {
  await delMeta('key', 'pinHash', 'pinSalt', 'pinTries', 'userId');
}

export async function hasCredentials(): Promise<boolean> {
  return !!((await getMeta('key')) && (await getMeta('userId')) && (await getMeta('pinHash')));
}
