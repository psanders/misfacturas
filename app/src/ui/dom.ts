// Shared DOM helpers: toast, bottom sheet, photo viewer, two-tap confirm.
import { T } from '../i18n/es-DO';
import { esc } from '../format';

export const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<E>(sel)!;

let toastT: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

let onSheetClose: (() => void) | null = null;
export function openSheet(html: string, onClose?: () => void): HTMLElement {
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  $('#shade').classList.add('on');
  document.body.style.overflow = 'hidden';
  onSheetClose = onClose ?? null;
  sheet.scrollTop = 0;
  (sheet.querySelector<HTMLElement>('[autofocus]') ?? sheet.querySelector<HTMLElement>('.x'))?.focus({ preventScroll: true });
  return sheet;
}
export function closeSheet(): void {
  $('#shade').classList.remove('on');
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
  const fn = onSheetClose;
  onSheetClose = null;
  fn?.();
}
export const sheetOpen = () => $('#shade').classList.contains('on');

export const sheetHead = (title: string, sub?: string) =>
  `<div class="top"><div><h2>${title}</h2>${sub ? `<div class="subt">${sub}</div>` : ''}</div><button type="button" class="x" data-act="close" aria-label="${T.close}">×</button></div>`;

export function openViewer(src: string): void {
  $<HTMLImageElement>('#viewImg').src = src;
  $<HTMLImageElement>('#viewImg').alt = T.photoAlt;
  $('#viewer').classList.add('on');
}
export const closeViewer = () => $('#viewer').classList.remove('on');

/** Two-tap destructive buttons (BRIEF.md §5.7): first tap arms for 3 s. Returns true on the confirming tap. */
export function armed(btn: HTMLElement): boolean {
  if (btn.dataset.armed) return true;
  const label = btn.textContent ?? '';
  btn.dataset.armed = '1';
  btn.textContent = T.tapAgain;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = label; } }, 3000);
  return false;
}

export const chips = (opts: [string, string][], value: string, act: string) =>
  `<div class="chips">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(l)}</button>`).join('')}</div>`;

// Global close handlers: backdrop tap and Escape.
export function installGlobalHandlers(): void {
  $('#shade').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#viewer').classList.contains('on')) closeViewer();
    else if (sheetOpen()) closeSheet();
  });
  $('#viewer').addEventListener('click', () => closeViewer());
}
