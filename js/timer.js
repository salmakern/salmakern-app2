// ════════════════════════════════════════════════════
// TIMER (LØNN)
// ════════════════════════════════════════════════════
function initTimerPage() {
  const d=new Date();
  document.getElementById('timerDatoLbl').textContent=d.toLocaleDateString('no',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  timerType='normal';
  highlightTimerType();
  renderTimerHistorikk();
  // Gjenopprett pågående timer hvis siden ble lukket
  const lagretStart = localStorage.getItem('timerStart_'+me?.id);
  if (lagretStart) {
    const ts = parseInt(lagretStart);
    const mins = Math.floor((Date.now()-ts)/60000);
    if (mins < 1440) { // maks 24 timer
      timerStart = ts;
      if (timerTick) clearInterval(timerTick);
      timerTick = setInterval(updateClock,1000);
      document.getElementById('stoppBtn').disabled=false;
      document.getElementById('startBtn').disabled=true;
      document.getElementById('clockEl').classList.add('running');
      updateClock();
    } else {
      localStorage.removeItem('timerStart_'+me?.id);
    }
  }
}

function setTimerType(t) {
  timerType=t;
  highlightTimerType();
  document.getElementById('manuellFelt').style.display=t==='manuell'?'block':'none';
  document.getElementById('ferieFelt').style.display=(t==='ferie'||t==='permisjon')?'block':'none';
  const today=new Date().toISOString().split('T')[0];
  if(t==='manuell'){
    const mDato=document.getElementById('mDato'); if(mDato&&!mDato.value) mDato.value=today;
  }
  if(t==='ferie'||t==='permisjon'){
    document.getElementById('fFra').value=today;
    document.getElementById('fTil').value=today;
  }
}

function highlightTimerType() {
  ['normal','manuell','syk','egenmelding','ferie','permisjon'].forEach(t=>{
    const el=document.getElementById('ttype_'+t);
    if(el) el.style.borderColor=t===timerType?'#ef4444':'#27272a';
  });
}

// ── GPS HELPERS ──
function haversine(lat1,lng1,lat2,lng2) {
  const R=6371000, dL=(lat2-lat1)*Math.PI/180, dG=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function settGPSLokasjon() {
  if(!navigator.geolocation){alert('GPS ikke støttet på denne enheten');return;}
  const btn=document.getElementById('gpsSettBtn');
  if(btn){btn.textContent='Henter posisjon...';btn.disabled=true;}
  navigator.geolocation.getCurrentPosition(pos=>{
    S.gps.lat=pos.coords.latitude; S.gps.lng=pos.coords.longitude;
    saveInnstillinger();
    if(btn){btn.textContent='Sett arbeidsplasslokasjon';btn.disabled=false;}
    renderMer();
    alert('✅ GPS-lokasjon lagret!');
  }, ()=>{
    alert('Kunne ikke hente GPS-posisjon. Prøv igjen.');
    if(btn){btn.textContent='Sett arbeidsplasslokasjon';btn.disabled=false;}
  },{timeout:10000});
}

function endreGPSRadius(val) {
  S.gps.radius=Number(val);
  saveInnstillinger();
}

function startTimer() {
  // No GPS configured → start directly
  if(!S.gps||!S.gps.lat) { doStartTimer('Ingen GPS konfigurert'); return; }
  if(!navigator.geolocation) { openTimerPIN('GPS ikke støttet på denne enheten'); return; }
  const btn=document.getElementById('startBtn');
  if(btn){btn.textContent='⏳ Sjekker GPS...';btn.disabled=true;}
  navigator.geolocation.getCurrentPosition(pos=>{
    const dist=haversine(pos.coords.latitude,pos.coords.longitude,S.gps.lat,S.gps.lng);
    if(dist<=S.gps.radius){ doStartTimer('GPS verifisert ('+Math.round(dist)+'m)'); }
    else { openTimerPIN(`Du er ${Math.round(dist)} m fra arbeidsplassen (maks ${S.gps.radius} m). Tast inn dagens PIN for å overstyre.`); }
  }, ()=>{ openTimerPIN('GPS ikke tilgjengelig. Tast inn dagens PIN for å starte timer.'); },
  {timeout:8000,maximumAge:30000});
}

function openTimerPIN(melding) {
  const btn=document.getElementById('startBtn');
  if(btn){btn.textContent='▶ Start';btn.disabled=false;}
  document.getElementById('timerPINMsg').textContent=melding;
  document.getElementById('timerPINInput').value='';
  document.getElementById('timerPINErr').textContent='';
  openModal('timerPIN');
}

function bekreftTimerPIN() {
  const pin=document.getElementById('timerPINInput').value;
  if(pin!==S.dagensPIN){document.getElementById('timerPINErr').textContent='Feil PIN – prøv igjen';return;}
  closeModal('timerPIN');
  if(timerPINMode==='manuell') {
    doLagreManuellTimer();
  } else {
    doStartTimer('Startet med PIN-overstyring');
  }
}

function doLagreManuellTimer() {
  if(!me) return;
  const start=document.getElementById('mFra').value;
  const stopp=document.getElementById('mTil').value;
  const [sh,sm]=start.split(':').map(Number);
  const [eh,em]=stopp.split(':').map(Number);
  const mins=Math.max(0,(eh*60+em)-(sh*60+sm)-30);
  const dato=document.getElementById('mDato')?.value||new Date().toISOString().split('T')[0];
  const entry={
    id:'t'+(++S.nextId), ansattId:me.id, ansatt:me.navn,
    dato, type:'manuell', start, stopp, mins, _localAt:Date.now()
  };
  S.timer.push(entry);
  if(db) db.from('timer_entries').insert({
    id:entry.id,ansatt_id:me.id,ansatt:me.navn,
    dato:entry.dato,type:'manuell',start,stopp,mins
  }).then(r=>{if(r.error) console.error('Timer feil:',r.error.message);});
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  renderTimerHistorikk(); renderTimerMaaned();
  document.getElementById('mFra').value='';
  document.getElementById('mTil').value='';
  timerPINMode='gps';
}

function doStartTimer(notat) {
  const btn=document.getElementById('startBtn');
  if(btn){btn.textContent='▶ Start';btn.disabled=true;}
  timerStart=Date.now();
  localStorage.setItem('timerStart_'+me?.id, timerStart);
  document.getElementById('stoppBtn').disabled=false;
  document.getElementById('clockEl').classList.add('running');
  timerTick=setInterval(updateClock,1000);
  updateClock();
  console.log('Timer startet:',notat);
}

function stoppTimer() {
  if(timerTick){clearInterval(timerTick);timerTick=null;}
  document.getElementById('startBtn').disabled=false;
  document.getElementById('stoppBtn').disabled=true;
  document.getElementById('clockEl').classList.remove('running');
  document.getElementById('clockEl').classList.add('stopped');
}

function updateClock() {
  if(!timerStart) return;
  const ms=Date.now()-timerStart;
  const mins=Math.floor(ms/60000);
  const pause=mins>=480?30:(mins>=240?0:0); // 30 min pause if >=8 hours
  const netto=Math.max(0,mins-pause);
  const t=h=>h.toString().padStart(2,'0');
  document.getElementById('clockTime').textContent=`${t(Math.floor(netto/60))} t ${t(netto%60)} min`;
  const startStr=new Date(timerStart).toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  const nowStr=new Date().toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('clockRange').textContent=`${startStr} – ${nowStr}`;
  document.getElementById('clockPause').textContent=pause>0?`(−${pause} min pause)`:'';
}

function lagreTimer() {
  if(!me) return;
  let start='', stopp='', mins=0;
  if (timerType==='manuell') {
    start=document.getElementById('mFra').value;
    stopp=document.getElementById('mTil').value;
    if(!start||!stopp){alert('Fyll inn fra- og til-tid');return;}
    const [sh,sm]=start.split(':').map(Number);const [eh,em]=stopp.split(':').map(Number);
    mins=(eh*60+em)-(sh*60+sm)-30;
    // Krev dagens PIN for manuell registrering
    timerPINMode='manuell';
    openTimerPIN('Tast inn dagens PIN for å bekrefte manuell timeregistrering');
    return;
  } else if (timerStart) {
    const ms=Date.now()-timerStart;
    mins=Math.floor(ms/60000);
    const pause=mins>=480?30:0;
    mins=Math.max(0,mins-pause);
    start=new Date(timerStart).toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
    stopp=new Date().toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  } else if (['ferie','permisjon'].includes(timerType)) {
    // Date range — create one entry per weekday
    const fra=document.getElementById('fFra').value;
    const til=document.getElementById('fTil').value;
    if(!fra||!til){alert('Velg fra- og til-dato');return;}
    const entries=[];
    let cur=new Date(fra);
    const end=new Date(til);
    while(cur<=end){
      const dag=cur.getDay();
      if(dag!==0&&dag!==6){ // skip weekends
        entries.push({
          id:'t'+(++S.nextId), ansattId:me.id, ansatt:me.navn,
          dato:cur.toISOString().split('T')[0], type:timerType,
          start:'–', stopp:'–', mins:0, _localAt:Date.now()
        });
      }
      cur.setDate(cur.getDate()+1);
    }
    if(!entries.length){alert('Ingen hverdager i valgt periode');return;}
    entries.forEach(e=>{
      S.timer.push(e);
      if(db) db.from('timer_entries').insert({id:e.id,ansatt_id:me.id,ansatt:me.navn,dato:e.dato,type:timerType,start:'–',stopp:'–',mins:0})
        .then(r=>{if(r.error) console.error('Timer lagringsfeil:',r.error.message);});
    });
    try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
    renderTimerHistorikk(); renderTimerMaaned();
    return;
  } else if (['syk','egenmelding'].includes(timerType)) {
    mins=0; start='–'; stopp='–';
  } else { alert('Start timer først'); return; }
  const timerEntry={
    id:'t'+(++S.nextId), ansattId:me.id, ansatt:me.navn,
    dato:new Date().toISOString().split('T')[0], type:timerType,
    start, stopp, mins, _localAt:Date.now()
  };
  S.timer.push(timerEntry);
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if(db) db.from('timer_entries').insert({
    id:timerEntry.id, ansatt_id:me.id, ansatt:me.navn,
    dato:timerEntry.dato, type:timerType, start, stopp, mins
  }).then(r=>{if(r.error) console.error('Timer lagringsfeil:',r.error.message);});
  localStorage.removeItem('timerStart_'+me?.id);
  renderTimerHistorikk();
  stoppTimer();
  timerStart=null;
  document.getElementById('clockEl').classList.remove('stopped');
  document.getElementById('clockTime').textContent='00 t 00 min';
  document.getElementById('clockRange').textContent='--:-- – --:--';
  document.getElementById('clockPause').textContent='';
}

function renderTimerHistorikk() {
  if(!me) return;
  const el=document.getElementById('timerHistorikk'); if(!el) return;
  const today=new Date().toISOString().split('T')[0];
  const mine=S.timer.filter(t=>t.ansattId===me.id&&t.dato===today);
  if(!mine.length){el.innerHTML='<div class="muted small">Ingen timer registrert i dag</div>';return;}
  el.innerHTML='<div class="h" style="margin-bottom:8px">Registrert i dag</div>'+
    mine.map(t=>`<div class="box" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div><div class="small"><b>${t.dato}</b> – ${t.type}</div><div class="small muted">${t.start} – ${t.stopp}</div></div>
      <div class="small">${t.mins?Math.floor(t.mins/60)+'t '+t.mins%60+'m':'–'}</div>
    </div>`).join('');
  renderTimerMaaned();
}

let timerMaanedOffset=0; // 0=nåværende måned, -1=forrige, osv

function erHelg(datoStr) {
  const d = new Date(datoStr);
  const dag = d.getDay(); // 0=søn, 6=lør
  return dag === 0 || dag === 6;
}

function beregnOvertid(mins, datoStr) {
  if (erHelg(datoStr)) {
    return {normal: 0, ot50: 0, ot100: mins};
  }
  const normal = Math.min(mins, 450);   // 7.5 timer = 450 min
  const rest   = Math.max(0, mins - 450);
  const ot50   = Math.min(rest, 270);   // neste 4.5 timer = 270 min (til 12 timer totalt)
  const ot100  = Math.max(0, rest - 270);
  return {normal, ot50, ot100};
}

function timerMaanedNaviger(dir) {
  timerMaanedOffset+=dir;
  renderTimerMaaned();
}

function renderTimerMaaned() {
  if(!me) return;
  const now=new Date();
  const year=new Date(now.getFullYear(), now.getMonth()+timerMaanedOffset, 1).getFullYear();
  const month=new Date(now.getFullYear(), now.getMonth()+timerMaanedOffset, 1).getMonth();
  const prefix=`${year}-${String(month+1).padStart(2,'0')}`;
  const maanedNavn=['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  const lbl=document.getElementById('timerMaanedLbl');
  const sammendrag=document.getElementById('timerMaanedSammendrag');
  const liste=document.getElementById('timerMaanedListe');
  if(!lbl||!sammendrag||!liste) return;

  lbl.textContent=`${maanedNavn[month]} ${year}`;

  const mine=S.timer.filter(t=>t.ansattId===me.id&&t.dato?.startsWith(prefix));

  const totMins=mine.filter(t=>t.mins>0).reduce((s,t)=>s+t.mins,0);
  const arbDager=new Set(mine.filter(t=>['normal','manuell'].includes(t.type)).map(t=>t.dato)).size;
  const sykDager=mine.filter(t=>t.type==='syk'||t.type==='egenmelding').length;
  const ferieDager=mine.filter(t=>t.type==='ferie').length;
  const permDager=mine.filter(t=>t.type==='permisjon').length;

  let totNormal = 0, totOt50 = 0, totOt100 = 0;
  mine.filter(t=>t.mins>0).forEach(t => {
    const ot = beregnOvertid(t.mins, t.dato);
    totNormal += ot.normal;
    totOt50   += ot.ot50;
    totOt100  += ot.ot100;
  });

  sammendrag.innerHTML=`<div class="grid g3" style="margin-bottom:10px;gap:8px">
    <div class="box" style="text-align:center">
      <div class="muted small">Total arbeidstid</div>
      <div class="title">${Math.floor(totMins/60)}<span style="font-size:14px;font-weight:400"> t </span>${totMins%60}<span style="font-size:14px;font-weight:400"> min</span></div>
    </div>
    <div class="box" style="text-align:center">
      <div class="muted small">Arbeidsdager</div>
      <div class="title">${arbDager}</div>
    </div>
    <div class="box" style="text-align:center">
      <div class="muted small">Syk / egenmelding</div>
      <div class="title">${sykDager}</div>
    </div>
    <div class="box" style="text-align:center">
      <div class="muted small">Normal tid</div>
      <div class="title">${Math.floor(totNormal/60)}<span style="font-size:14px;font-weight:400"> t </span>${totNormal%60}<span style="font-size:14px;font-weight:400"> min</span></div>
    </div>
    <div class="box" style="text-align:center">
      <div class="muted small" style="color:#facc15">50% overtid</div>
      <div class="title" style="color:#facc15">${Math.floor(totOt50/60)}<span style="font-size:14px;font-weight:400"> t </span>${totOt50%60}<span style="font-size:14px;font-weight:400"> min</span></div>
    </div>
    <div class="box" style="text-align:center">
      <div class="muted small" style="color:#f97316">100% overtid</div>
      <div class="title" style="color:#f97316">${Math.floor(totOt100/60)}<span style="font-size:14px;font-weight:400"> t </span>${totOt100%60}<span style="font-size:14px;font-weight:400"> min</span></div>
    </div>
    ${ferieDager+permDager>0?`<div class="box" style="text-align:center">
      <div class="muted small">Ferie / Permisjon</div>
      <div class="title">${ferieDager>0?ferieDager+'d ferie':''}${ferieDager>0&&permDager>0?' · ':''}${permDager>0?permDager+'d perm':''}</div>
    </div>`:''}
  </div>`;

  if(!mine.length){liste.innerHTML='<div class="muted small">Ingen registreringer denne måneden</div>';return;}

  const sorted=[...mine].sort((a,b)=>b.dato.localeCompare(a.dato));
  liste.innerHTML=sorted.map(t=>{
    const ot = beregnOvertid(t.mins||0, t.dato);
    const otTxt = (ot.ot50>0||ot.ot100>0)
      ? `<span style="color:#facc15;margin-left:4px">${ot.ot50>0?'+'+Math.round(ot.ot50/60*10)/10+'t 50%':''}</span>`+
        `<span style="color:#f97316;margin-left:4px">${ot.ot100>0?'+'+Math.round(ot.ot100/60*10)/10+'t 100%':''}</span>`
      : '';
    return `
    <div class="box" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="small"><b>${t.dato}</b> &nbsp;<span class="pill" style="font-size:11px;padding:2px 8px">${t.type}</span></div>
        <div class="small muted">${t.start} – ${t.stopp}</div>
      </div>
      <div class="small" style="font-weight:700;text-align:right">${t.mins?Math.floor(t.mins/60)+'t '+t.mins%60+'m':'–'}${otTxt}</div>
    </div>`;
  }).join('');
}

