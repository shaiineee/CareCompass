const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { evaluateCheckIn, planAnswer } = require('../lib/care');
const { seedProfile, today, addDays } = require('../lib/store');

let server, base, folder, cookie;
const dataFile = () => path.join(folder, 'test-state.json');
async function start() {
  const app = await createApp({ dataFile: dataFile(), skipExternal: true });
  server = app.listen(0, 'localhost');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
}
async function request(url, { method = 'GET', body, headers = {}, session = true } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(`${base}${url}`, { method, headers: { ...(session && cookie ? { Cookie: cookie } : {}), 'X-CareCompass-Client': 'web', ...(form ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  if (session && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, data, response };
}
before(async () => { folder = await fs.mkdtemp(path.join(os.tmpdir(), 'carecompass-test-')); await start(); });
after(async () => { await new Promise(resolve => server.close(resolve)); /* Retain isolated temp results for inspection. */ });

test('only localhost and the configured Render hostname are accepted', async () => {
  const http = require('node:http');
  const old = process.env.RENDER_EXTERNAL_HOSTNAME; process.env.RENDER_EXTERNAL_HOSTNAME = 'carecompass.onrender.com';
  const app = await createApp({ dataFile: path.join(folder, 'host-state.json'), skipExternal: true });
  const hosted = app.listen(0, 'localhost'); await new Promise(resolve => hosted.once('listening', resolve));
  const status = host => new Promise((resolve, reject) => http.get({ port: hosted.address().port, host: 'localhost', path: '/api/health', headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  try {
    assert.equal(await status('carecompass.onrender.com'), 200);
    assert.equal(await status('evil.example.com'), 403);
  } finally { await new Promise(resolve => hosted.close(resolve)); if (old === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME; else process.env.RENDER_EXTERNAL_HOSTNAME = old; }
});
test('frontend and API share a server; credentials are not served', async () => {
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/app.js')).status, 200);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/data/app-state.json')).status, 404);
  assert.equal((await request('/api/health')).data.ok, true);
});
test('records are scoped to a browser session and persist across server restarts', async () => {
  const first = (await request('/api/state')).data;
  assert.equal(first.tasks.length, 3);
  const task = first.tasks[0];
  assert.equal((await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { completed: true } })).status, 200);
  assert.ok((await request('/api/state')).data.tasks[0].completedDates.includes(today()));
  const other = (await request('/api/state', { session: false })).data;
  assert.notEqual(other.tasks[0].id, task.id);
  await new Promise(resolve => server.close(resolve));
  await start();
  assert.ok((await request('/api/state')).data.tasks[0].completedDates.includes(today()));
});
test('check-ins validate input and record server-side normal, review and urgent outcomes', async () => {
  assert.equal((await request('/api/checkins', { method: 'POST', body: { pain: 99, change: 'same' } })).status, 400);
  const normal = await request('/api/checkins', { method: 'POST', body: { pain: 2, change: 'better', notes: 'Less discomfort today' } });
  assert.equal(normal.data.decision.level, 'recorded');
  const worsening = await request('/api/checkins', { method: 'POST', body: { pain: 4, change: 'worse' } });
  assert.equal(worsening.data.decision.level, 'review');
  const urgent = await request('/api/checkins', { method: 'POST', body: { pain: 2, change: 'same', notes: 'Ankle check and chest pain' } });
  assert.equal(urgent.data.decision.level, 'urgent');
  assert.equal((await request('/api/state')).data.checkIns.length, 3);
});
test('persistent discomfort counts distinct days rather than repeated submissions', () => {
  const sameDay = Array.from({ length: 10 }, () => ({ pain: 4, change: 'same', date: new Date().toISOString(), day: today() }));
  assert.equal(evaluateCheckIn({ pain: 4, change: 'same', notes: '' }, sameDay).level, 'recorded');
  const days = Array.from({ length: 6 }, (_, i) => ({ pain: 4, change: 'same', date: `${addDays(today(), -i - 1)}T12:00:00Z`, day: addDays(today(), -i - 1) }));
  assert.equal(evaluateCheckIn({ pain: 4, change: 'same', notes: '' }, days).level, 'review');
});
test('urgent chat takes precedence over a medicine keyword; unsupported advice is refused', async () => {
  const urgent = await request('/api/chat', { method: 'POST', body: { message: 'My medicine and chest pain worry me' } });
  assert.equal(urgent.data.kind, 'urgent');
  const unsupported = await request('/api/chat', { method: 'POST', body: { message: 'Diagnose this unknown rash' } });
  assert.equal(unsupported.data.kind, 'unsupported');
  const dose = await request('/api/chat', { method: 'POST', body: { message: 'Can I double the dose?' } });
  assert.equal(dose.data.kind, 'clarification');
});
test('teach-back detects possible medication changes and retains the source', () => {
  const answer = planAnswer('I will double my blood pressure medicine', seedProfile(), 'teachback');
  assert.equal(answer.kind, 'teachback-review');
  assert.ok(answer.source.includes('dispensing label'));
});
test('care plan upload reads the actual file, and drafts cannot schedule themselves', async () => {
  const before = (await request('/api/state')).data.tasks.length;
  const form = new FormData(); form.append('file', new Blob(['Check your ankles daily at 19:00. Record any change.'], { type: 'text/plain' }), 'care-plan.txt');
  const uploaded = await request('/api/plans/upload', { method: 'POST', body: form });
  assert.equal(uploaded.status, 201); assert.ok(uploaded.data.sourceText.includes('19:00')); assert.equal(uploaded.data.method, 'text file');
  assert.equal((await request('/api/state')).data.tasks.length, before);
  const candidate = uploaded.data.candidates[0];
  assert.equal((await request(`/api/plans/${uploaded.data.id}/confirm`, { method: 'POST', body: { tasks: [candidate] } })).status, 400);
  const invented = { ...candidate, instruction: 'Take a new drug that is absent from the source' };
  assert.equal((await request(`/api/plans/${uploaded.data.id}/confirm`, { method: 'POST', body: { confirmed: true, tasks: [invented] } })).status, 400);
  assert.equal((await request('/api/state')).data.tasks.length, before);
  const confirmed = await request(`/api/plans/${uploaded.data.id}/confirm`, { method: 'POST', body: { confirmed: true, tasks: [candidate] } });
  assert.equal(confirmed.status, 201);
  await request(`/api/plans/${uploaded.data.id}/confirm`, { method: 'POST', body: { confirmed: true, tasks: [candidate] } });
  assert.equal((await request('/api/state')).data.tasks.length, before + 1, 'double-click must not duplicate a schedule');
});
test('unsupported file types are rejected rather than pretending to perform OCR', async () => {
  const form = new FormData(); form.append('file', new Blob(['<script>example</script>']), 'unsafe.html');
  assert.equal((await request('/api/plans/upload', { method: 'POST', body: form })).status, 415);
});
test('future daily tasks start on their chosen date and multi-dose instructions cannot silently become one reminder', async () => {
  const sourceText = 'Take your prescribed medicine twice daily. Follow the dispensing label.';
  const draft = (await request('/api/plans/text', { method: 'POST', body: { sourceText } })).data;
  const candidate = { title: 'Medicine', instruction: 'Take your prescribed medicine twice daily.', type: 'medication', time: '08:00', frequency: 'daily', date: addDays(today(), 2) };
  assert.equal((await request(`/api/plans/${draft.id}/confirm`, { method: 'POST', body: { confirmed: true, tasks: [candidate] } })).status, 400);
  const result = await request(`/api/plans/${draft.id}/confirm`, { method: 'POST', body: { confirmed: true, tasks: [candidate, { ...candidate, time: '20:00' }] } });
  assert.equal(result.status, 201);
  const eventsToday = (await request(`/api/calendar?from=${today()}&to=${today()}`)).data;
  assert.equal(eventsToday.some(item => item.planId === result.data.id), false);
  const onStart = (await request(`/api/calendar?from=${candidate.date}&to=${candidate.date}`)).data;
  assert.equal(onStart.filter(item => item.planId === result.data.id).length, 2);
});
test('reminders are saved, visible on their date, and removable', async () => {
  const result = await request('/api/reminders', { method: 'POST', body: { title: 'Integration test appointment', date: today(), time: '12:30', type: 'appointment', notes: 'Synthetic test' } });
  assert.equal(result.status, 201);
  const events = (await request(`/api/calendar?from=${today()}&to=${today()}`)).data;
  assert.ok(events.some(item => item.id === result.data.id));
  assert.equal((await request(`/api/reminders/${result.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/reminders', { method: 'POST', body: { title: 'Bad date', date: '2026-02-31', time: '12:30', type: 'reminder' } })).status, 400);
});
test('caregiver sharing requires standing permission and specific approval', async () => {
  assert.equal((await request('/api/alerts', { method: 'POST', body: { confirmed: true } })).status, 403);
  await request('/api/profile', { method: 'PATCH', body: { caregiverConsent: true } });
  assert.equal((await request('/api/alerts', { method: 'POST', body: {} })).status, 403);
  const preview = await request('/api/alerts/preview', { method: 'POST', body: {} });
  const approved = await request('/api/alerts', { method: 'POST', body: { confirmed: true, previewId: preview.data.id } });
  assert.equal(approved.status, 201); assert.equal(approved.data.delivery, 'pending');
  assert.equal(approved.data.summary, preview.data.summary, 'the approved update must be exactly the preview');
  assert.ok(approved.data.summary.includes('Recorded check-ins'.toUpperCase()));
  const ack = await request(`/api/alerts/${approved.data.id}`, { method: 'PATCH', body: {} });
  assert.ok(ack.data.acknowledgedAt);
});
test('handover contains recorded facts and source instructions', async () => {
  const result = await request('/api/summary');
  assert.equal(result.status, 200); assert.ok(result.data.includes('discomfort 2/10')); assert.ok(result.data.includes('Source instruction:'));
});
test('cross-site changes and unmarked mutation requests are blocked', async () => {
  assert.equal((await request('/api/profile', { method: 'PATCH', body: { name: 'Blocked' }, headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await request('/api/profile', { method: 'PATCH', body: { name: 'Blocked' }, headers: { 'X-CareCompass-Client': '' } })).status, 403);
});

test('local backup round trip restores care records without replaying consent or sending jobs', async () => {
  await request('/api/profile', { method: 'PATCH', body: { reminderChannel: 'inapp', remindersEnabled: true, caregiverConsent: true } });
  const exported = await request('/api/backup/export');
  assert.equal(exported.status, 200); assert.equal(exported.data.format, 'carecompass-backup');
  assert.deepEqual(exported.data.profile.outbox, []);
  assert.equal(JSON.stringify(exported.data).includes('SMTP_PASS'), false);
  await request('/api/profile', { method: 'PATCH', body: { name: 'Temporary change' } });
  assert.equal((await request('/api/backup/import', { method: 'POST', body: { backup: exported.data } })).status, 400);
  const result = await request('/api/backup/import', { method: 'POST', body: { confirmed: true, backup: exported.data } });
  assert.equal(result.status, 200);
  const state = (await request('/api/state')).data;
  assert.equal(state.profile.name, exported.data.profile.profile.name);
  assert.equal(state.profile.remindersEnabled, false); assert.equal(state.profile.caregiverConsent, false);
  assert.deepEqual(state.outbox, []);
});

test('invalid backup structure is rejected without changing current records', async () => {
  const original = (await request('/api/state')).data;
  const backup = (await request('/api/backup/export')).data;
  backup.profile.tasks[0].completedDates = 'not-an-array';
  assert.equal((await request('/api/backup/import', { method: 'POST', body: { confirmed: true, backup } })).status, 400);
  assert.deepEqual((await request('/api/state')).data.tasks, original.tasks);
});
