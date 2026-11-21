/**
 * Mis Facturas — Google Apps Script backend.
 *
 * The contract with the app is docs/API.md. Every call is a POST with a JSON body
 * (sent as text/plain) and every answer is HTTP 200 with { ok: true, ... } or
 * { ok: false, error: 'bad_key' | 'bad_user' | 'bad_request' | 'server', message? }.
 *
 * Run setup() once by hand from the editor before deploying (see docs/SETUP.md).
 */

// ---------- Schema ----------

var TABLES = {
  suplidores: { tab: 'Suplidores', fields: ['id', 'name', 'desc', 'prio'] },
  facturas:   { tab: 'Facturas',   fields: ['id', 'prov', 'num', 'entered', 'amount', 'prio', 'photoId'] },
  pagos:      { tab: 'Pagos',      fields: ['id', 'factura', 'date', 'amount'] },
  caja:       { tab: 'Caja',       fields: ['id', 'type', 'cat', 'amount', 'date', 'note'] }
};
var COMMON_FIELDS = ['updatedAt', 'deleted', 'createdBy', 'updatedBy', 'syncedAt'];
var USERS = { tab: 'Usuarios', fields: ['id', 'name', 'active'] };
var HISTORY = { tab: 'Historial', fields: ['at', 'userId', 'table', 'recordId', 'op'] };

var DATE_FIELDS = { entered: true, date: true };            // 'YYYY-MM-DD'
var BOOL_FIELDS = { deleted: true, active: true };
var NUM_FIELDS = { prio: true, amount: true };
var AMOUNT_FORMAT = '"RD$ "#,##0.00';
var PHOTO_FOLDER_NAME = 'Mis Facturas — Fotos';
var LOCK_WAIT_MS = 20000;

function columnsOf_(table) {
  return TABLES[table].fields.concat(COMMON_FIELDS);
}

// ---------- Entry points ----------

function doGet() {
  return json_({ ok: false, error: 'bad_request', message: 'Use POST' });
}

function doPost(e) {
  var res;
  try {
    var body;
    try {
      body = JSON.parse(e && e.postData && e.postData.contents);
    } catch (err) {
      fail_('bad_request', 'Body is not valid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail_('bad_request', 'Body must be a JSON object');
    checkKey_(body.key);
    if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) {
      fail_('bad_request', 'Unknown action');
    }
    res = ACTIONS[body.action](body);
  } catch (err) {
    res = err && err.apiCode
      ? { ok: false, error: err.apiCode, message: err.message }
      : { ok: false, error: 'server', message: String((err && err.message) || err) };
  }
  return json_(res);
}

var ACTIONS = {
  verify: actionVerify_,
  pull: actionPull_,
  push: actionPush_,
  photo: actionPhoto_,
  getPhoto: actionGetPhoto_
};

// ---------- Actions ----------

function actionVerify_() {
  var users = readUsers_().filter(function (u) { return u.active; })
    .map(function (u) { return { id: u.id, name: u.name }; });
  return { ok: true, users: users };
}

function actionPull_(body) {
  var since = null;
  if (body.since !== null && body.since !== undefined) {
    since = typeof body.since === 'string' ? Date.parse(body.since) : NaN;
    if (isNaN(since)) fail_('bad_request', '"since" must be an ISO date or null');
  }
  // Read under the lock so a pull never sees half of a push. "now" is taken after the
  // lock and minus 1 ms: any later push gets syncedAt >= lock time > now, so a row
  // written in the same millisecond is never lost (at worst it is sent twice).
  return withLock_(function () {
    var now = new Date(nowMs_() - 1).toISOString();
    var res = { ok: true, now: now };
    Object.keys(TABLES).forEach(function (table) {
      var t = readTab_(TABLES[table].tab, columnsOf_(table));
      res[table] = t.rows.map(function (r) { return rowObject_(t, r); }).filter(function (o) {
        if (!o.id) return false;
        if (since === null) return true;
        var s = Date.parse(o.syncedAt);
        return !isNaN(s) && s > since;
      });
    });
    res.usuarios = readUsers_();
    return res;
  });
}

function actionPush_(body) {
  var user = checkUser_(body.userId);
  if (!Array.isArray(body.ops)) fail_('bad_request', '"ops" must be an array');
  body.ops.forEach(validateOp_); // everything is checked before anything is written

  return withLock_(function () {
    var now = new Date(nowMs_()).toISOString();
    var tabs = {}, history = [], applied = [], renumbered = [];

    body.ops.forEach(function (op) {
      var t = tabs[op.table] || (tabs[op.table] = readTab_(TABLES[op.table].tab, columnsOf_(op.table)));
      var rec = op.record;
      var id = rec.id.trim();
      var i = Object.prototype.hasOwnProperty.call(t.index, id) ? t.index[id] : -1;
      var existing = i >= 0 ? rowObject_(t, t.rows[i]) : null;

      // Last-write-wins on the client's updatedAt. Equal or older → skip silently.
      if (existing && Date.parse(existing.updatedAt) >= Date.parse(rec.updatedAt)) return;

      var out = {};
      TABLES[op.table].fields.forEach(function (f) { out[f] = rec[f]; });
      out.id = id;
      out.updatedAt = rec.updatedAt;
      out.deleted = rec.deleted === true;
      out.createdBy = existing ? existing.createdBy : user.id;
      out.updatedBy = user.id;
      out.syncedAt = now;

      if (op.table === 'facturas') {
        if (existing) {
          out.num = existing.num; // the client can't change num
        } else {
          var num = out.num == null ? '' : String(out.num).trim();
          if (!num || numTaken_(t, num)) {
            num = nextNum_(t);
            renumbered.push({ id: id, num: num });
          }
          out.num = num;
        }
      }

      var row;
      if (existing) {
        row = t.rows[i];
        t.dirty[i] = true;
      } else {
        row = blankRow_(t.span);
        t.index[id] = t.rows.length;
        t.rows.push(row);
      }
      t.fields.forEach(function (f) { row[t.col[f]] = toCell_(f, out[f]); });

      var hop = !existing ? 'create' : (!existing.deleted && out.deleted ? 'delete' : 'update');
      history.push([now, user.id, op.table, id, hop]);
      applied.push(id);
    });

    Object.keys(tabs).forEach(function (k) { flushTab_(tabs[k]); });
    appendHistory_(history);
    return { ok: true, now: now, applied: applied, renumbered: renumbered };
  });
}

function actionPhoto_(body) {
  var user = checkUser_(body.userId);
  if (!isNonEmptyString_(body.facturaId)) fail_('bad_request', '"facturaId" is required');
  if (!isNonEmptyString_(body.base64)) fail_('bad_request', '"base64" is required');
  var mime = isNonEmptyString_(body.mime) ? body.mime : 'image/jpeg';
  var name = isNonEmptyString_(body.name) ? body.name : body.facturaId + '.jpg';
  var bytes;
  try {
    // Tolerate a "data:image/jpeg;base64," prefix.
    bytes = Utilities.base64Decode(body.base64.replace(/^data:[^,]*,/, ''));
  } catch (err) {
    fail_('bad_request', '"base64" is not valid base64');
  }

  return withLock_(function () {
    var file = photoFolder_().createFile(Utilities.newBlob(bytes, mime, name));
    var now = new Date(nowMs_()).toISOString();
    appendHistory_([[now, user.id, 'facturas', body.facturaId, 'photo']]);
    return { ok: true, photoId: file.getId() };
  });
}

function actionGetPhoto_(body) {
  if (!isNonEmptyString_(body.id)) fail_('bad_request', '"id" is required');
  var file = null;
  try { file = DriveApp.getFileById(body.id); } catch (err) { file = null; }
  // Only serve files from the photos folder: the key must not open the owner's whole Drive.
  if (!file || file.isTrashed() || !inPhotoFolder_(file)) fail_('bad_request', 'Photo not found');
  var blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- Auth ----------

function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHEET_KEY');
  if (!expected || typeof key !== 'string' || !sameString_(key, expected)) fail_('bad_key', 'Wrong key');
}

function checkUser_(userId) {
  if (!isNonEmptyString_(userId)) fail_('bad_user', 'Missing userId');
  var user = readUsers_().filter(function (u) { return u.id === userId; })[0];
  if (!user || !user.active) fail_('bad_user', 'Unknown or inactive user');
  return user;
}

// Compares without stopping at the first different character.
function sameString_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Sheet access ----------

// Reads a whole tab (they are small) and maps field → column and id → row offset.
function readTab_(tabName, fields) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) throw new Error('Missing tab "' + tabName + '". Run setup().');
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var col = {}, span = 0;
  fields.forEach(function (f) {
    var c = header.indexOf(f);
    if (c < 0) throw new Error('Tab "' + tabName + '" has no column "' + f + '"');
    col[f] = c;
    span = Math.max(span, c + 1);
  });
  var t = { sheet: sheet, fields: fields, col: col, span: span, rows: [], index: {}, dirty: {} };
  values.slice(1).forEach(function (r) {
    var row = r.slice(0, span);
    while (row.length < span) row.push('');
    t.rows.push(row);
  });
  t.loaded = t.rows.length;
  if (Object.prototype.hasOwnProperty.call(col, 'id')) {
    t.rows.forEach(function (r, i) {
      var id = String(fromCell_('id', r[col.id])).trim();
      if (id && !Object.prototype.hasOwnProperty.call(t.index, id)) t.index[id] = i;
    });
  }
  return t;
}

// Writes changed rows one by one (only the columns we own) and new rows as one block.
function flushTab_(t) {
  Object.keys(t.dirty).forEach(function (i) {
    i = Number(i);
    t.sheet.getRange(i + 2, 1, 1, t.span).setValues([t.rows[i]]);
  });
  var added = t.rows.slice(t.loaded);
  if (added.length) t.sheet.getRange(t.loaded + 2, 1, added.length, t.span).setValues(added);
}

function appendHistory_(rows) {
  if (!rows.length) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HISTORY.tab);
  if (!sheet) throw new Error('Missing tab "' + HISTORY.tab + '". Run setup().');
  // Historial is written in contract column order (at, userId, table, recordId, op).
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HISTORY.fields.length)
    .setValues(rows.map(function (r) { return r.map(function (v) { return toCell_('', v); }); }));
}

function readUsers_() {
  var t = readTab_(USERS.tab, USERS.fields);
  return t.rows.map(function (r) { return rowObject_(t, r); })
    .filter(function (u) { return u.id; })
    .map(function (u) { return { id: u.id, name: u.name, active: u.active }; });
}

function rowObject_(t, row) {
  var o = {};
  t.fields.forEach(function (f) { o[f] = fromCell_(f, row[t.col[f]]); });
  return o;
}

function blankRow_(n) {
  var r = [];
  for (var i = 0; i < n; i++) r.push('');
  return r;
}

// Normalizes a value read from the Sheet into its wire type.
function fromCell_(field, v) {
  if (BOOL_FIELDS[field]) return v === true || String(v).trim().toUpperCase() === 'TRUE';
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    if (DATE_FIELDS[field]) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return v.toISOString(); // timestamps (and anything else Sheets turned into a date)
  }
  if (NUM_FIELDS[field]) {
    var n = Number(v);
    return isFinite(n) ? n : '';
  }
  var s = String(v);
  return s.charAt(0) === "'" && s.charAt(1) === '=' ? s.slice(1) : s;
}

// Converts a wire value into what we write to the Sheet (never null).
function toCell_(field, v) {
  if (BOOL_FIELDS[field]) return v === true || v === 'TRUE' || v === 'true';
  if (v === null || v === undefined) return '';
  if (NUM_FIELDS[field]) {
    if (v === '') return '';
    var n = Number(v);
    return isFinite(n) ? n : '';
  }
  var s = String(v);
  return s.charAt(0) === '=' ? "'" + s : s; // keep text that looks like a formula as text
}

// ---------- Push helpers ----------

function validateOp_(op) {
  if (!op || typeof op !== 'object') fail_('bad_request', 'Each op must be an object');
  if (op.op !== 'upsert') fail_('bad_request', 'Unknown op: ' + op.op);
  if (typeof op.table !== 'string' || !Object.prototype.hasOwnProperty.call(TABLES, op.table)) {
    fail_('bad_request', 'Unknown table: ' + op.table);
  }
  var rec = op.record;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) fail_('bad_request', 'Missing record');
  if (!isNonEmptyString_(rec.id) || !rec.id.trim()) fail_('bad_request', 'Record without id');
  if (typeof rec.updatedAt !== 'string' || isNaN(Date.parse(rec.updatedAt))) {
    fail_('bad_request', 'Record ' + rec.id + ' has no valid updatedAt');
  }
}

function numTaken_(t, num) {
  return t.rows.some(function (r) { return String(fromCell_('num', r[t.col.num])).trim() === num; });
}

// F- + zero-padded (max numeric part over all F-### nums, deleted rows included) + 1.
function nextNum_(t) {
  var max = 0;
  t.rows.forEach(function (r) {
    var m = /^F-(\d+)$/.exec(String(fromCell_('num', r[t.col.num])).trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return 'F-' + n;
}

// ---------- Photos ----------

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) { /* deleted or no access: make a new one */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function inPhotoFolder_(file) {
  var folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  if (!folderId) return false;
  var parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

// ---------- Small utilities ----------

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Busy: could not get the lock, try again');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowMs_() {
  return Date.now();
}

function isNonEmptyString_(v) {
  return typeof v === 'string' && v.length > 0;
}

function fail_(code, message) {
  var err = new Error(message || code);
  err.apiCode = code;
  throw err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- One-time setup (run by hand from the editor) ----------

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (table) {
    ensureTab_(ss, TABLES[table].tab, columnsOf_(table));
  });
  var users = ensureTab_(ss, USERS.tab, USERS.fields);
  ensureTab_(ss, HISTORY.tab, HISTORY.fields);

  if (users.getLastRow() < 2) {
    users.getRange(2, 1, 3, 3).setValues([
      ['U-001', 'Mamá', true],
      ['U-002', 'Admin', true],
      ['U-003', 'Primo', true]
    ]);
  }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_KEY')) {
    var key = makeKey_();
    props.setProperty('SHEET_KEY', key);
    Logger.log('Nueva clave de la hoja / New SHEET_KEY: ' + key);
  } else {
    Logger.log('SHEET_KEY ya existe / already set (Project Settings → Script Properties).');
  }
}

// Creates the tab with headers and column formats. A tab that already has content is left alone.
function ensureTab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() > 0) return sheet;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  headers.forEach(function (h, i) {
    var range = sheet.getRange(2, i + 1, rows, 1);
    if (h === 'amount') range.setNumberFormat(AMOUNT_FORMAT);
    else if (!NUM_FIELDS[h] && !BOOL_FIELDS[h]) range.setNumberFormat('@'); // ids, dates, timestamps, text
  });
  return sheet;
}

// Three easy Spanish words (no accents) + 2 digits, e.g. "mango-playa-nube-47".
var KEY_WORDS = (
  'agua arena arroz azul barco bola brisa cafe calle cama campo canoa casa cena cielo cinta ' +
  'coco color copa costa cuento dedo dulce flor fruta fuego gato globo gota grano guayaba hielo ' +
  'hoja huevo isla jugo lago lapiz leche lima limon lindo loma luna lluvia mango mapa mar ' +
  'mesa miel mono monte nube nido noche ola oro oso palma pan papel pato perla pez ' +
  'plato playa pluma pollo puerta queso radio rama rana rio roca rosa sal sapo selva silla ' +
  'sol sombra sopa taza techo tela tierra tigre tomate torre trigo uva vaca vela verde viento ' +
  'yuca zapato bambu canela cereza delfin estrella faro gallo hamaca jazmin kiwi lirio maiz ' +
  'naranja nuez pina perro reloj salsa tambor trompo violin'
).split(' ');

function makeKey_() {
  var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var words = [];
  for (var i = 0; i < 3; i++) words.push(KEY_WORDS[parseInt(hex.substr(i * 4, 4), 16) % KEY_WORDS.length]);
  var digits = String(parseInt(hex.substr(32, 4), 16) % 100);
  return words.join('-') + '-' + (digits.length < 2 ? '0' + digits : digits);
}
