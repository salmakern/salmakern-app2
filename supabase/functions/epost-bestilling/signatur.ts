// Svix-signaturen på Resend sine webhook-varsler (trinn 5). Ren, testet i test/epost-bestilling.test.js.
const TOLERANSE_S = 300

function b64(s: string): Uint8Array {
  const bin = atob(s)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
function liktBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

// Svix-signatur: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), i headeren som «v1,<sig>» (kan være flere, skilt med mellomrom).
export async function signaturOk(secret: string, id: string, ts: string, body: string, signaturer: string, naa = Date.now()): Promise<boolean> {
  if (!secret.startsWith('whsec_') || !id || !/^\d{1,12}$/.test(ts)) return false
  if (Math.abs(naa / 1000 - Number(ts)) > TOLERANSE_S) return false
  let nokkel: Uint8Array
  try { nokkel = b64(secret.slice('whsec_'.length)) } catch { return false }
  const k = await crypto.subtle.importKey('raw', nokkel, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const forventet = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  for (const del of signaturer.split(' ')) {
    const [versjon, sig] = del.split(',')
    if (versjon !== 'v1' || !sig) continue
    try { if (liktBytes(b64(sig), forventet)) return true } catch { /* ugyldig base64: neste */ }
  }
  return false
}

