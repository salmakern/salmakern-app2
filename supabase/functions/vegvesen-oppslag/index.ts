// Slår opp kjøretøydata hos Statens vegvesen sitt "enkeltoppslag"-API på vegne av
// klienten. Nøkkelen MÅ holdes server-side her - kaller klienten Statens vegvesen
// direkte, kan enhver som åpner utviklerverktøy i nettleseren lese ut og misbruke
// nøkkelen (delt kvote på 50 000 kall/døgn, knyttet til Henriks Altinn-identitet).
// Se https://autosys-kjoretoy-api.atlas.vegvesen.no/api-ui/index-enkeltoppslag.html
//
// Merk: denne tjenesten gir IKKE eierinformasjon (bekreftet i Statens vegvesen sin
// egen dokumentasjon) - ikke prøv å hente eier-navn herfra, det vil alltid mangle.

const VEGVESEN_API_KEY = Deno.env.get('VEGVESEN_API_KEY')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonSvar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (!VEGVESEN_API_KEY) {
      return jsonSvar({ error: 'Ingen API-nøkkel for Statens vegvesen er satt opp ennå' }, 500)
    }

    const { regnr } = await req.json()
    if (!regnr) return jsonSvar({ error: 'Mangler regnr' }, 400)

    const res = await fetch(
      `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=${encodeURIComponent(regnr)}`,
      { headers: { 'SVV-Authorization': `Apikey ${VEGVESEN_API_KEY}` } }
    )
    if (!res.ok) return jsonSvar({ error: `Statens vegvesen svarte ${res.status}` }, 502)

    const data = await res.json()
    const kjt = data?.kjoretoydataListe?.[0]
    if (!kjt) return jsonSvar({ error: 'Ingen data funnet for dette reg.nr-et' }, 404)

    const td = kjt.godkjenning?.tekniskGodkjenning?.tekniskeData
    const merke = td?.generelt?.merke?.[0]?.merke || ''
    const modell = td?.generelt?.handelsbetegnelse?.[0] || ''
    const aar = kjt.forstegangsregistrering?.registrertForstegangNorgeDato?.substring(0, 4) || ''
    const chassis = kjt.kjennemerke?.understellsnummer || ''

    return jsonSvar({ merke, modell, aar, chassis })
  } catch (e) {
    return jsonSvar({ error: String(e) }, 500)
  }
})
