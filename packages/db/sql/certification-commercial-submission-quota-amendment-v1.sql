BEGIN;

ALTER TABLE certification_commercial_events
  DROP CONSTRAINT IF EXISTS certification_commercial_events_event_type_check;
ALTER TABLE certification_commercial_events
  DROP CONSTRAINT IF EXISTS certification_commercial_events_type_check;

ALTER TABLE certification_commercial_events
  ADD CONSTRAINT certification_commercial_events_type_check
    CHECK (event_type IN (
      'CREATED',
      'RESERVED',
      'SUBMITTED',
      'SETTLED',
      'RELEASED',
      'CLOSED',
      'REVOKED',
      'CEILING_AMENDED',
      'SUBMISSION_QUOTA_AMENDED'
    ));

COMMIT;
