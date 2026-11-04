-- Kjørt: 2026-11-04, Henriks ja ("Ja greit rett det").
-- Bakgrunn (funnet av portal-økta, bekreftet mot produksjonsdata 4.11): admin_ark.fraktselskap har to
-- gamle/avvikende skrivemåter som appens kode (FRAKTSELSKAP_HENTE_SELV/FRAKTSELSKAP_LEVERING_AV_OSS i
-- js/admin-ark.js) og send-ordre-status-til-portal sin "Hente selv"-e-postsperre sjekker EKSAKT mot:
-- 48 ikke-arkiverte rader sier "Henter selv" (skal være "Hente selv"), 2 sier "Levert av oss" (skal
-- være "Levering av oss"). Ren tekstnormalisering, samme betydning - ingen andre felt røres.
--
-- Rader utenfor disse to eksakte strengene (f.eks. ekte fraktselskapsnavn, tomt felt) er urørt.
-- Transaksjonen sjekker eksakt antall rader truffet (48 og 2) og ruller tilbake hvis det avviker,
-- slik at en uventet endring i dataene siden funnet ble gjort ikke går upåaktet gjennom.
--
-- Rollback: data kan ikke "angres" presist (vi vet ikke hvilke rader som opprinnelig var feilstavet
-- etter at dette er kjørt), men siden de to skrivemåtene uansett skal bety det samme i appen, er en
-- rollback normalt unødvendig. Vil man likevel reversere nøyaktig denne kjøringen: bruk
-- admin_ark sin historikk-/revisjonslogg hvis den finnes, ellers er endringen ment å være permanent.

begin;

do $$
declare
  v_hente_selv int;
  v_levering_av_oss int;
begin
  update public.admin_ark set fraktselskap = 'Hente selv' where fraktselskap = 'Henter selv';
  get diagnostics v_hente_selv = row_count;
  if v_hente_selv <> 48 then
    raise exception 'Forventet å treffe 48 rader (Henter selv -> Hente selv), traff %. Avbryter.', v_hente_selv;
  end if;

  update public.admin_ark set fraktselskap = 'Levering av oss' where fraktselskap = 'Levert av oss';
  get diagnostics v_levering_av_oss = row_count;
  if v_levering_av_oss <> 2 then
    raise exception 'Forventet å treffe 2 rader (Levert av oss -> Levering av oss), traff %. Avbryter.', v_levering_av_oss;
  end if;
end $$;

commit;
