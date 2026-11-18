// ════════════════════════════════════════════════════
// BESTILLING PÅ E-POST (trinn 5 av «Én produktliste», Henrik 18.11.2026)
// ════════════════════════════════════════════════════
// Selgeren videresender bestillingen fra innkjøpsportalen. Edge-funksjonen epost-bestilling leser den, og databasen (epost_bestilling_lagre) legger
// produktene rett på ordren ved sikkert treff, lager ordren («På vei», ikke bekreftet) når ingen har chassis.nr, eller legger raden i «Innkommende».
// Her i appen:
//  * Bekreft-banneret på en ordre laget av en e-post (alle ansatte; som Bekreft på en portalordre). Slette gjør admin med «Slett ordre».
//  * Fakturalinjene for e-postlinjene (med antall, uten rabatt: kundens avtalte rabatt brukes) legges inn av synkProduktliste når ordren er bekreftet
//    (eller med en gang på en ordre som fantes fra før). Ingenting går til Fiken herfra.
//  * «Innkommende» på Oversikt (bare admin): radene appen ikke var sikker på, med grunnen. «Legg på ordren», «Lag ny ordre» eller «Avvis».

function epostOrdreBekreftet(o) { return !o.epostBestillingId || !!o.epostBekreftetAt; }

const _epostFakturaIGang = new Set();
async function epostSikreFakturalinje(o, nr, antall) {
  if ((o.fikenLinjer || []).some(l => l.produktnummer === nr)) return;
  const nokkel = o.id + '|' + nr;
  if (_epostFakturaIGang.has(nokkel) || !db) return;
  _epostFakturaIGang.add(nokkel);
  try {
    const { data, error } = await db.rpc('oppdater_ordre_fiken_linje', { p_ordre_id: o.id, p_produktnummer: nr, p_linje: { produktnummer: nr, antall: Math.max(1, Math.floor(Number(antall) || 1)) } });
    if (error) { console.error('Kunne ikke legge til fakturalinje fra e-postbestilling:', error.message); visToast(`Kunne ikke legge til fakturalinje ${nr} fra bestillingen - sjekk Fakturering-kortet.`, 'feil'); return; }
    o.fikenLinjer = data?.fikenLinjer ?? o.fikenLinjer;
    planleggLocalSpeiling();
  } finally { _epostFakturaIGang.delete(nokkel); }
}

const EPOST_FEILTEKSTER = {
  IKKE_INNLOGGET: 'Du er ikke innlogget. Logg inn på nytt og prøv igjen.',
  KUN_ADMIN: 'Bare administrator kan behandle innkommende bestillinger.',
  ORDRE_FINNES_IKKE: 'Ordren finnes ikke lenger.',
  FINNES_IKKE: 'Bestillingen finnes ikke lenger.',
  ALLEREDE_BEHANDLET: 'Bestillingen er allerede behandlet (kanskje av en kollega).',
  INGEN_LINJER: 'Appen fant ingen produkter i denne raden. Legg dem inn for hånd på ordren, og avvis raden.',
  MANGLER_CHASSIS: 'Raden har ikke et gyldig chassis.nr.',
  UKJENT_FORHANDLER: 'Forhandleren er ukjent (avsenderen er ikke en selger i Kontakter). Lag ordren for hånd.',
  CHASSIS_FINNES: 'En aktiv ordre har allerede dette chassis.nr. Bruk «Legg på ordren».',
  UKJENT_MODELL: 'Modellen har ingen kobling til merke/modell i appen.',
  TAK: 'Forhandleren har allerede 10 ubekreftede e-postordrer. Bekreft eller slett noen først.',
};
function epostFeilTekst(error) {
  const m = String(error?.message || '');
  if (m.includes('IKKE_LAGT_PAA')) return m.replace(/^.*IKKE_LAGT_PAA:\s*/, '') + '.';
  const kode = Object.keys(EPOST_FEILTEKSTER).find(k => m.includes(k));
  return kode ? EPOST_FEILTEKSTER[kode] : 'Noe gikk galt. Sjekk nettforbindelsen og prøv igjen.';
}

function epostBekreftBannerHTML(o) {
  if (!o || !o.epostBestillingId || o.epostBekreftetAt || o.status !== 'aktiv') return '';
  const opprettet = (o.endringer || []).find(e => e && e.av === 'E-post');
  const idJs = esc(o.id).replace(/'/g, "\\'");
  return `<div id="epostBanner_${esc(o.id)}" style="background:#1c1008;border:1px solid #b45309;border-radius:10px;padding:12px 14px;margin-bottom:10px;font-size:13px">
    <div style="font-weight:700;color:#fbbf24;margin-bottom:4px">Bestilt på e-post - ikke bekreftet</div>
    ${opprettet ? `<div class="small" style="color:#a1a1aa;margin-bottom:4px">${esc(opprettet.txt || '')}</div>` : ''}
    <div style="color:#e4e4e7;margin-bottom:8px">Sjekk at chassis.nr og «Skal på bilen» stemmer med bestillingen, og trykk Bekreft. Fakturalinjene kommer når den er bekreftet.${me?.rolle === 'admin' ? ' Er bestillingen feil, slett ordren.' : ' Er bestillingen feil, si fra til en administrator.'}</div>
    <button id="epostBekreftBtn_${esc(o.id)}" class="btn sm" onclick="epostBekreftOrdre('${idJs}')" style="background:rgba(34,197,94,.15);border-color:#22c55e;color:#86efac;font-weight:700">Bekreft bestilling</button>
  </div>`;
}

let _epostBekreftPagar = false;
async function epostBekreftOrdre(id) {
  const o = S.ordrer.find(x => x.id === id);
  if (!o || !db || _epostBekreftPagar) return;
  _epostBekreftPagar = true;
  const knapp = document.getElementById('epostBekreftBtn_' + id); if (knapp) knapp.disabled = true;
  ignorerRealtimeFor.add(id);
  setTimeout(() => ignorerRealtimeFor.delete(id), 10000);
  try {
    const { data, error } = await db.rpc('epost_bekreft_ordre', { p_ordre_id: id });
    if (error) { ignorerRealtimeFor.delete(id); console.warn('Bekreft e-postordre feilet:', error.message); visToast(epostFeilTekst(error), 'feil'); return; }
    o.epostBekreftetAt = data?.epost_bekreftet_at || new Date().toISOString();
    o.epostBekreftetAv = data?.epost_bekreftet_av || me?.navn || '';
    if (Array.isArray(data?.endringer)) o.endringer = data.endringer;
    visToast(data?.kode === 'ok' ? 'Bestillingen er bekreftet' : 'Bestillingen var allerede bekreftet', 'ok');
    // Ordren ble laget i databasen, så utstyrsmalen velges nå (som for en portalordre), og deretter fakturalinjene for e-postlinjene. Etter hverandre:
    // begge skriver fakturalinjer på samme ordre.
    if (typeof autoVelgUtstyrMal === 'function') await autoVelgUtstyrMal(id);
    if (typeof synkProduktliste === 'function') await synkProduktliste(o);
    planleggRenderAll();
    if (activeOrdreId === id) buildOrdreDetail();
  } catch (e) {
    ignorerRealtimeFor.delete(id);
    console.error('Bekreft e-postordre feilet:', e);
    visToast('Noe gikk galt. Sjekk nettforbindelsen og prøv igjen.', 'feil');
  } finally {
    _epostBekreftPagar = false;
    const k = document.getElementById('epostBekreftBtn_' + id); if (k) k.disabled = false;
  }
}

// ── Innkommende (Oversikt, bare admin) ─────────────────────────────────────────────────────────────────────────────
let _epostInnkommendeHentet = 0;
let _epostInnkommendeHenter = false;
const _epostInnkommendeIGang = new Set();

async function hentInnkommendeEpost(tving = false) {
  if (!db || !me || me.rolle !== 'admin' || _epostInnkommendeHenter) return;
  if (!tving && Date.now() - _epostInnkommendeHentet < 60000) return;
  _epostInnkommendeHenter = true;
  try {
    const { data, error } = await db.from('epost_bestillinger').select('id, rad, mottatt_at, avsender, kontakt_id, kontakt_navn, selger_navn, chassis, chassis_raa, modell_slug, grunn_tekst, tilvalg_tekst, linjer, grunner')
      .eq('status', 'innkommende').order('mottatt_at', { ascending: true }).order('rad', { ascending: true }).limit(100);
    // Tabellen finnes ikke før migrasjonen er kjørt: da vises kortet bare ikke.
    if (error) { S.epostInnkommende = []; return; }
    S.epostInnkommende = data || [];
    _epostInnkommendeHentet = Date.now();
  } finally { _epostInnkommendeHenter = false; }
  renderInnkommendeEpost(false);
}

function epostAktiveOrdrerMedChassis(chassis) {
  if (!chassis) return [];
  return (S.ordrer || []).filter(o => o.status === 'aktiv' && !(typeof erLeveranse === 'function' && erLeveranse(o)) && samsvarerChassis(o.chassis, chassis));
}

function innkommendeEpostRadHTML(r) {
  const idJs = esc(r.id).replace(/'/g, "\\'");
  const iGang = _epostInnkommendeIGang.has(r.id);
  const ordrer = epostAktiveOrdrerMedChassis(r.chassis);
  const linjer = Array.isArray(r.linjer) ? r.linjer : [];
  const grunner = Array.isArray(r.grunner) ? r.grunner : [];
  const mottatt = r.mottatt_at ? new Date(r.mottatt_at).toLocaleString('no-NO', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const knapper = [];
  if (ordrer.length === 1 && linjer.length) knapper.push(`<button class="btn sm red" ${iGang ? 'disabled' : ''} onclick="innkommendeLeggPaa('${idJs}','${esc(ordrer[0].id).replace(/'/g, "\\'")}')">Legg på ${ordreLabel(ordrer[0])}</button>`);
  if (ordrer.length === 1) knapper.push(`<button class="btn sm" onclick="openOrdre('${esc(ordrer[0].id).replace(/'/g, "\\'")}',false,true)">Åpne ordren</button>`);
  if (!ordrer.length && r.chassis && r.kontakt_id && linjer.length) knapper.push(`<button class="btn sm red" ${iGang ? 'disabled' : ''} onclick="innkommendeLagOrdre('${idJs}')">Lag ny ordre</button>`);
  knapper.push(`<button class="btn sm" ${iGang ? 'disabled' : ''} onclick="innkommendeAvvis('${idJs}')">Avvis</button>`);
  return `<div style="background:#0f0f12;border:1px solid #27272a;border-radius:10px;padding:10px 12px;display:grid;gap:6px">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <b style="font-family:ui-monospace,monospace">${esc(r.chassis || r.chassis_raa || 'Uten chassis.nr')}</b>
      <span class="small muted">Rad ${esc(String(r.rad))} · ${esc(mottatt)}</span>
    </div>
    <div class="small muted">${esc(r.kontakt_navn || 'Ukjent forhandler')}${r.selger_navn ? ' · ' + esc(r.selger_navn) : ''}${r.avsender ? ' · ' + esc(r.avsender) : ''}</div>
    ${r.grunn_tekst ? `<div class="small">${esc(r.grunn_tekst)}</div>` : ''}
    ${linjer.length ? `<div class="small" style="color:#e4e4e7">${linjer.map(l => `<span style="font-family:ui-monospace,monospace;color:#a1a1aa">${esc(l.produktnummer)}</span> ${esc(l.navn)}${l.antall > 1 ? ' × ' + esc(String(l.antall)) : ''}`).join('<br>')}</div>` : ''}
    ${r.tilvalg_tekst ? `<div class="small muted">Tilvalg i e-posten: ${esc(r.tilvalg_tekst)}</div>` : ''}
    <div class="small" style="color:#fde68a">${grunner.map(g => '⚠ ' + esc(g)).join('<br>') || '⚠ Ikke lagt på automatisk'}</div>
    ${ordrer.length > 1 ? `<div class="small" style="color:#fca5a5">${ordrer.length} aktive ordrer har dette chassis.nr. Rydd opp først.</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">${knapper.join('')}</div>
  </div>`;
}

// Flyttet fra en egen kort på Oversikt til en knapp med tall-badge på Ordre-siden (Henrik
// 18.11, samme mønster som «Til godkjenning» - se apneTilGodkjenningModal i arkiv-mer.js):
// kortet ("innkommendeEpostKort") ligger nå inni modalen, knappen/badgen er nytt.
function renderInnkommendeEpost(hent = true) {
  const kort = document.getElementById('innkommendeEpostKort');
  const liste = document.getElementById('innkommendeEpostListe');
  const btn = document.getElementById('innkommendeEpostBtn');
  const badge = document.getElementById('innkommendeEpostBadge');
  if (!kort || !liste) return;
  const erAdmin = me && me.rolle === 'admin';
  if (!erAdmin) { kort.style.display = 'none'; if (btn) btn.style.display = 'none'; return; }
  if (hent) hentInnkommendeEpost();
  const rader = Array.isArray(S.epostInnkommende) ? S.epostInnkommende : [];
  kort.style.display = rader.length ? 'block' : 'none';
  if (btn) btn.style.display = 'inline-flex';
  if (badge) { badge.style.display = rader.length ? 'flex' : 'none'; badge.textContent = rader.length; }
  if (!rader.length) return;
  try {
    liste.innerHTML = rader.map(r => { try { return innkommendeEpostRadHTML(r); } catch (e) { console.error('Innkommende-rad feilet:', e && e.message); return ''; } }).join('');
  } catch (e) { console.error('renderInnkommendeEpost feilet:', e && e.message); kort.style.display = 'none'; }
}

// Innholdet holdes ferskt av renderOversikt()/renderAll() (kjøres uansett hvilken side som er
// åpen) - denne trenger bare å åpne modalen, som apneTilGodkjenningModal().
function apneInnkommendeEpostModal() {
  openModal('innkommendeEpostModal');
}

async function innkommendeHandling(id, rpc, args, bekreftTekst, okTekst) {
  if (!db || _epostInnkommendeIGang.has(id)) return;
  if (bekreftTekst && !confirm(bekreftTekst)) return;
  _epostInnkommendeIGang.add(id);
  renderInnkommendeEpost(false);
  try {
    const { data, error } = await db.rpc(rpc, args);
    if (error) { console.warn(rpc + ' feilet:', error.message); visToast(epostFeilTekst(error), 'feil'); return; }
    visToast(okTekst, 'ok');
    S.epostInnkommende = (S.epostInnkommende || []).filter(r => r.id !== id);
    // Ordren (ny eller endret) kommer inn via Realtime som andre endringer fra databasen.
    return data;
  } catch (e) {
    console.error(rpc + ' feilet:', e);
    visToast('Noe gikk galt. Sjekk nettforbindelsen og prøv igjen.', 'feil');
  } finally {
    _epostInnkommendeIGang.delete(id);
    renderInnkommendeEpost(false);
    hentInnkommendeEpost(true);
  }
}

function innkommendeLeggPaa(id, ordreId) {
  const r = (S.epostInnkommende || []).find(x => x.id === id); const o = S.ordrer.find(x => x.id === ordreId);
  if (!r || !o) return;
  const linjer = (r.linjer || []).map(l => `${l.produktnummer} ${l.navn}${l.antall > 1 ? ' × ' + l.antall : ''}`).join('\n');
  return innkommendeHandling(id, 'epost_bestilling_legg_paa', { p_id: id, p_ordre_id: ordreId },
    `Legge bestillingen på ${ordreLabel(o)} (${o.kunde || 'ingen kunde'})?\n\n${linjer}\n\nProdukter som mangler, legger du til med «+ Legg til utstyr» på ordren.`, 'Lagt på ordren');
}
function innkommendeLagOrdre(id) {
  const r = (S.epostInnkommende || []).find(x => x.id === id); if (!r) return;
  return innkommendeHandling(id, 'epost_bestilling_lag_ordre', { p_id: id },
    `Lage en ny ordre «På vei» for ${r.chassis} (${r.kontakt_navn || ''})?\n\nDen står som ikke bekreftet til noen trykker Bekreft.`, 'Ny ordre laget');
}
function innkommendeAvvis(id) {
  const r = (S.epostInnkommende || []).find(x => x.id === id); if (!r) return;
  return innkommendeHandling(id, 'epost_bestilling_avvis', { p_id: id }, `Avvise raden for ${r.chassis || r.chassis_raa || 'ukjent chassis'}?\n\nIngenting legges på noen ordre.`, 'Avvist');
}
