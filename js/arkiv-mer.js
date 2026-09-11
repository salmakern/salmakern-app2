// ════════════════════════════════════════════════════
// ARKIV
// ════════════════════════════════════════════════════
const ARKIV_PER_SIDE = 25;
let arkivFane = 'aktiv';         // 'aktiv' eller 'ferdig' - hvilken liste som vises
let arkivFakturertFilter = '';   // '', 'ikke' eller 'ja'
let arkivSide = 1;

// Generisk segmentkontroll (kapsel med knapper der bare én kan være valgt om gangen)
// i samme stil som resten av appen - gjenbrukt for både Aktive/Arkiv-fanene og
// fakturert-filteret.
function segmentKontrollHTML(valgt, valg, onclickNavn) {
  return `<div style="display:inline-flex;background:#0f0f12;border:1px solid #27272a;border-radius:999px;padding:4px;gap:2px;flex-wrap:wrap">
    ${valg.map(v => `<button onclick="${onclickNavn}('${v.verdi}')" style="border-radius:999px;padding:7px 14px;font-size:13px;cursor:pointer;border:1px solid transparent;font-family:inherit;white-space:nowrap;${v.verdi===valgt?'background:rgba(239,68,68,.12);border-color:#ef4444;color:#fca5a5;font-weight:700':'background:transparent;color:#a1a1aa'}">${esc(v.label)}</button>`).join('')}
  </div>`;
}

function settArkivFane(fane) {
  arkivFane = fane;
  arkivSide = 1;
  renderArkiv();
}
function settArkivFakturertFilter(verdi) {
  arkivFakturertFilter = verdi;
  arkivSide = 1;
  renderArkiv();
}
// Kalt fra søk/filter-feltenes egne oninput/onchange FØR renderArkiv() - egen
// funksjon (ikke bakt inn i renderArkiv) fordi den skal kjøres når brukeren endrer
// søk/filter, men IKKE hver gang renderArkiv() kjører av andre grunner (sanntid o.l.).
function arkivSideTilbake() {
  arkivSide = 1;
}
function arkivBladre(retning) {
  arkivSide += retning;
  renderArkiv();
  const listeEl = document.getElementById('arkivListe');
  if (listeEl) window.scrollTo(0, listeEl.getBoundingClientRect().top + window.scrollY - 70);
}
function nullstillArkivFiltre() {
  const sokFelt = document.getElementById('arkivSok');
  if (sokFelt) sokFelt.value = '';
  arkivFakturertFilter = '';
  arkivSide = 1;
  renderArkiv();
}

function renderArkiv() {
  const erAdmin = me && me.rolle === 'admin';
  const q=(document.getElementById('arkivSok')?.value||'').toLowerCase().trim();
  const match=o=>!q||o.regnr?.toLowerCase().includes(q)||o.kunde?.toLowerCase().includes(q)||o.chassis?.toLowerCase().includes(q)||o.eier?.toLowerCase().includes(q);

  const aktiveTotal = S.ordrer.filter(o=>o.status==='aktiv').length;
  const ferdigTotal = S.ordrer.filter(o=>o.status==='arkivert').length;

  const aktive=S.ordrer.filter(o=>o.status==='aktiv'&&match(o)).sort(sorterOrdre);

  let ferdig=S.ordrer.filter(o=>o.status==='arkivert'&&match(o))
    .sort((a,b) => (b.ankomstdato||'').localeCompare(a.ankomstdato||''));
  if (arkivFakturertFilter === 'ikke') ferdig = ferdig.filter(o=>!o.fakturert);
  else if (arkivFakturertFilter === 'ja') ferdig = ferdig.filter(o=>!!o.fakturert);

  const faneEl = document.getElementById('arkivFaneRad');
  if (faneEl) faneEl.innerHTML = segmentKontrollHTML(arkivFane, [
    {verdi:'aktiv', label:`Aktive ${aktiveTotal}`},
    {verdi:'ferdig', label:`Arkiv ${ferdigTotal}`}
  ], 'settArkivFane');

  const filtreEl = document.getElementById('arkivFiltreRad');
  if (filtreEl) filtreEl.innerHTML = segmentKontrollHTML(arkivFakturertFilter, [
    {verdi:'', label:'Alle'},
    {verdi:'ikke', label:'Ikke fakturert'},
    {verdi:'ja', label:'Fakturert'}
  ], 'settArkivFakturertFilter');

  const gjeldendeListe = arkivFane === 'aktiv' ? aktive : ferdig;
  const gjeldendeTotal = arkivFane === 'aktiv' ? aktiveTotal : ferdigTotal;

  const treffEl = document.getElementById('arkivTreffAntall');
  if (treffEl) treffEl.textContent = `${gjeldendeListe.length} av ${gjeldendeTotal} ordrer`;
  const harAktivtFilter = !!q || arkivFakturertFilter !== '';
  const nullstillBtn = document.getElementById('arkivNullstillBtn');
  if (nullstillBtn) nullstillBtn.style.display = harAktivtFilter ? '' : 'none';

  const antallSider = Math.max(1, Math.ceil(gjeldendeListe.length / ARKIV_PER_SIDE));
  if (arkivSide > antallSider) arkivSide = antallSider;
  if (arkivSide < 1) arkivSide = 1;
  const startIdx = (arkivSide-1) * ARKIV_PER_SIDE;
  const sideListe = gjeldendeListe.slice(startIdx, startIdx + ARKIV_PER_SIDE);

  const listeEl = document.getElementById('arkivListe');
  if (listeEl) {
    if (arkivFane === 'aktiv') {
      listeEl.innerHTML = sideListe.length ? sideListe.map(o=>{
        const si=statusInfo(o.ordreStatus);
        return `<div style="border:1px solid ${si.border};border-radius:18px;padding:14px 16px;margin-bottom:8px;cursor:pointer;background:#18181b" onclick="openOrdre('${o.id}',true)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <b style="font-size:15px">${ordreLabelFull(o)}</b>
            <span style="background:${si.bg};color:${si.txt};border:1px solid ${si.border};border-radius:999px;padding:4px 11px;font-size:11px;font-weight:700;flex-shrink:0">${si.lbl}</span>
          </div>
          <div class="box" style="margin-top:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px">
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Forhandler</span><span>${esc(o.kunde)||'—'}</span></div>
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Ankomst</span><span>${o.ankomstdato||'—'}</span></div>
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Utstyr</span><span style="color:${o.utstyr?.skalHa?'#f4f4f5':'#71717a'}">${o.utstyr?.skalHa?esc(o.utstyr.skalHa).replace(/\n/g,', '):'—'}</span></div>
          </div>
        </div>`;
      }).join('') : '<div class="muted small">Ingen</div>';
    } else {
      listeEl.innerHTML = sideListe.length ? sideListe.map(o=>`<div class="box" style="margin-bottom:8px;padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div style="min-width:0">
              <b style="font-size:15px">${ordreLabelFull(o)}</b>
              ${o.farge?`<div class="small muted" style="margin-top:2px">${esc(o.farge)}</div>`:''}
            </div>
            ${o.fakturert
              ?`<span class="pill ok" style="margin:0;font-size:11px;padding:4px 11px;flex-shrink:0">✔ Fakturert</span>`
              :`<span class="pill bad" style="margin:0;font-size:11px;padding:4px 11px;flex-shrink:0">Ikke fakturert</span>`}
          </div>

          <div style="display:flex;flex-direction:column;gap:3px;margin-top:10px">
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Forhandler</span><span>${esc(o.kunde)||'—'}</span></div>
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Ankomst</span><span>${o.ankomstdato||'—'}</span></div>
            <div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Utstyr</span><span style="color:${o.utstyr?.skalHa?'#f4f4f5':'#71717a'}">${o.utstyr?.skalHa?esc(o.utstyr.skalHa).replace(/\n/g,', '):'—'}</span></div>
            ${drivstoffKundeprisTekst(o)?`<div style="display:flex;align-items:baseline;gap:8px;font-size:12.5px"><span class="muted" style="min-width:74px">Drivstoff</span><span>${drivstoffKundeprisTekst(o)}</span></div>`:''}
          </div>

          <div style="margin-top:12px;padding-top:11px;border-top:1px solid #27272a;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" onclick="openOrdre('${o.id}',true)">Åpne</button>
            <button class="btn sm" onclick="genPDF('${o.id}')">📄 PDF</button>
            ${erAdmin?`<button class="btn sm" onclick="gjenopprett('${o.id}')">Gjenopprett</button>`:''}
            <span style="flex:1"></span>
            ${erAdmin ? (o.fakturert
              ?`<button class="btn sm" onclick="toggleFakturert('${o.id}')">Fjern fakturert</button>`
              :`<button class="btn sm red" onclick="toggleFakturert('${o.id}')">✔ Merk fakturert</button>`) : ''}
          </div>
        </div>`).join('') : `<div class="muted small">${harAktivtFilter ? 'Ingen treff' : 'Ingen arkiverte ordrer'}</div>`;
    }
  }

  const pagEl = document.getElementById('arkivPaginering');
  if (pagEl) {
    if (gjeldendeListe.length > ARKIV_PER_SIDE) {
      pagEl.style.display = 'flex';
      const sideLbl = document.getElementById('arkivSideLbl');
      if (sideLbl) sideLbl.textContent = `Side ${arkivSide} av ${antallSider}`;
      const forrigeBtn = document.getElementById('arkivForrigeBtn');
      const nesteBtn = document.getElementById('arkivNesteBtn');
      if (forrigeBtn) forrigeBtn.disabled = arkivSide <= 1;
      if (nesteBtn) nesteBtn.disabled = arkivSide >= antallSider;
    } else {
      pagEl.style.display = 'none';
    }
  }
}

function visKundeHistorikk(kunde) {
  const ordrer = S.ordrer.filter(o => (o.kunde||'').toLowerCase() === kunde.toLowerCase())
    .sort((a,b) => (b.ankomstdato||'').localeCompare(a.ankomstdato||''));
  const el = document.getElementById('kundeHistorikkInnhold');
  document.getElementById('kundeHistorikkTittel').textContent = '📋 ' + kunde;
  el.innerHTML = ordrer.length ? ordrer.map(o => {
    const si = statusInfo(o.ordreStatus);
    return `<div class="box" style="margin-bottom:8px;cursor:pointer" onclick="closeModal('kundeHistorikk');openOrdre('${o.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <b>${ordreLabel(o)}</b>
        <span style="background:${si.bg};color:${si.txt};border:1px solid ${si.border};border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700">${si.lbl}</span>
      </div>
      <div class="small muted" style="margin-top:4px">${esc(o.merke)} ${esc(o.type)} ${esc(o.variant)}</div>
      <div class="small muted">${o.ankomstdato||'Ingen dato'} · ${o.status==='arkivert'?'Arkivert':'Aktiv'}</div>
    </div>`;
  }).join('') : '<div class="muted small">Ingen ordrer funnet for denne kunden.</div>';
  openModal('kundeHistorikk');
}

function slettOrdre(id) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  if (!confirm(`Sikker på at du vil slette ordren for ${ordreLabel(o)}?\n\nDette kan ikke angres.`)) return;
  // Finn den tilhørende Admin-ark-raden (samme år + chassis-nr, case-uavhengig) slik at
  // den slettes sammen med ordren - ellers blir den stående igjen som en "løs" rad som
  // aldri finner tilbake til noen ordre (og dukker opp i Helsesjekk som om det var en
  // skrivefeil, når det egentlig bare er rester etter en slettet ordre).
  const aar = o.ankomstdato ? Number(String(o.ankomstdato).slice(0,4)) : null;
  const arkRad = o.chassis ? (S.adminArk||[]).find(r => r.aar === aar && samsvarerChassis(r.chassisNr, o.chassis)) : null;

  // Var denne ordren PRIMÆR i en flåte, gjør den som ligger rett under den i samme
  // sorterte rekkefølge som vises i flåte-detaljen til ny primær - fins ingen "under",
  // faller den tilbake på den som nå ble sist. Er flåten tom etter dette, nullstilles
  // primæren (ingen igjen å velge blant).
  let flate = null;
  if (o.flateId) {
    const f = (S.flater||[]).find(x=>x.id===o.flateId);
    if (f && f.primaerOrdreId === o.id) {
      const medlemmer = S.ordrer.filter(x=>x.flateId===f.id).sort(sorterOrdre);
      const idx = medlemmer.findIndex(x=>x.id===o.id);
      const gjenvarende = medlemmer.filter(x=>x.id!==o.id);
      const nyPrimaer = gjenvarende[idx] || gjenvarende[idx-1] || null;
      f.primaerOrdreId = nyPrimaer ? nyPrimaer.id : null;
      flate = f;
    }
  }

  S.ordrer = S.ordrer.filter(x=>x.id!==id);
  S.timer  = S.timer.filter(t=>t.ordreId!==id);
  if (arkRad) S.adminArk = S.adminArk.filter(r=>r.id!==arkRad.id);
  if (db) {
    db.from('ordrer').delete().eq('id',id).then(r=>{if(r.error)console.error(r.error.message)});
    if (arkRad) db.from('admin_ark').delete().eq('id',arkRad.id).then(r=>{if(r.error)console.error('Kunne ikke slette admin-ark-rad:',r.error.message)});
    if (flate) db.from('flater').update({primaer_ordre_id:flate.primaerOrdreId}).eq('id',flate.id).then(r=>{if(r.error)console.error('Kunne ikke oppdatere flåtens primær-ordre:',r.error.message)});
    slettOrdreStorageFiler(id);
  }
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  tilbakeOrdreList(); renderAll();
}

async function gjenopprett(id) {
  if (!me || me.rolle !== 'admin') return;
  const o=S.ordrer.find(x=>x.id===id); if(!o) return;
  o.status='aktiv';
  const endring = {av:me?.navn||'?', tid:new Date().toLocaleString('no'), txt:'Gjenopprettet'};
  o.endringer.push(endring);
  let feil = null;
  if (db) {
    const { error } = await db.from('ordrer').update({status:o.status, endringer:o.endringer}).eq('id', id);
    if (error) feil = error.message;
  }
  if (feil) {
    o.status='arkivert';
    o.endringer = o.endringer.filter(e=>e!==endring);
    visToast('Kunne ikke gjenopprette ordren: ' + feil + ' — prøv igjen.');
    return;
  }
  renderArkiv(); renderOversikt();
}

// ════════════════════════════════════════════════════
// MER
// ════════════════════════════════════════════════════
function renderMer() {
  const erAdmin = me && me.rolle === 'admin';
  const erGodkjenner = me && (me.rolle === 'godkjenner' || me.rolle === 'admin');
  oppdaterVarselKnapp();

  // Vis/skjul admin-only kort
  document.getElementById('merAnsatteKort').style.display = erAdmin ? 'block' : 'none';
  document.getElementById('merPINKort').style.display     = erAdmin ? 'block' : 'none';
  document.getElementById('merGodkjKort').style.display   = erGodkjenner ? 'block' : 'none';
  document.getElementById('merHelsesjekkKort').style.display = erAdmin ? 'block' : 'none';
  // Seksjonsoverskrift+gruppe for "Rapporter" og "Oppsett og verktøy" vises kun
  // hvis minst ett kort inni faktisk er synlig - begge grupperingene er 100% admin-only.
  document.getElementById('merSeksjonAnsatte').style.display = erAdmin ? 'block' : 'none';
  document.getElementById('merGruppeAnsatte').style.display  = erAdmin ? 'grid'  : 'none';
  document.getElementById('merSeksjonOppsett').style.display = erAdmin ? 'block' : 'none';
  document.getElementById('merGruppeOppsett').style.display  = erAdmin ? 'block' : 'none';

  if (erAdmin) {
    const ukoblet = finnUkobledeAdminArkRader();
    document.getElementById('helsesjekkUkoblet').innerHTML = ukoblet.length
      ? ukoblet.map(r=>`<div class="box" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div><b>${esc(r.chassisNr)}</b> <span class="small muted">(${r.aar}${r.forhandler?' · '+esc(r.forhandler):''})</span></div>
          <button class="btn sm" onclick="apneUkobletAdminArkRad(${r.aar})">Åpne i Admin-ark</button>
        </div>`).join('')
      : '<div class="muted small">Ingen ukoblede rader funnet</div>';
    const pinEl = document.getElementById('dagensPINVal');
    if (pinEl) {
      const pin = (S.dagensPIN || '----').padEnd(4, '-').slice(0, 4);
      pinEl.innerHTML = [...pin].map(s => `<span class="pin-siffer">${esc(s)}</span>`).join('');
    }
    const gpsEl = document.getElementById('gpsStatus');
    const radEl = document.getElementById('gpsRadius');
    if (gpsEl) gpsEl.textContent = S.gps?.lat
      ? `Lokasjon satt: ${S.gps.lat.toFixed(5)}, ${S.gps.lng.toFixed(5)}`
      : 'Ingen lokasjon satt ennå';
    // Ikke overskriv mens feltet er fokusert - ellers "stjeler" en sanntidsoppdatering
    // (f.eks. en annen ansatt som logger inn med PIN, som trigger renderMer() via
    // ansatte-tabellens realtime-abonnement) verdien midt i redigering.
    if (radEl && document.activeElement !== radEl) radEl.value = S.gps?.radius || 300;
    const al = document.getElementById('ansatteListe');
    al.innerHTML = S.ansatte.map(a=>`<div class="box" style="margin-bottom:6px"><div class="row" style="flex-wrap:wrap;gap:6px">
      <div><b>${esc(a.navn)}</b>${!a.aktiv?' <span class="small err-text">Inaktiv</span>':''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select onchange="endreAnsattRolle(${a.id},this.value)" style="width:auto;padding:5px 8px;font-size:12px">
          <option value="ansatt" ${a.rolle==='ansatt'?'selected':''}>Ansatt</option>
          <option value="godkjenner" ${a.rolle==='godkjenner'?'selected':''}>Godkjenner</option>
          <option value="admin" ${a.rolle==='admin'?'selected':''}>Admin</option>
        </select>
        <button class="btn sm" onclick="toggleKanForeLonn(${a.id})" title="Timer-tilgang">${a.kanForeLonn===false?'⏱ Timer av':'⏱ Timer på'}</button>
        <button class="btn sm" onclick="toggleAnsatt(${a.id})">${a.aktiv?'Deaktiver':'Aktiver'}</button>
        <button class="btn sm" onclick="slettAnsatt(${a.id})" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">Slett</button>
      </div>
    </div></div>`).join('');
  }

  if (erGodkjenner) {
    const klar=S.ordrer.filter(o=>tvangsflyt(o).every(t=>t.ok)&&!o.godkjent&&o.status==='aktiv');
    document.getElementById('tilGodkj').innerHTML=klar.length
      ?klar.map(o=>`<div class="box" style="margin-bottom:6px"><b>${ordreLabel(o)}</b> er klar for godkjenner. <button class="btn sm" style="margin-left:8px" onclick="openOrdre('${o.id}')">Åpne</button></div>`).join('')
      :'<div class="muted small">Ingen ordrer venter på godkjenning</div>';
  }

  const fravarIDag=S.timer.filter(t=>{
    const d=new Date().toISOString().split('T')[0];
    return t.dato===d&&['syk','egenmelding','ferie','permisjon'].includes(t.type);
  });
  document.getElementById('fravarIDag').innerHTML=fravarIDag.length
    ?fravarIDag.map(t=>`<div class="box" style="margin-bottom:6px"><b>${t.ansatt}</b> – ${t.type}</div>`).join('')
    :'<div class="muted small">Ingen fravær registrert i dag</div>';

  // Rollebasert synlighet
  // Ansatt: Beskjeder, Kontakter, Fraværskalender, HMS-logg
  // Godkjenner: + Timer og overtid
  // Admin: alt
  document.getElementById('merTimerOversikt').style.display = erGodkjenner ? 'block' : 'none';
  document.getElementById('merOrdreRapport').style.display    = erAdmin ? 'block' : 'none';
  document.getElementById('merDrivstoffSatser').style.display = erAdmin ? 'block' : 'none';
  document.getElementById('merUtstyrMaler').style.display     = erAdmin ? 'block' : 'none';
  document.getElementById('merMigreringKort').style.display   = erAdmin ? 'block' : 'none';
  if (erAdmin) {
    const statusEl = document.getElementById('supabaseKoblingStatus');
    if (statusEl) {
      if (db) {
        statusEl.innerHTML = '<span class="ok-text">✓ Supabase er tilkoblet – klar til opplasting</span>';
        document.getElementById('migrerBtn').disabled = false;
      } else {
        statusEl.innerHTML = '<span class="err-text">⚠️ Supabase er ikke tilkoblet. Gå til <b>app.supabase.com</b> og gjenopprett prosjektet, last siden på nytt etterpå.</span>';
        document.getElementById('migrerBtn').disabled = true;
      }
    }
  }

  renderBeskjeder();
  renderFravarKalender();
  renderHMS();
  renderMoterListe();
  renderGodkjennerChat();
  if (erGodkjenner) { if (stempelkortAktiv) renderStempelkort(); else if (statVis==='aar') renderAarsStatistikk(); else renderTimerOversikt(); }
  if (erAdmin) {
    renderOrdreRapport(); renderDrivstoffSatser(); renderUtstyrMaler();
    const dsEl = document.getElementById('drivstoffSatsAntall');
    if (dsEl) { const n = (S.drivstoffSatser||[]).length; dsEl.textContent = `${n} sats${n===1?'':'er'}`; }
    const umEl = document.getElementById('utstyrMalAntall');
    if (umEl) { const n = (S.utstyrMaler||[]).length; umEl.textContent = `${n} mal${n===1?'':'er'}`; }
  }
}

// Drivstoff-satser og Utstyr-maler var før inline lister direkte på Mer-siden - flyttet
// til egne visninger (samme "klikk inn i detalj"-mønster som Lager) siden Mer-siden ble
// for full av innhold man sjelden trenger å se med det samme.
function visMerDrivstoffSatser() {
  document.getElementById('merHovedView').style.display = 'none';
  document.getElementById('merDrivstoffSatserView').style.display = 'block';
  renderDrivstoffSatser();
  window.scrollTo(0, 0);
}
function visMerUtstyrMaler() {
  document.getElementById('merHovedView').style.display = 'none';
  document.getElementById('merUtstyrMalerView').style.display = 'block';
  renderUtstyrMaler();
  window.scrollTo(0, 0);
}
function tilbakeFraMerDetalj() {
  document.getElementById('merDrivstoffSatserView').style.display = 'none';
  document.getElementById('merUtstyrMalerView').style.display = 'none';
  document.getElementById('merHovedView').style.display = 'block';
}

// Admin-ark-rader med et chassis-nr som er skrevet inn, men som ikke matcher NOEN ordre
// (samsvarerChassis er samme case-uavhengige sammenligning som selve Admin-ark bruker) -
// typisk en skrivefeil et sted, siden raden da aldri kobles til riktig bil/ordre.
// Arkiverte rader (låste, gamle år) hoppes over - de er historikk, ikke noe å rette nå.
function finnUkobledeAdminArkRader() {
  // Radene fra engangsimporten av historiske ordre (id-prefiks ark_import2026_, se
  // supabase/README.md-historikken/CLAUDE.md) er BEVISST uten tilknyttet ordre - de skal
  // ikke drukne ekte, ferske ukoblede rader i denne lista.
  return (S.adminArk||[])
    .filter(r => !r.arkivert && r.chassisNr && !r.id.startsWith('ark_import2026_') && !S.ordrer.some(o => samsvarerChassis(o.chassis, r.chassisNr)))
    .sort((a,b) => b.aar - a.aar);
}
function apneUkobletAdminArkRad(aar) {
  adminArkAar = aar;
  showPage('admin', document.getElementById('adminTab'));
}

// ════════════════════════════════════════════════════
// MØTER
// ════════════════════════════════════════════════════
function renderMoterListe() {
  const kortEl = document.getElementById('merMoterKort');
  if (kortEl) kortEl.style.display = (me && me.rolle === 'admin') ? 'block' : 'none';
  const el = document.getElementById('moterListe');
  if (!el) return;
  const idag = new Date().toISOString().split('T')[0];
  const kommende = (S.moter||[]).filter(m => m.dato >= idag).sort((a,b) => (a.dato+a.tid).localeCompare(b.dato+b.tid));
  const aktiveIder = (S.ansatte||[]).filter(a => a.aktiv).map(a => a.id);
  el.innerHTML = kommende.length ? kommende.map(m => {
    const valgteDekkerAlleAktive = aktiveIder.length > 0 && aktiveIder.every(id => (m.deltakerIder||[]).includes(id));
    const deltakerNavn = (m.deltakerIder||[]).length && !valgteDekkerAlleAktive
      ? (m.deltakerIder||[]).map(id => S.ansatte.find(a=>a.id===id)?.navn).filter(Boolean).join(', ')
      : 'Alle';
    return `
    <div class="box" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><b>${esc(m.tittel)}</b><div class="small muted">${fmtDatoKort(m.dato)} kl. ${m.tid} · ${esc(deltakerNavn)}${m.opprettetAv?' · satt av '+esc(m.opprettetAv):''}</div></div>
      <button class="btn sm" onclick="slettMote('${m.id}')" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">Slett</button>
    </div>`;
  }).join('') : '<div class="muted small">Ingen kommende møter</div>';
}

// Bruker CSS grid på selve containeren (ikke flex per rad) - det garanterer at
// avkrysningsboksene havner i nøyaktig samme loddrette kolonne på alle rader,
// uansett om et navn bryter over to linjer eller ikke. "display:contents" på
// label-en gjør at den ikke lager sin egen boks, slik at navn/boks likevel blir
// direkte grid-elementer (rad-et er fortsatt klikkbart i sin helhet).
function renderMoteDeltakereValg() {
  const el = document.getElementById('mote_deltakere');
  if (!el) return;
  el.style.display = 'grid';
  el.style.gridTemplateColumns = '1fr auto';
  el.style.alignItems = 'center';
  el.style.columnGap = '10px';
  const rad = (navn, inputHtml, tykk) => `
    <label style="display:contents;cursor:pointer">
      <span style="padding:6px 0;border-bottom:1px solid ${tykk?'#3f3f46':'#27272a'};font-weight:${tykk?'700':'400'}">${navn}</span>
      <span style="padding:6px 0;border-bottom:1px solid ${tykk?'#3f3f46':'#27272a'};display:flex;justify-content:flex-end">${inputHtml}</span>
    </label>`;
  const rader = (S.ansatte||[]).filter(a => a.aktiv)
    .map(a => rad(a.navn, `<input type="checkbox" class="mote-deltaker-cb" value="${a.id}" onchange="oppdaterMoteVelgAlleStatus()">`))
    .join('');
  el.innerHTML = rad('Velg alle', `<input type="checkbox" id="mote_velg_alle" onchange="toggleMoteVelgAlle(this.checked)">`, true) + rader;
}
function toggleMoteVelgAlle(checked) {
  document.querySelectorAll('.mote-deltaker-cb').forEach(cb => cb.checked = checked);
}
function oppdaterMoteVelgAlleStatus() {
  const alle = [...document.querySelectorAll('.mote-deltaker-cb')];
  const velgAlleEl = document.getElementById('mote_velg_alle');
  if (velgAlleEl) velgAlleEl.checked = alle.length > 0 && alle.every(cb => cb.checked);
}
function apneNyttMoteModal() {
  renderMoteDeltakereValg();
  openModal('nyttMote');
}

async function opprettMote() {
  const tittel = document.getElementById('mote_tittel').value.trim();
  const dato = document.getElementById('mote_dato').value;
  const tid = document.getElementById('mote_tid').value;
  if (!tittel || !dato || !tid) { alert('Fyll inn tittel, dato og tid'); return; }
  const deltakerIder = [...document.querySelectorAll('.mote-deltaker-cb:checked')].map(cb => Number(cb.value));
  const mote = { id:'mote_'+Date.now(), tittel, dato, tid, opprettetAv: me?.navn||'', varslet:false, deltakerIder };
  S.moter = [...(S.moter||[]), mote];
  if (db) {
    const { error } = await db.from('moter').insert({ id:mote.id, tittel:mote.tittel, dato:mote.dato, tid:mote.tid, opprettet_av:mote.opprettetAv, varslet:false, deltaker_ider:deltakerIder });
    if (error) { visToast('Kunne ikke lagre møtet: ' + error.message); S.moter = S.moter.filter(m => m.id !== mote.id); return; }
  }
  fetch(SUPA_URL + '/functions/v1/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY },
    body: JSON.stringify({ type: 'nytt_mote', tittel, dato, tid, deltakerIder })
  }).catch(e => console.warn('Nytt møte-varsel feilet:', e));
  closeModal('nyttMote');
  document.getElementById('mote_tittel').value = '';
  document.getElementById('mote_dato').value = '';
  document.getElementById('mote_tid').value = '09:00';
  renderMoterListe();
  renderOversikt();
}

// ════════════════════════════════════════════════════
// CHAT MELLOM ADMIN/GODKJENNERE
// ════════════════════════════════════════════════════
function apneGodkjennerChat() {
  renderGodkjennerChat();
  openModal('godkjennerChatModal');
  document.getElementById('godkjennerChatInput')?.focus();
}
// Kun Jan Henrik (id 17) av de to admin-kontoene skal ha tilgang til denne chatten - Jan
// Børre (den andre admin-kontoen) skal ikke se den. Se samme sperre i RLS-policyene for
// godkjenner_meldinger (migrasjon) og i send-push-funksjonens varsling.
const GODKJENNER_CHAT_ADMIN_ID = 17;
function renderGodkjennerChat() {
  const btnEl = document.getElementById('godkjennerChatBtn');
  const erGodkjenner = me && (me.rolle==='godkjenner' || (me.rolle==='admin' && me.id===GODKJENNER_CHAT_ADMIN_ID));
  if (btnEl) btnEl.style.display = erGodkjenner ? '' : 'none';
  if (!erGodkjenner) return;
  const el = document.getElementById('godkjennerChatMeldinger');
  if (!el) return;
  const meldinger = S.godkjennerMeldinger || [];
  el.innerHTML = meldinger.length ? meldinger.map(m => {
    const egen = m.avsenderId === me.id;
    const tid = m.createdAt ? new Date(m.createdAt).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div style="align-self:${egen?'flex-end':'flex-start'};max-width:80%;background:${egen?'rgba(239,68,68,.14)':'#0f0f12'};border:1px solid ${egen?'rgba(239,68,68,.35)':'#27272a'};border-radius:14px;padding:8px 12px">
      ${!egen?`<div class="small" style="font-weight:700;margin-bottom:2px">${esc(m.avsenderNavn)}</div>`:''}
      <div style="font-size:13.5px;white-space:pre-wrap;word-break:break-word">${esc(m.tekst)}</div>
      <div class="small muted" style="margin-top:3px;font-size:10.5px;text-align:${egen?'right':'left'}">${tid}</div>
    </div>`;
  }).join('') : '<div class="muted small">Ingen meldinger ennå</div>';
  el.scrollTop = el.scrollHeight;
}

async function sendGodkjennerMelding() {
  const input = document.getElementById('godkjennerChatInput');
  const tekst = input?.value.trim();
  if (!tekst || !me) return;
  input.value = '';
  input.disabled = true;
  const rad = { avsender_id: me.id, avsender_navn: me.navn, tekst };
  let feil = null;
  if (db) {
    const { data, error } = await db.from('godkjenner_meldinger').insert(rad).select().single();
    feil = error;
    if (!error && data) {
      if (!S.godkjennerMeldinger.find(m=>m.id===data.id)) S.godkjennerMeldinger.push(dbToGodkjennerMelding(data));
      renderGodkjennerChat();
      fetch(SUPA_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY },
        body: JSON.stringify({ type: 'godkjenner_melding', avsenderId: me.id, avsenderNavn: me.navn, tekst })
      }).catch(e => console.warn('Chat-varsel feilet:', e));
    }
  }
  input.disabled = false;
  input.focus();
  if (feil) { visToast('Kunne ikke sende meldingen: ' + feil.message); input.value = tekst; }
}

async function slettMote(id) {
  if (!confirm('Slette dette møtet?')) return;
  S.moter = (S.moter||[]).filter(m => m.id !== id);
  if (db) {
    const { error } = await db.from('moter').delete().eq('id', id);
    if (error) console.error('Kunne ikke slette møtet:', error.message);
  }
  renderMoterListe();
  renderOversikt();
}

let adminStatOffset = 0;
function adminStatNaviger(dir) { adminStatOffset += dir; if(stempelkortAktiv) renderStempelkort(); else if(statVis==='aar') renderAarsStatistikk(); else renderTimerOversikt(); }

function fmtTid(mins) {
  return `${Math.floor(mins/60)}t ${mins%60}m`;
}

function renderTimerOversikt() {
  const maanedNavn = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  const now = new Date();
  const dato = new Date(now.getFullYear(), now.getMonth() + adminStatOffset, 1);
  const prefix = `${dato.getFullYear()}-${String(dato.getMonth()+1).padStart(2,'0')}`;
  const lbl = document.getElementById('adminStatLbl');
  if (lbl) lbl.textContent = `${maanedNavn[dato.getMonth()]} ${dato.getFullYear()}`;

  let totalNormal=0, totalOt50=0, totalOt100=0, totalMins=0;
  const erAdm = me && me.rolle === 'admin';
  const GRID = 'grid-template-columns:minmax(0,2fr) repeat(3,minmax(52px,1fr)) minmax(0,1.2fr)';

  const rader = S.ansatte.filter(a=>a.aktiv && a.kanForeLonn!==false).map(a => {
    const timer = S.timer.filter(t => t.ansattId===a.id && t.dato?.startsWith(prefix));
    const arbTimer = timer.filter(t=>t.mins>0);
    const totMins = arbTimer.reduce((s,t)=>s+t.mins,0);
    const sykDager = timer.filter(t=>['syk','egenmelding'].includes(t.type)).length;
    const ferieDager = timer.filter(t=>t.type==='ferie').length;
    const permDager = timer.filter(t=>t.type==='permisjon').length;
    let normal=0, ot50=0, ot100=0;
    arbTimer.forEach(t=>{ const ot=beregnOvertid(t.mins,t.dato); normal+=ot.normal; ot50+=ot.ot50; ot100+=ot.ot100; });
    totalNormal+=normal; totalOt50+=ot50; totalOt100+=ot100; totalMins+=totMins;

    // Andel normal / 50% / 100% som én tynn stripe - gjør det synlig med ett blikk
    // hvem som har mye overtid, uten å måtte sammenligne tall.
    const sum = Math.max(1, normal+ot50+ot100);
    const stripe = `<div style="display:flex;height:4px;border-radius:999px;overflow:hidden;background:#27272a;margin-top:7px">
      <div style="width:${normal/sum*100}%;background:#52525b"></div>
      <div style="width:${ot50/sum*100}%;background:#facc15"></div>
      <div style="width:${ot100/sum*100}%;background:#f97316"></div>
    </div>`;

    const fravarTxt = [
      sykDager>0?`<span style="color:#fca5a5">${sykDager}d syk</span>`:'',
      ferieDager>0?`<span style="color:#86efac">${ferieDager}d ferie</span>`:'',
      permDager>0?`<span style="color:#93c5fd">${permDager}d perm</span>`:''
    ].filter(Boolean).join(' · ') || '<span class="muted">—</span>';

    return `<div class="box" style="margin-bottom:7px;padding:12px 14px;${erAdm?'cursor:pointer':''}" ${erAdm?`onclick="visAnsattDetalj(${a.id})"`:''}>
      <div style="display:grid;${GRID};gap:10px;align-items:center">
        <div style="min-width:0">
          <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.navn)}</div>
          <div class="small muted">${rolleVis(a.rolle)} · ${fmtTid(totMins)} totalt</div>
        </div>
        <div style="text-align:right"><div class="small muted" style="font-size:10px">NORMAL</div><div style="font-weight:700">${fmtTid(normal)}</div></div>
        <div style="text-align:right"><div class="small" style="font-size:10px;color:#fde68a">50%</div><div style="font-weight:700;color:#facc15">${ot50?fmtTid(ot50):'—'}</div></div>
        <div style="text-align:right"><div class="small" style="font-size:10px;color:#fed7aa">100%</div><div style="font-weight:700;color:#f97316">${ot100?fmtTid(ot100):'—'}</div></div>
        <div style="text-align:right;font-size:12px">${fravarTxt}</div>
      </div>
      ${stripe}
    </div>`;
  });

  const totalRad = totalMins > 0 ? `
    <div style="background:#18181b;border:1px solid #3f3f46;border-radius:18px;padding:16px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <b style="font-size:15px">Total – alle ansatte</b>
        <b style="font-size:22px;letter-spacing:-.5px">${fmtTid(totalMins)}</b>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="box" style="text-align:center;padding:12px">
          <div class="small muted" style="font-size:10px;letter-spacing:.6px">NORMAL TID</div>
          <div style="font-weight:800;font-size:19px;margin-top:3px">${fmtTid(totalNormal)}</div>
        </div>
        <div class="box" style="text-align:center;padding:12px;border-color:#facc1540">
          <div class="small" style="font-size:10px;letter-spacing:.6px;color:#fde68a">50% OVERTID</div>
          <div style="font-weight:800;font-size:19px;color:#facc15;margin-top:3px">${fmtTid(totalOt50)}</div>
        </div>
        <div class="box" style="text-align:center;padding:12px;border-color:#f9731640">
          <div class="small" style="font-size:10px;letter-spacing:.6px;color:#fed7aa">100% OVERTID</div>
          <div style="font-weight:800;font-size:19px;color:#f97316;margin-top:3px">${fmtTid(totalOt100)}</div>
        </div>
      </div>
    </div>` : '';

  document.getElementById('adminStatInnhold').innerHTML =
    `<div class="tallrad-scroll"><div>` +
    (rader.join('') || '<div class="muted small">Ingen timer registrert denne måneden</div>') +
    `</div></div>` + totalRad;
}

// ════════════════════════════════════════════════════
// ÅRSSTATISTIKK + EXCEL-EKSPORT
// ════════════════════════════════════════════════════
let statVis = 'maaned'; // 'maaned' eller 'aar'

function toggleStatVis() {
  statVis = statVis === 'maaned' ? 'aar' : 'maaned';
  const btn = document.getElementById('statVisBtn');
  const navBack = document.getElementById('statNavBack');
  const navFwd  = document.getElementById('statNavFwd');
  if (btn) btn.textContent = statVis === 'maaned' ? '📅 Måned' : '📆 År';
  if (navBack) navBack.style.display = statVis === 'maaned' ? '' : 'none';
  if (navFwd)  navFwd.style.display  = statVis === 'maaned' ? '' : 'none';
  if (btn) {
    const aar = statVis === 'aar';
    btn.style.color = aar ? '#fca5a5' : '';
    btn.style.fontWeight = aar ? '700' : '';
  }
  if (statVis === 'aar') renderAarsStatistikk();
  else renderTimerOversikt();
}

let stempelkortAktiv = false;
function toggleStempelkort() {
  stempelkortAktiv = !stempelkortAktiv;
  const btn = document.getElementById('stempelkortBtn');
  if (btn) {
    btn.style.background   = stempelkortAktiv ? 'rgba(239,68,68,.12)' : '';
    btn.style.borderColor  = stempelkortAktiv ? '#ef4444' : '';
    btn.style.color        = stempelkortAktiv ? '#fca5a5' : '';
  }
  if (stempelkortAktiv) renderStempelkort();
  else {
    if (statVis === 'aar') renderAarsStatistikk();
    else renderTimerOversikt();
  }
}

function renderStempelkort() {
  const el = document.getElementById('adminStatInnhold');
  if (!el) return;
  const now = new Date();
  const dato = new Date(now.getFullYear(), now.getMonth() + adminStatOffset, 1);
  const prefix = `${dato.getFullYear()}-${String(dato.getMonth()+1).padStart(2,'0')}`;
  const maanedNavn = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  document.getElementById('adminStatLbl').textContent = `${maanedNavn[dato.getMonth()]} ${dato.getFullYear()}`;

  const relevante = S.timer.filter(t => t.dato?.startsWith(prefix) && t.start && t.start !== '–');
  const datoer = [...new Set(relevante.map(t => t.dato))].sort().reverse();

  if (!datoer.length) { el.innerHTML = '<div class="muted small">Ingen stempelkort denne måneden</div>'; return; }

  const UKEDAG = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];

  el.innerHTML = `<div class="muted small" style="margin-bottom:10px">Rå inn/ut-klokking gruppert per dag. Én linje per ansatt som stemplet inn den dagen.</div>` +
    `<div class="tallrad-scroll"><div>` +
    datoer.map(dag => {
      const d = new Date(dag);
      const rader = relevante.filter(t => t.dato === dag).sort((a,b) => (a.start||'').localeCompare(b.start||''));
      const dagSum = rader.reduce((s,t)=>s+(t.mins||0),0);
      const helg = d.getDay()===0 || d.getDay()===6;

      const raderHTML = rader.map(t => `
        <div style="display:grid;grid-template-columns:minmax(0,2fr) 66px 66px minmax(0,1fr);gap:10px;align-items:center;padding:11px 15px;border-top:1px solid #ffffff08;font-size:13.5px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.ansatt||'?')}</span>
          <span style="color:#4ade80">▸ ${t.start}</span>
          <span style="color:#fca5a5">◂ ${t.stopp||'–'}</span>
          <span style="text-align:right;font-weight:700">${t.mins>0?fmtTid(t.mins):'—'}</span>
        </div>`).join('');

      return `<div class="box" style="padding:0;overflow:hidden;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 15px;border-bottom:1px solid #27272a">
          <div style="display:flex;align-items:baseline;gap:9px;min-width:0">
            <b style="font-size:15px">${d.getDate()}. ${maanedNavn[d.getMonth()].toLowerCase()}</b>
            <span class="small" style="color:${helg?'#fca5a5':'#71717a'}">${UKEDAG[d.getDay()].toLowerCase()}</span>
          </div>
          <div style="display:flex;gap:7px;flex-shrink:0">
            <span class="pill" style="margin:0;font-size:11px;padding:3px 10px">${rader.length} ansatt${rader.length===1?'':'e'}</span>
            <span class="pill" style="margin:0;font-size:11px;padding:3px 10px;color:#f4f4f5">${fmtTid(dagSum)}</span>
          </div>
        </div>
        ${raderHTML}
      </div>`;
    }).join('') + `</div></div>`;
}

function renderAarsStatistikk() {
  const lbl = document.getElementById('adminStatLbl');
  const el  = document.getElementById('adminStatInnhold');
  if (!el) return;
  const aar = new Date().getFullYear();
  if (lbl) lbl.textContent = `År ${aar}`;
  const maanedNavn = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
  const ansatte = S.ansatte.filter(a => a.aktiv && a.kanForeLonn!==false);

  const html = ansatte.map(a => {
    const maaneder = maanedNavn.map((mnavn, mi) => {
      const prefix = `${aar}-${String(mi+1).padStart(2,'0')}`;
      const timer = S.timer.filter(t => t.ansattId===a.id && t.dato?.startsWith(prefix) && t.mins>0);
      const mins = timer.reduce((s,t)=>s+t.mins, 0);
      return { mnavn, mins };
    });
    const maxMins = Math.max(1, ...maaneder.map(m=>m.mins));
    const totMins = maaneder.reduce((s,m)=>s+m.mins, 0);
    if (totMins === 0) return '';
    return `<div class="box" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>${a.navn}</b>
        <span class="small muted">${fmtTid(totMins)} totalt</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;align-items:flex-end;height:60px">
        ${maaneder.map(m=>`
          <div title="${m.mnavn}: ${fmtTid(m.mins)}" style="display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end">
            <div style="width:100%;background:${m.mins>0?'#ef4444':'#27272a'};border-radius:3px 3px 0 0;height:${m.mins>0?Math.max(4,Math.round(m.mins/maxMins*48)):2}px;transition:height 0.3s"></div>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;margin-top:2px">
        ${maaneder.map(m=>`<div class="small" style="text-align:center;font-size:9px;color:#71717a">${m.mnavn}</div>`).join('')}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = html || '<div class="muted small">Ingen timer registrert i år</div>';
}

function eksportExcel() {
  const maanedNavn=['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  const now = new Date();
  const prefix = statVis==='aar'
    ? String(now.getFullYear())
    : `${now.getFullYear()}-${String(now.getMonth()+1+adminStatOffset).padStart(2,'0')}`.replace(/(-\d+)$/, m => {
        const n = parseInt(m.slice(1));
        const y = now.getFullYear() + Math.floor((now.getMonth() + adminStatOffset)/12);
        const mo = ((now.getMonth() + adminStatOffset) % 12 + 12) % 12;
        return `-${String(mo+1).padStart(2,'0')}`;
      });

  // Enklere tilnærming: bruk adminStatOffset for å finne riktig måned
  const dato = new Date(now.getFullYear(), now.getMonth() + adminStatOffset, 1);
  const mPrefix = `${dato.getFullYear()}-${String(dato.getMonth()+1).padStart(2,'0')}`;
  const filPrefix = statVis==='aar' ? String(dato.getFullYear()) : mPrefix;
  const filNavn = statVis==='aar'
    ? `timer_${dato.getFullYear()}.csv`
    : `timer_${maanedNavn[dato.getMonth()]}_${dato.getFullYear()}.csv`;

  const timer = S.timer.filter(t => t.dato?.startsWith(filPrefix));
  if (!timer.length) { alert('Ingen timer i valgt periode'); return; }

  const rader = [];
  const ansatte = S.ansatte.filter(a=>a.aktiv && a.kanForeLonn!==false);
  ansatte.forEach(a => {
    const aTimer = timer.filter(t=>t.ansattId===a.id && t.mins>0)
      .sort((x,y)=>(x.dato||'').localeCompare(y.dato||''));
    if (!aTimer.length) return;
    rader.push([a.navn.toUpperCase()]);
    rader.push(['Dato','Type','Fra','Til','Timer (desimal)','Normal (t)','50% OT (t)','100% OT (t)']);
    let totNormal=0, totOt50=0, totOt100=0, totMins=0;
    aTimer.forEach(t => {
      const ot = beregnOvertid(t.mins||0, t.dato||'');
      totNormal+=ot.normal; totOt50+=ot.ot50; totOt100+=ot.ot100; totMins+=t.mins||0;
      rader.push([
        t.dato||'', t.type||'normal', t.start||'', t.stopp||'',
        ((t.mins||0)/60).toFixed(2).replace('.',','),
        (ot.normal/60).toFixed(2).replace('.',','),
        (ot.ot50/60).toFixed(2).replace('.',','),
        (ot.ot100/60).toFixed(2).replace('.',',')
      ]);
    });
    rader.push(['TOTAL','','','',
      (totMins/60).toFixed(2).replace('.',','),
      (totNormal/60).toFixed(2).replace('.',','),
      (totOt50/60).toFixed(2).replace('.',','),
      (totOt100/60).toFixed(2).replace('.',',')
    ]);
    rader.push([]);
  });

  const csv = rader.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = filNavn;
  a.click();
}

