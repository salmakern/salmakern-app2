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
//     "Hente selv" OG bestilt_frakt=true - det betyr Admin-arkets egen "Bestill"-dialog
//     allerede har sendt varselet med henteklar-dato til kontaktpersonen for akkurat
//     denne bilen (adminArkSendFraktBestilling, js/admin-ark.js). Er ikke det tilfellet
//     (ingen admin_ark-rad, annet fraktselskap, eller ikke bestilt ennå), sendes portalens
//     e-post som normalt - det finnes ingen annen varsling da.
//   - alle andre 5 statuser (på en bekreftet ordre): ALLTID true (ingen eksisterende manuell
//     e-post å kollidere med).
//
// Nyttelasten har to valgfrie felt i tillegg (lagt til etter avklaring med portal-økta
// 31.10): endret_at (tidspunktet statusendringen faktisk ble lagt i køen, ikke når den ble
// sendt) og klar_for_henting_dato (bare for status klar_henting, datoen satt i endreStatus()
// - js/oversikt-kalender.js - slik portalen slipper et eget oppslag).
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

      let sendEpost = !!rad.ordrer?.portal_bekreftet_at && !trengerEpostAlltidFalse(rad.status)
      if (sendEpost && rad.status === 'klar_henting' && chassis) {
        const { data: arkRad } = await supabase
          .from('admin_ark')
          .select('fraktselskap, bestilt_frakt')
          .ilike('chassis_nr', chassis.trim())
          .maybeSingle()
        if (arkRad && arkRad.fraktselskap === 'Hente selv' && arkRad.bestilt_frakt === true) {
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
          feiletOppdateringer.push({ id: rad.id, forsok: (rad.forsok || 0) + 1, siste_feil: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` })
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

    return jsonSvar({ ok: true, sendt, feilet })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
