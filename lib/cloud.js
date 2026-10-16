const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
let lastStatus = { ready: false, lastSuccessAt: null, message: 'Cloud backup has not been checked.' };
const hashes = new Map();
const backupQueues = new Map();
function client() {
  if (process.env.SUPABASE_ENABLED !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12000) }) } });
}
async function cloudReady() {
  const db = client(); if (!db) return lastStatus = { ...lastStatus, ready: false, message: 'Supabase credentials are not configured.' };
  const { error } = await db.from('carecompass_profiles').select('id').limit(1);
  lastStatus = { ...lastStatus, ready: !error, message: error ? 'The full-record backup table is unavailable. Create it in the team Supabase project first.' : 'The full-record backup table is accessible.' };
  return lastStatus;
}
function backupOne(id, profile, force = false) {
  const snapshot = structuredClone(profile);
  const run = (backupQueues.get(id) || Promise.resolve()).then(() => performBackup(id, snapshot, force));
  backupQueues.set(id, run.catch(() => {}));
  return run;
}
async function performBackup(id, profile, force = false) {
  const db = client(); if (!db) return { ok: false, message: 'Supabase is not configured.' };
  const snapshot = structuredClone(profile);
  const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  if (!force && hashes.get(id) === hash) return { ok: true, unchanged: true };
  const { error } = await db.from('carecompass_profiles').upsert({ id, data: snapshot, updated_at: new Date().toISOString() });
  if (error) { lastStatus = { ...lastStatus, ready: false, message: 'Local records are saved; cloud backup failed. Check the table and server permissions.' }; return { ok: false, message: lastStatus.message }; }
  hashes.set(id, hash); lastStatus = { ready: true, lastSuccessAt: new Date().toISOString(), message: 'Full-record cloud backup succeeded.' };
  return { ok: true, message: lastStatus.message, at: lastStatus.lastSuccessAt };
}
async function restoreOne(id) {
  const db = client(); if (!db) throw new Error('Supabase is not configured.');
  const { data, error } = await db.from('carecompass_profiles').select('data,updated_at').eq('id', id).maybeSingle();
  if (error || !data) throw new Error('No readable cloud backup exists for this browser’s profile.');
  if (!data.data?.profile || !Array.isArray(data.data.tasks) || !Array.isArray(data.data.plans)) throw new Error('The cloud record has an unexpected format. It was not restored.');
  return data;
}
async function migrateDatabase() {
  if (process.env.SUPABASE_ENABLED !== 'true') return { ok: false, message: 'Optional cloud integration is disabled. No database account is needed for this release.' };
  if (!process.env.DATABASE_URL) return { ok: false, message: 'The database API key cannot run schema migrations. Use the team project’s SQL Editor, or supply its PostgreSQL database connection string.' };
  try {
    const expected = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
    const target = new URL(process.env.DATABASE_URL);
    if (!`${target.hostname} ${decodeURIComponent(target.username)}`.includes(expected)) return { ok: false, message: 'This PostgreSQL connection does not identify the currently configured Supabase project. Obtain the matching connection from the project owner.' };
  } catch { return { ok: false, message: 'Supply valid matching Supabase and PostgreSQL connection settings.' }; }
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, ssl: { rejectUnauthorized: true } });
  try {
    await db.connect(); const sql = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
    await db.query('BEGIN'); await db.query(sql); await db.query('COMMIT'); return { ok: true, message: 'The backup table is ready. Existing team tasks were not changed.' };
  } catch { await db.query('ROLLBACK').catch(() => {}); return { ok: false, message: 'Table creation failed. Check that this is the team project’s PostgreSQL admin connection string and that your connection is permitted.' }; }
  finally { await db.end().catch(() => {}); }
}
module.exports = { cloudReady, backupOne, restoreOne, migrateDatabase, status: () => ({ ...lastStatus }) };
