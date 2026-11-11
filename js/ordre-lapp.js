// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ORDRE-LAPP PÅ LEITZ ICON (Henrik 2026-11-11): en lapp på 25 mm bred rull for hver ny bil-ordre.
// - Lappen er 60 x 25 mm: QR-kode til venstre (åpner ordren i appen: salmakern.html?ordre=<id>), hele chassis.nr (ellers reg.nr), kunde og merke/modell + dato til høyre.
// - UTSKRIFTSSTASJON: én PC med skriveren slår på «Skriv ut ordre-lapper» i Mer (lagres bare på den enheten, localStorage). Den skriver da ut en lapp for hver ny bil-ordre,
//   uansett hvem som registrerer den og hvor (mobil, Admin-ark, Forhandlerportalen): Realtime-INSERT på ordrer, og i tillegg en «ta igjen» etter hver innlasting
//   for ordrer som kom mens PC-en sov eller var uten nett (bare ordrer opprettet ETTER at stasjonen ble slått på, og høyst 24 t gamle).
// - Hver ordre skrives ut ÉN gang per enhet (liste over utskrevne id-er i localStorage, delt mellom faner). Flere nye ordrer tett etter hverandre blir én utskriftsjobb.
// - Uten dialog: et eget Edge-vindu med egen profil (--user-data-dir) og --kiosk-printing, som skriver til siste skriver/papir valgt i den profilen. Papiret må være
//   Windows-skjemaet «Ordre-lapp 25 x 60 mm» (med driverens «Continuous - 1"» mater Leitz Icon ut 17,5 cm, testet 2026-11-11), eller «Del-lapp 50 x 230 mm» for del-lappen.
// - DEL-LAPP (Henrik 2026-11-11, etter hans egen mal fra Leitz-programmet): en annen PC med 50 mm rull skriver ut en lapp til å merke delene til bilen, også automatisk
//   for hver ny ordre: ramme og to linjer i stor fet skrift langs lappen, merke + modell og hele chassis.nr. Hver PC velger lapptype selv (ORDRE_LAPP_TYPE_NOKKEL), så to
//   stasjoner gir én ordre-lapp og én del-lapp per ordre (utskrevet-lista er per enhet).
// - Leveranser får ikke lapp (bare ordretype bil). Bruker qrSvg/sikreQrBibliotek/skrivUtHtml fra lager-hylle.js (lastes etter den).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const ORDRE_LAPP_STASJON_NOKKEL = 'ordreLappStasjon';      // ms-tidspunkt stasjonen ble slått på (tom = av)
const ORDRE_LAPP_UTSKREVET_NOKKEL = 'ordreLappUtskrevet';  // JSON-liste med ordre-id-er som er skrevet ut på denne enheten
const ORDRE_LAPP_TYPE_NOKKEL = 'ordreLappType';           // 'ordre' (25 mm, standard) eller 'del' (50 mm)
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

function ordreLappHTML(o) {
  const hoved = o.chassis || o.regnr || '(uten chassis)';
  const bil = [o.merke, o.modell].filter(Boolean).join(' ');
  const ms = ordreLappIdMs(o.id);
  const linje3 = [bil, o.chassis && o.regnr ? o.regnr : '', ms ? ordreLappDato(ms) : ''].filter(Boolean).join(' · ');
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

// ─── Del-lapp, 50 x 230 mm ─────────────────────────────────────────────────────────────────────────────────────────────
// Samme grunn som over: siden er stående (50 mm på tvers av rullen, 230 mm langs), og lappen (230 x 50) roteres -90 grader, så teksten leses nedenfra og opp med
// første linje til venstre, som i Henriks mal. Skriften er stor (opptil 18 mm) og krympes til den rommes: et anslag her, og et lite skript i utskriftsdokumentet
// som måler med den ekte skrifttypen og krymper til ingen linje er bredere enn lappen (i malen hans var chassis.nr kuttet i enden).
const DEL_LAPP_LENGDE_MM = 230;
const DEL_LAPP_TEKSTBREDDE_MM = DEL_LAPP_LENGDE_MM - 12; // ramme, marg og luft i begge ender
function delLappLinjer(o) {
  const bil = [o.merke, o.modell].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  const id = o.chassis || o.regnr || '';
  return [bil || (o.chassis ? o.regnr : '') || '', id].map(x => String(x).toUpperCase()).filter(Boolean);
}
// Hver linje får sin egen størrelse, så et langt modellnavn ikke gjør chassis.nr lite.
function delLappSkriftMm(linje) {
  return Math.floor(Math.min(18, DEL_LAPP_TEKSTBREDDE_MM / (Math.max(1, String(linje).length) * 0.75)) * 10) / 10;
}
function delLappHTML(o) {
  return `<div class="side"><div class="lapp">${delLappLinjer(o).map(l => `<div class="linje" style="font-size:${delLappSkriftMm(l)}mm">${esc(l)}</div>`).join('')}</div></div>`;
}
function byggDelLappDokument(ordrer) {
  const L = DEL_LAPP_LENGDE_MM;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Del-lapp</title><style>
    *{box-sizing:border-box}html,body{margin:0;color:#000;background:#fff}
    @page{size:50mm ${L}mm;margin:0}
    .side{width:50mm;height:${L}mm;position:relative;overflow:hidden;page-break-after:always;break-after:page}
    .side:last-child{page-break-after:auto;break-after:auto}
    .lapp{position:absolute;left:0;top:0;width:${L}mm;height:50mm;transform-origin:0 0;transform:translateY(${L}mm) rotate(-90deg);padding:2mm}
    .lapp>*{position:relative}
    .lapp::before{content:'';position:absolute;inset:2mm;border:0.8mm solid #000}
    .lapp{display:flex;flex-direction:column;justify-content:center;gap:1mm;padding:3mm 4mm}
    .linje{font-family:'Times New Roman',Times,serif;font-weight:700;white-space:nowrap;line-height:1;overflow:hidden}
  </style></head><body>${ordrer.map(delLappHTML).join('')}
  <script>document.querySelectorAll('.lapp').forEach(function(l){var el=l.querySelectorAll('.linje');
    for(var i=0;i<el.length;i++){var f=parseFloat(el[i].style.fontSize)||18;while(el[i].scrollWidth>el[i].clientWidth+0.5&&f>4){f-=0.5;el[i].style.fontSize=f+'mm';}}
    var n=0;while(l.scrollHeight>l.clientHeight+0.5&&n++<40){for(var j=0;j<el.length;j++){el[j].style.fontSize=(parseFloat(el[j].style.fontSize)*0.95)+'mm';}}});</script></body></html>`;
}
function ordreLappType() { return ordreLappLes(ORDRE_LAPP_TYPE_NOKKEL) === 'del' ? 'del' : 'ordre'; }

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
async function skrivUtOrdreLapper(ordrer) {
  if (!ordrer.length) return false;
  if (ordreLappType() === 'del') { skrivUtHtml(byggDelLappDokument(ordrer)); return true; }
  try { await sikreQrBibliotek(); } catch (e) { visToast('Kunne ikke laste QR-biblioteket: ' + e.message); return false; }
  skrivUtHtml(byggOrdreLappDokument(ordrer));
  return true;
}
let _ordreLappKo = [];
let _ordreLappTimer = null;
// Kalles for hver ny ordre (Realtime) og fra «ta igjen». Samler en kort byge til én utskriftsjobb.
function ordreLappNyOrdre(o) {
  const fra = ordreLappStasjonFra();
  if (!fra || !ordreLappSkalHa(o)) return;
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
  if (!fra || !me) return;
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
    visToast('Denne PC-en skriver nå ut en lapp for hver nye ordre', 'ok');
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
function settOrdreLappType(type) {
  if (!ordreLappSkriv(ORDRE_LAPP_TYPE_NOKKEL, type === 'del' ? 'del' : 'ordre')) visToast('Nettleseren lar ikke appen lagre innstillingen på denne PC-en (sjekk sporingsforebygging i Edge)');
  renderOrdreLappKort();
}
// «🖨 Lapp» i ordredetaljens topprad (Henrik 2026-11-11: lapp til ordrer som fantes før stasjonen, og ny lapp hvis en blir ødelagt). Bare på en enhet der stasjonen
// er slått på (PC-en med skriveren), og bare for bil-ordrer. Merker ordren som utskrevet, så den automatiske utskriften ikke tar den en gang til.
function ordreLappKnappHTML(o) {
  if (!ordreLappStasjonFra() || !o || erLeveranse(o)) return '';
  return `<button class="btn sm" onclick="skrivUtOrdreLappFor('${esc(o.id).replace(/'/g, "\\'")}')" title="Skriv ut ordre-lapp på Leitz Icon" style="border-radius:10px;padding:5px 9px;font-size:11px">🖨 Lapp</button>`;
}
function skrivUtOrdreLappFor(id) {
  const o = (S.ordrer || []).find(x => x.id === id);
  if (!o) { visToast('Fant ikke ordren'); return; }
  ordreLappMerk([o.id]);
  skrivUtOrdreLapper([o]);
}
function renderOrdreLappKort() {
  const el = document.getElementById('ordreLappKortInnhold');
  if (!el) return;
  const fra = ordreLappStasjonFra();
  const del = ordreLappType() === 'del';
  el.innerHTML = `<label style="display:flex;gap:10px;align-items:center;margin:10px 0 6px;cursor:pointer;font-size:13.5px;color:inherit">
      <input type="checkbox" ${fra ? 'checked' : ''} onchange="settOrdreLappStasjon(this.checked)" style="width:18px;height:18px;flex:none;margin:0;padding:0">
      <span>Denne PC-en skriver ut en lapp for hver ny ordre</span></label>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span class="small muted" style="flex:none">Lapp:</span>
      <select onchange="settOrdreLappType(this.value)" style="width:auto;padding:5px 8px;font-size:12px">
        <option value="ordre" ${del ? '' : 'selected'}>Ordre-lapp 25 mm (QR, chassis, kunde)</option>
        <option value="del" ${del ? 'selected' : ''}>Del-lapp 50 mm (merke, modell, chassis)</option>
      </select></div>
    <div class="small muted" style="margin-bottom:10px">${fra ? 'Slått på ' + esc(ordreLappDato(fra)) + '. ' : ''}Slå bare på i Leitz-stasjonsvinduet på PC-en med skriveren. ${del ? 'Lapp 50 x 230 mm (papir «Del-lapp 50 x 230 mm»).' : 'Lapp 25 x 60 mm med QR-kode til ordren (papir «Ordre-lapp 25 x 60 mm»).'}</div>
    <button class="btn sm" onclick="skrivUtTestOrdreLapp()">🖨 Skriv ut testlapp</button>`;
}
