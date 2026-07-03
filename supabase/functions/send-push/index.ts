import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL   = Deno.env.get('VAPID_EMAIL')!

webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC, VAPID_PRIVATE)

const STATUS_NAVN: Record<string, string> = {
  hentet:          'Hentet',
  klar_henting:    'Klar for henting',
  vist_biltilsyn:  'Vist på biltilsyn',
  klar_visning:    'Klar for visning',
  ikke_veid:       'Ikke veid',
  paabegynt:       'Påbegynt',
  ikke_paabegynt:  'Ikke påbegynt',
  paa_vei:         'På vei',
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    console.log('Payload type:', payload.type)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let title = 'Salmakern'
    let body  = ''

    if (payload.type === 'daglig') {
      body = 'Husk å starte timer for lønn!'

    } else if (payload.type === 'UPDATE') {
      const { record, old_record } = payload
      const bil = record.chassis || record.regnr || record.kunde || 'Bil'
      const statusEndret = record.ordre_status !== old_record?.ordre_status
      const vektNy  = record.vekter?.totalvekt?.v
      const vektGml = old_record?.vekter?.totalvekt?.v
      const vektEndret = vektNy && !vektGml

      console.log('bil:', bil, 'ordre_status ny:', record.ordre_status, 'gammel:', old_record?.ordre_status, 'statusEndret:', statusEndret)

      if (statusEndret) {
        const statusNavn = STATUS_NAVN[record.ordre_status] || record.ordre_status
        body = `${bil} er ${statusNavn.toLowerCase()}`
      } else if (vektEndret) {
        body = `${bil} er veid: ${vektNy} kg`
      }
    } else {
      console.log('Ukjent type, payload:', JSON.stringify(payload).slice(0, 200))
    }

    if (!body) {
      console.log('Ingen varsel å sende')
      return new Response('ingen varsel', { status: 200 })
    }

    const { data: subs, error: subErr } = await supabase.from('push_abonnement').select('*')
    console.log('Abonnenter:', subs?.length ?? 0, subErr?.message ?? '')
    if (!subs?.length) return new Response('ingen abonnenter', { status: 200 })

    const melding = JSON.stringify({ title, body, url: 'salmakern.html' })
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

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('Kritisk feil:', e)
    return new Response(String(e), { status: 500 })
  }
})
