import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL   = Deno.env.get('VAPID_EMAIL')!

webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC, VAPID_PRIVATE)

const STATUS_NAVN: Record<string, string> = {
  hentet:          'Hentet',
  bestilt_frakt:   'Bestilt frakt',
  klar_henting:    'Klar for henting',
  vist_biltilsyn:  'Vist på biltilsynet',
  klar_visning:    'Klar for visning',
  ikke_veid:       'Ikke veid',
  paabegynt:       'Påbegynt',
  ikke_paabegynt:  'Ikke påbegynt',
  paa_vei:         'På vei',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Gir dagens dato og klokkeslett (i minutter siden midnatt) i Oslo lokaltid, uavhengig
// av at serveren selv kjører i UTC - håndterer sommer-/vintertid automatisk via Intl.
function osloNaa(): { dato: string, minutter: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  })
  const deler = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  return { dato: `${deler.year}-${deler.month}-${deler.day}`, minutter: Number(deler.hour) * 60 + Number(deler.minute) }
}
function imorgenDato(dagensDato: string): string {
  const d = new Date(dagensDato + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Sender hver melding kun til abonnentene som hører til deltakerIder - tom/manglende
// deltakerIder betyr "alle" (bevarer eksisterende oppførsel for biltilsyn-varsler m.m.).
async function sendTilAbonnenter(
  supabase: ReturnType<typeof createClient>,
  meldinger: { title: string, body: string, deltakerIder?: number[] }[]
) {
  if (!meldinger.length) return
  const { data: subs } = await supabase.from('push_abonnement').select('*')
  if (!subs?.length) return
  for (const msg of meldinger) {
    const mottakere = (msg.deltakerIder && msg.deltakerIder.length)
      ? subs.filter((s: any) => msg.deltakerIder!.includes(s.ansatt_id))
      : subs
    if (!mottakere.length) continue
    const melding = JSON.stringify({ title: msg.title, body: msg.body, url: '/salmakern-app2/salmakern.html' })
    await Promise.allSettled(mottakere.map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, melding)
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_abonnement').delete().eq('endpoint', sub.endpoint)
        }
      }
    }))
  }
}

// Gir " (Navn1, Navn2)" for et sett ansatt-IDer, eller '' hvis ingen er valgt ELLER
// utvalget tilfeldigvis dekker samtlige aktive ansatte (da regnes det som "alle").
async function deltakerNavnSuffiks(supabase: ReturnType<typeof createClient>, ider?: number[]): Promise<string> {
  if (!ider || !ider.length) return ''
  const { data: aktive } = await supabase.from('ansatte').select('id').eq('aktiv', true)
  const aktiveIder = (aktive ?? []).map((a: any) => a.id)
  const dekkerAlleAktive = aktiveIder.length > 0 && aktiveIder.every((id: number) => ider.includes(id))
  if (dekkerAlleAktive) return ''
  const { data } = await supabase.from('ansatte').select('id, navn').in('id', ider)
  const navn = (data ?? []).map((a: any) => a.navn).filter(Boolean)
  return navn.length ? ` (${navn.join(', ')})` : ''
}

Deno.serve(async (req) => {
  // Nettlesere sender en tom "preflight"-forespørsel (OPTIONS) før selve POST-kallet
  // når man kaller funksjonen direkte fra en annen origin med Authorization-header.
  // Uten dette svaret prøver koden under å JSON-parse den tomme OPTIONS-requesten og krasjer,
  // og selve POST-kallet med det ekte innholdet blokkeres av nettleseren.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const raw = await req.text()
    if (!raw) {
      console.error('Tom body mottatt. Method:', req.method, 'Headers:', JSON.stringify([...req.headers.entries()]))
      return new Response('tom body', { status: 400, headers: CORS_HEADERS })
    }
    const payload = JSON.parse(raw)
    console.log('Payload type:', payload.type)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Sendes fra klienten idet et møte opprettes - umiddelbart varsel, kun til de
    // eventuelt utvalgte deltakerne (tom liste = alle).
    if (payload.type === 'nytt_mote') {
      const navnSuffiks = await deltakerNavnSuffiks(supabase, payload.deltakerIder)
      await sendTilAbonnenter(supabase, [{
        title: 'Nytt møte satt',
        body: `${payload.tittel} - ${payload.dato?.split('-').reverse().join('.')} kl. ${payload.tid}${navnSuffiks}`,
        deltakerIder: payload.deltakerIder
      }])
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    // Kalles jevnlig av en cron-jobb (ikke fra klienten) - sjekker selv om noe er i ferd
    // til å skje, istedenfor å få beskjed om det. Kan sende flere ulike varsler i ett kall.
    if (payload.type === 'paaminnelser_sjekk') {
      const naa = osloNaa()
      const meldinger: { title: string, body: string, deltakerIder?: number[] }[] = []

      // --- Time på biltilsynet, sendes når det er 30 minutter eller mindre igjen ---
      const { data: ordre, error: ordreErr } = await supabase
        .from('ordrer')
        .select('id, chassis, regnr, kunde, tid_biltilsynet, tid_biltilsynet_tid, tid_biltilsynet_sted')
        .eq('tid_biltilsynet', naa.dato)
        .eq('biltilsyn_varslet', false)
        .not('tid_biltilsynet_tid', 'is', null)
      if (ordreErr) console.error('Henting av ordre feilet:', ordreErr.message)

      const varsletOrdreIder: string[] = []
      for (const o of ordre ?? []) {
        if (!o.tid_biltilsynet_tid) continue
        const [t, m] = o.tid_biltilsynet_tid.split(':').map(Number)
        if (Number.isNaN(t) || Number.isNaN(m)) continue
        const diff = (t * 60 + m) - naa.minutter
        if (diff >= 0 && diff <= 30) {
          const bil = o.chassis || o.regnr || o.kunde || 'Bil'
          const stedTekst = o.tid_biltilsynet_sted ? ` (${o.tid_biltilsynet_sted})` : ''
          meldinger.push({ title: 'Time på biltilsynet snart', body: `${bil} skal på biltilsynet kl. ${o.tid_biltilsynet_tid}${stedTekst}` })
          varsletOrdreIder.push(o.id)
        }
      }
      if (varsletOrdreIder.length) {
        await supabase.from('ordrer').update({ biltilsyn_varslet: true }).in('id', varsletOrdreIder)
      }

      // --- Møter, sendes kl 18:00 kvelden før ---
      if (naa.minutter >= 18 * 60) {
        const { data: moter, error: moterErr } = await supabase
          .from('moter')
          .select('id, tittel, tid, deltaker_ider')
          .eq('dato', imorgenDato(naa.dato))
          .eq('varslet', false)
        if (moterErr) console.error('Henting av møter feilet:', moterErr.message)
        const varsletMoteIder: string[] = []
        for (const m of moter ?? []) {
          const navnSuffiks = await deltakerNavnSuffiks(supabase, m.deltaker_ider)
          meldinger.push({ title: 'Møte i morgen', body: `${m.tittel} kl. ${m.tid}${navnSuffiks}`, deltakerIder: m.deltaker_ider })
          varsletMoteIder.push(m.id)
        }
        if (varsletMoteIder.length) {
          await supabase.from('moter').update({ varslet: true }).in('id', varsletMoteIder)
        }
      }

      if (!meldinger.length) return new Response('ingen påminnelser', { status: 200, headers: CORS_HEADERS })
      await sendTilAbonnenter(supabase, meldinger)
      return new Response('ok', { status: 200, headers: CORS_HEADERS })
    }

    let title = "Salmaker'n"
    let body  = ''

    if (payload.type === 'daglig') {
      title = 'Påminnelse'
      body = 'Husk å starte timer!'

    } else if (payload.type === 'UPDATE') {
      const { record, old_record } = payload
      const bil = record.chassis || record.regnr || record.kunde || 'Bil'
      const statusEndret = record.ordre_status !== old_record?.ordre_status
      const vektNy  = record.vekter?.totalvekt?.v
      const vektGml = old_record?.vekter?.totalvekt?.v
      const vektEndret = vektNy && !vektGml
      const hengerfesteMontertEndret = record.utstyr?.hengerfesteMontert === 'montert' && old_record?.utstyr?.hengerfesteMontert !== 'montert'

      console.log('bil:', bil, 'ordre_status ny:', record.ordre_status, 'gammel:', old_record?.ordre_status, 'statusEndret:', statusEndret)

      if (statusEndret) {
        const statusNavn = STATUS_NAVN[record.ordre_status] || record.ordre_status
        title = 'Statusendring'
        body = `${bil} er ${statusNavn.toLowerCase()}`
      } else if (vektEndret) {
        title = 'Vekt registrert'
        body = `${bil} er veid: ${vektNy} kg`
      } else if (hengerfesteMontertEndret) {
        title = 'Hengerfeste'
        body = `${bil} har fått montert hengerfeste`
      }
    } else if (payload.type === 'lav_lager') {
      title = `Lav beholdning: ${payload.vareNavn}`
      body = `${payload.antall} ${payload.enhet} igjen (grense: ${payload.minAntall})`

    } else if (payload.type === 'mangelfull_levering') {
      title = `Mangelfull levering: ${payload.vareNavn}`
      body = `Forventet ${payload.forventet}, fikk kun ${payload.mottatt} ${payload.enhet} (mangler ${payload.mangler})`

    } else {
      console.log('Ukjent type, payload:', JSON.stringify(payload).slice(0, 200))
    }

    if (!body) {
      console.log('Ingen varsel å sende')
      return new Response('ingen varsel', { status: 200, headers: CORS_HEADERS })
    }

    const { data: subs, error: subErr } = await supabase.from('push_abonnement').select('*')
    console.log('Abonnenter:', subs?.length ?? 0, subErr?.message ?? '')
    if (!subs?.length) return new Response('ingen abonnenter', { status: 200, headers: CORS_HEADERS })

    const melding = JSON.stringify({ title, body, url: '/salmakern-app2/salmakern.html' })
    console.log('Sender:', melding)

    await Promise.allSettled(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          melding
        )
        console.log('Sendt til:', sub.endpoint.slice(0, 50))
      } catch (e: any) {
        console.error('Push-feil:', e.statusCode, e.message)
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_abonnement').delete().eq('endpoint', sub.endpoint)
        }
      }
    }))

    return new Response('ok', { status: 200, headers: CORS_HEADERS })
  } catch (e) {
    console.error('Kritisk feil:', e)
    return new Response(String(e), { status: 500, headers: CORS_HEADERS })
  }
})
