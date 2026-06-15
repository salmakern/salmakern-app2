import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL   = Deno.env.get('VAPID_EMAIL')!

webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC, VAPID_PRIVATE)

const STATUS_NAVN: Record<string, string> = {
  hentet:          '🚗 Hentet',
  klar_henting:    '📦 Klar for henting',
  vist_biltilsyn:  '🔍 Vist på biltilsyn',
  klar_visning:    '👁 Klar for visning',
  ikke_veid:       '⚖️ Ikke veid',
  paabegynt:       '🔧 Påbegynt',
  ikke_paabegynt:  '⏸ Ikke påbegynt',
  paa_vei:         '🛣 På vei',
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let title = '🚗 Salmakern'
    let body  = ''

    if (payload.type === 'daglig') {
      const { data: ordrer } = await supabase
        .from('ordrer').select('id').eq('status', 'aktiv')
      const antall = ordrer?.length ?? 0
      title = '☀️ God morgen!'
      body  = antall > 0
        ? `${antall} aktive ordrer venter i dag.`
        : 'Ingen aktive ordrer i dag – god arbeidsdag!'

    } else if (payload.type === 'UPDATE') {
      const { record, old_record } = payload
      const bil = record.regnr || record.kunde || 'Bil'

      const statusEndret = record.ordre_status !== old_record?.ordre_status
      const vektNy  = record.vekter?.totalvekt?.a
      const vektGml = old_record?.vekter?.totalvekt?.a
      const vektEndret = vektNy && !vektGml

      if (statusEndret) {
        title = STATUS_NAVN[record.ordre_status] || record.ordre_status
        body  = bil
      } else if (vektEndret) {
        title = '⚖️ Bil veid'
        body  = `${bil}: ${vektNy} kg`
      }
    }

    if (!body) return new Response('ingen varsel', { status: 200 })

    const { data: subs } = await supabase.from('push_abonnement').select('*')
    if (!subs?.length) return new Response('ingen abonnenter', { status: 200 })

    const melding = JSON.stringify({ title, body, url: '/salmakern-app2/salmakern.html' })

    await Promise.allSettled(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          melding
        )
      } catch (e: any) {
        // Utløpt abonnement – slett det
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_abonnement').delete().eq('endpoint', sub.endpoint)
        }
      }
    }))

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error(e)
    return new Response(String(e), { status: 500 })
  }
})
