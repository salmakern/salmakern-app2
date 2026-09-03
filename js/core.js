// ════════════════════════════════════════════════════
// CONFIG & STATE
// ════════════════════════════════════════════════════
const SUPA_URL     = 'https://qoqpenbfdxeduylxirwk.supabase.co';
const SUPA_KEY     = 'sb_publishable_46JAdcBUbQYS8NbDwP-MXg_zKWA8Ojz';
const STORE        = 'salmakern_v2';
const VAPID_PUBLIC = 'BP9J3aYGhu16WMGy_LflngbHxGzxip5VrnDyYnwS4a429Cc5XPBGYjC-mqyAfXkQUbeLhPzKiv6y6CpfmTeYJDc';

// Feilovervåking (Sentry) - av så lenge denne er tom. For å skru på: opprett gratis konto
// på sentry.io → nytt prosjekt (type "Browser") → lim DSN-en (ser ut som
// "https://xxxx@xxxx.ingest.sentry.io/xxxx") inn her. Se CLAUDE.md "Feilovervåking".
const SENTRY_DSN = '';

// Sporer bilder som er lastet opp i minnet men ikke nødvendigvis bekreftet i Supabase ennå
const inFlightFotos = {};

// Laster Sentry sitt CDN-bundle KUN hvis en DSN er satt over - ellers null ekstra
// nettverkskall/kostnad for de som ikke har konfigurert det ennå. Fanger både JS-feil og
// avviste Promises (f.eks. en mislykket Supabase-lagring ingen fikk med seg fordi
// feilen bare gikk til console.error, usynlig med mindre noen hadde devtools åpne).
function initFeilovervaking() {
  if (!SENTRY_DSN) return;
  const script = document.createElement('script');
  script.src = 'https://browser.sentry-cdn.com/8.45.0/bundle.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    if (!window.Sentry) return;
    window.Sentry.init({
      dsn: SENTRY_DSN,
      environment: location.hostname === 'localhost' ? 'utvikling' : 'produksjon',
      // Ikke send med noe fra selve appens tilstand (S) automatisk - unngår at
      // kunde-/ansattdata utilsiktet havner i feilrapporter.
      beforeSend(event) { return event; }
    });
  };
  document.head.appendChild(script);
}
initFeilovervaking();

// Gjør om 'YYYY-MM-DD' til 'DD.MM.YYYY' for visning. Lagret/redigert verdi er fortsatt ISO.
function fmtDatoKort(iso) {
  if (!iso) return '';
  const [aar, mnd, dag] = String(iso).split('-');
  if (!aar || !mnd || !dag) return iso;
  return `${dag}.${mnd}.${aar}`;
}

function visToast(melding, type='feil') {
  let el = document.getElementById('globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;max-width:90vw;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);transition:opacity 0.3s;pointer-events:none';
    document.body.appendChild(el);
  }
  if (type === 'ok') {
    el.style.background = '#14532d'; el.style.border = '1px solid #22c55e'; el.style.color = '#86efac';
  } else {
    el.style.background = '#450a0a'; el.style.border = '1px solid #ef4444'; el.style.color = '#fca5a5';
  }
  el.textContent = melding;
  el.style.opacity = '1'; el.style.display = 'block';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => { el.style.opacity='0'; setTimeout(()=>el.style.display='none',300); }, 5000);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
const STATUSER = [
  {id:'paa_vei',        lbl:'På vei',              border:'#f472b6', bg:'#50072488', txt:'#fce7f3'},
  {id:'ikke_paabegynt', lbl:'Ikke påbegynt',        border:'#ef4444', bg:'#450a0a88', txt:'#fca5a5'},
  {id:'paabegynt',      lbl:'Påbegynt',             border:'#60a5fa', bg:'#17255488', txt:'#bfdbfe'},
  {id:'ikke_veid',      lbl:'Ikke veid',            border:'#facc15', bg:'#42200688', txt:'#fef08a'},
  {id:'klar_visning',   lbl:'Klar for visning',     border:'#22c55e', bg:'#052e1688', txt:'#86efac'},
  {id:'vist_biltilsyn', lbl:'Vist på biltilsynet',  border:'#f97316', bg:'#43140788', txt:'#fed7aa'},
  {id:'klar_henting',   lbl:'Klar for henting',     border:'#a1a1aa', bg:'#09090b88', txt:'#e4e4e7'},
  {id:'bestilt_frakt',  lbl:'Bestilt frakt',        border:'#a78bfa', bg:'#2e106688', txt:'#ddd6fe'},
  {id:'hentet',         lbl:'Hentet',               border:'#2dd4bf', bg:'#03302888', txt:'#99f6e4'},
];
function statusInfo(id) { return STATUSER.find(s=>s.id===id) || STATUSER[1]; }
// rolle lagres/sammenlignes alltid med små bokstaver (ansatt/godkjenner/admin) - denne
// er KUN for visning, rører aldri selve verdien noe sted den brukes i logikk/sammenligning.
function rolleVis(rolle) { return rolle ? rolle.charAt(0).toUpperCase() + rolle.slice(1) : ''; }
const STATUS_SORT = {hentet:0,bestilt_frakt:1,klar_henting:2,vist_biltilsyn:3,klar_visning:4,ikke_veid:5,paabegynt:6,ikke_paabegynt:7,paa_vei:8};
function sorterOrdre(a,b) {
  const pd = (b.prioritert?1:0) - (a.prioritert?1:0);
  if (pd !== 0) return pd;
  const sd=(STATUS_SORT[a.ordreStatus]??99)-(STATUS_SORT[b.ordreStatus]??99);
  if(sd!==0) return sd;
  return (a.ankomstdato||'').localeCompare(b.ankomstdato||'');
}

// Delt oppslag for de tre bilde-seksjonene på ordredetaljen (Ankomst/Levering/
// Avstand-skader) - felt-navnet på ordre-objektet og etikettene på hver boks.
// Brukes både av rendering (ordre-detalj.js) og opplasting/sletting (ordre-diverse.js)
// slik at man slipper egne if/else-grener for hver side hvert sted.
const FOTO_SIDER = {
  a: { felt: 'bilderAnkomst', labler: ['Front','Høyre','Venstre','Bak','Div 1','Div 2'] },
  l: { felt: 'bilderLevering', labler: ['Front','Høyre','Venstre','Bak','Div 1','Div 2'] },
  s: { felt: 'bilderAvstandSkader', labler: ['Avstand','Skade 1','Skade 2'] }
};

let db = null;
let S  = {ansatte:[], ordrer:[], timer:[], flater:[], dagensPIN:'1234', nextId:100, gps:{lat:null,lng:null,radius:300}, beskjeder:[], kontakter:[], hms:[], utstyrMaler:[], drivstoffSatser:[], moter:[]};
let me = null;
let activeOrdreId = null;
let openedFromArkiv = false;
const ignorerRealtimeFor = new Set(); // ordre-ID-er vi nettopp lagret
const ignorerRealtimeAnsatt = new Set(); // ansatt-ID-er vi nettopp lagret
const ignorerRealtimeAdminArk = new Set(); // admin_ark-ID-er vi nettopp lagret
let ignorerRealtimeInnstillinger = false; // innstillinger er én rad - enkelt flagg holder
let ignorerRealtimeInnstillingerTimer = null;
let flyttOrdreId  = null;
let timerStart    = null;
let timerType     = 'normal';
let timerTick     = null;
let timerPINMode  = 'gps'; // 'gps' eller 'manuell'
let ordreTimerTick = null;
let calWeekOffset = 0;

// ════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loadingOverlay').style.display = 'flex';
  try {
    db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    // Anonym Auth-sesjon kreves for at databasen (RLS + Realtime) skal vite
    // hvem som spør. Selve identiteten (hvilken ansatt) knyttes først etter
    // riktig PIN i tryLogin() - uten en PIN er denne sesjonen ikke koblet
    // til noen ansatt og RLS slipper den ikke til noe som helst.
    const { data: { session } } = await db.auth.getSession();
    if (!session) await db.auth.signInAnonymously();
    // Data kan ikke leses uten en innlogget ansatt lenger - hentes i
    // tryLogin() i stedet for her.
  } catch(e) {
    console.warn('Supabase feil, bruker lokal data:', e.message);
    try { const c = localStorage.getItem(STORE); if(c) S = JSON.parse(c); else S = defaultData(); }
    catch(_){ S = defaultData(); }
    // Sikre at alle felt finnes etter localStorage-lasting
    S.utstyrMaler      = S.utstyrMaler      || [];
    S.drivstoffSatser  = S.drivstoffSatser  || [];
    S.beskjeder        = S.beskjeder        || [];
    S.kontakter        = S.kontakter        || [];
    S.hms              = S.hms              || [];
    S.flater           = S.flater           || [];
    S.lagervarer       = S.lagervarer       || [];
    S.lagerhistorikk   = S.lagerhistorikk   || [];
    S.lagerOppskrifter = S.lagerOppskrifter || [];
    S.adminArk         = S.adminArk         || [];
    S.moter            = S.moter            || [];
    S.ordrer = (S.ordrer||[]).map(o => ({
      ...o,
      utstyrSjekkliste:   o.utstyrSjekkliste   || [],
      utstyrMalNavn:      o.utstyrMalNavn       || '',
      visningsSjekkliste: o.visningsSjekkliste  || [],
      visningsMalNavn:    o.visningsMalNavn      || '',
      bilderAnkomst:      o.bilderAnkomst        || [null,null,null,null,null,null],
      bilderLevering:     o.bilderLevering       || [null,null,null,null,null,null],
      bilderAvstandSkader: o.bilderAvstandSkader || [null,null,null],
      ansatteSignert:     o.ansatteSignert       || [],
      endringer:          o.endringer            || [],
    }));
  }
  document.getElementById('loadingOverlay').style.display = 'none';
});

async function loadFromSupabase() {
  const [aR,oR,tR,sR] = await Promise.all([
    db.from('ansatte').select('*').order('id'),
    db.from('ordrer').select('*').order('created_at'),
    db.from('timer_entries').select('*').order('created_at',{ascending:false}).limit(300),
    db.from('innstillinger').select('*').eq('id',1).maybeSingle()
  ]);
  // VIKTIG: må sjekkes for ALLE spørringer, ikke bare ansatte - hvis f.eks. ordre-
  // spørringen feiler forbigående (nettverksglipp, sesjonsfornyelse etter lang pause
  // i bakgrunnen) uten at dette kastes, blir oR.data undefined/null og S.ordrer settes
  // stille til [] under - hele ordrelisten "forsvinner" til neste fulle omlasting.
  // (Dette var en reell bug - ordre kunne se ut til å forsvinne "tilfeldig" og kom
  // tilbake ved refresh, nettopp fordi denne sjekken manglet for oR/tR.)
  if (aR.error) throw new Error(aR.error.message);
  if (oR.error) throw new Error(oR.error.message);
  if (tR.error) throw new Error(tR.error.message);
  S.ansatte   = (aR.data||[]).map(a=>({...a, kanForeLonn: a.kan_fore_lonn !== false}));
  const prevOrdrer = S.ordrer ? [...S.ordrer] : [];
  const prevTimer  = S.timer  ? [...S.timer]  : [];
  const now = Date.now();
  const LOCAL_TTL = 15000; // ms — behold lokale rader inntil Supabase bekrefter dem

  S.ordrer = (oR.data||[]).map(row => {
    const fresh = dbToOrdre(row);
    if (ignorerRealtimeFor.has(String(row.id))) {
      const prev = prevOrdrer.find(o=>String(o.id)===String(row.id));
      if (prev) fresh.ordreStatus = prev.ordreStatus;
    }
    return fresh;
  });
  // Ekstra sikkerhetsnett utover feilsjekken over: en spørring kan "lykkes" (ingen
  // oR.error) men likevel returnere 0 rader hvis sesjonen/RLS-tilgangen akkurat da var
  // ugyldig et lite øyeblikk (f.eks. rett før en token-fornyelse rekker å fullføre) -
  // PostgREST rapporterer ikke det som en feil, bare et tomt resultat. En ekte bedrift
  // mister ikke ALLE sine ordre mellom to innlastinger, så en brå tom liste der vi FØR
  // hadde ordre er mer sannsynlig denne racen enn en faktisk tømt database - behold da
  // det vi allerede hadde i minnet i stedet for å stille godta den mistenkelige tomme
  // listen (samme klasse bug som ble fikset for oR.error, bare uten en ekte feil å fange).
  if (!S.ordrer.length && prevOrdrer.length) {
    console.warn('loadFromSupabase: ordre-spørringen ga 0 rader mens vi hadde ' + prevOrdrer.length + ' fra før - beholder gammel liste, mistenker forbigående sesjonsfeil.');
    S.ordrer = prevOrdrer;
  }
  // Re-appliser bilder som er i minnet men ikke bekreftet i Supabase ennå
  Object.entries(inFlightFotos).forEach(([ordreId, fotos]) => {
    const o = S.ordrer.find(x=>String(x.id)===String(ordreId));
    if (!o) { delete inFlightFotos[ordreId]; return; }
    const tomme = [];
    Object.entries(fotos).forEach(([key, url]) => {
      const [side, idxStr] = key.split('_');
      const idx = parseInt(idxStr);
      const sideInfo = FOTO_SIDER[side];
      if (!sideInfo) { tomme.push(key); return; } // ukjent side-nøkkel - dropp i stedet for å krasje
      const felt = sideInfo.felt;
      if (o[felt][idx] === url) { tomme.push(key); }
      else o[felt][idx] = url;
    });
    tomme.forEach(k => delete fotos[k]);
    if (!Object.keys(fotos).length) delete inFlightFotos[ordreId];
  });
  // Behold nye ordrer som ikke er bekreftet i Supabase ennå
  const freshOrdreIds = new Set(S.ordrer.map(o => String(o.id)));
  prevOrdrer.forEach(o => {
    if (!freshOrdreIds.has(String(o.id)) && o._localAt && (now - o._localAt) < LOCAL_TTL)
      S.ordrer.push(o);
  });

  S.timer = (tR.data||[]).map(dbToTimer);
  // Samme sikkerhetsnett som for S.ordrer over - se kommentaren der.
  if (!S.timer.length && prevTimer.length) {
    console.warn('loadFromSupabase: timer-spørringen ga 0 rader mens vi hadde ' + prevTimer.length + ' fra før - beholder gammel liste.');
    S.timer = prevTimer;
  }
  // Behold nye timer-oppføringer som ikke er bekreftet i Supabase ennå
  const freshTimerIds = new Set(S.timer.map(t => String(t.id)));
  prevTimer.forEach(t => {
    if (!freshTimerIds.has(String(t.id)) && t._localAt && (now - t._localAt) < LOCAL_TTL)
      S.timer.unshift(t);
  });
  // VIKTIG: hvis denne lesingen feiler (f.eks. midlertidig RLS/nett-trøbbel),
  // MÅ vi la S.utstyrMaler/drivstoffSatser/osv. stå urørt i stedet for å
  // tolke feilen som "tom liste" - ellers kan koden under (som fyller inn
  // og LAGRER standardverdier når listen er tom) stille overskrive ekte
  // data i databasen med en tom liste. (Dette skjedde faktisk én gang.)
  if (sR.error) {
    console.warn('Innstillinger-lesing feilet, beholder eksisterende data i minnet:', sR.error.message);
  } else if (ignorerRealtimeInnstillinger) {
    // Vi har nettopp lagret innstillinger selv (saveInnstillinger() satte dette flagget
    // i 10 sek) - denne innlastingen kan ha startet FØR vår egen skriving rakk å committe,
    // og ville da stille overskrevet f.eks. en nettopp endret GPS-radius med den gamle
    // verdien. Samme beskyttelse som realtime-abonnementet på 'innstillinger' allerede
    // har (se .on('postgres_changes',...,'innstillinger') lenger ned) - utvidet hit fordi
    // den ikke dekket vanlig gjeninnlasting (f.eks. sanntids-gjenoppkobling).
  } else {
    S.dagensPIN      = sR.data?.dagens_pin || '1234';
    S.gps            = {lat: sR.data?.gps_lat||null, lng: sR.data?.gps_lng||null, radius: sR.data?.gps_radius||300};
    S.utstyrMaler    = sR.data?.utstyr_maler    || [];
    S.drivstoffSatser= sR.data?.drivstoff_satser|| [];
    S.beskjeder      = sR.data?.beskjeder       || [];
    S.kontakter      = sR.data?.kontakter       || [];
    S.hms            = sR.data?.hms             || [];
  }
  // Sett nextId til høyere enn alle eksisterende ID-er
  const alleIds = [
    ...S.ansatte.map(a=>Number(a.id)||0),
    ...S.timer.map(t=>Number(String(t.id).replace(/\D/g,''))||0),
    ...(S.utstyrMaler||[]).map(m=>Number(String(m.id).replace(/\D/g,''))||0)
  ];
  S.nextId = Math.max(100, ...alleIds) + 1;
  if (!sR.error) {
    // Fiks duplikat-ID-er i utstyrMaler
    let malIdFikset = false;
    const seenMalIds = new Set();
    (S.utstyrMaler||[]).forEach(m => {
      if (!m.id || seenMalIds.has(String(m.id))) {
        m.id = 'u' + (++S.nextId);
        malIdFikset = true;
      }
      seenMalIds.add(String(m.id));
    });
    if (malIdFikset) saveInnstillinger();
    // Pre-populate standard satser hvis ingen finnes
    if (!S.drivstoffSatser.length) {
      S.drivstoffSatser = [
        {id:'ds_uten_mva', navn:'Uten Mva', type:'uten_mva', verdi:0},
        {id:'ds_bos',      navn:'BOS',      type:'bos',      verdi:0}
      ];
      saveInnstillinger();
    }
  }
  // Flåter hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const fR = await db.from('flater').select('*').order('created_at');
    if (!fR.error) S.flater = (fR.data||[]).map(dbToFlate);
  } catch(_) {}
  // Varelager hentes for seg selv - tabellene finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const [lvR, lhR, loR] = await Promise.all([
      db.from('lagervarer').select('*').order('navn'),
      db.from('lagerhistorikk').select('*').order('created_at', {ascending:false}).limit(500),
      db.from('lager_oppskrifter').select('*').order('navn')
    ]);
    if (!lvR.error) S.lagervarer = (lvR.data||[]).map(dbToLagervare);
    if (!lhR.error) S.lagerhistorikk = (lhR.data||[]).map(dbToLagerhistorikk);
    if (!loR.error) S.lagerOppskrifter = (loR.data||[]).map(dbToLagerOppskrift);
  } catch(_) {}
  // Admin-ark hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const aaR = await db.from('admin_ark').select('*');
    if (!aaR.error) S.adminArk = (aaR.data||[]).map(dbToAdminArkRad);
  } catch(_) {}
  // Møter hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const mR = await db.from('moter').select('*').order('dato').order('tid');
    if (!mR.error) S.moter = (mR.data||[]).map(dbToMote);
  } catch(_) {}
}

function dbToOrdre(r) {
  const dv = {totalvekt:{a:'',e:'',v:''},vogntog:{a:'',e:'',v:''},foraksel:{a:'',e:'',v:''},bakaksel:{a:'',e:'',v:''}};
  return {
    id:r.id, regnr:r.regnr, kunde:r.kunde||'', eier:r.eier||'',
    ombygging:r.ombygging||{nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false},
    merke:r.merke||'', type:r.type||'', modell:r.modell||'', variant:r.variant||'', versjon:r.versjon||'', chassis:r.chassis||'',
    ankomstdato:r.ankomstdato||'', status:r.status||'aktiv',
    ordreStatus:r.ordre_status||'ikke_paabegynt',
    kalenderDato:r.kalender_dato||'', kalenderTid:r.kalender_tid||'',
    vekter:r.vekter||dv, drivstoff:r.drivstoff||{totalpris:'',satsId:''},
    utstyr:r.utstyr||{har:'',skalHa:'',hengerfeste:'ikke_hengerfeste',hengerfesteMontert:'ikke_montert'},
    bilderAnkomst:r.bilder_ankomst||[null,null,null,null,null,null],
    bilderLevering:r.bilder_levering||[null,null,null,null,null,null],
    bilderAvstandSkader:r.bilder_avstand_skader||[null,null,null],
    ansatteSignert:r.ansatte_signert||[], signatur:r.signatur||null,
    godkjent:r.godkjent||false, godkjennerNavn:r.godkjenner_navn||'',
    diagnose:r.diagnose||false, diagnoseAv:r.diagnose_av||'',
    fakturert:r.fakturert||false, fakturertAv:r.fakturert_av||'',
    ordreStart:r.ordre_start||null, ordreStopp:r.ordre_stopp||null,
    ordreTimerSessions:r.ordre_timer_sessions||[],
    notater:r.notater||'', endringer:r.endringer||[],
    utstyrSjekkliste:r.utstyr_sjekkliste||[], utstyrMalNavn:r.utstyr_mal_navn||'',
    visningsSjekkliste:r.visnings_sjekkliste||[], visningsMalNavn:r.visnings_mal_navn||'',
    flateId:r.flate_id||null, prioritert:!!r.prioritert, dokumenter:r.dokumenter||[],
    coc:r.coc||'har_ikke', fullmakt:r.fullmakt||'har_ikke', godkjentBiltilsyn:!!r.godkjent_biltilsyn,
    tidBiltilsynet:r.tid_biltilsynet||'', tidBiltilsynetTid:r.tid_biltilsynet_tid||'', tidBiltilsynetSted:r.tid_biltilsynet_sted||'',
    datoKlarHenting:r.dato_klar_henting||''
  };
}
function ordreToDb(o) {
  return {
    id:o.id, regnr:o.regnr, kunde:o.kunde, eier:o.eier,
    ombygging:o.ombygging||{nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false},
    merke:o.merke||'', type:o.type||'', modell:o.modell||'', variant:o.variant||'', versjon:o.versjon||'', chassis:o.chassis, ankomstdato:o.ankomstdato||null,
    status:o.status, ordre_status:o.ordreStatus||'ikke_paabegynt',
    kalender_dato:o.kalenderDato||null, kalender_tid:o.kalenderTid,
    vekter:o.vekter, drivstoff:o.drivstoff, utstyr:o.utstyr,
    bilder_ankomst:o.bilderAnkomst, bilder_levering:o.bilderLevering, bilder_avstand_skader:o.bilderAvstandSkader,
    ansatte_signert:o.ansatteSignert, signatur:o.signatur||null,
    godkjent:o.godkjent, godkjenner_navn:o.godkjennerNavn,
    diagnose:o.diagnose||false, diagnose_av:o.diagnoseAv||'',
    fakturert:o.fakturert, fakturert_av:o.fakturertAv,
    ordre_start:o.ordreStart, ordre_stopp:o.ordreStopp,
    ordre_timer_sessions:o.ordreTimerSessions||[],
    notater:o.notater, endringer:o.endringer,
    utstyr_sjekkliste:o.utstyrSjekkliste||[], utstyr_mal_navn:o.utstyrMalNavn||'',
    visnings_sjekkliste:o.visningsSjekkliste||[], visnings_mal_navn:o.visningsMalNavn||'',
    flate_id:o.flateId||null,
    coc:o.coc||'har_ikke', fullmakt:o.fullmakt||'har_ikke',
    updated_at:new Date().toISOString()
  };
}
function dbToFlate(r) {
  return { id:r.id, flatenummer:r.flatenummer||'', kunde:r.kunde||'', status:r.status||'aktiv', primaerOrdreId:r.primaer_ordre_id||null, createdAt:r.created_at||'' };
}
function dbToLagervare(r) {
  return { id:r.id, navn:r.navn||'', kategori:r.kategori||'', tegningsnummer:r.tegningsnummer||'', antall:Number(r.antall)||0, enhet:r.enhet||'stk', minAntall:Number(r.min_antall)||0, notat:r.notat||'', bestilt:!!r.bestilt, rekkefolge:Number(r.rekkefolge)||0, createdAt:r.created_at||'' };
}
function dbToLagerhistorikk(r) {
  return { id:r.id, vareId:r.vare_id, vareNavn:r.vare_navn||'', endring:Number(r.endring)||0, type:r.type||'justering', ordreId:r.ordre_id||null, batchId:r.batch_id||null, ansattNavn:r.ansatt_navn||'', kommentar:r.kommentar||'', createdAt:r.created_at||'' };
}
function dbToLagerOppskrift(r) {
  return { id:r.id, navn:r.navn||'', biltype:r.biltype||'', variant:r.variant||'', ingredienser:r.ingredienser||[], createdAt:r.created_at||'' };
}
function dbToAdminArkRad(r) {
  return { id:r.id, chassisNr:r.chassis_nr||'', aar:Number(r.aar)||0, rekkefolge:Number(r.rekkefolge)||0,
    forhandler:r.forhandler||'', kontaktperson:r.kontaktperson||'',
    serienummer:r.serienummer||'', mottatt:!!r.mottatt, papirer:!!r.papirer, dokumenter:!!r.dokumenter, fraktselskap:r.fraktselskap||'',
    merknader:r.merknader||'', flateHypotetisk:r.flate_hypotetisk||'', timeBekreftet:r.time_bekreftet||'', timeBekreftetTid:r.time_bekreftet_tid||'', timeBekreftetSted:r.time_bekreftet_sted||'', ventendeTimer:r.ventende_timer||'', arkivert:!!r.arkivert };
}
function dbToMote(r) {
  return { id:r.id, tittel:r.tittel||'', dato:r.dato||'', tid:r.tid||'', opprettetAv:r.opprettet_av||'', varslet:!!r.varslet, deltakerIder:r.deltaker_ider||[] };
}
function dbToTimer(r) {
  return {id:r.id,ansattId:r.ansatt_id,ansatt:r.ansatt,dato:r.dato,
    type:r.type,start:r.start||r.start_tid||'',stopp:r.stopp||r.stopp_tid||'',mins:r.mins||r.minutter||0};
}

let realtimeChannel = null;
let realtimeReconnectTimer = null;
let realtimeReconnectForsok = 0;

function subscribeRealtime() {
  if (!db) return;
  if (realtimeReconnectTimer) { clearTimeout(realtimeReconnectTimer); realtimeReconnectTimer = null; }
  if (realtimeChannel) { try { db.removeChannel(realtimeChannel); } catch(_){} realtimeChannel = null; }

  realtimeChannel = db.channel('salmakern_live')
    .on('postgres_changes',{event:'*',schema:'public',table:'ordrer'}, p => {
      if (p.eventType==='INSERT') {
        if (!S.ordrer.find(o=>o.id===p.new.id)) { S.ordrer.push(dbToOrdre(p.new)); renderAll(); }
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeFor.has(p.new.id)) return;
        const i=S.ordrer.findIndex(o=>o.id===p.new.id);
        if(i>=0){
          S.ordrer[i]=dbToOrdre(p.new);
          renderAll();
          if(activeOrdreId===p.new.id) buildOrdreDetail();
        }
      } else if (p.eventType==='DELETE') {
        S.ordrer = S.ordrer.filter(o=>o.id!==p.old.id);
        if (activeOrdreId===p.old.id) tilbakeOrdreList();
        renderAll();
      }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'ansatte'}, p => {
      const mapA = a => ({...a, kanForeLonn: a.kan_fore_lonn !== false});
      if (p.eventType==='INSERT') {
        if (!S.ansatte.find(a=>a.id===p.new.id)) S.ansatte.push(mapA(p.new));
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeAnsatt.has(String(p.new.id))) return;
        const i=S.ansatte.findIndex(a=>a.id===p.new.id); if(i>=0) S.ansatte[i]=mapA(p.new);
      } else if (p.eventType==='DELETE') {
        S.ansatte = S.ansatte.filter(a=>a.id!==p.old.id);
      }
      if(me) renderMer();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'timer_entries'}, p => {
      if (p.eventType==='INSERT') {
        if (!S.timer.find(t=>t.id===p.new.id)) S.timer.unshift(dbToTimer(p.new));
      } else if (p.eventType==='UPDATE') {
        const i=S.timer.findIndex(t=>t.id===p.new.id); if(i>=0) S.timer[i]=dbToTimer(p.new);
      } else if (p.eventType==='DELETE') {
        S.timer = S.timer.filter(t=>t.id!==p.old.id);
      }
      renderAll();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'flater'}, p => {
      S.flater = S.flater || [];
      if (p.eventType==='INSERT') {
        if (!S.flater.find(f=>f.id===p.new.id)) S.flater.push(dbToFlate(p.new));
      } else if (p.eventType==='UPDATE') {
        const i=S.flater.findIndex(f=>f.id===p.new.id); if(i>=0) S.flater[i]=dbToFlate(p.new);
      } else if (p.eventType==='DELETE') {
        S.flater = S.flater.filter(f=>f.id!==p.old.id);
      }
      if (document.getElementById('flaterModal')?.classList.contains('show')) {
        aktivFlateId ? renderFlateDetalj() : renderFlaterListe();
      }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'lagervarer'}, p => {
      S.lagervarer = S.lagervarer || [];
      if (p.eventType==='INSERT') {
        if (!S.lagervarer.find(v=>v.id===p.new.id)) S.lagervarer.push(dbToLagervare(p.new));
      } else if (p.eventType==='UPDATE') {
        const i=S.lagervarer.findIndex(v=>v.id===p.new.id); if(i>=0) S.lagervarer[i]=dbToLagervare(p.new);
      } else if (p.eventType==='DELETE') {
        S.lagervarer = S.lagervarer.filter(v=>v.id!==p.old.id);
      }
      oppdaterLagerVarselBadge();
      renderGlobalLavLagerVarsel();
      if (document.getElementById('lager')?.classList.contains('active')) {
        aktivVareId ? renderVareDetalj() : renderLagerListe();
      }
      if (activeOrdreId) renderOrdreLagerbruk();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'lagerhistorikk'}, p => {
      S.lagerhistorikk = S.lagerhistorikk || [];
      if (p.eventType==='INSERT') {
        if (!S.lagerhistorikk.find(h=>h.id===p.new.id)) S.lagerhistorikk.unshift(dbToLagerhistorikk(p.new));
      } else if (p.eventType==='DELETE') {
        S.lagerhistorikk = S.lagerhistorikk.filter(h=>h.id!==p.old.id);
      }
      if (document.getElementById('lager')?.classList.contains('active') && aktivVareId) renderVareDetalj();
      if (activeOrdreId) renderOrdreLagerbruk();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'lager_oppskrifter'}, p => {
      S.lagerOppskrifter = S.lagerOppskrifter || [];
      if (p.eventType==='INSERT') {
        if (!S.lagerOppskrifter.find(o=>o.id===p.new.id)) S.lagerOppskrifter.push(dbToLagerOppskrift(p.new));
      } else if (p.eventType==='UPDATE') {
        const i=S.lagerOppskrifter.findIndex(o=>o.id===p.new.id); if(i>=0) S.lagerOppskrifter[i]=dbToLagerOppskrift(p.new);
      } else if (p.eventType==='DELETE') {
        S.lagerOppskrifter = S.lagerOppskrifter.filter(o=>o.id!==p.old.id);
      }
      if (document.getElementById('lager')?.classList.contains('active')) refreshOppskriftVisning();
      if (activeOrdreId) renderOrdreLagerbruk();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'admin_ark'}, p => {
      S.adminArk = S.adminArk || [];
      if (p.eventType==='INSERT') {
        if (!S.adminArk.find(r=>r.id===p.new.id)) S.adminArk.push(dbToAdminArkRad(p.new));
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeAdminArk.has(p.new.id)) return;
        const i=S.adminArk.findIndex(r=>r.id===p.new.id); if(i>=0) S.adminArk[i]=dbToAdminArkRad(p.new);
      } else if (p.eventType==='DELETE') {
        S.adminArk = S.adminArk.filter(r=>r.id!==p.old.id);
      }
      if (document.getElementById('admin')?.classList.contains('active')) renderAdminArk();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'moter'}, p => {
      S.moter = S.moter || [];
      if (p.eventType==='INSERT') {
        if (!S.moter.find(m=>m.id===p.new.id)) S.moter.push(dbToMote(p.new));
      } else if (p.eventType==='UPDATE') {
        const i=S.moter.findIndex(m=>m.id===p.new.id); if(i>=0) S.moter[i]=dbToMote(p.new);
      } else if (p.eventType==='DELETE') {
        S.moter = S.moter.filter(m=>m.id!==p.old.id);
      }
      if (me) renderAll();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'innstillinger'}, p => {
      if (ignorerRealtimeInnstillinger || !p.new) return;
      const row = p.new;
      S.dagensPIN = row.dagens_pin || '1234';
      S.gps = {lat: row.gps_lat||null, lng: row.gps_lng||null, radius: row.gps_radius||300};
      S.utstyrMaler = row.utstyr_maler || [];
      S.drivstoffSatser = row.drivstoff_satser || [];
      S.beskjeder = row.beskjeder || [];
      S.kontakter = row.kontakter || [];
      S.hms = row.hms || [];
      if (me) renderMer();
    })
    .subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        realtimeReconnectForsok = 0;
        prosesserOfflineKo(); // sanntidskanalen kom opp igjen - sterkt signal om at nettet er tilbake
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Sanntid frakoblet:', status, err);
        if (!realtimeReconnectTimer && db && me) {
          const forsinkelse = Math.min(1000 * Math.pow(2, realtimeReconnectForsok), 30000);
          realtimeReconnectForsok++;
          realtimeReconnectTimer = setTimeout(async () => {
            realtimeReconnectTimer = null;
            if (db && me) {
              // Egne try/catch for datahenting og rendering - en feil i den ene skal
              // ikke skjule at den andre gikk fint, og uansett hva som feiler her MÅ
              // subscribeRealtime() under kjøre, ellers gir vi opp gjenoppkoblingen stille.
              try {
                await loadFromSupabase();
              } catch(e) { console.warn('Gjenoppkobling: datahenting feilet:', e); }
              try {
                renderAll();
              } catch(e) { console.warn('Gjenoppkobling: rendering feilet:', e); }
              subscribeRealtime();
            }
          }, forsinkelse);
        }
      }
    });
  return realtimeChannel;
}

// Koble til igjen og oppdater data når appen kommer tilbake i forgrunnen
let sisteVarSynlig = Date.now();
let autoRefreshInterval = null;

// Sesjonsgyldighet håndheves nå server-side (current_ansatt() + RLS) -
// ingen egen klientsjekk mot en lokalt lagret session_token lenger.
async function verifiserSession() {
  try { localStorage.removeItem('sessionToken_' + me?.id); } catch(e) {}
}

async function oppdaterApp() {
  if (!me) return;
  try {
    if (!db) db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    await verifiserSession();
    if (!me) return;
    await loadFromSupabase();
    renderAll();
    if (activeOrdreId) buildOrdreDetail();
    subscribeRealtime();
  } catch(e) {
    console.warn('Oppdatering feilet, reinitaliserer klient:', e);
    try {
      db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
      await loadFromSupabase();
      renderAll();
      if (activeOrdreId) buildOrdreDetail();
      subscribeRealtime();
    } catch(e2) { console.warn('Andre forsøk feilet:', e2); }
  }
}

// Ingen polling-interval — realtime håndterer løpende oppdateringer.
// Full refresh skjer kun ved: første load, realtime-frakobling, og lang pause.

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    const pauseMs = Date.now() - sisteVarSynlig;
    if (me && pauseMs > 3 * 60 * 1000) await oppdaterApp(); // refresh bare etter >3 min pause
  } else {
    sisteVarSynlig = Date.now();
  }
});

async function oppdaterAktivOrdre() {
  if (!db || !activeOrdreId) return;
  const knapp = document.getElementById('oppdaterOrdreKnapp');
  if (knapp) { knapp.textContent = '⏳'; knapp.disabled = true; }
  try {
    const {data,error} = await db.from('ordrer').select('*').eq('id', activeOrdreId).maybeSingle();
    if (!error && data) {
      const i = S.ordrer.findIndex(x=>x.id===activeOrdreId);
      if (i>=0) S.ordrer[i] = dbToOrdre(data);
      else S.ordrer.push(dbToOrdre(data));
      buildOrdreDetail();
    }
  } catch(e) { console.warn('Oppdatering feilet:', e); }
  if (knapp) { knapp.textContent = '🔄'; knapp.disabled = false; }
}

// ════════════════════════════════════════════════════
// MIGRASJON: Lokal data → Supabase
// ════════════════════════════════════════════════════
async function migrateLocalToSupabase() {
  if (!db) {
    alert('Supabase er ikke tilkoblet. Sjekk at prosjektet er aktivt på app.supabase.com og last siden på nytt.');
    return;
  }

  const el = document.getElementById('migreringStatus');
  const btn = document.getElementById('migrerBtn');
  btn.disabled = true;
  el.innerHTML = '<span class="muted">Starter migrasjon...</span>';

  // Les lokal data
  let lokal;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) {
      el.innerHTML = '<span class="err-text">Ingen lokal data funnet i denne nettleseren.</span>';
      btn.disabled = false;
      return;
    }
    lokal = JSON.parse(raw);
  } catch(e) {
    el.innerHTML = '<span class="err-text">Feil ved lesing av lokal data: ' + e.message + '</span>';
    btn.disabled = false;
    return;
  }

  let feil = 0;

  // 1. Ansatte (fjern duplikater på id)
  const uniqAnsatte = Object.values((lokal.ansatte||[]).reduce((acc,a)=>{acc[a.id]=a;return acc;},{}));
  if (uniqAnsatte.length > 0) {
    el.innerHTML += '<br>📋 Laster opp ' + uniqAnsatte.length + ' ansatte...';
    const ansatteDb = uniqAnsatte.map(({kanForeLonn, ...rest}) => rest); // fjern camelCase-felt
    const { error } = await db.from('ansatte').upsert(ansatteDb, { onConflict: 'id' });
    if (error) { el.innerHTML += ' <span class="err-text">Feil: ' + error.message + '</span>'; feil++; }
    else el.innerHTML += ' <span class="ok-text">✓</span>';
  }

  // 2. Ordrer
  const antOrdrer = lokal.ordrer?.length || 0;
  if (antOrdrer > 0) {
    el.innerHTML += '<br>🚗 Laster opp ' + antOrdrer + ' ordrer...';
    const dbOrdrer = lokal.ordrer.map(ordreToDb);
    const { error } = await db.from('ordrer').upsert(dbOrdrer, { onConflict: 'id' });
    if (error) { el.innerHTML += ' <span class="err-text">Feil: ' + error.message + '</span>'; feil++; }
    else el.innerHTML += ' <span class="ok-text">✓</span>';
  }

  // 3. Timer-registreringer (i bolker på 50)
  const antTimer = lokal.timer?.length || 0;
  if (antTimer > 0) {
    el.innerHTML += '<br>⏱️ Laster opp ' + antTimer + ' timer-registreringer...';
    const dbTimer = (lokal.timer || []).map(t => ({
      id: t.id, ansatt_id: t.ansattId, ansatt: t.ansatt,
      dato: t.dato, type: t.type || 'arbeid',
      start: t.start || '', stopp: t.stopp || '', mins: t.mins || 0
    }));
    let timerFeil = false;
    for (let i = 0; i < dbTimer.length; i += 50) {
      const chunk = dbTimer.slice(i, i + 50);
      const { error } = await db.from('timer_entries').upsert(chunk, { onConflict: 'id' });
      if (error) { el.innerHTML += ' <span class="err-text">Feil (batch ' + (Math.floor(i/50)+1) + '): ' + error.message + '</span>'; feil++; timerFeil = true; break; }
    }
    if (!timerFeil) el.innerHTML += ' <span class="ok-text">✓</span>';
  }

  // 4. Innstillinger
  el.innerHTML += '<br>⚙️ Laster opp innstillinger...';
  const { error: sErr } = await db.from('innstillinger').upsert({
    id: 1,
    dagens_pin: lokal.dagensPIN || '1234',
    gps_lat: lokal.gps?.lat || null,
    gps_lng: lokal.gps?.lng || null,
    gps_radius: lokal.gps?.radius || 300
  }, { onConflict: 'id' });
  if (sErr) { el.innerHTML += ' <span class="err-text">Feil: ' + sErr.message + '</span>'; feil++; }
  else el.innerHTML += ' <span class="ok-text">✓</span>';

  // Resultat
  el.innerHTML += '<br><br>';
  if (feil === 0) {
    el.innerHTML += '<b class="ok-text">✅ Ferdig! All data er lastet opp til Supabase og er nå tilgjengelig på alle enheter.</b>';
    // Reload data fra Supabase for å bekrefte
    setTimeout(async () => {
      try { await loadFromSupabase(); renderAll(); } catch(e) {}
    }, 1500);
  } else {
    el.innerHTML += '<b class="err-text">⚠️ Ferdig med ' + feil + ' feil. Noen data ble ikke lastet opp – sjekk at tabellene finnes i Supabase.</b>';
    btn.disabled = false;
  }
}

function defaultData() {
  return {
    ansatte: [
      {id:1, navn:'Per Hansen',   pin:'1234', rolle:'ansatt',     aktiv:true},
      {id:2, navn:'Kari Lien',    pin:'5678', rolle:'godkjenner', aktiv:true},
      {id:3, navn:'Admin Bruker', pin:'0000', rolle:'admin',      aktiv:true}
    ],
    ordrer: [
      mkOrdre('ord1','AB12345','Telemark Bygg AS','Ola Nordmann','Toyota HiAce','2022 L2H1','2026-04-20','2026-04-22','09:30','Takstativ','Innredning\nLED lys'),
      mkOrdre('ord2','CD56789','Vestfold Transport','Erik Johansen','VW Crafter','L3H2 2023','2026-04-21','','','','Hyllesystem\nGulvplate')
    ],
    timer: [],
    flater: [],
    lagervarer: [], lagerhistorikk: [], lagerOppskrifter: [], adminArk: [],
    nextId: 10,
    dagensPIN: String(Math.floor(1000+Math.random()*9000)),
    gps: {lat:null, lng:null, radius:300},
    beskjeder: [], kontakter: [], hms: [], utstyrMaler: [], drivstoffSatser: []
  };
}

function mkOrdre(id,regnr,kunde,eier,type,variant,ankomst,kDato,kTid,har,skalHa,startStatus) {
  return {
    id, regnr, kunde, eier,
    ombygging:{nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false},
    merke:'', type:'', modell:'', variant, versjon:'', chassis:'',
    ankomstdato: ankomst, status:'aktiv', ordreStatus: startStatus || 'ikke_paabegynt',
    kalenderDato: kDato, kalenderTid: kTid,
    vekter: {
      totalvekt:{a:'',e:'',v:''}, vogntog:{a:'',e:'',v:''},
      foraksel:{a:'',e:'',v:''}, bakaksel:{a:'',e:'',v:''}
    },
    drivstoff:{totalpris:'',satsId:''},
    utstyr:{har, skalHa, hengerfeste:'ikke_hengerfeste', hengerfesteMontert:'ikke_montert'},
    bilderAnkomst:[null,null,null,null,null,null],
    bilderLevering:[null,null,null,null,null,null],
    bilderAvstandSkader:[null,null,null],
    ansatteSignert:[], signatur:null,
    godkjent:false, godkjennerNavn:'',
    diagnose:false, diagnoseAv:'',
    fakturert:false, fakturertAv:'',
    ordreStart:null, ordreStopp:null, ordreTimerSessions:[],
    notater:'', endringer:[],
    utstyrSjekkliste:[], utstyrMalNavn:'',
    visningsSjekkliste:[], visningsMalNavn:'', prioritert:false
  };
}

// ════════════════════════════════════════════════════
// OFFLINE-KØ - mislykkede ordre-lagringer (f.eks. dårlig dekning på
// verkstedet) prøves automatisk igjen i stedet for å bare vise en toast og
// stole på at noen husker å prøve på nytt selv. save() skriver alltid hele
// ordrens nåværende tilstand (ikke en diff), så et nytt forsøk er trygt å
// gjøre om igjen uansett hvor mange andre endringer som har skjedd i
// mellomtiden - det er alltid SISTE tilstand som til slutt blir lagret.
// ════════════════════════════════════════════════════
const OFFLINE_KO_STORE = 'salmakern_offline_ko';
let offlineKo = new Set();
try { offlineKo = new Set(JSON.parse(localStorage.getItem(OFFLINE_KO_STORE) || '[]')); } catch(e) {}

function lagreOfflineKo() {
  try { localStorage.setItem(OFFLINE_KO_STORE, JSON.stringify([...offlineKo])); } catch(e) {}
}
function oppdaterLagreStatusBadge() {
  const el = document.getElementById('lagreStatusBadge');
  if (!el) return;
  if (offlineKo.size > 0) {
    el.textContent = `⏳ ${offlineKo.size} endring${offlineKo.size===1?'':'er'} venter`;
    el.className = 'small';
    el.style.color = '#facc15';
  } else {
    el.textContent = '✔ Lagret';
    el.className = 'ok-text small';
    el.style.color = '';
  }
}
let offlineKoKjorer = false;
async function prosesserOfflineKo() {
  if (!db || offlineKo.size === 0 || offlineKoKjorer) return;
  offlineKoKjorer = true;
  for (const id of [...offlineKo]) {
    // Ordren kan ha blitt slettet lokalt (av denne eller en annen enhet) mens den lå i
    // køen - save() returnerer da "suksess" uten å røre køen (ingenting å lagre lenger),
    // som ellers ville latt id-en bli en spøkelses-oppføring som aldri forsvinner.
    if (!S.ordrer.find(o => o.id === id)) { offlineKo.delete(id); lagreOfflineKo(); oppdaterLagreStatusBadge(); continue; }
    const feil = await save(id);
    if (feil) break; // fortsatt offline/feil - vent til neste forsøk i stedet for å hamre løs
  }
  offlineKoKjorer = false;
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', prosesserOfflineKo);
  // Sikkerhetsnett i tilfelle 'online'-eventet ikke trigger pålitelig på alle enheter
  setInterval(prosesserOfflineKo, 30000);
}

// Returnerer et Promise som løses med feilmeldingen (eller null ved suksess) -
// de aller fleste stedene bruker save() uten å vente på det (som før), men
// steder der det er kritisk å faktisk vite om lagringen lyktes (f.eks.
// godkjenning/arkivering) kan gjøre `const feil = await save(id)`.
function save(ordreId) {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch(e) {}
  if (!db || !ordreId) return Promise.resolve(null);
  const o = S.ordrer.find(x=>x.id===ordreId);
  if (!o) return Promise.resolve(null);
  // Ignorer Realtime-oppdatering for denne ordren i 10 sekunder
  ignorerRealtimeFor.add(ordreId);
  setTimeout(()=>ignorerRealtimeFor.delete(ordreId), 10000);
  // status/ordre_status/godkjent/godkjenner_navn utelates bevisst her - de har
  // egne målrettede oppdateringer (endreStatus/arkiver/bekreftGodkjenn)
  // og skal ALDRI skrives via denne generelle full-rad-lagringen. Grunnen: hvis
  // noen redigerer et vanlig felt (f.eks. merke) mens de har en litt gammel
  // kopi av ordren i minnet, ville denne lagringen ellers kunne skrive den
  // gamle statusen tilbake og "gjenåpne" en nettopp arkivert/godkjent ordre.
  const payload = ordreToDb(o);
  delete payload.status; delete payload.ordre_status;
  delete payload.godkjent; delete payload.godkjenner_navn;
  return db.from('ordrer').upsert(payload)
    .then(r=>{
      if (r.error) {
        console.error('Lagringsfeil:', r.error.message);
        const nyIKo = !offlineKo.has(ordreId);
        offlineKo.add(ordreId); lagreOfflineKo(); oppdaterLagreStatusBadge();
        // Kun toast første gang den havner i køen - unngår gjentatte toaster
        // hvis flere felt endres mens man fortsatt er offline.
        if (nyIKo) visToast('Ingen kontakt med serveren - prøver igjen automatisk');
        return r.error.message;
      }
      if (offlineKo.has(ordreId)) { offlineKo.delete(ordreId); lagreOfflineKo(); }
      oppdaterLagreStatusBadge();
      return null;
    });
}

// ════════════════════════════════════════════════════
// PIN LOGIN
// ════════════════════════════════════════════════════
let pinBuf = '';

function pinPress(d) {
  if (pinBuf.length >= 4) return;
  pinBuf += d;
  refreshPinDots();
  if (pinBuf.length === 4) setTimeout(tryLogin, 120);
}
function pinBack() { pinBuf = pinBuf.slice(0,-1); refreshPinDots(); }
function pinClear() { pinBuf = ''; refreshPinDots(); document.getElementById('pinErr').textContent=''; }
function refreshPinDots() {
  const filled = '●'.repeat(pinBuf.length);
  const empty  = '·'.repeat(4-pinBuf.length);
  document.getElementById('pinDots').textContent = (filled+empty).split('').join(' ');
}
async function tryLogin() {
  // PIN-sjekken skjer i databasen (logg_inn_med_pin), ikke lokalt mot
  // S.ansatte - PIN-koder lastes ikke ned til nettleseren i det hele tatt.
  // Funksjonen kobler i tillegg vår anonyme Auth-sesjon til ansatt-raden
  // (via auth.uid()), slik at RLS og Realtime vet hvem som spør etterpå.
  let user = null;
  let forMangeForsok = false;
  if (db) {
    try {
      const { data, error } = await db.rpc('logg_inn_med_pin', { kandidat_pin: pinBuf });
      if (error) {
        console.warn('PIN-sjekk feilet:', error.message);
        if (error.message?.includes('FOR_MANGE_FORSOK')) forMangeForsok = true;
      }
      else if (data && data.length) user = { ...data[0], kanForeLonn: data[0].kan_fore_lonn !== false };
    } catch(e) { console.warn('PIN-sjekk feilet:', e); }
  } else {
    // Uten tilkobling: fall tilbake på ev. lokalt bufret data (dev/offline)
    user = S.ansatte.find(a => a.pin===pinBuf && a.aktiv) || null;
  }
  if (user) {
    me = user;
    pinBuf = '';
    refreshPinDots();
    // Hent en ny JWT med ansatt_id/rolle-claims med en gang - uten dette
    // ville vi måtte vente til token-en fornyes naturlig av seg selv.
    try { await db.auth.refreshSession(); } catch(e) { console.warn('Sesjonsfornyelse feilet:', e); }
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('appScreen').style.display='block';
    document.getElementById('headerUser').textContent = me.navn + ' · ' + rolleVis(me.rolle);
    oppdaterLagreStatusBadge();
    // Vis/skjul Timer-fanen basert på tilgang
    const timerTab = document.getElementById('timerTab');
    if (timerTab) timerTab.style.display = (me.kanForeLonn === false) ? 'none' : '';
    const adminTab = document.getElementById('adminTab');
    if (adminTab) adminTab.style.display = (me.rolle === 'admin') ? '' : 'none';
    initTimerPage();
    // Data kunne ikke leses før vi hadde en gyldig sesjon - hentes nå.
    // Viser samme lasteskjerm som ved oppstart, så det korte gapet ikke
    // ser ut som appen henger.
    document.getElementById('loadingOverlay').style.display = 'flex';
    try {
      await loadFromSupabase();
      subscribeRealtime();
      renderAll();
      prosesserOfflineKo(); // send inn evt. lagringer som ble liggende i køen forrige økt
    } catch(e) {
      console.warn('Datahenting etter innlogging feilet:', e);
      visToast('Klarte ikke å hente data. Trykk 🔄 øverst for å prøve igjen.');
    }
    document.getElementById('loadingOverlay').style.display = 'none';
  } else {
    document.getElementById('pinErr').textContent = forMangeForsok
      ? 'For mange feilforsøk – vent noen minutter og prøv igjen'
      : 'Feil PIN – prøv igjen';
    pinBuf = '';
    refreshPinDots();
  }
}
function doLogout() {
  if (timerTick) clearInterval(timerTick);
  timerTick = null; timerStart = null;
  me = null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

// ════════════════════════════════════════════════════
// PUSH-VARSLER
// ════════════════════════════════════════════════════
// localStorage husker forrige endpoint denne enheten var registrert med.
// iOS/Safari roterer av og til push-endepunktet i bakgrunnen (f.eks. etter
// OS-oppdatering eller at PWA-en legges til på nytt) uten at brukeren gjør
// noe i appen. Uten opprydding blir den gamle raden i push_abonnement
// liggende igjen som gyldig, og enheten mottar da samme varsel to ganger.
const PUSH_ENDPOINT_LS_KEY = 'salmakern_push_endpoint';

async function lagrePushAbonnement(sub) {
  if (!db || !me || !sub) return;
  const j = sub.toJSON();
  const forrigeEndpoint = localStorage.getItem(PUSH_ENDPOINT_LS_KEY);
  if (forrigeEndpoint && forrigeEndpoint !== j.endpoint) {
    await db.from('push_abonnement').delete().eq('endpoint', forrigeEndpoint);
  }
  await db.from('push_abonnement').upsert({
    ansatt_id: me.id,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth
  }, { onConflict: 'endpoint' });
  localStorage.setItem(PUSH_ENDPOINT_LS_KEY, j.endpoint);
}

async function oppdaterVarselKnapp() {
  const knapp = document.getElementById('varselKnapp');
  const statusEl = document.getElementById('varselStatus');
  if (!knapp) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    knapp.textContent = 'Varsler støttes ikke på denne enheten';
    knapp.disabled = true;
    return;
  }
  const perm = Notification.permission;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (perm === 'denied') {
    if (statusEl) statusEl.innerHTML = '<span style="color:#f87171">Varsler er blokkert – åpne telefoninnstillinger for å tillate.</span>';
    knapp.textContent = 'Varsler blokkert';
    knapp.disabled = true;
  } else if (sub) {
    // Sjekk om endepunktet har rotert siden sist (f.eks. iOS i bakgrunnen)
    // og rydd opp den gamle raden hvis så, slik at vi ikke får dupliserte varsler.
    if (sub.endpoint !== localStorage.getItem(PUSH_ENDPOINT_LS_KEY)) {
      await lagrePushAbonnement(sub);
    }
    if (statusEl) statusEl.innerHTML = '<span style="color:#4ade80">✔ Varsler er aktivert på denne enheten</span>';
    knapp.textContent = 'Deaktiver varsler';
    knapp.disabled = false;
  } else {
    if (statusEl) statusEl.textContent = 'Varsler er ikke aktivert.';
    knapp.textContent = 'Aktiver varsler';
    knapp.disabled = false;
  }
}

async function togglePushVarsler() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sub.unsubscribe();
    if (db && me) await db.from('push_abonnement').delete().eq('endpoint', sub.endpoint);
    localStorage.removeItem(PUSH_ENDPOINT_LS_KEY);
    oppdaterVarselKnapp();
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { oppdaterVarselKnapp(); return; }
    const nySub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
    await lagrePushAbonnement(nySub);
    oppdaterVarselKnapp();
  } catch(e) {
    console.warn('Push feilet:', e);
    oppdaterVarselKnapp();
  }
}

