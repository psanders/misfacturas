// Event delegation for the main screen and sheets.
import { CATS, PRIO } from '../config';
import { addMonths, r2, today, uid, ym } from '../format';
import { T } from '../i18n/es-DO';
import { balanceOf, live } from '../model';
import { compress } from '../photo';
import { isDemo, putPhoto, remove, S, save } from '../store';
import { syncNow } from '../sync';
import { getMeta } from '../db';
import type { MoveType, Prio } from '../types';
import { exportBackup, importBackup, resetDemo } from '../backup';
import { $, armed, chips, closeSheet, closeViewer, openViewer, toast } from './dom';
import { draft, editMove, editProv, newInvoice, nextInvoiceNum, renderMoveChips, showInstall, showInvoice } from './sheets';
import { jumpTo, render, setTab, ui, type Tab } from './view';

const num = (sel: string) => r2(parseFloat($<HTMLInputElement>(sel).value));
const val = (sel: string) => $<HTMLInputElement>(sel).value.trim();
const prioChips = (v: Prio, act: string) => chips(([1, 2, 3] as Prio[]).map(k => [String(k), PRIO[k].label]), String(v), act);

async function guard(fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.error(e); toast(T.tCantSave); }
}

function ago(ms: number | undefined): string {
  if (!ms) return T.never;
  const min = Math.floor((Date.now() - ms) / 60000);
  return min < 1 ? T.agoNow : min < 60 ? T.agoMin(min) : T.agoHour(Math.floor(min / 60));
}

async function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act]');
  if (!t) return;
  if (t.dataset.tab) return setTab(t.dataset.tab as Tab);
  const a = t.dataset.act!;
  const inv = draft.openInvoice ? S.facturas.find(x => x.id === draft.openInvoice) : undefined;
  switch (a) {
    case 'fab':
      if (ui.tab === 'prov') return editProv(null);
      if (ui.tab === 'caja') return editMove(null);
      if (!live(S.suplidores).length) { toast(T.tAddSupplierFirst); return setTab('prov'); }
      return newInvoice();
    case 'mprev': case 'mnext':
      ui.month = addMonths(ui.month === 'all' ? ym(today()) : ui.month, a === 'mnext' ? 1 : -1);
      return render();
    case 'mall':
      ui.month = ui.month === 'all' ? ym(today()) : 'all';
      return render();
    case 'open': return showInvoice(t.dataset.id!);
    case 'editprov': return editProv(t.dataset.id!);
    case 'editmove': return editMove(t.dataset.id!);
    case 'close': return closeSheet();
    case 'view': return openViewer((t as HTMLImageElement).src);
    case 'closeview': return closeViewer();
    case 'dprio':
      draft.prio = +t.dataset.v! as Prio;
      t.parentElement!.outerHTML = prioChips(draft.prio, 'dprio');
      return;
    case 'prio':
      if (!inv) return;
      return guard(async () => {
        await save('facturas', { ...inv, prio: +t.dataset.v! as Prio });
        toast(T.tPrio(PRIO[+t.dataset.v! as Prio].label));
        showInvoice(inv.id);
      });
    case 'half': {
      if (!inv) return;
      $<HTMLInputElement>('#pAmt').value = String(r2(balanceOf(inv, S.pagos) / 2));
      return;
    }
    case 'delpay':
      return guard(async () => {
        await remove('pagos', t.dataset.id!);
        toast(T.tPayRemoved);
        if (inv) showInvoice(inv.id);
      });
    case 'delinv':
      if (!inv || !armed(t)) return;
      return guard(async () => {
        for (const p of S.pagos.filter(p => p.factura === inv.id && !p.deleted)) await remove('pagos', p.id);
        await remove('facturas', inv.id);
        closeSheet();
        toast(T.tInvoiceDeleted);
      });
    case 'delprov': {
      const id = draft.openProv;
      if (!id) return;
      if (live(S.facturas).some(f => f.prov === id)) return toast(T.tSupplierHasInvoices);
      if (!armed(t)) return;
      return guard(async () => { await remove('suplidores', id); closeSheet(); toast(T.tSupplierDeleted); });
    }
    case 'mtype':
      draft.moveType = t.dataset.v as MoveType;
      draft.moveCat = CATS[draft.moveType][0];
      return renderMoveChips();
    case 'mcat':
      draft.moveCat = t.dataset.v!;
      return renderMoveChips();
    case 'delmove': {
      const id = draft.openMove;
      if (!id || !armed(t)) return;
      return guard(async () => { await remove('caja', id); closeSheet(); toast(T.tMoveDeleted); });
    }
    case 'syncinfo':
      if (!isDemo()) syncNow();
      return toast(T.lastSync(ago(await getMeta('lastSyncOkAt'))));
    case 'backup': return guard(async () => { await exportBackup(); toast(T.tBackupDone); });
    case 'restore': return pickRestore();
    case 'install': return showInstall();
    case 'reset':
      if (!armed(t)) return;
      return guard(resetDemo);
  }
}

async function onSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.id === 'fInv') {
    const amount = num('#iAmt');
    if (!(amount > 0)) return toast(T.tWriteAmount);
    const entered = val('#iDate') || today();
    return guard(async () => {
      const f = await save('facturas', { id: uid(), prov: val('#iProv'), num: nextInvoiceNum(), entered, amount, prio: draft.prio, photoId: '' });
      if (draft.photo) await putPhoto({ facturaId: f.id, blob: draft.photo, pending: !isDemo() });
      draft.photo = null;
      jumpTo(entered);
      if (ui.tab !== 'topay') setTab('topay');
      closeSheet();
      toast(T.tInvoiceSaved);
    });
  }
  if (form.id === 'fPay') {
    const inv = S.facturas.find(x => x.id === draft.openInvoice);
    if (!inv) return;
    const amount = num('#pAmt'), bal = balanceOf(inv, S.pagos);
    if (!(amount > 0)) return toast(T.tWriteAmount);
    if (amount > bal + 0.001) return toast(T.tTooMuch(bal));
    return guard(async () => {
      await save('pagos', { id: uid(), factura: inv.id, date: val('#pDate') || today(), amount });
      const left = balanceOf(inv, S.pagos);
      if (left <= 0) { closeSheet(); toast(T.tSettled); } else { toast(T.tPartial(left)); showInvoice(inv.id); }
    });
  }
  if (form.id === 'fProv') {
    const name = val('#vName');
    if (!name) return toast(T.tWriteName);
    const id = form.dataset.id!;
    return guard(async () => {
      await save('suplidores', { id, name, desc: val('#vDesc'), prio: draft.prio });
      closeSheet();
      toast(T.tSupplierSaved);
    });
  }
  if (form.id === 'fMove') {
    const amount = num('#mAmt');
    if (!(amount > 0)) return toast(T.tWriteAmount);
    const date = val('#mDate') || today();
    return guard(async () => {
      await save('caja', { id: draft.openMove ?? uid(), type: draft.moveType, cat: draft.moveCat, amount, date, note: val('#mNote') });
      jumpTo(date);
      closeSheet();
      toast(draft.moveType === 'in' ? T.tInSaved : T.tOutSaved);
    });
  }
}

async function onChange(e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'iProv') {
    draft.prio = S.suplidores.find(p => p.id === el.value)?.prio ?? 2;
    $('#iPrio').innerHTML = prioChips(draft.prio, 'dprio');
    return;
  }
  if ((el.id === 'pic' || el.id === 'addpic') && el instanceof HTMLInputElement && el.files?.[0]) {
    let blob: Blob;
    try { blob = await compress(el.files[0]); } catch { return toast(T.tBadPhoto); }
    if (el.id === 'pic') {
      draft.photo = blob;
      const snap = $('#snap');
      snap.querySelector('img')?.remove();
      snap.firstChild?.nodeType === Node.TEXT_NODE && snap.firstChild.remove();
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt = T.photoAlt;
      snap.prepend(img);
      return;
    }
    const inv = S.facturas.find(x => x.id === draft.openInvoice);
    if (!inv) return;
    return guard(async () => {
      await putPhoto({ facturaId: inv.id, blob, pending: !isDemo() });
      if (!isDemo()) syncNow();
      toast(T.tPhotoAdded);
      showInvoice(inv.id);
    });
  }
}

function pickRestore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) guard(async () => { toast((await importBackup(file)) ? T.tRestoreDone : T.tRestoreBad); });
  };
  input.click();
}

export function installActions(): void {
  document.addEventListener('click', e => { onClick(e); });
  document.addEventListener('submit', e => { onSubmit(e as SubmitEvent); });
  document.addEventListener('change', e => { onChange(e); });
}
