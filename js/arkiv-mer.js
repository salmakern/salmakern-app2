// ════════════════════════════════════════════════════
// ARKIV
// ════════════════════════════════════════════════════
function renderArkiv() {
  const q=(document.getElementById('arkivSok')?.value||'').toLowerCase().trim();
  const match=o=>!q||o.regnr?.toLowerCase().includes(q)||o.kunde?.toLowerCase().includes(q)||o.chassis?.toLowerCase().includes(q)||o.eier?.toLowerCase().includes(q);
  const aktive=S.ordrer.filter(o=>o.status==='aktiv'&&match(o)).sort(sorterOrdre);
  const kunIkkeFakturert = document.getElementById('arkivFilterIkkeFakturert')?.checked;
  const kunFakturert = document.getElementById('arkivFilterFakturert')?.checked;
  let ferdig=S.ordrer.filter(o=>o.status==='arkivert'&&match(o))
    .sort((a,b) => (b.ankomstdato||'').localeCompare(a.ankomstdato||''));
  if (kunIkkeFakturert && !kunFakturert) ferdig = ferdig.filter(o=>!o.fakturert);
  else if (kunFakturert && !kunIkkeFakturert) ferdig = ferdig.filter(o=>!!o.fakturert);
  const fakturertAntall = ferdig.filter(o=>o.fakturert).length;
  const fakturertSammendrag = document.getElementById('arkivFakturertSammendrag');
  if (fakturertSammendrag) fakturertSammendrag.textContent = ferdig.length ? `${fakturertAntall} av ${ferdig.length} fakturert` : '';
  document.getElementById('arkivAktiv').innerHTML=aktive.length
    ?aktive.map(o=>{
      const si=statusInfo(o.ordreStatus);
      return `<div style="border:2px solid ${si.border};border-radius:12px;padding:10px;margin-bottom:6px;cursor:pointer;background:#111114" onclick="openOrdre('${o.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
          <b>${ordreLabelFull(o)}</b>
          <span style="background:${si.bg};color:${si.txt};border:1px solid ${si.border};border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700">${si.lbl}</span>
        </div>
        <div class="small muted" style="margin-top:3px">${o.type} ${o.variant} · ${o.kunde}</div>
        <div class="small muted">Ankomst: ${o.ankomstdato||'—'}</div>
        <div class="small muted">${o.utstyr?.skalHa?o.utstyr.skalHa.replace(/\n/g,', '):'—'}</div>
      </div>`;
    }).join('')
    :'<div class="muted small">Ingen</div>';
  document.getElementById('arkivFerdig').innerHTML=ferdig.length
    ?ferdig.map(o=>`<div class="box" style="margin-bottom:6px;padding:8px">
        <div class="row" style="margin-bottom:4px">
          <div><b>${ordreLabelFull(o)}</b> <span class="small muted">${o.type} ${o.variant}</span></div>
          <div style="display:flex;gap:3px">
            <button class="btn sm" onclick="openOrdre('${o.id}',true)" style="font-size:10px;padding:2px 7px;border-radius:8px">Åpne</button>
            <button class="btn sm" onclick="genPDF('${o.id}')" style="font-size:10px;padding:2px 7px;border-radius:8px">📄 PDF</button>
            <button class="btn sm" onclick="gjenopprett('${o.id}')" style="font-size:10px;padding:2px 7px;border-radius:8px">Gjenopprett</button>
          </div>
        </div>
        <div class="small muted">${o.kunde} · Ankomst: ${o.ankomstdato||'—'}</div>
        <div class="small muted">${o.utstyr?.skalHa?o.utstyr.skalHa.replace(/\n/g,', '):'—'}</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${o.fakturert
            ?`<span class="pill ok" style="font-size:11px">✔ Fakturert av ${o.fakturertAv}</span>
               <button class="btn sm" onclick="toggleFakturert('${o.id}')" style="font-size:11px;padding:4px 10px">Fjern fakturert</button>`
            :`<span class="pill bad" style="font-size:11px">Ikke fakturert</span>
               <button class="btn sm red" onclick="toggleFakturert('${o.id}')" style="font-size:11px;padding:4px 10px">✔ Merk fakturert</button>`}
        </div>
      </div>`).join('')
    :'<div class="muted small">Ingen arkiverte ordrer</div>';
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
      <div class="small muted" style="margin-top:4px">${o.merke||''} ${o.type||''} ${o.variant||''}</div>
      <div class="small muted">${o.ankomstdato||'Ingen dato'} · ${o.status==='arkivert'?'Arkivert':'Aktiv'}</div>
    </div>`;
  }).join('') : '<div class="muted small">Ingen ordrer funnet for denne kunden.</div>';
  openModal('kundeHistorikk');
}

function slettOrdre(id) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  if (!confirm(`Sikker på at du vil slette ordren for ${ordreLabel(o)}?\n\nDette kan ikke angres.`)) return;
  S.ordrer = S.ordrer.filter(x=>x.id!==id);
  S.timer  = S.timer.filter(t=>t.ordreId!==id);
  if (db) {
    db.from('ordrer').delete().eq('id',id).then(r=>{if(r.error)console.error(r.error.message)});
  }
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  tilbakeOrdreList(); renderAll();
}

function gjenopprett(id) {
  const o=S.ordrer.find(x=>x.id===id); if(!o) return;
  o.status='aktiv'; logChange(o,'Gjenopprettet');
  save(id); renderArkiv(); renderOversikt();
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

  if (erAdmin) {
    document.getElementById('dagensPINVal').textContent = S.dagensPIN;
    const gpsEl = document.getElementById('gpsStatus');
    const radEl = document.getElementById('gpsRadius');
    if (gpsEl) gpsEl.textContent = S.gps?.lat
      ? `Lokasjon satt: ${S.gps.lat.toFixed(5)}, ${S.gps.lng.toFixed(5)}`
      : 'Ingen lokasjon satt ennå';
    if (radEl) radEl.value = S.gps?.radius || 300;
    const al = document.getElementById('ansatteListe');
    al.innerHTML = S.ansatte.map(a=>`<div class="box" style="margin-bottom:6px"><div class="row" style="flex-wrap:wrap;gap:6px">
      <div><b>${a.navn}</b> <span class="small muted">${a.rolle}</span>${!a.aktiv?' <span class="small err-text">Inaktiv</span>':''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
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
  renderKontakter();
  renderFravarKalender();
  renderHMS();
  if (erGodkjenner) { if (stempelkortAktiv) renderStempelkort(); else if (statVis==='aar') renderAarsStatistikk(); else renderTimerOversikt(); }
  if (erAdmin) { renderOrdreRapport(); renderDrivstoffSatser(); renderUtstyrMaler(); }
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
    const erAdm = me && me.rolle === 'admin';
    return `<div class="box" style="margin-bottom:8px;${erAdm?'cursor:pointer':''}" ${erAdm?`onclick="visAnsattDetalj(${a.id})"`:''}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
        <div><b>${a.navn}</b> <span class="small muted">${a.rolle}</span>${erAdm?'<span class="small muted" style="font-size:10px"> ▶ detaljer</span>':''}</div>
        <div class="small" style="font-weight:700;color:#f4f4f5">${fmtTid(totMins)} totalt</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-top:8px">
        <div style="background:#18181b;border-radius:10px;padding:8px;text-align:center">
          <div class="small muted">Normal</div>
          <div style="font-weight:700;font-size:15px;margin-top:2px">${fmtTid(normal)}</div>
        </div>
        <div style="background:#42200688;border-radius:10px;padding:8px;text-align:center">
          <div class="small" style="color:#fde68a">50% overtid</div>
          <div style="font-weight:700;font-size:15px;color:#facc15;margin-top:2px">${fmtTid(ot50)}</div>
        </div>
        <div style="background:#43140788;border-radius:10px;padding:8px;text-align:center">
          <div class="small" style="color:#fed7aa">100% overtid</div>
          <div style="font-weight:700;font-size:15px;color:#f97316;margin-top:2px">${fmtTid(ot100)}</div>
        </div>
        ${sykDager>0||ferieDager>0||permDager>0?`<div style="background:#09090b;border-radius:10px;padding:8px;text-align:center">
          <div class="small muted">Fravær</div>
          <div style="font-size:13px;margin-top:2px">${sykDager>0?`<span style="color:#fca5a5">Syk: ${sykDager}d</span> `:''}${ferieDager>0?`<span style="color:#a1a1aa">Ferie: ${ferieDager}d</span> `:''}${permDager>0?`<span style="color:#93c5fd">Perm: ${permDager}d</span>`:''}</div>
        </div>`:''}
      </div>
    </div>`;
  });

  // Totallinje
  const totalRad = totalMins > 0 ? `
    <div style="background:#18181b;border:1px solid #3f3f46;border-radius:14px;padding:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="font-size:15px">Total – alle ansatte</b>
        <b style="font-size:15px">${fmtTid(totalMins)}</b>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        <div style="text-align:center">
          <div class="small muted">Normal</div>
          <div style="font-weight:800;font-size:16px;margin-top:2px">${fmtTid(totalNormal)}</div>
        </div>
        <div style="text-align:center">
          <div class="small" style="color:#fde68a">50% overtid</div>
          <div style="font-weight:800;font-size:16px;color:#facc15;margin-top:2px">${fmtTid(totalOt50)}</div>
        </div>
        <div style="text-align:center">
          <div class="small" style="color:#fed7aa">100% overtid</div>
          <div style="font-weight:800;font-size:16px;color:#f97316;margin-top:2px">${fmtTid(totalOt100)}</div>
        </div>
      </div>
    </div>` : '';

  document.getElementById('adminStatInnhold').innerHTML =
    (rader.join('') || '<div class="muted small">Ingen timer registrert denne måneden</div>') + totalRad;
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
  if (statVis === 'aar') renderAarsStatistikk();
  else renderTimerOversikt();
}

let stempelkortAktiv = false;
function toggleStempelkort() {
  stempelkortAktiv = !stempelkortAktiv;
  const btn = document.getElementById('stempelkortBtn');
  if (btn) btn.style.background = stempelkortAktiv ? '#3f1f6e' : '';
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
  const datoer = [...new Set(relevante.map(t => t.dato))].sort();

  if (!datoer.length) { el.innerHTML = '<div class="muted small">Ingen stempelkort denne måneden</div>'; return; }

  const dagerHTML = datoer.map(dag => {
    const ukedag = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'][new Date(dag).getDay()];
    const rader = relevante.filter(t => t.dato === dag).sort((a,b) => (a.start||'').localeCompare(b.start||''));
    const raderHTML = rader.map(t => {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:6px;background:#18181b;margin-bottom:3px;font-size:13px">
        <span style="min-width:120px;font-weight:600">${t.ansatt||'?'}</span>
        <span style="color:#86efac">${t.start}</span>
        <span class="muted" style="margin:0 4px">→</span>
        <span style="color:#a1a1aa">${t.stopp||'–'}</span>
        <span style="margin-left:8px;color:#f4f4f5;font-weight:600;min-width:60px;text-align:right">${t.mins>0?fmtTid(t.mins):''}</span>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:10px">
      <div class="small muted" style="font-weight:700;margin-bottom:4px">${ukedag} ${dag}</div>
      ${raderHTML}
    </div>`;
  }).join('');

  el.innerHTML = dagerHTML;
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

