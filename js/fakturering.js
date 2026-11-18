// ════════════════════════════════════════════════════
// FAKTURERING (trinn 4 av «Én produktliste», Henrik 17.11.2026: «begge»)
// ════════════════════════════════════════════════════
// Egen side i menyen (bare admin) som samler alle ordrer som venter på fakturering, med fakturalinjene, en veiledende sum og hva som
// stopper. Fakturering-kortet inne i ordren er uendret (det fylles allerede av «Skal på bilen», ombyggingen, bestillingen og drivstoff).
//  * Hvilke ordrer: samme utvalg som «Klar til fakturering» (faktureringKandidater), og samme sjekk (fakturaSjekk i ordre-detalj.js) som
//    faktisk stopper knappen i ordren, så siden og knappen aldri er uenige.
//  * «Lag kladd i Fiken» (Henriks valg): bare når ingenting stopper, etter en bekreftelse med kunde, linjer og veiledende sum; selve
//    kladden lages av den vanlige fakturerViaFiken (samme kontroller, samme edge-funksjon, kundens avtalte rabatt).
//  * Summen er VEILEDENDE og FØR kundens rabatt: overstyrt beløp, ellers frosset pris på linjen, ellers Fiken-prisen (fiken_priser).
//    Rabatten regnes av fiken-fakturer når kladden lages.

const FAKTURERING_STATUSER = ['klar_henting', 'vist_biltilsyn', 'hentet'];
let faktureringFilter = 'alle';
let _faktureringPriserHentet = false;
const _faktureringIGang = new Set();

function faktureringKandidater() {
  return (S.ordrer || []).filter(o => !erLeveranse(o) && o.status === 'aktiv' && !o.fakturert && FAKTURERING_STATUSER.includes(o.ordreStatus));
}

function faktureringSjekk(o) {
  try { return fakturaSjekk(o); }
  catch (e) { console.error('fakturaSjekk feilet for ordre ' + o.id + ':', e && e.message); return { niva: 'gul', grunner: [{ kode: 'feil', tekst: 'Kunne ikke sjekkes - se konsollen' }] }; }
}

// Pris og navn for én linje. kilde: 'belop' (overstyrt), 'frosset' (fra bestillingen) eller 'fiken' (dagens Fiken-pris). Ukjent = null.
function faktureringLinjeInfo(l) {
  const nr = String(l.produktnummer || '');
  const fp = (S.fikenPriser || []).find(p => String(p.produktnummer) === nr);
  const pp = (S.portalProdukter || []).find(p => p.fiken_nummer === nr);
  const navn = (fp && fp.navn) || (pp && pp.navn) || (nr === String(typeof FIKEN_PRODUKTNUMMER_DRIVSTOFF !== 'undefined' ? FIKEN_PRODUKTNUMMER_DRIVSTOFF : '') ? 'Drivstoff' : '');
  let pris = null, kilde = null;
  if (l.belop !== undefined && l.belop !== null && Number.isFinite(Number(l.belop))) { pris = Number(l.belop); kilde = 'belop'; }
  else if (typeof l.pris === 'number' && l.pris > 0) { pris = l.pris; kilde = 'frosset'; }
  else if (fp && Number.isFinite(Number(fp.pris_kr))) { pris = Number(fp.pris_kr); kilde = 'fiken'; }
  const antall = Number(l.antall) > 0 ? Number(l.antall) : 1;
  return { nr, navn, antall, pris, kilde, sum: pris === null ? null : pris * antall, rabatt: typeof l.rabatt === 'number' ? l.rabatt : null };
}

function faktureringSum(o) {
  const linjer = (o.fikenLinjer || []).map(faktureringLinjeInfo);
  const ukjente = linjer.filter(l => l.sum === null).length;
  return { linjer, sum: linjer.reduce((s, l) => s + (l.sum || 0), 0), ukjente };
}

const faktKr = n => Math.round(n).toLocaleString('nb-NO') + ' kr';

async function hentFikenPriserForFakturering() {
  if (_faktureringPriserHentet || !db) return;
  _faktureringPriserHentet = true;
  const { data, error } = await db.from('fiken_priser').select('produktnummer, navn, pris_kr');
  if (error) { _faktureringPriserHentet = false; console.error('Kunne ikke hente Fiken-priser:', error.message); return; }
  S.fikenPriser = data || [];
}

function renderFakturering() {
  const el = document.getElementById('faktureringInnhold');
  if (!el) return;
  if (!me || me.rolle !== 'admin') { el.innerHTML = '<div class="muted small">Bare admin.</div>'; return; }
  if (!_faktureringPriserHentet) hentFikenPriserForFakturering().then(() => renderFakturering());
  try {
    const FARGE = { rod: '#ef4444', gul: '#facc15', gronn: '#22c55e' };
    const RANG = { rod: 0, gul: 1, gronn: 2 };
    const alle = faktureringKandidater().map(o => ({ o, sjekk: faktureringSjekk(o) }));
    const antall = { gronn: 0, gul: 0, rod: 0 };
    alle.forEach(r => { antall[r.sjekk.niva] = (antall[r.sjekk.niva] || 0) + 1; });
    const filtrert = alle.filter(r => faktureringFilter === 'alle' || r.sjekk.niva === faktureringFilter)
      .sort((a, b) => RANG[a.sjekk.niva] - RANG[b.sjekk.niva] || String(a.o.datoKlarHenting || '').localeCompare(String(b.o.datoKlarHenting || '')));
    const chip = (verdi, tekst) => `<button class="btn sm${faktureringFilter === verdi ? ' red' : ''}" onclick="faktureringFilter='${verdi}';renderFakturering()">${tekst}</button>`;
    const rad = ({ o, sjekk }) => {
      try {
        const farge = FARGE[sjekk.niva] || FARGE.gul;
        const { linjer, sum, ukjente } = faktureringSum(o);
        const idJs = esc(o.id).replace(/'/g, "\\'");
        const stopper = sjekk.niva === 'rod';
        const iGang = _faktureringIGang.has(o.id);
        const linjeHTML = linjer.length ? linjer.map(l => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0">
            <span style="min-width:0"><span style="font-family:ui-monospace,monospace;color:#a1a1aa">${esc(l.nr || '–')}</span> ${esc(l.navn)}${l.antall > 1 ? ` <span class="muted">× ${l.antall}</span>` : ''}${l.rabatt !== null ? ` <span class="muted">· ${l.rabatt} % rabatt</span>` : ''}</span>
            <span style="white-space:nowrap;color:${l.sum === null ? '#fbbf24' : '#e4e4e7'}">${l.sum === null ? 'ukjent pris' : faktKr(l.sum)}</span>
          </div>`).join('') : '<div class="small muted">Ingen fakturalinjer</div>';
        return `<div class="card" style="border-left:4px solid ${farge};display:grid;gap:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap">
            <div style="min-width:0">
              <div><b>${esc(ordreLabelFull(o))}</b></div>
              <div class="small muted">${esc(o.kunde || 'Kunde mangler')} · ${esc(statusInfo(o.ordreStatus).lbl)}</div>
            </div>
            <div style="text-align:right"><div style="font-weight:700">${faktKr(sum)}</div><div class="small muted">veiledende, før rabatt${ukjente ? ` · ${ukjente} uten pris` : ''}</div></div>
          </div>
          <div style="background:#0f0f12;border:1px solid #27272a;border-radius:10px;padding:6px 10px">${linjeHTML}</div>
          ${sjekk.grunner.length ? `<div class="small" style="color:${stopper ? '#fca5a5' : '#fde68a'}">${sjekk.grunner.map(g => esc(g.tekst)).join(' · ')}</div>` : '<div class="small" style="color:#86efac">Klar til fakturering</div>'}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" onclick="openOrdre('${idJs}',false,true)">Åpne ordren</button>
            <button class="btn sm red" ${stopper || iGang || !linjer.length ? 'disabled' : ''} onclick="faktureringLagKladd('${idJs}')" title="${stopper ? 'Noe stopper fakturering - se over' : ''}">${iGang ? 'Lager kladd …' : 'Lag kladd i Fiken'}</button>
          </div>
        </div>`;
      } catch (e) { return ordreKortFeilHTML(o, e); }
    };
    el.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${chip('alle', `Alle (${alle.length})`)}${chip('gronn', `Klare (${antall.gronn})`)}${chip('gul', `Sjekk selv (${antall.gul})`)}${chip('rod', `Stopper (${antall.rod})`)}
      </div>
      ${filtrert.length ? filtrert.map(rad).join('') : `<div class="card"><div class="muted small">${alle.length ? 'Ingen ordrer i dette utvalget.' : 'Ingen ordrer venter på fakturering.'}</div></div>`}`;
  } catch (e) { console.error('renderFakturering feilet:', e && e.message); el.innerHTML = '<div class="err-text">Kunne ikke vise faktureringen - se konsollen.</div>'; }
}

// «Lag kladd i Fiken» fra samlesiden: bekreftelse, så den vanlige fakturerViaFiken (som selv stopper ved en rød grunn og bruker kundens
// avtalte rabatt når det ikke finnes en avkrysning i ordren).
async function faktureringLagKladd(id) {
  if (!me || me.rolle !== 'admin') return;
  const o = S.ordrer.find(x => x.id === id); if (!o || _faktureringIGang.has(id)) return;
  const sjekk = faktureringSjekk(o);
  if (sjekk.niva === 'rod') { visToast(sjekk.grunner.filter(g => g).map(g => g.tekst).join(' · ')); return; }
  const { linjer, sum, ukjente } = faktureringSum(o);
  const tekst = `Lage kladd i Fiken for ${ordreLabelFull(o)}?\n\nKunde: ${o.kunde || '(mangler)'}\n${linjer.length} linje(r), veiledende ${faktKr(sum)} før rabatt${ukjente ? ` (${ukjente} uten kjent pris)` : ''}.\nKundens avtalte rabatt brukes.${sjekk.niva === 'gul' ? '\n\nSjekk selv: ' + sjekk.grunner.map(g => g.tekst).join(' · ') : ''}`;
  if (!confirm(tekst)) return;
  _faktureringIGang.add(id);
  renderFakturering();
  try { await fakturerViaFiken(id); }
  finally { _faktureringIGang.delete(id); renderFakturering(); }
}
