// ════════════════════════════════════════════════════
// SKAL PÅ BILEN (trinn 3 av «Én produktliste», Henrik 17.11.2026)
// ════════════════════════════════════════════════════
// Appen velger selv ombygging og tillegg ut fra modell + bestilling + «Har ved ankomst»-sjekklista, og viser dem som én liste med
// produktnummer, oppskrift og deler (valg A). De ansatte retter bare avvik («Rett», «+ Legg til utstyr»).
//  * Bestilling fra portalen (o.portalLinjer): lista er det som er bestilt. Sjekklista legger ikke til noe; sier den noe annet,
//    varsler appen bare («bestillingen gjelder»).
//  * Uten bestilling: ombyggingen ut fra Nytt/Brukt/Lafinto/Personbil-boksene (finnFikenOmbyggingModell, trinn 2) pluss hvert tillegg/
//    variant i portalen der et «velges når»-punkt (portal_produkter.velges_nar) er huket av i sjekklista.
//  * Rettelsene lagres som en logg på ordren (ordrer.produkt_rettelser, RPC legg_til_ordre_produkt_rettelse, aldri via save()).
//  * Oppskrift per produkt: en oppskrift som dekker FLERE av produktene (f.eks. «500, 502» = ombygging med 180-stoler) velges før de
//    enkelte, så delene aldri trekkes to ganger; ellers oppskriften koblet til portal-id (trinn 1), ellers ÉN ukoblet med akkurat det nummeret.
//  * Lager trekkes ved ankomst (status forbi «På vei») via lager_trekk_oppskrift (idempotent per ordre+oppskrift), aldri når sjekklista
//    fylles ut før ankomst. Rettes noe etter ankomst, trekkes/legges delene tilbake med en gang.
//  * Gjelder bare ordrer opprettet etter PRODUKTLISTE_FRA. Eldre ordrer beholder dagens avkrysning (renderOrdreLagerbruk i lager.js).

// Slått på 17.11.2026 (Henrik: «Ja, slå på»). Bare ordrer opprettet etter dette tidspunktet får «Skal på bilen»; eldre ordrer beholder
// avkrysningen. null = av for alle.
const PRODUKTLISTE_FRA = '2026-11-17T17:20:53Z';

function erNyProduktliste(o) {
  if (!o || !PRODUKTLISTE_FRA || (typeof erLeveranse === 'function' && erLeveranse(o))) return false;
  // En ordre som nettopp er laget i appen har ingen createdAt før den er lest fra databasen: da brukes tidspunktet i id-en (ord_<ms>).
  let t = Date.parse(o.createdAt || '');
  if (!Number.isFinite(t)) { const m = /^ord_(\d{12,14})/.exec(String(o.id || '')); t = m ? Number(m[1]) : NaN; }
  return Number.isFinite(t) && t >= Date.parse(PRODUKTLISTE_FRA);
}
function erAnkommet(o) {
  return !!o && !!o.ordreStatus && o.ordreStatus !== 'paa_vei';
}
const _norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Modellens slug og produkter (fra portal_produkter). Lang ID. Buzz uten egne produkter faller tilbake på radens slug (som i trinn 2).
function produktlisteModell(o) {
  const kan = kanoniskMerkeModell(o);
  const modell = finnFikenOmbyggingModell(kan.merke, kan.modell, o.portalModellSlug);
  const alle = Array.isArray(S.portalProdukter) ? S.portalProdukter : [];
  const sluggerIRekkefolge = [o.portalModellSlug, modell && modell.slug].filter(Boolean);
  let slug = null, produkter = [];
  for (const s of sluggerIRekkefolge) {
    const p = alle.filter(x => x.modell_slug === s);
    if (p.length) { slug = s; produkter = p; break; }
  }
  return { modell, slug: slug || (modell && modell.slug) || null, produkter };
}

// Selve lista. Ren: leser bare o og S. Gir { rader, varsler, bestilt }.
function beregnSkalPaaBilen(o) {
  const { modell, produkter } = produktlisteModell(o);
  const finnProdukt = nr => produkter.find(p => p.fiken_nummer === nr) || null;
  const bestilt = Array.isArray(o.portalLinjer) && o.portalLinjer.length > 0;
  // «Kun ekstrautstyr (ingen ombygging)» (Henrik 2026-11-17): aldri en ombyggingsrad (ombygging/personbil/Lafinto), verken fra boksene eller fra en
  // bestilling. Sjekkliste-treff, «+ Legg til utstyr» og «Rett» virker som ellers, og lageret trekkes ved ankomst som ellers.
  const kun = o.kunEkstrautstyr === true;
  const rader = [];
  const varsler = [];
  const leggTil = (nr, navn, kilde, grunn, extra = {}) => {
    if (!nr || rader.some(r => r.nr === nr)) return;
    const p = finnProdukt(nr);
    rader.push({ nr, navn: navn || (p && p.navn) || nr, kilde, grunn, portalId: p ? p.portal_id : null, type: p ? p.type : null, rolle: p ? (p.app_rolle || null) : null, fjernet: false, ...extra });
  };
  const okPunkter = (o.utstyrSjekkliste || []).filter(p => p && p.ok).map(p => String(p.punkt || '').trim()).filter(Boolean);
  const okSett = new Map(okPunkter.map(p => [_norm(p), p]));
  const regelTreff = p => (Array.isArray(p.velges_nar) ? p.velges_nar : []).map(v => okSett.get(_norm(v))).find(Boolean) || null;

  if (bestilt) {
    for (const l of o.portalLinjer) {
      const nr = String(l && l.produktnummer || '');
      const p = finnProdukt(nr);
      if (kun && p && p.app_rolle) { varsler.push(`Bestillingen har ${nr} ${p.navn}, men ordren er merket «Kun ekstrautstyr (ingen ombygging)», så den er ikke med.`); continue; }
      leggTil(nr, l && l.navn, 'bestilling', 'Bestilt i portalen');
    }
    for (const p of produkter) {
      if (p.nummer_status !== 'ok' || rader.some(r => r.nr === p.fiken_nummer)) continue;
      const punkt = regelTreff(p);
      if (punkt) varsler.push(`Sjekklista sier «${punkt}», men bestillingen har ikke ${p.fiken_nummer} ${p.navn}. Bestillingen gjelder; legg det til med «+ Legg til utstyr» hvis det skal på bilen.`);
    }
  } else {
    const b = kun ? {} : (o.ombygging || {});
    if (modell && (b.nyttKjoretoy || b.bruktKjoretoy)) {
      const lafinto = !!(b.lafinto && modell.lafinto);
      const rolle = lafinto ? 'lafinto' : 'ombygging';
      const nr = ombyggingNummerFor(o, modell, rolle).nummer;
      leggTil(nr, null, 'ombygging', `${b.nyttKjoretoy ? 'Nytt' : 'Brukt'} kjøretøy er huket av${lafinto ? ', og Lafinto' : ''}`, { rolle });
    }
    if (modell && b.personbil && modell.personbil) {
      leggTil(ombyggingNummerFor(o, modell, 'personbil').nummer, null, 'ombygging', 'Personbil er huket av', { rolle: 'personbil' });
    }
    for (const p of produkter) {
      if (p.nummer_status !== 'ok') continue;
      const punkt = regelTreff(p);
      if (punkt) leggTil(p.fiken_nummer, p.navn, 'sjekkliste', `Sjekklista: «${punkt}» er huket av`);
    }
  }

  // Rettelsene, i rekkefølge: fjern / legg_til / angre (angre = tilbake til det appen selv valgte).
  const tilstand = new Map();
  for (const r of (Array.isArray(o.produktRettelser) ? o.produktRettelser : [])) {
    if (!r || !r.produktnummer) continue;
    if (r.handling === 'angre') { tilstand.delete(r.produktnummer); continue; }
    if (r.handling === 'fjern' || r.handling === 'legg_til') tilstand.set(r.produktnummer, r);
  }
  for (const [nr, r] of tilstand) {
    const rad = rader.find(x => x.nr === nr);
    const dato = r.at ? new Date(r.at).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric' }) : '';
    if (r.handling === 'fjern') {
      if (rad) Object.assign(rad, { fjernet: true, rettet: { av: r.av || '', dato } });
    } else if (!rad) {
      leggTil(nr, r.navn, 'manuell', `Lagt til av ${r.av || 'ukjent'}${dato ? ' ' + dato : ''}`, { rettet: { av: r.av || '', dato } });
    }
  }
  velgOppskrifter(o, rader.filter(r => !r.fjernet));
  return { rader, varsler, bestilt };
}

// Oppskrift per aktiv rad (setter rad.oppskrift og ev. rad.oppskriftDeltMed). Se toppen av fila for rekkefølgen.
function velgOppskrifter(o, aktive) {
  const nrs = new Set(aktive.map(r => r.nr));
  const alle = Array.isArray(S.lagerOppskrifter) ? S.lagerOppskrifter : [];
  const passer = r => typeof oppskriftMatcherOrdre === 'function' && oppskriftMatcherOrdre(r, o);
  const dekket = new Set();
  const kombo = alle
    .map(r => ({ r, n: oppskriftProduktnumre(r) }))
    .filter(x => x.n.length >= 2 && x.n.every(nr => nrs.has(nr)) && (passer(x.r) || x.r.portalVariantId || x.r.portalTilleggId))
    .sort((a, b) => b.n.length - a.n.length || String(a.r.id).localeCompare(String(b.r.id)));
  for (const { r, n } of kombo) {
    if (n.some(nr => dekket.has(nr))) continue;
    n.forEach(nr => dekket.add(nr));
    const rader = aktive.filter(x => n.includes(x.nr));
    rader.forEach((rad, i) => { rad.oppskrift = i === 0 ? r : null; rad.oppskriftDeltMed = rader.filter(x => x !== rad).map(x => x.nr); if (i > 0) rad.oppskriftViaNr = rader[0].nr; });
  }
  for (const rad of aktive) {
    if (dekket.has(rad.nr)) continue;
    let r = rad.portalId ? alle.find(x => x.portalVariantId === rad.portalId || x.portalTilleggId === rad.portalId) : null;
    if (!r) {
      const kandidater = alle.filter(x => !x.portalVariantId && !x.portalTilleggId && passer(x) && oppskriftProduktnumre(x).length === 1 && oppskriftProduktnumre(x)[0] === rad.nr);
      if (kandidater.length === 1) r = kandidater[0];
      else if (kandidater.length > 1) rad.oppskriftFlere = kandidater.length;
    }
    rad.oppskrift = r || null;
  }
}

function produktlisteTrukket(o, oppskriftId) {
  return (S.lagerhistorikk || []).some(h => h.ordreId === o.id && h.oppskriftId === oppskriftId);
}
function produktlisteManglerDeler(r) {
  return (r.ingredienser || []).filter(i => { const v = (S.lagervarer || []).find(x => x.id === i.vareId); return !v || Number(v.antall) < Number(i.antall); }).length;
}

// ── Synk: fakturalinjer og lager ────────────────────────────────────────────────────────────────────────────────
const _produktlisteIGang = new Set();
// tillatAngre: bare fra en bevisst handling (Rett, sjekkliste, boksene). Fra en vanlig opptegning legges aldri noe tilbake på lager.
async function synkProduktliste(o, { tillatAngre = false } = {}) {
  if (!erNyProduktliste(o)) return;
  const { rader, bestilt } = beregnSkalPaaBilen(o);
  const { produkter } = produktlisteModell(o);
  // 1) Fakturalinjer for det appen la til (sjekkliste) eller som er lagt til for hånd. Ombyggingen styres av synkroniserOmbyggingFikenLinjer,
  //    og bestilte linjer (med frosset rabatt) av Bekreft; en linje med rabatt fjernes aldri automatisk (oppdaterFikenLinjeForOppskrift).
  for (const r of rader) {
    if (r.kilde === 'sjekkliste' || r.kilde === 'manuell') await oppdaterFikenLinjeForOppskrift(r.nr, !r.fjernet, o.id);
  }
  if (!bestilt) {
    for (const p of produkter) {
      if (p.nummer_status !== 'ok' || !(p.velges_nar || []).length) continue;
      if (!rader.some(r => r.nr === p.fiken_nummer && !r.fjernet)) await oppdaterFikenLinjeForOppskrift(p.fiken_nummer, false, o.id);
    }
  }
  // Et produkt som ble lagt til for hånd og så angret, har ingen rad lenger: linjen det fikk skal også bort (funnet i nettlesertest 17.11).
  const lagtTilForHand = new Set((Array.isArray(o.produktRettelser) ? o.produktRettelser : []).filter(r => r && r.handling === 'legg_til').map(r => r.produktnummer));
  for (const nr of lagtTilForHand) {
    if (!rader.some(r => r.nr === nr)) await oppdaterFikenLinjeForOppskrift(nr, false, o.id);
  }
  // 2) Lager, bare etter ankomst.
  if (!erAnkommet(o) || !db) return;
  const onsket = new Map();
  for (const r of rader) if (!r.fjernet && r.oppskrift) onsket.set(r.oppskrift.id, r.oppskrift);
  for (const [id, opp] of onsket) {
    if (produktlisteTrukket(o, id)) continue;
    await produktlisteTrekk(o, opp);
  }
  if (tillatAngre) {
    const trukne = new Set((S.lagerhistorikk || []).filter(h => h.ordreId === o.id && h.oppskriftId).map(h => h.oppskriftId));
    for (const id of trukne) if (!onsket.has(id)) await produktlisteAngre(o, id);
  }
}

async function produktlisteTrekk(o, r) {
  const nokkel = o.id + '|' + r.id;
  if (_produktlisteIGang.has(nokkel) || !(r.ingredienser || []).length) return;
  _produktlisteIGang.add(nokkel);
  try {
    const { data, error } = await db.rpc('lager_trekk_oppskrift', { p_ordre_id: o.id, p_oppskrift_id: r.id, p_ansatt: me?.navn || '' });
    if (error) { if (error.message !== 'ALLEREDE_TRUKKET') visToast('Kunne ikke trekke fra lager: ' + error.message); return; }
    (r.ingredienser || []).forEach(i => {
      const v = (S.lagervarer || []).find(x => x.id === i.vareId);
      if (v) registrerLagerEndring(v, -Math.abs(i.antall), 'ut', o.id, r.navn, data?.batchId, null, r.id, true);
    });
    if (data?.ikkeFunnet) visToast(`${r.navn}: ${data.ikkeFunnet} vare(r) finnes ikke lenger på lager og ble ikke trukket.`);
  } finally { _produktlisteIGang.delete(nokkel); }
}

async function produktlisteAngre(o, oppskriftId) {
  const nokkel = o.id + '|' + oppskriftId;
  if (_produktlisteIGang.has(nokkel)) return;
  _produktlisteIGang.add(nokkel);
  try {
    const { error } = await db.rpc('lager_angre_oppskrift_trekk', { p_ordre_id: o.id, p_oppskrift_id: oppskriftId });
    if (error) { if (error.message !== 'IKKE_TRUKKET') visToast('Kunne ikke legge delene tilbake: ' + error.message); return; }
    const rader = (S.lagerhistorikk || []).filter(h => h.ordreId === o.id && h.oppskriftId === oppskriftId);
    rader.forEach(h => { const v = (S.lagervarer || []).find(x => x.id === h.vareId); if (v) v.antall = (Number(v.antall) || 0) - h.endring; });
    S.lagerhistorikk = (S.lagerhistorikk || []).filter(h => !(h.ordreId === o.id && h.oppskriftId === oppskriftId));
  } finally { _produktlisteIGang.delete(nokkel); }
}

// ── Rettelser ────────────────────────────────────────────────────────────────────────────────────────────────────
const _produktRettelseIGang = new Set();
async function produktRettelse(ordreId, handling, nr, navn, portalId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o || !db) return;
  if (_produktRettelseIGang.has(ordreId)) return;
  _produktRettelseIGang.add(ordreId);
  try {
    if (typeof ignorerRealtimeFor !== 'undefined') { ignorerRealtimeFor.add(ordreId); setTimeout(() => ignorerRealtimeFor.delete(ordreId), 10000); }
    if (typeof merkLokalOrdreEndring === 'function') merkLokalOrdreEndring(ordreId);
    const { data, error } = await db.rpc('legg_til_ordre_produkt_rettelse', { p_ordre_id: ordreId, p_rettelse: { handling, produktnummer: nr, navn: navn || null, portalId: portalId || null } });
    if (error) { visToast('Kunne ikke lagre rettelsen: ' + error.message); return; }
    o.produktRettelser = Array.isArray(data) ? data : o.produktRettelser;
    const tekst = handling === 'fjern' ? `Fjernet ${nr} fra «Skal på bilen»` : handling === 'legg_til' ? `La til ${nr} på «Skal på bilen»` : `Angret rettelse på ${nr}`;
    if (typeof logChange === 'function') logChange(o, tekst);
    await synkProduktliste(o, { tillatAngre: true });
  } finally {
    _produktRettelseIGang.delete(ordreId);
    renderSkalPaaBilen(ordreId);
  }
}

// ── Visning ─────────────────────────────────────────────────────────────────────────────────────────────────────
const _skalPaaBilenApneRett = new Set();
let _skalPaaBilenSok = { ordreId: null, tekst: '' };

function skalPaaBilenHTML(o) {
  const { rader, varsler, bestilt } = beregnSkalPaaBilen(o);
  const { produkter } = produktlisteModell(o);
  const ankommet = erAnkommet(o);
  const idJs = esc(o.id).replace(/'/g, "\\'");
  const pill = (txt, farge) => {
    const f = { gron: ['rgba(34,197,94,.12)', '#86efac', 'rgba(34,197,94,.35)'], gul: ['rgba(245,158,11,.12)', '#fbbf24', 'rgba(245,158,11,.4)'], bla: ['rgba(59,130,246,.12)', '#93c5fd', 'rgba(59,130,246,.4)'], gra: ['#18181b', '#a1a1aa', '#27272a'] }[farge];
    return `<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:${f[0]};color:${f[1]};border:1px solid ${f[2]}">${esc(txt)}</span>`;
  };
  const radHTML = r => {
    const nrJs = esc(r.nr).replace(/'/g, "\\'");
    const opp = r.oppskrift;
    let status = '';
    if (r.fjernet) status = pill('Fjernet', 'gra');
    else if (r.oppskriftViaNr) status = pill(`Deler i ${r.oppskriftViaNr}`, 'gra');
    else if (!opp) status = pill(r.oppskriftFlere ? `${r.oppskriftFlere} oppskrifter` : 'Ingen oppskrift', 'gra');
    else if (produktlisteTrukket(o, opp.id)) status = pill('Trukket fra lager', 'gron');
    else {
      // Manglende deler vises også før ankomst, så de kan bestilles i tide.
      const m = produktlisteManglerDeler(opp);
      status = (ankommet ? pill('Trekkes nå', 'bla') : pill('Trekkes ved ankomst', 'bla')) + (m ? ' ' + pill(`${m} ${m === 1 ? 'del' : 'deler'} mangler på lager`, 'gul') : '');
    }
    const deler = opp && !r.oppskriftViaNr ? (opp.ingredienser || []).map(i => {
      const v = (S.lagervarer || []).find(x => x.id === i.vareId);
      return v ? `${esc(v.navn)} ${fmtAntall(i.antall)}` : null;
    }).filter(Boolean).join(' · ') : '';
    const typeTekst = r.rolle === 'personbil' ? 'Personbil' : r.rolle === 'lafinto' ? 'Lafinto' : r.rolle === 'ombygging' ? 'Ombygging' : r.type === 'variant' ? 'Variant' : r.type === 'losning' ? 'Løsning' : 'Tillegg';
    const apen = _skalPaaBilenApneRett.has(o.id + '|' + r.nr);
    const meny = !apen ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${r.kilde === 'ombygging'
        ? `<span class="small muted">Ombyggingen endres med Nytt/Brukt/Lafinto/Personbil-boksene over.</span>`
        : r.fjernet
          ? `<button class="btn sm" onclick="produktRettelse('${idJs}','angre','${nrJs}')">Legg tilbake</button>`
          : `<button class="btn sm red" onclick="produktRettelse('${idJs}','fjern','${nrJs}')">Fjern fra bilen</button>`}
      ${r.kilde === 'manuell' ? `<button class="btn sm" onclick="produktRettelse('${idJs}','angre','${nrJs}')">Angre (ta bort igjen)</button>` : ''}
      ${r.kilde === 'bestilling' && !r.fjernet ? `<span class="small muted">Linjen i Fakturering har bestillingens rabatt og fjernes der hvis den ikke skal faktureres.</span>` : ''}
    </div>`;
    return `<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 12px;border-radius:10px;background:#0f0f12;border:1px solid ${r.rettet ? 'rgba(245,158,11,.45)' : '#27272a'};${r.fjernet ? 'opacity:.6' : ''}">
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;font-size:13.5px;${r.fjernet ? 'text-decoration:line-through' : ''}">${esc(r.navn)} ${r.rettet ? pill('Rettet', 'gul') : ''}</div>
        <div style="font-family:ui-monospace,monospace;font-size:11px;color:#a1a1aa">${esc(r.nr)} · ${typeTekst}</div>
        <div style="font-size:11.5px;color:#a1a1aa;margin-top:2px">Valgt fordi: ${esc(r.fjernet && r.rettet ? `${r.grunn}. Fjernet av ${r.rettet.av} ${r.rettet.dato}` : r.grunn)}</div>
        ${deler ? `<div style="font-size:11.5px;color:#71717a;margin-top:2px">${deler}</div>` : ''}
        ${meny}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">${status}
        <button class="btn sm" onclick="skalPaaBilenVeksleRett('${idJs}','${nrJs}')">${apen ? 'Lukk' : 'Rett'}</button></div>
    </div>`;
  };
  const sok = _skalPaaBilenSok.ordreId === o.id ? _skalPaaBilenSok.tekst : null;
  const aktiveNr = new Set(rader.filter(r => !r.fjernet).map(r => r.nr));
  const treff = sok === null ? [] : produkter
    .filter(p => p.nummer_status === 'ok' && !aktiveNr.has(p.fiken_nummer))
    .filter(p => { const ord = _norm(sok).split(' ').filter(Boolean); const t = _norm(`${p.fiken_nummer} ${p.navn}`); return ord.every(w => t.includes(w)); })
    .slice(0, 8);
  const sokHTML = sok === null
    ? `<button class="btn sm" onclick="skalPaaBilenApneSok('${idJs}')">+ Legg til utstyr</button>`
    : `<div style="display:grid;gap:6px">
        <input id="skalPaaBilenSok_${esc(o.id)}" value="${esc(sok)}" placeholder="Søk på navn eller produktnummer (${produkter.length} produkter for modellen)" oninput="skalPaaBilenSok('${idJs}',this.value)" autocomplete="off">
        ${treff.map(p => `<button class="btn sm" style="text-align:left;justify-content:flex-start" onclick="produktRettelse('${idJs}','legg_til','${esc(p.fiken_nummer).replace(/'/g, "\\'")}','${esc(p.navn).replace(/'/g, "\\'")}','${esc(p.portal_id).replace(/'/g, "\\'")}');skalPaaBilenLukkSok()">${esc(p.fiken_nummer)} ${esc(p.navn)}</button>`).join('')}
        ${produkter.length ? '' : '<div class="small muted">Fant ingen produkter for denne modellen i portalen. Trykk «Hent produkter fra portalen» under Kontakter (admin).</div>'}
        <button class="btn sm" onclick="skalPaaBilenLukkSok()">Lukk søk</button>
      </div>`;
  return `<div class="card" style="display:grid;gap:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="card-title" style="margin:0">Skal på bilen</div>${bestilt ? pill('Fra portalen', 'bla') : ''}</div>
    ${varsler.map(v => `<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);border-radius:12px;padding:8px 10px;font-size:12px;color:#fbbf24">⚠ ${esc(v)}</div>`).join('')}
    ${rader.length ? rader.map(radHTML).join('') : '<div class="small muted">Ingenting valgt ennå. Huk av Nytt/Brukt kjøretøy, fyll ut «Har ved ankomst», eller legg til utstyr.</div>'}
    ${sokHTML}
    ${ankommet ? '' : '<div class="small muted">Delene trekkes fra lageret når bilen settes til «Ikke påbegynt» (ankommet).</div>'}
  </div>`;
}

function renderSkalPaaBilen(ordreId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  const el = document.getElementById('ordreLagerbruk_' + ordreId); if (!el) return;
  el.innerHTML = skalPaaBilenHTML(o);
}
function skalPaaBilenVeksleRett(ordreId, nr) {
  const k = ordreId + '|' + nr;
  if (_skalPaaBilenApneRett.has(k)) _skalPaaBilenApneRett.delete(k); else _skalPaaBilenApneRett.add(k);
  renderSkalPaaBilen(ordreId);
}
function skalPaaBilenApneSok(ordreId) {
  _skalPaaBilenSok = { ordreId, tekst: '' };
  renderSkalPaaBilen(ordreId);
  const el = document.getElementById('skalPaaBilenSok_' + ordreId); if (el) el.focus();
}
function skalPaaBilenSok(ordreId, tekst) {
  _skalPaaBilenSok = { ordreId, tekst: String(tekst || '').slice(0, 60) };
  renderSkalPaaBilen(ordreId);
  const el = document.getElementById('skalPaaBilenSok_' + ordreId);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function skalPaaBilenLukkSok() {
  const id = _skalPaaBilenSok.ordreId;
  _skalPaaBilenSok = { ordreId: null, tekst: '' };
  if (id) renderSkalPaaBilen(id);
}
