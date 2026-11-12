// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ORDRE-LAPP PÅ LEITZ ICON (Henrik 2026-11-11): en lapp på 25 mm bred rull for hver ny bil-ordre.
// - Lappen er 60 x 25 mm: QR-kode til venstre (åpner ordren i appen: salmakern.html?ordre=<id>), hele chassis.nr (ellers reg.nr), kunde og merke/modell + dato til høyre.
// - UTSKRIFTSSTASJON: én PC med skriveren slår på «Skriv ut ordre-lapper» i Mer (lagres bare på den enheten, localStorage). Den skriver da ut en lapp for hver ny bil-ordre,
//   uansett hvem som registrerer den og hvor (mobil, Admin-ark, Forhandlerportalen): Realtime-INSERT på ordrer, og i tillegg en «ta igjen» etter hver innlasting
//   for ordrer som kom mens PC-en sov eller var uten nett (bare ordrer opprettet ETTER at stasjonen ble slått på, og høyst 24 t gamle).
// - Hver ordre skrives ut ÉN gang per enhet (liste over utskrevne id-er i localStorage, delt mellom faner). Flere nye ordrer tett etter hverandre blir én utskriftsjobb.
// - Uten dialog: et eget Edge-vindu med egen profil (--user-data-dir) og --kiosk-printing, som skriver til siste skriver/papir valgt i den profilen. Papiret må være
//   Windows-skjemaet «Ordre-lapp 25 x 60 mm» (med driverens «Continuous - 1"» mater Leitz Icon ut 17,5 cm, testet 2026-11-11), eller «Del-lapp 50 x 180 mm» for del-lappen (230 mm til 2026-11-12).
// - DEL-LAPP (Henrik 2026-11-11, etter hans egen mal fra Leitz-programmet): en annen PC med 50 mm rull skriver ut en lapp til å merke delene til bilen, også automatisk
//   for hver ny ordre: ramme og to linjer i stor fet skrift langs lappen, merke + modell og hele chassis.nr. Hver PC velger lapptype selv (ORDRE_LAPP_TYPE_NOKKEL), så to
//   stasjoner gir én ordre-lapp og én del-lapp per ordre (utskrevet-lista er per enhet).
// - Leveranser får ikke lapp (bare ordretype bil). Bruker qrSvg/sikreQrBibliotek/skrivUtHtml fra lager-hylle.js (lastes etter den).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const ORDRE_LAPP_STASJON_NOKKEL = 'ordreLappStasjon';      // ms-tidspunkt stasjonen ble slått på (tom = av)
const ORDRE_LAPP_UTSKREVET_NOKKEL = 'ordreLappUtskrevet';  // JSON-liste med ordre-id-er som er skrevet ut på denne enheten
const ORDRE_LAPP_TYPE_NOKKEL = 'ordreLappType';
const ORDRE_LAPP_DEL_LENGDE_NOKKEL = 'ordreLappDelLengde'; // 'modell' = 180 eller 230 mm etter navnet (utskriftsvindu); ellers fast 180 mm
const ORDRE_LAPP_AUTO_NOKKEL = 'ordreLappAuto';           // 'manuell' = bare med knappen på ordren (standard: automatisk for hver ny ordre)           // 'ordre' (25 mm, standard) eller 'del' (50 mm)
const ORDRE_LAPP_MAKS_HUSKET = 300;
const ORDRE_LAPP_TA_IGJEN_MS = 24 * 3600 * 1000;
const ORDRE_LAPP_MAKS_TA_IGJEN = 20;

// ─── Rene hjelpere ─────────────────────────────────────────────────────────────────────────────────────────────────────
function ordreLappUrl(id) { return HYLLE_BASE_URL + '?ordre=' + encodeURIComponent(String(id)); }
// Opprettelsestidspunktet ligger i id-en (ord_<ms> fra appen, ord_<ms>_<hash> fra portalen). null hvis id-en har en annen form.
function ordreLappIdMs(id) { const m = /^ord_(\d{12,14})(?:_|$)/.exec(String(id || '')); return m ? Number(m[1]) : null; }
function ordreLappSkalHa(o) { return !!o && !erLeveranse(o) && (o.status || 'aktiv') === 'aktiv'; }
// Skriftstørrelse (mm) for hovedlinjen: plass til 17 tegn chassis i fet skrift på ca. 34 mm (ca. 0,68 mm per tegn per mm skrift).
function ordreLappSkriftMm(tekst) { return Math.round(Math.min(3.4, 34 / (Math.max(1, String(tekst).length) * 0.68)) * 100) / 100; }
function ordreLappDato(ms) { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }

function ordreLappTekster(o) {
  const hoved = o.chassis || o.regnr || '(uten chassis)';
  const bil = [o.merke, o.modell].filter(Boolean).join(' ');
  const ms = ordreLappIdMs(o.id);
  return { hoved, kunde: o.kunde || '', info: [bil, o.chassis && o.regnr ? o.regnr : '', ms ? ordreLappDato(ms) : ''].filter(Boolean).join(' · ') };
}
function ordreLappHTML(o) {
  const { hoved, info: linje3 } = ordreLappTekster(o);
  return `<div class="side"><div class="lapp"><div class="qr">${qrSvg(ordreLappUrl(o.id))}</div><div class="tekst">`
    + `<div class="hoved" style="font-size:${ordreLappSkriftMm(hoved)}mm">${esc(hoved)}</div>`
    + `<div class="kunde">${esc(o.kunde || '')}</div>`
    + `<div class="info">${esc(linje3)}</div></div></div></div>`;
}
// Leitz-driveren beskriver rullen «Continuous - 1"» som STÅENDE: 25 mm bred (på tvers av rullen) og 2,7 m lang. En liggende side (60 x 25) fikk Edge til å snu siden, og innholdet
// havnet utenfor trykkområdet (testet 2026-11-11: 17,5 cm helt tom lapp). Derfor er siden stående 25 x 60 mm, og selve lappen (60 x 25) roteres 90 grader inni den.
function byggOrdreLappDokument(ordrer) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ordre-lapp</title><style>
    *{box-sizing:border-box}html,body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
    @page{size:25mm 60mm;margin:0}
    .side{width:25mm;height:60mm;position:relative;overflow:hidden;page-break-after:always;break-after:page}
    .side:last-child{page-break-after:auto;break-after:auto}
    .lapp{position:absolute;left:0;top:0;width:60mm;height:25mm;transform-origin:0 0;transform:translateX(25mm) rotate(90deg);padding:2mm 2mm 2mm 1.5mm;display:flex;align-items:center;gap:1.5mm;overflow:hidden}
    .qr{width:21mm;height:21mm;flex:none}
    .tekst{flex:1;min-width:0;display:flex;flex-direction:column;gap:1.2mm}
    .hoved{font-weight:700;white-space:nowrap;line-height:1.1}
    .kunde{font-size:2.8mm;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.15}
    .info{font-size:2.3mm;line-height:1.2;max-height:5.6mm;overflow:hidden}
  </style></head><body>${ordrer.map(ordreLappHTML).join('')}</body></html>`;
}

// ─── Del-lapp, 50 x 180 mm ─────────────────────────────────────────────────────────────────────────────────────────────
// Samme grunn som over: siden er stående (50 mm på tvers av rullen, 180 mm langs), og lappen (180 x 50) roteres -90 grader, så teksten leses nedenfra og opp med
// første linje til venstre, som i Henriks mal. Skriften er stor (opptil 18 mm) og krympes til den rommes: et anslag her, og et lite skript i utskriftsdokumentet
// som starter hver linje på 18 mm, måler med den ekte skrifttypen og krymper til ingen linje er bredere enn lappen (anslaget er forsiktig, så uten dette ble chassis.nr bare 13 mm på 180 mm) (i malen hans var chassis.nr kuttet i enden).
// 180 mm (Henrik 2026-11-12, valg B: «sånn at de ikke blir unødvendig lange»): 230 mm ga mye tom lapp på KIA. Lange navn (Geländewagen) krympes til ca. 9,5 mm, chassis.nr ca. 16-17 mm.
const DEL_LAPP_LENGDE_MM = 180;
// Lengde etter modell (Henrik 2026-11-13: «noen er lengre enn andre»): 180 mm for korte navn, 230 mm for lange. Edge med «skriv ut uten dialog» velger IKKE papir
// ut fra siden (målt 2026-11-12), så denne PC-en må vise utskriftsvinduet og man velger papiret der. Kortere enn 180 gir ikke mening: chassis.nr er alltid 17 tegn.
// Henrik 2026-11-13 (etter første lapp på 230 mm: «ikke helt fornøyd med merke og modell», «kan den ikke velge automatisk ved lengre på navnet?»):
// flere lengder, og den korteste som gir merke + modell minst DEL_LAPP_MAAL_SKRIFT mm velges (nær chassis.nr, som får 17-18 mm). Hver lengde er et
// Windows-papir «Del-lapp 50 x L mm» på del-lapp-PC-en (installasjonsfila for Lappskriver-hjelperen legger dem inn).
const DEL_LAPP_LENGDER = [180, 200, 230, 260, 290, 320];
const DEL_LAPP_MAAL_SKRIFT = 15;
function delLappLengdeEtterModell() { return ordreLappLes(ORDRE_LAPP_DEL_LENGDE_NOKKEL) === 'modell'; }
function delLappLengde(o) { return delLappLengdeEtterModell() ? delLappLengdeEtterNavn(o) : DEL_LAPP_LENGDE_MM; }
// Plass til tekst er L - 11 mm (2 x 5,5 mm marg); skriften linja får = plassen / bredden i em. Korteste lengde (av de som finnes) som gir målskriften,
// ellers den lengste. Lengden er aldri under 180: chassis.nr er alltid 17 tegn.
function delLappLengdeEtterNavn(o, lengder = DEL_LAPP_LENGDER) {
  const linje = delLappLinjer(o)[0] || '';
  const trengs = Math.max(0.5, delLappBreddeEm(linje)) * DEL_LAPP_MAAL_SKRIFT + 11;
  const liste = [...lengder].map(Number).filter(L => L >= DEL_LAPP_LENGDE_MM).sort((a, b) => a - b);
  if (!liste.length) return DEL_LAPP_LENGDE_MM;
  return liste.find(L => L >= trengs) || liste[liste.length - 1];
}
// Bokstavbredder i Times fet (Adobe Times-Bold, i em), så valget stemmer med det skriptet i utskriften faktisk får plass til
// (kontrollert: Land Cruiser 250 gir 12,1 mm og Geländewagen 9,4 mm på 180 mm, målt i nettleser 12 og 9,5). Ukjente tegn regnes som en bred bokstav.
const DEL_LAPP_EM = { A: .722, B: .667, C: .722, D: .722, E: .667, F: .611, G: .778, H: .778, I: .389, J: .5, K: .778, L: .667, M: .944, N: .722, O: .778, P: .611, Q: .778, R: .722, S: .556, T: .667, U: .722, V: .722, W: 1, X: .722, Y: .722, Z: .667, 'Æ': 1, 'Ø': .778, 'Å': .722, 'Ä': .722, 'Ö': .778, 'Ü': .722, 'É': .667, ' ': .25, '-': .333, '.': .25, '/': .278, '(': .333, ')': .333 };
function delLappBreddeEm(linje) { let em = 0; for (const t of String(linje)) em += /[0-9]/.test(t) ? .5 : (DEL_LAPP_EM[t] || .78); return em; }
function delLappPapir(L) { return `Del-lapp 50 x ${L} mm`; }
function delLappLinjer(o) {
  const bil = [o.merke, o.modell].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  const id = o.chassis || o.regnr || '';
  return [bil || (o.chassis ? o.regnr : '') || '', id].map(x => String(x).toUpperCase()).filter(Boolean);
}
// Hver linje får sin egen størrelse, så et langt modellnavn ikke gjør chassis.nr lite.
function delLappSkriftMm(linje, L = DEL_LAPP_LENGDE_MM) {
  return Math.floor(Math.min(18, (L - 12) / (Math.max(1, String(linje).length) * 0.75)) * 10) / 10; // 12 mm: ramme, marg og luft i begge ender
}
function delLappHTML(o, L = DEL_LAPP_LENGDE_MM) {
  return `<div class="side"><div class="lapp">${delLappLinjer(o).map(l => `<div class="linje" style="font-size:${delLappSkriftMm(l, L)}mm">${esc(l)}</div>`).join('')}</div></div>`;
}
function byggDelLappDokument(ordrer, L = DEL_LAPP_LENGDE_MM) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Del-lapp - papir ${delLappPapir(L)}</title><style>
    *{box-sizing:border-box}html,body{margin:0;color:#000;background:#fff}
    @page{size:50mm ${L}mm;margin:0}
    .side{width:50mm;height:${L}mm;position:relative;overflow:hidden;page-break-after:always;break-after:page}
    .side:last-child{page-break-after:auto;break-after:auto}
    .lapp{position:absolute;left:0;top:0;width:${L}mm;height:50mm;transform-origin:0 0;transform:translateY(${L}mm) rotate(-90deg);padding:2mm}
    .lapp>*{position:relative}
    .lapp::before{content:'';position:absolute;inset:2mm;border:0.8mm solid #000}
    .lapp{display:flex;flex-direction:column;justify-content:center;gap:1mm;padding:3mm 5.5mm}
    .linje{font-family:'Times New Roman',Times,serif;font-weight:700;white-space:nowrap;line-height:1;overflow:hidden}
  </style></head><body>${ordrer.map(o => delLappHTML(o, L)).join('')}
  <script>document.querySelectorAll('.lapp').forEach(function(l){var el=l.querySelectorAll('.linje');
    for(var i=0;i<el.length;i++){var f=18;el[i].style.fontSize=f+'mm';while(el[i].scrollWidth>el[i].clientWidth+0.5&&f>4){f-=0.5;el[i].style.fontSize=f+'mm';}}
    var n=0;while(l.scrollHeight>l.clientHeight+0.5&&n++<40){for(var j=0;j<el.length;j++){el[j].style.fontSize=(parseFloat(el[j].style.fontSize)*0.95)+'mm';}}});</script></body></html>`;
}
function ordreLappType() { return ordreLappLes(ORDRE_LAPP_TYPE_NOKKEL) === 'del' ? 'del' : 'ordre'; }
// Henrik 2026-11-12 (del-lappen): «bare trykker på en knapp i ordren i stedet for at det skjer automatisk». Valget gjelder per PC.
function ordreLappAuto() { return ordreLappLes(ORDRE_LAPP_AUTO_NOKKEL) !== 'manuell'; }

// ─── Lagring på enheten (tåler blokkert localStorage, se feilsøkingsnotatet i CLAUDE.md) ───────────────────────────────────
function ordreLappLes(nokkel) { try { return localStorage.getItem(nokkel); } catch (e) { return null; } }
function ordreLappSkriv(nokkel, verdi) { try { if (verdi == null) localStorage.removeItem(nokkel); else localStorage.setItem(nokkel, verdi); return true; } catch (e) { return false; } }
function ordreLappStasjonFra() { const v = Number(ordreLappLes(ORDRE_LAPP_STASJON_NOKKEL)); return v > 0 ? v : 0; }
function ordreLappUtskrevne() { try { const l = JSON.parse(ordreLappLes(ORDRE_LAPP_UTSKREVET_NOKKEL) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
// Merker id-ene som utskrevet og gir tilbake de som IKKE var merket fra før (leses på nytt rett før skriving, så to åpne faner ikke skriver ut samme ordre).
function ordreLappMerk(ider) {
  const fra = ordreLappUtskrevne();
  const nye = ider.filter((id, i) => !fra.includes(id) && ider.indexOf(id) === i);
  if (nye.length) ordreLappSkriv(ORDRE_LAPP_UTSKREVET_NOKKEL, JSON.stringify(fra.concat(nye).slice(-ORDRE_LAPP_MAKS_HUSKET)));
  return nye;
}

// ─── Utskrift ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// ─── Lappskriver-hjelper (Henrik 2026-11-13: lengden skal følge modellen uten at man velger papir) ──────────────────────
// Et lite program på PC-en med del-lapp-skriveren lytter på localhost og skriver ut med riktig papir (180 eller 230 mm). Svarer det ikke på 1,5 s,
// brukes vanlig utskrift. Med hjelperen følger lengden ALLTID navnet (det koster ingenting), så lenge papiret finnes på skriveren.
const LAPP_HJELPER_URL = 'http://localhost:47811';
async function lappHjelperStatus() {
  try {
    const r = await fetch(LAPP_HJELPER_URL + '/status', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch (e) { return null; }
}
function lappHjelperLengde(o, status) {
  const papir = Array.isArray(status && status.papir) ? status.papir : [];
  const finnes = DEL_LAPP_LENGDER.filter(L => papir.includes(delLappPapir(L)));
  // Ingen kjente papir: be om 180, så svarer hjelperen med en tydelig feil og lappen går til vanlig utskrift.
  return finnes.length ? delLappLengdeEtterNavn(o, finnes) : DEL_LAPP_LENGDE_MM;
}
async function lappHjelperSkriv(o, L) {
  const r = await fetch(LAPP_HJELPER_URL + '/del-lapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ linjer: delLappLinjer(o), lengde: L }), signal: AbortSignal.timeout(20000),
  });
  let j = {}; try { j = await r.json(); } catch (e) { /* tomt svar */ }
  if (!r.ok || !j.ok) throw new Error(j.feil || ('HTTP ' + r.status));
  return j;
}
// Ordre-lappen via hjelperen (Henrik 2026-11-13: «sånn at jeg slipper å ha to faner oppe»): appen sender QR-mønsteret (samme qrMatrise som i dag) og tekstene,
// hjelperen tegner 25 x 60 mm og skriver ut på sin ordre-skriver. Da trengs ikke Lappskriver-vinduet med «skriv ut uten dialog».
function lappHjelperTarDel(s) { return !!(s && s.skriver && Array.isArray(s.papir) && s.papir.length); }
function lappHjelperTarOrdre(s) { return !!(s && s.ordre && s.ordre.skriver && s.ordre.papir); }
function ordreLappHjelperData(o) {
  const m = qrMatrise(ordreLappUrl(o.id));
  const qr = [];
  for (let r = 0; r < m.n; r++) { let rad = ''; for (let c = 0; c < m.n; c++) rad += m.mork(r, c) ? '1' : '0'; qr.push(rad); }
  const t = ordreLappTekster(o);
  return { qr, hoved: t.hoved, hovedMm: ordreLappSkriftMm(t.hoved), kunde: t.kunde, info: t.info };
}
async function lappHjelperSkrivOrdre(o) {
  const r = await fetch(LAPP_HJELPER_URL + '/ordre-lapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify(ordreLappHjelperData(o)), signal: AbortSignal.timeout(20000),
  });
  let j = {}; try { j = await r.json(); } catch (e) { /* tomt svar */ }
  if (!r.ok || !j.ok) throw new Error(j.feil || ('HTTP ' + r.status));
  return j;
}
async function skrivUtOrdreLapper(ordrer) {
  if (!ordrer.length) return false;
  if (ordreLappType() === 'del') {
    // Lappskriver-hjelperen på denne PC-en (Leitz-oppsett\lappskriver-hjelper.ps1) velger papiret selv og skriver ut uten vindu. Lappene den ikke
    // tok (ikke installert, avslått, mangler papir) går videre til vanlig utskrift under, så man står aldri uten lapp.
    const hjelper = await lappHjelperStatus();
    if (lappHjelperTarDel(hjelper)) {
      const rest = [];
      for (const o of ordrer) {
        const L = lappHjelperLengde(o, hjelper);
        try { await lappHjelperSkriv(o, L); visToast(`Del-lapp skrevet ut (${L} mm)`, 'ok'); }
        catch (e) { console.warn('Lappskriver-hjelper:', e); rest.push(o); visToast('Lappskriver-hjelperen feilet (' + e.message + '). Bruker vanlig utskrift.'); }
      }
      if (!rest.length) return true;
      ordrer = rest;
    }
    // Én utskriftsjobb per lengde (ett papir per jobb). Med lengde etter modell kommer utskriftsvinduet, og man må velge riktig papir der.
    const grupper = new Map();
    ordrer.forEach(o => { const L = delLappLengde(o); if (!grupper.has(L)) grupper.set(L, []); grupper.get(L).push(o); });
    if (delLappLengdeEtterModell()) visToast('Velg papir ' + [...grupper.keys()].map(L => '«' + delLappPapir(L) + '»').join(' og deretter ') + ' i utskriftsvinduet', 'ok');
    grupper.forEach((liste, L) => skrivUtHtml(byggDelLappDokument(liste, L)));
    return true;
  }
  try { await sikreQrBibliotek(); } catch (e) { visToast('Kunne ikke laste QR-biblioteket: ' + e.message); return false; }
  const hjelper = await lappHjelperStatus();
  if (lappHjelperTarOrdre(hjelper)) {
    const rest = [];
    for (const o of ordrer) {
      try { await lappHjelperSkrivOrdre(o); }
      catch (e) { console.warn('Lappskriver-hjelper:', e); rest.push(o); visToast('Lappskriver-hjelperen feilet (' + e.message + '). Bruker vanlig utskrift.'); }
    }
    if (rest.length < ordrer.length) visToast(`${ordrer.length - rest.length} ordre-lapp${ordrer.length - rest.length === 1 ? '' : 'er'} skrevet ut`, 'ok');
    if (!rest.length) return true;
    ordrer = rest;
  }
  skrivUtHtml(byggOrdreLappDokument(ordrer));
  return true;
}
let _ordreLappKo = [];
let _ordreLappTimer = null;
// Kalles for hver ny ordre (Realtime) og fra «ta igjen». Samler en kort byge til én utskriftsjobb.
function ordreLappNyOrdre(o) {
  const fra = ordreLappStasjonFra();
  if (!fra || !ordreLappAuto() || !ordreLappSkalHa(o)) return;
  const ms = ordreLappIdMs(o.id);
  if (ms != null && ms < fra) return; // eldre enn stasjonen (f.eks. en ordre som ble gjenopprettet)
  if (ordreLappUtskrevne().includes(o.id) || _ordreLappKo.some(x => x.id === o.id)) return;
  _ordreLappKo.push(o);
  clearTimeout(_ordreLappTimer);
  _ordreLappTimer = setTimeout(ordreLappTomKo, 2000);
}
function ordreLappTomKo() {
  const ko = _ordreLappKo; _ordreLappKo = [];
  // Bruk siste lokale utgave (kunde/merke kan ha kommet i en UPDATE rett etter opprettelsen).
  const ferske = ko.map(o => (S.ordrer || []).find(x => x.id === o.id) || o).filter(ordreLappSkalHa);
  const nyeIder = ordreLappMerk(ferske.map(o => o.id));
  const utskrift = ferske.filter(o => nyeIder.includes(o.id));
  if (utskrift.length) skrivUtOrdreLapper(utskrift);
}
// Ordrer som kom mens stasjonen ikke fikk Realtime (sov, uten nett): opprettet etter at stasjonen ble slått på, høyst 24 t gamle, ikke skrevet ut.
function ordreLappTaIgjen() {
  const fra = ordreLappStasjonFra();
  if (!fra || !me || !ordreLappAuto()) return;
  const naa = Date.now();
  const utskrevne = ordreLappUtskrevne();
  const mangler = (S.ordrer || []).filter(o => {
    const ms = ordreLappIdMs(o.id);
    return ms != null && ms >= fra && naa - ms <= ORDRE_LAPP_TA_IGJEN_MS && ordreLappSkalHa(o) && !utskrevne.includes(o.id);
  }).sort((a, b) => ordreLappIdMs(a.id) - ordreLappIdMs(b.id)).slice(0, ORDRE_LAPP_MAKS_TA_IGJEN);
  mangler.forEach(ordreLappNyOrdre);
}

// ─── Innstilling i Mer ─────────────────────────────────────────────────────────────────────────────────────────────────
function settOrdreLappStasjon(paa) {
  if (paa) {
    // Merk eksisterende ordrer som «sett», så ingenting gammelt skrives ut når stasjonen slås på.
    ordreLappMerk((S.ordrer || []).map(o => o.id));
    if (!ordreLappSkriv(ORDRE_LAPP_STASJON_NOKKEL, String(Date.now()))) { visToast('Nettleseren lar ikke appen lagre innstillingen på denne PC-en (sjekk sporingsforebygging i Edge)'); renderOrdreLappKort(); return; }
    visToast(ordreLappAuto() ? 'Denne PC-en skriver nå ut en lapp for hver nye ordre' : 'Denne PC-en har nå «🖨 Lapp»-knappen på ordrene', 'ok');
  } else {
    ordreLappSkriv(ORDRE_LAPP_STASJON_NOKKEL, null);
    visToast('Automatisk utskrift av ordre-lapper er slått av på denne PC-en', 'ok');
  }
  renderOrdreLappKort();
}
// Testlapp med tydelig TEST-innhold (ingen ekte kunde), og en åpen ordre om man står i en.
function skrivUtTestOrdreLapp() {
  const del = ordreLappType() === 'del';
  skrivUtOrdreLapper([{ id: 'ord_' + Date.now(), chassis: 'TESTWXYZ000000001', regnr: '', kunde: 'TEST - prøveutskrift', merke: del ? 'TEST' : 'Leitz', modell: del ? 'DEL-LAPP' : 'Icon 25 mm', status: 'aktiv' }]);
}
function settOrdreLappAuto(auto) {
  // Fra «bare knapp» til automatisk: ordrer som kom i mellomtiden skal ikke plutselig skrives ut i en klump.
  if (auto) ordreLappMerk((S.ordrer || []).map(o => o.id));
  if (!ordreLappSkriv(ORDRE_LAPP_AUTO_NOKKEL, auto ? null : 'manuell')) visToast('Nettleseren lar ikke appen lagre innstillingen på denne PC-en (sjekk sporingsforebygging i Edge)');
  renderOrdreLappKort();
}
function settDelLappLengde(verdi) {
  if (!ordreLappSkriv(ORDRE_LAPP_DEL_LENGDE_NOKKEL, verdi === 'modell' ? 'modell' : null)) visToast('Nettleseren lar ikke appen lagre innstillingen på denne PC-en (sjekk sporingsforebygging i Edge)');
  renderOrdreLappKort();
}
function settOrdreLappType(type) {
  if (!ordreLappSkriv(ORDRE_LAPP_TYPE_NOKKEL, type === 'del' ? 'del' : 'ordre')) visToast('Nettleseren lar ikke appen lagre innstillingen på denne PC-en (sjekk sporingsforebygging i Edge)');
  renderOrdreLappKort();
}
// «🖨 Lapp» i ordredetaljens topprad (Henrik 2026-11-11: lapp til ordrer som fantes før stasjonen, og ny lapp hvis en blir ødelagt). Bare på en enhet der stasjonen
// er slått på (PC-en med skriveren), og bare for bil-ordrer. Merker ordren som utskrevet, så den automatiske utskriften ikke tar den en gang til.
function ordreLappKnappHTML(o) {
  if (!ordreLappStasjonFra() || !o || erLeveranse(o)) return '';
  return `<button class="btn sm" onclick="skrivUtOrdreLappFor('${esc(o.id).replace(/'/g, "\\'")}')" title="Skriv ut lapp på Leitz Icon" style="border-radius:10px;padding:5px 9px;font-size:11px">🖨 ${ordreLappType() === 'del' ? 'Del-lapp' : 'Lapp'}</button>`;
}
function skrivUtOrdreLappFor(id) {
  const o = (S.ordrer || []).find(x => x.id === id);
  if (!o) { visToast('Fant ikke ordren'); return; }
  ordreLappMerk([o.id]);
  skrivUtOrdreLapper([o]);
}
// Lappskriver-navnet (Henrik 2026-11-12): stasjonsvinduet skriver ut ALT rett til Leitz-en uten dialog, så det skal ikke forveksles med den vanlige appen.
// Vindustittelen (og dermed navnet på oppgavelinjen) sier «Lappskriver» på en enhet der stasjonen er slått på. Ikonet settes av Leitz-oppsettfila.
function ordreLappTittel() { try { document.title = ordreLappStasjonFra() ? "Lappskriver – Salmaker'n" : "Salmaker'n"; } catch (e) { /* ingen document i test */ } }
// Viser i Mer om Lappskriver-hjelperen på denne PC-en tar lappene, og tar bort «Lappskriver» fra tittelen når den gjør det (da er dette et vanlig vindu).
async function ordreLappVisHjelper() {
  const el = document.getElementById('ordreLappHjelperInfo');
  if (!ordreLappStasjonFra()) { if (el) el.textContent = ''; return; }
  const s = await lappHjelperStatus();
  const tar = ordreLappType() === 'del' ? lappHjelperTarDel(s) : lappHjelperTarOrdre(s);
  if (tar) { try { document.title = "Salmaker'n"; } catch (e) { /* test */ } }
  const el2 = document.getElementById('ordreLappHjelperInfo');
  if (!el2) return;
  el2.textContent = tar
    ? `Lappskriver-hjelperen kjører: lappene går rett til «${ordreLappType() === 'del' ? s.skriver : s.ordre.skriver}» uten utskriftsvindu. Vanlige dokumenter skrives ut som vanlig.`
    : 'Lappskriver-hjelperen svarer ikke på denne PC-en: lappene skrives ut via nettleseren.';
}
function renderOrdreLappKort() {
  ordreLappTittel();
  const el = document.getElementById('ordreLappKortInnhold');
  if (!el) return;
  const fra = ordreLappStasjonFra();
  const del = ordreLappType() === 'del';
  const auto = ordreLappAuto();
  const etterModell = delLappLengdeEtterModell();
  el.innerHTML = `<label style="display:flex;gap:10px;align-items:center;margin:10px 0 6px;cursor:pointer;font-size:13.5px;color:inherit">
      <input type="checkbox" ${fra ? 'checked' : ''} onchange="settOrdreLappStasjon(this.checked)" style="width:18px;height:18px;flex:none;margin:0;padding:0">
      <span>Denne PC-en har lappskriver (Leitz Icon)</span></label>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="small muted" style="flex:none">Lapp:</span>
      <select onchange="settOrdreLappType(this.value)" style="flex:1 1 0;min-width:0;max-width:100%;padding:5px 8px;font-size:12px">
        <option value="ordre" ${del ? '' : 'selected'}>Ordre-lapp 25 mm (QR, chassis, kunde)</option>
        <option value="del" ${del ? 'selected' : ''}>Del-lapp 50 mm (merke, modell, chassis)</option>
      </select></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="small muted" style="flex:none">Når:</span>
      <select onchange="settOrdreLappAuto(this.value === 'auto')" style="flex:1 1 0;min-width:0;max-width:100%;padding:5px 8px;font-size:12px">
        <option value="auto" ${auto ? 'selected' : ''}>Automatisk ved ny ordre</option>
        <option value="manuell" ${auto ? '' : 'selected'}>Bare med knappen på ordren</option>
      </select></div>
    ${del ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="small muted" style="flex:none">Lengde:</span>
      <select onchange="settDelLappLengde(this.value)" style="flex:1 1 0;min-width:0;max-width:100%;padding:5px 8px;font-size:12px">
        <option value="fast" ${etterModell ? '' : 'selected'}>Alltid 180 mm (skrives rett ut)</option>
        <option value="modell" ${etterModell ? 'selected' : ''}>Etter modell: 180-320 mm (velg papir)</option>
      </select></div>` : ''}
    <div class="small muted" style="margin-bottom:10px">${fra ? 'Slått på ' + esc(ordreLappDato(fra)) + '. ' : ''}Slå bare på i Lappskriver-vinduet på PC-en med skriveren. ${del ? (etterModell ? 'Lappen blir 180 til 320 mm, så lang som navnet trenger. Utskriftsvinduet kommer frem: velg papiret appen sier (f.eks. «Del-lapp 50 x 230 mm»). Krever at Lappskriver på denne PC-en starter MED utskriftsvindu (oppsettfila spør om det).' : 'Lapp 50 x 180 mm (papir «Del-lapp 50 x 180 mm»).') : 'Lapp 25 x 60 mm med QR-kode til ordren (papir «Ordre-lapp 25 x 60 mm»).'}</div>
    <div id="ordreLappHjelperInfo" class="small muted" style="margin-bottom:10px"></div>
    <button class="btn sm" onclick="skrivUtTestOrdreLapp()">🖨 Skriv ut testlapp</button>`;
  ordreLappVisHjelper();
}
