const { uid, audit } = require('./store');
const { sendNotification } = require('./providers');

const dayInSingapore = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const dueStamp = (day, time) => new Date(`${day}T${time}:00+08:00`).getTime();
function makeJob({ channel, to, subject, text, kind, dedupeKey, sourceId, day, alertId, createdAt = new Date().toISOString() }) {
  return { id: uid(), channel, to, subject, text, kind, dedupeKey, sourceId: sourceId || null, day: day || null, alertId: alertId || null, status: 'queued', attempts: 0, createdAt, nextAttemptAt: createdAt };
}
class Scheduler {
  constructor(store, { sender = sendNotification, clock = () => new Date(), onChange = () => {} } = {}) { this.store = store; this.sender = sender; this.clock = clock; this.onChange = onChange; this.busy = false; this.running = false; }
  async recover() {
    for (const [id, snapshot] of this.store.entries()) {
      await this.store.ensure(id);
      if (snapshot.outbox?.some(job => job.status === 'sending')) await this.store.change(id, profile => {
        for (const job of profile.outbox) if (job.status === 'sending') { job.status = 'unknown'; job.detail = 'Server restarted during sending. Check the provider before manually retrying to avoid duplicates.'; }
      });
    }
  }
  async start() {
    await this.recover(); this.running = true;
    this.timer = setInterval(() => this.tick().catch(() => { this.lastError = 'A background check failed; locally saved jobs will be checked again.'; }), 15000);
    this.timer.unref(); await this.tick();
  }
  stop() { clearInterval(this.timer); this.running = false; }
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const now = this.clock(); const day = dayInSingapore(now);
      for (const [id] of this.store.entries()) {
        await this.store.ensure(id);
        const snapshot = this.store.get(id);
        if (snapshot.profile.remindersEnabled) {
          const due = [...snapshot.tasks.filter(task => !task.archived && !task.completedDates.includes(day) && day >= (task.startDate || snapshot.createdAt.slice(0, 10)) && (!task.endDate || day <= task.endDate) && (task.frequency === 'daily' || task.date === day)), ...snapshot.reminders.filter(item => item.date === day)];
          const toCreate = due.filter(item => Number.isFinite(dueStamp(day, item.time)) && dueStamp(day, item.time) <= now.getTime() && !snapshot.outbox.some(job => job.dedupeKey === `reminder:${item.id}:${day}`));
          if (toCreate.length) await this.store.change(id, profile => {
            for (const item of toCreate) {
              const key = `reminder:${item.id}:${day}`;
              if (profile.outbox.some(job => job.dedupeKey === key)) continue;
              const overdue = now.getTime() - dueStamp(day, item.time) > 15 * 60000;
              const channel = profile.profile.reminderChannel || 'inapp';
              const job = makeJob({ channel, to: channel === 'sms' ? profile.profile.patientPhone : profile.profile.patientEmail, subject: 'CareCompass care reminder', text: overdue ? 'CareCompass: a scheduled care task is overdue. Open your care plan and ask your care team if you are unsure what to do. This message does not change any medicine dose or timing.' : `CareCompass: you have a care reminder scheduled for ${item.time} (Singapore time). Open CareCompass to review your confirmed care instructions.`, kind: 'reminder', dedupeKey: key, sourceId: item.id, day, createdAt: now.toISOString() });
              profile.outbox.push(job);
              profile.notifications.push({ id: uid(), text: overdue ? 'A care task is overdue. Review your confirmed plan.' : `A care task is due at ${item.time}.`, createdAt: now.toISOString(), read: false, sourceId: item.id });
              audit(profile, 'background_reminder_queued', { jobId: job.id, channel, overdue });
            }
          });
        }
        const jobs = this.store.get(id).outbox.filter(job => ['queued', 'blocked', 'failed'].includes(job.status) && job.attempts < 3 && Date.parse(job.nextAttemptAt || 0) <= now.getTime());
        for (const candidate of jobs.slice(0, 10)) {
          const current = this.store.get(id);
          const sourceStillExists = current.tasks.some(task => task.id === candidate.sourceId && !task.archived) || current.reminders.some(item => item.id === candidate.sourceId);
          let cancelled = candidate.kind === 'reminder' && (candidate.day !== day || !sourceStillExists || !current.profile.remindersEnabled || candidate.channel !== current.profile.reminderChannel || candidate.channel !== 'inapp' && candidate.to !== (candidate.channel === 'sms' ? current.profile.patientPhone : current.profile.patientEmail) || current.tasks.some(task => task.id === candidate.sourceId && (task.archived || task.completedDates.includes(candidate.day))));
          if (candidate.kind === 'caregiver') cancelled = !current.profile.caregiverConsent || candidate.channel !== current.profile.caregiverChannel || !current.alerts.some(alert => alert.id === candidate.alertId) || candidate.to !== (candidate.channel === 'sms' ? current.profile.caregiverPhone : current.profile.caregiverEmail);
          if (now.getTime() - Date.parse(candidate.createdAt) > 24 * 3600000) cancelled = true;
          if (cancelled) { await this.store.change(id, profile => Object.assign(profile.outbox.find(job => job.id === candidate.id), { status: 'cancelled', detail: 'Permission was revoked, the recipient changed, or the care task was completed/removed.' })); continue; }
          await this.store.change(id, profile => Object.assign(profile.outbox.find(job => job.id === candidate.id), { status: 'sending', lastAttemptAt: now.toISOString() }));
          let result;
          try { result = await this.sender(candidate); } catch { result = { state: 'unknown', detail: 'Sending ended without a confirmed result. Check provider activity before retrying.' }; }
          await this.store.change(id, profile => {
            const job = profile.outbox.find(item => item.id === candidate.id);
            job.status = result.state; job.detail = result.detail; job.provider = result.provider || null; job.providerId = result.providerId || null;
            if (result.state !== 'blocked') job.attempts++;
            job.nextAttemptAt = new Date(now.getTime() + (result.state === 'blocked' ? 60000 : 60000 * 2 ** job.attempts)).toISOString();
            if (result.state === 'failed' && !result.retryable) job.attempts = 3;
            if (candidate.alertId) { const alert = profile.alerts.find(item => item.id === candidate.alertId); if (alert) { alert.delivery = result.state; alert.deliveryMessage = result.detail; } }
            audit(profile, 'notification_attempt', { jobId: job.id, outcome: job.status, channel: job.channel });
          });
        }
        if (jobs.length) this.onChange(id, this.store.get(id));
      }
      this.lastRunAt = now.toISOString();
    } finally { this.busy = false; }
  }
  status() { return { running: this.running, intervalSeconds: 15, lastRunAt: this.lastRunAt || null, lastError: this.lastError || null, note: 'The Node server and computer must remain on. Closing the browser tab does not stop this worker.' }; }
}
module.exports = { Scheduler, makeJob, dayInSingapore, dueStamp };
