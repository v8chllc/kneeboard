-- Disposable Journey: every inserted row is synthetic and rolled back.
BEGIN;

DO $$
DECLARE
  v_load uuid := '00000000-0000-0000-0000-000000000001';
  v_other_load uuid := '00000000-0000-0000-0000-000000000002';
  v_payload jsonb := '{"nested":{"values":[1,2]},"identity":"synthetic"}';
  v_navlog jsonb := '{"metadata":{"flightNumber":"TEST1"},"points":[]}';
  v_snapshot jsonb := '{"version":1,"procedureInclusion":{"sid":true,"star":true},"waypoints":[]}';
  v_recent integer[];
  v_plan text;
  v_uses_index boolean := false;
  v_bad_timestamps integer;
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('user','session','account','verification','rate_limit',
        'account_settings','load_reservation','ofp_load','ofp_raw','tracker')) <> 10 THEN
    RAISE EXCEPTION 'C-4: required table missing';
  END IF;
  INSERT INTO "user" (id,name,email) VALUES
    ('journey-a','Synthetic A','journey-a@example.invalid'),
    ('journey-b','Synthetic B','journey-b@example.invalid');
  INSERT INTO session (id,expires_at,token,updated_at,user_id)
    VALUES ('journey-session',now()+interval '1 hour','synthetic-token',now(),'journey-a');
  INSERT INTO account (id,account_id,provider_id,user_id,updated_at)
    VALUES ('journey-account','subject-1','synthetic-provider','journey-a',now());
  INSERT INTO verification (id,identifier,value,expires_at)
    VALUES ('journey-verification','synthetic-identifier','synthetic-value',now()+interval '1 hour');
  INSERT INTO rate_limit (id,key,count,last_request)
    VALUES ('journey-rate','synthetic-rate-key',3,1234567890000);
  IF (SELECT count(*) FROM session WHERE id='journey-session') <> 1
     OR (SELECT count(*) FROM account WHERE id='journey-account') <> 1
     OR (SELECT count(*) FROM verification WHERE id='journey-verification') <> 1
     OR (SELECT count FROM rate_limit WHERE id='journey-rate') <> 3 THEN
    RAISE EXCEPTION 'C-4: auth storage round trip failed';
  END IF;

  INSERT INTO account_settings (user_id,pilot_id) VALUES ('journey-a','00001234');
  IF (SELECT count(*) FROM account_settings
      WHERE user_id='journey-a' AND pilot_id='00001234') <> 1 THEN
    RAISE EXCEPTION 'C-5: leading zeros changed';
  END IF;
  BEGIN
    UPDATE account_settings SET pilot_id='ABC' WHERE user_id='journey-a';
    RAISE EXCEPTION 'C-5: letters accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE account_settings SET pilot_id='12345678901234567' WHERE user_id='journey-a';
    RAISE EXCEPTION 'C-5: seventeen digits accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO load_reservation (user_id,active_key,accepted_at)
    VALUES ('journey-a','action-1',now());
  BEGIN
    INSERT INTO load_reservation (user_id,active_key,accepted_at)
      VALUES ('journey-b','action-2',NULL);
    RAISE EXCEPTION 'C-9: active key without attempt accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO load_reservation (user_id,active_key,accepted_at)
      VALUES ('journey-a','action-3',now());
    RAISE EXCEPTION 'C-9: duplicate account reservation accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE load_reservation SET active_key=NULL WHERE user_id='journey-a';
  IF (SELECT count(*) FROM load_reservation
      WHERE user_id='journey-a' AND accepted_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'C-9: clearing active key erased attempt timestamp';
  END IF;

  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,
    destination_icao_code,generated_at,loaded_at)
    VALUES (v_load,'journey-a','action-1','TEST1','KORD','KJFK',
      '2024-01-02 03:00:00+03','2024-01-02 03:00:00+03');
  INSERT INTO ofp_raw (load_id,payload) VALUES (v_load,v_payload);
  IF (SELECT count(*) FROM ofp_raw WHERE load_id=v_load AND payload=v_payload) <> 1
     OR (SELECT count(*) FROM ofp_load WHERE id=v_load AND flight_number='TEST1'
         AND origin_icao_code='KORD' AND destination_icao_code='KJFK') <> 1 THEN
    RAISE EXCEPTION 'C-6: load metadata or raw JSON changed';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='ofp_load' AND column_name='payload') THEN
    RAISE EXCEPTION 'C-6: raw payload is in metadata table';
  END IF;

  INSERT INTO tracker (user_id,load_id,navlog,snapshot)
    VALUES ('journey-a',v_load,v_navlog,v_snapshot);
  IF (SELECT count(*) FROM tracker WHERE load_id=v_load AND navlog=v_navlog
      AND snapshot=v_snapshot AND version=1) <> 1 THEN
    RAISE EXCEPTION 'C-7: tracker aggregate round trip or initial version failed';
  END IF;
  BEGIN
    UPDATE tracker SET version=2 WHERE load_id=v_load;
    RAISE EXCEPTION 'C-7: mismatched snapshot version accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO ofp_load (user_id,idempotency_key,flight_number,origin_icao_code,
      destination_icao_code,generated_at)
      VALUES ('journey-a','action-1','TEST1','KORD','KJFK',now());
    RAISE EXCEPTION 'C-8: duplicate account action accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO tracker (user_id,load_id,navlog,snapshot)
      VALUES ('journey-a',v_load,v_navlog,v_snapshot);
    RAISE EXCEPTION 'C-8: second tracker for load accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO ofp_load (id,user_id,idempotency_key,flight_number,origin_icao_code,
    destination_icao_code,generated_at,loaded_at)
    VALUES (v_other_load,'journey-a','action-2','TEST2','KORD','KJFK',now(),
      '2024-01-02 00:00:02+00');
  BEGIN
    INSERT INTO tracker (user_id,load_id,navlog,snapshot)
      VALUES ('journey-b',v_other_load,v_navlog,v_snapshot);
    RAISE EXCEPTION 'C-8: cross-account tracker accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

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
    RAISE EXCEPTION 'C-10: % required timestamps lack timezone semantics', v_bad_timestamps;
  END IF;
  IF (SELECT count(*) FROM ofp_load WHERE id=v_load
      AND generated_at='2024-01-02 00:00:00+00'::timestamptz
      AND loaded_at='2024-01-02 00:00:00+00'::timestamptz) <> 1 THEN
    RAISE EXCEPTION 'C-10: offset instant changed';
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
  SELECT array_agg(right(id::text,12)::integer ORDER BY loaded_at DESC,id DESC)
    INTO v_recent FROM (
      SELECT id,loaded_at FROM ofp_load WHERE user_id='journey-a'
      ORDER BY loaded_at DESC,id DESC LIMIT 10
    ) recent;
  IF v_recent IS DISTINCT FROM ARRAY[14,13,12,11,10,9,8,7,6,5] THEN
    RAISE EXCEPTION 'C-11: recent-ten membership or order incorrect: %', v_recent;
  END IF;
  PERFORM set_config('enable_seqscan','off',true);
  FOR v_plan IN EXECUTE 'EXPLAIN SELECT id,flight_number FROM ofp_load WHERE user_id=''journey-a'' ORDER BY loaded_at DESC,id DESC LIMIT 10' LOOP
    IF v_plan LIKE '%ofp_load_recent_by_user_idx%' THEN v_uses_index := true; END IF;
    IF v_plan LIKE '%ofp_raw%' THEN RAISE EXCEPTION 'C-11: metadata query touches raw table'; END IF;
  END LOOP;
  IF NOT v_uses_index THEN RAISE EXCEPTION 'C-11: recent-load index not used'; END IF;
  RAISE NOTICE 'C-4 through C-11: database journey assertions passed';
END $$;

ROLLBACK;
