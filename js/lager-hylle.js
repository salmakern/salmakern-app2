// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LAGER: HYLLER MED QR, BESTILLINGER OG MOTTAK (fase 1, Henrik 2026-11-03).
// - Hver HYLLE har en kort kode (f.eks. A1) og en QR-etikett (25 mm) som åpner hylla i appen: salmaker.as/salmakern.html?h=A1. Varene plasseres på hyller.
// - Hylleside: varene på hylla med antall og minimum, og handlingene Ta ut (til en ordre), Motta/Fyll på og Tell. «Skann» åpner kameraet inne i appen.
// - BESTILLINGER (lager_bestillinger) registreres med antall (eller «ukjent antall» for det som allerede er bestilt), leverandør og forventet dato; «Motta» øker lageret, lukker
//   bestillingen og varsler ved mangel. Det gamle flagget lagervarer.bestilt følger åpne bestillinger (lager_* RPC-er i databasen, migrasjon 20261103200000).
// Laster ETTER lager.js (bruker registrerLagerEndring, fmtAntall, sorterLagerVarer, varselMangelfullLevering). QR-bibliotekene (js/vendor) lastes først når de trengs.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const HYLLE_BASE_URL = 'https://salmaker.as/salmakern.html';
const HYLLE_KODE_FORM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

// ─── Rene hjelpere (testes uten DOM) ───────────────────────────────────────────────────────────────────────────────────
function normaliserHylleKode(x) { const s = String(x == null ? '' : x).trim(); return HYLLE_KODE_FORM.test(s) ? s : ''; }
function hylleUrl(kode) { return HYLLE_BASE_URL + '?h=' + encodeURIComponent(normaliserHylleKode(kode)); }
// Leser hyllekoden ut av en skannet tekst: hele lenken (?h=A1, også uten https), eller bare selve koden. Tom streng hvis det ikke er en gyldig kode.
function hylleKodeFraTekst(tekst) {
  const t = String(tekst == null ? '' : tekst).trim();
  if (!t) return '';
  const m = t.match(/[?&]h=([^&#\s]+)/i);
  let kandidat = m ? m[1] : t;
  try { kandidat = decodeURIComponent(kandidat); } catch (e) { /* behold teksten som den er */ }
  return normaliserHylleKode(kandidat);
}
// Ordre-lappen (js/ordre-lapp.js) har QR med salmakern.html?ordre=<id>. Gir id-en, eller tom streng hvis teksten ikke er en ordre-lenke.
function ordreIdFraTekst(tekst) {
  const m = String(tekst == null ? '' : tekst).trim().match(/[?&]ordre=([^&#\s]+)/i);
  if (!m) return '';
  let id = m[1];
  try { id = decodeURIComponent(id); } catch (e) { return ''; }
  return /^ord_[A-Za-z0-9_]{1,60}$/.test(id) ? id : '';
}
function finnHylle(kode) {
  const k = normaliserHylleKode(kode).toUpperCase();
  return k ? (S.lagerHyller || []).find(h => String(h.kode).toUpperCase() === k) || null : null;
}
function varerPaaHylle(hylleId) { return (S.lagervarer || []).filter(v => v.hylleId === hylleId).sort(sorterLagerVarer); }
function bestillingerForVare(vareId, status = 'apen') { return (S.lagerBestillinger || []).filter(b => b.vareId === vareId && b.status === status); }
function harApenBestilling(vareId) { return (S.lagerBestillinger || []).some(b => b.vareId === vareId && b.status === 'apen'); }
// Forslag til antall ved ny bestilling: opp til minimum + litt (minimum, men minst 1), aldri mer enn det som mangler til dobbelt minimum.
function foreslaattBestillingsantall(v) {
  const mangler = (Number(v.minAntall) || 0) - (Number(v.antall) || 0);
  return Math.max(1, Math.ceil(mangler > 0 ? mangler : (Number(v.minAntall) || 1)));
}
function lagerDato(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : ''; }
function lagerIdag() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Leser et tallfelt (komma tillatt). Et TOMT felt er NaN, ikke 0: ellers ville en tom telling nullet lageret og et tomt mottak lukket bestillingen uten varer.
function lesLagerTall(id) {
  const t = String(document.getElementById(id)?.value ?? '').trim().replace(',', '.');
  return t === '' ? NaN : Number(t);
}
function nyLagerId(prefiks) { return prefiks + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

// ─── QR ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const _skriptLastet = {};
function lastSkript(src) {
  if (_skriptLastet[src]) return _skriptLastet[src];
  _skriptLastet[src] = new Promise((ok, feil) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => ok(); s.onerror = () => { delete _skriptLastet[src]; feil(new Error('Kunne ikke laste ' + src)); };
    document.head.appendChild(s);
  });
  return _skriptLastet[src];
}
async function sikreQrBibliotek() { if (typeof qrcode !== 'function') await lastSkript('js/vendor/qrcode.js'); }
// QR med feilretting M (tåler litt slitasje på etiketten). Returnerer { n, mork(r, c) }.
function qrMatrise(tekst) {
  const q = qrcode(0, 'M');
  q.addData(String(tekst));
  q.make();
  return { n: q.getModuleCount(), mork: (r, c) => q.isDark(r, c) };
}
// Selve QR-en som SVG (én path, skarpe kanter), med 2 moduler stille sone (nok for mobilkamera, og gir størst mulig moduler på en liten etikett).
function qrSvg(tekst, stille = 2) {
  const m = qrMatrise(tekst);
  const total = m.n + 2 * stille;
  let d = '';
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.mork(r, c)) d += `M${c + stille} ${r + stille}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ─── Etikettutskrift (25 x 25 mm) ──────────────────────────────────────────────────────────────────────────────────────
// QR på 19 mm øverst og hyllekoden under (1,6 + 19 + 0,4 + 3,4 = 24,4 mm av 25): moduler på ca. 0,5-0,6 mm, som mobilkamera leser trygt (testet ned til 2 piksler per modul).
// Skriftstørrelsen (mm) skaleres ned for lange koder så de rommer seg på 21 mm (ca. 0,7 mm per tegn per mm skrift i fet versal); vanlige koder (opptil 9 tegn) får full størrelse.
function etikettSkriftMm(kode) { return Math.round(Math.min(3.2, 21 / (Math.max(1, String(kode).length) * 0.7)) * 100) / 100; }
function hylleEtikettHTML(hylle) {
  return `<div class="etikett"><div class="qr">${qrSvg(hylleUrl(hylle.kode))}</div><div class="kode" style="font-size:${etikettSkriftMm(hylle.kode)}mm">${esc(hylle.kode)}</div></div>`;
}
function byggEtikettDokument(hyller, format) {
  const ark = format === 'ark';
  const css = ark
    ? `@page{size:A4;margin:10mm}body{margin:0}.rutenett{display:grid;grid-template-columns:repeat(auto-fill,25mm);gap:3mm}.etikett{outline:0.2mm dotted #999}`
    : `@page{size:25mm 25mm;margin:0}body{margin:0}.etikett{page-break-after:always;break-after:page}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hylleetiketter</title><style>
    *{box-sizing:border-box}html,body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
    .etikett{width:25mm;height:25mm;padding:1.6mm 2mm 0;display:flex;flex-direction:column;align-items:center;overflow:hidden}
    .qr{width:19mm;height:19mm;flex:none}.kode{margin-top:.4mm;height:3.4mm;line-height:3.4mm;font-weight:700;white-space:nowrap}
    ${css}
  </style></head><body>${ark ? '<div class="rutenett">' : ''}${hyller.map(hylleEtikettHTML).join('')}${ark ? '</div>' : ''}</body></html>`;
}
// Skriver ut via skjult iframe (virker uten popup): etikettskriver får én etikett per side (25 x 25 mm), «ark» gir et A4-ark med mange etiketter til utklipp.
function skrivUtHtml(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { visToast('Kunne ikke starte utskriften: ' + e.message); } setTimeout(() => f.remove(), 60000); }, 300);
}
async function skrivUtHylleEtiketter(hylleIder, format) {
  const hyller = (S.lagerHyller || []).filter(h => !hylleIder || hylleIder.includes(h.id));
  if (!hyller.length) { visToast('Ingen hyller å skrive ut'); return; }
  try { await sikreQrBibliotek(); } catch (e) { visToast('Kunne ikke laste QR-biblioteket: ' + e.message); return; }
  skrivUtHtml(byggEtikettDokument(hyller, format === 'ark' ? 'ark' : 'etikett'));
}

// ─── Modaler (bygges ved behov, så salmakern.html ikke trenger egne) ──────────────────────────────────────────────────────
// (Re)bygger et vindu og legger det SIST i dokumentet: alle .modal har samme z-index, så det sist åpnede ligger øverst (også over vinduer som er bygget tidligere).
function lagerModal(id, html) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.className = 'modal'; el.id = id; }
  document.body.appendChild(el);
  el.innerHTML = `<div class="modal-box" style="max-width:720px">${html}</div>`;
  return el;
}
const erLagerAdmin = () => !!me && me.rolle === 'admin';
// Tegner de åpne hylle-/bestillingsvinduene på nytt (kalt også fra Realtime-handlerne i core.js når en kollega endrer noe).
function oppdaterLagerHylleModaler() {
  const apen = (id) => !!document.getElementById(id)?.classList.contains('show');
  if (apen('lagerHylleModal')) renderHylleInnhold();
  if (apen('lagerBestillingerModal')) renderBestillingerInnhold();
  if (apen('lagerHyllerModal')) renderHyllerListe();
}
// Etter en endring av lager/hyller/bestillinger: merket, lister og detaljvisningen på lager-siden, pluss de åpne vinduene.
function oppdaterLagerSkjermer() {
  oppdaterLagerVarselBadge();
  renderGlobalLavLagerVarsel();
  if (document.getElementById('lager')?.classList.contains('active')) {
    const synlig = (id) => document.getElementById(id)?.style.display === 'block';
    if (synlig('vareDetaljView')) renderVareDetalj();
    else if (synlig('kategoriDetaljView')) renderKategoriDetalj();
    else if (synlig('modellDetaljView')) renderModellDetalj();
    else renderLagerListe();
  }
  oppdaterLagerHylleModaler();
}
// Fyller Hylle-nedtrekket i vare-skjemaet (lager.js: apneNyVare/apneRedigerVare); valgt = hylle-id eller null.
function fyllHylleValg(valgt) {
  const sel = document.getElementById('nyVareHylle'); if (!sel) return;
  const hyller = [...(S.lagerHyller || [])].sort((a, b) => String(a.kode).localeCompare(String(b.kode), 'no', { numeric: true }));
  sel.innerHTML = '<option value="">Ikke plassert</option>' + hyller.map(h => `<option value="${esc(h.id)}">${esc(h.kode)}${h.navn ? ' · ' + esc(h.navn) : ''}</option>`).join('');
  sel.value = valgt && hyller.some(h => h.id === valgt) ? valgt : '';
}

// ─── Hyller: oversikt, opprett, slett, plassering, etiketter ──────────────────────────────────────────────────────────
function apneHyllerModal() {
  lagerModal('lagerHyllerModal', `
    <div class="row"><div class="h">Hyller og QR-etiketter</div><button class="btn sm" onclick="closeModal('lagerHyllerModal')">Lukk</button></div>
    <div class="small muted" style="margin-top:6px">Hver hylle får en kort kode og en QR-etikett (25 mm) som åpner hylla i appen. Plasser varene på hyllene, og skriv ut etikettene.</div>
    ${erLagerAdmin() ? `<div class="box" style="margin-top:12px"><div class="grid g2" style="gap:8px">
      <div><label>Hyllekode (f.eks. A1)</label><input id="hylleNyKode" maxlength="20" autocomplete="off" placeholder="A1"></div>
      <div><label>Navn <span class="muted">(valgfritt)</span></label><input id="hylleNyNavn" autocomplete="off" placeholder="F.eks. Regalrad A, øverst"></div></div>
      <button class="btn red sm" style="margin-top:8px" onclick="lagreNyHylle()">+ Legg til hylle</button></div>` : ''}
    <div id="lagerHyllerListe" style="margin-top:12px"></div>
    ${erLagerAdmin() ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn sm" onclick="skrivUtHylleEtiketter(null,'etikett')">🖨 Skriv ut alle (én etikett per side, 25 mm)</button>
      <button class="btn sm" onclick="skrivUtHylleEtiketter(null,'ark')">🖨 Skriv ut alle på A4-ark</button></div>
      <div class="small muted" style="margin-top:6px">Skriv ut én testetikett først og skann den med mobilen. Velg «faktisk størrelse» / 100 % i utskriftsdialogen, ikke «tilpass til side».</div>` : ''}`);
  renderHyllerListe();
  openModal('lagerHyllerModal');
}
function renderHyllerListe() {
  const el = document.getElementById('lagerHyllerListe'); if (!el) return;
  const hyller = [...(S.lagerHyller || [])].sort((a, b) => (a.rekkefolge - b.rekkefolge) || String(a.kode).localeCompare(String(b.kode), 'no', { numeric: true }));
  const uten = (S.lagervarer || []).filter(v => !v.hylleId).length;
  el.innerHTML = (hyller.length ? hyller.map(h => {
    const n = varerPaaHylle(h.id).length;
    return `<div class="box" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="min-width:0"><b style="font-size:16px">${esc(h.kode)}</b>${h.navn ? ` <span class="muted">· ${esc(h.navn)}</span>` : ''}<div class="small muted">${n} vare${n === 1 ? '' : 'r'}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" onclick="closeModal('lagerHyllerModal');visHylle('${h.id}')">Åpne</button>
        ${erLagerAdmin() ? `<button class="btn sm" onclick="apneHyllePlassering('${h.id}')">Plasser varer</button>
        <button class="btn sm" onclick="skrivUtHylleEtiketter(['${h.id}'],'etikett')" title="Skriv ut etiketten (25 mm)">🖨</button>
        <button class="btn sm" onclick="gittNyttNavnHylle('${h.id}')" title="Endre navn">✎</button>
        <button class="btn sm" onclick="slettHylle('${h.id}')" style="color:#fca5a5" title="Slett hylla (varene blir stående uten hylle)">✕</button>` : ''}
      </div></div>`;
  }).join('') : '<div class="muted small">Ingen hyller ennå.</div>') + `<div class="small muted" style="margin-top:6px">${uten} av ${(S.lagervarer || []).length} varer er ikke plassert på en hylle.</div>`;
}
async function lagreNyHylle() {
  if (!erLagerAdmin()) return;
  const kode = normaliserHylleKode(document.getElementById('hylleNyKode')?.value);
  const navn = (document.getElementById('hylleNyNavn')?.value || '').trim().slice(0, 80);
  if (!kode) { visToast('Hyllekoden må være 1–20 tegn: bokstaver, tall, bindestrek eller understrek'); return; }
  if (finnHylle(kode)) { visToast(`Hylle ${kode} finnes allerede`); return; }
  const hylle = { id: nyLagerId('hy_'), kode, navn, rekkefolge: (S.lagerHyller || []).length, createdAt: new Date().toISOString() };
  if (db) {
    const { error } = await db.from('lager_hyller').insert({ id: hylle.id, kode, navn, rekkefolge: hylle.rekkefolge });
    if (error) { visToast('Kunne ikke lagre hylla: ' + error.message); return; }
  }
  if (!S.lagerHyller.find(h => h.id === hylle.id)) S.lagerHyller.push(hylle);
  document.getElementById('hylleNyKode').value = ''; document.getElementById('hylleNyNavn').value = '';
  renderHyllerListe();
  visToast(`Hylle ${kode} er lagt til`, 'ok');
}
async function gittNyttNavnHylle(id) {
  if (!erLagerAdmin()) return;
  const h = (S.lagerHyller || []).find(x => x.id === id); if (!h) return;
  const nytt = prompt('Navn på hylla ' + h.kode + ' (tomt = ingen):', h.navn || '');
  if (nytt === null) return;
  const navn = nytt.trim().slice(0, 80);
  if (db) { const { error } = await db.from('lager_hyller').update({ navn }).eq('id', id); if (error) { visToast('Kunne ikke endre navnet: ' + error.message); return; } }
  h.navn = navn; renderHyllerListe();
}
async function slettHylle(id) {
  if (!erLagerAdmin()) return;
  const h = (S.lagerHyller || []).find(x => x.id === id); if (!h) return;
  const n = varerPaaHylle(id).length;
  if (!confirm(`Slette hylle ${h.kode}?${n ? ` De ${n} varene blir stående uten hylle (de slettes ikke).` : ''} Etiketten på hylla slutter å virke.`)) return;
  if (db) { const { error } = await db.from('lager_hyller').delete().eq('id', id); if (error) { visToast('Kunne ikke slette hylla: ' + error.message); return; } }
  (S.lagervarer || []).forEach(v => { if (v.hylleId === id) v.hylleId = null; });
  S.lagerHyller = S.lagerHyller.filter(x => x.id !== id);
  renderHyllerListe();
}
// Plasser varer på en hylle: avkrysning per vare (søkbar). Bare endringene skrives, og bare med ÉN samlet oppdatering per retning.
function apneHyllePlassering(hylleId) {
  if (!erLagerAdmin()) return;
  const h = (S.lagerHyller || []).find(x => x.id === hylleId); if (!h) return;
  lagerModal('lagerHyllePlasseringModal', `
    <div class="row"><div class="h">Plasser varer på hylle ${esc(h.kode)}</div><button class="btn sm" onclick="closeModal('lagerHyllePlasseringModal')">Avbryt</button></div>
    <div class="small muted" style="margin-top:6px">Kryss av varene som står på denne hylla. Varer som står på en annen hylle flyttes hit.</div>
    <input id="hyllePlasseringSok" type="search" placeholder="Søk vare, modell, kategori..." oninput="renderHyllePlasseringListe('${h.id}')" style="width:100%;margin-top:10px">
    <div id="hyllePlasseringListe" style="margin-top:10px;max-height:50vh;overflow-y:auto"></div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn red" onclick="lagreHyllePlassering('${h.id}')">Lagre plassering</button><button class="btn" onclick="closeModal('lagerHyllePlasseringModal')">Avbryt</button></div>`);
  _plasseringValg = new Set(varerPaaHylle(hylleId).map(v => v.id));
  renderHyllePlasseringListe(hylleId);
  openModal('lagerHyllePlasseringModal');
}
let _plasseringValg = new Set();
function renderHyllePlasseringListe(hylleId) {
  const el = document.getElementById('hyllePlasseringListe'); if (!el) return;
  const q = (document.getElementById('hyllePlasseringSok')?.value || '').toLowerCase().trim();
  const varer = (S.lagervarer || []).filter(v => !q || [v.navn, v.modell, v.kategori, v.tegningsnummer].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.modell || '').localeCompare(b.modell || '', 'no') || (a.kategori || '').localeCompare(b.kategori || '', 'no') || a.navn.localeCompare(b.navn, 'no'));
  el.innerHTML = varer.slice(0, 400).map(v => {
    const annen = v.hylleId && v.hylleId !== hylleId ? (S.lagerHyller || []).find(h => h.id === v.hylleId) : null;
    return `<label style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-top:1px solid #1f1f23;cursor:pointer">
      <input type="checkbox" ${_plasseringValg.has(v.id) ? 'checked' : ''} onchange="vekslePlasseringsvalg('${v.id}',this.checked)" style="width:18px;height:18px;flex-shrink:0">
      <span style="min-width:0;flex:1"><span>${esc(v.navn)}</span><span class="small muted"> ${esc([v.modell, v.kategori].filter(Boolean).join(' · '))}</span></span>
      ${annen ? `<span class="small" style="color:#fde68a;flex-shrink:0">nå på ${esc(annen.kode)}</span>` : ''}</label>`;
  }).join('') + (varer.length > 400 ? `<div class="small muted">Viser 400 av ${varer.length}. Bruk søket for å finne resten.</div>` : '') || '<div class="muted small">Ingen varer</div>';
}
function vekslePlasseringsvalg(vareId, pa) { if (pa) _plasseringValg.add(vareId); else _plasseringValg.delete(vareId); }
async function lagreHyllePlassering(hylleId) {
  if (!erLagerAdmin()) return;
  const naa = new Set(varerPaaHylle(hylleId).map(v => v.id));
  const leggTil = [..._plasseringValg].filter(id => !naa.has(id));
  const fjern = [...naa].filter(id => !_plasseringValg.has(id));
  if (!leggTil.length && !fjern.length) { closeModal('lagerHyllePlasseringModal'); return; }
  if (db) {
    if (leggTil.length) { const { error } = await db.from('lagervarer').update({ hylle_id: hylleId }).in('id', leggTil); if (error) { visToast('Kunne ikke lagre plasseringen: ' + error.message); return; } }
    if (fjern.length) { const { error } = await db.from('lagervarer').update({ hylle_id: null }).in('id', fjern); if (error) { visToast('Kunne ikke lagre plasseringen: ' + error.message); return; } }
  }
  (S.lagervarer || []).forEach(v => { if (leggTil.includes(v.id)) v.hylleId = hylleId; else if (fjern.includes(v.id)) v.hylleId = null; });
  closeModal('lagerHyllePlasseringModal');
  visToast(`${leggTil.length} vare${leggTil.length === 1 ? '' : 'r'} lagt på hylla, ${fjern.length} tatt av`, 'ok');
  oppdaterLagerSkjermer();
}

// ─── Hylleside ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let _aktivHylleId = null;
function visHylle(hylleId) {
  const h = (S.lagerHyller || []).find(x => x.id === hylleId);
  if (!h) { visToast('Fant ikke hylla'); return; }
  _aktivHylleId = hylleId;
  lagerModal('lagerHylleModal', '<div id="lagerHylleInnhold"></div>');
  renderHylleInnhold();
  openModal('lagerHylleModal');
}
function renderHylleInnhold() {
  const el = document.getElementById('lagerHylleInnhold'); if (!el) return;
  const h = (S.lagerHyller || []).find(x => x.id === _aktivHylleId);
  if (!h) { el.innerHTML = '<div class="muted">Hylla finnes ikke lenger.</div>'; return; }
  const varer = varerPaaHylle(h.id);
  el.innerHTML = `<div class="row"><div><div class="h">Hylle ${esc(h.kode)}</div>${h.navn ? `<div class="muted small">${esc(h.navn)}</div>` : ''}</div>
      <div style="display:flex;gap:6px"><button class="btn sm" onclick="apneSkannModal()">📷 Skann</button><button class="btn sm" onclick="closeModal('lagerHylleModal')">Lukk</button></div></div>
    <div class="small muted" style="margin-top:4px">${varer.length} vare${varer.length === 1 ? '' : 'r'} på hylla</div>
    <div style="margin-top:10px">${varer.length ? varer.map(v => {
      const apne = bestillingerForVare(v.id);
      const lav = typeof erLavBeholdning === 'function' && erLavBeholdning(v);
      return `<div class="box" style="margin-bottom:8px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:0"><b>${esc(v.navn)}</b><div class="small muted">${esc([v.modell, v.kategori].filter(Boolean).join(' · '))}</div></div>
          <div style="text-align:right"><span style="font-size:22px;font-weight:800;color:${v.antall <= 0 ? '#fca5a5' : '#f4f4f5'}">${esc(fmtAntall(v.antall))}</span> <span class="muted small">${esc(v.enhet)}</span>
            <div class="small muted">minimum ${esc(fmtAntall(v.minAntall))}</div></div></div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          ${lav ? '<span class="pill bad" style="margin:0;font-size:11px">Under minimum</span>' : ''}
          ${apne.length || v.bestilt ? `<span class="pill ok" style="margin:0;font-size:11px">Bestilt${apne.some(b => b.forventetDato) ? ' · forventet ' + esc(apne.filter(b => b.forventetDato).map(b => lagerDato(b.forventetDato)).sort()[0]) : ''}</span>` : ''}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm red" onclick="apneHylleUttak('${v.id}')">Ta ut</button>
          ${apne.length ? `<button class="btn sm" onclick="apneMottaFraVare('${v.id}')">Motta bestilling</button>` : ''}
          <button class="btn sm" onclick="apneHylleFyllPa('${v.id}')">Fyll på</button>
          <button class="btn sm" onclick="apneTellModal('${v.id}')">Tell</button>
        </div></div>`;
    }).join('') : '<div class="muted small">Ingen varer er plassert på denne hylla ennå.</div>'}</div>`;
}
// Åpne hylla fra en lenke/skanning (?h=A1 eller bare koden). Ukjent kode gir en tydelig beskjed.
function apneHylleMedKode(kode) {
  const k = hylleKodeFraTekst(kode);
  if (!k) { visToast('Det er ikke en hyllekode'); return false; }
  const h = finnHylle(k);
  if (!h) { visToast(`Fant ingen hylle med koden ${k}`); return false; }
  if (typeof showPage === 'function') { const fane = document.getElementById('lagerTab'); if (fane) showPage('lager', fane); }
  visHylle(h.id);
  return true;
}
let pendingHylleKode = null;
function apneHylleFraUrlHvisKlar() {
  if (!pendingHylleKode || !me) return;
  const kode = pendingHylleKode; pendingHylleKode = null;
  apneHylleMedKode(kode);
}

// ─── Ta ut og tell ─────────────────────────────────────────────────────────────────────────────────────────────────────
function apneHylleUttak(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  const ordrer = (S.ordrer || []).filter(o => o.status === 'aktiv');
  lagerModal('lagerHylleUttakModal', `
    <div class="h">Ta ut ${esc(v.navn)}</div>
    <div class="small muted" style="margin-top:4px">${esc(fmtAntall(v.antall))} ${esc(v.enhet)} på lager</div>
    <div class="grid g2" style="gap:8px;margin-top:12px">
      <div><label>Antall</label><input id="uttakAntall" type="number" min="0" step="any" inputmode="decimal" autocomplete="off"></div>
      <div><label>Til ordre <span class="muted">(valgfritt)</span></label>
        <select id="uttakOrdre"><option value="">Ingen ordre</option>${ordrer.map(o => `<option value="${esc(o.id)}">${ordreLabelFull(o)}${o.kunde ? ' · ' + esc(o.kunde) : ''}</option>`).join('')}</select></div>
      <div style="grid-column:1/-1"><label>Kommentar <span class="muted">(valgfritt)</span></label><input id="uttakKommentar" autocomplete="off"></div></div>
    <div style="margin-top:14px;display:flex;gap:8px"><button class="btn red" onclick="lagreHylleUttak('${v.id}')">Ta ut</button><button class="btn" onclick="closeModal('lagerHylleUttakModal')">Avbryt</button></div>`);
  openModal('lagerHylleUttakModal');
  setTimeout(() => document.getElementById('uttakAntall')?.focus(), 50);
}
function lagreHylleUttak(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  const antall = lesLagerTall('uttakAntall');
  const ordreId = document.getElementById('uttakOrdre')?.value || '';
  const kommentar = (document.getElementById('uttakKommentar')?.value || '').trim();
  if (!Number.isFinite(antall) || antall <= 0) { visToast('Skriv inn et antall større enn 0'); return; }
  if (antall > v.antall) { visToast(`Kan ikke ta ut ${fmtAntall(antall)} ${v.enhet}: det er bare ${fmtAntall(v.antall)} igjen`); return; }
  const o = ordreId ? (S.ordrer || []).find(x => x.id === ordreId) : null;
  registrerLagerEndring(v, -antall, 'ut', ordreId || null, kommentar || (o ? 'Uttak til ' + (typeof leveranseTittel === 'function' && erLeveranse(o) ? leveranseTittel(o) : (o.regnr || o.chassis || o.kunde || o.id)) : 'Uttak fra hylle'));
  closeModal('lagerHylleUttakModal');
  visToast(`${fmtAntall(antall)} ${v.enhet} tatt ut`, 'ok');
  oppdaterLagerSkjermer();
}
// Fyll på uten en registrert bestilling (f.eks. en retur eller varer som kom uten at noen la inn bestillingen). Kom varene mot en bestilling: bruk «Motta bestilling».
function apneHylleFyllPa(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  lagerModal('lagerHylleFyllPaModal', `
    <div class="h">Fyll på ${esc(v.navn)}</div>
    <div class="small muted" style="margin-top:4px">${esc(fmtAntall(v.antall))} ${esc(v.enhet)} på lager${harApenBestilling(v.id) ? ' · varen har en åpen bestilling: bruk «Motta bestilling» hvis dette er den' : ''}</div>
    <div class="grid g2" style="gap:8px;margin-top:12px">
      <div><label>Antall</label><input id="fyllPaAntall" type="number" min="0" step="any" inputmode="decimal" autocomplete="off"></div>
      <div><label>Kommentar <span class="muted">(valgfritt)</span></label><input id="fyllPaKommentar" autocomplete="off"></div></div>
    <div style="margin-top:14px;display:flex;gap:8px"><button class="btn red" onclick="lagreHylleFyllPa('${v.id}')">Fyll på</button><button class="btn" onclick="closeModal('lagerHylleFyllPaModal')">Avbryt</button></div>`);
  openModal('lagerHylleFyllPaModal');
  setTimeout(() => document.getElementById('fyllPaAntall')?.focus(), 50);
}
function lagreHylleFyllPa(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  const antall = lesLagerTall('fyllPaAntall');
  const kommentar = (document.getElementById('fyllPaKommentar')?.value || '').trim();
  if (!Number.isFinite(antall) || antall <= 0) { visToast('Skriv inn et antall større enn 0'); return; }
  registrerLagerEndring(v, antall, 'inn', null, kommentar || 'Påfyll fra hylle');
  closeModal('lagerHylleFyllPaModal');
  visToast(`${fmtAntall(antall)} ${v.enhet} lagt på lager`, 'ok');
  oppdaterLagerSkjermer();
}
function apneTellModal(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  lagerModal('lagerTellModal', `<div class="h">Tell ${esc(v.navn)}</div>
    <div class="small muted" style="margin-top:4px">I appen: ${esc(fmtAntall(v.antall))} ${esc(v.enhet)}</div>
    <div style="margin-top:12px"><label>Talt antall</label><input id="tellAntall" type="number" min="0" step="any" inputmode="decimal" value="${esc(String(v.antall))}" autocomplete="off"></div>
    <div style="margin-top:14px;display:flex;gap:8px"><button class="btn red" onclick="lagreTelling('${v.id}')">Lagre telling</button><button class="btn" onclick="closeModal('lagerTellModal')">Avbryt</button></div>`);
  openModal('lagerTellModal');
  setTimeout(() => { const i = document.getElementById('tellAntall'); if (i) { i.focus(); i.select(); } }, 50);
}
function lagreTelling(vareId) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  const talt = lesLagerTall('tellAntall');
  if (!Number.isFinite(talt) || talt < 0) { visToast('Skriv inn antallet du har talt (0 eller mer)'); return; }
  const diff = Math.round((talt - v.antall) * 1000) / 1000;
  closeModal('lagerTellModal');
  if (diff === 0) { visToast('Antallet stemmer', 'ok'); return; }
  registrerLagerEndring(v, diff, diff > 0 ? 'inn' : 'ut', null, `Telling: talt ${fmtAntall(talt)}, var ${fmtAntall(talt - diff)}`);
  visToast(`Lageret er rettet til ${fmtAntall(talt)} ${v.enhet} (${diff > 0 ? '+' : ''}${fmtAntall(diff)})`, 'ok');
  oppdaterLagerSkjermer();
}

// ─── Skanning med kamera ───────────────────────────────────────────────────────────────────────────────────────────────
let _skann = null;
let _skannNr = 0; // økes hver gang skann-vinduet åpnes eller lukkes, så en forsinket kameratillatelse etter lukking ikke starter kameraet
// iPhone/iPad: en app på hjemskjermen får ALDRI huske kameratillatelsen, så direkte kamera i appen (getUserMedia) spurte om tilgang hver gang
// (Henrik 2026-11-12: «jeg vil at den ikke skal spørre om tillatelse hver gang»). Der tas det i stedet et bilde med iPhonens eget kamera
// (samme <input capture> som bildene på ordren, som aldri spør), og QR-koden leses fra bildet med jsQR. Andre enheter husker tillatelsen og beholder direkte skanning.
function skannMedBilde() {
  try {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch (e) { return false; }
}
function apneSkannModal() {
  stoppSkann(); _skannNr++;
  if (skannMedBilde()) { apneSkannBildeModal(); return; }
  lagerModal('lagerSkannModal', `<div class="row"><div class="h">Skann QR-kode</div><button class="btn sm" onclick="lukkSkannModal()">Lukk</button></div>
    <div style="margin-top:10px;position:relative;background:#000;border-radius:14px;overflow:hidden;aspect-ratio:1/1;max-height:60vh"><video id="skannVideo" playsinline muted style="width:100%;height:100%;object-fit:cover"></video></div>
    <div id="skannStatus" class="small muted" style="margin-top:8px">Starter kameraet...</div>
    <div style="margin-top:10px"><label>Eller skriv hyllekoden</label>
      <div style="display:flex;gap:8px"><input id="skannKode" maxlength="20" autocomplete="off" placeholder="A1" onkeydown="if(event.key==='Enter')apneHylleFraSkannfelt()"><button class="btn red" onclick="apneHylleFraSkannfelt()">Åpne</button></div></div>`);
  openModal('lagerSkannModal');
  startSkann();
}
function apneSkannBildeModal() {
  lagerModal('lagerSkannModal', `<div class="row"><div class="h">Skann QR-kode</div><button class="btn sm" onclick="lukkSkannModal()">Lukk</button></div>
    <input type="file" id="skannBildeInput" accept="image/*" capture="environment" style="display:none" onchange="lesSkannBilde(event)">
    <button class="btn red" style="margin-top:12px;width:100%;padding:14px" onclick="document.getElementById('skannBildeInput').click()">📷 Ta bilde av QR-koden</button>
    <div id="skannStatus" class="small muted" style="margin-top:8px">Ta bildet rett forfra, så nær at QR-koden fyller en god del av bildet.</div>
    <div style="margin-top:10px"><label>Eller skriv hyllekoden</label>
      <div style="display:flex;gap:8px"><input id="skannKode" maxlength="20" autocomplete="off" placeholder="A1" onkeydown="if(event.key==='Enter')apneHylleFraSkannfelt()"><button class="btn red" onclick="apneHylleFraSkannfelt()">Åpne</button></div></div>`);
  openModal('lagerSkannModal');
  // Åpne kameraet med en gang (samme trykk som «Skann», så iPhone tillater det). Knappen over er for et nytt forsøk.
  try { document.getElementById('skannBildeInput').click(); } catch (e) { /* brukeren trykker knappen */ }
}
async function lesSkannBilde(ev) {
  const inp = ev && ev.target; const fil = inp && inp.files && inp.files[0];
  const status = document.getElementById('skannStatus');
  if (!fil) return;
  const mitt = _skannNr;
  if (status) status.textContent = 'Leser QR-koden...';
  try {
    await lastSkript('js/vendor/jsQR.js');
    const tekst = await lesQrFraBilde(fil);
    if (mitt !== _skannNr) return; // vinduet er lukket i mellomtiden
    if (!tekst) { if (status) status.textContent = 'Fant ingen QR-kode i bildet. Ta et nytt bilde litt nærmere, rett forfra.'; return; }
    behandleSkannet(tekst);
  } catch (e) {
    if (status && mitt === _skannNr) status.textContent = 'Kunne ikke lese bildet. Prøv igjen, eller skriv hyllekoden under.';
  } finally { try { inp.value = ''; } catch (e) { /* samme bilde kan velges igjen */ } }
}
// Et mobilfoto er 12 MP: jsQR prøves på en nedskalert kopi først (rask), så større om den ikke fant noe (små QR-koder langt unna). Lappene er mørk kode på lys bunn, så jsQR slipper å prøve invertert (halv tid).
async function lesQrFraBilde(fil) {
  const url = URL.createObjectURL(fil);
  try {
    const img = await new Promise((ok, feil) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => feil(new Error('bilde')); i.src = url; });
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    for (const maks of [1000, 2000]) {
      const k = Math.min(1, maks / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      const lerret = document.createElement('canvas'); lerret.width = w; lerret.height = h;
      const ctx = lerret.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h); const r = jsQR(d.data, w, h, { inversionAttempts: 'dontInvert' });
      if (r && r.data) return r.data;
      if (k === 1) break;
    }
    return '';
  } finally { URL.revokeObjectURL(url); }
}
function lukkSkannModal() { _skannNr++; stoppSkann(); closeModal('lagerSkannModal'); }
function apneHylleFraSkannfelt() {
  const k = document.getElementById('skannKode')?.value || '';
  if (apneHylleMedKode(k)) lukkSkannModal();
}
// Den skannede teksten -> ordre (ordre-lapp) eller hylle (lenke eller kode). Returnerer true når noe ble åpnet (og kameraet stoppes).
// Skanning inne i appen er nødvendig på iPhone: kameraet åpner alltid QR-lenker i Safari, ikke i appen på hjemskjermen.
function behandleSkannet(tekst) {
  const status = document.getElementById('skannStatus');
  const ordreId = ordreIdFraTekst(tekst);
  if (ordreId) {
    const o = (S.ordrer || []).find(x => x.id === ordreId);
    if (!o) { if (status) status.textContent = 'Fant ikke ordren på lappen (kan være slettet). Trykk 🔄 hvis den er helt ny.'; return false; }
    lukkSkannModal();
    openOrdre(o.id, o.status === 'arkivert');
    return true;
  }
  const k = hylleKodeFraTekst(tekst);
  if (!k) { if (status) status.textContent = 'Dette er ikke en QR-kode fra appen (ordre-lapp eller hylle). Prøv en annen.'; return false; }
  if (!finnHylle(k)) { if (status) status.textContent = `Fant ingen hylle med koden ${k}.`; return false; }
  lukkSkannModal();
  apneHylleMedKode(k);
  return true;
}
async function startSkann() {
  const mitt = _skannNr; // vinduet kan lukkes (eller åpnes på nytt) mens vi venter på tillatelse til kameraet
  const video = document.getElementById('skannVideo'); const status = document.getElementById('skannStatus');
  if (!navigator.mediaDevices?.getUserMedia) { if (status) status.textContent = 'Kameraet er ikke tilgjengelig her. Skriv hyllekoden under.'; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
  catch (e) { if (status) status.textContent = 'Fikk ikke tilgang til kameraet. Gi appen tilgang, eller skriv hyllekoden under.'; return; }
  if (mitt !== _skannNr) { stream.getTracks().forEach(t => t.stop()); return; } // lukket mens vi ventet: ikke la kameraet stå på
  _skann = { stream, aktiv: true };
  video.srcObject = stream;
  // Ikke vent på play(): den kan henge til kameraet leverer første bilde, og da startet aldri leseløkka. (Eldre nettlesere gir ikke et løfte tilbake.)
  try { Promise.resolve(video.play()).catch(() => { /* spilles av når siden er synlig */ }); } catch (e) { /* ignoreres */ }
  // Innebygd QR-leser der den finnes (Chrome på Android), ellers jsQR (iPhone, PC). Svikter den innebygde, byttes det til jsQR i stedet for å lete videre uten å finne noe.
  let detektor = null;
  if ('BarcodeDetector' in window) { try { detektor = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detektor = null; } }
  const lastJsQr = async () => { try { await lastSkript('js/vendor/jsQR.js'); return true; } catch (e) { if (status) status.textContent = 'Kunne ikke laste skanneren. Skriv hyllekoden under.'; return false; } };
  if (!detektor && !(await lastJsQr())) return;
  if (mitt !== _skannNr) return;
  if (status) status.textContent = 'Hold kameraet mot QR-koden på ordre-lappen eller hylla.';
  const lerret = document.createElement('canvas'); const ctx = lerret.getContext('2d', { willReadFrequently: true });
  const lop = async () => {
    if (!_skann || !_skann.aktiv || mitt !== _skannNr) return;
    if (video.readyState < 2) { _skann.tidtaker = setTimeout(lop, 150); return; } // venter på første bilde fra kameraet
    try {
      let tekst = '';
      if (detektor) {
        try { const k = await detektor.detect(video); tekst = k[0] && k[0].rawValue || ''; }
        catch (e) { detektor = null; if (!(await lastJsQr())) return; } // den innebygde leseren feilet: bytt til jsQR
      } else if (video.videoWidth) {
        lerret.width = video.videoWidth; lerret.height = video.videoHeight; ctx.drawImage(video, 0, 0);
        const bilde = ctx.getImageData(0, 0, lerret.width, lerret.height); const r = jsQR(bilde.data, bilde.width, bilde.height); tekst = r ? r.data : '';
      }
      if (tekst && behandleSkannet(tekst)) return;
    } catch (e) { /* neste bilde */ }
    if (_skann && _skann.aktiv && mitt === _skannNr) _skann.tidtaker = setTimeout(lop, 250);
  };
  lop();
}
function stoppSkann() {
  if (!_skann) return;
  _skann.aktiv = false; clearTimeout(_skann.tidtaker);
  try { _skann.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* allerede stoppet */ }
  _skann = null;
}

// ─── Bestillinger og mottak ────────────────────────────────────────────────────────────────────────────────────────────
function apneBestillingerModal() {
  lagerModal('lagerBestillingerModal', `<div class="row"><div class="h">Bestillinger</div><button class="btn sm" onclick="closeModal('lagerBestillingerModal')">Lukk</button></div>
    <div class="small muted" style="margin-top:4px">Åpne bestillinger. «Motta» øker lageret og lukker bestillingen. Varer med en åpen bestilling regnes som bestilt og kommer ikke på bestillingslista.</div>
    ${erLagerAdmin() ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn red sm" onclick="apneRegistrerBestilling()">+ Registrer bestilling</button>
      <button class="btn sm" onclick="apneRegistrerBestilling({alleUnderMinimum:true})" title="For det som allerede er bestilt, men ikke registrert">Registrer alt under minimum som allerede bestilt</button></div>` : ''}
    <div id="lagerBestillingerInnhold" style="margin-top:12px"></div>`);
  renderBestillingerInnhold();
  openModal('lagerBestillingerModal');
}
function renderBestillingerInnhold() {
  const el = document.getElementById('lagerBestillingerInnhold'); if (!el) return;
  const apne = (S.lagerBestillinger || []).filter(b => b.status === 'apen');
  if (!apne.length) { el.innerHTML = '<div class="muted small">Ingen åpne bestillinger.</div>'; return; }
  const grupper = {};
  apne.forEach(b => { (grupper[b.leverandor || 'Ukjent leverandør'] = grupper[b.leverandor || 'Ukjent leverandør'] || []).push(b); });
  el.innerHTML = Object.keys(grupper).sort((a, b) => a.localeCompare(b, 'no')).map(lev => `<div style="margin-bottom:14px">
    <div style="font-weight:700;margin-bottom:6px">${esc(lev)} <span class="muted small">${grupper[lev].length}</span></div>
    ${grupper[lev].sort((a, b) => String(a.forventetDato || '9999').localeCompare(String(b.forventetDato || '9999'))).map(b => {
      const v = (S.lagervarer || []).find(x => x.id === b.vareId);
      return `<div class="box" style="margin-bottom:6px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="min-width:0"><div>${esc(v ? v.navn : '(vare slettet)')}</div>
          <div class="small muted">${b.ukjentAntall ? 'Antall ukjent' : esc(fmtAntall(b.antall)) + ' ' + esc(v ? v.enhet : '')}${b.forventetDato ? ' · forventet ' + esc(lagerDato(b.forventetDato)) : ''}${b.bestiltDato ? ' · bestilt ' + esc(lagerDato(b.bestiltDato)) : ''}${b.kommentar ? ' · ' + esc(b.kommentar) : ''}</div></div>
        <div style="display:flex;gap:6px"><button class="btn sm red" onclick="apneMottaModal('${b.id}')">Motta</button>
          ${erLagerAdmin() ? `<button class="btn sm" onclick="kansellerBestilling('${b.id}')" style="color:#fca5a5">Kanseller</button>` : ''}</div></div>`;
    }).join('')}</div>`).join('');
}
function apneRegistrerBestilling(opts = {}) {
  if (!erLagerAdmin()) return;
  const alle = S.lagervarer || [];
  const forvalgt = new Set(opts.alleUnderMinimum ? alle.filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt).map(v => v.id) : (opts.vareId ? [opts.vareId] : []));
  _bestillingValg = new Map([...forvalgt].map(id => [id, foreslaattBestillingsantall(alle.find(v => v.id === id))]));
  const leverandorer = [...new Set(alle.map(v => v.leverandor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'no'));
  lagerModal('lagerRegistrerBestillingModal', `<div class="row"><div class="h">Registrer bestilling</div><button class="btn sm" onclick="closeModal('lagerRegistrerBestillingModal')">Avbryt</button></div>
    <div class="grid g2" style="gap:8px;margin-top:10px">
      <div><label>Leverandør</label><input id="bestLeverandor" list="bestLeverandorListe" autocomplete="off" placeholder="Hvem er det bestilt hos?"><datalist id="bestLeverandorListe">${leverandorer.map(l => `<option value="${esc(l)}">`).join('')}</datalist></div>
      <div><label>Bestilt dato</label><input id="bestBestiltDato" type="date" value="${lagerIdag()}"></div>
      <div><label>Forventet levert <span class="muted">(valgfritt)</span></label><input id="bestForventetDato" type="date"></div>
      <div><label>Kommentar <span class="muted">(valgfritt)</span></label><input id="bestKommentar" autocomplete="off"></div></div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" id="bestUkjentAntall" ${opts.alleUnderMinimum ? 'checked' : ''} onchange="renderBestillingVarer()" style="width:16px;height:16px">
      <span class="small">Antall er ukjent (bestillingen var lagt før den ble registrert her). Antallet fylles inn når varene kommer.</span></label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:6px;cursor:pointer"><input type="checkbox" id="bestLagreLeverandor" checked style="width:16px;height:16px"><span class="small">Lagre leverandøren på varene som mangler den</span></label>
    <input id="bestSok" type="search" placeholder="Søk vare, modell, kategori..." oninput="renderBestillingVarer()" style="width:100%;margin-top:10px">
    <div id="bestVareListe" style="margin-top:8px;max-height:42vh;overflow-y:auto"></div>
    <div id="bestOppsummering" class="small muted" style="margin-top:8px"></div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn red" onclick="lagreBestillinger()">Registrer bestilling</button><button class="btn" onclick="closeModal('lagerRegistrerBestillingModal')">Avbryt</button></div>`);
  renderBestillingVarer();
  openModal('lagerRegistrerBestillingModal');
}
let _bestillingValg = new Map(); // vareId -> antall
function renderBestillingVarer() {
  const el = document.getElementById('bestVareListe'); if (!el) return;
  const ukjent = !!document.getElementById('bestUkjentAntall')?.checked;
  const q = (document.getElementById('bestSok')?.value || '').toLowerCase().trim();
  const varer = (S.lagervarer || []).filter(v => !q || [v.navn, v.modell, v.kategori, v.tegningsnummer].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b) => ((_bestillingValg.has(b.id) ? 1 : 0) - (_bestillingValg.has(a.id) ? 1 : 0)) || (a.modell || '').localeCompare(b.modell || '', 'no') || a.navn.localeCompare(b.navn, 'no'));
  el.innerHTML = varer.slice(0, 300).map(v => `<div style="display:flex;align-items:center;gap:10px;padding:6px 4px;border-top:1px solid #1f1f23">
      <input type="checkbox" ${_bestillingValg.has(v.id) ? 'checked' : ''} onchange="veksleBestillingsvalg('${v.id}',this.checked)" style="width:18px;height:18px;flex-shrink:0">
      <span style="min-width:0;flex:1"><span>${esc(v.navn)}</span><span class="small muted"> ${esc(fmtAntall(v.antall))}/${esc(fmtAntall(v.minAntall))} ${esc(v.enhet)}${v.bestilt ? ' · allerede bestilt' : ''}</span></span>
      ${ukjent ? '' : `<input type="number" min="0" step="any" inputmode="decimal" value="${_bestillingValg.has(v.id) ? esc(String(_bestillingValg.get(v.id))) : ''}" ${_bestillingValg.has(v.id) ? '' : 'disabled'} onchange="settBestillingsantall('${v.id}',this.value)" style="width:76px;flex-shrink:0" title="Antall som er bestilt">`}</div>`).join('') || '<div class="muted small">Ingen varer</div>';
  const o = document.getElementById('bestOppsummering'); if (o) o.textContent = `${_bestillingValg.size} vare${_bestillingValg.size === 1 ? '' : 'r'} valgt`;
}
function veksleBestillingsvalg(vareId, pa) {
  const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) return;
  if (pa) _bestillingValg.set(vareId, foreslaattBestillingsantall(v)); else _bestillingValg.delete(vareId);
  renderBestillingVarer();
}
function settBestillingsantall(vareId, verdi) {
  const n = Number(String(verdi).replace(',', '.'));
  if (_bestillingValg.has(vareId) && Number.isFinite(n) && n >= 0) _bestillingValg.set(vareId, n);
}
async function lagreBestillinger() {
  if (!erLagerAdmin()) return;
  const ukjent = !!document.getElementById('bestUkjentAntall')?.checked;
  const lev = (document.getElementById('bestLeverandor')?.value || '').trim();
  const bestiltDato = document.getElementById('bestBestiltDato')?.value || '';
  const forventetDato = document.getElementById('bestForventetDato')?.value || '';
  const kommentar = (document.getElementById('bestKommentar')?.value || '').trim();
  const lagreLev = !!document.getElementById('bestLagreLeverandor')?.checked;
  if (!_bestillingValg.size) { visToast('Velg minst én vare'); return; }
  const rader = [];
  for (const [vareId, antall] of _bestillingValg) {
    const v = (S.lagervarer || []).find(x => x.id === vareId); if (!v) continue;
    if (!ukjent && !(antall > 0)) { visToast(`Skriv inn antall for «${v.navn}», eller kryss av for ukjent antall`); return; }
    rader.push({ id: nyLagerId('lb_'), vareId, antall: ukjent ? 0 : antall, ukjentAntall: ukjent, leverandor: lev || v.leverandor || '', bestiltDato, forventetDato, kommentar, bestiltAv: me ? me.navn : '' });
  }
  if (!rader.length) return;
  if (db) {
    for (let i = 0; i < rader.length; i += 100) {
      const { error } = await db.rpc('lager_registrer_bestillinger', { p_bestillinger: rader.slice(i, i + 100) });
      if (error) { visToast('Kunne ikke registrere bestillingen: ' + error.message + (i ? ' (en del er allerede registrert)' : '')); return; }
    }
    if (lagreLev && lev) {
      const uten = rader.map(r => r.vareId).filter(id => !(S.lagervarer.find(v => v.id === id) || {}).leverandor);
      if (uten.length) { const { error } = await db.from('lagervarer').update({ leverandor: lev }).in('id', uten); if (!error) uten.forEach(id => { const v = S.lagervarer.find(x => x.id === id); if (v) v.leverandor = lev; }); }
    }
  }
  rader.forEach(r => {
    if (!S.lagerBestillinger.find(b => b.id === r.id)) S.lagerBestillinger.unshift({ id: r.id, vareId: r.vareId, antall: r.antall, ukjentAntall: r.ukjentAntall, mottattAntall: 0, leverandor: r.leverandor, bestiltDato: r.bestiltDato || null, forventetDato: r.forventetDato || null, status: 'apen', bestiltAv: r.bestiltAv, kommentar: r.kommentar, mottattAt: null, mottattAv: '', createdAt: new Date().toISOString() });
    const v = S.lagervarer.find(x => x.id === r.vareId); if (v) v.bestilt = true;
  });
  closeModal('lagerRegistrerBestillingModal');
  visToast(`${rader.length} bestilling${rader.length === 1 ? '' : 'er'} registrert`, 'ok');
  oppdaterLagerSkjermer();
  if (document.getElementById('lagerBestillingerModal')?.classList.contains('show')) renderBestillingerInnhold();
}
function apneMottaFraVare(vareId) {
  const apne = bestillingerForVare(vareId);
  if (apne.length === 1) { apneMottaModal(apne[0].id); return; }
  apneBestillingerModal();
}
function apneMottaModal(bestillingId) {
  const b = (S.lagerBestillinger || []).find(x => x.id === bestillingId); if (!b || b.status !== 'apen') { visToast('Bestillingen er ikke lenger åpen'); return; }
  const v = (S.lagervarer || []).find(x => x.id === b.vareId); if (!v) { visToast('Varen finnes ikke lenger'); return; }
  lagerModal('lagerMottaModal', `<div class="h">Motta ${esc(v.navn)}</div>
    <div class="small muted" style="margin-top:4px">${b.ukjentAntall ? 'Antall på bestillingen er ukjent' : 'Bestilt: ' + esc(fmtAntall(b.antall)) + ' ' + esc(v.enhet)}${b.leverandor ? ' · ' + esc(b.leverandor) : ''} · på lager nå: ${esc(fmtAntall(v.antall))}</div>
    <div class="grid g2" style="gap:8px;margin-top:12px">
      <div><label>Mottatt antall</label><input id="mottaAntall" type="number" min="0" step="any" inputmode="decimal" value="${b.ukjentAntall ? '' : esc(String(b.antall))}" autocomplete="off"></div>
      <div><label>Kommentar <span class="muted">(valgfritt)</span></label><input id="mottaKommentar" autocomplete="off"></div></div>
    <div class="small muted" style="margin-top:8px">Kom det mindre enn bestilt, noteres det og det sendes et varsel. Bestillingen lukkes uansett; legg inn en ny hvis resten kommer senere.</div>
    <div style="margin-top:14px;display:flex;gap:8px"><button class="btn red" onclick="mottaBestilling('${b.id}')">Motta</button><button class="btn" onclick="closeModal('lagerMottaModal')">Avbryt</button></div>`);
  openModal('lagerMottaModal');
  setTimeout(() => { const i = document.getElementById('mottaAntall'); if (i) { i.focus(); i.select(); } }, 50);
}
async function mottaBestilling(bestillingId) {
  const b = (S.lagerBestillinger || []).find(x => x.id === bestillingId); if (!b || b.status !== 'apen') return;
  const antall = lesLagerTall('mottaAntall');
  const kommentar = (document.getElementById('mottaKommentar')?.value || '').trim();
  if (!Number.isFinite(antall) || antall < 0) { visToast('Skriv inn mottatt antall (0 eller mer)'); return; }
  if (!db) return;
  const { data, error } = await db.rpc('lager_motta_bestilling', { p_id: bestillingId, p_antall: antall, p_ansatt: me ? me.navn : '', p_kommentar: kommentar });
  if (error) { visToast(error.message.includes('IKKE_APEN') ? 'Bestillingen er allerede mottatt eller kansellert (kanskje av en kollega)' : 'Kunne ikke motta: ' + error.message); closeModal('lagerMottaModal'); return; }
  b.status = 'mottatt'; b.mottattAntall = antall; b.mottattAv = me ? me.navn : ''; b.mottattAt = new Date().toISOString();
  const v = (S.lagervarer || []).find(x => x.id === b.vareId);
  if (v && data) { v.antall = Number(data.nyttAntall); v.bestilt = !!data.bestilt; }
  closeModal('lagerMottaModal');
  if (data && Number(data.mangler) > 0 && v) {
    varselMangelfullLevering(v, Number(data.forventet), antall, Number(data.mangler));
    visToast(`Mottatt ${fmtAntall(antall)} ${v.enhet}. Mangler ${fmtAntall(Number(data.mangler))} av det som var bestilt.`);
  } else visToast(`Mottatt ${fmtAntall(antall)}${v ? ' ' + v.enhet : ''}`, 'ok');
  oppdaterLagerSkjermer();
}
async function kansellerBestilling(bestillingId) {
  if (!erLagerAdmin()) return;
  const b = (S.lagerBestillinger || []).find(x => x.id === bestillingId); if (!b || b.status !== 'apen') return;
  if (!confirm('Kansellere denne bestillingen? Lageret endres ikke.')) return;
  if (!db) return;
  const { data, error } = await db.rpc('lager_kanseller_bestilling', { p_id: bestillingId });
  if (error) { visToast('Kunne ikke kansellere: ' + error.message); return; }
  b.status = 'kansellert';
  const v = (S.lagervarer || []).find(x => x.id === b.vareId); if (v && data) v.bestilt = !!data.bestilt;
  oppdaterLagerSkjermer();
}
