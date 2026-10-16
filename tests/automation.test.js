const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store, today } = require('../lib/store');
const { Scheduler, makeJob } = require('../lib/scheduler');
const { extractStructured, readTimes, sourceContains, analyzeInstruction } = require('../lib/extraction');
const { explainWithAI, extractWithAI, readMedicineLabel } = require('../lib/ai');
const providers = require('../lib/providers');

async function fixture(sender) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carecompass-worker-'));
  const filename = path.join(dir, 'state.json');
  const store = new Store(filename); await store.init(); await store.ensure('test-session');
  await store.change('test-session', profile => { profile.tasks = [{ id: 'care-task', title: 'Synthetic care task', instruction: 'Check your ankles daily.', type: 'checkin', time: '00:00', frequency: 'daily', completedDates: [] }]; profile.reminders = []; profile.profile.patientEmail = 'demo@example.com'; profile.profile.remindersEnabled = true; });
  return { store, filename, worker: new Scheduler(store, { sender }) };
}

test('AM/PM and decimal strengths remain distinct; multiple daily times become separate reviewed candidates', () => {
  assert.deepEqual(readTimes('At 8:00 PM and 08:00 and 12 am and 12 pm.'), ['20:00', '08:00', '00:00', '12:00']);
  const source = 'Take 1 tablet of Examplemed 0.5 mg twice daily at 8 am and 8 pm for 7 days.';
  const tasks = extractStructured(source);
  assert.equal(tasks.length, 2); assert.deepEqual(tasks.map(item => item.time), ['08:00', '20:00']);
  assert.equal(tasks[0].analysis.medicationName, 'Examplemed'); assert.equal(tasks[0].analysis.strengthText, '0.5 mg'); assert.equal(tasks[0].analysis.doseText, '1 tablet'); assert.equal(tasks[0].analysis.durationDays, 7);
  assert.equal(sourceContains(source, source.replace('0.5', '5')), false);
});
test('conditional, tapering and ambiguous abbreviated medicine instructions are blocked from automatic scheduling', () => {
  for (const instruction of ['Take 1 tablet as needed for pain.', 'Take medicine on alternate days.', 'Take medicine OD.', 'Take 1 tablet then reduce the dose.']) assert.equal(analyzeInstruction(instruction).blockedSchedule, true, instruction);
});
test('backend produces one reminder without a browser and retains it across restarts', async () => {
  let sent = 0;
  const f = await fixture(async () => { sent++; return { state: 'accepted', detail: 'Synthetic sender accepted test' }; });
  await f.worker.tick(); await f.worker.tick(); assert.equal(sent, 1);
  assert.equal(f.store.get('test-session').outbox.length, 1);
  const restored = new Store(f.filename); await restored.init();
  await new Scheduler(restored, { sender: async () => { sent++; } }).tick();
  assert.equal(sent, 1); assert.equal(restored.get('test-session').outbox[0].status, 'accepted');
});
test('completing a task before sending cancels its queued reminder', async () => {
  let sent = 0; const f = await fixture(async () => { sent++; return { state: 'accepted' }; });
  await f.store.change('test-session', profile => { profile.tasks[0].completedDates.push(today()); profile.outbox.push(makeJob({ channel: 'email', to: profile.profile.patientEmail, kind: 'reminder', dedupeKey: 'old', sourceId: 'care-task', day: today(), text: 'test' })); });
  await f.worker.tick(); assert.equal(sent, 0); assert.equal(f.store.get('test-session').outbox[0].status, 'cancelled');
});
test('revoked caregiver consent cancels an approved update before transport', async () => {
  let sent = 0; const f = await fixture(async () => { sent++; return { state: 'accepted' }; });
  await f.store.change('test-session', profile => { profile.profile.remindersEnabled = false; profile.alerts.push({ id: 'alert' }); profile.outbox.push(makeJob({ channel: 'email', to: 'caregiver@example.com', kind: 'caregiver', dedupeKey: 'caregiver', alertId: 'alert', text: 'test' })); });
  await f.worker.tick(); assert.equal(sent, 0); assert.equal(f.store.get('test-session').outbox[0].status, 'cancelled');
});
test('interrupted sending becomes unknown and is not automatically sent a second time', async () => {
  let sent = 0; const f = await fixture(async () => { sent++; return { state: 'accepted' }; });
  await f.store.change('test-session', profile => { profile.profile.remindersEnabled = false; const job = makeJob({ channel: 'email', to: 'demo@example.com', kind: 'test', dedupeKey: 'interrupted', text: 'test' }); job.status = 'sending'; profile.outbox.push(job); });
  await f.worker.recover(); await f.worker.tick(); assert.equal(sent, 0); assert.equal(f.store.get('test-session').outbox[0].status, 'unknown');
});
test('no email account means blocked sending, not a delivered claim', async () => {
  const keys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'RESEND_API_KEY'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]])); keys.forEach(key => { delete process.env[key]; });
  try { assert.equal((await providers.sendEmail({ to: 'demo@example.com', text: 'test' })).state, 'blocked'); }
  finally { for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});
test('AI output with an altered decimal or invented source is rejected', async () => {
  const keys = ['AI_CHAT_URL', 'AI_API_KEY', 'AI_MODEL']; const old = Object.fromEntries(keys.map(key => [key, process.env[key]])); const fetch = global.fetch;
  Object.assign(process.env, { AI_CHAT_URL: 'https://example.invalid/chat', AI_API_KEY: 'synthetic-test', AI_MODEL: 'synthetic-model' });
  const source = 'Take Examplemed 0.5 mg daily at 08:00.';
  try {
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ explanation: 'Take 5 mg daily.', sourceQuote: source }) } }] }), { headers: { 'Content-Type': 'application/json' } });
    const result = await explainWithAI('Explain this', { kind: 'grounded', source, text: 'Original source guidance' });
    assert.equal(result.providerStatus, 'rejected-unsupported-output'); assert.equal(result.text, 'Original source guidance');
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ instructions: ['Take an invented medicine daily.'] }) } }] }), { headers: { 'Content-Type': 'application/json' } });
    const parsed = await extractWithAI(source, extractStructured(source)); assert.equal(parsed.aiStatus, 'invalid-source-quotes');
  } finally { global.fetch = fetch; for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});
test('AI medicine label reading builds reviewable source text and cross-checks it against OCR', async () => {
  const keys = ['AI_CHAT_URL', 'AI_API_KEY', 'AI_MODEL']; const old = Object.fromEntries(keys.map(key => [key, process.env[key]])); const fetch = global.fetch;
  Object.assign(process.env, { AI_CHAT_URL: 'https://example.invalid/chat', AI_API_KEY: 'synthetic-test', AI_MODEL: 'synthetic-vision' });
  const image = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg' };
  const reply = value => async (url, options) => { const body = JSON.parse(options.body); assert.equal(body.messages[1].content[1].type, 'image_url'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    global.fetch = reply({ isMedicineLabel: true, name: 'Examplemed', strength: '5 mg', form: 'tablet', directions: 'Take 1 tablet of Examplemed 5 mg once daily at 8 am.', warnings: ['May cause drowsiness'] });
    const label = await readMedicineLabel(image, 'EXAMPLEMED 5mg tablets Take 1 tablet once daily');
    assert.equal(label.ok, true); assert.deepEqual(label.matched, { name: true, strength: true });
    assert.match(label.sourceText, /^Medicine: Examplemed 5 mg tablet\nTake 1 tablet/);
    const tasks = extractStructured(label.sourceText); assert.ok(tasks.some(task => task.time === '08:00'));
    const unconfirmed = await readMedicineLabel(image, 'blurry'); assert.deepEqual(unconfirmed.matched, { name: false, strength: false });
    global.fetch = reply({ isMedicineLabel: false });
    assert.equal((await readMedicineLabel(image, '')).aiStatus, 'not-a-medicine-label');
    global.fetch = reply({ isMedicineLabel: true, name: 'Examplemed', directions: '' });
    assert.equal((await readMedicineLabel(image, '')).aiStatus, 'label-unreadable');
  } finally { global.fetch = fetch; for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});
test('email/SMS adapters preserve provider acceptance and sending uncertainty instead of declaring delivery', async () => {
  const keys = ['EMAIL_FROM', 'RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']; const old = Object.fromEntries(keys.map(key => [key, process.env[key]])); const fetch = global.fetch;
  Object.assign(process.env, { EMAIL_FROM: 'sender@example.com', RESEND_API_KEY: 'synthetic-key', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'synthetic-token', TWILIO_FROM: '+12025550100' });
  try {
    let idempotency;
    global.fetch = async (url, options) => { idempotency = options.headers['Idempotency-Key']; return new Response(JSON.stringify({ id: 'synthetic-email-id' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    const email = await providers.sendEmail({ to: 'demo@example.com', subject: 'Synthetic test', text: 'Synthetic test', id: 'stable-job-id' });
    assert.equal(email.state, 'accepted'); assert.equal(idempotency, 'stable-job-id'); assert.ok(email.detail.includes('not been confirmed'));
    global.fetch = async () => new Response(JSON.stringify({ sid: 'synthetic-sms-id', status: 'queued' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    assert.equal((await providers.sendSMS({ to: '+12025550101', text: 'Synthetic test' })).state, 'accepted');
    global.fetch = async () => { throw new Error('Synthetic network interruption'); };
    assert.equal((await providers.sendSMS({ to: '+12025550101', text: 'Synthetic test' })).state, 'unknown');
  } finally { global.fetch = fetch; for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});
test('cloud adapter writes and restores the matching synthetic profile and settings never return a saved key', async () => {
  const keys = ['SUPABASE_ENABLED', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'AI_API_KEY']; const old = Object.fromEntries(keys.map(key => [key, process.env[key]])); const fetch = global.fetch;
  Object.assign(process.env, { SUPABASE_ENABLED: 'true', SUPABASE_URL: 'https://synthetic-project.supabase.co', SUPABASE_SECRET_KEY: 'synthetic-service-key', AI_API_KEY: 'synthetic-private-ai-key' });
  try {
    let saved;
    global.fetch = async (url, options) => {
      if (options.method === 'POST') { saved = JSON.parse(options.body); return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } }); }
      return new Response(JSON.stringify([{ data: saved.data, updated_at: saved.updated_at }]), { headers: { 'Content-Type': 'application/json' } });
    };
    const cloud = require('../lib/cloud');
    const profile = { profile: { name: 'Synthetic person' }, tasks: [], plans: [] };
    assert.equal((await cloud.backupOne('synthetic-profile', profile, true)).ok, true);
    assert.deepEqual((await cloud.restoreOne('synthetic-profile')).data, profile);
    const publicConfig = require('../lib/configuration').publicConfiguration();
    assert.equal(publicConfig.AI_API_KEY.configured, true);
    assert.equal(JSON.stringify(publicConfig).includes('synthetic-private-ai-key'), false);
  } finally { global.fetch = fetch; for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});

test('in-app reminders require no provider and record saved rather than delivered', async () => {
  const f = await fixture(providers.sendNotification);
  await f.store.change('test-session', p => { p.profile.reminderChannel = 'inapp'; p.profile.patientEmail = ''; p.profile.patientPhone = ''; });
  await f.worker.tick(); await f.worker.tick();
  const profile = f.store.get('test-session');
  assert.equal(profile.outbox.length, 1); assert.equal(profile.outbox[0].status, 'saved');
  assert.equal(profile.outbox[0].provider, 'local inbox'); assert.equal(profile.notifications.length, 1);
});

test('legacy cloud stays disabled even if stray credentials exist', async () => {
  const old = process.env.SUPABASE_ENABLED;
  process.env.SUPABASE_ENABLED = 'false';
  try { assert.equal((await require('../lib/cloud').backupOne('test', { tasks: [] }, true)).ok, false); }
  finally { if (old === undefined) delete process.env.SUPABASE_ENABLED; else process.env.SUPABASE_ENABLED = old; }
});
