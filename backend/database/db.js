// backend/database/db.js — Supabase PostgreSQL adapter
// All WHERE / LIMIT / ORDER are pushed to Postgres to minimise egress bandwidth.
// The optional `where` param accepts a plain object of field→value equality filters
// that are translated to PostgREST JSONB path queries (data->>'field' = 'value').

const { getSupabase } = require('./supabase');

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function unwrap(row) {
  if (!row) return null;
  const doc = row.data || {};
  return { ...doc, _docId: row._doc_key || String(row._id) };
}

function assertOk({ error }, context) {
  if (error) throw new Error(`[Supabase:${context}] ${error.message || JSON.stringify(error)}`);
}

// Push equality filters on JSONB fields to Postgres (avoids full table scan)
function applyWhere(q, where) {
  if (!where) return q;
  for (const [key, val] of Object.entries(where)) {
    q = (val === null || val === undefined)
      ? q.is(`data->>${key}`, null)
      : q.eq(`data->>${key}`, String(val));
  }
  return q;
}

// ─────────────────────────────────────────────────────────────────────────────
// queryAll(table, filterFn?, { where?, orderBy?, desc?, limit?, offset? })
//
// `where`  — server-side JSONB equality filter (biggest bandwidth lever)
// `limit`  — pushed to server when there is no client-side filterFn
// ─────────────────────────────────────────────────────────────────────────────
async function queryAll(table, filterFn = null, { where, orderBy, desc = true, limit, offset = 0 } = {}) {
  const sb = getSupabase();
  let q = sb.from(table).select('*');

  // Server-side WHERE
  q = applyWhere(q, where);

  if (!filterFn) {
    // No client-side filter → push ordering + paging to Postgres
    const topLevel = new Set(['created_at', 'updated_at']);
    if (orderBy && topLevel.has(orderBy)) {
      q = q.order(orderBy, { ascending: !desc });
    } else if (!orderBy) {
      q = q.order('created_at', { ascending: false });
    }
    // else: non-standard orderBy (account_name, trigger_count…) — sorted client-side below
    if (limit !== undefined && (!orderBy || topLevel.has(orderBy))) {
      q = q.range(offset, offset + limit - 1);
    }

    const { data: rows, error } = await q;
    assertOk({ error }, `queryAll:${table}`);
    const results = (rows || []).map(unwrap);

    // Client-side sort for non-top-level orderBy fields
    if (orderBy && !topLevel.has(orderBy)) {
      results.sort((a, b) => {
        const va = a[orderBy] ?? '';
        const vb = b[orderBy] ?? '';
        return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
      });
      if (limit !== undefined) return results.slice(offset, offset + limit);
    }
    return results;
  }

  // Client-side filter path — server pre-filters via `where`, JS filter narrows further
  const { data: rows, error } = await q;
  assertOk({ error }, `queryAll:${table}`);

  let results = (rows || []).map(unwrap).filter(filterFn);

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
// queryOne(table, filterFn, where?)
// `where` pre-filters on the server so only relevant rows are transferred.
// ─────────────────────────────────────────────────────────────────────────────
async function queryOne(table, filterFn, where = null) {
  const all = await queryAll(table, null, where ? { where } : {});
  return all.find(filterFn) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// insert(table, data)
// Uses a HEAD count (zero bytes transferred) instead of downloading all rows
// just to compute the next sequential id.
// ─────────────────────────────────────────────────────────────────────────────
async function insert(table, data) {
  const sb  = getSupabase();
  const now = new Date().toISOString();

  // HEAD request — returns count metadata only, no row data
  const { count: rowCount } = await sb.from(table).select('*', { count: 'exact', head: true });
  const id = (rowCount || 0) + 1;

  const row = clean({ id, created_at: now, updated_at: now, ...data });

  const INDEX_KEYED = new Set([
    'audit_logs', 'human_decisions', 'review_decisions', 'acl_filter_rules',
    'check_register', 'info_requests', 'chat_sessions', 'chat_messages',
  ]);

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
// update(table, filterFn, updateFn, where?)
// `where` narrows the fetch so only matching rows are downloaded.
// ─────────────────────────────────────────────────────────────────────────────
async function update(table, filterFn, updateFn, where = null) {
  const sb      = getSupabase();
  const all     = await queryAll(table, null, where ? { where } : {});
  const matches = all.filter(filterFn);
  const now     = new Date().toISOString();
  let count     = 0;

  for (const doc of matches) {
    const changes = updateFn(doc);
    const updated = clean({ ...doc, ...changes, updated_at: now });
    delete updated._docId;

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
// remove(table, filterFn, where?)
// ─────────────────────────────────────────────────────────────────────────────
async function remove(table, filterFn, where = null) {
  const sb      = getSupabase();
  const all     = await queryAll(table, null, where ? { where } : {});
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
// Uses a HEAD request (zero bytes) when no client-side filter is needed.
// ─────────────────────────────────────────────────────────────────────────────
async function count(table, filterFn = null) {
  if (!filterFn) {
    const sb = getSupabase();
    const { count: c, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    assertOk({ error }, `count:${table}`);
    return c || 0;
  }
  const all = await queryAll(table);
  return all.filter(filterFn).length;
}

function getTable(table) { return queryAll(table); }
function saveToDisk() {}

module.exports = { queryAll, queryOne, insert, update, remove, count, getTable, saveToDisk };
