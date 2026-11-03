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
const LEV_FELT_NY = ['lev_kunde', 'lev_eier', 'lev_merking', 'lev_regnr', 'lev_chassis', 'lev_adresse', 'lev_postnr', 'lev_sted', 'lev_tlf', 'lev_kolli', 'lev_hentedato'];
function apneNyLeveranseModal() {
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
  });
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
    const kort = rader.map(o => { try { return leveranseKortHTML(o); } catch (e) { return ordreKortFeilHTML(o, e); } }).join('');
    return `<div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:9px;height:9px;border-radius:999px;background:${g.farge};flex-shrink:0"></span><b style="font-size:13px">${esc(g.tittel)}</b><span class="muted small">${rader.length}</span></div>
      <div class="grid g3">${kort}</div>
    </div>`;
  }).join('');
}

// ─── Kort i lister ──────────────────────────────────────────────────────────────────────────────────────────────────────
function leveranseKortHTML(o) {
  const si = statusInfo(o.ordreStatus);
  const l = o.leveranse;
  const fraktLinje = o.fraktBestiltAt ? '✓ Frakt bestilt' + (l.fraktselskap ? ' hos ' + l.fraktselskap : '')
    : l.fraktselskap ? l.fraktselskap + (leveranseErEkteFraktselskap(l.fraktselskap) ? ' · ikke bestilt ennå' : '') : 'Fraktselskap ikke valgt';
  const stedLinje = [l.sted, l.postnr].filter(Boolean).join(' ') || (l.adresse || '');
  return `<div style="position:relative;background:#18181b;border:1px solid ${o.prioritert ? '#facc15' : si.border};border-radius:18px;padding:16px 17px 14px;display:flex;flex-direction:column;gap:12px;min-width:0">
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
  const status = o.fraktBestiltAt
    ? `<div class="small" style="color:#86efac;margin-top:10px">✓ Fraktbestilling sendt til ${esc(l.fraktselskap)} ${esc(leveranseTidspunkt(o.fraktBestiltAt))}${o.fraktBestiltAv ? ' av ' + esc(o.fraktBestiltAv) : ''}</div>`
    : ekte ? `<div class="small muted" style="margin-top:10px">Fraktbestilling er ikke sendt.${l.fraktAuto ? ' Den sendes automatisk når statusen settes til «Klar til sending».' : ''}${mangler.length ? ' <span style="color:#fca5a5">Mangler: ' + esc(mangler.join(', ')) + '.</span>' : ''}</div>`
    : l.fraktselskap ? `<div class="small muted" style="margin-top:10px">${esc(l.fraktselskap)}: ingen bestilling på e-post.</div>` : '';
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
