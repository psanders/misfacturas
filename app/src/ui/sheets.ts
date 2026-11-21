// Bottom sheets (BRIEF.md §5.7–5.10). Forms are rebuilt from state; handlers live in actions.ts.
import { CATS, PRIO } from '../config';
import { esc, fmtDate, money, nextCode, today } from '../format';
import { T } from '../i18n/es-DO';
import { balanceOf, live, paidDate, paymentsOf } from '../model';
import { photoUrl, S } from '../store';
import { ensurePhoto } from '../sync';
import type { MoveType, Prio } from '../types';
import { $, chips, openSheet, sheetHead } from './dom';

const prioOpts = (): [string, string][] => ([1, 2, 3] as Prio[]).map(k => [String(k), PRIO[k].label]);

/** Draft values that chips edit before the form is saved. */
export const draft = {
  prio: 2 as Prio,
  photo: null as Blob | null,
  moveType: 'in' as MoveType,
  moveCat: CATS.in[0] as string,
  openInvoice: null as string | null,
  openMove: null as string | null,
  openProv: null as string | null,
};

export const nextInvoiceNum = () => nextCode('F', S.facturas.map(f => f.num));
export const nextProvId = () => nextCode('P', S.suplidores.map(p => p.id));

export function newInvoice(): void {
  const provs = live(S.suplidores);
  draft.photo = null;
  draft.prio = provs[0].prio;
  openSheet(sheetHead(T.newInvoice, T.invoiceNo(nextInvoiceNum())) + `<form id="fInv" novalidate>
    <span class="lbl">${T.photoLabel}</span><label class="snap" id="snap">${T.takePhoto}<input type="file" accept="image/*" capture="environment" id="pic"></label>
    <label for="iProv">${T.supplier}</label><select id="iProv" required>${provs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <label for="iAmt">${T.amountRD}</label><input id="iAmt" type="number" inputmode="decimal" step="0.01" min="0.01" required>
    <label for="iDate">${T.enteredDate}</label><input id="iDate" type="date" value="${today()}" required>
    <span class="lbl">${T.priority}</span><div id="iPrio">${chips(prioOpts(), String(draft.prio), 'dprio')}</div>
    <button class="btn">${T.saveInvoice}</button></form>`);
}

export async function showInvoice(id: string): Promise<void> {
  const f = S.facturas.find(x => x.id === id && !x.deleted);
  if (!f) return;
  draft.openInvoice = id;
  const p = S.suplidores.find(s => s.id === f.prov);
  const bal = balanceOf(f, S.pagos), pays = paymentsOf(f, S.pagos);
  const src = await photoUrl(f.id);
  if (!src && f.photoId) ensurePhoto(f.id, f.photoId).then(() => { if (draft.openInvoice === id && $('#shade').classList.contains('on')) showInvoice(id); });
  const keepScroll = $('#sheet').scrollTop;
  openSheet(sheetHead(esc(p?.name ?? '—'), T.invoiceNo(esc(f.num))) +
    (src ? `<img class="photo" src="${src}" alt="${T.photoAlt}" data-act="view">`
      : `<label class="snap">${T.addPhoto}<input type="file" accept="image/*" capture="environment" id="addpic"></label>`) +
    `<div class="facts"><div><span>${T.factAmount}</span><b>${money(f.amount)}</b></div><div><span>${T.factOwed}</span><b style="color:${bal > 0 ? 'var(--red)' : 'var(--grn)'}">${money(Math.max(bal, 0))}</b></div>
    <div><span>${T.factEntered}</span><b>${fmtDate(f.entered)}</b></div><div><span>${T.factSettled}</span><b>${fmtDate(paidDate(f, S.pagos))}</b></div></div>
    ${bal > 0 ? `<span class="lbl">${T.priority}</span>${chips(prioOpts(), String(f.prio), 'prio')}
    <form id="fPay" novalidate><div class="row"><div><label for="pAmt">${T.payAmount}</label><input id="pAmt" type="number" inputmode="decimal" step="0.01" min="0.01" max="${bal}" value="${bal}" required></div>
    <div><label for="pDate">${T.payDate}</label><input id="pDate" type="date" value="${today()}" required></div></div>
    <div class="row"><button class="btn ghost" type="button" data-act="half">${T.payHalf}</button><button class="btn">${T.registerPay}</button></div></form>` : ''}
    <span class="lbl">${T.paymentsTitle(pays.length)}</span>
    ${pays.length ? `<ul class="pays">${pays.map(x => `<li><span>${fmtDate(x.date)}</span><b>${money(x.amount)}</b><button data-act="delpay" data-id="${x.id}" aria-label="${T.removePay}">×</button></li>`).join('')}</ul>`
      : `<div class="subt">${T.noPayments}</div>`}
    <button class="btn danger" data-act="delinv">${T.deleteInvoice}</button>`, () => { draft.openInvoice = null; });
  $('#sheet').scrollTop = keepScroll;
}

export function editProv(id: string | null): void {
  const p = id ? S.suplidores.find(x => x.id === id) : undefined;
  draft.openProv = p?.id ?? null;
  draft.prio = p?.prio ?? 2;
  const nid = p?.id ?? nextProvId();
  openSheet(sheetHead(p ? T.editSupplier : T.newSupplier, T.supplierId(nid)) + `<form id="fProv" data-id="${nid}" novalidate>
    <label for="vName">${T.name}</label><input id="vName" required value="${esc(p?.name)}" autocomplete="off">
    <label for="vDesc">${T.description}</label><textarea id="vDesc">${esc(p?.desc)}</textarea>
    <span class="lbl">${T.usualPrio}</span><div id="vPrio">${chips(prioOpts(), String(draft.prio), 'dprio')}</div>
    <button class="btn">${T.saveSupplier}</button></form>${p ? `<button class="btn danger" data-act="delprov">${T.deleteSupplier}</button>` : ''}`,
  () => { draft.openProv = null; });
}

export function editMove(id: string | null): void {
  const m = id ? S.caja.find(x => x.id === id) : undefined;
  draft.openMove = m?.id ?? null;
  draft.moveType = m?.type ?? 'in';
  draft.moveCat = m?.cat ?? CATS[draft.moveType][0];
  openSheet(sheetHead(m ? T.editMove : T.newMove) + `<form id="fMove" novalidate>
    <span class="lbl">${T.whatKind}</span><div id="mType"></div>
    <span class="lbl">${T.kind}</span><div id="mCat"></div>
    <div class="row"><div><label for="mAmt">${T.amountRD}</label><input id="mAmt" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${m?.amount ?? ''}"></div>
    <div><label for="mDate">${T.date}</label><input id="mDate" type="date" required value="${m?.date ?? today()}"></div></div>
    <label for="mNote">${T.noteOptional}</label><input id="mNote" autocomplete="off" placeholder="${T.notePlaceholder}" value="${esc(m?.note)}">
    <button class="btn">${T.save}</button></form>${m ? `<button class="btn danger" data-act="delmove">${T.deleteMove}</button>` : ''}`,
  () => { draft.openMove = null; });
  renderMoveChips();
}

export function renderMoveChips(): void {
  $('#mType').innerHTML = chips([['in', T.moveIn], ['out', T.moveOut]], draft.moveType, 'mtype');
  const cats = [...CATS[draft.moveType]] as string[];
  if (!cats.includes(draft.moveCat)) cats.push(draft.moveCat); // keep a category that was removed from config
  $('#mCat').innerHTML = chips(cats.map(c => [c, c]), draft.moveCat, 'mcat');
}

export function showInstall(): void {
  openSheet(sheetHead(T.installTitle) + `<ol class="steps">${T.installSteps.map(s => `<li>${s}</li>`).join('')}</ol>`);
}
