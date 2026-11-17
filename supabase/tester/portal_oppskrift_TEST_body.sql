-- Test av 20261117200000_portal_oppskrift.sql. ALLTID i en transaksjon som rulles tilbake (realtime sender ingenting før commit).
-- Kjøring (fra rotmappen):
--   (echo "begin;"; cat supabase/migrations/20261117200000_portal_oppskrift.sql; cat supabase/tester/portal_oppskrift_TEST_body.sql; echo "rollback;") > "$TEMP/t.sql"
--   npx supabase db query --linked --project-ref qoqpenbfdxeduylxirwk --yes --file "$TEMP/t.sql"
-- Alle testrader har id/nummer med TEST og finnes bare inne i transaksjonen.

create temp table _res (n serial, navn text, ok boolean, info text);

do $test$
declare
  r jsonb; v_id text; v_ant int; v_rad lager_oppskrifter%rowtype;
  v_basis jsonb := jsonb_build_object('produktnummer', 'TEST901', 'navn', 'TEST - Skuffesystem', 'prisgruppe', 'EKSTRAUTSTYR',
    'modellSlug', 'kia-ev9', 'modellNavn', 'KIA EV9');
begin
  -- Oppsett: to TEST-varer.
  insert into lagervarer (id, navn, antall, enhet) values ('vare_TEST_a', 'TEST - Skuffeskinne', 10, 'stk'), ('vare_TEST_b', 'TEST - Skrue', 100, 'stk');

  -- T1 rettigheter
  insert into _res(navn, ok, info) values ('T1 bare service_role kan kalle hent/lagre',
    has_function_privilege('service_role', 'public.portal_oppskrift_lagre(jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.portal_oppskrift_hent(text,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.portal_oppskrift_lagre(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_oppskrift_lagre(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.portal_oppskrift_hent(text,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.portal_oppskrift_hent(text,text,text)', 'execute'), null);

  -- T2 hent uten id gir varene (med TEST-varene) og ingen oppskrift
  r := portal_oppskrift_hent(null, null, null);
  insert into _res(navn, ok, info) values ('T2 hent uten id: varer med, ingen oppskrift',
    jsonb_typeof(r->'varer') = 'array' and r->'oppskrift' = 'null'::jsonb
    and exists (select 1 from jsonb_array_elements(r->'varer') e where e->>'id' = 'vare_TEST_a' and (e->>'antall')::numeric = 10), left(r->>'flere', 20));

  -- T3 ugyldig input
  begin perform portal_oppskrift_lagre(v_basis || '{"deler":[]}'); insert into _res values (default, 'T3a mangler id avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3a mangler id avvises', sqlerrm = 'UGYLDIG_INPUT:id', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","tilleggId":"t_TEST","deler":[]}'); insert into _res values (default, 'T3b både variant og tillegg avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3b både variant og tillegg avvises', sqlerrm = 'UGYLDIG_INPUT:id', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[{"vareId":"vare_TEST_a","antall":0}]}'); insert into _res values (default, 'T3c antall 0 avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3c antall 0 avvises', sqlerrm = 'UGYLDIG_INPUT:deler', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[{"vareId":"vare_TEST_a"}]}'); insert into _res values (default, 'T3d manglende antall avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3d manglende antall avvises', sqlerrm = 'UGYLDIG_INPUT:deler', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[{"vareId":"vare_TEST_a","antall":1},{"vareId":"vare_TEST_a","antall":2}]}'); insert into _res values (default, 'T3e samme vare to ganger avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3e samme vare to ganger avvises', sqlerrm = 'UGYLDIG_INPUT:deler', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[{"vareId":"vare_TEST_finnes_ikke","antall":1}]}'); insert into _res values (default, 'T3f ukjent vare avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3f ukjent vare avvises', sqlerrm = 'UKJENT_VARE', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","produktnummer":"500, 502","deler":[]}'); insert into _res values (default, 'T3g nummer med komma avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3g nummer med komma avvises', sqlerrm = 'UGYLDIG_INPUT:produktnummer', sqlerrm); end;
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","prisgruppe":"ANNET","deler":[]}'); insert into _res values (default, 'T3h ukjent prisgruppe avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T3h ukjent prisgruppe avvises', sqlerrm = 'UGYLDIG_INPUT:prisgruppe', sqlerrm); end;
  insert into _res(navn, ok, info) values ('T3 ingen oppskrift laget av ugyldige kall', not exists (select 1 from lager_oppskrifter where portal_variant_id = 'v_TEST' or fiken_produktnummer like 'TEST%'), null);

  -- T4 ingen deler og ingen oppskrift fra før: ingenting lages
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST_tom","deler":[]}');
  insert into _res(navn, ok, info) values ('T4 uten deler lages ingen oppskrift', r->>'status' = 'ingen_deler'
    and not exists (select 1 from lager_oppskrifter where portal_variant_id = 'v_TEST_tom'), r::text);

  -- T5 ny oppskrift: ekstrautstyr-variant, biltype fra portal_modell_kobling
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[{"vareId":"vare_TEST_a","antall":4},{"vareId":"vare_TEST_b","antall":24}]}');
  v_id := r->>'oppskriftId';
  select * into v_rad from lager_oppskrifter where id = v_id;
  insert into _res(navn, ok, info) values ('T5 ny oppskrift opprettet med riktige felt', r->>'status' = 'opprettet'
    and v_rad.portal_variant_id = 'v_TEST' and v_rad.kilde = 'portal' and v_rad.type = 'ekstra_utstyr' and v_rad.fiken_produktnummer = 'TEST901'
    and v_rad.navn = 'TEST - Skuffesystem' and jsonb_array_length(v_rad.ingredienser) = 2
    and (r->>'biltypeFraKobling')::boolean = (exists (select 1 from portal_modell_kobling where portal_modell_slug = 'kia-ev9'))
    and v_rad.ingredienser @> '[{"vareId":"vare_TEST_a","antall":4}]', r::text || ' biltype=' || coalesce(v_rad.biltype, 'NULL'));

  -- T6 hent med variant-id gir oppskriften (koblet)
  r := portal_oppskrift_hent('v_TEST', null, 'TEST901');
  insert into _res(navn, ok, info) values ('T6 hent finner koblet oppskrift', r->'oppskrift'->>'id' = v_id and (r->'oppskrift'->>'koblet')::boolean, r->'oppskrift'::text);

  -- T7 lagre igjen: samme oppskrift oppdateres, navnet røres ikke, ingen ny rad
  update lager_oppskrifter set navn = 'TEST - navn satt i appen' where id = v_id;
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","navn":"TEST - nytt navn fra portalen","deler":[{"vareId":"vare_TEST_b","antall":12}]}');
  select * into v_rad from lager_oppskrifter where id = v_id;
  insert into _res(navn, ok, info) values ('T7 oppdatering: samme id, nye deler, navnet uendret', r->>'status' = 'oppdatert' and r->>'oppskriftId' = v_id
    and v_rad.navn = 'TEST - navn satt i appen' and v_rad.ingredienser = '[{"vareId":"vare_TEST_b","antall":12}]'::jsonb
    and (select count(*) from lager_oppskrifter where portal_variant_id = 'v_TEST') = 1, r::text);

  -- T8 standard ombygging (variant) gir type ombygging; tillegg på samme nummer får egen oppskrift (kobles på id, ikke nummer)
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST_std","produktnummer":"TEST902","prisgruppe":"STANDARD","deler":[{"vareId":"vare_TEST_a","antall":1}]}');
  insert into _res(navn, ok, info) values ('T8a standard variant gir type ombygging', (select type from lager_oppskrifter where id = r->>'oppskriftId') = 'ombygging', r::text);
  r := portal_oppskrift_lagre(v_basis || '{"tilleggId":"t_TEST","produktnummer":"TEST903","prisgruppe":"STANDARD","deler":[{"vareId":"vare_TEST_b","antall":2}]}');
  insert into _res(navn, ok, info) values ('T8b tillegg gir type ekstra_utstyr og portal_tillegg_id', (select type = 'ekstra_utstyr' and portal_tillegg_id = 't_TEST' and portal_variant_id is null
    from lager_oppskrifter where id = r->>'oppskriftId'), r::text);

  -- T9 eksisterende ukoblet oppskrift med nummeret blant flere («TEST904, TEST905») kobles i stedet for å lage ny
  insert into lager_oppskrifter (id, navn, biltype, type, ingredienser, fiken_produktnummer) values ('oppskrift_TEST_gammel', 'TEST - lagt inn i appen', 'EV9', 'ekstra_utstyr', '[]', 'TEST904, TEST905');
  r := portal_oppskrift_hent(null, 't_TEST_905', 'TEST905');
  insert into _res(navn, ok, info) values ('T9a hent finner ukoblet oppskrift på nummer (koblet=false)', r->'oppskrift'->>'id' = 'oppskrift_TEST_gammel' and not (r->'oppskrift'->>'koblet')::boolean, r->'oppskrift'::text);
  r := portal_oppskrift_lagre(v_basis || '{"tilleggId":"t_TEST_905","produktnummer":"TEST905","deler":[{"vareId":"vare_TEST_a","antall":1}]}');
  select * into v_rad from lager_oppskrifter where id = 'oppskrift_TEST_gammel';
  insert into _res(navn, ok, info) values ('T9b lagre kobler den gamle (ingen ny rad, nummer og navn urørt)', r->>'status' = 'koblet' and r->>'oppskriftId' = 'oppskrift_TEST_gammel'
    and v_rad.portal_tillegg_id = 't_TEST_905' and v_rad.fiken_produktnummer = 'TEST904, TEST905' and v_rad.navn = 'TEST - lagt inn i appen' and v_rad.kilde = 'app'
    and (select count(*) from lager_oppskrifter where oppskrift_har_produktnummer(fiken_produktnummer, 'TEST905')) = 1, r::text);

  -- T10 nummeret «TEST90» skal IKKE treffe «TEST904, TEST905» (helt nummer, ikke delstreng)
  insert into _res(navn, ok, info) values ('T10 delstreng av et nummer gir ikke treff', not oppskrift_har_produktnummer('TEST904, TEST905', 'TEST90')
    and oppskrift_har_produktnummer('TEST904;TEST905', 'TEST905') and oppskrift_har_produktnummer(' TEST904 ', 'TEST904') and not oppskrift_har_produktnummer('', ''), null);

  -- T11 to ukoblede oppskrifter med samme nummer: FLERE_OPPSKRIFTER, ingenting endret
  insert into lager_oppskrifter (id, navn, type, ingredienser, fiken_produktnummer) values
    ('oppskrift_TEST_d1', 'TEST - dobbel 1', 'ekstra_utstyr', '[]', 'TEST906'), ('oppskrift_TEST_d2', 'TEST - dobbel 2', 'ekstra_utstyr', '[]', 'TEST906, TEST907');
  r := portal_oppskrift_hent('v_TEST_d', null, 'TEST906');
  insert into _res(navn, ok, info) values ('T11a hent sier flere=2 og ingen oppskrift', (r->>'flere')::int = 2 and r->'oppskrift' = 'null'::jsonb, r->>'flere');
  begin perform portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST_d","produktnummer":"TEST906","deler":[{"vareId":"vare_TEST_a","antall":1}]}');
    insert into _res values (default, 'T11b lagre med to treff avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T11b lagre med to treff avvises', sqlerrm = 'FLERE_OPPSKRIFTER', sqlerrm); end;
  insert into _res(navn, ok, info) values ('T11c ingen av de to ble koblet', not exists (select 1 from lager_oppskrifter where id in ('oppskrift_TEST_d1','oppskrift_TEST_d2') and portal_variant_id is not null), null);

  -- T12 tomme deler på en KOBLET oppskrift tømmer delene (oppskriften blir stående)
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","deler":[]}');
  insert into _res(navn, ok, info) values ('T12 tom liste på koblet oppskrift tømmer delene', r->>'status' = 'oppdatert'
    and (select ingredienser from lager_oppskrifter where id = v_id) = '[]'::jsonb, r::text);

  -- T12b nytt produktnummer i portalen: portalens egen oppskrift følger, en koblet app-oppskrift beholder sine numre
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST","produktnummer":"TEST911","deler":[]}');
  insert into _res(navn, ok, info) values ('T12b portal-oppskrift får nytt nummer', (select fiken_produktnummer from lager_oppskrifter where id = v_id) = 'TEST911', r::text);
  r := portal_oppskrift_lagre(v_basis || '{"tilleggId":"t_TEST_905","produktnummer":"TEST912","deler":[]}');
  insert into _res(navn, ok, info) values ('T12c app-oppskrift beholder sine numre', (select fiken_produktnummer from lager_oppskrifter where id = 'oppskrift_TEST_gammel') = 'TEST904, TEST905', r::text);

  -- T13 ukjent modell-slug: biltype faller tilbake på modellnavnet
  r := portal_oppskrift_lagre(v_basis || '{"variantId":"v_TEST_ny_modell","produktnummer":"TEST908","modellSlug":"TEST-finnes-ikke","modellNavn":"TEST Bil X","deler":[{"vareId":"vare_TEST_a","antall":1}]}');
  insert into _res(navn, ok, info) values ('T13 ukjent slug gir biltype = modellnavn og biltypeFraKobling=false', not (r->>'biltypeFraKobling')::boolean
    and (select biltype from lager_oppskrifter where id = r->>'oppskriftId') = 'TEST Bil X', r::text);

  -- T14 constraints: begge koblinger på én rad avvises, ugyldig kilde avvises
  begin update lager_oppskrifter set portal_tillegg_id = 't_TEST_x' where id = v_id; insert into _res values (default, 'T14a variant + tillegg på samme rad avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T14a variant + tillegg på samme rad avvises', sqlstate = '23514', sqlerrm); end;
  begin update lager_oppskrifter set kilde = 'annet' where id = v_id; insert into _res values (default, 'T14b ugyldig kilde avvises', false, 'ingen feil');
  exception when others then insert into _res values (default, 'T14b ugyldig kilde avvises', sqlstate = '23514', sqlerrm); end;

  -- T15 eksisterende oppskrifter er urørt av migrasjonen: ingen ekte rad er koblet, og alle ekte rader har kilde app
  insert into _res(navn, ok, info) values ('T15 ekte oppskrifter: kilde app og ingen kobling',
    not exists (select 1 from lager_oppskrifter where coalesce(portal_variant_id, portal_tillegg_id, '') <> '' and coalesce(portal_variant_id, portal_tillegg_id) not like '%TEST%')
    and not exists (select 1 from lager_oppskrifter where kilde <> 'app' and coalesce(portal_variant_id, portal_tillegg_id, '') not like '%TEST%'),
    (select count(*)::text || ' oppskrifter totalt' from lager_oppskrifter));
end;
$test$;

select navn, ok, info from _res order by n;
