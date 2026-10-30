// Dedicated disposable customer fixture only. Never records credentials or user identifiers.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const ref = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
const url = `https://${ref}.supabase.co`;
if (ref !== 'zjdqomckldeipigqqfqm' || env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== url || !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Production target guard failed');
const origin = 'https://bedos-construction-platform.vercel.app';
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const results = [], cookies = new Map();
const nonce = crypto.randomUUID();
const email = `read-denial-${nonce}@bedos-user-read-denials.invalid`;
const name = `Disposable user-read denial ${nonce}`;
const password = crypto.randomBytes(32).toString('base64url') + 'aA1!';
let id;
function check(label, pass) {
  results.push({ name: label, pass: !!pass });
  if (!pass) throw Error('Verification stopped');
}
async function api(path, method = 'GET', body) {
  const r = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(25000) });
  for (const c of r.headers.getSetCookie()) {
    const pair = c.split(';')[0], split = pair.indexOf('=');
    if (pair.slice(split + 1)) cookies.set(pair.slice(0, split), pair.slice(split + 1));
    else cookies.delete(pair.slice(0, split));
  }
  let data = null;
  try { data = await r.json(); } catch { /* Non-JSON fails subsequent checks. */ }
  return { status: r.status, data, cache: r.headers.get('cache-control') };
}
try {
  let r = await api('/api/users');
  check('Anonymous list denied without data', r.status === 401 && typeof r.data?.error === 'string' && !r.data.users);
  check('Denied list not cacheable', r.cache?.includes('no-store'));
  r = await api(`/api/users/${crypto.randomUUID()}`);
  check('Anonymous detail denied without data', r.status === 401 && typeof r.data?.error === 'string' && !r.data.user);
  // Confirmed admin-created fixture is setup only, not a public signup test.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  id = created.data.user?.id;
  check('Dedicated disposable customer fixture created', !created.error && !!id && created.data.user.email === email);
  const profile = await admin.from('profiles').select('id,full_name,account_status,roles(name)').eq('id', id).single();
  const role = Array.isArray(profile.data?.roles) ? profile.data.roles[0] : profile.data?.roles;
  check('Fixture is an active ordinary customer', !profile.error && profile.data?.full_name === name && profile.data.account_status === 'active' && role?.name === 'customer');
  r = await api('/api/auth/login', 'POST', { email, password });
  check('Dedicated customer backend login', r.status === 200 && r.data?.user?.id === id);
  r = await api('/api/auth/me');
  check('Dedicated customer session verified', r.status === 200 && r.data?.user?.id === id && r.data.role?.name === 'customer');
  r = await api('/api/users');
  check('Customer list denied without data', r.status === 403 && typeof r.data?.error === 'string' && !r.data.users);
  r = await api(`/api/users/${id}`);
  check('Customer administrative detail denied even for own ID', r.status === 403 && typeof r.data?.error === 'string' && !r.data.user);
  r = await api('/api/users?limit=invalid');
  check('Customer authorization precedes query validation', r.status === 403);
  r = await api('/api/auth/logout', 'POST');
  check('Customer backend logout', r.status === 200);
} catch {
  results.push({ name: 'Production denial verification stopped', pass: false });
} finally {
  if (id) {
    try {
      const u = await admin.auth.admin.getUserById(id);
      if (u.error || u.data.user?.email !== email || u.data.user.user_metadata?.full_name !== name) throw Error('Cleanup identity guard failed');
      const deleted = await admin.auth.admin.deleteUser(id);
      check('Exact disposable customer deleted', !deleted.error);
      const p = await admin.from('profiles').select('id').eq('id', id);
      const absent = await admin.auth.admin.getUserById(id);
      check('Fixture Auth identity and profile removal verified', absent.error?.status === 404 && !p.error && p.data?.length === 0);
    } catch {
      results.push({ name: 'Disposable fixture cleanup requires local review', pass: false });
      // Preserve exact identity locally for cleanup; never publish this file.
      fs.writeFileSync('.next/user-read-denial-cleanup.json', JSON.stringify({ id, email, name }));
    }
  }
  const report = { date: new Date().toISOString(), scope: 'Production anonymous/customer denial checks; confirmed disposable fixture setup only, not signup evidence; no user identifiers or credentials retained in report', results };
  fs.writeFileSync('docs/module-2-evidence/production-user-read-denials.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
}
