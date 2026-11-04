-- Kjørt: 2026-11-04
-- Henrik (4.11): "for når en ordre endre status til klar for henting skal den automatisk
-- bestille frakt automatisk hvis den ikke er bestilt fra før av" - gjelder BÅDE ekte
-- fraktselskap og "Hente selv" (bekreftet), men med en bekreftelse før selve e-posten
-- sendes (sikkerhetsventil, bekreftet - en feilaktig bestilling til et ekte fraktselskap
-- kan ikke trekkes tilbake).
--
-- Denne migrasjonen gjør KUN den automatiske FORBEREDELSEN (databasesiden): en ny trigger
-- på ordrer merker admin_ark-raden med frakt_forberedt_at så snart ordre_status faktisk
-- blir 'klar_henting' (og fraktselskap er satt, ikke "Levering av oss", og frakt ikke alt
-- er bestilt). Selve e-postsendingen skjer fortsatt via det eksisterende "📧 Bestill"-
-- trykket i Admin-ark (adminArkSendFraktBestilling, js/admin-ark.js) - klientendringen som
-- viser raden som "klar til bekreftelse" og setter bestilt_frakt=true ved faktisk sending
-- kommer i en egen, separat commit.
--
-- Triggernavnet "ordre-frakt-forbered" er bevisst valgt slik at den alfabetisk kjører FØR
-- "ordre-push"/"ordre-status-historikk"/"ordre-status-utboks" (Postgres fyrer triggere for
-- samme hendelse i alfabetisk rekkefølge på navn) - frakt_forberedt_at er dermed alltid satt
-- FØR utboks-raden til portalen lages og FØR den umiddelbare sendingen til portalen
-- (20261101160000) leser admin_ark. Det er det som løser kappløpet: send-ordre-status-til-
-- portal sin skip-logikk for "Hente selv" (se index.ts) utvides til å også godta
-- frakt_forberedt_at IS NOT NULL, ikke bare bestilt_frakt=true.
--
-- Rollback: drop trigger "ordre-frakt-forbered" on public.ordrer; drop function
-- public.ordre_frakt_forbered_fn(); alter table public.admin_ark drop column
-- frakt_forberedt_at; (husk å rulle tilbake send-ordre-status-til-portal sin kodeendring
-- FØRST, eller den vil lese en kolonne som ikke lenger finnes).

alter table public.admin_ark add column if not exists frakt_forberedt_at timestamptz;

create or replace function public.ordre_frakt_forbered_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.ordre_status = 'klar_henting'
     and old.ordre_status is distinct from new.ordre_status
     and coalesce(new.ordretype, 'bil') = 'bil'
     and coalesce(new.chassis, '') <> ''
  then
    begin
      update public.admin_ark
      set frakt_forberedt_at = now()
      where not arkivert
        and upper(btrim(chassis_nr)) = upper(btrim(new.chassis))
        and coalesce(fraktselskap, '') <> ''
        and fraktselskap <> 'Levering av oss'
        and bestilt_frakt = false
        and frakt_forberedt_at is null;
    exception when others then
      -- Best-effort, samme prinsipp som ordre-push: en feilende forberedelse skal ALDRI
      -- rulle tilbake selve statusoppdateringen. Admin kan fortsatt bestille manuelt som før.
      raise warning 'ordre-frakt-forbered: feilet (%), fortsetter uendret', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists "ordre-frakt-forbered" on public.ordrer;
create trigger "ordre-frakt-forbered"
after update on public.ordrer
for each row
execute function public.ordre_frakt_forbered_fn();
