const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function addDays(date, count) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}
const uid = () => crypto.randomUUID();
// Windows file scanners can briefly hold a handle after a read or write.
async function retryFileOperation(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
}

const DEMO_SOURCE = [
  'SYNTHETIC CARE PLAN FOR A HACKATHON DEMONSTRATION. NOT A REAL PRESCRIPTION.',
  'Take prescribed blood pressure medicine once daily at 08:00. Follow the dispensing label exactly; confirm any unclear dose with your pharmacist.',
  'Check your ankles daily at 19:00. Sit somewhere safe, look at both ankles, use the checking method shown by your care professional, and record any change.',
  'At 20:15 each day, explain your medication instruction and ankle check in your own words.',
  'For new, worsening or worrying symptoms, seek advice from your care team. For severe or immediately unsafe symptoms, contact emergency services.'
].join('\n');

function seedProfile() {
  const date = today();
  const planId = uid();
  return {
    profile: { name: 'Mr Rahman', caregiver: 'Asha', caregiverRelationship: 'Daughter', caregiverPhone: '', caregiverEmail: '', caregiverConsent: false, caregiverChannel: 'email', patientEmail: '', patientPhone: '', remindersEnabled: false, reminderChannel: 'inapp', language: 'English', largeText: false },
    plans: [{ id: planId, name: 'Synthetic demonstration care plan', sourceText: DEMO_SOURCE, confirmedAt: new Date().toISOString(), extraction: 'synthetic sample', active: true }],
    drafts: [],
    tasks: [
      { id: uid(), planId, title: 'Take prescribed blood pressure medicine', type: 'medication', time: '08:00', frequency: 'daily', instruction: DEMO_SOURCE.split('\n')[1], steps: ['Check the medicine name and dispensing label.', 'Follow the exact dose on that label.', 'If anything is unclear, pause and confirm it with your pharmacist.'], completedDates: [] },
      { id: uid(), planId, title: 'Check your ankles', type: 'checkin', time: '19:00', frequency: 'daily', instruction: DEMO_SOURCE.split('\n')[2], steps: ['Sit somewhere safe and look at both ankles.', 'Follow the checking method shown by your care professional.', 'Record any change; use Medical Assistance if you are worried.'], completedDates: [] },
      { id: uid(), planId, title: 'Explain today’s plan in your own words', type: 'teachback', time: '20:15', frequency: 'daily', instruction: DEMO_SOURCE.split('\n')[3], steps: ['Describe the medicine instruction and ankle check in your own words.', 'Compass will show which source details need another look.'], completedDates: [] }
    ],
    checkIns: [], messages: [], alerts: [], audit: [],
    reminders: [{ id: uid(), title: 'Health review', date: addDays(date, 3), time: '10:30', type: 'appointment', notes: 'Synthetic appointment · Community clinic' }],
    completedReminders: [], outbox: [], notifications: [],
    createdAt: new Date().toISOString()
  };
}

function audit(profile, event, facts = {}) {
  profile.audit.push({ id: uid(), event, facts, at: new Date().toISOString() });
  profile.audit = profile.audit.slice(-500);
}

class Store {
  constructor(filename) {
    this.filename = filename;
    this.data = { version: 1, sessions: {} };
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    try { this.data = JSON.parse(await fs.readFile(this.filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved app data could not be read. Restore its backup before restarting.'); }
  }
  async ensure(id) {
    if (!this.data.sessions[id]) await this.change(id, () => {});
    else if (!this.data.sessions[id].outbox) await this.change(id, profile => { profile.outbox ||= []; profile.notifications ||= []; Object.assign(profile.profile, { patientEmail: '', patientPhone: '', remindersEnabled: false, reminderChannel: 'email', caregiverEmail: '', caregiverChannel: 'email', ...profile.profile }); });
    return this.data.sessions[id];
  }
  async change(id, fn) {
    const run = this.queue.then(async () => {
      const before = structuredClone(this.data);
      try {
        const profile = this.data.sessions[id] ||= seedProfile();
        const result = fn(profile);
        const temporary = `${this.filename}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
        await retryFileOperation(() => fs.copyFile(this.filename, `${this.filename}.bak`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await retryFileOperation(() => fs.rename(temporary, this.filename));
        return result;
      } catch (error) { this.data = before; throw error; }
    });
    this.queue = run.catch(() => {});
    return run;
  }
  get(id) { return this.data.sessions[id]; }
  entries() { return Object.entries(this.data.sessions); }
}

module.exports = { Store, today, addDays, uid, seedProfile, audit, DEMO_SOURCE };
