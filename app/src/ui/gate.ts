// Onboarding (once per device) and the PIN lock screen (BRIEF.md §5.11, designs in mis-facturas.nib).
import { api, ApiError } from '../api';
import { BUILT_IN_API_URL, LOCK_AFTER_MS, MAX_PIN_TRIES, PIN_LENGTH } from '../config';
import { getMeta, setMeta } from '../db';
import { esc } from '../format';
import { T } from '../i18n/es-DO';
import { checkPin, forgetCredentials, setPin } from '../auth';
import { $ } from './dom';
import { LOGO } from './view';

const logo = `<div aria-hidden="true">${LOGO}</div>`;

/** Resolves once the person is through onboarding or the PIN screen. */
export type Gate = (root: HTMLElement) => Promise<void>;

// ---------- PIN pad ----------
interface PadOpts { title: string; help?: string; footer?: string; onPin: (pin: string) => Promise<string | null> }
/** Renders the keypad. onPin returns null when accepted, or an error message to show (then the pad clears). */
function pinPad(root: HTMLElement, o: PadOpts): Promise<'done' | 'usekey'> {
  return new Promise(done => {
    let pin = '', busy = false;
    root.innerHTML = `<div class="gate">${logo}<h1>${T.appName}</h1><p class="help">${o.title}</p>${o.help ? `<p class="help">${o.help}</p>` : ''}
      <div class="dots" id="dots">${'<i></i>'.repeat(PIN_LENGTH)}</div><div class="msg" id="msg" aria-live="assertive"></div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
      <button class="blank" tabindex="-1" aria-hidden="true"></button><button data-k="0">0</button><button class="del" data-k="del" aria-label="${T.deleteKey}">⌫</button></div>
      <div class="grow"></div><div class="foot">${o.footer ?? ''}</div></div>`;
    const dots = $('#dots', root), msg = $('#msg', root);
    const paint = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const press = async (k: string) => {
      if (busy) return;
      if (k === 'del') { pin = pin.slice(0, -1); return paint(); }
      if (pin.length >= PIN_LENGTH) return;
      dots.classList.remove('bad');
      msg.innerHTML = '';
      pin += k;
      paint();
      if (pin.length < PIN_LENGTH) return;
      busy = true;
      const err = await o.onPin(pin);
      busy = false;
      if (err === null) { cleanup(); return done('done'); }
      dots.classList.add('bad');
      msg.innerHTML = `<span>${err}</span>`;
      pin = '';
      setTimeout(() => { if (!pin) { dots.classList.remove('bad'); paint(); } }, 900);
    };
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-act=usekey]')) { cleanup(); return done('usekey'); }
      const b = t.closest<HTMLElement>('[data-k]');
      if (b) press(b.dataset.k!);
    };
    const onKey = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    const cleanup = () => { root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- onboarding ----------
function screen(root: HTMLElement, html: string) {
  root.innerHTML = `<div class="gate">${logo}<h1>${T.appName}</h1>${html}<div class="grow"></div></div>`;
}

function welcome(root: HTMLElement): Promise<void> {
  return new Promise(done => {
    screen(root, `<p class="help">${T.welcome}</p><div class="grow"></div><button class="btn" id="go">${T.start}</button>`);
    $('#go', root).onclick = () => done();
  });
}

function askUrl(root: HTMLElement): Promise<string> {
  return new Promise(done => {
    screen(root, `<h2>${T.apiUrlTitle}</h2><p class="help">${T.apiUrlHelp}</p>
      <form id="f"><input id="u" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" required>
      <div class="msg" id="msg"></div><button class="btn">${T.continue}</button></form>`);
    $('#f', root).onsubmit = e => {
      e.preventDefault();
      const u = $<HTMLInputElement>('#u', root).value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u)) { $('#msg', root).innerHTML = `<span>${T.apiUrlBad}</span>`; return; }
      done(u);
    };
  });
}

function askKey(root: HTMLElement, url: string): Promise<{ key: string; users: { id: string; name: string }[] }> {
  return new Promise(done => {
    screen(root, `<h2>${T.keyTitle}</h2><p class="help">${T.keyHelp}</p>
      <form id="f"><input id="k" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required autofocus>
      <div class="msg" id="msg" aria-live="assertive"></div><button class="btn" id="b">${T.continue}</button></form>`);
    const msg = $('#msg', root), btn = $<HTMLButtonElement>('#b', root);
    $('#f', root).onsubmit = async e => {
      e.preventDefault();
      const key = $<HTMLInputElement>('#k', root).value.trim();
      if (!key) return;
      if (!navigator.onLine) { msg.innerHTML = `<span>${T.needInternet}</span>`; return; }
      btn.disabled = true;
      msg.innerHTML = '';
      try {
        const r = await api.verify(url, key);
        done({ key, users: r.users });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'server';
        msg.innerHTML = `<span>${code === 'bad_key' ? T.keyBad : code === 'network' ? T.needInternet : T.serverBad}</span>`;
        btn.disabled = false;
      }
    };
  });
}

function askWho(root: HTMLElement, users: { id: string; name: string }[]): Promise<string> {
  return new Promise(done => {
    screen(root, `<h2>${T.whoTitle}</h2>${users.length ? `<div class="who">${users.map(u => `<button data-id="${esc(u.id)}">${esc(u.name)}</button>`).join('')}</div>` : `<p class="help">${T.noUsers}</p>`}`);
    root.querySelectorAll<HTMLElement>('.who button').forEach(b => { b.onclick = () => done(b.dataset.id!); });
  });
}

async function createPin(root: HTMLElement): Promise<void> {
  for (;;) {
    let first = '';
    await pinPad(root, { title: T.createPin, help: T.createPinHelp, onPin: async p => { first = p; return null; } });
    let mismatch = false;
    await pinPad(root, {
      title: T.repeatPin,
      onPin: async p => { if (p !== first) mismatch = true; return null; },
    });
    if (!mismatch) { await setPin(first); return; }
    // Start over, showing why.
    await new Promise<void>(r => { screen(root, `<div class="msg"><span>${T.pinMismatch}</span></div>`); setTimeout(r, 1400); });
  }
}

/** Full onboarding. `skipWelcome` when coming back after a lost key or too many PIN tries. */
export async function onboarding(root: HTMLElement, skipWelcome = false): Promise<void> {
  if (!skipWelcome) await welcome(root);
  let url = (await getMeta('apiUrl')) || BUILT_IN_API_URL;
  if (!url) { url = await askUrl(root); }
  await setMeta('apiUrl', url);
  const { key, users } = await askKey(root, url);
  const userId = await askWho(root, users);
  await createPin(root);
  await setMeta('key', key);
  await setMeta('userId', userId);
  if (!(await getMeta('persisted'))) {
    await setMeta('persisted', (await navigator.storage?.persist?.()) ?? false);
  }
}

/** The PIN lock. Resolves when unlocked; after MAX_PIN_TRIES wrong tries, runs onboarding from the key step. */
export async function unlock(root: HTMLElement): Promise<void> {
  let reset = false;
  const how = await pinPad(root, {
    title: T.enterPin,
    footer: `${T.forgotPin}<br><button data-act="usekey">${T.useKey}</button>`,
    onPin: async pin => {
      const r = await checkPin(pin);
      if (r === 'ok') return null;
      if (r === 'reset') { reset = true; return null; }
      const left = MAX_PIN_TRIES - ((await getMeta('pinTries')) ?? 0);
      return `${T.pinWrong} ${left <= 2 ? T.pinTriesLeft(left) : ''}`.trim();
    },
  });
  if (how === 'usekey') return useKeyInstead(root);
  if (reset) {
    await new Promise<void>(r => { screen(root, `<div class="msg"><span>${T.pinReset}</span></div>`); setTimeout(r, 1800); });
    await onboarding(root, true);
  }
}

/** "Entrar con la clave de la hoja" from the PIN screen. */
export async function useKeyInstead(root: HTMLElement): Promise<void> {
  await forgetCredentials();
  await onboarding(root, true);
}

// ---------- lock timer ----------
let hiddenAt = 0;
export function watchLock(onLock: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) { hiddenAt = 0; onLock(); }
  });
}
