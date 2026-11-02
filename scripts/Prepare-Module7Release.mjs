// Prepares reviewable artifacts only. Does not connect to any database or publish Git.
import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.next/module7-release';fs.mkdirSync(dir,{recursive:true});
const read=fs.readFileSync('scripts/MODULE_7_READONLY_REVIEW.sql','utf8'),snapshot=JSON.parse(fs.readFileSync('docs/module-7-evidence/production-readonly-review.json','utf8'));
const body=read.slice(read.indexOf("SELECT 'columns'"),read.lastIndexOf('COMMIT;')).trim().replace(/;$/,'');
const literal=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const structural=snapshot.sections.filter(x=>['columns','constraints','security','policies','grants','indexes','triggers','counts','buckets','permissions','storage_policies'].includes(x.section));
const expected=literal(Object.fromEntries(structural.map(x=>[x.section,x.evidence])));
const preflight=`-- Must run immediately before the separately authorized release. Metadata/aggregates only.\nBEGIN TRANSACTION READ ONLY;SET LOCAL statement_timeout='15s';\nWITH actual AS (${body}) SELECT section,evidence,evidence=(${expected}->section) matches FROM actual ORDER BY section;\nCOMMIT;\n`;
fs.writeFileSync(dir+'/00-read-only-preflight.sql',preflight);
const phases=[['20261102030000','secure_construction_projects','20261102020000'],['20261102040000','restrict_construction_project_access','20261102030000']];
const manifest={prepared_at:new Date().toISOString(),production_changes:false,phases:[]};
for(const [i,[version,name,previous]] of phases.entries()){
 const source=fs.readFileSync(`supabase/migrations/${version}_${name}.sql`,'utf8');
 const stripped=source.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'');
 const guard=`DO $release$ BEGIN IF (SELECT max(version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '${previous}' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Unexpected release migration baseline';END IF;END;$release$;`;
 const zeroGuard=i===0?`DO $baseline$ DECLARE actual jsonb;BEGIN SELECT jsonb_object_agg(section,evidence) INTO actual FROM (${body}) r;IF actual IS DISTINCT FROM ${expected} THEN RAISE EXCEPTION 'Construction production baseline drift';END IF;END;$baseline$;`:'';
 const wrapper=`BEGIN;\nSET LOCAL lock_timeout='5s';\n${guard}\n${zeroGuard}\n${stripped}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${"'"+source.replaceAll("'","''")+"'"}]);\nCOMMIT;\n`;
 const file=`0${i+1}-${name}.sql`;fs.writeFileSync(dir+'/'+file,wrapper);manifest.phases.push({version,file,source_sha256:crypto.createHash('sha256').update(source).digest('hex')});
}
const source=fs.readFileSync('supabase/migrations/20261102030000_secure_construction_projects.sql','utf8');
const functions=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS \$f\$([\s\S]*?)\$f\$;/g)].map(m=>({name:m[1],hash:crypto.createHash('md5').update(m[3].replace(/\s/g,'')).digest('hex'),backend:['bedos_project_read','bedos_project_mutate','bedos_project_media'].includes(m[1])}));
if(functions.length!==7)throw Error('Unexpected Module 7 function manifest');manifest.functions=functions;
fs.writeFileSync(dir+'/03-rollback-verification.sql',"BEGIN;SET LOCAL statement_timeout='45s';\n"+fs.readFileSync('scripts/sql/Test-Module7Projects.sql','utf8')+'\nROLLBACK;\n');
const expectedFunctions=literal(functions);
fs.writeFileSync(dir+'/04-metadata-verification.sql',`BEGIN TRANSACTION READ ONLY;WITH expected AS(SELECT * FROM jsonb_to_recordset(${expectedFunctions}) AS e(name text,hash text,backend boolean)) SELECT e.name,p.oid IS NOT NULL present,md5(regexp_replace(p.prosrc,'\\s','','g'))=e.hash source_matches,p.prosecdef,pg_get_userbyid(p.proowner) owner,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE')=e.backend backend_acl_matches FROM expected e LEFT JOIN pg_proc p ON p.pronamespace='public'::regnamespace AND p.proname=e.name ORDER BY e.name;\n${body};\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN('20261102030000','20261102040000') ORDER BY version;COMMIT;\n`);
fs.writeFileSync(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared_directory:dir,functions:functions.length,production_changes:false}));
