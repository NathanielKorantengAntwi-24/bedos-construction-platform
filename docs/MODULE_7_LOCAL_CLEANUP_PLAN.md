# Proposed local integration cleanup

Resolution: user explicitly approved these exact operations and repetition by the corrected local harness. The bounded recovery restored all eleven captured project metadata sections. Subsequent successful runs use persisted baselines and Storage API bucket cleanup; independent verification is recorded under `module-7-evidence`.

Target only: running Docker container `supabase_db_bedos-supabase-lab` and loopback Storage API `http://127.0.0.1:55321`. No production connection or hosted credentials. Approval requested because automatic review rejected the cleanup as broader than the role-helper restoration approval.

Read-only evidence: all projects, stages, images, operations, category/link rows, test Auth identities and project bucket objects are absent. The integration report recorded that all temporary function names were absent before installation. Thirteen installed function bodies now match the test source exactly. The original local schema/grants/permissions/bucket/Storage-policy metadata was captured in `.next/module7-local-review.txt` before the first integration run. The role helper is handled by the separate approved snapshot restoration.

Actions:

1. Recheck exact local target, empty tables/bucket and unchanged authored function bodies. Persist a recovery checkpoint under ignored `node_modules/.cache/module7`.
2. Delete the empty test-created `project-images` bucket through the local Storage API. Original baseline had no such bucket.
3. Drop only these temporary functions: bedos_catalog_audit, bedos_mutate_service, bedos_mutate_service_category, bedos_read_service_catalog, bedos_require_catalog_permission, bedos_validate_catalog_input, bedos_project_actor, bedos_project_input, bedos_project_lock, bedos_project_projection, bedos_project_read, bedos_project_mutate, bedos_project_media.
4. Drop only test-added policies bedos_project_storage_backend_only, m7_local_original_read and m7_local_original_write. Original Storage-policy baseline was empty.
5. Drop the empty project_media_operations, project_services and project_categories tables; remove only Module 7-added version/category_id/phase columns, named bounds/date/order constraints and the primary-image index from the three original project tables. Keep the original tables and original records (counts are zero).
6. Restore the original captured grants for projects/project_stages/project_images. Remove test-added projects.view/projects.manage mappings and permission records; original captured project permission baseline was empty. Preserve all other permissions and grants.
7. Reload local PostgREST schema and independently compare all eleven project metadata sections with the saved baseline. Record any mismatch and stop instead of rerunning tests.

Risk: this changes local test schema and dependencies. It is deliberately broader than removing disposable records. The proposed function/table deletions are necessary to return the lab to its captured baseline; no business data remains in these objects. Future integration runs will persist restoration metadata before mutation and use Storage APIs for bucket deletion.

This approval would also allow the corrected local integration harness to repeat these same narrowly scoped setup/cleanup operations for Module 7 verification. It does not authorize Git publication, production changes, deployment or Module 8.
