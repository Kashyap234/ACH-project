// backend/database/db.js — Pure JS JSON store (no native modules)
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'ach_db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _db = {
  transactions:      [],
  risk_rules:        [],
  human_decisions:   [],  // legacy — kept for compat
  review_decisions:  [],  // new rich review records
  learning_patterns: [],
  audit_logs:        [],
  batch_jobs:        [],  // bulk upload jobs
  return_codes:      [],  // R01-R85 lookup
  users:             [],  // registered users
};

function loadFromDisk() {
  if (fs.existsSync(DB_FILE)) {
    try { _db = { ..._db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; }
    catch (e) { console.warn('[DB] Parse error, starting fresh:', e.message); }
  }
}

let _saveTimer = null;
function saveToDisk() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2)); }
    catch (e) { console.error('[DB] Save error:', e.message); }
  }, 150);
}

loadFromDisk();

function getTable(name) {
  if (!_db[name]) _db[name] = [];
  return _db[name];
}

function queryAll(table, filterFn = null, { orderBy, desc = true, limit, offset = 0 } = {}) {
  let rows = [...getTable(table)];
  if (filterFn) rows = rows.filter(filterFn);
  if (orderBy) rows.sort((a, b) => {
    const va = a[orderBy] ?? '', vb = b[orderBy] ?? '';
    return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
  });
  if (limit !== undefined) rows = rows.slice(offset, offset + limit);
  return rows;
}

function queryOne(table, filterFn) {
  return getTable(table).find(filterFn) || null;
}

function insert(table, data) {
  const rows = getTable(table);
  const id = rows.length > 0 ? Math.max(...rows.map(r => r.id || 0)) + 1 : 1;
  const now = new Date().toISOString();
  const row = { id, created_at: now, updated_at: now, ...data };
  rows.push(row);
  saveToDisk();
  return row;
}

function update(table, filterFn, updateFn) {
  const rows = getTable(table);
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (filterFn(rows[i])) {
      rows[i] = { ...rows[i], ...updateFn(rows[i]), updated_at: new Date().toISOString() };
      count++;
    }
  }
  if (count > 0) saveToDisk();
  return count;
}

function count(table, filterFn = null) {
  const rows = getTable(table);
  return filterFn ? rows.filter(filterFn).length : rows.length;
}

function remove(table, filterFn) {
  const rows = getTable(table);
  const before = rows.length;
  const filtered = rows.filter(r => !filterFn(r));
  _db[table] = filtered;
  if (filtered.length !== before) saveToDisk();
  return before - filtered.length; // number of removed rows
}

module.exports = { queryAll, queryOne, insert, update, remove, count, getTable, saveToDisk };

