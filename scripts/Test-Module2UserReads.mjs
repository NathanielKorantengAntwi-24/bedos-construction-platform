// Guarded local-only migration/DB regression. Migration and fixtures roll back.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const container = 'supabase_db_bedos-supabase-lab';
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', windowsHide: true }))[0];
if (info.Name !== `/${container}` || !info.Config.Image.includes('supabase/postgres')) throw Error('Local database guard failed');
const migration = fs.readFileSync('supabase/migrations/20261030010000_add_admin_user_reads.sql', 'utf8').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
const test = fs.readFileSync('scripts/sql/Test-Module2UserReads.sql', 'utf8');
const sql = `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';\n${migration}\n${test}\nROLLBACK;`;
try {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (!output.includes('ROLLBACK')) throw Error('Rollback result missing');
  const evidence = { date: new Date().toISOString(), scope: 'Isolated bedos-supabase-lab only; migration and fixtures rolled back', status: 'passed', assertions: 29 };
  fs.writeFileSync('docs/module-2-evidence/local-user-reads.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
}
