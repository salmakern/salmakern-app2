// ════════════════════════════════════════════════════
// DRIVSTOFF-SATSER
// ════════════════════════════════════════════════════
function toggleDsVerdi() {
  const type = document.getElementById('dsType')?.value;
  const wrap = document.getElementById('dsVerdiWrap');
  const lbl  = document.getElementById('dsVerdiLbl');
  if (!wrap) return;
  if (type==='uten_moms' || type==='uten_mva' || type==='bos') { wrap.style.display='none'; return; }
  wrap.style.display='block';
  lbl.textContent = type==='prosent_rabatt'
    ? 'Prosent rabatt (f.eks. 10 = 10% trekk)'
    : type==='kr_rabatt'
    ? 'Kr-trekk per liter (f.eks. 2,00)'
    : 'Verdi';
}

function lagreDrivstoffSats() {
  const navn  = document.getElementById('dsNavn').value.trim();
  const type  = document.getElementById('dsType').value;
  const verdi = parseFloat(document.getElementById('dsVerdi').value)||0;
  if (!navn) { alert('Navn er påkrevd'); return; }
  const ingenVerdi = ['uten_moms','uten_mva','bos'].includes(type);
  if (!ingenVerdi && !verdi) { alert('Verdi er påkrevd'); return; }
  S.drivstoffSatser.push({id:'ds'+(++S.nextId), navn, type, verdi});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  closeModal('nyDrivstoffSats');
  ['dsNavn','dsVerdi'].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  renderDrivstoffSatser();
}

function slettDrivstoffSats(id) {
  if (!confirm('Slette denne satsen?')) return;
  S.drivstoffSatser = S.drivstoffSatser.filter(s=>s.id!==id);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  renderDrivstoffSatser();
}

function renderDrivstoffSatser() {
  const el = document.getElementById('drivstoffSatsListe'); if(!el) return;
  if (!S.drivstoffSatser.length) { el.innerHTML='<div class="muted small">Ingen satser lagt inn ennå</div>'; return; }
  const typeNavn = {kr_rabatt:'Kr-trekk',prosent_rabatt:'% rabatt',uten_moms:'Uten MVA (÷1,25)',uten_mva:'Uten Mva (×0,8)',bos:'BOS'};
  el.innerHTML = S.drivstoffSatser.map(s=>`
    <div class="box" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div>
        <b>${s.navn}</b>
        <span class="pill" style="font-size:11px;margin-left:4px">${typeNavn[s.type]||s.type}</span>
        <div class="small muted" style="margin-top:3px">
          ${s.type==='kr_rabatt'?`–${s.verdi} kr/L`:s.type==='prosent_rabatt'?`–${s.verdi}%`:s.type==='uten_moms'?'÷1,25':s.type==='uten_mva'?'×0,8 (–20%)':s.type==='bos'?'(×0,8)÷0,97':''}
        </div>
      </div>
      <button onclick="slettDrivstoffSats('${s.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:18px;padding:0">✕</button>
    </div>`).join('');
}

function beregnDrivstoffHTML(df, innhold=false) {
  if (!df) return '';
  const literpris = parseFloat(df.literpris)||0;
  const liter     = parseFloat(df.liter)||0;
  const sats      = (S.drivstoffSatser||[]).find(s=>s.id===df.satsId);
  if (!literpris && !liter && !sats) return innhold ? '' : `<div id="drivstoffBeregning_" style="margin-top:10px"></div>`;

  const totalpumpe = literpris * liter;
  let kundeLiterpris = literpris;
  let forklaring = '';
  if (sats) {
    if (sats.type==='kr_rabatt')       { kundeLiterpris = literpris - parseFloat(sats.verdi||0); forklaring=`–${sats.verdi} kr/L rabatt`; }
    if (sats.type==='prosent_rabatt')  { kundeLiterpris = literpris * (1 - parseFloat(sats.verdi||0)/100); forklaring=`–${sats.verdi}% rabatt`; }
    if (sats.type==='uten_moms')       { kundeLiterpris = literpris/1.25; forklaring='Uten MVA (÷1,25)'; }
    // bakoverkompatibilitet med gamle satser
    if (sats.type==='prosent')         { kundeLiterpris = literpris*(parseFloat(sats.verdi||100)/100); forklaring=`${sats.verdi}% av pumpepris`; }
    if (sats.type==='fast_pris')       { kundeLiterpris = parseFloat(sats.verdi||0); forklaring=`Fast ${sats.verdi} kr/L`; }
    if (kundeLiterpris < 0) kundeLiterpris = 0;
  }
  const kundetotal   = kundeLiterpris * liter;
  const besparelse   = totalpumpe - kundetotal;
  const kr = n => n.toLocaleString('no-NO',{minimumFractionDigits:2,maximumFractionDigits:2});

  const html = `
    <div style="background:#0f0f12;border:1px solid #27272a;border-radius:12px;padding:12px;margin-top:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${literpris?`<div class="small muted">Pumpepris</div><div class="small" style="text-align:right">${kr(literpris)} kr/L</div>`:''}
        ${liter?`<div class="small muted">Antall liter</div><div class="small" style="text-align:right">${kr(liter)} L</div>`:''}
        ${totalpumpe?`<div class="small muted">Totalt ved pumpe</div><div class="small" style="text-align:right;font-weight:700">${kr(totalpumpe)} kr</div>`:''}
        ${sats?`<div class="small muted">Sats</div><div class="small" style="text-align:right;color:#fde68a">${sats.navn}${forklaring?' · '+forklaring:''}</div>`:''}
        ${sats&&liter?`<div class="small muted">Kundepris per liter</div><div class="small" style="text-align:right">${kr(kundeLiterpris)} kr/L</div>`:''}
        ${sats&&liter?`<div class="small muted" style="font-weight:700">Kundepris totalt</div><div style="text-align:right;font-weight:800;font-size:15px;color:#86efac">${kr(kundetotal)} kr</div>`:''}
        ${sats&&besparelse>0?`<div class="small muted">Besparelse</div><div class="small" style="text-align:right;color:#a1a1aa">–${kr(besparelse)} kr</div>`:''}
      </div>
    </div>`;
  if (innhold) return html;
  return `<div id="drivstoffBeregning_">${html}</div>`;
}
function su(id,f,val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.utstyr[f]=val; save(id);
}

// ════════════════════════════════════════════════════
// ORDRE ACTIONS
// ════════════════════════════════════════════════════
function meldPaa(id) {
  const o = S.ordrer.find(x=>x.id===id);
  if (!o || o.ansatteSignert.find(a=>a.id===me.id)) return;
  o.ansatteSignert.push({id:me.id, navn:me.navn, tid:fmt(new Date())});
  logChange(o, me.navn+' meldt på'); save(id); buildOrdreDetail();
}
function meldAv(id) {
  const o = S.ordrer.find(x=>x.id===id);
  if (!o) return;
  if (!confirm('Vil du melde deg av denne ordren?')) return;
  o.ansatteSignert = o.ansatteSignert.filter(a=>a.id!==me.id);
  logChange(o, me.navn+' meldt av'); save(id); buildOrdreDetail();
}
function ordreTimerLoper(o) {
  const sessions = o.ordreTimerSessions||[];
  return sessions.length>0 && !sessions[sessions.length-1].stopp;
}
function ordreTimerTotalMs(o) {
  const sessions = o.ordreTimerSessions||[];
  const now = Date.now();
  return sessions.reduce((sum,s)=>sum+(s.stopp||now)-s.start, 0);
}
function ordreTimerKortHTML(o) {
  const sessions = o.ordreTimerSessions||[];
  const loper = ordreTimerLoper(o);
  const totalMs = ordreTimerTotalMs(o);
  const h = Math.floor(totalMs/3600000);
  const m = Math.floor((totalMs%3600000)/60000);
  const s = Math.floor((totalMs%60000)/1000);
  const tidStr = totalMs>0 ? `${h>0?h+'t ':''} ${m}min ${s}s` : '–';
  const fmtTs = ts => new Date(ts).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <div class="h">Ordretid</div>
        <div style="font-size:28px;font-weight:800;margin-top:4px;color:${loper?'#86efac':'#f4f4f5'}">${tidStr}</div>
        ${loper?'<div class="small" style="color:#86efac;margin-top:2px">● Kjører nå</div>':''}
      </div>
      <div style="display:flex;gap:8px">
        ${loper
          ? `<button class="btn red" onclick="stoppOrdreTimer('${o.id}')">⏹ Stopp</button>`
          : `<button class="btn green" onclick="startOrdreTimer('${o.id}')">▶ Start</button>`}
      </div>
    </div>
    ${sessions.length>0?`
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
      ${sessions.slice().reverse().map((s,i)=>{
        const ms=(s.stopp||Date.now())-s.start;
        const sh=Math.floor(ms/3600000), sm=Math.floor((ms%3600000)/60000), ss=Math.floor((ms%60000)/1000);
        const dur=`${sh>0?sh+'t ':''} ${sm}min ${ss}s`;
        return `<div class="box" style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
          <span class="muted">${fmtTs(s.start)} → ${s.stopp?fmtTs(s.stopp):'<span style="color:#86efac">pågår</span>'}</span>
          <span style="font-weight:700">${dur}</span>
        </div>`;
      }).join('')}
    </div>`:''}`;
}
function startOrdreTimerTick(id) {
  if (ordreTimerTick) clearInterval(ordreTimerTick);
  ordreTimerTick = setInterval(()=>{
    const o=S.ordrer.find(x=>x.id===id); if(!o) { clearInterval(ordreTimerTick); return; }
    const el=document.getElementById('ordretimerKort_'+id);
    if(!el) { clearInterval(ordreTimerTick); return; }
    if(!ordreTimerLoper(o)) { clearInterval(ordreTimerTick); ordreTimerTick=null; return; }
    el.innerHTML=ordreTimerKortHTML(o);
  },1000);
}
function startOrdreTimer(id) {
  const o=S.ordrer.find(x=>x.id===id); if(!o||ordreTimerLoper(o)) return;
  if(!o.ordreTimerSessions) o.ordreTimerSessions=[];
  o.ordreTimerSessions.push({start:Date.now(), stopp:null});
  logChange(o,'Ordretid startet'); save(id);
  const el=document.getElementById('ordretimerKort_'+id);
  if(el) el.innerHTML=ordreTimerKortHTML(o);
  startOrdreTimerTick(id);
}
function stoppOrdreTimer(id) {
  const o=S.ordrer.find(x=>x.id===id); if(!o||!ordreTimerLoper(o)) return;
  const sessions=o.ordreTimerSessions||[];
  const last=sessions[sessions.length-1];
  if(last&&!last.stopp) last.stopp=Date.now();
  if(ordreTimerTick){clearInterval(ordreTimerTick);ordreTimerTick=null;}
  logChange(o,'Ordretid stoppet'); save(id);
  const el=document.getElementById('ordretimerKort_'+id);
  if(el) el.innerHTML=ordreTimerKortHTML(o);
}
async function arkiver(id) {
  const o=S.ordrer.find(x=>x.id===id); if(!o) return;
  o.status='arkivert';
  const endring = {av:me?.navn||'?', tid:new Date().toLocaleString('no'), txt:'Arkivert'};
  o.endringer.push(endring);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  let feil = null;
  if (db) {
    const { error } = await db.from('ordrer').update({status:o.status, endringer:o.endringer}).eq('id', id);
    if (error) feil = error.message;
  }
  if (feil) {
    o.status='aktiv';
    o.endringer = o.endringer.filter(e=>e!==endring);
    visToast('Kunne ikke arkivere ordren: ' + feil + ' — prøv igjen.');
    return;
  }
  renderAll(); tilbakeOrdreList();
}
function apneNyOrdreModal() {
  openModal('nyOrdre');
}

function opprettOrdre() {
  const regnr  = document.getElementById('n_regnr').value.trim().toUpperCase();
  const chassis= document.getElementById('n_chassis').value.trim().toUpperCase();
  if (!regnr && !chassis){ alert('Fyll inn enten reg.nr eller chassis-nr'); return; }
  // Advarsel (ikke blokkering) hvis samme chassis/reg.nr allerede finnes på en aktiv
  // ordre - fanger opp at bilen kanskje er registrert fra før, uten å hindre en bevisst
  // ny registrering (f.eks. samme bil inn til service en gang til).
  const duplikat = S.ordrer.find(o => o.status==='aktiv' && (
    (chassis && samsvarerChassis(o.chassis, chassis)) ||
    (regnr && (o.regnr||'').toUpperCase() === regnr)
  ));
  if (duplikat && !confirm(`Det finnes allerede en aktiv ordre for dette (${ordreLabel(duplikat)}). Opprette en ny ordre likevel?`)) return;
  const id='ord_'+Date.now();
  const ny=mkOrdre(id,regnr,
    document.getElementById('n_kunde').value.trim(),
    document.getElementById('n_eier').value.trim(),
    document.getElementById('n_type').value.trim(),
    document.getElementById('n_variant').value.trim(),
    document.getElementById('n_dato').value||new Date().toISOString().split('T')[0],'','','','');
  ny.merke   = document.getElementById('n_merke').value.trim();
  ny.type    = document.getElementById('n_type').value.trim();
  ny.modell  = document.getElementById('n_modell').value.trim();
  ny.versjon = document.getElementById('n_versjon').value.trim();
  ny.chassis = chassis;
  ny._localAt = Date.now();
  S.ordrer.push(ny);
  if (db) db.from('ordrer').insert(ordreToDb(ny)).then(r=>{if(r.error)console.error(r.error.message)});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  closeModal('nyOrdre'); renderAll();
  ['n_regnr','n_chassis','n_kunde','n_eier','n_merke','n_type','n_modell','n_variant','n_versjon','n_dato'].forEach(i=>document.getElementById(i).value='');
  openOrdre(id);
}

// ════════════════════════════════════════════════════
// FLYTT
// ════════════════════════════════════════════════════
function openFlytt(id) {
  flyttOrdreId=id;
  document.getElementById('fl_dato').value=new Date().toISOString().split('T')[0];
  openModal('flytt');
}
function bekreftFlytt() {
  const o=S.ordrer.find(x=>x.id===flyttOrdreId); if(!o) return;
  o.kalenderDato=document.getElementById('fl_dato').value;
  o.kalenderTid=document.getElementById('fl_tid').value;
  logChange(o,'Flyttet til kalender: '+o.kalenderDato+' '+o.kalenderTid);
  save(flyttOrdreId); closeModal('flytt'); renderAll();
  if (activeOrdreId===flyttOrdreId) buildOrdreDetail();
}

// ════════════════════════════════════════════════════
// SIGNATUR
// ════════════════════════════════════════════════════
async function lagreSignaturTilStorage(id, dataUrl) {
  if (db) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const filnavn = `${id}/signatur_${Date.now()}.png`;
      const { error } = await db.storage.from('bilder').upload(filnavn, blob, {contentType:'image/png', upsert:true, cacheControl:'31536000'});
      if (!error) return db.storage.from('bilder').getPublicUrl(filnavn).data.publicUrl;
      console.warn('Signatur-opplasting feilet:', error.message);
    } catch(err) {
      console.warn('Signatur-unntak:', err);
    }
  }
  return dataUrl; // fallback til base64 kun hvis Storage feiler
}

// ════════════════════════════════════════════════════
// GODKJENNING
// ════════════════════════════════════════════════════
let godkjennGodkjenner = null;
let godkjCtx = null, godkjDrawing = false, godkjLastX = 0, godkjLastY = 0;

async function bekreftGodkjenn() {
  const pin=document.getElementById('godkjPIN').value;
  let godkjenner = null;
  if (db) {
    const { data, error } = await db.rpc('login_med_pin', { kandidat_pin: pin });
    if (!error && data && data.length && (data[0].rolle==='godkjenner'||data[0].rolle==='admin')) godkjenner = data[0];
  }
  if (!godkjenner){document.getElementById('godkjErr').textContent='Feil PIN eller ikke godkjenner';return;}
  godkjennGodkjenner = godkjenner;
  document.getElementById('godkjPIN').value='';
  document.getElementById('godkjErr').textContent='';
  closeModal('godkjenn');
  // Åpne signaturbox
  const o=S.ordrer.find(x=>x.id===activeOrdreId);
  document.getElementById('godkjSignNavn').textContent = `Godkjent av ${godkjenner.navn} – la kunden signere`;
  openModal('godkjennSign');
  const c=document.getElementById('godkjCanvas');
  c.width=c.offsetWidth||600;
  godkjCtx=c.getContext('2d');
  godkjCtx.strokeStyle='#f4f4f5'; godkjCtx.lineWidth=2.5; godkjCtx.lineCap='round';
  clearGodkjCanvas();
  const pos=e=>{const r=c.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return{x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)};};
  c.onmousedown=e=>{godkjDrawing=true;const p=pos(e);godkjLastX=p.x;godkjLastY=p.y;};
  c.onmousemove=e=>{if(!godkjDrawing)return;const p=pos(e);godkjCtx.beginPath();godkjCtx.moveTo(godkjLastX,godkjLastY);godkjCtx.lineTo(p.x,p.y);godkjCtx.stroke();godkjLastX=p.x;godkjLastY=p.y;};
  c.onmouseup=c.onmouseleave=()=>{godkjDrawing=false;};
  c.ontouchstart=e=>{e.preventDefault();godkjDrawing=true;const p=pos(e);godkjLastX=p.x;godkjLastY=p.y;};
  c.ontouchmove=e=>{e.preventDefault();if(!godkjDrawing)return;const p=pos(e);godkjCtx.beginPath();godkjCtx.moveTo(godkjLastX,godkjLastY);godkjCtx.lineTo(p.x,p.y);godkjCtx.stroke();godkjLastX=p.x;godkjLastY=p.y;};
  c.ontouchend=()=>{godkjDrawing=false;};
}

function clearGodkjCanvas() { if(godkjCtx) godkjCtx.clearRect(0,0,godkjCtx.canvas.width,godkjCtx.canvas.height); }

async function lagreGodkjennSignatur(hoppOver=false) {
  const o=S.ordrer.find(x=>x.id===activeOrdreId); if(!o||!godkjennGodkjenner) return;
  const btn = document.querySelector('#godkjennSign .btn.red');
  if (btn) { btn.disabled = true; btn.textContent = 'Lagrer...'; }
  if (!hoppOver) {
    const c=document.getElementById('godkjCanvas');
    o.signatur = await lagreSignaturTilStorage(activeOrdreId, c.toDataURL());
  }
  o.godkjent=true; o.godkjennerNavn=godkjennGodkjenner.navn; o.status='arkivert';
  const tvangsflytOk = tvangsflyt(o).every(t=>t.ok);
  const overstyrTekst = (!tvangsflytOk && me?.rolle==='admin') ? ' (tvangsflyt overstyrt av admin - ikke alle punkter var fullført)' : '';
  const endring = {av:me?.navn||'?', tid:new Date().toLocaleString('no'), txt:'Godkjent og lukket av '+godkjennGodkjenner.navn+overstyrTekst};
  o.endringer.push(endring);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  let feil = null;
  if (db) {
    const { error } = await db.from('ordrer').update({godkjent:o.godkjent, godkjenner_navn:o.godkjennerNavn, status:o.status, signatur:o.signatur, endringer:o.endringer}).eq('id', activeOrdreId);
    if (error) feil = error.message;
  }
  if (feil) {
    // Lagringen feilet - ikke la det se ut som ordren er lukket når den ikke er det
    o.godkjent=false; o.godkjennerNavn=''; o.status='aktiv';
    o.endringer = o.endringer.filter(e=>e!==endring);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Fullfør og lukk ordre'; }
    visToast('Kunne ikke lukke ordren: ' + feil + ' — prøv igjen.');
    return;
  }
  closeModal('godkjennSign'); tilbakeOrdreList(); renderAll();
  godkjennGodkjenner=null;
}

// ════════════════════════════════════════════════════
// FOTO
// ════════════════════════════════════════════════════
function openLightbox(imgId) {
  const img = document.getElementById(imgId);
  if (!img) return;
  document.getElementById('lightbox-img').src = img.src;
  document.getElementById('lightbox').classList.add('show');
  lbResetZoom();
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('show');
  document.getElementById('lightbox-img').src = '';
  lbResetZoom();
}
document.addEventListener('keydown', e => { if(e.key==='Escape') closeLightbox(); });

// Zoom/pan i lightbox — dobbeltklikk/dobbelttrykk, scroll og knip-til-zoom
let lbScale = 1, lbX = 0, lbY = 0;
let lbDrag = null, lbPinch = null;

function lbApplyTransform() {
  const img = document.getElementById('lightbox-img');
  img.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  img.style.cursor = lbScale > 1 ? 'grab' : 'zoom-in';
}
function lbResetZoom() {
  lbScale = 1; lbX = 0; lbY = 0; lbDrag = null; lbPinch = null;
  lbApplyTransform();
}
function lbToggleZoom() {
  if (lbScale > 1) { lbResetZoom(); return; }
  lbScale = 2.5;
  lbApplyTransform();
}
function lbWheel(e) {
  e.preventDefault();
  const faktor = e.deltaY < 0 ? 1.15 : 1/1.15;
  lbScale = Math.min(6, Math.max(1, lbScale * faktor));
  if (lbScale === 1) { lbX = 0; lbY = 0; }
  lbApplyTransform();
}
function lbPointerDown(e) {
  if (lbScale <= 1) return;
  lbDrag = { startX: e.clientX - lbX, startY: e.clientY - lbY };
  e.target.setPointerCapture(e.pointerId);
}
function lbPointerMove(e) {
  if (!lbDrag) return;
  lbX = e.clientX - lbDrag.startX;
  lbY = e.clientY - lbDrag.startY;
  lbApplyTransform();
}
function lbPointerUp() { lbDrag = null; }
function lbTouchStart(e) {
  if (e.touches.length === 2) {
    const [t1,t2] = e.touches;
    lbPinch = { dist: Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY), scale: lbScale };
  }
}
function lbTouchMove(e) {
  if (e.touches.length === 2 && lbPinch) {
    e.preventDefault();
    const [t1,t2] = e.touches;
    const dist = Math.hypot(t2.clientX-t1.clientX, t2.clientY-t1.clientY);
    lbScale = Math.min(6, Math.max(1, lbPinch.scale * (dist / lbPinch.dist)));
    if (lbScale === 1) { lbX = 0; lbY = 0; }
    lbApplyTransform();
  }
}
function lbTouchEnd(e) { if (e.touches.length < 2) lbPinch = null; }

async function slaOppRegnr(ordreId) {
  const o = S.ordrer.find(x=>x.id===ordreId); if(!o) return;
  const regnr = (document.getElementById('regnr_'+ordreId)?.value || o.regnr || '').trim().toUpperCase().replace(/\s/g,'');
  const statusEl = document.getElementById('regnrStatus_'+ordreId);
  if (!regnr) { if(statusEl) statusEl.innerHTML='<span style="color:#fca5a5">Skriv inn reg.nr først</span>'; return; }
  if(statusEl) statusEl.innerHTML='<span style="color:#a1a1aa">Søker...</span>';
  try {
    const res = await fetch(`https://www.vegvesen.no/ws/no/vegvesen/kjoretoy/felles/datautlevering/enkeltoppslag/kjoretoydata?kjennemerke=${regnr}`,
      {headers:{'SVV-Authorization':'Apikey na'}});
    if (!res.ok) throw new Error('Ikke funnet');
    const data = await res.json();
    const kjt = data?.kjoretoydataListe?.[0];
    if (!kjt) throw new Error('Ingen data');
    const td = kjt.godkjenning?.tekniskGodkjenning?.tekniskeData;
    const merke    = td?.generelt?.merke?.[0]?.merke || '';
    const modell   = td?.generelt?.handelsbetegnelse?.[0] || '';
    const aar      = kjt.forstegangsregistrering?.registrertForstegangNorgeDato?.substring(0,4) || '';
    const chassis  = kjt.kjennemerke?.understellsnummer || o.chassis || '';
    const eier     = kjt.eier?.person?.etternavn ? (kjt.eier.person.fornavn||'')+' '+(kjt.eier.person.etternavn||'') : o.eier;
    if (merke)   { o.type    = merke+(modell?' '+modell:''); }
    if (aar)     { o.versjon = aar; }
    if (chassis) { o.chassis = chassis; }
    if (eier && eier.trim()) { o.eier = eier.trim(); }
    logChange(o, 'Bilinfo hentet fra Statens vegvesen: '+merke+' '+modell);
    save(ordreId); buildOrdreDetail();
    if(statusEl) statusEl.innerHTML=`<span style="color:#86efac">✔ Funnet: ${merke} ${modell} ${aar}</span>`;
  } catch(e) {
    if(statusEl) statusEl.innerHTML='<span style="color:#fca5a5">Ikke funnet – fyll inn manuelt</span>';
  }
}

async function lastOppFoto(e, id, side, idx) {
  const file=e.target.files[0]; if(!file) return;
  if(!S.ordrer.find(x=>x.id===id)) return;

  // Vis lasteindikator i fotoboksen
  const boksId = `foboks_${side}_${idx}`;
  const boks = document.getElementById(boksId);
  if(boks) boks.innerHTML = '<div style="font-size:22px">⏳</div><div style="font-size:11px">Laster opp...</div>';

  const komprimert = await komprimer(file, 1200, 0.82);

  let url = null;
  if (db) {
    try {
      const filnavn = `${id}/${side}_${idx}_${Date.now()}.jpg`;
      const { error } = await db.storage.from('bilder').upload(filnavn, komprimert, {contentType:'image/jpeg', upsert:true, cacheControl:'31536000'});
      if (!error) {
        const { data } = db.storage.from('bilder').getPublicUrl(filnavn);
        url = data.publicUrl;
      } else {
        console.warn('Storage feil:', error.message);
        visToast('Sky-lagring feilet (' + error.message + ') — lagrer lokalt');
      }
    } catch(err) {
      console.warn('Storage unntak:', err);
      visToast('Sky-lagring feilet — lagrer lokalt');
    }
  }
  // Fallback til base64 — komprimerer hardt for å holde filstørrelse liten
  if (!url) {
    const liten = await komprimer(file, 600, 0.65);
    url = await new Promise(res=>{
      const reader=new FileReader();
      reader.onload=ev=>res(ev.target.result);
      reader.readAsDataURL(liten);
    });
  }

  // Re-hent ordren fra S.ordrer — oppdaterApp() kan ha erstattet den under async-operasjoner
  const o = S.ordrer.find(x=>x.id===id);
  if (!o) { visToast('Ordren ble oppdatert under opplasting — prøv igjen'); return; }

  o[FOTO_SIDER[side].felt][idx]=url;
  if (!inFlightFotos[id]) inFlightFotos[id]={};
  inFlightFotos[id][`${side}_${idx}`]=url;
  logChange(o,'Bilde lastet opp');
  save(id);

  // Oppdater kun denne fotoboksen — ikke full rebuild
  oppdaterFotoboks(o, side, idx);
  // Oppdater telleren i korttittelen
  Object.keys(FOTO_SIDER).forEach(s => {
    const teller = document.getElementById(`bildeTeller_${s}_${id}`);
    if (teller) teller.textContent = o[FOTO_SIDER[s].felt].filter(Boolean).length + '/' + FOTO_SIDER[s].labler.length;
  });
}

function oppdaterFotoboks(o, side, idx) {
  const boksId = `foboks_${side}_${idx}`;
  const boks = document.getElementById(boksId);
  if(!boks) return;
  const url = o[FOTO_SIDER[side].felt][idx];
  const imgId = `fo_${side}_${idx}_src`;
  if(url) {
    boks.innerHTML = `<img id="${imgId}" src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px 8px 0 0" onerror="this.style.display='none';this.parentElement.querySelector('.fo-feil')?.style&&(this.parentElement.querySelector('.fo-feil').style.display='flex')">
      <div class="fo-feil" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;flex-direction:column;font-size:11px;color:#f87171;background:#3f0000;border-radius:8px 8px 0 0;padding:4px;text-align:center">⚠️ Bilde<br>ikke tilgjengelig</div>
      <div class="hover-del" onclick="event.stopPropagation()">
        <button data-viewonly onclick="openLightbox('${imgId}')" title="Vis">🔍</button>
        <button onclick="document.getElementById('fo_${side}_${idx}').click()" title="Bytt">📷</button>
        <button onclick="slettFoto('${o.id}','${side}',${idx})" title="Slett">🗑</button>
      </div>`;
    boks.onclick = ()=>openLightbox(imgId);
  } else {
    const lbl = FOTO_SIDER[side].labler[idx];
    boks.innerHTML = `<div style="font-size:22px">📷</div><div>${lbl}</div>`;
    boks.onclick = ()=>document.getElementById(`fo_${side}_${idx}`).click();
  }
}

function komprimer(file, maxPx, kvalitet) {
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.width, h=img.height;
      if(w>maxPx||h>maxPx){
        if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}
        else{w=Math.round(w*maxPx/h);h=maxPx;}
      }
      const c=document.createElement('canvas');
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      c.toBlob(b=>resolve(b),'image/jpeg',kvalitet);
    };
    img.src=url;
  });
}

async function gjenopprettFotos(id) {
  if (!db) { visToast('Ikke koblet til Supabase'); return; }
  const o = S.ordrer.find(x=>x.id===id); if (!o) return;
  const { data: filer, error } = await db.storage.from('bilder').list(String(id));
  if (error || !filer?.length) { visToast('Ingen bildefiler funnet i Storage for denne ordren'); return; }
  let gjenopprettet = 0;
  filer.forEach(fil => {
    const deler = fil.name.split('_');
    if (deler.length < 2) return;
    const side = deler[0];
    const idx = parseInt(deler[1]);
    if (isNaN(idx) || idx < 0 || idx > 5 || (side !== 'a' && side !== 'l')) return;
    const { data } = db.storage.from('bilder').getPublicUrl(`${id}/${fil.name}`);
    const url = data.publicUrl;
    if (side === 'a' && !o.bilderAnkomst[idx]) { o.bilderAnkomst[idx] = url; gjenopprettet++; }
    if (side === 'l' && !o.bilderLevering[idx]) { o.bilderLevering[idx] = url; gjenopprettet++; }
  });
  if (gjenopprettet === 0) { visToast('Alle plasser er allerede fylt — ingen mangler å gjenopprette'); return; }
  save(id); buildOrdreDetail();
  visToast(gjenopprettet + ' bilde(r) gjenopprettet fra Storage!', 'ok');
}

// Rydder opp ALLE Storage-filer som hører til en ordre (bilder - ankomst/levering/
// avstand-skader/signatur - og dokumenter, alt ligger under en mappe navngitt med
// ordre-id-en i sin respektive bucket) - kalles når selve ordren slettes for godt,
// slik at filene ikke blir liggende igjen og ta opp lagringsplass uten grunn.
async function slettOrdreStorageFiler(id) {
  if (!db) return;
  for (const bucket of ['bilder', 'ordre-dokumenter']) {
    try {
      const { data: filer, error } = await db.storage.from(bucket).list(String(id));
      if (error) { console.warn(`Kunne ikke liste ${bucket}-filer for ordre ${id}:`, error.message); continue; }
      if (filer?.length) {
        const { error: rmErr } = await db.storage.from(bucket).remove(filer.map(f => `${id}/${f.name}`));
        if (rmErr) console.warn(`Kunne ikke slette ${bucket}-filer for ordre ${id}:`, rmErr.message);
      }
    } catch (e) {
      console.warn(`Uventet feil ved opprydding av ${bucket}-filer for ordre ${id}:`, e);
    }
  }
}

async function slettFoto(id, side, idx) {
  const o=S.ordrer.find(x=>x.id===id); if(!o) return;
  const felt = FOTO_SIDER[side].felt;
  const url = o[felt][idx];
  // Slett fra Supabase Storage hvis det er en URL (ikke base64)
  if (db && url && url.startsWith('http')) {
    const filnavn = url.split('/bilder/')[1];
    if (filnavn) await db.storage.from('bilder').remove([filnavn]);
  }
  o[felt][idx]=null;
  save(id); buildOrdreDetail();
}

const DOK_TILLATTE_EXT = ['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','txt','csv','jpg','jpeg','png','heic'];
function dokIkon(navn) {
  const ext = (navn.split('.').pop()||'').toLowerCase();
  if (ext==='pdf') return '📄';
  if (['doc','docx','odt'].includes(ext)) return '📝';
  if (['xls','xlsx','ods','csv'].includes(ext)) return '📊';
  if (['ppt','pptx'].includes(ext)) return '📑';
  if (['jpg','jpeg','png','heic'].includes(ext)) return '🖼️';
  return '📁';
}
function dokumenterListeHTML(o) {
  const dok = o.dokumenter||[];
  if (!dok.length) return '<div class="muted small">Ingen dokumenter lagt til</div>';
  const erGodkjenner = me && (me.rolle==='godkjenner'||me.rolle==='admin');
  return dok.map((d,i)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #27272a30">
      <a href="${d.url}" target="_blank" rel="noopener" style="color:#ef4444;font-weight:600;text-decoration:none;font-size:13px;word-break:break-word">${dokIkon(d.navn)} ${esc(d.navn)}</a>
      ${erGodkjenner?`<button onclick="slettDokument('${o.id}',${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:15px;padding:0;flex-shrink:0">✕</button>`:''}
    </div>`).join('');
}

async function lastOppDokument(e, id) {
  const file = e.target.files[0]; if (!file) return;
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  if (!DOK_TILLATTE_EXT.includes(ext)) { alert('Filtype ikke tillatt. Godkjente typer: ' + DOK_TILLATTE_EXT.join(', ')); e.target.value=''; return; }
  const o = S.ordrer.find(x=>x.id===id); if (!o) return;
  if (!db) { visToast('Ikke koblet til Supabase'); return; }
  // Supabase Storage tillater ikke æøå/mellomrom/spesialtegn i selve filbanen -
  // det opprinnelige filnavnet vises fortsatt i appen (lagret i "navn" under),
  // dette er kun den tekniske lagringsnøkkelen.
  const tryggNavn = file.name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // æ/ø/å m.fl. -> nærmeste ascii-bokstav
    .replace(/[^a-zA-Z0-9.\-]/g, '_');
  const filnavn = `${id}/${Date.now()}_${tryggNavn}`;
  const { error } = await db.storage.from('ordre-dokumenter').upload(filnavn, file, {contentType: file.type || 'application/octet-stream', cacheControl:'31536000'});
  if (error) { visToast('Feil ved opplasting: ' + error.message); return; }
  const { data } = db.storage.from('ordre-dokumenter').getPublicUrl(filnavn);
  o.dokumenter = o.dokumenter || [];
  // Samme filnavn som et eksisterende dokument = ny versjon som erstatter den gamle,
  // i stedet for at gamle versjoner hoper seg opp i listen.
  const gammelIdx = o.dokumenter.findIndex(d => d.navn === file.name);
  if (gammelIdx !== -1) {
    const gammel = o.dokumenter[gammelIdx];
    const gammeltFilnavn = gammel.url.split('/ordre-dokumenter/')[1];
    if (gammeltFilnavn) await db.storage.from('ordre-dokumenter').remove([gammeltFilnavn]);
    o.dokumenter[gammelIdx] = { navn: file.name, url: data.publicUrl, lastetOppAv: me.navn, dato: new Date().toISOString() };
    o.dokumenter = [...o.dokumenter];
    logChange(o, 'Erstattet dokument med ny versjon: ' + file.name);
  } else {
    o.dokumenter = [...o.dokumenter, { navn: file.name, url: data.publicUrl, lastetOppAv: me.navn, dato: new Date().toISOString() }];
    logChange(o, 'Lastet opp dokument: ' + file.name);
  }
  db.from('ordrer').update({dokumenter:o.dokumenter}).eq('id', id)
    .then(r=>{if(r.error) console.error('Dokument-oppdatering feilet:', r.error.message);});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(err){}
  e.target.value = '';
  const listEl = document.getElementById('dokumenterListe_'+id);
  if (listEl) listEl.innerHTML = dokumenterListeHTML(o);
}

async function slettDokument(id, idx) {
  const o = S.ordrer.find(x=>x.id===id); if (!o) return;
  const dok = o.dokumenter[idx]; if (!dok) return;
  if (!confirm(`Slette "${dok.navn}"?`)) return;
  if (db && dok.url) {
    const filnavn = dok.url.split('/ordre-dokumenter/')[1];
    if (filnavn) await db.storage.from('ordre-dokumenter').remove([filnavn]);
  }
  o.dokumenter = o.dokumenter.filter((_,i)=>i!==idx);
  logChange(o, 'Slettet dokument: ' + dok.navn);
  if (db) db.from('ordrer').update({dokumenter:o.dokumenter}).eq('id', id)
    .then(r=>{if(r.error) console.error('Dokument-oppdatering feilet:', r.error.message);});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(err){}
  const listEl = document.getElementById('dokumenterListe_'+id);
  if (listEl) listEl.innerHTML = dokumenterListeHTML(o);
}

