// Local-only SQL assertions; new function, trigger and fixture data all roll back.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const container = 'supabase_db_bedos-supabase-lab';
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', windowsHide: true }))[0];
if (info.Name !== `/${container}` || !info.Config.Image.includes('supabase/postgres')) throw Error('Local DB guard failed');
// Lab restores predate the deployed Module 1 fixes. Load those dependencies
// within this same rollback-only transaction; never weaken session assertions.
const migration = [
  '20261029000000_restrict_role_lookup_to_active_accounts.sql',
  '20261030000000_restrict_legacy_profile_update_to_active_accounts.sql',
  '20261101000000_add_admin_account_status.sql',
].map(file => fs.readFileSync(`supabase/migrations/${file}`, 'utf8')
  .replace(/^BEGIN;\r?$/m, '').replace(/^COMMIT;\r?$/m, '')).join('\n');
const test = fs.readFileSync('scripts/sql/Test-Module2UserStatus.sql', 'utf8');
try {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';\n${migration}\n${test}\nROLLBACK;`, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (!output.includes('ROLLBACK')) throw Error('Rollback result missing');
  const summary = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{"assertions"')) || 'null');
  if (!summary || summary.assertions < 45) throw Error('Assertion count missing');
  const evidence = { date: new Date().toISOString(), scope: 'Isolated local lab only; function, synthetic audit trigger and fixtures rolled back', ...summary, status: 'passed' };
  fs.writeFileSync('docs/module-2-evidence/local-user-status-sql.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
}
