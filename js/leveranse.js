// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LEVERANSE: en ordre UTEN bil, for å sende av gårde løsninger (Henrik 2026-11-02/03).
// Lagres i ordrer med ordretype = 'leveranse' (bil-ordrer har 'bil'), så fiken_linjer, timer, lagerbruk, dokumenter, logg, Realtime og
// offline-køen er de samme som for en bil-ordre. Egne felt ligger i jsonb-kolonnen `leveranse` (normaliserLeveranse() i core.js);
// frakt_bestilt_at/av/til settes bare av edge-funksjonen send-frakt-epost og leses her (fraktBestiltAt/Av/Til).
//
// Statusløype: Under arbeid -> Klar til sending (fraktbestillingen går ut på e-post av seg selv, hvis ikke slått av) -> Sendt.
// «Fakturert» er den vanlige fakturert-markeringen (Fiken-kladd). En leveranse som er sendt OG fakturert arkiveres automatisk.
// Identifikasjon: chassis.nr, reg.nr ELLER annen merking (minst ett kreves, samme regel som «Ny ordre»).
// Ingen tvangsflyt, biltilsyn, vekter, bilder, ombygging eller godkjenning (tvangsflyt() gir [] for en leveranse).
// Laster ETTER admin-ark.js (bruker FRAKTSELSKAP_*-konstantene og adminArkFinnKontaktEpost).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const LEVERANSE_FARGE = '#22d3ee';

function leveranseBadgeHTML() {
  return `<span style="display:inline-block;background:#08333c;color:#a5f3fc;border:1px solid ${LEVERANSE_FARGE};border-radius:999px;padding:1px 8px;font-size:9.5px;font-weight:800;letter-spacing:.08em">LEVERANSE</span>`;
}
// 'YYYY-MM-DD' -> 'DD.MM.YYYY' (alt annet gir tom streng)
function leveranseDato(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : ''; }
function leveranseTidspunkt(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} kl. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function leveranseIdag() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// ─── Kalender ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// En ny leveranse legges i verkstedkalenderen (Oversikt) automatisk, den dagen og det klokkeslettet den opprettes (Henrik 2026-11-03).
// Ukekalenderen viser bare mandag-fredag, 07:30-16:00 (siste rute 15:30), så utenfor det plasseres den på nærmeste synlige tidspunkt:
// før 07:30 -> 07:30 samme dag, etter 15:30 -> 15:30 samme dag, lørdag/søndag -> mandag 07:30. Lokal tid (som veggklokka), aldri UTC.
const LEVERANSE_KAL_FRA = 7 * 60 + 30, LEVERANSE_KAL_TIL = 15 * 60 + 30;
function leveranseKalenderTidspunkt(naa) {
  const d = naa && typeof naa.getTime === 'function' && !isNaN(naa.getTime()) ? new Date(naa.getTime()) : new Date();
  let min = d.getHours() * 60 + d.getMinutes();
  const ukedag = d.getDay(); // 0 = søndag, 6 = lørdag
  if (ukedag === 6 || ukedag === 0) { d.setDate(d.getDate() + (ukedag === 6 ? 2 : 1)); min = LEVERANSE_KAL_FRA; }
  min = Math.min(Math.max(min, LEVERANSE_KAL_FRA), LEVERANSE_KAL_TIL);
  const pad = n => String(n).padStart(2, '0');
  return { dato: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, tid: `${pad(Math.floor(min / 60))}:${pad(min % 60)}` };
}
// Setter eller fjerner kalendertidspunktet på en leveranse med en MÅLRETTET skriving av bare de to kalenderkolonnene (aldri full save(): en gammel kopi kan ikke overskrive
// status/frakt som en kollega nettopp endret). Rører aldri Admin-ark eller «Time på biltilsynet» (de gjelder biler, og en leveranse kan ha samme chassis.nr som en bil).
// Lokal verdi settes straks (visningen følger med). Skrivingene for SAMME ordre går etter hverandre i den rekkefølgen de ble bedt om (to raske flyttinger kan ikke havne i feil rekkefølge),
// og feiler en skriving, rulles den lokale verdien tilbake til den SIST LAGREDE bare hvis dette fortsatt er det siste kallet (en nyere flytting overstyres aldri av en eldre som feiler).
// Logglinjen skrives først når skrivingen har lykkes. Returnerer true hvis lagret.
const _kalenderSkriving = {}; // ordre-id -> { lop: siste løfte i køen, nr: løpenummer, ventende: antall under arbeid, bekreftet: sist lagrede {dato, tid} }
async function leveranseSettKalender(o, dato, tid, loggTekst) {
  const ny = { dato: dato || '', tid: dato ? (tid || '09:00') : '' };
  const st = _kalenderSkriving[o.id] || (_kalenderSkriving[o.id] = { lop: Promise.resolve(), nr: 0, ventende: 0, bekreftet: null });
  if (!st.ventende) st.bekreftet = { dato: o.kalenderDato || '', tid: o.kalenderTid || '' }; // ingen skriving på gang: det som står nå er det som er lagret (også etter en kollegas Realtime-endring)
  const nr = ++st.nr; st.ventende++;
  o.kalenderDato = ny.dato; o.kalenderTid = ny.tid;
  ignorerRealtimeFor.add(o.id);
  setTimeout(() => ignorerRealtimeFor.delete(o.id), 10000);
  const dette = st.lop.then(async () => {
    try {
      if (db) {
        const { error } = await db.from('ordrer').update({ kalender_dato: ny.dato || null, kalender_tid: ny.tid }).eq('id', o.id);
        if (error) {
          if (st.nr === nr) { o.kalenderDato = st.bekreftet.dato; o.kalenderTid = st.bekreftet.tid; }
          visToast('Kunne ikke lagre kalendertiden: ' + error.message + ' - prøv igjen.');
          return false;
        }
      }
      st.bekreftet = ny;
      logChange(o, loggTekst);
      return true;
    } finally { st.ventende--; }
  });
  st.lop = dette.catch(() => {});
  return dette;
}
// Kalenderen viser bare mandag-fredag og 07:30-15:30: en dato/tid utenfor det ville stått som «I kalenderen» uten å synes noe sted. Tom tid er lov (blir 09:00). Returnerer en beskjed, eller '' hvis OK.
function leveranseKalenderUgyldig(dato, tid) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dato || ''));
  if (!m) return 'Velg en dato';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1) return 'Velg en gyldig dato';
  if (d.getDay() === 0 || d.getDay() === 6) return 'Kalenderen viser bare mandag til fredag. Velg en ukedag.';
  const k = /^(\d{2}):(\d{2})$/.exec(String(tid || ''));
  if (!k) return '';
  const min = +k[1] * 60 + +k[2];
  if (min < LEVERANSE_KAL_FRA || min > LEVERANSE_KAL_TIL) return 'Kalenderen går fra 07:30 til 15:30. Velg et klokkeslett i det området.';
  return '';
}
// Åpner Flytt-vinduet (dato og klokkeslett) for en leveranse, forhåndsutfylt med nåværende kalendertid, ellers med tidspunktet en ny leveranse ville fått nå.
function leveranseApneKalenderValg(id) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  const forslag = leveranseKalenderTidspunkt(new Date());
  flyttOrdreId = id;
  document.getElementById('fl_dato').value = o.kalenderDato || forslag.dato;
  document.getElementById('fl_tid').value = o.kalenderTid || forslag.tid;
  openModal('flytt');
}
// Kalenderraden øverst i leveranse-detaljen: når den står i kalenderen (med Flytt/Fjern), eller en knapp for å legge den inn.
function leveranseKalenderRadHTML(o) {
  const knapp = (txt, fn) => `<button class="btn sm" style="padding:3px 9px;font-size:11px" onclick="${fn}('${o.id}')">${txt}</button>`;
  return `<div class="small" style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${o.kalenderDato
    ? `<span>📅 I kalenderen <b>${esc(leveranseKalenderTekst(o))}</b></span>${knapp('Flytt', 'leveranseApneKalenderValg')}${knapp('Fjern', 'fjernFraKalender')}`
    : `<span class="muted">Ikke i kalenderen</span>${knapp('Legg i kalenderen', 'leveranseApneKalenderValg')}`}</div>`;
}
function leveranseKalenderTekst(o) { return o.kalenderDato ? `${leveranseDato(o.kalenderDato) || o.kalenderDato} kl. ${o.kalenderTid || '09:00'}` : ''; }

// Fraktselskapene en leveranse kan sendes med: de i Kontakter (type Fraktselskap), pluss «Hente selv» og «Levering av oss» som i Admin-arket.
function leveranseFraktselskapValg() {
  const navn = (S.kontakter || []).filter(k => k.type === 'Fraktselskap').map(k => k.navn).filter(Boolean);
  return [...new Set([...navn, FRAKTSELSKAP_HENTE_SELV, FRAKTSELSKAP_LEVERING_AV_OSS])];
}
function leveranseErEkteFraktselskap(navn) { return !!navn && navn !== FRAKTSELSKAP_HENTE_SELV && navn !== FRAKTSELSKAP_LEVERING_AV_OSS; }

// Det som mangler for at en fraktbestilling på e-post kan sendes (tom liste = klar). Samme krav sjekkes på nytt av serveren.
function leveranseFraktMangler(o) {
  const l = o.leveranse || {}; const mangler = [];
  if (!leveranseErEkteFraktselskap(l.fraktselskap)) { mangler.push(l.fraktselskap ? 'et fraktselskap å bestille hos (' + l.fraktselskap + ' bestilles ikke på e-post)' : 'fraktselskap'); return mangler; }
  if (!adminArkFinnKontaktEpost(l.fraktselskap, 'Fraktselskap')) mangler.push('e-post for ' + l.fraktselskap + ' i Kontakter');
  if (!l.adresse.trim()) mangler.push('leveringsadresse');
  if (!l.postnr.trim() && !l.sted.trim()) mangler.push('postnr/sted');
  if (!o.kunde || !o.kunde.trim()) mangler.push('kunde');
  return mangler;
}
// Det som må være på plass FØR statusen kan settes til «Klar til sending». Er automatisk bestilling slått av, kreves ingenting.
function leveranseKlarMangler(o) {
  if (!o.leveranse.fraktAuto) return [];
  if (o.leveranse.fraktselskap === FRAKTSELSKAP_HENTE_SELV || o.leveranse.fraktselskap === FRAKTSELSKAP_LEVERING_AV_OSS) return [];
  return leveranseFraktMangler(o);
}
// Tekst som står som Ordrereferanse i Fiken-fakturaen: merking, reg.nr og chassis (de som er fylt ut), adskilt med « - ».
function leveranseFakturaReferanse(o) {
  const deler = [(o.leveranse && o.leveranse.merking || '').trim(), (o.regnr || '').trim(), (o.chassis || '').trim()].filter(Boolean);
  return [...new Set(deler)].join(' - ').slice(0, 100);
}
// En leveranse som er sendt OG fakturert er ferdig: arkiveres automatisk. Returnerer true hvis den nettopp ble arkivert.
function leveranseSjekkArkiver(o) {
  if (!erLeveranse(o) || o.status !== 'aktiv' || o.ordreStatus !== 'sendt' || !o.fakturert) return false;
  o.status = 'arkivert';
  logChange(o, 'Arkivert automatisk (sendt og fakturert)');
  return true;
}

// ─── Ny leveranse ───────────────────────────────────────────────────────────────────────────────────────────────────────
const LEV_FELT_NY = ['lev_kunde', 'lev_eier', 'lev_merking', 'lev_regnr', 'lev_chassis', 'lev_adresse', 'lev_postnr', 'lev_sted', 'lev_tlf', 'lev_kolli', 'lev_hentedato', 'lev_pakker', 'lev_vekt', 'lev_lengde', 'lev_bredde', 'lev_hoyde', 'lev_fraktpris'];
// Én pakke-rad (fem felt med EGEN overskrift: antall, vekt kg, L/B/H cm, og en valgfri fjern-knapp), brukt både i detaljen og i «Ny leveranse». `attr(felt)` gir hendelsesattributtene
// (onchange/oninput) for feltet. På smal skjerm bryter raden til to linjer (CSS .pakke-rad i salmakern.html): antall og vekt øverst, L/B/H under, så verdier som «12,5» ikke kuttes.
function pakkeRadHTML(p, attr, fjernHTML) {
  const felt = (k, txt, tittel) => `<label class="pakke-felt"><span>${txt}</span><input type="number" min="${k === 'antall' ? 1 : 0}" step="${k === 'antall' ? 1 : 0.1}" inputmode="${k === 'antall' ? 'numeric' : 'decimal'}" value="${p[k] === '' || p[k] == null ? '' : esc(String(p[k]))}" title="${tittel}" ${attr(k)} style="min-width:0"></label>`;
  return `<div class="pakke-rad">${felt('antall', 'Antall', 'Antall pakker av denne typen')}${felt('vekt', 'Vekt kg', 'Vekt per pakke (kg)')}${felt('lengde', 'L cm', 'Lengde (cm)')}${felt('bredde', 'B cm', 'Bredde (cm)')}${felt('hoyde', 'H cm', 'Høyde (cm)')}<div class="pakke-fjern">${fjernHTML || ''}</div></div>`;
}
// Flere pakker i «Ny leveranse»: pakke 1 er feltene lev_pakker/lev_vekt/lev_lengde/lev_bredde/lev_hoyde i skjemaet, og pakkene fra «+ Legg til pakke» ligger i denne lista
// (oppdateres mens man skriver, uten å tegne radene på nytt, så feltet man står i beholder fokus).
let levNyePakker = [];
const LEV_PAKKE_FELT = ['antall', 'vekt', 'lengde', 'bredde', 'hoyde'];
function levNyPakkeRadHTML(p, i) {
  return pakkeRadHTML(p, k => `oninput="settNyPakke(${i},'${k}',this.value)"`, `<button type="button" class="btn sm" onclick="fjernNyPakke(${i})" title="Fjern pakke">✕</button>`);
}
function renderNyePakker() {
  const el = document.getElementById('lev_ekstra_pakker'); if (!el) return;
  el.innerHTML = levNyePakker.length ? `<div style="margin-top:10px">${levNyePakker.map(levNyPakkeRadHTML).join('')}</div>` : '';
}
function leggTilNyPakke() {
  if (1 + levNyePakker.length >= LEVERANSE_MAKS_PAKKER) { visToast('Maks ' + LEVERANSE_MAKS_PAKKER + ' pakker per leveranse'); return; }
  // Som i detaljen: en ny pakke starter som en kopi av forrige (de er ofte like). Første «ekstra» pakke kopierer pakke 1 i skjemaet.
  const v = id => (document.getElementById(id)?.value || '').trim();
  const forrige = levNyePakker.length ? levNyePakker[levNyePakker.length - 1]
    : { antall: v('lev_pakker'), vekt: v('lev_vekt'), lengde: v('lev_lengde'), bredde: v('lev_bredde'), hoyde: v('lev_hoyde') };
  levNyePakker.push({ ...forrige });
  renderNyePakker();
}
function settNyPakke(i, felt, val) { if (levNyePakker[i] && LEV_PAKKE_FELT.includes(felt)) levNyePakker[i][felt] = val; }
function fjernNyPakke(i) { levNyePakker.splice(i, 1); renderNyePakker(); }
// Pakkene fra skjemaet: pakke 1 (feltene) og de ekstra radene, bare de som har fått en verdi. Tom liste hvis ingen er fylt ut.
function levNyePakkerFraSkjema() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const rader = [{ antall: v('lev_pakker'), vekt: v('lev_vekt'), lengde: v('lev_lengde'), bredde: v('lev_bredde'), hoyde: v('lev_hoyde') }, ...levNyePakker];
  return rader.filter(p => LEV_PAKKE_FELT.some(k => String(p[k] == null ? '' : p[k]).trim() !== '')).map(p => ({ ...p, antall: String(p.antall == null ? '' : p.antall).trim() || 1 }));
}
function apneNyLeveranseModal() {
  levNyePakker = []; renderNyePakker();
  LEV_FELT_NY.forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  const sel = document.getElementById('lev_fraktselskap');
  if (sel) sel.innerHTML = '<option value="">Velg fraktselskap (kan velges senere)</option>' + leveranseFraktselskapValg().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const auto = document.getElementById('lev_fraktauto'); if (auto) auto.checked = true;
  const tel = document.getElementById('lev_chassis_tel'); if (tel) tel.textContent = '0/17';
  openModal('nyLeveranse');
}
function opprettLeveranse() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const kunde = v('lev_kunde'), eier = v('lev_eier'), merking = v('lev_merking');
  const regnr = v('lev_regnr').toUpperCase().replace(/[^A-Z0-9]/g, ''), chassis = v('lev_chassis').toUpperCase();
  if (!merking && !regnr && !chassis) { alert('Fyll inn minst ett av merking, reg.nr eller chassis-nr, så leveransen kan kjennes igjen.'); return; }
  if (chassis && chassis.length !== 17) { alert(`Chassis-nr må være nøyaktig 17 tegn (er nå ${chassis.length}).`); return; }
  if (!kunde) { alert('Fyll inn kunde/forhandler (trengs for å fakturere).'); return; }
  // Samme merking/chassis på en annen AKTIV leveranse er trolig en dublett (en bil-ordre på samme chassis er helt i orden: løsningen kan høre til en bil vi har).
  const dublett = S.ordrer.find(o => erLeveranse(o) && o.status === 'aktiv' && (
    (chassis && samsvarerChassis(o.chassis, chassis)) || (merking && (o.leveranse.merking || '').toLowerCase() === merking.toLowerCase())));
  if (dublett && !confirm(`Det finnes allerede en aktiv leveranse som ligner (${leveranseTittel(dublett)}). Opprette en ny likevel?`)) return;

  const id = 'ord_' + Date.now();
  const ny = mkOrdre(id, regnr, kunde, eier, '', '', '', '', '', '', '', 'under_arbeid');
  ny.ordretype = 'leveranse';
  ny.chassis = chassis;
  ny.leveranse = normaliserLeveranse({
    merking, adresse: v('lev_adresse'), postnr: v('lev_postnr'), sted: v('lev_sted'), kontaktTlf: v('lev_tlf'),
    fraktselskap: v('lev_fraktselskap'), kolli: v('lev_kolli'), onsketHentedato: v('lev_hentedato'),
    fraktAuto: !!document.getElementById('lev_fraktauto')?.checked,
    // Pakkene fra skjemaet (pakke 1 og ekstra rader), bare de som er fylt ut; flere kan legges til i detaljen. fraktPris = det kunden skal belastes (kr eks. mva).
    kolliListe: levNyePakkerFraSkjema(),
    fraktPris: v('lev_fraktpris'),
  });
  // Legges i verkstedkalenderen den dagen og det klokkeslettet den opprettes (se leveranseKalenderTidspunkt).
  const kal = leveranseKalenderTidspunkt(new Date());
  ny.kalenderDato = kal.dato; ny.kalenderTid = kal.tid;
  ny._localAt = Date.now();
  S.ordrer.push(ny);
  if (db) db.from('ordrer').insert(ordreToDb(ny)).then(r => { if (r.error) { console.error('Kunne ikke opprette leveransen:', r.error.message); visToast('Kunne ikke lagre leveransen: ' + r.error.message); } });
  edgeFetch('send-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ny_ordre', ordreId: id, bil: 'Leveranse: ' + leveranseTittel(ny), ansattNavn: me?.navn || '?' })
  }, { stille: true }).catch(e => console.warn('Ny leveranse-varsel feilet:', e));
  planleggLocalSpeiling();
  closeModal('nyLeveranse'); renderAll();
  openOrdre(id);
}

// ─── Status ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function endreLeveranseStatus(id, nyStatus) {
  const o = S.ordrer.find(x => x.id === id); if (!o) return;
  if (document.activeElement?.tagName === 'SELECT') document.activeElement.blur();
  if (!LEVERANSE_STATUSER.some(s => s.id === nyStatus) || nyStatus === o.ordreStatus) { renderAll(); if (activeOrdreId === id) buildOrdreDetail(); return; }
  if (nyStatus === 'klar_sending') {
    const mangler = leveranseKlarMangler(o);
    if (mangler.length) {
      visToast('Før den kan settes til «Klar til sending» mangler: ' + mangler.join(', ') + '. (Eller slå av automatisk fraktbestilling.)');
      renderAll(); if (activeOrdreId === id) buildOrdreDetail(); return;
    }
  }
  const forrige = { ordreStatus: o.ordreStatus, status: o.status, sendtDato: o.leveranse.sendtDato };
  o.ordreStatus = nyStatus;
  if (nyStatus === 'sendt' && !o.leveranse.sendtDato) o.leveranse.sendtDato = leveranseIdag();
  const arkivert = leveranseSjekkArkiver(o);
  logChange(o, 'Status endret til: ' + statusInfo(nyStatus).lbl + (arkivert ? ' (arkivert automatisk)' : ''));
  planleggLocalSpeiling();
  // Målrettet skriving (ikke full save()) som for bil-ordrer: statusen kan ikke overskrives av en gammel kopi, og Realtime-ekkoet ignoreres.
  ignorerRealtimeFor.add(id);
  setTimeout(() => ignorerRealtimeFor.delete(id), 10000);
  let feil = null;
  if (db) {
    const { error } = await db.from('ordrer').update({ ordre_status: o.ordreStatus, status: o.status, leveranse: o.leveranse }).eq('id', id);
    if (error) feil = error.message;
  }
  if (feil) {
    o.ordreStatus = forrige.ordreStatus; o.status = forrige.status; o.leveranse.sendtDato = forrige.sendtDato;
    visToast('Kunne ikke endre status: ' + feil + ' - prøv igjen.');
    renderAll(); if (activeOrdreId === id) buildOrdreDetail(); return;
  }
  // Arbeidsklokka følger statusen, som for bil-ordrer (oppdater_ordre_timer_fase): forlater leveransen «Under arbeid», stoppes alle åpne klokker og de påmeldte meldes av;
  // kommer den tilbake til «Under arbeid», startes klokka for de som er meldt på. Uten dette ville klokka gått videre etter «Sendt».
  if (db) {
    const varIFase = forrige.ordreStatus === 'under_arbeid';
    const erIFase = ordreAktivFase(o) === 'ordreTimerSessions';
    const handling = varIFase && !erIFase ? 'avslutt_fase' : (!varIFase && erIFase ? 'start_alle_paameldte' : null);
    if (handling) {
      const { data, error } = await db.rpc('oppdater_ordre_timer_fase', { p_ordre_id: id, p_felt: feltTilKolonne('ordreTimerSessions'), p_handling: handling });
      if (error) console.error('Kunne ikke oppdatere arbeidsklokka (' + handling + '):', error.message);
      else if (data) {
        o.ordreTimerSessions = data.sessions ?? o.ordreTimerSessions;
        if (handling === 'avslutt_fase') o.ansatteSignert = data.ansatteSignert ?? o.ansatteSignert;
      }
    }
  }
  renderAll();
  if (activeOrdreId === id) { if (arkivert) tilbakeOrdreList(); else buildOrdreDetail(); }
  // «Klar til sending»: fraktbestillingen går ut av seg selv (hvis ikke slått av per leveranse). Serveren sender aldri samme bestilling to ganger.
  if (nyStatus === 'klar_sending' && o.leveranse.fraktAuto && leveranseErEkteFraktselskap(o.leveranse.fraktselskap) && !o.fraktBestiltAt) {
    await bestillFraktForLeveranse(id, {});
  }
}

// ─── Frakt ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Sender fraktbestillingen på e-post via send-frakt-epost (type leveranse_bestilling). Serveren leser leveransen selv, finner fraktselskapets
// e-post i Kontakter, og «claimer» bestillingen atomisk (frakt_bestilt_at) før den sender: samme bestilling går aldri ut to ganger, og feiler
// sendingen frigis den igjen. paaNytt (bare admin) sender en ny bestilling selv om en allerede er sendt.
async function bestillFraktForLeveranse(id, { paaNytt = false } = {}) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return 'feil';
  const mangler = leveranseFraktMangler(o);
  if (mangler.length) { visToast('Kan ikke bestille frakt ennå. Mangler: ' + mangler.join(', ')); return 'mangler'; }
  const knapp = document.getElementById('leveranseFraktKnapp_' + id);
  if (knapp) { knapp.disabled = true; knapp.textContent = 'Sender bestilling...'; }
  try {
    const kontaktEpost = adminArkFinnKontaktEpost(o.eier);
    const res = await edgeFetch('send-frakt-epost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'leveranse_bestilling', ordreId: id, kontaktpersonEpost: kontaktEpost || undefined, avsenderNavn: me?.navn, paaNytt })
    });
    const tekst = await res.text();
    if (res.status === 409) {
      visToast('Fraktbestillingen er allerede sendt for denne leveransen.', 'ok');
      return 'allerede';
    }
    if (!res.ok) throw new Error(tekst || ('Feil ' + res.status));
    let data = {}; try { data = JSON.parse(tekst); } catch (_) { /* ok-svar uten JSON */ }
    o.fraktBestiltAt = data.bestiltAt || new Date().toISOString();
    o.fraktBestiltAv = me?.navn || '';
    o.fraktBestiltTil = data.til || o.leveranse.fraktselskap;
    logChange(o, 'Fraktbestilling sendt til ' + o.leveranse.fraktselskap + (paaNytt ? ' (på nytt)' : ''));
    planleggLocalSpeiling();
    visToast('Fraktbestilling sendt til ' + o.leveranse.fraktselskap, 'ok');
    return 'ok';
  } catch (e) {
    visToast('Kunne ikke sende fraktbestillingen: ' + e.message + ' - den er ikke sendt. Prøv «Bestill frakt nå».');
    return 'feil';
  } finally {
    if (activeOrdreId === id) buildOrdreDetail();
  }
}

// Felt i leveransens egen jsonb. Skrives med full save() som resten av ordren (ordreToDb tar med leveranse bare for leveranser).
function sfLev(id, felt, val) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  if (felt === 'fraktAuto') val = !!val;
  else if (typeof val === 'string') val = val.trim();
  o.leveranse = normaliserLeveranse({ ...o.leveranse, [felt]: val });
  logChange(o, 'Leveranse: ' + felt + ' oppdatert');
  save(id);
  if (['fraktselskap', 'adresse', 'postnr', 'sted', 'fraktAuto', 'sendtDato'].includes(felt) && activeOrdreId === id) buildOrdreDetail();
}

// ─── Oversikt ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// «Leveranser»-kortet nederst på Oversikt: alle AKTIVE leveranser gruppert etter status (en sendt og fakturert leveranse er arkivert og vises i Arkiv). En leveranse med en
// status vi ikke kjenner (f.eks. en feilregistrert rad) havner i «Under arbeid», så ingen leveranse kan bli usynlig. Hvert kort tegnes for seg (try/catch), som i Ordre-lista.
const LEVERANSE_OVERSIKT_GRUPPER = [
  { id: 'under_arbeid', tittel: 'Under arbeid', farge: '#22d3ee' },
  { id: 'klar_sending', tittel: 'Klar til sending', farge: '#a3e635' },
  { id: 'sendt', tittel: 'Sendt, venter på fakturering', farge: '#2dd4bf' },
];
function leveranseOversiktGruppe(o) {
  return o.ordreStatus === 'klar_sending' || o.ordreStatus === 'sendt' ? o.ordreStatus : 'under_arbeid';
}
function renderLeveranseOversikt(q) {
  const liste = document.getElementById('leveranseOversiktListe');
  if (!liste) return;
  const sok = String(q || '').toLowerCase().trim();
  const treff = o => !sok || [leveranseTittel(o), o.kunde, o.eier, o.regnr, o.chassis, o.leveranse.adresse, o.leveranse.sted, o.leveranse.fraktselskap]
    .some(v => String(v || '').toLowerCase().includes(sok));
  const aktive = (S.ordrer || []).filter(o => erLeveranse(o) && o.status === 'aktiv');
  const synlige = aktive.filter(treff).sort(sorterOrdre);
  const antall = id => aktive.filter(o => leveranseOversiktGruppe(o) === id).length;
  const tekstEl = document.getElementById('leveranseOversiktTekst');
  if (tekstEl) tekstEl.textContent = aktive.length
    ? `${aktive.length} aktive · ${antall('under_arbeid')} under arbeid · ${antall('klar_sending')} klar til sending · ${antall('sendt')} sendt`
    : 'Ordre uten bil, for å sende av gårde løsninger';
  if (!aktive.length) { liste.innerHTML = '<div class="muted small">Ingen aktive leveranser</div>'; return; }
  if (!synlige.length) { liste.innerHTML = '<div class="muted small">Ingen leveranser matcher søket</div>'; return; }
  liste.innerHTML = LEVERANSE_OVERSIKT_GRUPPER.map(g => {
    const rader = synlige.filter(o => leveranseOversiktGruppe(o) === g.id);
    if (!rader.length) return '';
    const kort = rader.map(o => { try { return leveranseKortHTML(o, { drag: true }); } catch (e) { return ordreKortFeilHTML(o, e); } }).join('');
    return `<div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:9px;height:9px;border-radius:999px;background:${g.farge};flex-shrink:0"></span><b style="font-size:13px">${esc(g.tittel)}</b><span class="muted small">${rader.length}</span></div>
      <div class="grid g3">${kort}</div>
    </div>`;
  }).join('');
}

// ─── Pakker (vekt og mål) og fraktpris ─────────────────────────────────────────────────────────────────────────────────
// Pakkene lagres i leveranse.kolliListe (antall, vekt per pakke i kg, lengde/bredde/høyde i cm) og tas med i fraktbestillingen. Fraktprisen (kr eks. mva, det kunden skal belastes)
// legges på Fiken-fakturaen som en linje med fast beløp (som drivstoff), og sendes ALDRI til fraktselskapet.
function leveranseFmtTall(n) { return typeof n === 'number' ? String(Math.round(n * 100) / 100).replace('.', ',') : ''; }
function leveranseKolliTekst(l) {
  const s = leveranseKolliSum(l);
  if (!s.antall) return '';
  return `${s.antall} pakke${s.antall === 1 ? '' : 'r'}` + (s.vekt ? ` · ${leveranseFmtTall(s.vekt)} kg` : '');
}
// Pakkene: radene tegnes på nytt BARE når antall rader endres (+ Legg til / ✕). En ren verdiendring (onchange fyrer når man går videre til neste felt) oppdaterer bare det som er avledet
// (summen og fakturaknappen): å bytte ut feltene mens man er på vei til neste felt, svelget det første trykket (verifisert i nettleser 2026-11-03).
const LEV_TOM_PAKKE = { antall: 1, vekt: '', lengde: '', bredde: '', hoyde: '' };
function pakkeFjernKnappHTML(id, i) { return `<button class="btn sm" onclick="fjernKolli('${id}',${i})" title="Fjern pakke">✕</button>`; }
// Etter en lagring settes feltet til den NORMALISERTE verdien (antall 0 lagres som 1, negative tall og tekst som tomt, 2,5 pakker som 2): radene tegnes ikke lenger på nytt, så uten dette viste feltet det brukeren skrev mens lagret verdi var en annen.
function leveranseSynkFelt(el, norm) {
  if (!el || typeof el !== 'object') return;
  const skrevet = String(el.value == null ? '' : el.value).trim().replace(',', '.');
  const lik = norm === '' || norm == null ? skrevet === '' : Number(skrevet) === norm;
  if (!lik) el.value = norm === '' || norm == null ? '' : String(norm);
}
function leveransePakkerRaderHTML(o) {
  // En leveranse har alltid en standardpakke å fylle ut: er lista tom, vises en tom rad (lagres først når et felt fylles ut, se settKolli). Flere pakker legges til med «+ Legg til pakke».
  const l = o.leveranse; const erStandard = l.kolliListe.length === 0;
  return (erStandard ? [LEV_TOM_PAKKE] : l.kolliListe).map((p, i) => pakkeRadHTML(p, k => `onchange="settKolli('${o.id}',${i},'${k}',this.value,this)"`, erStandard ? '' : pakkeFjernKnappHTML(o.id, i))).join('');
}
function leveransePakkerSumHTML(o) {
  const l = o.leveranse; const s = leveranseKolliSum(l);
  return s.antall ? `<div class="small" style="margin-top:8px"><b>${esc(leveranseKolliTekst(l))}</b> totalt${s.utenVekt ? ` <span style="color:#fca5a5">(${s.utenVekt} pakke${s.utenVekt === 1 ? '' : 'r'} mangler vekt)</span>` : ''}</div>` : '';
}
function leveransePakkerFraktKnapp(o) {
  const l = o.leveranse;
  const linjeFinnes = (o.fikenLinjer || []).some(x => l.fraktProduktnr && x.produktnummer === l.fraktProduktnr && x.belop !== undefined);
  return { deaktivert: l.fraktPris === '' || !(l.fraktPris > 0), tekst: linjeFinnes ? '↻ Oppdater frakt på fakturaen' : '＋ Legg frakt på fakturaen' };
}
function leveransePakkerHTML(o) {
  const l = o.leveranse; const erAdmin = me && me.rolle === 'admin';
  const knapp = leveransePakkerFraktKnapp(o);
  return `<div class="muted small" style="letter-spacing:.8px;margin-bottom:6px">PAKKER</div>
    <div id="levPakkerRader_${o.id}">${leveransePakkerRaderHTML(o)}</div>
    <button class="btn sm" onclick="leggTilKolli('${o.id}')">+ Legg til pakke</button>
    <div class="small muted" style="margin-top:6px">Vekt per pakke og mål. Har leveransen flere ulike pakker, legg til én rad for hver, med egen vekt og egne mål.</div>
    <div id="levPakkerSum_${o.id}">${leveransePakkerSumHTML(o)}</div>
    <div class="grid g2" style="gap:8px;margin-top:12px">
      <div><label>Fraktpris (kr eks. mva)</label><input type="number" min="0" step="0.01" inputmode="decimal" value="${l.fraktPris === '' ? '' : esc(String(l.fraktPris))}" placeholder="Det kunden skal belastes" onchange="settFraktPris('${o.id}',this.value,this)"></div>
      <div><label>Fiken-produktnr. for frakt</label><input id="levFraktNr_${o.id}" value="${esc(l.fraktProduktnr)}" placeholder="F.eks. 30" autocomplete="off" onchange="sfLev('${o.id}','fraktProduktnr',this.value)"></div>
    </div>
    ${erAdmin ? `<button id="levFraktBtn_${o.id}" class="btn sm" style="margin-top:8px;width:100%" ${knapp.deaktivert ? 'disabled' : ''} onclick="leggFraktPaaFaktura('${o.id}')">${knapp.tekst}</button>
    <div class="small muted" style="margin-top:4px">Legges som en fakturalinje med fast beløp (25 % mva). Produktnummeret må finnes i Fiken. Prisen sendes ikke til fraktselskapet.</div>` : ''}`;
}
// Oppdaterer pakke-blokken på stedet: summen og fakturaknappen (knappen oppdateres IN PLACE, ikke byttes ut, ellers kunne et trykk på den gå tapt mens feltet før den mister fokus). tegnRader = antall rader endret.
function oppdaterPakkerUtdata(o, tegnRader) {
  const sett = (prefiks, html) => { const el = document.getElementById(prefiks + o.id); if (el) el.innerHTML = html; };
  if (tegnRader) sett('levPakkerRader_', leveransePakkerRaderHTML(o));
  sett('levPakkerSum_', leveransePakkerSumHTML(o));
  const knapp = document.getElementById('levFraktBtn_' + o.id);
  if (knapp) { const f = leveransePakkerFraktKnapp(o); knapp.disabled = f.deaktivert; knapp.textContent = f.tekst; }
}
// Lagrer en endret leveranse-kolonne og oppdaterer pakke-blokken (se oppdaterPakkerUtdata). tegnRader = true når antall rader endres.
function lagreLeveranseKolonne(o, ny, loggTekst, tegnRader) {
  o.leveranse = normaliserLeveranse({ ...o.leveranse, ...ny });
  logChange(o, 'Leveranse: ' + loggTekst);
  save(o.id);
  oppdaterPakkerUtdata(o, !!tegnRader);
}
function leggTilKolli(id) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  if (o.leveranse.kolliListe.length >= LEVERANSE_MAKS_PAKKER) { visToast('Maks ' + LEVERANSE_MAKS_PAKKER + ' pakker per leveranse'); return; }
  // En ny pakke starter som en kopi av forrige (de er ofte like), uten å gjette vekt og mål hvis det ikke finnes noen.
  // Tom liste: standardpakken (som vises tom) blir pakke 1, og den nye pakke 2.
  const tom = { antall: 1, vekt: '', lengde: '', bredde: '', hoyde: '' };
  const grunn = o.leveranse.kolliListe.length ? o.leveranse.kolliListe : [tom];
  const siste = o.leveranse.kolliListe[o.leveranse.kolliListe.length - 1];
  lagreLeveranseKolonne(o, { kolliListe: [...grunn, siste ? { ...siste } : { ...tom }] }, 'pakke lagt til', true);
}
function settKolli(id, idx, felt, val, el) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  if (!['antall', 'vekt', 'lengde', 'bredde', 'hoyde'].includes(felt)) return;
  const liste = o.leveranse.kolliListe.map(p => ({ ...p }));
  const varStandard = !liste.length;
  if (varStandard && idx === 0) liste.push({ ...LEV_TOM_PAKKE }); // standardpakken lagres første gang et felt fylles ut
  if (!liste[idx]) return;
  liste[idx][felt] = val;
  lagreLeveranseKolonne(o, { kolliListe: liste }, 'pakke ' + (idx + 1) + ' (' + felt + ') endret');
  // Standardpakken ble nettopp en lagret pakke: fjern-knappen settes inn på stedet (feltene byttes ikke ut, så neste felt man trykker på beholder trykket).
  if (varStandard) { const fjern = document.querySelector('#levPakkerRader_' + o.id + ' .pakke-fjern'); if (fjern) fjern.innerHTML = pakkeFjernKnappHTML(o.id, 0); }
  leveranseSynkFelt(el, o.leveranse.kolliListe[idx] ? o.leveranse.kolliListe[idx][felt] : '');
}
function fjernKolli(id, idx) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  lagreLeveranseKolonne(o, { kolliListe: o.leveranse.kolliListe.filter((_, i) => i !== idx) }, 'pakke fjernet', true);
}
function settFraktPris(id, val, el) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o)) return;
  lagreLeveranseKolonne(o, { fraktPris: val }, 'fraktpris endret');
  leveranseSynkFelt(el, o.leveranse.fraktPris);
}
// Siste brukte Fiken-produktnr for frakt huskes på denne enheten (forhåndsutfylles neste gang). Blokkert lagring (Edge Tracking Prevention) skal aldri kaste.
function leveranseHuskFraktProduktnr(nr) { try { localStorage.setItem('leveranseFraktProduktnr', nr); } catch (e) { /* uten lagring huskes den ikke */ } }
function leveranseSistFraktProduktnr() { try { return localStorage.getItem('leveranseFraktProduktnr') || ''; } catch (e) { return ''; } }
async function leggFraktPaaFaktura(id) {
  const o = S.ordrer.find(x => x.id === id); if (!o || !erLeveranse(o) || !me || me.rolle !== 'admin') return;
  const l = o.leveranse; const pris = l.fraktPris;
  if (pris === '' || !(pris > 0)) { visToast('Skriv inn fraktprisen først'); return; }
  let nr = String(l.fraktProduktnr || '').trim();
  if (!nr) nr = leveranseSistFraktProduktnr();
  if (!nr) { visToast('Skriv inn Fiken-produktnummeret for frakt først'); return; }
  if (o.fakturert && !confirm('Leveransen er allerede fakturert (kladden er laget i Fiken). Frakt-linjen kommer IKKE med i den kladden. Legge den til likevel?')) return;
  if (l.fraktProduktnr !== nr) lagreLeveranseKolonne(o, { fraktProduktnr: nr }, 'Fiken-produktnr for frakt satt');
  const nrFelt = document.getElementById('levFraktNr_' + id); if (nrFelt) nrFelt.value = nr; // nummeret kan komme fra forrige bruk på denne enheten: feltet viser det som faktisk brukes
  leveranseHuskFraktProduktnr(nr);
  await oppdaterOrdreFikenLinje(o, nr, { produktnummer: nr, antall: 1, belop: pris });
  logChange(o, `Frakt lagt på fakturaen: ${leveranseFmtTall(pris)} kr eks. mva (produkt ${nr})`);
  oppdaterPakkerUtdata(o, false);
  visToast(`Frakt (${leveranseFmtTall(pris)} kr eks. mva) lagt på fakturaen`, 'ok');
}

// ─── Kort i lister ──────────────────────────────────────────────────────────────────────────────────────────────────────
function leveranseKortHTML(o, opts) {
  const si = statusInfo(o.ordreStatus);
  const l = o.leveranse;
  const fraktLinje = o.fraktBestiltAt ? '✓ Frakt bestilt' + (l.fraktselskap ? ' hos ' + l.fraktselskap : '')
    : l.fraktselskap ? l.fraktselskap + (leveranseErEkteFraktselskap(l.fraktselskap) ? ' · ikke bestilt ennå' : '') : 'Fraktselskap ikke valgt';
  const stedLinje = [l.sted, l.postnr].filter(Boolean).join(' ') || (l.adresse || '');
  // På Oversikt kan kortet dras inn på en rute i ukekalenderen (som bil-kortene); i Ordre-lista er det ingen kalender å dra til.
  const dra = opts && opts.drag ? ` class="drag-card" onpointerdown="dragOrdreStart(event,'${o.id}')"` : '';
  return `<div${dra} style="position:relative;background:#18181b;border:1px solid ${o.prioritert ? '#facc15' : si.border};border-radius:18px;padding:16px 17px 14px;display:flex;flex-direction:column;gap:12px;min-width:0">
      ${o.prioritert ? '<span style="position:absolute;top:-9px;left:14px;background:#18181b;padding:0 6px;font-size:10px;font-weight:700;color:#facc15;letter-spacing:.03em">PRIORITERT</span>' : ''}
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:8px 12px">
        <div onclick="openOrdre('${o.id}')" style="cursor:pointer;flex:1 1 0;min-width:0">
          <div style="margin-bottom:5px">${leveranseBadgeHTML()}</div>
          <b style="font-size:16px;letter-spacing:-.2px;line-height:1.25;word-break:break-word">${esc(leveranseTittel(o))}</b>
          ${o.regnr && o.regnr !== leveranseTittel(o) ? `<div class="small muted" style="margin-top:2px">${esc(o.regnr)}</div>` : ''}
          ${o.chassis && o.chassis !== leveranseTittel(o) ? `<div class="small muted" style="margin-top:2px;white-space:nowrap">Chassis <span style="font-family:ui-monospace,'SF Mono',Menlo,monospace">${esc(o.chassis)}</span></div>` : ''}
          ${o.kunde ? `<div class="small muted" style="margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:0;min-width:100%">${esc(o.kunde)}</div>` : ''}
        </div>
        ${statusDropdown(o.id, o.ordreStatus, 'border-width:1px;border-radius:999px;padding:5px 10px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', 'ordre-status-dropdown')}
      </div>
      <div class="box" onclick="openOrdre('${o.id}')" style="padding:12px 14px;display:flex;flex-direction:column;gap:3px;cursor:pointer">
        <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Frakt</span><span style="color:${o.fraktBestiltAt ? '#86efac' : '#f4f4f5'}">${esc(fraktLinje)}</span></div>
        <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Til</span><span style="color:${stedLinje ? '#f4f4f5' : '#71717a'}">${esc(stedLinje) || '—'}</span></div>
        ${leveranseKolliTekst(l) ? `<div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Pakker</span><span>${esc(leveranseKolliTekst(l))}</span></div>` : ''}
        ${o.status === 'aktiv' ? `<div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Kalender</span><span style="color:${o.kalenderDato ? '#f4f4f5' : '#71717a'}">${o.kalenderDato ? '📅 ' + esc(leveranseKalenderTekst(o)) : 'Ikke i kalender'}</span></div>` : ''}
        ${l.sendtDato ? `<div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Sendt</span><span>${esc(leveranseDato(l.sendtDato))}</span></div>` : (l.onsketHentedato ? `<div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:54px">Hentes</span><span>${esc(leveranseDato(l.onsketHentedato))}</span></div>` : '')}
      </div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px">${fakturertKortHTML(o)}</div>
    </div>`;
}

// ─── Detaljvisning ──────────────────────────────────────────────────────────────────────────────────────────────────────
function leveranseFraktKortHTML(o) {
  const l = o.leveranse; const erAdmin = me && me.rolle === 'admin';
  const valg = leveranseFraktselskapValg(); if (l.fraktselskap && !valg.includes(l.fraktselskap)) valg.push(l.fraktselskap);
  const felt = (lbl, id, verdi, ekstra = '') => `<div><label>${lbl}</label><input id="${id}_${o.id}" value="${esc(verdi)}" autocomplete="off" ${ekstra}></div>`;
  const mangler = leveranseFraktMangler(o);
  const ekte = leveranseErEkteFraktselskap(l.fraktselskap);
  const kolliSum = leveranseKolliSum(l);
  const vektHint = ekte && !o.fraktBestiltAt && (!kolliSum.antall || kolliSum.utenVekt) ? '<div class="small" style="color:#fde68a;margin-top:8px">Husk vekt og mål på pakkene før frakten bestilles: fraktselskapet trenger dem.</div>' : '';
  const status = vektHint + (o.fraktBestiltAt
    ? `<div class="small" style="color:#86efac;margin-top:10px">✓ Fraktbestilling sendt til ${esc(l.fraktselskap)} ${esc(leveranseTidspunkt(o.fraktBestiltAt))}${o.fraktBestiltAv ? ' av ' + esc(o.fraktBestiltAv) : ''}</div>`
    : ekte ? `<div class="small muted" style="margin-top:10px">Fraktbestilling er ikke sendt.${l.fraktAuto ? ' Den sendes automatisk når statusen settes til «Klar til sending».' : ''}${mangler.length ? ' <span style="color:#fca5a5">Mangler: ' + esc(mangler.join(', ')) + '.</span>' : ''}</div>`
    : l.fraktselskap ? `<div class="small muted" style="margin-top:10px">${esc(l.fraktselskap)}: ingen bestilling på e-post.</div>` : '');
  return `<div class="card">
    <div class="h">Frakt</div>
    <div class="grid g2" style="gap:8px;margin-top:10px">
      <div><label>Fraktselskap</label>
        <select onchange="sfLev('${o.id}','fraktselskap',this.value)"><option value="">Velg fraktselskap</option>${valg.map(n => `<option value="${esc(n)}" ${n === l.fraktselskap ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      ${felt('Ønsket hentedato', 'levHente', l.onsketHentedato, `type="date" onchange="sfLev('${o.id}','onsketHentedato',this.value)"`)}
      <div style="grid-column:1/-1"><label>Leveringsadresse</label><input id="levAdresse_${o.id}" value="${esc(l.adresse)}" autocomplete="off" onchange="sfLev('${o.id}','adresse',this.value)"></div>
      ${felt('Postnr.', 'levPostnr', l.postnr, `onchange="sfLev('${o.id}','postnr',this.value)"`)}
      ${felt('Sted', 'levSted', l.sted, `onchange="sfLev('${o.id}','sted',this.value)"`)}
      ${felt('Telefon mottaker', 'levTlf', l.kontaktTlf, `onchange="sfLev('${o.id}','kontaktTlf',this.value)"`)}
      ${felt('Sporingsnummer', 'levSporing', l.sporing, `onchange="sfLev('${o.id}','sporing',this.value)"`)}
      <div style="grid-column:1/-1"><label>Gods / kolli</label><input id="levKolli_${o.id}" value="${esc(l.kolli)}" placeholder="F.eks. 2 pakker, 1 pall 120x80" autocomplete="off" onchange="sfLev('${o.id}','kolli',this.value)"></div>
      ${felt('Sendt dato', 'levSendt', l.sendtDato, `type="date" onchange="sfLev('${o.id}','sendtDato',this.value)"`)}
    </div>
    <div id="levPakker_${o.id}" style="margin-top:14px;padding-top:12px;border-top:1px solid #27272a">${leveransePakkerHTML(o)}</div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer">
      <input type="checkbox" ${l.fraktAuto ? 'checked' : ''} onchange="sfLev('${o.id}','fraktAuto',this.checked)" style="width:15px;height:15px;accent-color:#22c55e">
      <span class="small">Bestill frakt automatisk på e-post når den settes til «Klar til sending»</span>
    </label>
    ${status}
    ${erAdmin && ekte ? `<button id="leveranseFraktKnapp_${o.id}" class="btn sm ${o.fraktBestiltAt ? '' : 'red'}" style="margin-top:10px;width:100%" ${mangler.length ? 'disabled' : ''}
        onclick="${o.fraktBestiltAt ? `if(confirm('Fraktbestillingen er allerede sendt. Sende den på nytt?'))` : ''}bestillFraktForLeveranse('${o.id}',{paaNytt:${o.fraktBestiltAt ? 'true' : 'false'}})">${o.fraktBestiltAt ? '↻ Send fraktbestilling på nytt' : '✉ Bestill frakt nå'}</button>` : ''}
  </div>`;
}

function buildLeveranseDetail(o) {
  const erAdmin = me && me.rolle === 'admin';
  const l = o.leveranse;
  const erAnsattEndring = e => /meldt på$|meldt av$/.test(e.txt);
  const ansatteEndringer = o.endringer.filter(erAnsattEndring);
  const generelleEndringer = o.endringer.filter(e => !erAnsattEndring(e));
  const endringsRad = e => `<div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid #1f1f23;font-size:12px;align-items:baseline">
      <span style="font-family:ui-monospace,'SF Mono',Menlo,monospace;color:#52525b;flex-shrink:0;white-space:nowrap">${esc(e.tid)}</span>
      <span style="color:#d4d4d8;min-width:0">${esc(e.txt)}<span style="color:#52525b"> · ${esc(e.av)}</span></span></div>`;
  document.getElementById('ordreDetail').innerHTML = `
  <div style="position:sticky;top:var(--top-h,0px);z-index:40;background:#09090b;padding:8px 0;border-bottom:1px solid #27272a;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <button class="btn sm" onclick="tilbakeOrdreList()" style="padding:5px 9px;font-size:11px">${openedFromArkiv ? '← Tilbake til arkiv' : '← Alle ordrer'}</button>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button id="prioritertBtn_${o.id}" class="btn sm" onclick="togglePrioritert('${o.id}')" style="border-radius:10px;padding:5px 9px;font-size:11px;${o.prioritert ? 'background:rgba(250,204,21,.12);border-color:#facc15;color:#facc15' : ''}">${o.prioritert ? 'Prioritert ✕' : '+ Prioriter'}</button>
      <button id="oppdaterOrdreKnapp" class="btn sm" onclick="oppdaterAktivOrdre()" title="Hent siste endringer" style="border-radius:10px;padding:5px 9px;font-size:11px">Oppdater</button>
      ${erAdmin ? `<button class="btn sm" onclick="slettOrdre('${o.id}')" style="border-radius:10px;padding:5px 9px;font-size:11px;background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.4);color:#fca5a5">Slett leveranse</button>` : ''}
    </div>
  </div>
  ${o.status === 'arkivert' ? `<div style="background:#1c1008;border:1px solid #78350f;border-radius:10px;padding:10px 14px;margin-bottom:10px;color:#fbbf24;font-size:13px;font-weight:600">Arkivert leveranse — kun visning</div>` : ''}
  <div class="card" style="padding:12px 16px;margin-bottom:0">
    <div class="row" style="flex-wrap:wrap;align-items:center;gap:8px 12px">
      <div style="flex:1 1 0;min-width:0">
        <div style="margin-bottom:4px">${leveranseBadgeHTML()}</div>
        <div class="title" style="letter-spacing:.02em;word-break:break-word">${esc(leveranseTittel(o))}</div>
        ${o.kunde ? `<div class="small muted" style="margin-top:2px">${esc(o.kunde)}</div>` : ''}
        ${o.status === 'aktiv' ? leveranseKalenderRadHTML(o) : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
        ${statusDropdown(o.id, o.ordreStatus, 'font-size:13px;padding:6px 11px;border-radius:999px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', 'ordre-status-dropdown')}
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${o.fakturert ? '<span class="pill ok" style="font-size:11px;margin:0">✔ Fakturert</span>' : '<span class="pill bad" style="font-size:11px;margin:0">Ikke fakturert</span>'}
          ${o.fraktBestiltAt ? '<span class="pill ok" style="font-size:11px;margin:0">Frakt bestilt</span>' : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="grid g2l">
    <div>
      <div class="card">
        <div class="h">Kunde og merking</div>
        <div class="grid g2" style="gap:8px;margin-top:10px">
          <div class="felt-wrap">
            <label>Kunde / forhandler</label>
            <input id="kundeInput_${o.id}" value="${esc(o.kunde)}" autocomplete="off"
              oninput="renderEierForslag('kundeInput_${o.id}','eierInput_${o.id}','typeForslag_eier_${o.id}')"
              onchange="sf('${o.id}','kunde',this.value)"
              onfocus="visFeltDropdown('typeForslag_kunde_${o.id}')" onblur="skjulFeltDropdown(document.getElementById('typeForslag_kunde_${o.id}'))">
            <div id="typeForslag_kunde_${o.id}" class="felt-dropdown">${feltForslagHTML('kundeInput_' + o.id, forhandlerForslag())}</div>
          </div>
          <div class="felt-wrap">
            <label>Kontaktperson</label>
            <input id="eierInput_${o.id}" value="${esc(o.eier)}" autocomplete="off" onchange="sf('${o.id}','eier',this.value)"
              onfocus="visFeltDropdown('typeForslag_eier_${o.id}')" onblur="skjulFeltDropdown(document.getElementById('typeForslag_eier_${o.id}'))">
            <div id="typeForslag_eier_${o.id}" class="felt-dropdown">${feltForslagHTML('eierInput_' + o.id, kontaktpersonKontakterForslag(o.kunde))}</div>
          </div>
          <div><label>Merking</label><input value="${esc(l.merking)}" placeholder="F.eks. kundens ordrenr eller en beskrivelse" autocomplete="off" onchange="sfLev('${o.id}','merking',this.value)"></div>
          <div><label>Reg.nr</label><input value="${esc(o.regnr || '')}" autocomplete="off" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" onchange="sf('${o.id}','regnr',this.value)"></div>
          <div style="grid-column:1/-1"><label>Chassis-nr (17 tegn)</label><input value="${esc(o.chassis || '')}" maxlength="17" autocomplete="off" onchange="sf('${o.id}','chassis',this.value)"></div>
        </div>
      </div>

      ${leveranseFraktKortHTML(o)}

      <div class="card">
        <div class="h">Ansatte på leveransen</div>
        <div style="margin-top:6px" id="ansOrdre">${renderAnsOrdre(o)}</div>
        ${!o.ansatteSignert.find(a => a.id === me.id)
          ? `<button class="btn sm" style="margin-top:8px;width:100%" onclick="meldPaa('${o.id}')">+ Meld meg på</button>`
          : `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
              <span class="small ok-text">✓ Du er meldt på</span>
              <button class="btn sm" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5" onclick="meldAv('${o.id}')">Meld meg av</button>
            </div>`}
        ${erAdmin ? `<button class="btn sm" style="margin-top:8px;width:100%" onclick="apneAdminMeldPaaModal('${o.id}')">👥 Meld på ansatte</button>` : ''}
        ${ansatteEndringer.length ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #27272a">${[...ansatteEndringer].reverse().map(endringsRad).join('')}</div>` : ''}
      </div>

      <div class="card" id="ordretimerKort_ordreTimerSessions_${o.id}">${ordreTimerKortHTML(o, 'ordreTimerSessions')}</div>

      <div class="card">
        <div class="h">Varer fra lager</div>
        <div id="ordreLagerbruk_${o.id}" style="margin-top:8px"></div>
      </div>

      <div class="card">
        <div class="h">Notater</div>
        <textarea rows="3" style="margin-top:8px" onchange="sf('${o.id}','notater',this.value)">${esc(o.notater)}</textarea>
      </div>

      <div class="card">
        <div class="h">Endringer</div>
        ${generelleEndringer.length ? [...generelleEndringer].reverse().slice(0, 30).map(endringsRad).join('') : '<div class="small muted">Ingen registrerte endringer</div>'}
      </div>
    </div>

    <div>
      ${erAdmin ? `
      <div class="card">
        <div class="h">Fakturering</div>
        <div class="small muted" style="margin-top:6px">Produktnummer og antall som skal med på Fiken-fakturaen. Referansen på fakturaen blir merkingen${o.regnr || o.chassis ? ' (med reg.nr/chassis)' : ''}: <b>${esc(leveranseFakturaReferanse(o)) || '—'}</b></div>
        <div id="fikenLinjer_${o.id}" style="margin-top:10px">${fikenLinjerHTML(o)}</div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #27272a">
          ${o.fakturert
            ? `<span class="pill ok">✔ Fakturert</span>
               ${o.fikenKladdUrl ? `<a class="btn sm" href="${esc(o.fikenKladdUrl)}" target="_blank" rel="noopener" style="margin-top:8px;display:block;text-align:center">Åpne kladden i Fiken</a>` : ''}
               <button class="btn sm" style="margin-top:8px;width:100%" onclick="toggleFakturert('${o.id}')">Merk som ikke fakturert</button>`
            : `<div class="muted small" style="margin-bottom:8px">Ikke fakturert</div>
               <label style="display:flex;align-items:center;gap:7px;margin-bottom:10px;cursor:pointer">
                 <input type="checkbox" id="brukRabatt_${o.id}" checked style="width:15px;height:15px;accent-color:#22c55e">
                 <span class="small">Bruk kundens avtalte rabatt</span>
               </label>
               <button class="btn sm red" id="fakturerBtn_${o.id}" style="width:100%" onclick="fakturerViaFiken('${o.id}')">✔ Merk som fakturert (oppretter kladd i Fiken)</button>`}
        </div>
      </div>` : ''}

      <div class="card">
        <div class="h">Dokumenter</div>
        <div id="dokumenterListe_${o.id}">${dokumenterListeHTML(o)}</div>
        ${erAdmin ? `<label id="dokDropzone_${o.id}" class="dok-dropzone small muted" style="margin-top:8px;display:block" title="Samme filnavn erstatter forrige versjon"
            ondragover="dokDragOver(event,'${o.id}')" ondragleave="dokDragLeave(event,'${o.id}')" ondrop="dokDrop(event,'${o.id}')">
          Dra dokumenter hit, eller klikk for å velge
          <input type="file" multiple accept="${DOK_TILLATTE_EXT.map(e => '.' + e).join(',')}" onchange="lastOppDokument(event,'${o.id}')" style="display:none">
        </label>` : ''}
      </div>
    </div>
  </div>`;
  renderOrdreLagerbruk();
  sikreOrdreTimerTicking(o);
  if (o.status === 'arkivert') {
    const detail = document.getElementById('ordreDetail');
    const header = detail.firstElementChild;
    detail.querySelectorAll('input, textarea, select').forEach(el => { el.disabled = true; el.style.cursor = 'not-allowed'; });
    detail.querySelectorAll('button').forEach(btn => { if (!header.contains(btn) && !btn.hasAttribute('data-viewonly')) { btn.disabled = true; btn.style.opacity = '0.4'; } });
  }
}
