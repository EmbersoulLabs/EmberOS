-- Sprint 4 Phase E — RLS for Commercial Execution Authorization.
-- Service-write only. Authenticated clients have no policies → no access.

ALTER TABLE commercial_execution_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_execution_authorizations_select
  ON commercial_execution_authorizations;
DROP POLICY IF EXISTS commercial_execution_authorizations_insert
  ON commercial_execution_authorizations;
DROP POLICY IF EXISTS commercial_execution_authorizations_update
  ON commercial_execution_authorizations;
DROP POLICY IF EXISTS commercial_execution_authorizations_delete
  ON commercial_execution_authorizations;
