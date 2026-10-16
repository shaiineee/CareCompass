require('dotenv').config({ quiet: true });
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { Store, today, uid, addDays, audit, seedProfile, emptyProfile, DEMO_SOURCE } = require('./lib/store');
const { evaluateCheckIn, extractCandidates, planAnswer, normalize } = require('./lib/care');
const services = require('./lib/services');
const { analyzeInstruction, sourceContains } = require('./lib/extraction');
const { extractWithAI, readMedicineLabel } = require('./lib/ai');
const { Scheduler, makeJob } = require('./lib/scheduler');
const providers = require('./lib/providers');
const configuration = require('./lib/configuration');
const cloud = require('./lib/cloud');
const auth = require('./lib/auth');
const { makeBackup, readBackup } = require('./lib/backup');

const string = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function fail(message, status = 400) { const error = new Error(message); error.status = status; error.expose = true; throw error; }
function isDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value); }
const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function summary(profile) {
  const latest = profile.checkIns.at(-1);
  return [
    'CARECOMPASS — FACTUAL CARE HANDOVER', 'Synthetic demonstration profile. Not a diagnosis or clinical record.',
    `Generated: ${new Date().toISOString()}`, `Name: ${profile.profile.name}`, '',
    ...profile.tasks.filter(task => !task.archived).map(task => `Care task: ${task.title}\nSource instruction: ${task.instruction}\nCompleted today: ${task.completedDates.includes(today()) ? 'yes' : 'no'}`), '',
    'RECORDED CHECK-INS (up to the last 14)', ...profile.checkIns.slice(-14).map(item => `${item.date}: discomfort ${item.pain}/10; change ${item.change}; notes: ${item.notes || 'none'}; gate: ${item.decision.rule}; outcome: ${item.decision.level}`), '',
    `Latest escalation: ${latest?.decision.level || 'No check-in recorded'}`, 'Professional interpretation and follow-up are required for clinical decisions.'
  ].join('\n');
}

async function createApp(options = {}) {
  const app = express();
  const store = new Store(options.dataFile || path.join(__dirname, 'data', 'app-state.json'));
  await store.init();
  const scheduler = new Scheduler(store, { onChange: (id, profile) => { if (!options.skipExternal) services.backupProfile(id, profile); } });
  app.locals.scheduler = scheduler;
  if (options.startScheduler) await scheduler.start();
  let cloudTimer;
  if (options.startScheduler && !options.skipExternal && process.env.SUPABASE_ENABLED === 'true') {
    cloudTimer = setInterval(async () => { try { if ((await cloud.cloudReady()).ready) for (const [id, profile] of store.entries()) await cloud.backupOne(id, profile); } catch { /* Local records remain authoritative until the next retry. */ } }, 60000);
    cloudTimer.unref();
  }
  app.locals.stopWorkers = () => { scheduler.stop(); clearInterval(cloudTimer); };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  const limits = new Map();

  // Render sets RENDER_EXTERNAL_HOSTNAME automatically; ALLOWED_HOSTS adds custom domains (comma-separated).
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', process.env.RENDER_EXTERNAL_HOSTNAME, ...(process.env.ALLOWED_HOSTS || '').split(',')].map(host => host?.trim().toLowerCase()).filter(Boolean));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.hostname)) return res.status(403).json({ error: 'This application accepts local connections only.' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  // Sign-in is required whenever Supabase Auth is available; without it the app stays a local demo.
  const authRequired = options.requireAuth ?? (!options.skipExternal && auth.ready());
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: Boolean(process.env.RENDER), maxAge: 30 * 86400000, path: '/' };
  const setAuthCookies = (res, user) => { res.cookie('cc_token', user.accessToken, cookieOptions); res.cookie('cc_refresh', user.refreshToken, cookieOptions); res.clearCookie('cc_demo', { path: '/' }); };
  const clearAuthCookies = res => { res.clearCookie('cc_token', { path: '/' }); res.clearCookie('cc_refresh', { path: '/' }); };
  app.use('/api', async (req, res, next) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.get('X-CareCompass-Client') !== 'web') return res.status(403).json({ error: 'Open CareCompass and try the action again.' });
        if (req.get('Origin')) {
          const origin = new URL(req.get('Origin'));
          if (origin.host !== req.get('Host')) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
        }
      }
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(([key]) => key).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]));
      req.cookies = cookies;
      // A signed-in user is identified only by a verified Supabase token, never by a cookie value alone.
      let id = null;
      if (cookies.cc_token) {
        let user = await auth.getUserByToken(cookies.cc_token);
        if (!user && cookies.cc_refresh) { const fresh = await auth.refresh(cookies.cc_refresh); if (fresh) { setAuthCookies(res, fresh); user = fresh; } }
        if (user) { id = user.id; req.user = user; } else clearAuthCookies(res);
      }
      if (!id) {
        id = cookies.cc_session;
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { id = uid(); res.cookie('cc_session', id, cookieOptions); }
        req.demo = cookies.cc_demo === '1';
        if (authRequired && !req.demo && !req.path.startsWith('/auth/') && req.path !== '/health') return res.status(401).json({ error: 'Please sign in or try the demo first.', signInRequired: true });
      }
      req.sessionId = id;
      const isUpload = ['/plans/upload', '/medicines/scan'].includes(req.path);
      const key = `${id}:${isUpload ? 'upload' : 'api'}`;
      const now = Date.now();
      const entry = limits.get(key) || { start: now, count: 0 };
      if (now - entry.start > 60000) { entry.start = now; entry.count = 0; }
      entry.count++;
      limits.set(key, entry);
      if (entry.count > (isUpload ? 6 : 180)) return res.status(429).json({ error: 'Please wait a moment before trying again.' });
      if (limits.size > 2000) for (const [oldKey, old] of limits) if (now - old.start > 60000) limits.delete(oldKey);
      if (req.user) await store.ensure(id, () => emptyProfile(req.user.name));
      else if (!authRequired || req.demo) await store.ensure(id);
      next();
    } catch (error) { next(error); }
  });
  const profile = req => store.get(req.sessionId);
  const mutate = async (req, fn) => {
    const result = await store.change(req.sessionId, fn);
    if (!options.skipExternal) services.backupProfile(req.sessionId, profile(req));
    return result;
  };

  // ─── Auth routes (register, login, demo, logout, me) ───
  // Uses Supabase Auth server-side. The verified Supabase user ID is the profile ID,
  // so each account has its own care records, starting empty with the user's name.
  const publicUser = user => ({ id: user.id, email: user.email, name: user.name });
  app.post('/api/auth/register', async (req, res) => {
    const name = string(req.body.name, 80);
    const email = string(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!name) fail('Please enter your name.');
    if (!email || !email.includes('@')) fail('Please enter a valid email address.');
    if (password.length < 6) fail('Password must be at least 6 characters long.');
    if (!auth.ready()) fail('Sign-up is not available because Supabase is not configured.');
    const user = await auth.register(email, password, name).catch(error => fail(error.message));
    await store.ensure(user.id, () => emptyProfile(name));
    setAuthCookies(res, user);
    res.status(201).json({ ok: true, user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = string(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) fail('Please enter your email and password.');
    if (!auth.ready()) fail('Sign-in is not available because Supabase is not configured.');
    const user = await auth.login(email, password).catch(error => fail(error.message, 401));
    await store.ensure(user.id, () => emptyProfile(user.name));
    setAuthCookies(res, user);
    res.json({ ok: true, user: publicUser(user) });
  });

  // The demo keeps the synthetic Mr Rahman profile available without an account.
  app.post('/api/auth/demo', async (req, res) => {
    res.cookie('cc_demo', '1', cookieOptions);
    await store.ensure(req.sessionId);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookies(res); res.clearCookie('cc_demo', { path: '/' });
    res.cookie('cc_session', uid(), cookieOptions);
    res.json({ ok: true, message: 'You have been signed out.' });
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, demo: Boolean(req.demo), authRequired }));

  app.get('/api/health', async (req, res) => res.json({ ok: true, date: today(), storage: 'local persistent records', supabase: options.skipExternal ? { configured: false, connected: false, message: 'External services disabled for this test.' } : await services.checkSupabase(), ai: { configured: providers.providerStatus().ai, defaultMode: 'confirmed-plan guidance and source comparison' }, notifications: { configured: providers.providerStatus().email || providers.providerStatus().sms || Boolean(process.env.CAREGIVER_WEBHOOK_URL), ...providers.providerStatus() }, scheduler: scheduler.status(), cloud: cloud.status() }));
  app.get('/api/state', (req, res) => {
    const data = structuredClone(profile(req));
    delete data.drafts;
    res.json({ ...data, today: today() });
  });
  app.get('/api/backup/export', (req, res) => res.attachment(`carecompass-backup-${today()}.json`).json(makeBackup(profile(req))));
  app.post('/api/backup/import', async (req, res) => {
    if (req.body.confirmed !== true) fail('Confirm before replacing this browser’s saved care records.');
    let restored;
    try { restored = readBackup(req.body.backup); } catch (error) { fail(error.message); }
    await store.change(req.sessionId, data => {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, restored);
      audit(data, 'local_backup_restored', { remindersRequireReenabling: true, sharingRequiresNewConsent: true });
    });
    res.json({ ok: true, message: 'Backup restored. Review the care plan, reminders and sharing preferences before using it.' });
  });
  app.patch('/api/profile', async (req, res) => {
    const result = await mutate(req, data => {
      const allowed = ['English', '简体中文', 'Bahasa Melayu', 'தமிழ்'];
      if ('name' in req.body) { const value = string(req.body.name, 60); if (!value) fail('Please enter a display name.'); data.profile.name = value; }
      if ('caregiver' in req.body) data.profile.caregiver = string(req.body.caregiver, 60);
      if ('caregiverPhone' in req.body) { const phone = string(req.body.caregiverPhone, 25); if (phone && !/^\+?[\d\s()-]{6,25}$/.test(phone)) fail('Enter a valid caregiver telephone number.'); data.profile.caregiverPhone = phone; }
      for (const key of ['patientEmail', 'caregiverEmail']) if (key in req.body) { const email = string(req.body[key], 254); if (email && !providers.emailValid(email)) fail('Enter a valid email address.'); data.profile[key] = email; }
      if ('patientPhone' in req.body) { const phone = string(req.body.patientPhone, 25); if (phone && !providers.phoneValid(phone)) fail('Use an international telephone number beginning with + and the country code.'); data.profile.patientPhone = phone; }
      for (const key of ['reminderChannel', 'caregiverChannel']) if (key in req.body) { if (!(key === 'reminderChannel' ? ['inapp', 'email', 'sms'] : ['email', 'sms']).includes(req.body[key])) fail('Choose an available notification channel.'); data.profile[key] = req.body[key]; }
      if ('remindersEnabled' in req.body) { if (typeof req.body.remindersEnabled !== 'boolean') fail('Choose whether to enable reminders.'); data.profile.remindersEnabled = req.body.remindersEnabled; }
      if (data.profile.remindersEnabled && data.profile.reminderChannel !== 'inapp' && !(data.profile.reminderChannel === 'sms' ? providers.phoneValid(data.profile.patientPhone) : providers.emailValid(data.profile.patientEmail))) fail('Add your email or international telephone number, or choose the in-app inbox.');
      if ('caregiverConsent' in req.body) { if (typeof req.body.caregiverConsent !== 'boolean') fail('Consent must be true or false.'); data.profile.caregiverConsent = req.body.caregiverConsent; }
      if ('language' in req.body) { if (!allowed.includes(req.body.language)) fail('Choose one of the supported languages.'); data.profile.language = req.body.language; }
      if ('largeText' in req.body) data.profile.largeText = req.body.largeText === true;
      audit(data, 'profile_updated', { caregiverConsent: data.profile.caregiverConsent });
      return data.profile;
    });
    res.json(result);
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    const result = await mutate(req, data => {
      const task = data.tasks.find(item => item.id === req.params.id && !item.archived);
      if (!task) fail('This care task could not be found.', 404);
      if (task.startDate && task.startDate > today() || task.frequency === 'once' && task.date !== today()) fail('This task is not scheduled for today.');
      if (req.body.completed !== true && req.body.completed !== false) fail('Choose completed or not completed.');
      const date = today();
      task.completedDates = task.completedDates.filter(day => day !== date);
      if (req.body.completed) task.completedDates.push(date);
      audit(data, 'task_completion_changed', { taskId: task.id, date, completed: req.body.completed });
      return task;
    });
    if (result.remoteId && !options.skipExternal) {
      const synced = await services.syncTaskCompletion(result.remoteId, req.body.completed);
      return res.json({ ...result, remoteSynced: synced, syncMessage: synced ? 'Saved to the team database.' : 'Saved locally; the team database could not be updated.' });
    }
    res.json(result);
  });

  app.post('/api/checkins', async (req, res) => {
    const { pain, change } = req.body;
    if (!Number.isInteger(pain) || pain < 0 || pain > 10 || !['better', 'same', 'worse', 'sudden'].includes(change)) fail('Select a discomfort rating and a change before continuing.');
    const notes = string(req.body.notes, 2000);
    const result = await mutate(req, data => {
      const task = req.body.taskId ? data.tasks.find(item => item.id === req.body.taskId && !item.archived && item.type === 'checkin') : data.tasks.find(item => item.type === 'checkin' && !item.archived);
      if (req.body.taskId && !task) fail('The selected check-in task is no longer available.', 404);
      const decision = evaluateCheckIn({ pain, change, notes }, data.checkIns.filter(item => !task || item.taskId === task.id));
      const checkin = { id: uid(), date: new Date().toISOString(), day: today(), taskId: task?.id || null, taskTitle: task?.title || 'General check-in', pain, change, notes, decision };
      data.checkIns.push(checkin);
      if (task && !task.completedDates.includes(today())) task.completedDates.push(today());
      audit(data, 'checkin_recorded', { checkinId: checkin.id, pain, change, rule: decision.rule, outcome: decision.level });
      return checkin;
    });
    const remoteId = profile(req).tasks.find(task => task.id === result.taskId)?.remoteId;
    if (remoteId && !options.skipExternal) {
      const synced = await services.syncTaskCompletion(remoteId, true);
      return res.status(201).json({ ...result, remoteSynced: synced, syncMessage: synced ? 'Check-in and team task completion saved.' : 'Check-in saved locally; the team task could not be updated.' });
    }
    res.status(201).json(result);
  });

  app.post('/api/chat', async (req, res) => {
    const message = string(req.body.message, 3000);
    if (!message) fail('Please type or speak a question first.');
    const answer = planAnswer(message, profile(req), req.body.mode === 'teachback' ? 'teachback' : 'question');
    const finalAnswer = options.skipExternal ? answer : await services.optionalAI(message, answer, profile(req));
    const response = await mutate(req, data => {
      data.messages.push({ id: uid(), role: 'user', text: message, at: new Date().toISOString() });
      const item = { id: uid(), role: 'assistant', ...finalAnswer, at: new Date().toISOString() };
      data.messages.push(item);
      data.messages = data.messages.slice(-100);
      if (finalAnswer.kind === 'teachback-reviewed') {
        const task = data.tasks.find(task => task.type === 'teachback' && !task.archived);
        if (task && !task.completedDates.includes(today())) task.completedDates.push(today());
      }
      audit(data, 'compass_response', { kind: finalAnswer.kind, taskId: finalAnswer.taskId || null, engine: finalAnswer.providerStatus === 'connected' ? 'configured AI with source quote' : 'plan-guided source comparison' });
      return item;
    });
    res.json(response);
  });

  function makeDraft(data, source, metadata = {}) {
    const candidates = extractCandidates(source);
    const draft = { id: uid(), sourceText: source, candidates, createdAt: new Date().toISOString(), ...metadata };
    data.drafts.push(draft);
    data.drafts = data.drafts.slice(-10);
    audit(data, 'plan_draft_created', { draftId: draft.id, method: metadata.method, candidateCount: candidates.length });
    return draft;
  }
  async function reviewedDraft(req, source, metadata) {
    const extracted = options.skipExternal ? { candidates: extractCandidates(source), aiStatus: 'disabled-for-test' } : await extractWithAI(source, extractCandidates(source));
    return mutate(req, data => makeDraft(data, source, { ...metadata, ...extracted }));
  }
  app.post('/api/plans/demo', async (req, res) => res.status(201).json(await mutate(req, data => makeDraft(data, DEMO_SOURCE, { filename: 'Synthetic care plan', method: 'synthetic sample' }))));
  app.post('/api/plans/text', async (req, res) => {
    const source = string(req.body.sourceText, 24000);
    if (source.length < 15) fail('Paste at least one complete care instruction.');
    res.status(201).json(await reviewedDraft(req, source, { filename: string(req.body.name, 120) || 'Pasted care plan', method: 'manually supplied source' }));
  });
  app.post('/api/plans/upload', upload.single('file'), async (req, res) => {
    if (!req.file) fail('Choose a file first.');
    const read = await services.readDocument(req.file);
    res.status(201).json(await reviewedDraft(req, read.text, read));
  });
  app.post('/api/medicines/scan', upload.single('file'), async (req, res) => {
    if (!req.file) fail('Take or choose a photo of the medicine label first.');
    const isImage = req.file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (req.file.buffer[0] === 0xff && req.file.buffer[1] === 0xd8);
    if (!isImage) fail('Choose a JPG or PNG photo of the medicine label.', 415);
    const ocr = options.skipExternal ? { text: '', method: 'disabled-for-test' } : await services.readDocument(req.file);
    const mime = req.file.buffer[0] === 0xff ? 'image/jpeg' : 'image/png';
    const label = options.skipExternal && !options.allowAI ? { ok: false, aiStatus: 'disabled-for-test' } : await readMedicineLabel({ buffer: req.file.buffer, mime }, ocr.text);
    if (label.ok) {
      const unmatched = [!label.matched.name && 'name', label.medicine.strength && !label.matched.strength && 'strength'].filter(Boolean);
      const warning = unmatched.length ? `AI read this label, but OCR could not confirm the ${unmatched.join(' and ')}. Check them carefully against the packaging.` : 'AI read this label and OCR agrees on the name and strength. Still compare every line with the packaging.';
      return res.status(201).json(await mutate(req, data => makeDraft(data, label.sourceText, { filename: `${label.medicine.name} ${label.medicine.strength}`.trim(), method: 'AI medicine label reading', aiStatus: label.aiStatus, medicine: label.medicine, matched: label.matched, warning })));
    }
    if (label.aiStatus === 'not-a-medicine-label') fail(`${label.seen ? `This looks like ${label.seen}, not a medicine label.` : 'This does not look like a medicine label.'} Take a clear photo of the medicine box or pharmacy label.`, 422);
    const busy = /provider-error-(429|5\d\d)|unavailable/.test(label.aiStatus);
    const warning = label.aiStatus === 'not-configured' ? 'AI is not set up, so only OCR text was read. Add an AI vision model in Team Setup for better label reading.' : busy ? 'The AI service was busy, so only OCR text is shown. Close this and scan again in a moment for a better result.' : 'AI could not read this label, so only OCR text is shown. Check every line against the packaging.';
    res.status(201).json(await mutate(req, data => makeDraft(data, ocr.text, { filename: 'Scanned medicine label', method: ocr.method, confidence: ocr.confidence, aiStatus: label.aiStatus, warning })));
  });
  app.post('/api/plans/:id/confirm', async (req, res) => {
    if (req.body.confirmed !== true) fail('Compare every field with the source and tick the confirmation box.');
    const result = await mutate(req, data => {
      const draft = data.drafts.find(item => item.id === req.params.id);
      if (!draft) fail('This draft has expired. Please add the care plan again.', 404);
      if (draft.confirmedPlanId) return data.plans.find(plan => plan.id === draft.confirmedPlanId);
      const items = req.body.tasks;
      if (!Array.isArray(items) || items.length < 1 || items.length > 20) fail('Confirm at least one care task, up to a maximum of 20.');
      const tasks = items.map(item => {
        const instruction = string(item.instruction, 2000);
        if (!sourceContains(draft.sourceText, instruction)) fail('Each instruction must match the source exactly, including decimals and units. Correct the source wording before confirming.');
        const analysis = analyzeInstruction(instruction);
        if (analysis.blockedSchedule) fail('An as-needed, changing or complex medication schedule needs clarification from the care team before automatic reminders can be created.');
        if (!isTime(item.time)) fail('Choose a valid time for every task.');
        if (!['daily', 'once'].includes(item.frequency) || !['medication', 'checkin', 'teachback', 'care'].includes(item.type)) fail('Choose a valid task type and repeat setting.');
        if (!isDate(item.date)) fail('Choose a valid start date for every task.');
        const matchedRemote = draft.remoteTasks?.find(remote => normalize(remote.instruction) === normalize(instruction));
        return { id: uid(), remoteId: matchedRemote?.id || null, title: string(item.title, 120) || instruction.slice(0, 80), instruction, time: item.time, type: item.type, frequency: item.frequency, startDate: item.date, endDate: analysis.durationDays ? addDays(item.date, analysis.durationDays - 1) : null, date: item.frequency === 'once' ? item.date : null, analysis, completedDates: [], steps: [instruction, 'If anything is unclear, contact your care team before changing the instruction.'] };
      });
      for (const task of tasks) {
        const required = task.analysis.occurrencesPerDay;
        const occurrences = tasks.filter(item => item.instruction === task.instruction && item.frequency === 'daily');
        if (required > 1 && task.analysis.type === 'medication' && (occurrences.length < required || new Set(occurrences.map(item => item.time)).size < required)) fail(`This instruction mentions ${required} daily doses. Add a separate reviewed task and distinct time for each dose.`);
      }
      const plan = { id: uid(), name: string(req.body.name, 120) || draft.filename || 'Confirmed care plan', sourceText: draft.sourceText, extraction: draft.method, confirmedAt: new Date().toISOString(), active: true };
      if (req.body.replace === true) { data.plans.forEach(plan => { plan.active = false; }); data.tasks.forEach(task => { task.archived = true; }); }
      data.plans.push(plan);
      data.tasks.push(...tasks.map(task => ({ ...task, planId: plan.id })));
      draft.confirmedPlanId = plan.id;
      audit(data, 'plan_confirmed', { planId: plan.id, taskCount: tasks.length, sourceRetained: true, userConfirmed: true });
      return plan;
    });
    res.status(201).json(result);
  });

  app.get('/api/calendar', (req, res) => {
    const from = string(req.query.from, 10) || today();
    const to = string(req.query.to, 10) || addDays(from, 6);
    if (!isDate(from) || !isDate(to) || to < from || (Date.parse(to) - Date.parse(from)) > 32 * 86400000) fail('Choose a calendar range of up to 32 days.');
    const data = profile(req);
    const events = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const task of data.tasks.filter(task => !task.archived && date >= (task.startDate || data.createdAt.slice(0, 10)) && (!task.endDate || date <= task.endDate) && (task.frequency === 'daily' || task.date === date))) events.push({ ...task, id: `${task.id}:${date}`, taskId: task.id, date, completed: task.completedDates.includes(date), kind: 'task' });
    }
    events.push(...data.reminders.filter(item => item.date >= from && item.date <= to).map(item => ({ ...item, kind: 'reminder' })));
    res.json(events.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
  });
  app.post('/api/reminders', async (req, res) => {
    const title = string(req.body.title, 120);
    if (!title || !isDate(req.body.date) || !isTime(req.body.time)) fail('Enter a title, valid date and time.');
    if (!['reminder', 'appointment', 'checkin'].includes(req.body.type)) fail('Choose a valid reminder type.');
    const result = await mutate(req, data => {
      const item = { id: uid(), title, date: req.body.date, time: req.body.time, type: req.body.type, notes: string(req.body.notes, 1000) };
      data.reminders.push(item); audit(data, 'reminder_created', { reminderId: item.id, date: item.date, time: item.time }); return item;
    });
    res.status(201).json(result);
  });
  app.delete('/api/reminders/:id', async (req, res) => {
    await mutate(req, data => { const item = data.reminders.find(item => item.id === req.params.id); if (!item) fail('Reminder not found.', 404); data.reminders = data.reminders.filter(item => item.id !== req.params.id); audit(data, 'reminder_removed', { reminderId: item.id }); });
    res.json({ ok: true });
  });
  app.get('/api/summary', (req, res) => res.type('text/plain').attachment('carecompass-handover.txt').send(summary(profile(req))));
  app.post('/api/alerts/preview', async (req, res) => {
    if (!profile(req).profile.caregiverConsent) fail('Enable caregiver sharing before preparing an update.', 403);
    res.status(201).json(await mutate(req, data => {
      const channel = data.profile.caregiverChannel || 'email';
      const item = { id: uid(), summary: summary(data), caregiver: data.profile.caregiver, channel, to: channel === 'sms' ? data.profile.caregiverPhone : data.profile.caregiverEmail, createdAt: Date.now() };
      data.shareDrafts = [...(data.shareDrafts || []), item].slice(-5);
      return item;
    }));
  });
  app.post('/api/alerts', async (req, res) => {
    if (req.body.confirmed !== true || !profile(req).profile.caregiverConsent) fail('Enable caregiver sharing in your profile, then approve this specific update before sending.', 403);
    const result = await mutate(req, data => {
      const existing = data.alerts.find(item => item.previewId === req.body.previewId);
      if (existing) return { alert: existing, alreadyApproved: true };
      const preview = (data.shareDrafts || []).find(item => item.id === req.body.previewId);
      if (!preview || Date.now() - preview.createdAt > 15 * 60000 || preview.caregiver !== data.profile.caregiver || preview.to !== (preview.channel === 'sms' ? data.profile.caregiverPhone : data.profile.caregiverEmail)) fail('Please review a fresh caregiver update before approving it.');
      const item = { id: uid(), previewId: preview.id, createdAt: new Date().toISOString(), summary: preview.summary, delivery: 'pending', acknowledgedAt: null };
      data.alerts.push(item); audit(data, 'caregiver_update_approved', { alertId: item.id, consent: true }); return { alert: item, alreadyApproved: false };
    });
    const { alert } = result;
    if (result.alreadyApproved) return res.json(alert);
    const approvedPreview = profile(req).shareDrafts.find(item => item.id === req.body.previewId);
    if (!options.skipExternal && approvedPreview.to && (approvedPreview.channel === 'sms' ? providers.phoneValid(approvedPreview.to) : providers.emailValid(approvedPreview.to))) {
      await mutate(req, data => {
        data.outbox.push(makeJob({ channel: approvedPreview.channel, to: approvedPreview.to, subject: 'CareCompass approved caregiver update', text: approvedPreview.summary, kind: 'caregiver', dedupeKey: `caregiver:${alert.id}`, alertId: alert.id }));
        Object.assign(data.alerts.find(item => item.id === alert.id), { delivery: 'queued', deliveryMessage: 'Approved update saved to the sending queue. Provider acceptance and delivery status will appear in notification activity.' });
      });
      return res.status(201).json(profile(req).alerts.find(item => item.id === alert.id));
    }
    const delivery = options.skipExternal ? { delivery: 'pending', deliveryMessage: 'Saved to the local caregiver inbox.' } : await services.deliverAlert(alert, profile(req));
    await mutate(req, data => Object.assign(data.alerts.find(item => item.id === alert.id), delivery));
    res.status(201).json({ ...alert, ...delivery });
  });
  app.patch('/api/alerts/:id', async (req, res) => res.json(await mutate(req, data => { const alert = data.alerts.find(item => item.id === req.params.id); if (!alert) fail('Update not found.', 404); alert.acknowledgedAt = new Date().toISOString(); audit(data, 'caregiver_update_acknowledged', { alertId: alert.id }); return alert; })));
  app.get('/api/integrations/tasks', async (req, res) => res.json(options.skipExternal ? { available: false, tasks: [], message: 'External services disabled for this test.' } : await services.teamTasks()));
  app.post('/api/integrations/tasks/review', async (req, res) => {
    const remote = options.skipExternal ? { available: false } : await services.teamTasks();
    if (!remote.available || !remote.tasks.length) fail('No team database tasks are available for review.', 503);
    const draft = await mutate(req, data => {
      const draft = makeDraft(data, remote.tasks.map(task => task.instruction).join('\n'), { filename: 'Team Supabase tasks', method: 'team database', remoteTasks: remote.tasks });
      draft.candidates = remote.tasks.map(task => ({ title: task.title, instruction: task.instruction, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(task.time) ? task.time : '', type: /medicine|pill|tablet|medication/i.test(task.instruction) ? 'medication' : /check|record/i.test(task.instruction) ? 'checkin' : 'care', frequency: 'daily', date: today() }));
      return draft;
    });
    const { remoteTasks, ...result } = draft;
    res.status(201).json(result);
  });
  app.post('/api/reset', async (req, res) => {
    if (req.body.confirmed !== true) fail('Confirm before resetting this browser’s demonstration records.');
    await mutate(req, data => { const fresh = req.user ? emptyProfile(data.profile.name) : seedProfile(); for (const key of Object.keys(data)) delete data[key]; Object.assign(data, fresh); audit(data, 'demo_reset'); });
    res.json({ ok: true });
  });
  app.get('/api/integrations/status', async (req, res) => res.json({ configuration: options.skipExternal ? {} : configuration.publicConfiguration(), providers: options.skipExternal ? { ai: false, email: false, sms: false } : providers.providerStatus(), scheduler: scheduler.status(), cloud: options.skipExternal ? { ready: false, message: 'External services disabled for testing.' } : await cloud.cloudReady(), supabase: options.skipExternal ? {} : await services.checkSupabase() }));
  app.put('/api/integrations/configuration', async (req, res) => {
    if (options.skipExternal) fail('Integration changes are disabled in the isolated test app.', 403);
    try { res.json(await configuration.saveConfiguration(req.body)); }
    catch (error) { fail(error.message); }
  });
  app.post('/api/integrations/test', async (req, res) => {
    if (options.skipExternal) fail('External connection checks are disabled in the isolated test app.', 403);
    res.json(await providers.verifyProvider(req.body.kind));
  });
  app.get('/api/integrations/schema', async (req, res) => { const fs = require('node:fs/promises'); res.type('text/plain').send(await fs.readFile(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8')); });
  app.post('/api/cloud/migrate', async (req, res) => {
    if (req.body.confirmed !== true) fail('Confirm creation of the backup table first.');
    if (options.skipExternal) fail('Cloud schema changes are disabled in the test app.', 403);
    res.json(await cloud.migrateDatabase());
  });
  app.post('/api/cloud/backup', async (req, res) => {
    if (options.skipExternal) fail('Cloud backup is disabled in the test app.', 403);
    res.json(await cloud.backupOne(req.sessionId, profile(req), true));
  });
  app.post('/api/cloud/restore', async (req, res) => {
    if (req.body.confirmed !== true) fail('Confirm before replacing this browser’s profile with its cloud backup.');
    if (options.skipExternal) fail('Cloud restore is disabled in the test app.', 403);
    let saved; try { saved = await cloud.restoreOne(req.sessionId); } catch (error) { fail(error.message, 404); }
    await store.change(req.sessionId, data => { for (const key of Object.keys(data)) delete data[key]; Object.assign(data, saved.data); data.outbox ||= []; data.notifications ||= []; data.profile.remindersEnabled = false; for (const job of data.outbox) if (['queued', 'sending', 'failed', 'blocked'].includes(job.status)) job.status = 'cancelled'; audit(data, 'cloud_backup_restored', { backupAt: saved.updated_at, remindersRequireReenabling: true }); });
    res.json({ ok: true, message: 'Cloud backup restored. Background reminders are off until you review and enable them again.' });
  });
  app.get('/api/notifications', (req, res) => res.json({ jobs: profile(req).outbox, notifications: profile(req).notifications, scheduler: scheduler.status() }));
  app.post('/api/notifications/test', async (req, res) => {
    if (req.body.confirmed !== true) fail('Confirm sending a test message to your own saved contact first.');
    if (options.skipExternal) fail('External test messages are disabled in this test app.', 403);
    const channel = req.body.channel;
    if (!['email', 'sms'].includes(channel) || !providers.providerStatus()[channel]) fail('Configure the selected sending service before sending a test message.');
    const p = profile(req).profile;
    const to = channel === 'sms' ? p.patientPhone : p.patientEmail;
    if (!(channel === 'sms' ? providers.phoneValid(to) : providers.emailValid(to))) fail('Save your own recipient email or international telephone number in Profile first.');
    const job = await mutate(req, data => { const item = makeJob({ channel, to, subject: 'CareCompass test message', text: 'This is a CareCompass connection test that you requested. No medical information is included.', kind: 'test', dedupeKey: uid() }); data.outbox.push(item); return item; });
    res.status(201).json({ ok: true, jobId: job.id, message: 'Your requested test message is queued. Check notification activity for its actual outcome.' });
  });
  app.post('/api/notifications/:id/retry', async (req, res) => {
    if (req.body.confirmed !== true) fail('Approve retrying this message first.');
    await mutate(req, data => { const job = data.outbox.find(item => item.id === req.params.id); if (!job || !['failed', 'blocked', 'unknown'].includes(job.status)) fail('Only blocked, failed or unknown messages can be retried.'); if (job.status === 'unknown' && req.body.allowPossibleDuplicate !== true) fail('Check provider activity and acknowledge a possible duplicate before retrying an unknown outcome.'); job.status = 'queued'; job.attempts = 0; job.nextAttemptAt = new Date().toISOString(); audit(data, 'notification_retry_approved', { jobId: job.id }); });
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'This action is not available.' }));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', etag: false, lastModified: false, setHeaders: res => res.set('Cache-Control', 'no-store') }));
  app.use((error, req, res, next) => {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 500;
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'The file is too large. Choose a file under 8 MB.' : status < 500 || error.expose ? error.message : 'The action could not be saved. Please try again; no success has been assumed.';
    if (status >= 500) console.error('CareCompass request failed:', error.code || error.name);
    res.status(status).json({ error: message });
  });
  return app;
}

if (require.main === module) configuration.loadConfiguration().then(() => createApp({ startScheduler: true })).then(app => {
  const port = Number(process.env.PORT || 3000);
  // Hosting platforms such as Render route traffic in from outside, so listen on all interfaces there.
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : 'localhost');
  const server = app.listen(port, host, error => { if (!error) console.log(process.env.RENDER_EXTERNAL_URL ? `CareCompass is running at ${process.env.RENDER_EXTERNAL_URL}` : `CareCompass is running at http://localhost:${port}\nKeep this terminal open. Press Ctrl+C to stop.`); });
  server.on('error', error => { app.locals.stopWorkers(); console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the previous CareCompass server and try again.` : 'The local server could not start.'); process.exitCode = 1; });
  const stop = () => { app.locals.stopWorkers(); server.close(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createApp };
