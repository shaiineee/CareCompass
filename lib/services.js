const path = require('node:path');
const fs = require('node:fs/promises');
const { createClient } = require('@supabase/supabase-js');
const { explainWithAI } = require('./ai');
const cloud = require('./cloud');

let supabase = null;
if (process.env.SUPABASE_ENABLED === 'true' && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
  try { supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) } }); }
  catch { /* A malformed configuration must not prevent local care records from working. */ }
}
let integration = { configured: Boolean(supabase), connected: false, profileTableReady: false, message: supabase ? 'Connection has not been checked yet.' : 'Supabase is not configured; records are saved on this computer.' };
let lastProbe = 0;
let probePromise;
async function checkSupabase(force = false) {
  if (!supabase) return integration;
  if (!force && Date.now() - lastProbe < 30000) return integration;
  if (probePromise) return probePromise;
  probePromise = (async () => {
    const { error } = await supabase.from('tasks').select('*').eq('user_id', 1).limit(1);
    const profileCheck = await supabase.from('carecompass_profiles').select('id').limit(1);
    integration = {
      configured: true, connected: !error || !profileCheck.error,
      profileTableReady: !profileCheck.error,
      message: !profileCheck.error ? 'Supabase profile backup is available.' : !error ? 'Team tasks are connected. Full app records are saved locally; install the supplied SQL migration to enable cloud backup.' : 'Supabase could not be reached or authorised. Records are saved locally; check the server configuration.'
    };
    lastProbe = Date.now();
    return integration;
  })().catch(() => { lastProbe = Date.now(); integration = { ...integration, connected: false, profileTableReady: false, message: 'Supabase is unavailable. Records are saved on this computer.' }; return integration; }).finally(() => { probePromise = null; });
  return probePromise;
}

async function teamTasks() {
  if (!supabase) return { available: false, tasks: [], message: 'Supabase is not configured.' };
  const { data, error } = await supabase.from('tasks').select('*').eq('user_id', 1).limit(30);
  if (error) return { available: false, tasks: [], message: 'Team tasks could not be loaded. Check the Supabase project and key.' };
  return { available: true, tasks: data.map(task => ({ id: String(task.id), title: String(task.title || task.name || task.task_name || task.description || 'Care task'), instruction: [task.title, task.instructions || task.instruction || task.note || task.description].filter(Boolean).join('. '), time: String(task.time || task.scheduled_time || task.due_time || '').slice(0, 5), completed: task.done === true, status: String(task.status || '') })) };
}

async function syncTaskCompletion(id, done) {
  if (!supabase) return false;
  const { data, error } = await supabase.from('tasks').update({ done }).eq('user_id', 1).eq('id', id).select('id').maybeSingle();
  return !error && Boolean(data);
}

function backupProfile(id, profile) {
  if (!supabase) return;
  const snapshot = structuredClone(profile);
  cloud.backupOne(id, snapshot).then(result => {
    if (!result.ok) integration.message = 'Local save succeeded; full-record cloud backup is not yet ready.';
  }).catch(() => { integration.message = 'Local save succeeded; the cloud backup is currently unavailable.'; });
}

let readingImage = false;
async function readDocument(file) {
  const filename = file.originalname;
  const pdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
  const png = file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8;
  if (pdf) {
    try {
      const parse = require('pdf-parse/lib/pdf-parse');
      const result = await parse(file.buffer, { max: 20 });
      if (result.text.trim().length > 20) return { text: result.text.slice(0, 24000), method: 'PDF text extraction', filename };
      return { text: '', method: 'manual review needed', filename, warning: 'This PDF has no readable text. Upload a JPG/PNG of the care plan for OCR, or paste its exact wording.' };
    } catch { return { text: '', method: 'manual review needed', filename, warning: 'This PDF could not be read. Try an unlocked text PDF, a JPG/PNG photo, or paste its exact wording.' }; }
  }
  if (!png && !jpeg) {
    if (/\.txt$/i.test(filename) && !file.buffer.includes(0)) return { text: file.buffer.toString('utf8').slice(0, 24000), method: 'text file', filename };
    const error = new Error('Choose a PDF, JPG, PNG or plain text file.'); error.status = 415; throw error;
  }
  if (readingImage) { const error = new Error('Another image is being read. Please try again in a moment.'); error.status = 429; throw error; }
  readingImage = true;
  let worker;
  let timeout;
  try {
    const { createWorker } = require('tesseract.js');
    const cachePath = path.join(__dirname, '..', '.cache');
    await fs.mkdir(cachePath, { recursive: true });
    const result = await Promise.race([
      (async () => {
        worker = await createWorker('eng', 1, { cachePath, errorHandler: () => {} });
        return worker.recognize(file.buffer);
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('OCR timed out')), 90000); })
    ]);
    const text = result.data.text.trim().slice(0, 24000);
    return { text, method: 'English OCR', confidence: Math.round(result.data.confidence), filename, warning: 'OCR can misread numbers and medicine names. Compare every line against the original document.' };
  } catch { return { text: '', method: 'manual review needed', filename, warning: 'Image reading is unavailable. Paste the exact care-plan wording to continue. OCR needs an internet connection on its first run.' }; }
  finally { clearTimeout(timeout); if (worker) await worker.terminate().catch(() => {}); readingImage = false; }
}

async function optionalAI(message, answer, profile) {
  return explainWithAI(message, answer);
}

async function deliverAlert(alert, profile) {
  if (!process.env.CAREGIVER_WEBHOOK_URL) return { delivery: 'pending', deliveryMessage: 'Saved to the local caregiver inbox. External notification delivery is not configured.' };
  try {
    const response = await fetch(process.env.CAREGIVER_WEBHOOK_URL, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CAREGIVER_WEBHOOK_TOKEN || ''}` }, body: JSON.stringify({ id: alert.id, caregiver: profile.profile.caregiver, patient: profile.profile.name, summary: alert.summary, createdAt: alert.createdAt }) });
    if (!response.ok) throw new Error('Delivery failed');
    return { delivery: 'delivered', deliveryMessage: 'The configured notification service accepted the request.' };
  } catch { return { delivery: 'failed', deliveryMessage: 'Saved locally, but the notification service could not deliver it. Please call your caregiver directly.' }; }
}

module.exports = { checkSupabase, teamTasks, syncTaskCompletion, backupProfile, readDocument, optionalAI, deliverAlert };
