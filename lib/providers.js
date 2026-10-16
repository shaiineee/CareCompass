const nodemailer = require('nodemailer');

const emailValid = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && value.length < 255;
const phoneValid = value => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
function providerStatus() {
  return {
    ai: Boolean(process.env.AI_CHAT_URL && process.env.AI_API_KEY && process.env.AI_MODEL),
    email: Boolean(process.env.EMAIL_FROM && (process.env.RESEND_API_KEY || process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  };
}
function smtpTransport() {
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true });
}
async function sendEmail({ to, subject, text, id }) {
  if (!providerStatus().email) return { state: 'blocked', detail: 'Email service is not configured.' };
  if (!emailValid(to)) return { state: 'blocked', detail: 'Add a valid recipient email address.' };
  try {
    if (process.env.RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }) });
      if (!response.ok) return { state: 'failed', retryable: response.status === 429 || response.status >= 500, detail: `Email provider rejected the request (${response.status}). Check the sender and account configuration.` };
      const result = await response.json(); return { state: 'accepted', provider: 'Resend', providerId: result.id, detail: 'Email accepted by the provider; inbox delivery has not been confirmed.' };
    }
    const result = await smtpTransport().sendMail({ from: process.env.EMAIL_FROM, to, subject, text, messageId: `<${id}@carecompass.local>` });
    return result.accepted?.length ? { state: 'accepted', provider: 'SMTP', providerId: result.messageId, detail: 'Email accepted by the mail server; inbox delivery has not been confirmed.' } : { state: 'failed', retryable: false, detail: 'The mail server did not accept the recipient.' };
  } catch { return { state: 'unknown', detail: 'No final sending response was received. Check provider activity before retrying; the message may have been accepted.' }; }
}
async function sendSMS({ to, text }) {
  if (!providerStatus().sms) return { state: 'blocked', detail: 'SMS service is not configured.' };
  if (!phoneValid(to)) return { state: 'blocked', detail: 'Use an international telephone number beginning with + and the country code.' };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    if (!/^AC[a-f\d]{32}$/i.test(sid)) return { state: 'blocked', detail: 'The Twilio account SID format is invalid.' };
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: process.env.TWILIO_FROM, To: to, Body: text.slice(0, 1200) }) });
    if (!response.ok) return { state: response.status >= 500 ? 'unknown' : 'failed', retryable: response.status === 429, detail: `SMS provider returned ${response.status}. Check provider activity and account settings before retrying.` };
    const result = await response.json(); return { state: result.status === 'delivered' ? 'delivered' : 'accepted', provider: 'Twilio', providerId: result.sid, detail: `Twilio reports ${result.status || 'accepted'}. Accepted/queued does not confirm handset delivery.` };
  } catch { return { state: 'unknown', detail: 'SMS sending outcome is unknown. Check provider activity before retrying to avoid duplicates.' }; }
}
async function sendNotification(job) {
  if (job.channel === 'inapp') return { state: 'saved', provider: 'local inbox', detail: 'Saved in your in-app reminder inbox. No external message was sent. Open CareCompass to view it.' };
  if (job.channel === 'email') return sendEmail(job);
  if (job.channel === 'sms') return sendSMS(job);
  return { state: 'blocked', detail: 'Choose email or SMS.' };
}
async function aiJSON(system, payload) {
  if (!providerStatus().ai) return { ok: false, status: 'not-configured' };
  try {
    const response = await fetch(process.env.AI_CHAT_URL, { method: 'POST', signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.AI_MODEL, temperature: 0, max_tokens: 1800, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }] }) });
    if (!response.ok) return { ok: false, status: `provider-error-${response.status}` };
    const result = await response.json();
    const raw = String(result.choices?.[0]?.message?.content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return { ok: true, value: JSON.parse(raw) };
  } catch { return { ok: false, status: 'unavailable-or-invalid-response' }; }
}
async function verifyProvider(kind) {
  if (kind === 'ai') {
    const result = await aiJSON('Reply with JSON only: {"connected":true}.', { message: 'CareCompass connection check; synthetic text only.' });
    return { ok: result.ok && result.value.connected === true, message: result.ok && result.value.connected === true ? 'AI endpoint responded correctly.' : `AI check failed: ${result.status || 'unexpected response'}.` };
  }
  if (kind === 'email') {
    if (!providerStatus().email) return { ok: false, message: 'Add an email provider, credentials and verified sender first.' };
    try {
      if (process.env.RESEND_API_KEY) { const response = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000) }); return { ok: response.ok, message: response.ok ? 'Email API credentials accepted. This check does not send an email.' : 'Could not verify this API key. A send-only key may require a user-approved test message instead.' }; }
      await smtpTransport().verify(); return { ok: true, message: 'SMTP connection and authentication succeeded. No email was sent.' };
    } catch { return { ok: false, message: 'Email connection failed. Check the host, port and app-specific credentials.' }; }
  }
  return { ok: false, message: 'Select AI or email for a non-sending connection check.' };
}
module.exports = { providerStatus, emailValid, phoneValid, sendEmail, sendSMS, sendNotification, aiJSON, verifyProvider };
