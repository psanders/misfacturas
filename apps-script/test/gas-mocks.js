'use strict';
// In-memory mocks of the Apps Script services Code.gs uses, plus a loader that runs
// Code.gs inside a vm context wired to them. No npm dependencies.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const TZ = 'America/Santo_Domingo'; // UTC-4, no DST
const CODE_PATH = path.join(__dirname, '..', 'Code.gs');

// ---------- SpreadsheetApp ----------

// What real Sheets does to a value written into a cell whose format is not plain text.
function convertOnWrite(v, format) {
  if (typeof v !== 'string') return v instanceof Date ? new Date(v.getTime()) : v;
  if (v.startsWith("'")) return v.slice(1);              // apostrophe forces text
  if (v.startsWith('=')) return { formula: v };          // would run as a formula
  if (format === '@') return v;                          // plain text: kept as typed
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 4)); // midnight in Santo Domingo
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return new Date(v);
  if (/^(true|false)$/i.test(v)) return v.toUpperCase() === 'TRUE';
  if (v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

function copyCell(v) {
  if (v === undefined) return '';
  if (v instanceof Date) return new Date(v.getTime());
  return v;
}

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Bad range ${row},${col},${numRows},${numCols}`);
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(copyCell((this.sheet.cells[this.row - 1 + r] || [])[this.col - 1 + c]));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.numRows) throw new Error(`setValues: expected ${this.numRows} rows, got ${values && values.length}`);
    values.forEach((line, r) => {
      if (line.length !== this.numCols) throw new Error(`setValues: expected ${this.numCols} columns, got ${line.length}`);
      line.forEach((v, c) => {
        if (v === null || v === undefined) throw new Error('setValues: null/undefined cell');
        this.sheet.setCell(this.row + r, this.col + c, v);
      });
    });
    this.sheet.writes++;
    return this;
  }
  setNumberFormat(fmt) {
    // Approximation: a format applies to every row of the column from this.row down.
    for (let c = 0; c < this.numCols; c++) this.sheet.formats[this.col + c] = { fmt, fromRow: this.row };
    return this;
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.cells = [];
    this.formats = {};
    this.frozenRows = 0;
    this.writes = 0;
  }
  getName() { return this.name; }
  formatAt(row, col) {
    const f = this.formats[col];
    return f && row >= f.fromRow ? f.fmt : null;
  }
  setCell(row, col, v) {
    while (this.cells.length < row) this.cells.push([]);
    const line = this.cells[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = convertOnWrite(v, this.formatAt(row, col));
  }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r--) if (this.cells[r - 1].some((v) => v !== '' && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((line) => line.forEach((v, c) => { if (v !== '' && v !== undefined) max = Math.max(max, c + 1); }));
    return max;
  }
  getMaxRows() { return Math.max(1000, this.cells.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getDataRange() { return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(row, col, numRows = 1, numCols = 1) { return new MockRange(this, row, col, numRows, numCols); }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((v, c) => this.setCell(row, c + 1, v));
    this.writes++;
    return this;
  }
  setFrozenRows(n) { this.frozenRows = n; return this; }
  // Test helpers (not part of the Apps Script API)
  _rows() { return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)).getValues(); }
  _objects() {
    const [header, ...rows] = this._rows();
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  }
}

class MockSpreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists`);
    const s = new MockSheet(name);
    this.sheets.push(s);
    return s;
  }
}

// ---------- DriveApp ----------

class MockBlob {
  constructor(bytes, contentType, name) { Object.assign(this, { bytes: bytes.slice(), contentType, name }); }
  getBytes() { return this.bytes.slice(); }
  getContentType() { return this.contentType; }
  getName() { return this.name; }
}

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}

class MockDrive {
  constructor() { this.folders = new Map(); this.files = new Map(); }
  _id() { return crypto.randomBytes(12).toString('hex'); }
  createFolder(name) {
    const drive = this;
    const folder = {
      id: this._id(), name, trashed: false,
      getId() { return this.id; }, getName() { return this.name; }, isTrashed() { return this.trashed; },
      createFile(blob) { return drive._createFile(blob, folder); },
      setTrashed(v) { this.trashed = v; return this; }
    };
    this.folders.set(folder.id, folder);
    return folder;
  }
  _createFile(blob, parent) {
    const file = {
      id: this._id(), blob: new MockBlob(blob.getBytes(), blob.getContentType(), blob.getName()), parent, trashed: false,
      getId() { return this.id; }, getName() { return this.blob.getName(); }, getMimeType() { return this.blob.getContentType(); },
      getBlob() { return new MockBlob(this.blob.getBytes(), this.blob.getContentType(), this.blob.getName()); },
      getParents() { return iterator(this.parent ? [this.parent] : []); }, isTrashed() { return this.trashed; }
    };
    this.files.set(file.id, file);
    return file;
  }
  createFile(blob) { return this._createFile(blob, null); } // root of My Drive
  getFolderById(id) {
    const f = this.folders.get(id);
    if (!f) throw new Error('No item with the given ID could be found');
    return f;
  }
  getFileById(id) {
    const f = this.files.get(id);
    if (!f) throw new Error('No item with the given ID could be found');
    return f;
  }
}

// ---------- Loader ----------

function loadCode(opts = {}) {
  const ss = new MockSpreadsheet();
  const drive = new MockDrive();
  const props = new Map(Object.entries(opts.props || {}));
  const logs = [];
  const lock = { available: true, held: false, acquired: 0 };

  const Utilities = {
    base64Decode(s) {
      if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new Error('Could not decode string.');
      return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); // Java-style signed bytes
    },
    base64Encode(bytes) { return Buffer.from(bytes.map((b) => b & 255)).toString('base64'); },
    newBlob(bytes, contentType, name) { return new MockBlob(bytes, contentType, name); },
    formatDate(date, tz, fmt) {
      if (fmt !== 'yyyy-MM-dd') throw new Error('mock formatDate only supports yyyy-MM-dd');
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    },
    getUuid() { return crypto.randomUUID(); }
  };

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) { props.set(k, String(v)); return this; },
        deleteProperty(k) { props.delete(k); return this; },
        getProperties: () => Object.fromEntries(props)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() {
          if (!lock.available || lock.held) return false;
          lock.held = true; lock.acquired++; return true;
        },
        waitLock(ms) { if (!this.tryLock(ms)) throw new Error('Lock timeout'); },
        releaseLock() { lock.held = false; },
        hasLock: () => lock.held
      })
    },
    DriveApp: drive,
    Utilities,
    Session: { getScriptTimeZone: () => TZ },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(content) {
        return { content, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } };
      }
    },
    Logger: { log: (...a) => { logs.push(a.join(' ')); } },
    console
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), ctx, { filename: 'Code.gs' });

  function post(body) {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    const out = ctx.doPost({ postData: { contents, type: 'text/plain' } });
    if (out.mime !== 'application/json') throw new Error('response mime not JSON');
    return JSON.parse(out.getContent());
  }
  function setNow(isoOrMs) {
    const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
    ctx.nowMs_ = () => ms;
  }
  return { ctx, ss, drive, props, logs, lock, post, setNow };
}

module.exports = { loadCode, MockSheet, convertOnWrite, TZ };
