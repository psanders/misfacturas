# Mis Facturas — App ↔ Apps Script contract

This is the single source of truth for the API between the PWA (`app/`) and the
Google Apps Script web app (`apps-script/Code.gs`). Both sides must match it exactly.

## Transport

- Every call is `POST <WEB_APP_URL>` with header `Content-Type: text/plain;charset=utf-8`
  and a JSON body. `text/plain` avoids the CORS preflight that Apps Script cannot answer.
  The script reads it with `JSON.parse(e.postData.contents)`.
- There is no GET API. (The key never goes in a URL, so it never lands in logs or history.)
- Apps Script web apps **cannot set HTTP status codes**: every response is HTTP 200 with a
  JSON body (`ContentService.createTextOutput(JSON.stringify(x)).setMimeType(JSON)`).
- Success: `{ "ok": true, ... }`. Failure: `{ "ok": false, "error": "<code>", "message"?: "<text>" }`.

| error code    | meaning | what the app does |
|---------------|---------|-------------------|
| `bad_key`     | `key` missing or ≠ Script Property `SHEET_KEY` | forget key + PIN, go to onboarding step 2 |
| `bad_user`    | `userId` missing, unknown, or `active` is not TRUE | forget key + PIN, go to onboarding step 2 |
| `bad_request` | malformed body, unknown action/table | log, keep the ops in the outbox, show nothing |
| `server`      | anything thrown | retry later |

## Data shape

Tables and their fields, in Sheet column order. Row 1 of each tab holds exactly these headers.

Common fields on the four data tables (appended after the table's own fields):
`updatedAt` (ISO string, set by the **client**), `deleted` (boolean), `createdBy`, `updatedBy`
(usuarios.id, set by the **server**), `syncedAt` (ISO string, set by the **server** when it accepts a write).

| table        | Sheet tab    | own fields |
|--------------|--------------|------------|
| `suplidores` | `Suplidores` | `id, name, desc, prio` |
| `facturas`   | `Facturas`   | `id, prov, num, entered, amount, prio, photoId` |
| `pagos`      | `Pagos`      | `id, factura, date, amount` |
| `caja`       | `Caja`       | `id, type, cat, amount, date, note` |
| `usuarios`   | `Usuarios`   | `id, name, active` (no common fields; edited by hand) |
| `historial`  | `Historial`  | `at, userId, table, recordId, op` (no common fields; append-only) |

Value types on the wire:
- `prio`: number 1|2|3. `amount`: number. `deleted`, `active`: boolean.
- Date fields (`entered`, `date`): string `YYYY-MM-DD`. Timestamps (`updatedAt`, `syncedAt`, `at`): ISO-8601 string.
- `photoId`, `desc`, `note`: string (empty string when absent; never `null` in the Sheet).
- **The script must normalize when reading rows**: Sheets turns date-like strings into `Date`
  objects and `TRUE` into booleans. Date fields → `YYYY-MM-DD` (script time zone),
  timestamps → ISO, numbers stay numbers, empty cells → `""` (or `false` for booleans).
  The date and id columns should be formatted as plain text (`@`) by `setup()` so this rarely happens.

## Actions

### `verify`
Request: `{ "action": "verify", "key": "…" }`
Response: `{ "ok": true, "users": [ { "id": "U-001", "name": "Mamá" }, … ] }` — only rows with `active` TRUE, in Sheet order.

### `pull`
Request: `{ "action": "pull", "key": "…", "since": "<ISO>" | null }`
Response:
```json
{ "ok": true, "now": "<server ISO>",
  "suplidores": [...], "facturas": [...], "pagos": [...], "caja": [...],
  "usuarios": [ { "id", "name", "active" } ] }
```
- Data rows returned are those with `syncedAt > since` (all rows when `since` is null), **including deleted ones**.
- Filtering is on `syncedAt` (server clock), never on `updatedAt` (device clock), so device clock skew can't hide rows.
- `usuarios` is always returned in full.
- The client stores `now` and sends it as the next `since`.
- `pull` takes the script lock too, and `now` is the lock time minus 1 ms, so a pull can never miss a push that
  lands in the same millisecond. A row may occasionally come back twice; last-write-wins makes that harmless.
- Rows typed by hand in the Sheet have no `syncedAt`, so only a full pull (`since: null`) returns them.
  The app does a full pull on the first sync after each start for this reason.

Malformed requests are rejected as a whole before anything is written (`bad_request`): missing/empty `id`,
invalid `updatedAt`, `op` other than `upsert`, `ops` not an array, or a table not in the four data tables.

### `push`
Request: `{ "action": "push", "key": "…", "userId": "U-001", "ops": [ { "op": "upsert", "table": "facturas", "record": { …all own fields + updatedAt + deleted } } ] }`
- `op` is always `"upsert"`. A delete is an upsert with `deleted: true`.
- Inside `LockService.getScriptLock()` (wait up to 20 s), for each op in order:
  1. Unknown table → `bad_request` for the whole call (nothing written).
  2. Find the row by `id`.
  3. **Last-write-wins:** if the row exists and `existing.updatedAt >= record.updatedAt`, skip it (not applied, no Historial).
  4. **Facturas numbering:** on insert (new id) of a `facturas` row, if another row (any `deleted` value) already has the same `num`, assign `F-` + zero-padded-3 of (max numeric part over all `F-###` nums + 1) and report it in `renumbered`. On update, `num` keeps the stored value (the client can't change it).
  5. Write only the table's known fields. Set `updatedBy = userId`, `syncedAt = now`; `createdBy = userId` on insert, else keep the stored `createdBy`. Ignore any `createdBy/updatedBy/syncedAt` the client sent.
  6. Append to `Historial`: `at = now, userId, table, recordId = id, op` where op is `create` (insert),
     `delete` (deleted went false→true), or `update` (anything else).
- Response: `{ "ok": true, "now": "<ISO>", "applied": ["id", …], "renumbered": [ { "id": "…", "num": "F-012" } ] }`

### `photo` (upload)
Request: `{ "action": "photo", "key", "userId", "facturaId", "name": "2026-11_Farmacia Central_F-008.jpg", "mime": "image/jpeg", "base64": "…" }`
- Creates the file in the Drive folder **"Mis Facturas — Fotos"** (created on first use; its id cached in Script Property `PHOTO_FOLDER_ID`).
- Does **not** modify the factura row: the client then pushes the factura with the returned `photoId`.
- Appends Historial `op = "photo"`, `table = "facturas"`, `recordId = facturaId`.
- Response: `{ "ok": true, "photoId": "<drive file id>" }`

### `getPhoto`
Request: `{ "action": "getPhoto", "key", "id": "<drive file id>" }`
Response: `{ "ok": true, "mime": "image/jpeg", "base64": "…" }`
- Only files inside the photos folder are served (the script runs as the owner; any other id would expose their Drive).
  Unknown, trashed or outside ids → `bad_request` "Photo not found". The app treats a missing photo as non-fatal.

## One-time `setup()` (run by hand from the Apps Script editor)
- Creates any missing tabs with their header row (data tabs, `Usuarios`, `Historial`), freezes row 1,
  formats id/date/timestamp columns as text and amount columns as `"RD$ "#,##0.00`.
- If `Usuarios` is empty, adds `U-001 | Mamá | TRUE`, `U-002 | Admin | TRUE`, `U-003 | Primo | TRUE` for the admin to rename.
- If Script Property `SHEET_KEY` is not set, generates a random one (e.g. 3 short Spanish-friendly words + 2 digits) and logs it.
- Idempotent: running it again changes nothing that exists.
