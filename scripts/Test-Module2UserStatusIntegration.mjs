// Local Auth/RLS + competing requests. No hosted API/env credentials are used.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const container = 'supabase_db_bedos-supabase-lab';
const authContainer = 'supabase_auth_bedos-supabase-lab';
const inspect = name => JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0];
if (inspect(container).Name !== `/${container}`) throw Error('Local DB guard failed');
const authInfo = inspect(authContainer);
const env = new Map(authInfo.Config.Env.map(item => { const n = item.indexOf('='); return [item.slice(0,n), item.slice(n+1)]; }));
if (!env.get('GOTRUE_DB_DATABASE_URL')?.includes(container) || !env.get('GOTRUE_JWT_SECRET')) throw Error('Local Auth guard failed');
function sql(query) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] }).trim();
}
function jwt(role) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+1800 })).toString('base64url');
  return `${h}.${p}.` + crypto.createHmac('sha256', env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');
}
const base = 'http://127.0.0.1:55321';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(base, jwt('service_role'), options);
const client = () => createClient(base, jwt('anon'), options);
const run = crypto.randomUUID(), fixtures = [], results = [];
const serviceId = crypto.randomUUID(), serviceSlug = `status-integration-${run}`;
const migrationPath = 'supabase/migrations/20261101000000_add_admin_account_status.sql';
const statusMigration = fs.readFileSync(migrationPath, 'utf8');
const snapshotQuery = `SELECT json_agg(json_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN ('public.get_user_role()'::regprocedure,'public.update_own_profile(text,text)'::regprocedure);`;
const original = JSON.parse(sql(snapshotQuery));
fs.mkdirSync('.next',{recursive:true});
let installed = false, serviceCreated = false, customerClient;
const check = (name, pass) => { results.push({ name, pass: !!pass }); if (!pass) throw Error(name); };
const args = (actor, target, status, expected) => ({ p_actor_id: actor.id, p_user_id: target.id, p_account_status: status, p_expected_account_status: expected, p_reason: 'Local integration verification' });
async function fixture(label, role) {
  const email = `status-${run}-${label}@bedos-status-live.invalid`;
  const name = `Local status integration ${run} ${label}`;
  const password = crypto.randomBytes(24).toString('base64url') + 'aA1!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  const f = { id: created.data.user?.id, email, name, password, role };
  if (f.id) fixtures.push(f);
  check(`${label} exact fixture created`, !created.error && !!f.id && created.data.user.email === email);
  const roleRow = await admin.from('roles').select('id').eq('name', role).single();
  check(`${label} role exists`, !roleRow.error && !!roleRow.data?.id);
  f.roleId = roleRow.data.id;
  const updated = await admin.from('profiles').update({ role_id: f.roleId, account_status: 'active' }).eq('id', f.id).select('id').single();
  check(`${label} local profile configured`, !updated.error && updated.data?.id === f.id);
  return f;
}
try {
  check('new local function absent before test', sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_update_user_status';") === '0');
  fs.writeFileSync('.next/user-status-dependency-snapshot.json',JSON.stringify(original));
  // Existing production dependency fixes are temporary in this lab, restored below.
  const dependencyFiles = ['20261029000000_restrict_role_lookup_to_active_accounts.sql','20261030000000_restrict_legacy_profile_update_to_active_accounts.sql'];
  const source = [...dependencyFiles.map(file => fs.readFileSync(`supabase/migrations/${file}`, 'utf8')), statusMigration]
    .map(text => text.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')).join('\n');
  sql(`BEGIN; SET LOCAL lock_timeout='5s'; ${source}\nCOMMIT; NOTIFY pgrst,'reload schema';`);
  installed = true;
  let ready;
  for (let attempt=0; attempt<30; attempt++) {
    ready = await admin.rpc('bedos_update_user_status', { p_actor_id: crypto.randomUUID(), p_user_id: crypto.randomUUID(), p_account_status:'suspended', p_expected_account_status:'active', p_reason:'Cache readiness probe' });
    if (ready.error?.code === '42501') break;
    await new Promise(resolve => setTimeout(resolve,200));
  }
  check('local RPC schema ready with actor denial', ready?.error?.code === '42501');
  const actor = await fixture('actor','administrator');
  const competingActor = await fixture('second-actor','administrator');
  const customer = await fixture('customer','customer');
  const inserted = await admin.from('services').insert({ id:serviceId,name:'Local status access fixture',slug:serviceSlug,status:'published' });
  serviceCreated = !inserted.error;
  check('dedicated local service fixture created', serviceCreated);
  customerClient = client();
  const signedIn = await customerClient.auth.signInWithPassword({ email:customer.email,password:customer.password });
  check('real customer Auth login', !signedIn.error && signedIn.data.user?.id === customer.id);
  const accessToken = signedIn.data.session.access_token;
  let r = await customerClient.rpc('get_user_role');
  check('active existing session role granted', !r.error && r.data === 'customer');
  r = await customerClient.from('services').select('id').eq('id',serviceId);
  check('active existing session RLS access', !r.error && r.data?.length === 1);
  r = await customerClient.rpc('bedos_update_user_status', args(actor,customer,'suspended','active'));
  check('customer cannot forge administrator actor', r.error?.code === '42501');
  r = await admin.rpc('bedos_update_user_status', args(actor,customer,'suspended','active'));
  check('administrator suspends customer', !r.error && r.data?.account_status === 'suspended');
  const current = await customerClient.auth.getSession();
  check('same access token retained after suspension', current.data.session?.access_token === accessToken);
  r = await customerClient.auth.getUser();
  check('provider session validity alone does not grant app access', !r.error && r.data.user?.id === customer.id);
  r = await customerClient.rpc('get_user_role');
  check('same real session role removed', !r.error && r.data === null);
  r = await customerClient.from('services').select('id').eq('id',serviceId);
  check('same real session RLS access removed', !r.error && r.data?.length === 0);
  r = await customerClient.rpc('update_own_profile',{ p_full_name:'Denied suspended edit',p_phone:null });
  check('same real session legacy profile update denied', r.error?.code === '42501');
  r = await admin.rpc('bedos_update_user_status', args(actor,customer,'active','suspended'));
  check('administrator restores customer', !r.error && r.data?.account_status === 'active');
  r = await customerClient.rpc('get_user_role');
  check('same real session role restored', !r.error && r.data === 'customer');
  r = await customerClient.from('services').select('id').eq('id',serviceId);
  check('same real session RLS access restored', !r.error && r.data?.length === 1);
  const before = await admin.from('audit_logs').select('id').eq('entity_id',customer.id).eq('action','user_account_status_changed');
  check('two prior transitions audited', !before.error && before.data?.length === 2);
  const race = await Promise.all([actor,competingActor].map(a => admin.rpc('bedos_update_user_status',args(a,customer,'suspended','active'))));
  check('competing actors produce exactly one winner', race.filter(x=>!x.error).length === 1 && race.filter(x=>x.error?.code==='P0001').length === 1);
  const after = await admin.from('audit_logs').select('actor_id,metadata').eq('entity_id',customer.id).eq('action','user_account_status_changed');
  check('concurrent loser creates no duplicate audit', !after.error && after.data?.length === 3);
  check('audit actor and reason match authorized requests', after.data.every(row => [actor.id,competingActor.id].includes(row.actor_id) && row.metadata.reason === 'Local integration verification'));
} catch (error) {
  results.push({ name:'Local integration stopped',pass:false,stage:error.message.startsWith('Command failed') ? 'local database command' : error.message });
} finally {
  try {
    if (customerClient) {
      const out = await customerClient.auth.signOut({ scope:'local' });
      check('local customer session signed out', !out.error);
    }
    // Validate every exact fixture before any deletion.
    for (const f of fixtures) {
      const actual = await admin.auth.admin.getUserById(f.id);
      if (!/^[a-f0-9-]{36}$/.test(f.id) || actual.error || actual.data.user?.email !== f.email || actual.data.user.user_metadata?.full_name !== f.name) throw Error('Exact local cleanup identity guard failed');
    }
    const ids = fixtures.map(f=>`'${f.id}'`).join(',');
    if (ids) sql(`DELETE FROM public.audit_logs WHERE actor_id IN (${ids}) AND entity_id IN (${ids});`);
    if (serviceCreated) {
      const deleted = await admin.from('services').delete().eq('id',serviceId).eq('slug',serviceSlug).select('id');
      check('exact local service removed', !deleted.error && deleted.data?.length === 1);
    }
    for (const f of fixtures) {
      const removed = await admin.auth.admin.deleteUser(f.id);
      check(`${f.role} exact fixture removed`, !removed.error);
    }
    check('no local status integration identities remain', sql(`SELECT count(*) FROM auth.users WHERE email LIKE 'status-${run}-%@bedos-status-live.invalid';`) === '0');
  } catch {
    results.push({ name:'Local fixture cleanup needs review',pass:false });
    fs.mkdirSync('.next',{recursive:true});
    fs.writeFileSync('.next/user-status-local-cleanup.json',JSON.stringify({ fixtures:fixtures.map(({id,email,name})=>({id,email,name})),serviceId,serviceSlug }));
  }
  if (installed) {
    let cleanupStage = 'body comparison';
    try {
      const expectedBody = statusMigration.split('$function$')[1];
      const actualBody = JSON.parse(sql("SELECT json_build_object('body',prosrc) FROM pg_proc WHERE oid='public.bedos_update_user_status(uuid,uuid,text,text,text)'::regprocedure;")).body;
      if (!expectedBody || actualBody.replace(/\s+/g,'') !== expectedBody.replace(/\s+/g,'')) throw Error('Local function changed; cleanup stopped');
      cleanupStage = 'restore transaction';
      sql(`BEGIN; SET LOCAL lock_timeout='5s'; DROP FUNCTION public.bedos_update_user_status(uuid,uuid,text,text,text); ${original.map(x=>x.definition.trimEnd()+';').join('\n')} COMMIT; NOTIFY pgrst,'reload schema';`);
      cleanupStage = 'snapshot equality';
      check('original dependency definitions and ACLs restored', JSON.stringify(JSON.parse(sql(snapshotQuery))) === JSON.stringify(original));
      check('new local function removed',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_update_user_status';") === '0');
    } catch {
      results.push({ name:'Local function restoration needs review',pass:false,stage:cleanupStage });
    }
  }
  const report = { date:new Date().toISOString(),scope:'Guarded local lab only; temporary Module 1 dependencies and status function; actual Auth/RLS and competing actor requests; no credential or fixture identifiers recorded',results };
  fs.writeFileSync('docs/module-2-evidence/local-user-status-integration.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if (results.some(x=>!x.pass)) process.exitCode=1;
}
