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

const session = data => ({ id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name || '', accessToken: data.session.access_token, refreshToken: data.session.refresh_token });

async function register(email, password, name) {
  if (!authClient) throw new Error('Supabase is not configured. Set SUPABASE_ENABLED, SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const { error } = await authClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error) throw new Error(error.message);
  return login(email, password);
}

async function login(email, password) {
  if (!authClient) throw new Error('Supabase is not configured. Set SUPABASE_ENABLED, SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'That email and password do not match an account.' : error.message);
  return session(data);
}

// Access tokens expire after about an hour, so a still-valid refresh token gets a new pair.
async function refresh(refreshToken) {
  if (!authClient || !refreshToken) return null;
  const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return null;
  return session(data);
}

// Checking a token calls Supabase, so results are cached briefly to keep every request fast.
const cache = new Map();
async function getUserByToken(accessToken) {
  if (!authClient || !accessToken) return null;
  const hit = cache.get(accessToken);
  if (hit && hit.expires > Date.now()) return hit.user;
  const { data, error } = await authClient.auth.getUser(accessToken);
  const user = error || !data.user ? null : { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name || '' };
  if (cache.size > 1000) cache.clear();
  cache.set(accessToken, { user, expires: Date.now() + (user ? 5 * 60000 : 30000) });
  return user;
}

module.exports = { ready, register, login, refresh, getUserByToken };
