// Main screen: header, readout, tabs, month bar, list, footer, FAB (BRIEF.md §5.1–5.10).
import { PRIO } from '../config';
import { capitalize, dayLabel, esc, fmtDate, money, moneySigned, monthName, monthOnly, today, ym } from '../format';
import { T } from '../i18n/es-DO';
import {
  balanceOf, cajaSummary, dayNet, invoiceSummary, live, movesIn, olderUnpaid, paidDate, paidIn, paidOf, toPay,
} from '../model';
import { cachedPhotoUrl, isDemo, photoUrl, S } from '../store';
import { ensurePhoto, onSyncState, type SyncState } from '../sync';
import type { Factura } from '../types';
import { $ } from './dom';

export type Tab = 'topay' | 'paid' | 'prov' | 'caja';
const HASH: Record<Tab, string> = { topay: '#por-pagar', paid: '#pagadas', prov: '#suplidores', caja: '#caja' };

export const ui = {
  tab: (Object.entries(HASH).find(([, h]) => h === location.hash)?.[0] as Tab) ?? 'topay',
  month: ym(today()) as string, // 'YYYY-MM' | 'all'
};
export function setTab(t: Tab): void {
  ui.tab = t;
  history.replaceState(null, '', HASH[t]);
  render();
}
/** After saving a record dated in another month, show that month (BRIEF.md §5.4). */
export function jumpTo(date: string): void {
  if (ui.month !== 'all' && ym(date) !== ui.month) ui.month = ym(date);
}

export const LOGO = `<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="13" fill="#ff5a1f"/><path d="M14 10h20v28l-3.3-2.4-3.4 2.4-3.3-2.4-3.3 2.4-3.4-2.4L14 38z" fill="#fff"/><path d="M18 17h12M18 22h12M18 27h6" stroke="#ffb393" stroke-width="2.2" stroke-linecap="round"/><circle cx="33" cy="31" r="8" fill="#111"/><path d="m29.4 31 2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SYNC_LABEL: Record<SyncState, string> = { ok: T.syncOk, pending: T.syncPending, offline: T.syncOffline, error: T.syncError };

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `<div class="wrap">
    <header>${LOGO}<div class="t"><h1>${T.appName}</h1><p id="today"></p></div>
      <button class="sync" id="sync" data-act="syncinfo" data-s="pending" aria-label="${T.syncPending}"><i></i></button></header>
    <section class="readout" id="readout" aria-live="polite"></section>
    <nav class="tabs" role="tablist">${(Object.keys(HASH) as Tab[]).map(t => `<button role="tab" data-tab="${t}">${T.tabs[t]}</button>`).join('')}</nav>
    <div class="mbar" id="mbar"><button data-act="mprev" aria-label="${T.prevMonth}">‹</button><div class="mlab" id="mlab"></div><button data-act="mnext" aria-label="${T.nextMonth}">›</button><button class="all" data-act="mall" aria-pressed="false">${T.all}</button></div>
    <main id="list" class="list"></main>
    <p class="note" id="foot"></p>
  </div>
  <button class="fab" id="fab" data-act="fab"></button>`;
  onSyncState(s => {
    const b = $('#sync');
    b.dataset.s = s;
    b.setAttribute('aria-label', SYNC_LABEL[s]);
  });
}

const thumb = (f: Factura) => {
  const u = cachedPhotoUrl(f.id);
  return u ? `<img class="thumb" src="${u}" alt="">` : `<div class="thumb" data-photo="${f.id}">${T.noPhoto}</div>`;
};

function invoiceCard(f: Factura, rank?: number): string {
  const p = S.suplidores.find(s => s.id === f.prov);
  const paid = paidOf(f, S.pagos), bal = balanceOf(f, S.pagos), done = bal <= 0;
  const pct = Math.min(100, (paid / f.amount) * 100);
  const st = done ? `<span class="pill ok">${T.paidOn(fmtDate(paidDate(f, S.pagos)))}</span>` : paid > 0 ? `<span class="pill part">${T.partial}</span>` : '';
  return `<button class="card" data-act="open" data-id="${f.id}">${thumb(f)}
    <div><h3>${rank ? rank + '. ' : ''}${esc(p?.name ?? '—')}</h3><div class="sub">#${esc(f.num)} · ${T.entered(fmtDate(f.entered))}</div>${done ? '' : `<span class="pill ${PRIO[f.prio].cls}">${PRIO[f.prio].label}</span>`}${st}</div>
    <div class="amt">${money(done ? f.amount : bal)}<small>${done ? T.totalSmall : paid > 0 ? T.restOf(f.amount) : T.toPaySmall}</small></div>
    ${paid > 0 && !done ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</button>`;
}

export function render(): void {
  if (!document.getElementById('list')) return;
  const { tab, month } = ui;
  const per = month === 'all' ? T.perAll : T.perMonth(monthOnly(month));
  $('#today').textContent = T.todayLine(fmtDate(today()));
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#fab').textContent = T.fab[tab];
  $('#mbar').hidden = tab === 'prov';
  $('#mlab').textContent = month === 'all' ? T.allMonths : capitalize(monthName(month));
  $('#mbar .all').setAttribute('aria-pressed', String(month === 'all'));
  $('#foot').innerHTML = (isDemo() ? `${T.demoNote} <button data-act="reset">${T.resetDemo}</button><br>` : '') +
    `<button data-act="backup">${T.backup}</button>·<button data-act="restore">${T.restore}</button>·<button data-act="install">${T.howToInstall}</button>`;
  const R = $('#readout'), L = $('#list');

  if (tab === 'caja') {
    const xs = movesIn(S.caja, month), sum = cajaSummary(xs);
    R.innerHTML = `<div><div class="lab">${T.balanceLabel(per)}</div><div class="big">${moneySigned(sum.balance)}</div></div>
      <div class="split"><span>${T.inLabel} <b class="in">${money(sum.inTotal)}</b></span><span>${T.outLabel} <b class="out">${money(sum.outTotal)}</b></span></div>`;
    let h = '', last = '';
    for (const m of xs) {
      if (m.date !== last) {
        h += `<div class="grp"><span>${dayLabel(m.date)}</span><b>${moneySigned(dayNet(xs.filter(y => y.date === m.date)))}</b></div>`;
        last = m.date;
      }
      h += `<button class="card" data-act="editmove" data-id="${m.id}"><div class="ico ${m.type}">${m.type === 'in' ? '+' : '−'}</div><div><h3>${esc(m.cat)}</h3><div class="sub">${esc(m.note) || (m.type === 'in' ? T.inWord : T.outWord)}</div></div><div class="amt ${m.type}">${m.type === 'in' ? '+' : '−'} ${money(m.amount)}</div></button>`;
    }
    L.innerHTML = h || `<div class="empty">${T.emptyCaja}<br>${T.emptyCajaHint}</div>`;
    return;
  }

  const sum = invoiceSummary(S.facturas, S.pagos, month);
  R.innerHTML = `<div><div class="lab">${T.owedLabel(month === 'all' ? null : monthOnly(month))}</div><div class="big">${money(sum.owed)}</div></div>
    <div class="side">${T.urgentLabel} <b>${T.urgentCount(sum.urgent)}</b></div><div class="lab">${T.paidInLabel(per, sum.paidInMonth)}</div>`;

  if (tab === 'topay') {
    const xs = toPay(S.facturas, S.pagos, month), older = olderUnpaid(S.facturas, S.pagos, month);
    L.innerHTML = (older ? `<div class="notice"><span>${T.olderNotice(older)}</span><button data-act="mall">${T.seeAll}</button></div>` : '') +
      (xs.length ? xs.map((f, i) => invoiceCard(f, i + 1)).join('') : `<div class="empty">${T.emptyToPay}<br>${T.emptyToPayHint}</div>`);
  } else if (tab === 'paid') {
    let h = '', last = '';
    for (const f of paidIn(S.facturas, S.pagos, month)) {
      const m = monthName(ym(paidDate(f, S.pagos)!));
      if (month === 'all' && m !== last) { h += `<div class="grp"><span>${m}</span></div>`; last = m; }
      h += invoiceCard(f);
    }
    L.innerHTML = h || `<div class="empty">${T.emptyPaid}</div>`;
  } else {
    const provs = live(S.suplidores).sort((a, b) => a.id.localeCompare(b.id));
    L.innerHTML = provs.length ? provs.map(p => {
      const mine = live(S.facturas).filter(f => f.prov === p.id && balanceOf(f, S.pagos) > 0);
      const owe = mine.reduce((a, f) => a + balanceOf(f, S.pagos), 0);
      return `<button class="card" data-act="editprov" data-id="${p.id}"><div class="thumb" style="font-weight:700">${esc(p.id)}</div><div><h3>${esc(p.name)}</h3><div class="sub">${esc(p.desc) || '&nbsp;'}</div><span class="pill ${PRIO[p.prio].cls}">${PRIO[p.prio].label}</span></div><div class="amt">${owe ? money(owe) : '—'}<small>${T.pendingCount(mine.length)}</small></div></button>`;
    }).join('') : `<div class="empty">${T.emptyProv}</div>`;
  }
  hydratePhotos(L);
}

/** Fill in thumbnails asynchronously (local blob, or download once from Drive). */
function hydratePhotos(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-photo]').forEach(async el => {
    const id = el.dataset.photo!;
    const u = await photoUrl(id);
    if (u) {
      if (el.isConnected) el.outerHTML = `<img class="thumb" src="${u}" alt="">`;
      return;
    }
    const f = S.facturas.find(x => x.id === id);
    if (f?.photoId) ensurePhoto(id, f.photoId); // store emits a change when it lands → re-render
  });
}
