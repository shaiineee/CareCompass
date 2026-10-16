const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'carecompass-handover-'));
  const app = await createApp({ dataFile: path.join(directory, 'state.json'), skipExternal: true, startScheduler: true });
  const server = app.listen(0, 'localhost'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const initial = await fetch(`${base}/api/state`); const cookie = initial.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-CareCompass-Client': 'web' };
    const state = await initial.json();
    let result = await fetch(`${base}/api/profile`, { method: 'PATCH', headers, body: JSON.stringify({ reminderChannel: 'inapp', remindersEnabled: true }) }); assert.equal(result.status, 200);
    result = await fetch(`${base}/api/reminders`, { method: 'POST', headers, body: JSON.stringify({ title: 'Synthetic handover timer test', date: state.today, time: '00:00', type: 'reminder' }) }); assert.equal(result.status, 201);
    const reminder = await result.json();
    // No browser exists and no client polling occurs while the real timer runs.
    await new Promise(resolve => setTimeout(resolve, 16500));
    result = await fetch(`${base}/api/notifications`, { headers }); const saved = await result.json();
    const job = saved.jobs.find(item => item.sourceId === reminder.id);
    assert.equal(job?.status, 'saved'); assert.equal(job.provider, 'local inbox');
    console.log('PASS actual 15-second background timer saves an in-app reminder without any browser or provider.');
    const backup = await (await fetch(`${base}/api/backup/export`, { headers })).json();
    assert.equal(backup.format, 'carecompass-backup'); assert.deepEqual(backup.profile.outbox, []);
    console.log('PASS portable backup excludes pending transport jobs.');
  } finally { app.locals.stopWorkers(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
