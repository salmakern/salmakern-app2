// ════════════════════════════════════════════════════
// TIMER (LØNN)
// ════════════════════════════════════════════════════
// JSDoc-typer på de lønnskritiske beregningsfunksjonene under (se CLAUDE.md
// "Typesjekking") - gir hover-dokumentasjon i editoren. Prøvde `@ts-check`
// for hele filen også, men resten av filen er tung på
// `document.getElementById(id).value/.disabled`, som TypeScript krever en
// eksplisitt type-cast for per kall (HTMLElement har ikke .value/.disabled) -
// det er en helt annen og mye større jobb enn å typedokumentere disse fire
// rene funksjonene, så det er bevisst latt være for nå.

// Delt pauseregel for både automatisk klokke og manuell registrering: 30 min
// lunsjpause trekkes fra kun ved 8+ timer (480 min), aldri et fast fratrekk
// uansett vaktlengde. Egen funksjon nettopp fordi denne regelen tidligere fantes
// to steder og kom ut av sync (manuell registrering trakk alltid fra 30 min).
/**
 * @param {number} raaMinutter
 * @returns {{ pause: number, netto: number }}
 */
function beregnNettoMinutter(raaMinutter) {
  const pause = raaMinutter >= 480 ? 30 : 0;
  return { pause, netto: Math.max(0, raaMinutter - pause) };
}

// "kl 07:30"-"kl 15:30"-tekst → antall minutter etter samme pauseregel som
// beregnNettoMinutter (brukt av manuell timeregistrering).
/**
 * @param {string} start "TT:MM"
 * @param {string} stopp "TT:MM"
 * @returns {{ raatid: number, pause: number, mins: number }}
 */
function beregnManuellMinutter(start, stopp) {
  const [sh,sm]=start.split(':').map(Number);
  const [eh,em]=stopp.split(':').map(Number);
  const raatid=(eh*60+em)-(sh*60+sm);
  const { pause, netto }=beregnNettoMinutter(raatid);
  return { raatid, pause, mins: netto };
}

function initTimerPage() {
  const d=new Date();
  document.getElementById('timerDatoLbl').textContent=d.toLocaleDateString('no',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  timerType='normal';
  highlightTimerType();
  renderTimerHistorikk();
  visSykemeldingPaaminnelse();
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
      updateClock();
    } else {
      localStorage.removeItem('timerStart_'+me?.id);
    }
  }
}

// Påminner den ansatte selv om å levere sykemeldingen (legeerklæringen) for sykedager som
// admin ennå ikke har huket av som levert (se adminSettSykemeldingLevert() i
// ansatte-utstyr.js) - tidligere var dette kun synlig for admin i en helt annen del av
// appen, den ansatte selv fikk aldri noen påminnelse (bedt om av Henrik 2026-10-08). Ren
// informasjon - selve avkrysningen gjøres fortsatt kun av admin.
function visSykemeldingPaaminnelse() {
  const el = document.getElementById('sykemeldingReminderBanner'); if (!el || !me) return;
  const datoer = (S.timer||[])
    .filter(t=>t.ansattId===me.id && t.type==='syk' && !t.sykemeldingLevert)
    .map(t=>t.dato).sort();
  if (!datoer.length) { el.style.display='none'; return; }
  const vist = datoer.slice(0,5).join(', ') + (datoer.length>5 ? ` og ${datoer.length-5} flere` : '');
  el.textContent = `⚠ Husk å levere sykemelding for: ${vist}`;
  el.style.display = 'block';
}

function setTimerType(t) {
  timerType=t;
  highlightTimerType();
  const vis=(id,paa)=>{const el=document.getElementById(id); if(el) el.style.display=paa?'block':'none';};
  vis('normalFelt', t==='normal');
  vis('manuellFelt', t==='manuell');
  // Syk (sykemelding) bruker samme fra/til-periodefelt som Ferie/Permisjon - en
  // sykemelding gjelder som regel en hel periode fra legen, ikke én og én dag, og en
  // forlengelse (ny sykemelding som utsetter friskmeldingen) legges da bare inn som en
  // ny periode med oppdatert til-dato, i stedet for å måtte registrere dag for dag.
  // Egenmelding dekker alltid 3 virkedager fra og med i dag automatisk (se lagreTimer()) -
  // intet eget datofelt lenger (det forrige datofeltet ble aldri faktisk lest/brukt, bare
  // stående og misvisende - fjernet 2026-10-08).
  vis('ferieFelt', t==='ferie'||t==='permisjon'||t==='syk');
  vis('sykFelt', t==='egenmelding');
  const today=new Date().toISOString().split('T')[0];
  if(t==='manuell'){
    const mDato=document.getElementById('mDato'); if(mDato&&!mDato.value) mDato.value=today;
  }
  if(t==='egenmelding'){
    visEgenmeldingKvoteInfo();
  }
  if(t==='ferie'||t==='permisjon'||t==='syk'){
    document.getElementById('fFra').value=today;
    document.getElementById('fTil').value=today;
  }
  oppdaterTilstandPille();
}

// Viser hvor mange egenmeldinger den ansatte har brukt siste 12 måneder FØR de trykker
// Lagre, i stedet for at det kun vises en melding etterpå (bedt om av Henrik 2026-10-08).
function visEgenmeldingKvoteInfo() {
  const el = document.getElementById('egenmeldingKvoteInfo'); if (!el || !me) return;
  const idag = new Date().toISOString().split('T')[0];
  if (!egenmeldingKvalifisert(me.ansettelsesdato, idag)) {
    el.textContent = `Ikke kvalifisert for egenmelding ennå (krever 2 måneders ansettelse)`;
    el.style.color = '#fca5a5';
    return;
  }
  const brukt = egenmeldingEpisoderSisteAar(S.timer, me.id, idag);
  if (brukt < 4) {
    el.textContent = `${brukt} av 4 egenmeldinger brukt siste 12 måneder`;
    el.style.color = '#a1a1aa';
  } else {
    el.textContent = `${brukt} av 4 egenmeldinger brukt siste 12 måneder - denne blir UBETALT`;
    el.style.color = '#fca5a5';
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
    saveGPS();
    if(btn){btn.textContent='Sett arbeidsplasslokasjon';btn.disabled=false;}
    renderMer();
    alert('✅ GPS-lokasjon lagret!');
  }, err=>{
    let msg='Kunne ikke hente GPS-posisjon. Prøv igjen.';
    if(err && err.code===1) msg='Nettleseren/enheten nekter tilgang til posisjon. Skru på Stedstjenester/Location for nettleseren i systeminnstillingene, og tillat posisjon for denne siden i nettleserinnstillingene.';
    else if(err && err.code===2) msg='Posisjon ikke tilgjengelig akkurat nå. Sjekk at Stedstjenester/GPS er skrudd på, og prøv igjen.';
    else if(err && err.code===3) msg='Tidsavbrudd - fant ikke posisjon innen 10 sekunder. Prøv igjen, gjerne utendørs eller nær et vindu.';
    alert(msg);
    if(btn){btn.textContent='Sett arbeidsplasslokasjon';btn.disabled=false;}
  },{timeout:10000});
}

function endreGPSRadius(val) {
  S.gps.radius=Number(val);
  saveGPS();
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
  const { mins }=beregnManuellMinutter(start,stopp);
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

// Fremdriftsringen rundt klokka - klokkeGraderSist husker siste vinkel (0-360, andel
// av en 7,5t arbeidsdag) slik at stopp kan fryse ringen der den var i stedet for å måtte
// regne den på nytt. Går = grønn gradient + pulserende glød, stoppet = rød gradient uten
// puls (fryser på siste vinkel), ikke startet = flat nøytral ring.
let klokkeGraderSist = 0;
function oppdaterKlokkeRing(grader, kjorer) {
  klokkeGraderSist = grader;
  const el = document.getElementById('clockEl');
  const tilstand = document.getElementById('clockTilstand');
  if (!el) return;
  if (kjorer) {
    el.style.background = `conic-gradient(from 0deg, #16a34a 0deg, #22c55e ${grader/2}deg, #4ade80 ${grader}deg, #27272a ${grader}deg 360deg)`;
    el.style.animation = 'pulseGlow 3s ease-in-out infinite';
    el.style.boxShadow = 'none';
    if (tilstand) { tilstand.textContent = '● GÅR NÅ'; tilstand.style.color = '#4ade80'; }
  } else if (grader > 0) {
    el.style.background = `conic-gradient(from 0deg, #dc2626 0deg, #ef4444 ${grader/2}deg, #f87171 ${grader}deg, #27272a ${grader}deg 360deg)`;
    el.style.animation = 'none';
    el.style.boxShadow = '0 0 34px rgba(239,68,68,.16)';
    if (tilstand) { tilstand.textContent = '■ STOPPET'; tilstand.style.color = '#f87171'; }
  } else {
    el.style.background = '#27272a';
    el.style.animation = 'none';
    el.style.boxShadow = 'none';
    if (tilstand) { tilstand.textContent = 'IKKE STARTET'; tilstand.style.color = '#71717a'; }
  }
}

function oppdaterTilstandPille() {
  const p=document.getElementById('timerTilstandPille');
  if(!p) return;
  if(timerType!=='normal'){ p.textContent=timerType; p.style.color='#a1a1aa'; p.style.borderColor='#27272a'; return; }
  if(timerTick){ p.textContent='● Klokka går'; p.style.color='#4ade80'; p.style.borderColor='rgba(34,197,94,.32)'; }
  else if(klokkeGraderSist>0){ p.textContent='■ Stoppet'; p.style.color='#fca5a5'; p.style.borderColor='rgba(239,68,68,.32)'; }
  else { p.textContent='Ikke startet'; p.style.color='#a1a1aa'; p.style.borderColor='#27272a'; }
}

// Kutter resten av en pågående egenmelding-periode (fra og med i dag) hvis den ansatte
// starter en vanlig timer igjen - se egenmeldingerAaAvbryte() for begrunnelse. Rene,
// allerede passerte egenmelding-dager (før i dag) røres ikke.
function avbrytAktivEgenmelding() {
  if (!me) return;
  const today = new Date().toISOString().split('T')[0];
  const avbrutte = egenmeldingerAaAvbryte(S.timer, me.id, today);
  if (!avbrutte.length) return;
  const avbrutteId = new Set(avbrutte.map(t=>t.id));
  S.timer = (S.timer||[]).filter(t=>!avbrutteId.has(t.id));
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if(db) db.from('timer_entries').delete().in('id', [...avbrutteId])
    .then(r=>{if(r.error) console.error('Avbryting av egenmelding feilet:',r.error.message);});
  renderTimerHistorikk(); renderTimerMaaned();
}

function doStartTimer(notat) {
  avbrytAktivEgenmelding();
  const btn=document.getElementById('startBtn');
  if(btn){btn.textContent='▶ Start';btn.disabled=true;}
  timerStart=Date.now();
  localStorage.setItem('timerStart_'+me?.id, timerStart);
  document.getElementById('stoppBtn').disabled=false;
  timerTick=setInterval(updateClock,1000);
  updateClock();
  console.log('Timer startet:',notat);
  oppdaterTilstandPille();
}

function stoppTimer() {
  if(timerTick){clearInterval(timerTick);timerTick=null;}
  document.getElementById('startBtn').disabled=false;
  document.getElementById('stoppBtn').disabled=true;
  oppdaterKlokkeRing(klokkeGraderSist, false);
  oppdaterTilstandPille();
}

function updateClock() {
  if(!timerStart) return;
  const ms=Date.now()-timerStart;
  const mins=Math.floor(ms/60000);
  const { pause, netto }=beregnNettoMinutter(mins);
  const t=h=>h.toString().padStart(2,'0');
  document.getElementById('clockT').textContent=t(Math.floor(netto/60));
  document.getElementById('clockM').textContent=t(netto%60);
  const startStr=new Date(timerStart).toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  const nowStr=new Date().toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('clockRange').textContent=`${startStr} – ${nowStr}`;
  document.getElementById('clockPause').textContent=pause>0?`(−${pause} min pause)`:'';
  oppdaterKlokkeRing(Math.min(netto/(7.5*60),1)*360, true);
}

function lagreTimer() {
  if(!me) return;
  let start='', stopp='', mins=0;
  if (timerType==='manuell') {
    start=document.getElementById('mFra').value;
    stopp=document.getElementById('mTil').value;
    if(!start||!stopp){alert('Fyll inn fra- og til-tid');return;}
    // Krev dagens PIN for manuell registrering
    timerPINMode='manuell';
    openTimerPIN('Tast inn dagens PIN for å bekrefte manuell timeregistrering');
    return;
  } else if (timerStart) {
    const ms=Date.now()-timerStart;
    mins=beregnNettoMinutter(Math.floor(ms/60000)).netto;
    start=new Date(timerStart).toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
    stopp=new Date().toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  } else if (['ferie','permisjon','syk'].includes(timerType)) {
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
    entries.forEach(e=>S.timer.push(e));
    // Ett samlet insert-kall for alle dagene i perioden i stedet for ett per dag - en
    // lengre ferie/permisjon kan fort bli mange enkeltkall, som har vist seg upålitelig
    // (se flyttVare()/registrerLagerEndring() sine kommentarer for samme problem).
    if(db) db.from('timer_entries').insert(entries.map(e=>({id:e.id,ansatt_id:me.id,ansatt:me.navn,dato:e.dato,type:timerType,start:'–',stopp:'–',mins:0})))
      .then(r=>{if(r.error) console.error('Timer lagringsfeil:',r.error.message);});
    try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
    renderTimerHistorikk(); renderTimerMaaned();
    return;
  } else if (timerType==='egenmelding') {
    // Se genererEgenmeldingDager/egenmeldingEpisoderSisteAar lenger opp i filen for
    // begrunnelse (3 kalenderdager, maks 4 betalte episoder siste rullerende 12 måneder).
    const idag = new Date().toISOString().split('T')[0];
    if (!egenmeldingKvalifisert(me.ansettelsesdato, idag)) {
      alert('Du kan ikke bruke egenmelding ennå - dette krever minst 2 måneders ansettelse.');
      return;
    }
    const periodeId = 'ep'+(++S.nextId);
    const tidligereEpisoder = egenmeldingEpisoderSisteAar(S.timer, me.id, idag);
    const betalt = tidligereEpisoder < 4;
    const dager = genererEgenmeldingDager(idag, 3);
    const entries = dager.map(dato=>({
      id:'t'+(++S.nextId), ansattId:me.id, ansatt:me.navn,
      dato, type:'egenmelding', start:'–', stopp:'–', mins:0, betalt,
      egenmeldingPeriodeId:periodeId, _localAt:Date.now()
    }));
    entries.forEach(e=>S.timer.push(e));
    // Ett samlet insert-kall for alle 3 dagene i stedet for ett per dag, samme mønster
    // som ferie/permisjon/syk rett over.
    if(db) db.from('timer_entries').insert(entries.map(e=>({
        id:e.id, ansatt_id:me.id, ansatt:me.navn, dato:e.dato, type:'egenmelding',
        start:'–', stopp:'–', mins:0, betalt, egenmelding_periode_id:periodeId
      }))).then(r=>{if(r.error) console.error('Timer lagringsfeil:',r.error.message);});
    try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
    renderTimerHistorikk(); renderTimerMaaned(); visEgenmeldingKvoteInfo();
    visToast(
      betalt
        ? `Egenmelding registrert ${dager[0]} til ${dager[dager.length-1]}`
        : `Egenmelding registrert ${dager[0]} til ${dager[dager.length-1]} - UBETALT (mer enn 4 egenmeldinger brukt siste 12 måneder)`,
      betalt?'ok':'feil'
    );
    return;
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
  document.getElementById('clockT').textContent='00';
  document.getElementById('clockM').textContent='00';
  document.getElementById('clockRange').textContent='--:-- – --:--';
  document.getElementById('clockPause').textContent='';
  oppdaterKlokkeRing(0, false);
}

function renderTimerHistorikk() {
  if(!me) return;
  const el=document.getElementById('timerHistorikk'); if(!el) return;
  const today=new Date().toISOString().split('T')[0];
  const mine=S.timer.filter(t=>t.ansattId===me.id&&t.dato===today);
  if(!mine.length){el.innerHTML='<div class="muted small">Ingen timer registrert i dag</div>';return;}
  el.innerHTML=mine.map(t=>`<div class="box" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
      <div><div class="small"><b>${t.dato}</b> – ${t.type}</div><div class="small muted">${t.start} – ${t.stopp}</div></div>
      <div class="small">${t.mins?Math.floor(t.mins/60)+'t '+t.mins%60+'m':'–'}</div>
    </div>`).join('');
  renderTimerMaaned();
}

let timerMaanedOffset=0; // 0=nåværende måned, -1=forrige, osv

/**
 * @param {string} datoStr "ÅÅÅÅ-MM-DD"
 * @returns {boolean}
 */
function erHelg(datoStr) {
  const d = new Date(datoStr);
  const dag = d.getDay(); // 0=søn, 6=lør
  return dag === 0 || dag === 6;
}

// Egenmelding dekker 3 sammenhengende KALENDERDAGER (IKKE bare virkedager - helg telles
// med) fra og med datoen den registreres. Rettet 2026-10-08 (var feilaktig 3 virkedager
// med hopp over helg frem til da) etter at Henrik delte den faktiske minimumsregelen for
// egenmelding uten IA-avtale: "maks 3 kalenderdager per gang". Å hoppe over helg ville i
// praksis gitt en hel ukes dekning (fre+man+tir) i stedet for de lovbestemte 3 dagene.
/**
 * @param {string} fraDatoStr "ÅÅÅÅ-MM-DD"
 * @param {number} antallDager
 * @returns {string[]}
 */
function genererEgenmeldingDager(fraDatoStr, antallDager=3) {
  const dager=[];
  let cur=new Date(fraDatoStr);
  for (let i=0; i<antallDager; i++) {
    dager.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate()+1);
  }
  return dager;
}

// Teller ANTALL EGENMELDINGS-EPISODER (ikke antall dager) en ansatt har brukt de siste
// RULLERENDE 12 månedene (ikke kalenderår - rettet 2026-10-08 etter samme presisering fra
// Henrik: "maks 4 ganger i løpet av 12 måneder", ikke "4 ganger per kalenderår"), via
// egenmelding_periode_id som knytter de 3 dagene i én egenmelding sammen. Brukes til å
// avgjøre om en NY egenmelding er den 5. (eller senere) siste 12 måneder, og dermed skal
// registreres som ubetalt (se lagreTimer()). tilDatoStr er datoen den NYE egenmeldingen
// registreres (normalt i dag) - vinduet regnes 12 måneder bakover FRA DEN datoen.
/**
 * @param {Array<{ansattId:number,type:string,egenmeldingPeriodeId?:string,dato:string}>} timerListe
 * @param {number} ansattId
 * @param {string} tilDatoStr "ÅÅÅÅ-MM-DD"
 * @returns {number}
 */
function egenmeldingEpisoderSisteAar(timerListe, ansattId, tilDatoStr) {
  const tilDato = new Date(tilDatoStr);
  const fraDato = new Date(tilDato);
  fraDato.setFullYear(fraDato.getFullYear()-1);
  fraDato.setDate(fraDato.getDate()+1); // inkluderende 12-måneders vindu
  const ider = new Set();
  (timerListe||[]).forEach(t=>{
    if (t.ansattId===ansattId && t.type==='egenmelding' && t.egenmeldingPeriodeId && t.dato) {
      const d = new Date(t.dato);
      if (d>=fraDato && d<=tilDato) ider.add(t.egenmeldingPeriodeId);
    }
  });
  return ider.size;
}

// Finner egenmeldingsrader som skal kuttes bort fordi den ansatte starter en vanlig
// timer igjen FØR de 3 dagene er omme - kun dagene FRA OG MED fraDatoStr (dagen
// vedkommende starter timer) fjernes; allerede passerte egenmelding-dager beholdes og
// telles fortsatt, siden de faktisk ble brukt (bedt om av Henrik 2026-10-02: egenmelding
// "blir overkjørt av hvis den ansatte starter timer").
/**
 * @param {Array<{ansattId:number,type:string,dato:string}>} timerListe
 * @param {number} ansattId
 * @param {string} fraDatoStr "ÅÅÅÅ-MM-DD"
 */
function egenmeldingerAaAvbryte(timerListe, ansattId, fraDatoStr) {
  return (timerListe||[]).filter(t=>t.ansattId===ansattId && t.type==='egenmelding' && t.dato>=fraDatoStr);
}

/**
 * @param {number} mins
 * @param {string} datoStr "ÅÅÅÅ-MM-DD"
 * @returns {{ normal: number, ot50: number, ot100: number }}
 */
function beregnOvertid(mins, datoStr) {
  if (erHelg(datoStr)) {
    return {normal: 0, ot50: 0, ot100: mins};
  }
  const normal = Math.min(mins, 450);   // 7.5 timer = 450 min
  const rest   = Math.max(0, mins - 450);
  const ot50   = Math.min(rest, 240);   // neste 4 timer = 240 min (til 11.5 timer totalt)
  const ot100  = Math.max(0, rest - 240);
  return {normal, ot50, ot100};
}

// Egenmelding kan først brukes etter minst 2 måneders ansettelse (faktisk norsk
// minimumsregel, delt av Henrik 2026-10-08). Ukjent/tom ansettelsesdato (ansatte som
// fantes før feltet ble lagt til, og som admin ikke har fylt inn ennå) regnes som
// kvalifisert i stedet for å plutselig sperre alle eksisterende ansatte - se migrasjonen
// 20261008100000_ansettelsesdato.sql.
/**
 * @param {string|null|undefined} ansettelsesdatoStr "ÅÅÅÅ-MM-DD"
 * @param {string} idagStr "ÅÅÅÅ-MM-DD"
 * @returns {boolean}
 */
function egenmeldingKvalifisert(ansettelsesdatoStr, idagStr) {
  if (!ansettelsesdatoStr) return true;
  const kvalifisertFra = new Date(ansettelsesdatoStr);
  kvalifisertFra.setMonth(kvalifisertFra.getMonth() + 2);
  return new Date(idagStr) >= kvalifisertFra;
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

