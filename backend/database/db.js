// backend/database/db.js — Supabase PostgreSQL adapter
// Same API as the original JSON-file db.js and the Firebase adapter — fully async.
//
// Supabase table schema (run setup.sql in Supabase SQL Editor):
//   Each table has: _id (bigserial PK), _doc_key (text), data (jsonb),
//                   created_at (timestamptz), updated_at (timestamptz)
//   The 'data' JSONB column stores the entire document.
//   This lets us keep the same flexible, schema-free API as before.

const { getSupabase } = require('./supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Strip undefined values — PostgreSQL JSONB doesn't like undefined
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Unwrap a Supabase row: merge data JSONB + set _docId from _doc_key
function unwrap(row) {
  if (!row) return null;
  const doc = row.data || {};
  return { ...doc, _docId: row._doc_key || String(row._id) };
}

// Throw a friendly error if Supabase returns an error object
function assertOk({ error }, context) {
  if (error) throw new Error(`[Supabase:${context}] ${error.message || JSON.stringify(error)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// queryAll(table, filterFn?, { orderBy?, desc?, limit?, offset? })
// Returns an array of all matching documents
// ─────────────────────────────────────────────────────────────────────────────
async function queryAll(table, filterFn = null, { orderBy, desc = true, limit, offset = 0 } = {}) {
  const sb = getSupabase();
  const { data: rows, error } = await sb.from(table).select('*');
  assertOk({ error }, `queryAll:${table}`);

  let results = (rows || []).map(unwrap);

  if (filterFn)  results = results.filter(filterFn);

  if (orderBy) {
    results.sort((a, b) => {
      const va = a[orderBy] ?? '';
      const vb = b[orderBy] ?? '';
      return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
    });
  }

  if (limit !== undefined) results = results.slice(offset, offset + limit);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// queryOne(table, filterFn)
// Returns first matching document or null
// ─────────────────────────────────────────────────────────────────────────────
async function queryOne(table, filterFn) {
  const all = await queryAll(table);
  return all.find(filterFn) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// insert(table, data)
// Adds a new document. Auto-assigns a numeric id for backward compat.
// ─────────────────────────────────────────────────────────────────────────────
async function insert(table, data) {
  const sb  = getSupabase();
  const now = new Date().toISOString();

  // Fetch current max id for backward-compat numeric id
  const { data: rows } = await sb.from(table).select('data->id');
  const maxId = (rows || []).reduce((m, r) => {
    const n = Number(r.id) || 0;
    return n > m ? n : m;
  }, 0);
  const id = maxId + 1;

  const row = clean({ id, created_at: now, updated_at: now, ...data });

  // Tables that don't have a unique natural key — always use uuid
  const INDEX_KEYED = new Set(['audit_logs', 'human_decisions', 'review_decisions', 'acl_filter_rules', 'check_register', 'info_requests', 'chat_sessions', 'chat_messages']);

  // Determine natural key for _doc_key (deterministic dedup)
  const naturalKey = INDEX_KEYED.has(table)
    ? `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : (row.request_id || row.transaction_id || row.user_id || row.account_id
        || row.job_id || row.rule_code || row.code || row.pattern_hash
        || String(id));

  const { data: inserted, error } = await sb
    .from(table)
    .upsert({ _doc_key: String(naturalKey), data: row, created_at: now, updated_at: now }, { onConflict: '_doc_key' })
    .select()
    .single();

  assertOk({ error }, `insert:${table}`);
  return { ...row, _docId: String(naturalKey) };
}

// ─────────────────────────────────────────────────────────────────────────────
// update(table, filterFn, updateFn)
// Updates all matching documents. Returns count of updated docs.
// ─────────────────────────────────────────────────────────────────────────────
async function update(table, filterFn, updateFn) {
  const sb      = getSupabase();
  const all     = await queryAll(table);
  const matches = all.filter(filterFn);
  const now     = new Date().toISOString();
  let count     = 0;

  for (const doc of matches) {
    const changes = updateFn(doc);
    const updated = clean({ ...doc, ...changes, updated_at: now });
    delete updated._docId; // don't store internal key in data

    const { error } = await sb
      .from(table)
      .update({ data: updated, updated_at: now })
      .eq('_doc_key', doc._docId);

    assertOk({ error }, `update:${table}`);
    count++;
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// remove(table, filterFn)
// Deletes all matching documents. Returns count of removed docs.
// ─────────────────────────────────────────────────────────────────────────────
async function remove(table, filterFn) {
  const sb      = getSupabase();
  const all     = await queryAll(table);
  const matches = all.filter(filterFn);
  let count     = 0;

  for (const doc of matches) {
    const { error } = await sb.from(table).delete().eq('_doc_key', doc._docId);
    assertOk({ error }, `remove:${table}`);
    count++;
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// count(table, filterFn?)
// Returns number of documents matching optional filter
// ─────────────────────────────────────────────────────────────────────────────
async function count(table, filterFn = null) {
  const all = await queryAll(table);
  return filterFn ? all.filter(filterFn).length : all.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// getTable(table) — backward-compat shim used by seed.js
// ─────────────────────────────────────────────────────────────────────────────
async function getTable(table) {
  return queryAll(table);
}

// saveToDisk — no-op shim (Supabase writes are instant)
function saveToDisk() { }

module.exports = { queryAll, queryOne, insert, update, remove, count, getTable, saveToDisk };
