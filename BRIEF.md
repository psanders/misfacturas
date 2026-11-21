# Mis Facturas — Build Brief

> A tiny bill-paying and daily-cash app for a small Dominican family business.
> The primary user is the owner's mother: not technical, uses an iPad. One employee needs read access.
> This brief is meant to be enough to rebuild the app from scratch. A working single-file prototype is
> included next to this file as `prototype.html`. Treat it as the **reference for look, copy and behavior**.
> Treat this brief as the reference for **architecture, data and sync**.

---

## 1. Goals and non-goals

**Goals**
- Keep a list of **suplidores** (suppliers).
- Each month, record the suppliers' **facturas** (invoices), each with a photo of the paper invoice.
- Pay invoices **in order of priority**, in full or in partial payments (**abonos**).
- Record the business's **daily cash movements** (Caja): the day's sales in, and payments out (taxes, electricity, salaries…).
- **Filter by month** to see that month's invoices, payments and cash.
- **Sync across devices** through Google Sheets, so an employee can see the data (read-only).
- Installable as a **PWA** on iPad and iPhone (Add to Home Screen) and usable on a desktop browser. No App Store.
- Free to run: no paid services.

**Non-goals (v1)**
- No accounting, no taxes calculated, no electronic invoicing (e-CF / DGII), no bank connections.
- No multi-business or multi-currency support. Currency is always **RD$**.
- No OCR of invoices (possible v2).
- No roles: every person who uses the app can read and change everything.
- No real authentication. The sheet password is the shared key; the PIN only locks the app on one device (see §7).

---

## 2. Users

| User | Device | Needs |
|---|---|---|
| Mamá (owner/operator) | iPad (main), maybe phone | Big, simple screens in Spanish. Snap a photo, enter an amount, tap "pay". |
| Admin (her son) | Desktop/phone | Sets things up, fixes data, backs it up. |
| Cousin (employee) | Phone or desktop | Same as the admin: records invoices, payments and cash. |

All UI text is in **Dominican Spanish** (`lang="es-DO"`). Use local terms: *suplidor*, *abono*, *fiao*, *quincena*, *ITBIS*, *colmado*, *la luz*.

---

## 3. Recommended tech

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + vanilla TypeScript** (or Preact if components help). No heavy framework. | Small, fast on an old iPad, easy for any agent to maintain. |
| PWA | `vite-plugin-pwa` (Workbox): manifest, offline app shell, icons, iOS meta tags | Add to Home Screen, works offline. |
| Local storage | **IndexedDB** (via `idb` or Dexie): records + photo blobs + an outbox queue | Survives offline. localStorage is too small for photos. |
| Backend / DB | **Google Sheets** (one spreadsheet, one tab per table) | Free, the family already uses Google, and the employee can read the Sheet directly. |
| API | **Google Apps Script Web App** bound to the Sheet (`doGet` / `doPost`) | Free, no server to run. |
| Photos | **Google Drive folder**, uploaded through the Apps Script (base64 → `DriveApp.createFile`) | The Sheet stores the file ID + a view URL. |
| Hosting | **GitHub Pages** or **Netlify** (static) | Free HTTPS, which PWAs require. |
| Fonts | Google Fonts **Geist** (400/500/600/700), fallback `system-ui, -apple-system, sans-serif` | Matches the prototype. |

**Apps Script gotchas (important)**
- Send `POST` with `Content-Type: text/plain;charset=utf-8` and a JSON body. This avoids the CORS preflight, which Apps Script can't answer. Parse it with `JSON.parse(e.postData.contents)`.
- Deploy as: *Execute as: Me*, *Who has access: Anyone*. Protect it with the **sheet password** (see §7), because the URL is otherwise open.
- Use `LockService.getScriptLock()` around writes to avoid race conditions.
- Apps Script quotas (~20k URL fetches/day, 6-minute execution limit) are far above this app's needs.

---

## 4. Data model

Every record has: `id` (string, client-generated, e.g. `crypto.randomUUID()`), `updatedAt` (ISO timestamp, set by the client on every change), `deleted` (boolean, soft delete for sync), and **`createdBy` / `updatedBy`** (the `usuarios.id` of the person who created / last changed it). The Apps Script stamps `createdBy`/`updatedBy` from the request's `userId`, ignoring whatever the record itself says. These fields are **never shown in the app**; they exist only in the Sheet.

### 4.1 `suplidores` (Sheet tab: **Suplidores**)
| Field | Type | Notes |
|---|---|---|
| id | string | Display ID `P-001`, `P-002`… (zero-padded, next = max+1). Keep a separate `uuid` if you want; `P-xxx` is what she sees. |
| name | string | required |
| desc | string | optional ("La luz de la casa · contrato 44-7182") |
| prio | 1 \| 2 \| 3 | Usual priority: 1 Urgente, 2 Normal, 3 Puede esperar. This is the default for new invoices. |

A supplier **cannot be deleted while it has invoices**. Show the toast "Este suplidor todavía tiene facturas".

### 4.2 `facturas` (Sheet tab: **Facturas**)
| Field | Type | Notes |
|---|---|---|
| id | string | |
| prov | string | supplier id |
| num | string | **Assigned automatically**: `F-001`, `F-002`… (zero-padded, next = max+1, same rule as suppliers). There is no input for it. The number printed on the paper invoice stays in the photo. If two offline devices both create the same `num`, the Apps Script keeps the first one it receives and renumbers the later one to max+1 on push; the device gets the new number on the next pull. |
| entered | date `YYYY-MM-DD` | "Fecha de entrada". Defaults to today. **This decides which month the invoice belongs to.** |
| amount | number (2 decimals) | > 0 |
| prio | 1 \| 2 \| 3 | defaults from the supplier, can be changed on the invoice |
| photoId | string \| null | Drive file id |
| photoUrl | string \| null | thumbnail/view URL |

### 4.3 `pagos` (Sheet tab: **Pagos**): payments against invoices
| Field | Type | Notes |
|---|---|---|
| id | string | |
| factura | string | invoice id |
| date | date | "Fecha de pago", defaults to today |
| amount | number | > 0 and ≤ remaining balance |

**Derived, never stored:** `paid = Σ payments`, `balance = amount − paid`. Status: *Pendiente* (paid = 0), *Abonada* (0 < paid < amount), *Pagada* (balance ≤ 0). **Paid-on date** = date of the last payment once balance ≤ 0. Round money to cents (`Math.round(x*100)/100`) at every step.

### 4.4 `caja` (Sheet tab: **Caja**): daily business cash movements, separate from invoices
| Field | Type | Notes |
|---|---|---|
| id | string | |
| type | `in` \| `out` | Entrada (ingreso) / Salida (pago) |
| cat | string | `in`: **Venta del día**, **Otro ingreso**. `out`: **Impuestos**, **Luz**, **Agua**, **Salarios**, **Alquiler**, **Mercancía**, **Otro gasto** |
| amount | number | > 0 |
| date | date | defaults to today |
| note | string | optional ("Quincena", "ITBIS", "Pedido al distribuidor") |

Keep categories in a config constant so they're easy to change later. **Invoice payments do NOT create Caja movements** (owner's decision). Leave a code comment noting that this could be linked later.

### 4.5 `usuarios` (Sheet tab: **Usuarios**): the people who use the app
| Field | Type | Notes |
|---|---|---|
| id | string | Short and stable, e.g. `U-001`. This is what goes in `createdBy` / `updatedBy`. |
| name | string | What onboarding shows: "Mamá", "[admin's name]", "[cousin's name]". |
| active | boolean | `FALSE` removes the person from onboarding and makes the server reject their writes. Existing rows keep their id. |

The admin adds rows by hand in the Sheet; the app never creates or edits users. **No PIN is stored here**: PINs live only on each device (§7).

### 4.6 `historial` (Sheet tab: **Historial**): append-only change log
| Field | Type | Notes |
|---|---|---|
| at | ISO timestamp | Server time when the change was applied |
| userId | string | `usuarios.id` |
| table | string | `suplidores` \| `facturas` \| `pagos` \| `caja` |
| recordId | string | |
| op | string | `create` \| `update` \| `delete` \| `photo` |

The Apps Script appends one row for every write it accepts (not for writes ignored by last-write-wins). Never edited or read by the app. It keeps the history that `updatedBy` alone would overwrite.

### 4.7 Sheet layout
- One spreadsheet named **"Mis Facturas — Datos"**, with tabs `Suplidores`, `Facturas`, `Pagos`, `Caja`, `Usuarios` and `Historial`.
- Row 1 holds the headers, exactly the field names above plus `updatedAt`, `deleted`, `createdBy` and `updatedBy` on the four data tabs.
- Optional read-only helper tab `Resumen`, using formulas (owed per supplier, cash per month).
- Format the amount columns as `"RD$ "#,##0.00` and the date columns as dates.

---

## 5. Features and screens

Single page, mobile-first, max content width 720px, centered on desktop.

### 5.1 Header
- Logo (§8.3) + app name **"Mis Facturas"** + subtitle **"Hoy: 21 nov 2026"** (today, `es-DO` short date).

### 5.2 Summary box (black "readout" card under the header; it changes by tab and month)
- **Invoice tabs:** label "Falta por pagar · facturas de {mes}" and a big amount (sum of the balances of unpaid invoices entered in the selected month). Then "Urgentes: **N facturas**" in orange, and "Pagado en {mes}: RD$ X" (sum of the payments dated in that month).
- **Caja tab:** "Balance en {mes}" with a big amount (entries − exits, prefixed "− " if negative), then "Entradas: RD$ X" (green) and "Salidas: RD$ Y" (orange/red).
- With **Todos** (all months) selected, use "en total" instead of "en {mes}".

### 5.3 Tabs (segmented control)
**Por pagar · Pagadas · Suplidores · Caja**. The active tab is filled orange.

### 5.4 Month bar (hidden on Suplidores)
`‹  Noviembre de 2026  ›  [Todos]`. The arrows move one month; **Todos** toggles "all months". The default is the current month. Adding a record dated in another month jumps the filter to that month.

### 5.5 Por pagar
- Unpaid invoices **entered in the selected month**, sorted by **priority asc, then entered date asc**, and numbered "1. 2. 3." (that's the payment order).
- If older months still have unpaid invoices, show the notice: "Hay N facturas pendientes de meses anteriores." with a **Ver todas** button, which switches to Todos.
- Card: photo thumbnail (56px), "{n}. {Supplier}", "#{num} · entró {date}", a priority pill, an "Abonada" pill if partly paid, the amount on the right ("a pagar", or "resta de RD$ total"), and a green progress bar when partly paid.
- Empty: "No hay facturas pendientes de este mes. 🎉 Toque “+ Factura” para agregar una."

### 5.6 Pagadas
- Invoices whose paid-on date falls in the selected month, newest first. The card has a green pill "Pagada {date}" and shows the total. With Todos, group them under month headers.

### 5.7 Invoice detail (bottom sheet)
- Title: supplier name; subtitle "Factura #num".
- The photo, large; tap for a full-screen viewer. If there's no photo: a "📷 Agregar una foto" picker.
- A 2×2 facts grid: Monto · Se debe (red/green) · Entró · Saldada el.
- If not fully paid:
  - Priority chips (Urgente / Normal / Puede esperar), which save on tap.
  - Payment form: "Monto a pagar" (pre-filled with the full balance), "Fecha de pago" (today), and the buttons **Pagar la mitad** and **Registrar pago**.
  - Validation: amount > 0 and ≤ balance. Otherwise show "Eso es más de lo que se debe (RD$ X)".
  - Toasts: "¡Saldada! ✓" or "Abono guardado — faltan RD$ X".
- A "Pagos y abonos (n)" list of date + amount, each with × to remove it.
- **Borrar factura**, which needs two taps ("Toque otra vez para borrar", resets after 3s).

### 5.8 New invoice (bottom sheet, from the "+ Factura" FAB)
- A photo picker first: `<input type="file" accept="image/*" capture="environment">`, labeled "📷 Tomar o elegir una foto", with a preview after it's picked.
- The sheet title is "Nueva factura" with the subtitle "Factura #F-010" (the next automatic number, §4.2).
- Suplidor (select; changing it resets the priority to the supplier's default), Monto (RD$), Fecha de entrada, Prioridad chips, **Guardar factura**. There is no invoice-number field.
- **Compress photos on the client** before storing/uploading: longest side 1100px, JPEG quality 0.72 (canvas). Handle HEIC from iOS (the browser normally converts it on pick).

### 5.9 Suplidores
- Cards: ID badge (P-001), name, description, usual-priority pill, and on the right the amount owed + "N pendientes". Tap to edit.
- "+ Suplidor" FAB → sheet: Nombre, Descripción, Prioridad usual, **Guardar suplidor**, plus **Borrar suplidor** when editing (blocked if it has invoices).

### 5.10 Caja
- Movements in the selected month, grouped by day. Each day header shows the date ("miércoles, 18 nov") and the day's net total.
- Card: round icon (+ green for in, − red for out), category, note (or "Entrada"/"Salida"), and a signed amount colored green or red.
- "+ Movimiento" FAB → sheet: "¿Qué está anotando?" chips **Entrada (ingreso)** / **Salida (pago)** → "Tipo" category chips (which change with the type) → Monto, Fecha, "Nota (opcional)" (placeholder "Ej.: quincena, ITBIS, pedido…") → **Guardar**. In edit mode, also **Borrar movimiento** (two taps).
- Empty: "No hay movimientos este mes. Toque “+ Movimiento” para anotar la venta del día."

### 5.11 Onboarding (once per device) and PIN lock
Designs: `mis-facturas.nib` (PIN screens). All full-screen, centered, logo on top, the app's big-button style.
1. **Bienvenida:** "Mis Facturas" + one sentence + **Empezar**. If the Apps Script URL is not built in and was not given by a setup link, ask for it here (admin-only case).
2. **Clave de la hoja:** a password field "Clave de la hoja" + **Continuar**. The app calls `verify`; wrong → "Esa clave no es. Pregúntele a quien le instaló la app." Offline → "Necesita internet para la primera vez."
3. **¿Quién es usted?** Big buttons, one per active row of `Usuarios` (returned by `verify`).
4. **Cree su PIN:** 4 digits on the keypad, then "Repita su PIN". Mismatch → "No son iguales. Intente otra vez." and start over.
5. Done → first full pull, then the main screen. Call `navigator.storage.persist()` here.

**PIN lock screen** ("Escriba su PIN para entrar", 4 dots, keypad, "¿Olvidó su PIN? Pídale ayuda a quien le instaló la app."):
- Shown when the app starts, and when it comes back after **more than 5 minutes** in the background (`visibilitychange`; store the hidden-at time).
- Wrong PIN → the dots turn red, "Ese PIN no es. Intente otra vez." After **5 wrong tries in a row**, the device forgets the PIN and goes back to step 2 (sheet password, then a new PIN). Local data stays; only the PIN is reset.
- Forgot the PIN = same path: the link under the keypad offers "Entrar con la clave de la hoja", which goes to step 2.
- Sync keeps running while the lock screen is up; the lock is only for the UI.

### 5.12 General UX rules
- Touch targets ≥ 44px; inputs ≥ 16px font (prevents iOS zoom) and min-height 48px.
- Bottom sheets slide up (0.22s) and close with ×, a tap on the backdrop, or Escape. Respect `prefers-reduced-motion`.
- Toasts appear at the bottom center and disappear after 2.2s.
- Numbers: `RD$ 1,234.56` (en-US grouping, which is what's used in the DR). Dates: `es-DO` (`3 nov 2026`).
- Never use `alert/confirm/prompt`. Confirm deletes with the two-tap pattern.
- Light and dark mode via `color-scheme` + `light-dark()`.
- A footer link **"Respaldo"** (backup) exports all data as JSON + a ZIP of the photos. There's also an import for restoring.

---

## 6. Sync design (offline-first)

1. **IndexedDB is the source of truth for the UI.** Every change writes locally first and then appends an operation to an **outbox** (`{op:'upsert'|'delete', table, record}`).
2. A **sync worker** (in-page, triggered on change, on `online`, on app focus, and every 60s while visible) does this:
   - **Push:** sends the outbox in one `POST {action:'push', key, userId, ops:[…]}`. The Apps Script upserts by `id`. **Last-write-wins on `updatedAt`**: the server ignores a write older than the stored row. Clear the ops once acknowledged.
   - **Pull:** `POST {action:'pull', key, since:<lastSyncISO>}` returns rows from all tables with `updatedAt > since`. Merge them locally with the same LWW rule. Store the server's `now` as the new `lastSync`.
   - **Photos:** uploaded separately (`POST {action:'photo', key, userId, facturaId, mime, base64}` → `{photoId, photoUrl}`), then the invoice is upserted with the IDs. Keep the local blob until the upload succeeds, and queue the upload if offline.
3. Show the sync state discreetly in the header: a dot that's green (synced), orange (pending) or grey (offline). Tapping it shows "Última sincronización: hace 2 min".
4. Deletes are soft (`deleted=true`) so they propagate. They can be purged from the Sheet after 90 days.
5. Use the server clock for `since` to avoid problems with device clock skew. Clients set `updatedAt` with their own clock; that's acceptable for 2–3 users.

### Apps Script endpoints (sketch; **`docs/API.md` is the exact contract**: everything is a POST, errors are `{ok:false,error}`, pull filters on a server-stamped `syncedAt`)
```
POST {action:'verify', key}                                  -> {ok:true, users:[{id,name}]} | {ok:false, error:"bad_key"}
POST {action:'pull', key, since}                             -> {now, suplidores:[], facturas:[], pagos:[], caja:[], usuarios:[]}
POST {action:'push', key, userId, ops:[{op, table, record}]} -> {ok:true, now, renumbered:[{id,num}]}
POST {action:'photo', key, userId, facturaId, mime, base64}  -> {photoId, photoUrl}
POST {action:'getPhoto', key, id}                            -> base64 image (for devices that need to download it)
```
- Every call checks `key`; push/photo also check that `userId` is an active row of `Usuarios`, then stamp `createdBy`/`updatedBy` and append to `Historial`.
- Look up rows by keeping an `id → row` map per tab (read the whole tab; it's small).
- Photos go to the Drive folder "Mis Facturas — Fotos". Name files `{YYYY-MM}_{supplier}_{num}.jpg`.
- Serving the image: the Drive thumbnail URL `https://drive.google.com/thumbnail?id=ID&sz=w1000` only works if the file is shared. The safer option is the `photo` endpoint returning base64, cached in IndexedDB.

---

## 7. Access and security

Two layers, both deliberately simple. The threat model is "someone finds the iPad" or "someone finds the script URL", not a determined attacker.

**1. Sheet password (the real key)**
- One shared password, stored in the Apps Script's **Script Properties** as `SHEET_KEY`. Not in a Sheet cell: anyone the Sheet is shared with could read a cell.
- Entered once per device during onboarding (§5.11), checked by `verify`, then kept on the device in IndexedDB (`meta.key`). Not cookies: cookies are not sent to `script.google.com` from the app's origin, and a home-screen app on iOS has its own storage anyway.
- Sent with every API call. A wrong key → `bad_key` error → the app forgets the key and the PIN and goes back to onboarding step 2.
- Changing it = editing Script Properties. Every device then gets `bad_key` and asks for the new password once.
- An optional setup link `https://…/#setup=<url>` can fill in the Apps Script URL; it never carries the password. The app clears it from the address bar after reading it.

**2. PIN (a lock on this device only)**
- 4 digits, chosen per person **per device**; never sent to the server, never stored in the Sheet.
- Stored as `PBKDF2(pin, randomSalt, 100k iterations, SHA-256)` in IndexedDB (`meta.pinHash`, `meta.pinSalt`), with `meta.userId`. Checked locally, so it works offline.
- Rules for when it is asked and what happens after 5 wrong tries: §5.11.

**Who changed what**
- Each device sends its `userId` with push/photo; the server stamps `createdBy`/`updatedBy` and logs to `Historial` (§4.5, §4.6). The app never displays it.

**Known limits (accepted)**
- Identity is trust-based: anyone with the sheet password can pick any name in onboarding.
- A 4-digit PIN hash on the device can be brute-forced by someone who copies the device's storage. It only protects the UI.
- Anyone with the script URL **and** the password can read and write. Keep both inside the family.

---

## 8. Branding

### 8.1 Personality
Calm, large, kind: a tool a mother uses once a month without help. The concept is a paper bill spike or receipt drawer turned into a priority queue. Warm, not corporate. No emoji in the UI except 📷 on the photo picker and 🎉 on the empty state.

### 8.2 Colors (CSS variables, light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#eceded` (aluminium) | `#141517` | page |
| `--card` | `#ffffff` | `#1f2023` | cards, inputs |
| `--ink` | `#111111` | `#f1f1f1` | text; the summary box background (inverted) |
| `--mut` | `#62656b` | `#a3a6ad` | secondary text |
| `--line` | `#d9dadd` | `#2e3034` | borders |
| `--soft` | `#f5f5f6` | `#26272b` | placeholders, bar track |
| `--acc` | `#ff5a1f` | `#ff5a1f` | brand orange: active tab, FAB, primary buttons |
| `--red` | `#d1261b` | `#ff6b5e` | Urgente, owed, outflows |
| `--amb` | `#a86400` | `#f0b04a` | Normal priority |
| `--grn` | `#18794e` | `#4cc38a` | paid, inflows, progress |
| summary accent | `#ff8a5c` | | "Urgentes" line on the black box |

Pills use the color at 16–18% alpha (`color-mix`) as the background with the full color as text. The FAB shadow is `0 8px 24px rgba(255,90,31,.4)`. Theme color: `#ff5a1f`.

### 8.3 Logo
The finished app icons (iOS light/dark/tinted, Android adaptive layers, PWA any/maskable) are in `icons/`, previewed in `mis-facturas.nib`. Use those files; don't re-export from this SVG.
Orange rounded square, white receipt with a torn zig-zag bottom, light-orange text lines, and a black check badge:
```svg
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="13" fill="#ff5a1f"/>
  <path d="M14 10h20v28l-3.3-2.4-3.4 2.4-3.3-2.4-3.3 2.4-3.4-2.4L14 38z" fill="#fff"/>
  <path d="M18 17h12M18 22h12M18 27h6" stroke="#ffb393" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="33" cy="31" r="8" fill="#111"/>
  <path d="m29.4 31 2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```


### 8.4 Type
Geist. Title 26px/700; the big summary figure is `clamp(32px, 9vw, 48px)`/700; card titles 17px/600; body 17px; meta and labels 13–14px. Labels use sentence case. No all-caps eyebrows.

### 8.5 Shapes
Cards: radius 16, 1px border, padding 12. Summary box: radius 20. Bottom sheet: radius 22 at the top. Tabs: a 14px-radius container with 10px-radius buttons. FAB: a 60px-tall pill, fixed bottom-right (aligned to the 720px column on desktop).

---

## 9. PWA details

- `manifest.webmanifest`: `name: "Mis Facturas"`, `short_name: "Facturas"`, `lang: "es-DO"`, `display: "standalone"`, `background_color: "#eceded"`, `theme_color: "#ff5a1f"`, `start_url: "./"`, plus the icons above.
- iOS: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: default`, `apple-touch-icon`. Use `env(safe-area-inset-*)` padding when the viewport has `viewport-fit=cover`.
- Call `navigator.storage.persist()` on first run so that iOS/Safari is less likely to evict data. The Sheets sync is the real backup either way.
- A service worker precaches the app shell. API calls are network-only (the outbox handles offline).
- Include a short Spanish "Cómo instalar" screen: Safari → Compartir → "Agregar a pantalla de inicio".

---

## 10. Seed / demo data

Provide a "Cargar datos de ejemplo" (load sample data) option, available only when the database is empty or in a `?demo` mode. Dates are relative to the current month.

**Suplidores**
| id | name | desc | prio |
|---|---|---|---|
| P-001 | Compañía de Luz | La luz de la casa · contrato 44-7182 | 1 |
| P-002 | Acueducto | Servicio de agua | 1 |
| P-003 | Teléfono e Internet | Internet y teléfono fijo de la casa | 2 |
| P-004 | Farmacia Central | Medicinas del mes, a crédito | 1 |
| P-005 | Colmado Don Pepe | Lo fiao del mes | 2 |
| P-006 | Don José (jardinero) | Jardín, dos veces al mes | 3 |

**Facturas** (day of month, month offset, amount, payments)
The codes below (E-0093381…) are the numbers printed on the demo photos. The `num` field gets `F-001`…`F-009` in order of entry date (oldest first), as in the designs.
- P-001 E-0093381, day 3, this month, 4,850.00, unpaid
- P-004 FC-2211, day 5, this month, 7,320.50, paid 3,000 on day 10
- P-002 W-55120, day 4, this month, 1,260.00, unpaid
- P-003 PI-118842, day 2, this month, 2,995.00, unpaid
- P-005 CDP-0412, day 6, this month, 5,480.00, paid 2,000 on day 10
- P-006 JOSE-11, day 1, this month, 3,000.00, paid 1,500 on day 8
- P-001 E-0091204, day 3, last month, 4,620.00, paid in full on day 9
- P-002 W-54410, day 4, last month, 1,260.00, paid in full on day 9
- P-004 FC-2140, day 5, last month, 6,900.00, paid 4,000 on day 12 + 2,900 on day 26

**Caja**: last month and this month up to today:
- "Venta del día" every day except Sunday, RD$ 7,500–16,500 (deterministic pseudo-random)
- Day 1 Alquiler 15,000 "Local" · day 8 Luz 3,900 · day 12 Mercancía 22,400 "Pedido al distribuidor" · day 15 Salarios 18,000 "Quincena" · day 20 Impuestos 6,250 "ITBIS" · day 24 Otro ingreso 2,500 "Encargo especial" · day 30 Salarios 18,000 "Quincena" (only the days that have already happened)

Demo invoices use a generated SVG "paper invoice" placeholder as the photo (see `fakePhoto()` in the prototype).

---

## 11. Spanish copy reference

Tabs: Por pagar · Pagadas · Suplidores · Caja
Priorities: Urgente · Normal · Puede esperar
Statuses: Abonada · Pagada {fecha}
Buttons: + Factura · + Suplidor · + Movimiento · Guardar factura · Guardar suplidor · Guardar · Registrar pago · Pagar la mitad · Borrar factura · Borrar suplidor · Borrar movimiento · Ver todas · Todos · Reiniciar demo
Toasts: Factura guardada · Suplidor guardado · Entrada guardada · Salida guardada · ¡Saldada! ✓ · Abono guardado — faltan RD$ X · Pago quitado · Factura borrada · Suplidor borrado · Movimiento borrado · Foto agregada · Prioridad: {x} · Escriba un monto · Primero agregue un suplidor · Este suplidor todavía tiene facturas · No se pudo leer esa foto · No se pudo guardar en este equipo
New in this version: Sin conexión — se guardará al volver la señal · Sincronizado · Respaldo · Cómo instalar
Onboarding and PIN: Empezar · Clave de la hoja · Continuar · Esa clave no es. Pregúntele a quien le instaló la app. · Necesita internet para la primera vez. · ¿Quién es usted? · Cree su PIN · Repita su PIN · No son iguales. Intente otra vez. · Escriba su PIN para entrar · Ese PIN no es. Intente otra vez. · ¿Olvidó su PIN? Pídale ayuda a quien le instaló la app. · Entrar con la clave de la hoja

All the remaining strings are in `prototype.html`. Put every string in one `es-DO.ts` dictionary file.

---

## 12. Suggested project structure

```
misfacturas/
  app/                    # Vite PWA
    index.html
    src/
      main.ts             # boot, routing between tabs (hash: #por-pagar, #pagadas, #suplidores, #caja)
      state.ts            # selected tab/month, derived selectors (balance, paidDate…)
      db.ts               # IndexedDB (records, photos, outbox, meta)
      sync.ts             # push/pull/photo upload, LWW merge
      ui/                 # header, summary, tabs, monthbar, lists, sheets, toast, viewer, onboarding, pin
      auth.ts             # sheet key + PIN (PBKDF2), lock timer
      photo.ts            # compress (canvas → JPEG 1100px, q .72)
      i18n/es-DO.ts
      seed.ts
      styles.css          # tokens from §8
    public/icons/…
  apps-script/
    Code.gs               # doGet/doPost, pull/push/photo, LWW, LockService
    appsscript.json
  docs/
    SETUP.md              # step-by-step in Spanish + English: create Sheet, paste script, deploy, set the SHEET_KEY and the Usuarios rows, host, install on iPad
  BRIEF.md
  prototype.html
```
Use `clasp` for the Apps Script if convenient. Deploy the app with a GitHub Action to Pages.

---

## 13. Acceptance criteria

1. On a fresh iPad: open the URL in Safari → Add to Home Screen → it launches full-screen with the orange icon and "Mis Facturas".
2. Take a photo of a paper invoice, fill it in and save → it appears in Por pagar in the correct priority position. Within ~1 minute (or on refresh) it appears on a second device and as a row in the Sheet, with the photo in Drive.
3. Pay RD$ 1,000 of RD$ 4,850 → it shows "Abonada", "resta de RD$ 4,850.00" and a progress bar. Pay the rest → it moves to Pagadas with today's date.
4. Paying more than the balance is rejected with a clear message.
5. The month bar changes all the lists and the summary. The notice for older unpaid invoices works.
6. Caja: record a "Venta del día" and a "Salarios" exit → the day is grouped, the day's net and the month balance are correct.
7. Airplane mode: everything still works, and changes sync when back online. The status dot reflects this.
8. Onboarding: a wrong sheet password is rejected; the right one shows the Usuarios names; after creating a PIN the app opens. Reopening after 5+ minutes asks for the PIN; 5 wrong PINs go back to the sheet password.
9. Lighthouse PWA installable; works at 360px width; no horizontal scroll; light and dark both readable.
10. The backup export produces a JSON + photos that re-import into an empty install.
11. Every row written from the app has the right `createdBy`/`updatedBy`, and every accepted write adds a `Historial` row. None of this is visible in the app.
12. New invoices get `F-xxx` numbers automatically; two devices creating invoices offline end up with distinct numbers after syncing.

---

## 14. Possible v2 (do not build now)
- Optional link: paying an invoice also creates a Caja "Salida" movement.
- Due dates + reminders; recurring monthly invoices per supplier.
- OCR of the invoice photo to pre-fill the number and amount.
- Monthly PDF summary for the accountant.
- An English/Spanish toggle.
