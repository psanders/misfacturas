// Boot: open the right database, run onboarding or the PIN lock, then mount the app and start syncing.
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { loadSeed } from './backup';
import { hasCredentials } from './auth';
import { db, dbName, getMeta, openDb, setMeta } from './db';
import { T } from './i18n/es-DO';
import { load, onChange, S, setDemo } from './store';
import { setOnAuthLost, startSync, syncNow } from './sync';
import { installActions } from './ui/actions';
import { closeSheet, closeViewer, installGlobalHandlers } from './ui/dom';
import { onboarding, unlock, watchLock } from './ui/gate';
import { mountApp, render } from './ui/view';

const root = document.getElementById('root')!;
const demo = new URLSearchParams(location.search).has('demo');

/** `#setup=<script url>` fills in the Apps Script URL (never the password), then is removed from the address bar. */
async function readSetupLink() {
  const m = /^#setup=(.+)$/.exec(location.hash);
  if (!m) return;
  const url = decodeURIComponent(m[1]);
  if (/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) await setMeta('apiUrl', url);
  history.replaceState(null, '', location.pathname + location.search);
}

let gateBusy = false;
/** Show a gate (onboarding / PIN) in place of the app, then bring the app back. */
async function gate(run: () => Promise<void>) {
  if (gateBusy) return;
  gateBusy = true;
  closeSheet();
  closeViewer();
  try {
    await run();
  } finally {
    gateBusy = false;
  }
  showApp();
}

function showApp() {
  mountApp(root);
  render();
}

async function boot() {
  setDemo(demo);
  await openDb(dbName(demo));
  installGlobalHandlers();
  installActions();
  onChange(render);

  if (demo) {
    if (!(await (await db()).count('suplidores'))) await loadSeed();
    else await load();
    startSync();
    showApp();
    return;
  }

  await readSetupLink();
  await load();
  setOnAuthLost(() => gate(() => onboarding(root, true)));
  watchLock(() => gate(() => unlock(root)));

  if (await hasCredentials()) {
    await gate(() => unlock(root));
  } else {
    await gate(async () => {
      await onboarding(root);
      root.innerHTML = `<div class="gate"><p class="help">${T.loading}</p></div>`;
      await syncNow();
    });
  }
  startSync();
  if (!S.suplidores.length && !(await getMeta('lastSync'))) syncNow();
}

registerSW({ immediate: true });
boot().catch(e => {
  console.error(e);
  root.innerHTML = `<div class="gate"><p class="help">${T.tCantSave}</p></div>`;
});
