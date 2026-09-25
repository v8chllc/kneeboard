-- Synthetic, rolled-back probes against the committed migration.
BEGIN;

DO $$
DECLARE
  v_load_id uuid;
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
        ('user', 'session', 'account', 'verification', 'rate_limit',
         'account_settings', 'load_reservation', 'ofp_load', 'ofp_raw', 'tracker')) <> 10 THEN
    RAISE EXCEPTION 'expected ten persistence tables';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ofp_load_recent_by_user_idx'
    AND indexdef LIKE '%user_id%loaded_at DESC%id DESC%') THEN
    RAISE EXCEPTION 'recent-load index is missing or misordered';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ofp_load' AND column_name = 'payload') THEN
    RAISE EXCEPTION 'raw payload leaked into indexed load metadata';
  END IF;

  INSERT INTO "user" (id, name, email) VALUES
    ('schema-user-a', 'Synthetic A', 'a@example.invalid'),
    ('schema-user-b', 'Synthetic B', 'b@example.invalid');
  INSERT INTO account (id, account_id, provider_id, user_id, updated_at)
    VALUES ('provider-a', 'subject-1', 'synthetic-provider', 'schema-user-a', now());
  BEGIN
    INSERT INTO account (id, account_id, provider_id, user_id, updated_at)
      VALUES ('provider-b', 'subject-1', 'synthetic-provider', 'schema-user-b', now());
    RAISE EXCEPTION 'duplicate provider identity was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO account_settings (user_id, pilot_id) VALUES ('schema-user-a', '00001234');
  INSERT INTO load_reservation (user_id, active_key, accepted_at)
    VALUES ('schema-user-a', 'action-1', now());
  INSERT INTO ofp_load (user_id, idempotency_key, flight_number,
    origin_icao_code, destination_icao_code, generated_at)
    VALUES ('schema-user-a', 'action-1', 'TEST1', 'KORD', 'KJFK', now())
    RETURNING id INTO v_load_id;
  INSERT INTO ofp_raw (load_id, payload) VALUES (v_load_id, '{"synthetic":true}');
  BEGIN
    INSERT INTO ofp_load (user_id, idempotency_key, flight_number,
      origin_icao_code, destination_icao_code, generated_at)
      VALUES ('schema-user-a', 'action-1', 'TEST1', 'KORD', 'KJFK', now());
    RAISE EXCEPTION 'duplicate action key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO tracker (user_id, load_id, navlog, snapshot)
      VALUES ('schema-user-b', v_load_id, '{}', '{"version":1}');
    RAISE EXCEPTION 'cross-account tracker was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO tracker (user_id, load_id, navlog, snapshot)
    VALUES ('schema-user-a', v_load_id, '{}', '{"version":1}');

  BEGIN
    UPDATE tracker SET version = 2 WHERE tracker.load_id = v_load_id;
    RAISE EXCEPTION 'snapshot/database version mismatch was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'schema probes passed';
END $$;

ROLLBACK;
