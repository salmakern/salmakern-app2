// ════════════════════════════════════════════════════
// BESKJEDER
// ════════════════════════════════════════════════════
function lagreBeskjed() {
  const tekst = document.getElementById('bTekst').value.trim();
  if (!tekst) return;
  S.beskjeder.unshift({id:'b'+(++S.nextId), av:me.navn, avId:me.id, tekst, dato:new Date().toISOString()});
  saveInnstillinger();
  closeModal('nyBeskjed');
  document.getElementById('bTekst').value='';
  renderBeskjeder();
}

function slettBeskjed(id) {
  S.beskjeder = S.beskjeder.filter(b=>b.id!==id);
  saveInnstillinger();
  renderBeskjeder();
}

function renderBeskjeder() {
  const erAdmin = me && me.rolle==='admin';
  document.getElementById('merBeskjedAdminBtn').innerHTML = erAdmin
    ? '<button class="btn sm red" onclick="openModal(\'nyBeskjed\')">+ Ny beskjed</button>' : '';
  const el = document.getElementById('beskjedListe');
  if (!S.beskjeder.length) { el.innerHTML='<div class="muted small">Ingen beskjeder</div>'; return; }
  el.innerHTML = S.beskjeder.slice(0,10).map(b=>`
    <div class="box" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">${b.tekst.replace(/\n/g,'<br>')}</div>
        ${erAdmin?`<button onclick="slettBeskjed('${b.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:0">✕</button>`:''}
      </div>
      <div class="small muted" style="margin-top:6px">${b.av} · ${new Date(b.dato).toLocaleDateString('no',{day:'numeric',month:'short',year:'numeric'})}</div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════
// KONTAKTER
// ════════════════════════════════════════════════════
function lagreKontakt() {
  const navn = document.getElementById('kNavn').value.trim();
  if (!navn) { alert('Navn er påkrevd'); return; }
  S.kontakter.push({
    id:'k'+(++S.nextId),
    navn, type:document.getElementById('kType').value,
    tlf:document.getElementById('kTlf').value.trim(),
    epost:document.getElementById('kEpost').value.trim(),
    notat:document.getElementById('kNotat').value.trim()
  });
  saveInnstillinger();
  closeModal('nyKontakt');
  ['kNavn','kTlf','kEpost','kNotat'].forEach(i=>document.getElementById(i).value='');
  renderKontakter();
}

function slettKontakt(id) {
  S.kontakter = S.kontakter.filter(k=>k.id!==id);
  saveInnstillinger();
  renderKontakter();
}

function renderKontakter() {
  const erAdmin = me && me.rolle==='admin';
  document.getElementById('merKontaktAdminBtn').innerHTML = erAdmin
    ? '<button class="btn sm red" onclick="openModal(\'nyKontakt\')">+ Ny kontakt</button>' : '';
  const el = document.getElementById('kontaktListe');
  if (!S.kontakter.length) { el.innerHTML='<div class="muted small">Ingen kontakter lagt til</div>'; return; }
  el.innerHTML = S.kontakter.map(k=>`
    <div class="box" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div>
          <div><b>${k.navn}</b> <span class="pill" style="font-size:11px;padding:2px 8px">${k.type}</span></div>
          ${k.tlf?`<div class="small" style="margin-top:4px">📞 <a href="tel:${k.tlf}" style="color:#ef4444;font-weight:600;text-decoration:none">${k.tlf}</a></div>`:''}
          ${k.epost?`<div class="small">✉ <a href="mailto:${k.epost}" style="color:#a1a1aa;text-decoration:none">${k.epost}</a></div>`:''}
          ${k.notat?`<div class="small muted" style="margin-top:4px">${k.notat}</div>`:''}
        </div>
        ${erAdmin?`<button onclick="slettKontakt('${k.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:0">✕</button>`:''}
      </div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════
// FRAVÆRSKALENDER
// ════════════════════════════════════════════════════
function renderFravarKalender() {
  const el = document.getElementById('fravarKalender');
  const now = new Date();
  const days = [];
  for (let i=0; i<14; i++) {
    const d = new Date(now); d.setDate(now.getDate()+i);
    days.push(d.toISOString().split('T')[0]);
  }
  const rows = days.map(dato => {
    const dag = new Date(dato).getDay();
    if (dag===0||dag===6) return null;
    const fravær = S.timer.filter(t=>t.dato===dato&&['syk','egenmelding','ferie','permisjon'].includes(t.type));
    if (!fravær.length) return null;
    const datoFmt = new Date(dato).toLocaleDateString('no',{weekday:'short',day:'numeric',month:'short'});
    return `<div class="box" style="margin-bottom:6px">
      <div class="small" style="font-weight:700;margin-bottom:4px">${datoFmt}</div>
      ${fravær.map(f=>`<div class="small muted">${f.ansatt} · <span style="color:#fde68a">${f.type}</span></div>`).join('')}
    </div>`;
  }).filter(Boolean);
  el.innerHTML = rows.length ? rows.join('') : '<div class="muted small">Ingen registrert fravær de neste 14 dagene</div>';
}


// ════════════════════════════════════════════════════
// ORDRERAPPORT
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// ORDRERAPPORT – navigering
// ════════════════════════════════════════════════════
let rapportOffset = 0;
function rapportNaviger(dir) {
  rapportOffset += dir;
  if (rapportOffset > 0) rapportOffset = 0;
  renderOrdreRapport();
}

function renderOrdreRapport() {
  const el = document.getElementById('ordreRapportInnhold'); if(!el) return;
  const elAar = document.getElementById('ordreRapportAarTotal');
  const lbl = document.getElementById('rapportLbl');
  const maanedNavn=['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
  const now = new Date();
  // Vis 6 måneder sentrert rundt rapportOffset (0=nå, -1=forrige halvår osv)
  const sentrerMaaned = new Date(now.getFullYear(), now.getMonth() + rapportOffset*6, 1);
  const rapporter = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(sentrerMaaned.getFullYear(), sentrerMaaned.getMonth()-i, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const ordrer = S.ordrer.filter(o=>o.ankomstdato?.startsWith(prefix));
    const ferdig = ordrer.filter(o=>o.godkjent).length;
    rapporter.push({lbl:`${maanedNavn[d.getMonth()]} ${d.getFullYear()}`,tot:ordrer.length,ferdig,aar:d.getFullYear()});
  }
  if (lbl) lbl.textContent = `${maanedNavn[sentrerMaaned.getMonth()-5<0?0:sentrerMaaned.getMonth()-5]} – ${maanedNavn[sentrerMaaned.getMonth()]} ${sentrerMaaned.getFullYear()}`;
  const maxTot = Math.max(1, ...rapporter.map(r=>r.tot));
  el.innerHTML = rapporter.map(r=>`
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span class="small">${r.lbl}</span>
        <span class="small muted">${r.tot} biler · ${r.ferdig} ferdig</span>
      </div>
      <div style="background:#27272a;border-radius:6px;height:10px;overflow:hidden">
        <div style="height:100%;background:#ef4444;width:${Math.round(r.tot/maxTot*100)}%;border-radius:6px;transition:width 0.3s"></div>
      </div>
    </div>`).join('');
  // Årstotal for siste år i visningen
  const visAar = sentrerMaaned.getFullYear();
  const aarOrdrer = S.ordrer.filter(o=>o.ankomstdato?.startsWith(`${visAar}-`));
  const aarFerdig = aarOrdrer.filter(o=>o.godkjent).length;
  if (elAar) elAar.innerHTML = `<div class="small muted" style="margin-bottom:4px">Årstotal ${visAar}</div>
    <div style="display:flex;gap:16px">
      <div><span style="font-size:20px;font-weight:700;color:#f4f4f5">${aarOrdrer.length}</span><div class="small muted">biler totalt</div></div>
      <div><span style="font-size:20px;font-weight:700;color:#22c55e">${aarFerdig}</span><div class="small muted">ferdigstilt</div></div>
      <div><span style="font-size:20px;font-weight:700;color:#a1a1aa">${aarOrdrer.length-aarFerdig}</span><div class="small muted">pågår</div></div>
    </div>`;
}

// ════════════════════════════════════════════════════
// LAGRE INNSTILLINGER TIL SUPABASE
// ════════════════════════════════════════════════════
function saveInnstillinger() {
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if (!db) return;
  db.from('innstillinger').upsert({
    id: 1,
    dagens_pin: S.dagensPIN,
    gps_lat: S.gps?.lat||null,
    gps_lng: S.gps?.lng||null,
    gps_radius: S.gps?.radius||300,
    utstyr_maler: S.utstyrMaler||[],
    drivstoff_satser: S.drivstoffSatser||[],
    beskjeder: S.beskjeder||[],
    kontakter: S.kontakter||[],
    hms: S.hms||[]
  }, {onConflict:'id'}).then(r=>{ if(r.error) console.error('Innstillinger feil:',r.error.message); });
}

// ════════════════════════════════════════════════════
// UTSTYR-MALER
// ════════════════════════════════════════════════════
function lagreUtstyrMal() {
  const navn = document.getElementById('uMalNavn').value.trim();
  const biltype = document.getElementById('uMalBiltype').value.trim();
  const punkterRaw = document.getElementById('uMalPunkter').value;
  const editId = document.getElementById('uMalEditId').value;
  if (!navn) { alert('Navn er påkrevd'); return; }
  const punkter = punkterRaw.split('\n').map(p=>p.trim()).filter(Boolean);
  if (!punkter.length) { alert('Legg til minst ett punkt'); return; }
  if (editId) {
    const idx = S.utstyrMaler.findIndex(m=>String(m.id)===String(editId));
    if (idx>=0) S.utstyrMaler[idx] = {...S.utstyrMaler[idx], navn, biltype, punkter};
  } else {
    S.utstyrMaler.push({id:'u'+(++S.nextId), navn, biltype, punkter});
  }
  saveInnstillinger();
  closeModal('nyUtstyrMal');
  ['uMalNavn','uMalBiltype','uMalPunkter','uMalEditId'].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  document.getElementById('uMalTittel').textContent='Ny utstyr-mal (ankomst)';
  renderUtstyrMaler();
}

function redigerUtstyrMal(id) {
  const m = S.utstyrMaler.find(x=>String(x.id)===String(id)); if(!m) return;
  document.getElementById('uMalEditId').value = m.id;
  document.getElementById('uMalNavn').value = m.navn;
  document.getElementById('uMalBiltype').value = m.biltype||'';
  document.getElementById('uMalPunkter').value = m.punkter.join('\n');
  document.getElementById('uMalTittel').textContent = 'Rediger utstyr-mal';
  openModal('nyUtstyrMal');
}

function slettUtstyrMal(id) {
  S.utstyrMaler = S.utstyrMaler.filter(m=>m.id!==id);
  saveInnstillinger();
  renderUtstyrMaler();
}

function renderUtstyrMaler() {
  const el = document.getElementById('utstyrMalListe'); if(!el) return;
  if (!S.utstyrMaler.length) { el.innerHTML='<div class="muted small">Ingen maler opprettet ennå</div>'; return; }
  el.innerHTML = S.utstyrMaler.map((m,i)=>`
    <div class="box" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <b>${m.navn}</b>
          ${m.biltype?`<span class="pill" style="font-size:11px;margin-left:4px">${m.biltype}</span>`:'<span class="pill" style="font-size:11px;margin-left:4px">Alle biler</span>'}
          <div class="small muted" style="margin-top:4px">${m.punkter.length} punkter: ${m.punkter.slice(0,4).join(', ')}${m.punkter.length>4?'...':''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="redigerUtstyrMalIdx(${i})" style="background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:15px;padding:0" title="Rediger">✏️</button>
          <button onclick="slettUtstyrMalIdx(${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:0" title="Slett">✕</button>
        </div>
      </div>
    </div>`).join('');
}

function redigerUtstyrMalIdx(i) {
  const m = S.utstyrMaler[i]; if(!m) return;
  document.getElementById('uMalEditId').value = String(m.id);
  document.getElementById('uMalNavn').value = m.navn;
  document.getElementById('uMalBiltype').value = m.biltype||'';
  document.getElementById('uMalPunkter').value = m.punkter.join('\n');
  document.getElementById('uMalTittel').textContent = 'Rediger utstyr-mal';
  openModal('nyUtstyrMal');
}

function slettUtstyrMalIdx(i) {
  const m = S.utstyrMaler[i]; if(!m) return;
  if (!confirm(`Slette malen "${m.navn}"?`)) return;
  S.utstyrMaler.splice(i, 1);
  saveInnstillinger();
  renderUtstyrMaler();
}

function applyUtstyrMal(ordreId, malIdx) {
  const o = S.ordrer.find(x=>x.id===ordreId); if(!o) return;
  const mal = S.utstyrMaler[parseInt(malIdx)];
  if(!mal) return;
  if(o.utstyrSjekkliste?.length && !confirm(`Erstatte eksisterende liste (${o.utstyrSjekkliste.length} punkter) med "${mal.navn}"?`)) return;
  o.utstyrSjekkliste = mal.punkter.map(p=>({punkt:p, ok:false}));
  o.utstyrMalNavn = mal.navn;
  logChange(o, 'Utstyr-mal (ankomst) valgt: '+mal.navn);
  save(ordreId); buildOrdreDetail();
}

function toggleUtstyrPunkt(ordreId, idx) {
  const o = S.ordrer.find(x=>x.id===ordreId); if(!o) return;
  o.utstyrSjekkliste[idx].ok = !o.utstyrSjekkliste[idx].ok;
  save(ordreId);
  // Oppdater kun sjekklisten - ikke bygg om hele ordresiden, det gir et lite
  // layout-hopp midt i trykket som kan gjøre at neste trykk treffer feil boks.
  const container = document.getElementById('utstyrSjekkliste_' + ordreId);
  if (container) container.innerHTML = utstyrSjekklisteHTML(o.utstyrSjekkliste||[], ordreId, 'toggleUtstyrPunkt', o.utstyrMalNavn||'');
}

// ════════════════════════════════════════════════════
// HMS-LOGG
// ════════════════════════════════════════════════════
function lagreHMS() {
  const besk = document.getElementById('hmsBesk').value.trim();
  if (!besk) { alert('Beskrivelse er påkrevd'); return; }
  S.hms.unshift({
    id:'h'+(++S.nextId), av:me.navn, avId:me.id,
    dato:new Date().toISOString(),
    type:document.getElementById('hmsType').value,
    beskrivelse:besk,
    tiltak:document.getElementById('hmsTiltak').value.trim(),
    lukket:false
  });
  saveInnstillinger();
  closeModal('nyHMS');
  ['hmsBesk','hmsTiltak'].forEach(i=>document.getElementById(i).value='');
  renderHMS();
}

function toggleHMSLukket(id) {
  const h = S.hms.find(x=>x.id===id); if(!h) return;
  h.lukket=!h.lukket;
  saveInnstillinger();
  renderHMS();
}

function renderHMS() {
  const el = document.getElementById('hmsListe'); if(!el) return;
  const erAdmin = me && me.rolle==='admin';
  const vis = erAdmin ? S.hms : S.hms.filter(h=>!h.lukket);
  if (!vis.length) { el.innerHTML='<div class="muted small">Ingen HMS-registreringer</div>'; return; }
  el.innerHTML = vis.slice(0,20).map(h=>`
    <div class="box" style="margin-bottom:8px;${h.lukket?'opacity:0.5':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div style="flex:1">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span class="pill warn" style="font-size:11px">${h.type}</span>
            ${h.lukket?'<span class="pill ok" style="font-size:11px">Lukket</span>':''}
          </div>
          <div class="small">${h.beskrivelse}</div>
          ${h.tiltak?`<div class="small muted" style="margin-top:4px">Tiltak: ${h.tiltak}</div>`:''}
          <div class="small muted" style="margin-top:4px">${h.av} · ${new Date(h.dato).toLocaleDateString('no',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>
        ${erAdmin?`<button class="btn sm" onclick="toggleHMSLukket('${h.id}')">${h.lukket?'Gjenåpne':'Lukk'}</button>`:''}
      </div>
    </div>`).join('');
}

function genPIN() {
  S.dagensPIN=String(Math.floor(1000+Math.random()*9000));
  saveInnstillinger();
  renderMer();
}

function toggleKanForeLonn(id) {
  const a=S.ansatte.find(x=>x.id===id||String(x.id)===String(id)); if(!a) return;
  a.kanForeLonn = a.kanForeLonn===false ? true : false;
  ignorerRealtimeAnsatt.add(String(id));
  setTimeout(()=>ignorerRealtimeAnsatt.delete(String(id)), 5000);
  if(db) db.from('ansatte').update({kan_fore_lonn: a.kanForeLonn}).eq('id',id)
    .then(r=>{
      if(r.error){ alert('Feil ved lagring: '+r.error.message); }
    });
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  renderMer();
  if(me?.rolle==='admin'||me?.rolle==='godkjenner') renderTimerOversikt();
}

function toggleAnsatt(id) {
  const a=S.ansatte.find(x=>x.id===id); if(!a) return;
  a.aktiv=!a.aktiv;
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if(db) db.from('ansatte').update({aktiv:a.aktiv}).eq('id',id)
    .then(r=>{if(r.error)console.error('Ansatt lagringsfeil:',r.error.message);});
  renderMer();
}

function opprettAnsatt() {
  const navn=document.getElementById('na_navn').value.trim();
  const pin=document.getElementById('na_pin').value.trim();
  if(!navn||pin.length!==4||isNaN(Number(pin))){alert('Fyll ut navn og 4-sifret PIN');return;}
  const nyA={id:++S.nextId, navn, rolle:document.getElementById('na_rolle').value, aktiv:true};
  S.ansatte.push(nyA);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  // Ansatt + PIN opprettes atomisk i databasen (opprett_ansatt) - PIN-koder
  // lagres ikke lenger direkte via klienten, og dup-sjekk skjer server-side.
  if(db) db.rpc('opprett_ansatt', {p_id:nyA.id, p_navn:navn, p_rolle:nyA.rolle, p_pin:pin})
    .then(r=>{
      if(r.error){
        console.error('Ansatt insert feil:',r.error.message);
        alert(r.error.message.includes('PIN_I_BRUK') ? 'Denne PIN er allerede i bruk'
          : r.error.message.includes('KUN_ADMIN') ? 'Kun admin kan opprette ansatte'
          : 'Feil ved lagring av ansatt: '+r.error.message);
        S.ansatte=S.ansatte.filter(a=>a.id!==nyA.id);
        renderMer(); return;
      }
    });
  closeModal('nyAnsatt'); renderMer();
  ['na_navn','na_pin'].forEach(i=>document.getElementById(i).value='');
}

// ════════════════════════════════════════════════════
// CSV EKSPORT
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// SLETT ANSATT (admin)
// ════════════════════════════════════════════════════
function slettAnsatt(id) {
  const a = S.ansatte.find(x=>x.id===id); if(!a) return;
  if (!confirm(`Sikker på at du vil slette ${a.navn}?\n\nAlle timeregistreringer for denne ansatte beholdes, men kobles ikke lenger til personen.`)) return;
  S.ansatte = S.ansatte.filter(x=>x.id!==id);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if(db) db.from('ansatte').delete().eq('id',id).then(r=>{if(r.error)console.error(r.error.message)});
  renderMer();
}

// ════════════════════════════════════════════════════
// ANSATT-DETALJ (klikk på ansatt i timer-oversikt)
// ════════════════════════════════════════════════════
let ansattDetaljId = null;
let ansattDetaljOffset = 0;

function visAnsattDetalj(id) {
  if (!me || me.rolle !== 'admin') return;
  ansattDetaljId = id;
  ansattDetaljOffset = 0;
  openModal('ansattDetaljModal');
  renderAnsattDetalj();
}

function ansattDetaljNaviger(dir) {
  ansattDetaljOffset += dir;
  renderAnsattDetalj();
}

function renderAnsattDetalj() {
  const a = S.ansatte.find(x=>x.id===ansattDetaljId); if(!a) return;
  const maanedNavn=['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  const now = new Date();
  const dato = new Date(now.getFullYear(), now.getMonth()+ansattDetaljOffset, 1);
  const prefix = `${dato.getFullYear()}-${String(dato.getMonth()+1).padStart(2,'0')}`;
  const aarPrefix = `${dato.getFullYear()}-`;

  document.getElementById('ansattDetaljNavn').textContent = a.navn;
  document.getElementById('ansattDetaljLbl').textContent = `${maanedNavn[dato.getMonth()]} ${dato.getFullYear()}`;

  const timer = S.timer.filter(t=>t.ansattId===a.id && t.dato?.startsWith(prefix));
  const arbTimer = timer.filter(t=>t.mins>0);
  const totMins = arbTimer.reduce((s,t)=>s+t.mins,0);

  let normal=0,ot50=0,ot100=0;
  arbTimer.forEach(t=>{ const ot=beregnOvertid(t.mins,t.dato); normal+=ot.normal; ot50+=ot.ot50; ot100+=ot.ot100; });

  const sykDager   = timer.filter(t=>t.type==='syk').length;
  const egenmDager = timer.filter(t=>t.type==='egenmelding').length;
  const ferieDager = timer.filter(t=>t.type==='ferie').length;
  const permDager  = timer.filter(t=>t.type==='permisjon').length;
  const arbDager   = [...new Set(arbTimer.map(t=>t.dato))].length;

  // Alle dager i måneden med registrering
  const fraværTyper = ['syk','egenmelding','ferie','permisjon'];
  const dagsRader = timer.sort((a,b)=>a.dato?.localeCompare(b.dato)).map(t=>{
    const fType = fraværTyper.includes(t.type);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:#18181b;margin-bottom:4px;font-size:13px">
      <span>${t.dato} <span style="color:${fType?'#fca5a5':'#f4f4f5'}">${fType?t.type:t.start+' – '+t.stopp}</span></span>
      <span style="display:flex;align-items:center;gap:8px">
        <span style="color:#f4f4f5;font-weight:600">${t.mins>0?fmtTid(t.mins):''}</span>
        <button onclick="adminRedigerTimer('${t.id}')" style="background:none;border:none;color:#a1a1aa;cursor:pointer;font-size:14px;padding:0" title="Rediger">✏️</button>
        <button onclick="adminSlettTimer('${t.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0" title="Slett">✕</button>
      </span>
    </div>`;
  }).join('');

  // Årstotaler
  const aarTimer = S.timer.filter(t=>t.ansattId===a.id && t.dato?.startsWith(aarPrefix));
  const aarArbTimer = aarTimer.filter(t=>t.mins>0);
  const aarTotMins = aarArbTimer.reduce((s,t)=>s+t.mins,0);
  const aarSyk     = aarTimer.filter(t=>t.type==='syk').length;
  const aarEgenm   = aarTimer.filter(t=>t.type==='egenmelding').length;
  const aarFerie   = aarTimer.filter(t=>t.type==='ferie').length;
  const aarPerm    = aarTimer.filter(t=>t.type==='permisjon').length;
  let aarNormal=0, aarOt50=0, aarOt100=0;
  aarArbTimer.forEach(t=>{ const ot=beregnOvertid(t.mins,t.dato); aarNormal+=ot.normal; aarOt50+=ot.ot50; aarOt100+=ot.ot100; });

  document.getElementById('ansattDetaljInnhold').innerHTML = `
    <div class="small muted" style="margin-bottom:6px;font-weight:700;font-size:13px">Denne måneden</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px">
      <div style="background:#18181b;border-radius:10px;padding:10px;text-align:center">
        <div class="small muted">Arbeidsdager</div>
        <div style="font-size:22px;font-weight:700;color:#f4f4f5;margin-top:2px">${arbDager}</div>
      </div>
      <div style="background:#18181b;border-radius:10px;padding:10px;text-align:center">
        <div class="small muted">Timer totalt</div>
        <div style="font-size:18px;font-weight:700;color:#f4f4f5;margin-top:2px">${fmtTid(totMins)}</div>
      </div>
      <div style="background:#42200688;border-radius:10px;padding:10px;text-align:center">
        <div class="small" style="color:#fde68a">50% OT</div>
        <div style="font-size:18px;font-weight:700;color:#facc15;margin-top:2px">${fmtTid(ot50)}</div>
      </div>
      <div style="background:#43140788;border-radius:10px;padding:10px;text-align:center">
        <div class="small" style="color:#fed7aa">100% OT</div>
        <div style="font-size:18px;font-weight:700;color:#f97316;margin-top:2px">${fmtTid(ot100)}</div>
      </div>
      ${sykDager+egenmDager>0?`<div style="background:#3f0000;border-radius:10px;padding:10px;text-align:center">
        <div class="small" style="color:#fca5a5">Syk/Egenmeld</div>
        <div style="font-size:18px;font-weight:700;color:#fca5a5;margin-top:2px">${sykDager+egenmDager} dager</div>
      </div>`:''}
      ${ferieDager+permDager>0?`<div style="background:#18181b;border-radius:10px;padding:10px;text-align:center">
        <div class="small muted">Ferie/Perm</div>
        <div style="font-size:18px;font-weight:700;color:#a1a1aa;margin-top:2px">${ferieDager+permDager} dager</div>
      </div>`:''}
    </div>

    <div style="border-top:1px solid #27272a;padding-top:14px;margin-bottom:10px">
      <div class="small muted" style="font-weight:700;font-size:13px;margin-bottom:8px">Hele ${dato.getFullYear()} – totalt</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:14px">
        <div style="background:#18181b;border-radius:10px;padding:10px;text-align:center">
          <div class="small muted">Timer</div>
          <div style="font-size:18px;font-weight:700;color:#f4f4f5;margin-top:2px">${fmtTid(aarTotMins)}</div>
        </div>
        ${aarOt50>0?`<div style="background:#42200688;border-radius:10px;padding:10px;text-align:center">
          <div class="small" style="color:#fde68a">50% OT</div>
          <div style="font-size:16px;font-weight:700;color:#facc15;margin-top:2px">${fmtTid(aarOt50)}</div>
        </div>`:''}
        ${aarOt100>0?`<div style="background:#43140788;border-radius:10px;padding:10px;text-align:center">
          <div class="small" style="color:#fed7aa">100% OT</div>
          <div style="font-size:16px;font-weight:700;color:#f97316;margin-top:2px">${fmtTid(aarOt100)}</div>
        </div>`:''}
        <div style="background:#3f0000;border-radius:10px;padding:10px;text-align:center">
          <div class="small" style="color:#fca5a5">Syk</div>
          <div style="font-size:18px;font-weight:700;color:#fca5a5;margin-top:2px">${aarSyk} dager</div>
        </div>
        <div style="background:#1a1a00;border-radius:10px;padding:10px;text-align:center">
          <div class="small" style="color:#fde68a">Egenmeld</div>
          <div style="font-size:18px;font-weight:700;color:#fde68a;margin-top:2px">${aarEgenm} dager</div>
        </div>
        <div style="background:#0f1f2e;border-radius:10px;padding:10px;text-align:center">
          <div class="small" style="color:#93c5fd">Ferie</div>
          <div style="font-size:18px;font-weight:700;color:#93c5fd;margin-top:2px">${aarFerie} dager</div>
        </div>
        ${aarPerm>0?`<div style="background:#18181b;border-radius:10px;padding:10px;text-align:center">
          <div class="small muted">Permisjon</div>
          <div style="font-size:18px;font-weight:700;color:#a1a1aa;margin-top:2px">${aarPerm} dager</div>
        </div>`:''}
      </div>
    </div>

    <div class="row" style="margin-bottom:6px">
      <div class="small muted">Alle registreringer denne måneden</div>
      <button class="btn sm" onclick="adminNyTimer()">+ Legg til</button>
    </div>
    ${dagsRader || '<div class="muted small">Ingen registreringer</div>'}`;
}

function adminSlettTimer(id) {
  if (!confirm('Slette denne registreringen?')) return;
  S.timer = S.timer.filter(t=>t.id!==id);
  if(db) db.from('timer_entries').delete().eq('id',id).then(r=>{if(r.error)console.error(r.error.message);});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  renderAnsattDetalj();
}

function adminRedigerTimer(id) {
  const t = S.timer.find(x=>x.id===id); if(!t) return;
  document.getElementById('adminTimerModalTittel').textContent = 'Rediger registrering';
  document.getElementById('adminTimerId').value = id;
  document.getElementById('adminTimerAnsattId').value = '';
  document.getElementById('adminTimerDato').value = t.dato||'';
  document.getElementById('adminTimerType').value = t.type||'normal';
  document.getElementById('adminTimerFra').value = t.start!=='–'?t.start:'';
  document.getElementById('adminTimerTil').value = t.stopp!=='–'?t.stopp:'';
  adminTimerTypeToggle();
  openModal('adminTimerModal');
}

function adminNyTimer() {
  const a = S.ansatte.find(x=>x.id===ansattDetaljId); if(!a) return;
  document.getElementById('adminTimerModalTittel').textContent = 'Ny registrering – ' + a.navn;
  document.getElementById('adminTimerId').value = '';
  document.getElementById('adminTimerAnsattId').value = a.id;
  document.getElementById('adminTimerDato').value = new Date().toISOString().split('T')[0];
  document.getElementById('adminTimerType').value = 'normal';
  document.getElementById('adminTimerFra').value = '';
  document.getElementById('adminTimerTil').value = '';
  adminTimerTypeToggle();
  openModal('adminTimerModal');
}

function adminTimerTypeToggle() {
  const type = document.getElementById('adminTimerType').value;
  const fraværTyper = ['syk','egenmelding','ferie','permisjon'];
  document.getElementById('adminTimerTidWrap').style.display = fraværTyper.includes(type)?'none':'block';
}

function adminLagreTimer() {
  const id = document.getElementById('adminTimerId').value;
  const dato = document.getElementById('adminTimerDato').value;
  const type = document.getElementById('adminTimerType').value;
  const fra  = document.getElementById('adminTimerFra').value;
  const til  = document.getElementById('adminTimerTil').value;
  const fraværTyper = ['syk','egenmelding','ferie','permisjon'];
  let mins = 0, start = '–', stopp = '–';
  if (!fraværTyper.includes(type) && fra && til) {
    const [sh,sm]=fra.split(':').map(Number);
    const [eh,em]=til.split(':').map(Number);
    mins = Math.max(0,(eh*60+em)-(sh*60+sm)-30);
    start=fra; stopp=til;
  }

  if (id) {
    const t = S.timer.find(x=>x.id===id); if(!t) return;
    t.dato=dato; t.type=type; t.start=start; t.stopp=stopp; t.mins=mins;
    if(db) db.from('timer_entries').update({dato,type,start,stopp,mins}).eq('id',id)
      .then(r=>{if(r.error)console.error(r.error.message);});
  } else {
    const ansattId = document.getElementById('adminTimerAnsattId').value;
    const a = S.ansatte.find(x=>String(x.id)===ansattId); if(!a) return;
    const nyId = 't'+(++S.nextId);
    const timerEntry = { id:nyId, ansattId:a.id, ansatt:a.navn, dato, type, start, stopp, mins, _localAt:Date.now() };
    S.timer.push(timerEntry);
    if(db) db.from('timer_entries').insert({id:nyId, ansatt_id:a.id, ansatt:a.navn, dato, type, start, stopp, mins})
      .then(r=>{if(r.error)console.error(r.error.message);});
  }
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  closeModal('adminTimerModal');
  renderAnsattDetalj();
}

