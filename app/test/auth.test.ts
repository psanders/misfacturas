import { beforeAll, describe, expect, it } from 'vitest';
import { checkPin, hasCredentials, hashPin, isValidPin, setPin } from '../src/auth';
import { getMeta, openDb, setMeta } from '../src/db';
import { MAX_PIN_TRIES } from '../src/config';

beforeAll(async () => { await openDb('auth-test'); });

describe('PIN', () => {
  it('hashes deterministically per salt and differently across salts', async () => {
    const a = await hashPin('1234', '00'.repeat(16), 1000);
    expect(a).toBe(await hashPin('1234', '00'.repeat(16), 1000));
    expect(a).not.toBe(await hashPin('1234', '11'.repeat(16), 1000));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('only accepts 4 digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
  it('never stores the PIN itself', async () => {
    await setPin('4821');
    expect(await getMeta('pinHash')).not.toContain('4821');
  });
  it('checks the PIN and resets the counter on success', async () => {
    await setPin('4821');
    expect(await checkPin('0000')).toBe('wrong');
    expect(await getMeta('pinTries')).toBe(1);
    expect(await checkPin('4821')).toBe('ok');
    expect(await getMeta('pinTries')).toBe(0);
  });
  it(`forgets key and PIN after ${MAX_PIN_TRIES} wrong tries, keeping the API URL`, async () => {
    await setMeta('apiUrl', 'https://script.google.com/x/exec');
    await setMeta('key', 'k');
    await setMeta('userId', 'U-001');
    await setPin('4821');
    expect(await hasCredentials()).toBe(true);
    for (let i = 1; i < MAX_PIN_TRIES; i++) expect(await checkPin('0000')).toBe('wrong');
    expect(await checkPin('0000')).toBe('reset');
    expect(await hasCredentials()).toBe(false);
    expect(await getMeta('key')).toBeUndefined();
    expect(await getMeta('apiUrl')).toBe('https://script.google.com/x/exec');
  });
}, 30_000);
