const { seedProfile } = require('./store');
function makeBackup(profile) {
  const copy = structuredClone(profile);
  copy.drafts = [];
  // Transport jobs and credentials must never be carried to another computer.
  copy.outbox = [];
  return { format: 'carecompass-backup', version: 1, exportedAt: new Date().toISOString(), profile: copy };
}
function readBackup(backup) {
  const invalid = () => { throw new Error('This is not a supported CareCompass backup. No saved records were changed.'); };
  if (!backup || backup.format !== 'carecompass-backup' || backup.version !== 1) invalid();
  const p = backup.profile;
  if (!p || !p.profile || typeof p.profile.name !== 'string' || !p.profile.name.trim() || !Array.isArray(p.tasks) || !Array.isArray(p.plans)) invalid();
  const inspect = value => {
    if (typeof value === 'string' && value.length > 30000) invalid();
    if (Array.isArray(value) && value.length > 2000) invalid();
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
      inspect(child);
    }
  };
  inspect(p);
  const result = seedProfile();
  for (const [key, fallback] of Object.entries(result.profile)) {
    if (key in p.profile && typeof p.profile[key] !== typeof fallback) invalid();
    if (key in p.profile) result.profile[key] = p.profile[key];
  }
  for (const key of ['tasks', 'plans', 'checkIns', 'messages', 'alerts', 'audit', 'reminders', 'completedReminders', 'notifications']) {
    if (p[key] !== undefined && !Array.isArray(p[key])) invalid();
    result[key] = structuredClone(p[key] || []);
  }
  const text = (obj, keys) => obj && keys.every(key => typeof obj[key] === 'string');
  if (!result.tasks.every(t => text(t, ['id', 'title', 'instruction', 'time', 'frequency']) && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) && ['daily', 'once'].includes(t.frequency) && Array.isArray(t.completedDates) && t.completedDates.every(d => typeof d === 'string') && (!t.steps || Array.isArray(t.steps) && t.steps.every(s => typeof s === 'string')))) invalid();
  if (!result.plans.every(p => text(p, ['id', 'name', 'sourceText', 'confirmedAt']) && typeof p.active === 'boolean')) invalid();
  if (!result.reminders.every(r => text(r, ['id', 'title', 'date', 'time', 'type']))) invalid();
  if (!result.checkIns.every(c => text(c, ['date', 'change']) && typeof c.pain === 'number' && c.decision && text(c.decision, ['level', 'rule']))) invalid();
  if (!result.messages.every(m => text(m, ['role', 'text']))) invalid();
  if (!result.alerts.every(a => text(a, ['id', 'createdAt', 'summary']))) invalid();
  if (!result.audit.every(a => text(a, ['at', 'event']) && a.facts && typeof a.facts === 'object')) invalid();
  if (!result.notifications.every(n => text(n, ['id', 'createdAt', 'text']))) invalid();
  if (typeof p.createdAt !== 'string' || Number.isNaN(Date.parse(p.createdAt))) invalid();
  result.createdAt = p.createdAt;
  result.profile.remindersEnabled = false;
  result.profile.caregiverConsent = false;
  result.outbox = []; result.drafts = [];
  return result;
}
module.exports = { makeBackup, readBackup };
