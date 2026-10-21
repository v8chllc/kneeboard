-- Disposable Journey: every inserted row is synthetic and rolled back.
-- Every RAISE text is unique and starts with its 6a claim label, because
-- scripts/db_journey_fitness.py identifies the failing assertion by that text.
-- Keep exactly one transaction start and one rollback statement: the fitness
-- runner inserts mutations after the start or replaces one query fragment; no
-- mutation may move or replace the rollback.
BEGIN;

DO $$
DECLARE
  v_load uuid := '00000000-0000-0000-0000-000000000001';
  v_other_load uuid := '00000000-0000-0000-0000-000000000002';
  v_payload jsonb := '{"nested":{"values":[1,2]},"identity":"synthetic"}';
  v_navlog jsonb := '{"metadata":{"flightNumber":"TEST1"},"points":[]}';
  v_snapshot jsonb := '{"version":1,"procedureInclusion":{"sid":true,"star":true},"waypoints":[]}';
  v_recent text[];
  v_now timestamptz := now();
  v_session_expires timestamptz := now() + interval '1 hour';
  v_verification_expires timestamptz := now() + interval '1 hour';
  v_loaded timestamptz := '2024-01-02 03:00:00+03';
  v_accepted timestamptz := '2024-03-04 05:06:07.123456+00';
  v_actual jsonb;
  v_expected jsonb;
  v_plan text;
  v_uses_index boolean := false;
  v_bad_timestamps integer;
  v_nonpositive integer;
  v_orphan record;
  v_constraint text;
  v_account_counts integer[];
  v_load_counts integer[];
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('user','session','account','verification','rate_limit',
        'account_settings','load_reservation','ofp_load','ofp_raw','tracker')) <> 10 THEN
    RAISE EXCEPTION '6a C-4: required table missing';
  END IF;
  INSERT INTO "user" (id,name,email) VALUES
    ('journey-a','Synthetic A','journey-a@example.invalid'),
    ('journey-b','Synthetic B','journey-b@example.invalid');
  INSERT INTO session (id,expires_at,token,updated_at,user_id)
    VALUES ('journey-session',v_session_expires,'synthetic-token',v_now,'journey-a');
  INSERT INTO account (id,account_id,provider_id,user_id,updated_at)
    VALUES ('journey-account','subject-1','synthetic-provider','journey-a',v_now);
  INSERT INTO verification (id,identifier,value,expires_at)
    VALUES ('journey-verification','synthetic-identifier','synthetic-value',v_verification_expires);
  INSERT INTO rate_limit (id,key,count,last_request)
    VALUES ('journey-rate','synthetic-rate-key',3,1234567890000);
  -- C-4: every supplied column of each auth record round-trips exactly.
  SELECT jsonb_agg(to_jsonb(stored) ORDER BY stored.id) INTO v_actual
    FROM (SELECT id,name,email FROM "user" WHERE id IN ('journey-a','journey-b')) stored;
  v_expected := jsonb_build_array(
    jsonb_build_object('id','journey-a','name','Synthetic A','email','journey-a@example.invalid'),
    jsonb_build_object('id','journey-b','name','Synthetic B','email','journey-b@example.invalid'));
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-4: user fields changed: expected %, got %', v_expected, v_actual;
  END IF;
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT id,expires_at,token,updated_at,user_id FROM session WHERE id='journey-session') stored;
  v_expected := jsonb_build_object('id','journey-session','expires_at',v_session_expires,
    'token','synthetic-token','updated_at',v_now,'user_id','journey-a');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-4: session fields changed: expected %, got %', v_expected, v_actual;
  END IF;
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT id,account_id,provider_id,user_id,updated_at FROM account WHERE id='journey-account') stored;
  v_expected := jsonb_build_object('id','journey-account','account_id','subject-1',
    'provider_id','synthetic-provider','user_id','journey-a','updated_at',v_now);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-4: account fields changed: expected %, got %', v_expected, v_actual;
  END IF;
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT id,identifier,value,expires_at FROM verification WHERE id='journey-verification') stored;
  v_expected := jsonb_build_object('id','journey-verification','identifier','synthetic-identifier',
    'value','synthetic-value','expires_at',v_verification_expires);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-4: verification fields changed: expected %, got %', v_expected, v_actual;
  END IF;
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT id,key,count,last_request FROM rate_limit WHERE id='journey-rate') stored;
  v_expected := jsonb_build_object('id','journey-rate','key','synthetic-rate-key',
    'count',3,'last_request',1234567890000);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-4: rate-limit fields changed: expected %, got %', v_expected, v_actual;
  END IF;

  INSERT INTO account_settings (user_id,pilot_id) VALUES ('journey-a','00001234');
  IF (SELECT count(*) FROM account_settings
      WHERE user_id='journey-a' AND pilot_id='00001234') <> 1 THEN
    RAISE EXCEPTION '6a C-5: leading zeros changed';
  END IF;
  BEGIN
    UPDATE account_settings SET pilot_id='ABC' WHERE user_id='journey-a';
    RAISE EXCEPTION '6a C-5: letters accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE account_settings SET pilot_id='12345678901234567' WHERE user_id='journey-a';
    RAISE EXCEPTION '6a C-5: seventeen digits accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- C-5: an account may have no Pilot ID; NULL is stored as NULL.
  BEGIN
    INSERT INTO account_settings (user_id,pilot_id) VALUES ('journey-b',NULL);
  EXCEPTION WHEN not_null_violation OR check_violation THEN
    RAISE EXCEPTION '6a C-5: NULL Pilot ID rejected';
  END;
  IF (SELECT count(*) FROM account_settings
      WHERE user_id='journey-b' AND pilot_id IS NULL) <> 1 THEN
    RAISE EXCEPTION '6a C-5: NULL Pilot ID not stored as NULL';
  END IF;

  INSERT INTO load_reservation (user_id,active_key,accepted_at)
    VALUES ('journey-a','action-1',v_accepted);
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT active_key,accepted_at FROM load_reservation WHERE user_id='journey-a') stored;
  v_expected := jsonb_build_object('active_key','action-1','accepted_at',v_accepted);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-9: reservation insert changed key or timestamp: expected %, got %',
      v_expected, v_actual;
  END IF;
  BEGIN
    INSERT INTO load_reservation (user_id,active_key,accepted_at)
      VALUES ('journey-b','action-2',NULL);
    RAISE EXCEPTION '6a C-9: active key without attempt accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO load_reservation (user_id,active_key,accepted_at)
      VALUES ('journey-a','action-3',now());
    RAISE EXCEPTION '6a C-9: duplicate account reservation accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE load_reservation SET active_key=NULL WHERE user_id='journey-a';
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT active_key,accepted_at FROM load_reservation WHERE user_id='journey-a') stored;
  v_expected := jsonb_build_object('active_key',NULL,'accepted_at',v_accepted);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-9: clearing active key changed the reservation: expected %, got %',
      v_expected, v_actual;
  END IF;

  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,
    destination_icao_code,generated_at,loaded_at)
    VALUES (v_load,'journey-a','action-1','TEST1','KORD','KJFK',v_loaded,v_loaded);
  INSERT INTO ofp_raw (load_id,payload) VALUES (v_load,v_payload);
  SELECT to_jsonb(stored) INTO v_actual
    FROM (SELECT id,user_id,idempotency_key,flight_number,origin_icao_code,
      destination_icao_code,generated_at,loaded_at FROM ofp_load WHERE id=v_load) stored;
  v_expected := jsonb_build_object('id',v_load,'user_id','journey-a','idempotency_key','action-1',
    'flight_number','TEST1','origin_icao_code','KORD','destination_icao_code','KJFK',
    'generated_at',v_loaded,'loaded_at',v_loaded);
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '6a C-6: load metadata changed: expected %, got %', v_expected, v_actual;
  END IF;
  IF (SELECT count(*) FROM ofp_raw WHERE load_id=v_load AND payload=v_payload) <> 1 THEN
    RAISE EXCEPTION '6a C-6: raw JSON changed';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='ofp_load' AND column_name='payload') THEN
    RAISE EXCEPTION '6a C-6: raw payload is in metadata table';
  END IF;

  INSERT INTO tracker (user_id,load_id,navlog,snapshot)
    VALUES ('journey-a',v_load,v_navlog,v_snapshot);
  IF (SELECT count(*) FROM tracker WHERE load_id=v_load AND navlog=v_navlog
      AND snapshot=v_snapshot AND version=1) <> 1 THEN
    RAISE EXCEPTION '6a C-7: tracker aggregate round trip or initial version failed';
  END IF;
  BEGIN
    UPDATE tracker SET version=2 WHERE load_id=v_load;
    RAISE EXCEPTION '6a C-7: mismatched snapshot version accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE tracker SET snapshot=v_snapshot - 'version' WHERE load_id=v_load;
    RAISE EXCEPTION '6a C-7: missing snapshot version accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  FOREACH v_nonpositive IN ARRAY ARRAY[0,-1] LOOP
    BEGIN
      UPDATE tracker SET version=v_nonpositive,
        snapshot=jsonb_set(v_snapshot,'{version}',to_jsonb(v_nonpositive))
      WHERE load_id=v_load;
      RAISE EXCEPTION '6a C-7a: nonpositive row and snapshot version % accepted', v_nonpositive;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
      IF v_constraint <> 'tracker_version_positive' THEN
        RAISE EXCEPTION '6a C-7a: version % rejected by %, expected tracker_version_positive',
          v_nonpositive,v_constraint;
      END IF;
    END;
  END LOOP;
  IF (SELECT count(*) FROM tracker WHERE load_id=v_load AND version=1 AND snapshot=v_snapshot) <> 1 THEN
    RAISE EXCEPTION '6a C-7a: rejected versions changed the tracker';
  END IF;

  BEGIN
    INSERT INTO ofp_load (user_id,idempotency_key,flight_number,origin_icao_code,
      destination_icao_code,generated_at)
      VALUES ('journey-a','action-1','TEST1','KORD','KJFK',now());
    RAISE EXCEPTION '6a C-8: duplicate account action accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO tracker (user_id,load_id,navlog,snapshot)
      VALUES ('journey-a',v_load,v_navlog,v_snapshot);
    RAISE EXCEPTION '6a C-8: second tracker for load accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,
    destination_icao_code,generated_at,loaded_at)
    VALUES (v_other_load,'journey-a','action-2','TEST2','KORD','KJFK',now(),
      '2024-01-02 00:00:02+00');
  BEGIN
    INSERT INTO tracker (user_id,load_id,navlog,snapshot)
      VALUES ('journey-b',v_other_load,v_navlog,v_snapshot);
    RAISE EXCEPTION '6a C-8: cross-account tracker accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  FOR v_orphan IN SELECT * FROM (VALUES
    ('session', $probe$INSERT INTO session (id,expires_at,token,updated_at,user_id)
      VALUES ('journey-orphan-session',now()+interval '1 hour','journey-orphan-token',now(),'journey-missing')$probe$,
      'session_user_id_user_id_fk'),
    ('account', $probe$INSERT INTO account (id,account_id,provider_id,user_id,updated_at)
      VALUES ('journey-orphan-account','orphan','synthetic-provider','journey-missing',now())$probe$,
      'account_user_id_user_id_fk'),
    ('account_settings', $probe$INSERT INTO account_settings (user_id) VALUES ('journey-missing')$probe$,
      'account_settings_user_id_user_id_fk'),
    ('load_reservation', $probe$INSERT INTO load_reservation (user_id) VALUES ('journey-missing')$probe$,
      'load_reservation_user_id_user_id_fk'),
    ('ofp_load', $probe$INSERT INTO ofp_load (user_id,idempotency_key,flight_number,origin_icao_code,destination_icao_code,generated_at)
      VALUES ('journey-missing','orphan','TEST','KORD','KJFK',now())$probe$,
      'ofp_load_user_id_user_id_fk'),
    ('ofp_raw', $probe$INSERT INTO ofp_raw (load_id,payload)
      VALUES ('00000000-0000-0000-0000-000000000999','{}')$probe$,
      'ofp_raw_load_id_ofp_load_id_fk'),
    ('tracker', $probe$INSERT INTO tracker (user_id,load_id,navlog,snapshot)
      VALUES ('journey-a','00000000-0000-0000-0000-000000000999','{}','{"version":1}')$probe$,
      'tracker_load_id_user_id_ofp_load_id_user_id_fk')
  ) AS probe(label,statement,expected_constraint) LOOP
    BEGIN
      EXECUTE v_orphan.statement;
      RAISE EXCEPTION '6a C-8a: orphan % accepted', v_orphan.label;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
      IF v_constraint <> v_orphan.expected_constraint THEN
        RAISE EXCEPTION '6a C-8a: orphan % rejected by %, expected %',
          v_orphan.label,v_constraint,v_orphan.expected_constraint;
      END IF;
    END;
  END LOOP;

  INSERT INTO "user" (id,name,email)
    VALUES ('journey-cascade-account','Synthetic Cascade','journey-cascade@example.invalid');
  INSERT INTO session (id,expires_at,token,updated_at,user_id)
    VALUES ('journey-cascade-session',now()+interval '1 hour','journey-cascade-token',now(),'journey-cascade-account');
  INSERT INTO account (id,account_id,provider_id,user_id,updated_at)
    VALUES ('journey-cascade-provider','cascade','synthetic-provider','journey-cascade-account',now());
  INSERT INTO account_settings (user_id) VALUES ('journey-cascade-account');
  INSERT INTO load_reservation (user_id) VALUES ('journey-cascade-account');
  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,destination_icao_code,generated_at)
    VALUES ('00000000-0000-0000-0000-000000000099','journey-cascade-account','cascade','TEST','KORD','KJFK',now());
  INSERT INTO ofp_raw (load_id,payload) VALUES ('00000000-0000-0000-0000-000000000099',v_payload);
  INSERT INTO tracker (user_id,load_id,navlog,snapshot)
    VALUES ('journey-cascade-account','00000000-0000-0000-0000-000000000099',v_navlog,v_snapshot);
  DELETE FROM "user" WHERE id='journey-cascade-account';
  SELECT ARRAY[
    (SELECT count(*) FROM session WHERE id='journey-cascade-session'),
    (SELECT count(*) FROM account WHERE id='journey-cascade-provider'),
    (SELECT count(*) FROM account_settings WHERE user_id='journey-cascade-account'),
    (SELECT count(*) FROM load_reservation WHERE user_id='journey-cascade-account'),
    (SELECT count(*) FROM ofp_load WHERE id='00000000-0000-0000-0000-000000000099'),
    (SELECT count(*) FROM ofp_raw WHERE load_id='00000000-0000-0000-0000-000000000099'),
    (SELECT count(*) FROM tracker WHERE load_id='00000000-0000-0000-0000-000000000099')
  ] INTO v_account_counts;
  IF v_account_counts IS DISTINCT FROM ARRAY[0,0,0,0,0,0,0] THEN
    RAISE EXCEPTION '6a C-8a: account cascade left dependent rows: %', v_account_counts;
  END IF;

  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,destination_icao_code,generated_at)
    VALUES ('00000000-0000-0000-0000-000000000100','journey-b','cascade-load','TEST','KORD','KJFK',now());
  INSERT INTO ofp_raw (load_id,payload) VALUES ('00000000-0000-0000-0000-000000000100',v_payload);
  INSERT INTO tracker (user_id,load_id,navlog,snapshot)
    VALUES ('journey-b','00000000-0000-0000-0000-000000000100',v_navlog,v_snapshot);
  DELETE FROM ofp_load WHERE id='00000000-0000-0000-0000-000000000100';
  SELECT ARRAY[
    (SELECT count(*) FROM ofp_raw WHERE load_id='00000000-0000-0000-0000-000000000100'),
    (SELECT count(*) FROM tracker WHERE load_id='00000000-0000-0000-0000-000000000100')
  ] INTO v_load_counts;
  IF v_load_counts IS DISTINCT FROM ARRAY[0,0] THEN
    RAISE EXCEPTION '6a C-8a: load cascade left dependent rows: %', v_load_counts;
  END IF;
  RAISE NOTICE '6a C-7a positive versions and 6a C-8a orphan/cascade assertions passed';

  SELECT count(*) INTO v_bad_timestamps
  FROM (VALUES
    ('user','created_at'),('user','updated_at'),
    ('session','created_at'),('session','updated_at'),('session','expires_at'),
    ('account','created_at'),('account','updated_at'),
    ('account','access_token_expires_at'),('account','refresh_token_expires_at'),
    ('verification','created_at'),('verification','updated_at'),('verification','expires_at'),
    ('account_settings','created_at'),('account_settings','updated_at'),
    ('load_reservation','accepted_at'),('load_reservation','created_at'),('load_reservation','updated_at'),
    ('ofp_load','generated_at'),('ofp_load','loaded_at'),('ofp_load','created_at'),('ofp_load','updated_at'),
    ('ofp_raw','created_at'),('tracker','created_at'),('tracker','updated_at')
  ) AS required(table_name,column_name)
  LEFT JOIN information_schema.columns AS columns
    ON columns.table_schema='public' AND columns.table_name=required.table_name
    AND columns.column_name=required.column_name
  WHERE columns.data_type IS DISTINCT FROM 'timestamp with time zone';
  IF v_bad_timestamps <> 0 THEN
    RAISE EXCEPTION '6a C-10: % required timestamps lack timezone semantics', v_bad_timestamps;
  END IF;
  IF (SELECT count(*) FROM ofp_load WHERE id=v_load
      AND generated_at='2024-01-02 00:00:00+00'::timestamptz
      AND loaded_at='2024-01-02 00:00:00+00'::timestamptz) <> 1 THEN
    RAISE EXCEPTION '6a C-10: offset instant changed';
  END IF;

  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,
    origin_icao_code,destination_icao_code,generated_at,loaded_at)
  SELECT ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    'journey-a','action-' || i,'TEST' || i,'KORD','KJFK',now(),
    '2024-02-01 00:00:00+00'::timestamptz
      + (CASE WHEN i=13 THEN 14 ELSE i END) * interval '1 second'
  FROM generate_series(3,14) AS i;
  INSERT INTO ofp_load (user_id,idempotency_key,flight_number,
    origin_icao_code,destination_icao_code,generated_at,loaded_at)
  SELECT 'journey-b','action-' || i,'OTHER' || i,'KORD','KJFK',now(),
    '2024-02-01 00:00:00+00'::timestamptz + i * interval '1 second'
  FROM generate_series(3,14) AS i;
  -- C-11: compare the rows in the order the query returns them; no second sort.
  -- Loads 13 and 14 share a timestamp, so only the id DESC tie-break orders them.
  v_recent := ARRAY(
    SELECT id::text FROM ofp_load WHERE user_id='journey-a'
    ORDER BY loaded_at DESC, id DESC LIMIT 10);
  IF v_recent IS DISTINCT FROM ARRAY[
      '00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000013',
      '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000009',
      '00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005'] THEN
    RAISE EXCEPTION '6a C-11: recent-ten membership or order incorrect: %', v_recent;
  END IF;
  PERFORM set_config('enable_seqscan','off',true);
  FOR v_plan IN EXECUTE 'EXPLAIN SELECT id,flight_number FROM ofp_load WHERE user_id=''journey-a'' ORDER BY loaded_at DESC,id DESC LIMIT 10' LOOP
    IF v_plan LIKE '%ofp_load_recent_by_user_idx%' THEN v_uses_index := true; END IF;
    IF v_plan LIKE '%ofp_raw%' THEN RAISE EXCEPTION '6a C-11: metadata query touches raw table'; END IF;
  END LOOP;
  IF NOT v_uses_index THEN RAISE EXCEPTION '6a C-11: recent-load index not used'; END IF;
  RAISE NOTICE '6a C-4 through 6a C-11: database journey assertions passed';
END $$;

ROLLBACK;
