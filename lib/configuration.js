const fs = require('node:fs/promises');
const path = require('node:path');

const fields = ['AI_CHAT_URL', 'AI_API_KEY', 'AI_MODEL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'DATABASE_URL'];
const secrets = new Set(['AI_API_KEY', 'SMTP_PASS', 'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN', 'DATABASE_URL']);
const file = path.join(__dirname, '..', 'data', 'integrations.json');
async function loadConfiguration() {
  try { const saved = JSON.parse(await fs.readFile(file, 'utf8')); for (const key of fields) if (saved[key]) process.env[key] = saved[key]; }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Integration settings could not be read. Restore data/integrations.json before restarting.'); }
}
function publicConfiguration() {
  return Object.fromEntries(fields.map(key => [key, secrets.has(key) ? { configured: Boolean(process.env[key]) } : process.env[key] || '']));
}
async function saveConfiguration(input) {
  const updates = {};
  for (const key of fields) {
    if (!(key in input)) continue;
    if (typeof input[key] !== 'string' || input[key].length > 3000 || /[\r\n\0]/.test(input[key])) throw new Error(`Enter a valid value for ${key}.`);
    const value = input[key].trim();
    if (secrets.has(key) && !value) continue; // A blank password field leaves the saved secret unchanged.
    updates[key] = value;
  }
  if (updates.AI_CHAT_URL) { const url = new URL(updates.AI_CHAT_URL); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS for an external AI endpoint.'); }
  if (updates.SMTP_PORT && !/^\d{2,5}$/.test(updates.SMTP_PORT)) throw new Error('Enter a valid SMTP port.');
  if (updates.EMAIL_FROM && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(updates.EMAIL_FROM)) throw new Error('Enter the verified sender email address.');
  if (updates.DATABASE_URL && !/^postgres(?:ql)?:\/\//i.test(updates.DATABASE_URL)) throw new Error('Supabase uses PostgreSQL. A MySQL connection string cannot create this table.');
  const saved = {};
  try { Object.assign(saved, JSON.parse(await fs.readFile(file, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  Object.assign(saved, updates);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
  Object.assign(process.env, updates);
  return publicConfiguration();
}
module.exports = { loadConfiguration, saveConfiguration, publicConfiguration };
