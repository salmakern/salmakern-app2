// s08-034 (Bestill fase 3, del 2): sender statusendringer fra ordre_status_utboks
// (20261030200000, nå filtrert til kun portal-ordre - se 20261031160000) videre til
// Forhandlerportalens endepunkt, som oppdaterer "Mine bestillinger" og (med mindre
// send_epost er false) sender e-post til kontaktpersonen som bestilte.
//
// Kalles KUN av den planlagte cron-jobben (pg_cron) - egen hemmelighet
// (ORDRE_STATUS_SYNK_SECRET), samme mønster som fiken-priser-synk. IKKE tenkt kalt fra
// appen eller portalen direkte.
//
// send_epost (Henrik, s08-034, avgjort 30.10; presisert etter spørsmål fra portal-økta 31.10):
//   - Ordren er IKKE bekreftet ennå (portal_bekreftet_at er null): ALLTID false, uansett
//     status. En ubekreftet ordre kan vise seg å ha feil chassis.nr og bli slettet - ingen
//     grunn til å varsle forhandleren om en statusendring på en bestilling Salmaker'n ikke
//     engang har bekreftet å ha mottatt ennå.
//   - "hentet": ALLTID false. Admin-arkets "✔ Hentet"-knapp eier fortsatt denne e-posten
//     helt til Henrik sier fra ("i overgangen beholder Admin-ark knappen og portalen
//     sender IKKE hentet-mail ... så ingen får to e-poster").
//   - "klar_henting": false NÅR admin_ark-raden for samme chassis har fraktselskap
//     "Hente selv" OG (bestilt_frakt=true ELLER frakt_forberedt_at er satt) - det betyr
//     Admin-arkets egen "Bestill"-dialog allerede har sendt (eller er i ferd med å bli
//     bekreftet for å sende, se s90-20261104-x) varselet med henteklar-dato til
//     kontaktpersonen for akkurat denne bilen (adminArkSendFraktBestilling, js/admin-ark.js).
//     frakt_forberedt_at settes UMIDDELBART av databasetriggeren "ordre-frakt-forbered" idet
//     statusen blir klar_henting (før selve e-posten er bekreftet/sendt av en ansatt) -
//     nettopp for å vinne dette kappløpet mot denne funksjonens egen, nå umiddelbare,
//     sending (20261101160000). Er ingen av delene satt (ingen admin_ark-rad, annet
//     fraktselskap, eller ikke bestilt/forberedt ennå), sendes portalens e-post som normalt -
//     det finnes ingen annen varsling da.
//   - alle andre 5 statuser (på en bekreftet ordre): ALLTID true (ingen eksisterende manuell
//     e-post å kollidere med).
//
// Nyttelasten har to valgfrie felt i tillegg (lagt til etter avklaring med portal-økta
// 31.10): endret_at (tidspunktet statusendringen faktisk ble lagt i køen, ikke når den ble
// sendt) og klar_for_henting_dato (bare for status klar_henting, datoen satt i endreStatus()
// - js/oversikt-kalender.js - slik portalen slipper et eget oppslag).
//
// Portalens svar (bekreftet 31.10): 200 = levert (lagret/allerede); 404 ukjent
// portal_bestilling_id er PERMANENT (markeres levert med feilen notert, prøves ALDRI på
// nytt - idempotens-id-en finnes ikke der, et nytt forsøk endrer ingenting); alt annet
// (401/413/429/5xx/nettverksfeil/tidsavbrudd) er forbigående og prøves igjen neste
// cron-kjøring med SAMME event_id (idempotent hos portalen - en retry etter f.eks. en 502
// der bare e-posten feilet skal ikke lage en ny hendelse der).
//
// VIKTIG (rettet 31.10 etter funn fra portal-økta): en 404 er bare permanent når KROPPEN
// faktisk er portalens egen {"ok":false,"feil":"ukjent_bestilling"} - IKKE enhver 404.
// Et plattform-404 (ruten ikke utrullet ennå, feil domene, Vercel DEPLOYMENT_NOT_FOUND)
// har samme statuskode, men betyr "prøv igjen senere", ikke "gi opp for alltid" - uten
// dette sjekket ville ett slikt utfall markert en hel batch (opptil 100 rader) "levert"
// og de forsvinner stille for godt.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SYNC_SECRET = Deno.env.get('ORDRE_STATUS_SYNK_SECRET')
const PORTAL_URL = Deno.env.get('SALMAKERN_STATUS_PORTAL_URL') || 'https://forhandler.salmaker.as/api/salmakern/bestilling-status'
const PORTAL_SECRET = Deno.env.get('SALMAKERN_STATUS_SECRET')
const MAKS_FORSOK = 20

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function trengerEpostAlltidFalse(status: string) {
  return status === 'hentet'
}

// En 404 er bare portalens egen "ukjent bestilling" (og dermed permanent) når kroppen
// faktisk er deres {"ok":false,"feil":"ukjent_bestilling"} - se kommentaren øverst i filen.
function erPortalensUkjentBestillingSvar(kropp: string): boolean {
  try {
    const data = JSON.parse(kropp)
    return data && typeof data === 'object' && data.feil === 'ukjent_bestilling'
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  try {
    if (!SYNC_SECRET || req.headers.get('x-sync-secret') !== SYNC_SECRET) {
      return jsonSvar({ error: 'Ugyldig eller manglende x-sync-secret' }, 401)
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonSvar({ error: 'Mangler Supabase-tilgang i funksjonen' }, 500)
    if (!PORTAL_SECRET) return jsonSvar({ error: 'SALMAKERN_STATUS_SECRET er ikke satt - sender ingenting' }, 500)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: rader, error: feilVedHenting } = await supabase
      .from('ordre_status_utboks')
      .select('id, ordre_id, status, status_forrige, forsok, opprettet_at, ordrer!inner(portal_bestilling_id, portal_bekreftet_at, chassis, dato_klar_henting)')
      .eq('levert', false)
      .lt('forsok', MAKS_FORSOK)
      .order('opprettet_at', { ascending: true })
      .limit(100)
    if (feilVedHenting) return jsonSvar({ error: 'Kunne ikke hente fra utboksen: ' + feilVedHenting.message }, 500)
    if (!rader || rader.length === 0) return jsonSvar({ ok: true, sendt: 0, feilet: 0 })

    let sendt = 0
    let feilet = 0
    const levertIder: number[] = []
    const feiletOppdateringer: { id: number; forsok: number; siste_feil: string }[] = []
    const feiletPermanentIder: { id: number; siste_feil: string }[] = []

    for (const rad of rader as any[]) {
      const portalBestillingId = rad.ordrer?.portal_bestilling_id
      const chassis = rad.ordrer?.chassis
      if (!portalBestillingId) {
        // Skal ikke forekomme (triggeren filtrerer nå på dette), men en rad som likevel
        // mangler portal_bestilling_id kan aldri leveres - marker den levert så den ikke
        // blir liggende og prøvd på nytt for alltid.
        levertIder.push(rad.id)
        continue
      }

      // Startstatus-raden lagt av portal_bekreft_ordre (status_forrige null, se migrasjon
      // 20261031180000) er ikke en reell overgang - portal-økta bekreftet 31.10 at den
      // ALDRI skal gi e-post (de har også egen vakt mot dette, men riktig her også).
      let sendEpost = rad.status_forrige !== null && !!rad.ordrer?.portal_bekreftet_at && !trengerEpostAlltidFalse(rad.status)
      if (sendEpost && rad.status === 'klar_henting' && chassis) {
        const { data: arkRad } = await supabase
          .from('admin_ark')
          .select('fraktselskap, bestilt_frakt, frakt_forberedt_at')
          .ilike('chassis_nr', chassis.trim())
          .maybeSingle()
        if (arkRad && arkRad.fraktselskap === 'Hente selv' && (arkRad.bestilt_frakt === true || arkRad.frakt_forberedt_at !== null)) {
          sendEpost = false
        }
      }

      try {
        const res = await fetch(PORTAL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-salmakern-status-secret': PORTAL_SECRET },
          body: JSON.stringify({
            event_id: `so-${rad.id}`,
            portal_bestilling_id: portalBestillingId,
            status: rad.status,
            status_forrige: rad.status_forrige,
            send_epost: sendEpost,
            endret_at: rad.opprettet_at,
            ...(rad.status === 'klar_henting' && rad.ordrer?.dato_klar_henting ? { klar_for_henting_dato: rad.ordrer.dato_klar_henting } : {}),
          }),
        })
        if (res.ok) {
          levertIder.push(rad.id)
          sendt++
        } else {
          const kropp = await res.text()
          if (res.status === 404 && erPortalensUkjentBestillingSvar(kropp)) {
            // Portal-økta (31.10, rettet etter funn fra dem samme dag): KUN portalens egen
            // {"ok":false,"feil":"ukjent_bestilling"} er permanent - et nytt forsøk endrer
            // ingenting, så raden markeres levert med feilen notert i stedet for å stå og
            // prøves på nytt for alltid. En 404 uten denne kroppen (plattform-404, f.eks.
            // ruten ikke utrullet ennå eller feil domene) faller gjennom til grenen under
            // og prøves på nytt som alt annet forbigående.
            feiletPermanentIder.push({ id: rad.id, siste_feil: `HTTP 404: ukjent portal_bestilling_id (${kropp.slice(0, 200)})` })
          } else {
            feiletOppdateringer.push({ id: rad.id, forsok: (rad.forsok || 0) + 1, siste_feil: `HTTP ${res.status}: ${kropp.slice(0, 300)}` })
          }
          feilet++
        }
      } catch (e) {
        feiletOppdateringer.push({ id: rad.id, forsok: (rad.forsok || 0) + 1, siste_feil: String(e).slice(0, 300) })
        feilet++
      }
    }

    if (levertIder.length > 0) {
      await supabase.from('ordre_status_utboks').update({ levert: true, levert_at: new Date().toISOString() }).in('id', levertIder)
    }
    for (const opp of feiletOppdateringer) {
      await supabase.from('ordre_status_utboks').update({ forsok: opp.forsok, siste_feil: opp.siste_feil }).eq('id', opp.id)
    }
    for (const opp of feiletPermanentIder) {
      await supabase.from('ordre_status_utboks').update({ levert: true, levert_at: new Date().toISOString(), siste_feil: opp.siste_feil }).eq('id', opp.id)
    }

    return jsonSvar({ ok: true, sendt, feilet })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
