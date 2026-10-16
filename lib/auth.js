const { createClient } = require('@supabase/supabase-js');

let authClient = null;
if (process.env.SUPABASE_ENABLED === 'true' && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
  try {
    authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
    });
  } catch { /* Supabase misconfigured; auth is disabled. */ }
}

function ready() {
  return Boolean(authClient);
}

async function register(email, password) {
  if (!authClient) throw new Error('Supabase is not configured. Set SUPABASE_ENABLED, SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const { data, error } = await authClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  return { id: data.user.id, email: data.user.email };
}

async function login(email, password) {
  if (!authClient) throw new Error('Supabase is not configured. Set SUPABASE_ENABLED, SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { id: data.user.id, email: data.user.email, accessToken: data.session.access_token };
}

async function getUserByToken(accessToken) {
  if (!authClient) return null;
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

module.exports = { ready, register, login, getUserByToken };
