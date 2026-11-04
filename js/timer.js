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

// Genererer en kollisjonsfri ID for en ny timer-/egenmeldingsrad - IKKE basert på det delte,
// rent lokale S.nextId-telleverket (satt én gang per nettleserøkt ved innlasting, se
// loadFromSupabase() i core.js). To ansatte som logger inn omtrent samtidig (typisk ved
// skiftstart) og lagrer sin første timer samme dag FØR noen andre nye ID-krevende rader er
// opprettet, fikk nøyaktig samme start-S.nextId - og dermed samme 't<tall>'-id ved sitt
// FØRSTE lagre()-trykk hvis begge gjorde det omtrent samtidig (f.eks. ved skiftslutt). Siden
// timer_entries.id er primærnøkkel, feilet den ene innsettingen stille (kun console.error,
// se lagreTimer()/doLagreManuellTimer()) mens raden likevel sto synlig i den ansattes egen,
// lokale liste - timen forsvant sporløst fra lønnsgrunnlaget uten at noen fikk vite det
// (bekreftet reell bug 2026-10-22). Samme mønster (tidsstempel + tilfeldig suffiks) som
// admin-ark.js/lager.js allerede bruker for sine egne ID-er.
function nyTimerId(prefiks) {
  return prefiks + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// Varsler admin (push) idet en ansatt registrerer sykdom eller egenmelding - bedt om av
// Henrik 2026-10-23, slik at han vet med en gang i stedet for å oppdage det tilfeldigvis
// senere (f.eks. på lønnsslippen, eller ved å åpne fraværskalenderen). Samme "send-push"-
// edge-funksjon som resten av appen bruker (se supabase/functions/send-push) - egen "type"
// der filtrerer selv til kun admin-abonnenter, se den filen for selve varsel-teksten.
// Bevisst ikke sendt for ferie/permisjon - de er normalt planlagt i god tid og mindre
// tidskritiske å få vite om umiddelbart (samme vurdering som Henrik selv gjorde i samtalen).
function varsleAdminOmFravaer(fravaerType, fraDato, tilDato, betalt) {
  if (!SUPA_URL || !SUPA_KEY) return;
  edgeFetch('send-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'fravaer_registrert', ansattNavn: me?.navn || '?', fravaerType, fraDato, tilDato,
      betalt: betalt === undefined ? null : betalt
    })
  }, { stille: true }).catch(e => console.warn('Fravær-varsel feilet:', e));
}

// Den gående klokka lagres lokalt (localStorage) så den overlever en omlasting. I en nettleser der lagring er blokkert
// (Edge «Tracking Prevention», strenge innstillinger, privat modus) KASTER localStorage; før 2026-11-02 stoppet det
// innloggingen (initTimerPage kjører i tryLogin) og kunne hindre at klokka startet. Disse tre svelger feilen: uten
// lagring virker klokka fortsatt, den overlever bare ikke en omlasting.
function timerStartHent(id) { try { return localStorage.getItem('timerStart_' + id); } catch (e) { return null; } }
function timerStartSett(id, v) { try { localStorage.setItem('timerStart_' + id, v); } catch (e) { console.warn('Kunne ikke lagre klokka lokalt:', e && e.message); } }
function timerStartFjern(id) { try { localStorage.removeItem('timerStart_' + id); } catch (e) { /* ingenting å fjerne */ } }

function initTimerPage() {
  const d=new Date();
  document.getElementById('timerDatoLbl').textContent=d.toLocaleDateString('no',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  timerType='normal';
  highlightTimerType();
  renderTimerHistorikk();
  visSykemeldingPaaminnelse();
  // Gjenopprett pågående timer hvis siden ble lukket
  const lagretStart = timerStartHent(me?.id);
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
      sjekkAdminUtstempling().catch(e => console.warn('sjekkAdminUtstempling:', e && e.message));
    } else {
      timerStartFjern(me?.id);
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
  vis('ferieFelt', t==='ferie'||t==='permisjon'||t==='syk'||t==='ugyldig_fravaer');
  vis('sykFelt', t==='egenmelding');
  const today=new Date().toISOString().split('T')[0];
  if(t==='manuell'){
    const mDato=document.getElementById('mDato'); if(mDato&&!mDato.value) mDato.value=today;
  }
  if(t==='egenmelding'){
    visEgenmeldingKvoteInfo();
  }
  if(t==='ferie'||t==='permisjon'||t==='syk'||t==='ugyldig_fravaer'){
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
  ['normal','manuell','syk','egenmelding','ferie','permisjon','ugyldig_fravaer'].forEach(t=>{
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

// Modusen settes ved HVER åpning (ikke bare i manuell flyt): et avbrutt PIN-vindu fra manuell føring skal ikke gjøre neste PIN-start til en lagring av den avbrutte føringen.
function openTimerPIN(melding, modus) {
  timerPINMode = modus || 'gps';
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
  // Modusen leses og nullstilles SYNKRONT: doLagreManuellTimer venter på et nettverkskall (overlapp-sjekken), og en ny PIN-runde i mellomtiden skulle ikke se «manuell» (det ga innstempling i stedet for føring).
  const modus = timerPINMode; timerPINMode = 'gps';
  if(modus==='manuell') {
    doLagreManuellTimer();
  } else {
    doStartTimer('Startet med PIN-overstyring');
  }
}

let _manuellTimerLagrer = false;
async function doLagreManuellTimer() {
  if(!me) return;
  if (_manuellTimerLagrer) return; // dobbelttrykk mens overlapp sjekkes skal ikke gi to føringer
  _manuellTimerLagrer = true;
  try {
    const start=document.getElementById('mFra').value;
    const stopp=document.getElementById('mTil').value;
    // Feltene tømmes først når føringen er lagret: en ny PIN-runde som kommer etter at den forrige er ferdig skal ikke lagre en tom føring.
    if(!start||!stopp){ visToast('Fyll inn fra- og til-tid', 'feil'); return; }
    const { mins }=beregnManuellMinutter(start,stopp);
    const dato=document.getElementById('mDato')?.value||new Date().toISOString().split('T')[0];
    // Advarsel om overlapp med timer som allerede er ført samme dag (teller ellers to ganger i lønn). Avbryter brukeren, beholdes feltene så tidene kan rettes.
    const overlapp = await finnOverlappendeTimeforinger(me.id, dato, start, stopp);
    if (overlapp.length && !confirm(overlappAdvarselTekst('Du', dato, start, stopp, overlapp))) { timerPINMode='gps'; return; }
    const entry={
      id:nyTimerId('t'), ansattId:me.id, ansatt:me.navn,
      dato, type:'manuell', start, stopp, mins, _localAt:Date.now()
    };
    S.timer.push(entry);
    if(db) db.from('timer_entries').insert({
      id:entry.id,ansatt_id:me.id,ansatt:me.navn,
      dato:entry.dato,type:'manuell',start,stopp,mins
    }).then(r=>{if(r.error) { console.error('Timer feil:',r.error.message); visToast('Kunne ikke lagre timeregistreringen - prøv igjen'); } });
    planleggLocalSpeiling();
    renderTimerHistorikk(); renderTimerMaaned();
    document.getElementById('mFra').value='';
    document.getElementById('mTil').value='';
    timerPINMode='gps';
  } finally {
    _manuellTimerLagrer = false;
  }
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
  planleggLocalSpeiling();
  if(db) db.from('timer_entries').delete().in('id', [...avbrutteId])
    .then(r=>{if(r.error) console.error('Avbryting av egenmelding feilet:',r.error.message);});
  renderTimerHistorikk(); renderTimerMaaned();
}

function doStartTimer(notat) {
  avbrytAktivEgenmelding();
  const btn=document.getElementById('startBtn');
  if(btn){btn.textContent='▶ Start';btn.disabled=true;}
  timerStart=Date.now();
  timerStartSett(me?.id, timerStart);
  document.getElementById('stoppBtn').disabled=false;
  timerTick=setInterval(updateClock,1000);
  updateClock();
  console.log('Timer startet:',notat);
  oppdaterTilstandPille();
  // Stemplingen MÅ være skrevet til databasen FØR Ombygging-klokkene gjenopptas: databasen starter bare en klokke for en ansatt den ser er stemplet inn (ansatt_kan_ha_ordreklokke).
  settStempletInnSiden(new Date().toISOString())
    .then(ok => {
      if (ok) return gjenopptaMineOrdreKlokkerVedInnstempling();
      // Stemplingen kom ikke frem til databasen (dårlig dekning): klokka går lokalt, men databasen starter ingen Ombygging-klokke for en som ikke er stemplet inn. Prøv igjen straks og si fra.
      visToast('Klokka går, men innstemplingen ble ikke lagret på nettet. Prøver igjen straks.', 'feil');
      setTimeout(() => { reparerManglendeStempling().then(r => { if (r) return gjenopptaMineOrdreKlokkerVedInnstempling(); }).catch(() => {}); }, 5000);
    })
    .catch(e => console.error('Kunne ikke gjenoppta ordreklokker ved innstempling:', e && e.message));
}

// Skriver tidspunktet jeg stemplet inn til min EGEN ansatte-rad (bedt om av Henrik
// 2026-10-28: "se hvem av de ansatte som fortsatt er stemplet inn") - nullstilles igjen av
// lagreTimer() sin hale når jeg stempler ut. Dette var tidligere umulig å se fra noen annen
// økt enn den som faktisk startet klokka: "timerStart" har alltid kun levd som en ren
// nettleser-lokal variabel + localStorage, en timer_entries-rad opprettes først når klokka
// STOPPES (se lagreTimer()) - ingen database-tilstand fantes for en PÅGÅENDE innstempling.
// Målrettet enkelt-kolonne-skriving på egen rad - ingen samtidighets-/låseproblematikk siden
// det aldri er mer enn én skriver (ansatten selv) per rad, samme mønster som session_token.
// Returnerer et løfte (true = skrevet til databasen) slik at innstempling kan vente på at stemplingen faktisk står der før ordreklokkene gjenopptas.
function settStempletInnSiden(iso) {
  if (!me) return Promise.resolve(false);
  me.stempletInnSiden = iso;
  const egen = S.ansatte?.find(a=>a.id===me.id); if (egen) egen.stempletInnSiden = iso;
  if (!db) return Promise.resolve(false);
  ignorerRealtimeAnsatt.add(String(me.id));
  setTimeout(()=>ignorerRealtimeAnsatt.delete(String(me.id)), 5000);
  return Promise.resolve(db.from('ansatte').update({ stemplet_inn_siden: iso }).eq('id', me.id))
    .then(r=>{ if(r.error) { console.error('Kunne ikke oppdatere stemplet_inn_siden:', r.error.message); return false; } return true; })
    .catch(e=>{ console.error('Kunne ikke oppdatere stemplet_inn_siden:', e && e.message); return false; });
}

// Kobler den daglige lønnsklokka sammen med Ombygging-klokka (den automatiske, se
// ordreAktivFase() i ordre-diverse.js) - bedt om av Henrik 2026-10-26 etter at en ansatt
// stemplet ut mens Ombygging-klokka fortsatt sto og gikk synlig på ordren. Selve EFFEKTIV
// tid-beregningen (brukt i Bil-effektivitet-visningen) var allerede riktig - natta/fritiden
// trekkes automatisk fra der - men den RÅ klokka vist på selve ordre-siden fortsatte å løpe
// i det uendelige helt til noen trykket Stopp manuelt, noe som naturlig nok så feil/
// urovekkende ut. Stopper nå MIN åpne Ombygging-klokke når jeg stempler ut på vanlig Timer,
// og gjenopptar den automatisk neste gang jeg stempler inn igjen - uten at jeg må melde meg
// på/av ordren på nytt. Gjelder BEVISST IKKE Klargjøring, som er en ren manuell klokke uten
// noen kobling til status eller lønnsklokka i det hele tatt (se samme fil, samme dato).
// Fra 2026-11-04 stoppes ALLE mine åpne Ombygging-klokker i ÉN databasefunksjon (stopp_ordreklokker_for_ansatt, også på ordre som ikke er lastet lokalt), i stedet for én økt om gangen fra
// lokal kopi. Svikter den (ingen nett, eller databasen mangler den ennå), brukes den gamle veien som reserve. stoppMs (valgfri, bare admin): stopptidspunkt i ms, ellers nå.
// Klokka går lokalt (timerStart), men databasen har ingen innstempling fordi skrivingen mislyktes (dårlig dekning ved innstempling, blokkert lagring). Da vil databasen aldri starte en Ombygging-klokke for meg, og
// admin ser meg ikke i «Stemplet inn nå». Skriver stemplingen fra timerStart på nytt, men BARE når databasen er tom OG ingen timeføring er ført siden klokka startet: en tom stempling med en ført føring er en
// admin-utstempling (sjekkAdminUtstempling stopper da klokka), og den skal aldri gjenopplives. Gir true når databasen nå viser at jeg er stemplet inn.
const STEMPLING_MAKS_ALDER_MS = 16 * 3600000;   // samme grense som databasen (ansatt_kan_ha_ordreklokke) og admin-utstempling: en eldre innstempling er en glemt utstempling
async function reparerManglendeStempling() {
  if (!me || !timerStart || !db) return false;
  const start = timerStart;
  const fersk = await db.from('ansatte').select('stemplet_inn_siden').eq('id', me.id).single();
  if (fersk.error || !fersk.data) return false;
  if (fersk.data.stemplet_inn_siden) {
    // Finnes en stempling, men er den over 16 t gammel, teller databasen den ikke, og den kan ikke repareres her (den lokale klokka er like gammel): ansatten må stemple ut og inn.
    const ms = Date.parse(fersk.data.stemplet_inn_siden);
    return !isNaN(ms) && ms > Date.now() - STEMPLING_MAKS_ALDER_MS;
  }
  if (start < Date.now() - STEMPLING_MAKS_ALDER_MS) return false;
  const reg = await db.from('timer_entries').select('id').eq('ansatt_id', me.id).eq('type', 'normal').gte('created_at', new Date(start).toISOString()).limit(1);
  if (reg.error || (reg.data && reg.data.length)) return false;
  if (timerStart !== start) return false;
  return await settStempletInnSiden(new Date(start).toISOString());
}
// Etter at en manglende innstempling er skrevet på nytt skal klokkene på ordrene jeg er meldt på gjenopptas. Ved oppstart kjører sjekkAdminUtstempling (initTimerPage) FØR ordrene er lastet (S.ordrer er tom):
// da settes et merke, og tryLogin kjører gjenopptakelsen så snart dataene er lastet (gjenopptaMineEtterInnlasting).
let _gjenopptaNaarDataErLastet = false;
async function gjenopptaEtterReparasjon() {
  if ((S.ordrer||[]).length) await gjenopptaMineOrdreKlokkerVedInnstempling();
  else _gjenopptaNaarDataErLastet = true;
}
async function gjenopptaMineEtterInnlasting() {
  if (!_gjenopptaNaarDataErLastet) return;
  _gjenopptaNaarDataErLastet = false;
  await gjenopptaMineOrdreKlokkerVedInnstempling();
}
// Databasen svarte at jeg (blant andre) ikke var stemplet inn da en fase startet (ikkeStemplet), men min lokale klokke går: da har innstemplingen aldri kommet frem. Reparer den og gjenoppta klokkene, og returner
// de som FORTSATT ikke er stemplet inn (de skal få beskjeden), slik at ansatten ikke får en «ikke stemplet inn»-melding som motsier klokka på skjermen.
async function selvhelIkkeStemplet(navn) {
  const rest = Array.isArray(navn) ? navn.slice() : [];
  if (me && timerStart && rest.includes(me.navn)) {
    let ok = false;
    try { ok = await reparerManglendeStempling(); } catch (e) { console.error('Kunne ikke reparere stemplingen:', e && e.message); }
    if (ok) {
      try { await gjenopptaMineOrdreKlokkerVedInnstempling(); } catch (e) { console.error('Kunne ikke gjenoppta klokkene:', e && e.message); }
      return rest.filter(n => n !== me.navn);
    }
  }
  return rest;
}
// Returnerer 'reserve' hvis den nye databasefunksjonen ikke kunne brukes og klokker ble stoppet «nå» via den gamle veien (da kan ikke et valgt klokkeslett brukes), 'feilet' hvis heller ikke den veien stoppet dem.
async function stoppOrdreKlokkerForAnsatt(ansattId, ansattNavn, stoppMs) {
  try {
    const args = { p_ansatt_id: ansattId };
    if (stoppMs != null) args.p_stopp_ms = stoppMs;
    const { data, error } = await db.rpc('stopp_ordreklokker_for_ansatt', args);
    if (!error && data) {
      (data.ordrer || []).forEach(r => {
        const o = (S.ordrer||[]).find(x => x.id === r.id);
        if (o && Array.isArray(r.sessions)) o.ordreTimerSessions = r.sessions;
      });
      if ((data.antall || 0) > 0 && typeof buildOrdreDetail === 'function') buildOrdreDetail();
      return;
    }
    if (error) console.error('Kunne ikke stoppe ordreklokker (bruker reserve):', error.message);
  } catch (e) { console.error('Kunne ikke stoppe ordreklokker (bruker reserve):', e && e.message); }
  const apne = (S.ordrer||[]).filter(o => ansattHarApenOrdreSesjon(o, 'ordreTimerSessions', ansattId));
  for (const o of apne) {
    await stoppOrdreTimerForAnsatt(o, 'ordreTimerSessions', ansattId, ansattNavn);
  }
  if (!apne.length) return undefined;
  return apne.every(o => !ansattHarApenOrdreSesjon(o, 'ordreTimerSessions', ansattId)) ? 'reserve' : 'feilet';
}
async function stoppMineOrdreKlokkerVedUtstempling() {
  if (!me || !db) return;
  await stoppOrdreKlokkerForAnsatt(me.id, me.navn);
}
async function gjenopptaMineOrdreKlokkerVedInnstempling() {
  if (!me || !db) return;
  const mine = (S.ordrer||[]).filter(o => (o.ansatteSignert||[]).some(a=>a.id===me.id));
  for (const o of mine) {
    const felt = ordreAktivFase(o);
    if (felt && !ansattHarApenOrdreSesjon(o, felt, me.id)) await startOrdreTimerForAnsatt(o, felt, me.id, me.navn);
  }
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

async function lagreTimer() {
  if(!me) return;
  let start='', stopp='', mins=0;
  if (timerType==='manuell') {
    if (_manuellTimerLagrer) { visToast('Lagrer allerede føringen. Vent et øyeblikk.', 'ok'); return; }
    start=document.getElementById('mFra').value;
    stopp=document.getElementById('mTil').value;
    if(!start||!stopp){alert('Fyll inn fra- og til-tid');return;}
    // Krev dagens PIN for manuell registrering
    openTimerPIN('Tast inn dagens PIN for å bekrefte manuell timeregistrering', 'manuell');
    return;
  } else if (timerStart) {
    const ms=Date.now()-timerStart;
    mins=beregnNettoMinutter(Math.floor(ms/60000)).netto;
    start=new Date(timerStart).toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
    stopp=new Date().toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'});
  } else if (['ferie','permisjon','syk','ugyldig_fravaer'].includes(timerType)) {
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
          id:nyTimerId('t'), ansattId:me.id, ansatt:me.navn,
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
      .then(r=>{if(r.error) { console.error('Timer lagringsfeil:',r.error.message); visToast('Kunne ikke lagre registreringen - prøv igjen'); } });
    planleggLocalSpeiling();
    renderTimerHistorikk(); renderTimerMaaned();
    // Syk og ugyldig fravær varsler admin med en gang - ferie/permisjon er normalt planlagt
    // i god tid. Ugyldig fravær er i praksis et varsel om et problem (ikke møtt/ikke gyldig
    // grunn), så admin bør få beskjed like raskt som ved sykdom.
    if (timerType === 'syk' || timerType === 'ugyldig_fravaer') varsleAdminOmFravaer(timerType, entries[0].dato, entries[entries.length-1].dato);
    return;
  } else if (timerType==='egenmelding') {
    // Se genererEgenmeldingDager/egenmeldingEpisoderSisteAar lenger opp i filen for
    // begrunnelse (3 kalenderdager, maks 4 betalte episoder siste rullerende 12 måneder).
    const idag = new Date().toISOString().split('T')[0];
    if (!egenmeldingKvalifisert(me.ansettelsesdato, idag)) {
      alert('Du kan ikke bruke egenmelding ennå - dette krever minst 2 måneders ansettelse.');
      return;
    }
    const periodeId = nyTimerId('ep');
    // Teller FERSKE episoder direkte fra databasen i stedet for kun denne øktens lokale
    // S.timer-kopi - uten dette kunne samme ansatt (logget inn på f.eks. både jobbtelefon
    // og en felles tidsklokke på verkstedet - PIN-innlogging setter ingen sperre mot flere
    // samtidige økter) registrere egenmelding fra begge enhetene innen kort tid og få BEGGE
    // feilaktig merket betalt:true, siden ingen av øktene ennå hadde mottatt den andres nye
    // rad via Realtime (funnet 2026-10-22). Faller tilbake til den lokale kopien hvis
    // spørringen feiler eller appen er offline - samme oppførsel som før fiksen.
    let episodeKilde = S.timer;
    if (db) {
      const { data, error } = await db.from('timer_entries')
        .select('dato,egenmelding_periode_id')
        .eq('ansatt_id', me.id).eq('type', 'egenmelding');
      if (!error && data) {
        episodeKilde = data.map(r => ({ ansattId: me.id, type: 'egenmelding', dato: r.dato, egenmeldingPeriodeId: r.egenmelding_periode_id }));
      } else if (error) {
        console.error('Kunne ikke hente ferske egenmeldinger, bruker lokal kopi:', error.message);
      }
    }
    const tidligereEpisoder = egenmeldingEpisoderSisteAar(episodeKilde, me.id, idag);
    const betalt = tidligereEpisoder < 4;
    const dager = genererEgenmeldingDager(idag, 3);
    const entries = dager.map(dato=>({
      id:nyTimerId('t'), ansattId:me.id, ansatt:me.navn,
      dato, type:'egenmelding', start:'–', stopp:'–', mins:0, betalt,
      egenmeldingPeriodeId:periodeId, _localAt:Date.now()
    }));
    entries.forEach(e=>S.timer.push(e));
    // Ett samlet insert-kall for alle 3 dagene i stedet for ett per dag, samme mønster
    // som ferie/permisjon/syk rett over.
    if(db) db.from('timer_entries').insert(entries.map(e=>({
        id:e.id, ansatt_id:me.id, ansatt:me.navn, dato:e.dato, type:'egenmelding',
        start:'–', stopp:'–', mins:0, betalt, egenmelding_periode_id:periodeId
      }))).then(r=>{if(r.error) { console.error('Timer lagringsfeil:',r.error.message); visToast('Kunne ikke lagre egenmeldingen - prøv igjen'); } });
    planleggLocalSpeiling();
    renderTimerHistorikk(); renderTimerMaaned(); visEgenmeldingKvoteInfo();
    visToast(
      betalt
        ? `Egenmelding registrert ${dager[0]} til ${dager[dager.length-1]}`
        : `Egenmelding registrert ${dager[0]} til ${dager[dager.length-1]} - UBETALT (mer enn 4 egenmeldinger brukt siste 12 måneder)`,
      betalt?'ok':'feil'
    );
    varsleAdminOmFravaer('egenmelding', dager[0], dager[dager.length-1], betalt);
    return;
  } else { alert('Start timer først'); return; }
  const timerEntry={
    id:nyTimerId('t'), ansattId:me.id, ansatt:me.navn,
    dato:new Date().toISOString().split('T')[0], type:timerType,
    start, stopp, mins, _localAt:Date.now()
  };
  S.timer.push(timerEntry);
  planleggLocalSpeiling();
  if(db) db.from('timer_entries').insert({
    id:timerEntry.id, ansatt_id:me.id, ansatt:me.navn,
    dato:timerEntry.dato, type:timerType, start, stopp, mins
  }).then(r=>{if(r.error) { console.error('Timer lagringsfeil:',r.error.message); visToast('Kunne ikke lagre timeregistreringen - prøv igjen'); } });
  timerStartFjern(me?.id);
  renderTimerHistorikk();
  stoppTimer();
  timerStart=null;
  document.getElementById('clockT').textContent='00';
  document.getElementById('clockM').textContent='00';
  document.getElementById('clockRange').textContent='--:-- – --:--';
  document.getElementById('clockPause').textContent='';
  oppdaterKlokkeRing(0, false);
  // VIKTIG: dette er selve koblingen som faktisk stopper Ombygging-klokka ved utstempling
  // (funksjonen fantes fra før, men var ved en feil aldri koblet til her - oppdaget og
  // fikset 2026-10-28 ved en ny gjennomgang, se stoppMineOrdreKlokkerVedUtstempling()).
  stoppMineOrdreKlokkerVedUtstempling();
  settStempletInnSiden(null);
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
  const ugyldigDager=mine.filter(t=>t.type==='ugyldig_fravaer').length;

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
    ${ugyldigDager>0?`<div class="box" style="text-align:center;background:#431407;border:1px solid #ea580c">
      <div class="small" style="color:#fdba74">⚠ Ugyldig fravær</div>
      <div class="title" style="color:#fb923c">${ugyldigDager}</div>
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


// ---------------------------------------------------------------------------------------------------------------
// ADMIN STEMPLER UT EN ANNEN ANSATT (2026-11-02, bedt om av Henrik: «det må være mulig for meg å logge ut ansatte,
// stemple ut»). Typisk når noen har glemt å stemple ut. Admin trykker «Stemple ut» i «Stemplet inn nå» (Oversikt),
// velger klokkeslett, og appen gjør DET SAMME som den ansattes egen utstempling (lagreTimer): registrerer timene som
// vanlig arbeidstid med vanlig pauseregel, stopper ordre-klokka (Ombygging) og nullstiller stemplet_inn_siden. Ingen
// databaseendring trengs: RLS lar admin sette inn timer_entries for andre, og ansatte_beskytt_skriving lar admin
// skrive alt på ansatte.
//
// Rekkefølge og sikkerhet (timer = lønn, så ingenting skal kunne gå tapt eller dobles):
//  1. Den ferske stemplingen leses fra databasen (ansatten kan ha stemplet ut selv i mellomtiden).
//  2. Timen settes inn med en FAST id (tadm_<ansatt>_<innstemplingen>): et nytt forsøk etter en delvis feil, eller to
//     administratorer samtidig, gir en duplikat-feil (23505) som regnes som «allerede registrert», aldri to rader.
//  3. Først DERETTER nullstilles stemplingen, og bare hvis den fortsatt er den vi leste (.eq på verdien).
//  Feiler trinn 2, skjer ingenting. Feiler trinn 3, står ansatten fortsatt stemplet inn (synlig), og et nytt forsøk er trygt.
// Den ansattes EGEN enhet har klokka gående lokalt (localStorage): når stemplingen nullstilles utenfra, stopper
// sjekkAdminUtstempling() den uten å registrere noe (se under), så samme tid ikke føres to ganger.
// ---------------------------------------------------------------------------------------------------------------

// Ren beregning (testes uten DOM): innstemplingen (ISO fra ansatte.stemplet_inn_siden) + klokkeslett «TT:MM» samme
// dag → dato/start/stopp/minutter etter samme pauseregel som manuell registrering (beregnManuellMinutter).
function beregnAdminUtstempling(stempletInnIso, stoppTid, naa) {
  const inn = new Date(stempletInnIso);
  if (!stempletInnIso || isNaN(inn.getTime())) return { feil: 'Fant ikke innstemplingstidspunktet.' };
  if (!/^\d{2}:\d{2}$/.test(stoppTid || '')) return { feil: 'Velg klokkeslettet for utstemplingen.' };
  const pad = n => String(n).padStart(2, '0');
  const dato = `${inn.getFullYear()}-${pad(inn.getMonth() + 1)}-${pad(inn.getDate())}`;
  const start = `${pad(inn.getHours())}:${pad(inn.getMinutes())}`;
  const [h, m] = stoppTid.split(':').map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return { feil: 'Ugyldig klokkeslett.' };
  const stoppAbs = new Date(inn); stoppAbs.setHours(h, m, 0, 0);
  if (stoppAbs.getTime() > (naa || new Date()).getTime()) return { feil: 'Utstemplingen kan ikke ligge frem i tid.' };
  const { raatid, mins } = beregnManuellMinutter(start, stoppTid);
  if (raatid <= 0) return { feil: `Utstemplingen må være etter innstemplingen (${start}).` };
  if (raatid > 16 * 60) return { feil: 'Mer enn 16 timer mellom inn og ut. Sjekk klokkeslettet.' };
  return { dato, start, stopp: stoppTid, mins, raatid, pause: raatid - mins, stoppMs: stoppAbs.getTime() };
}

// ---------------------------------------------------------------------------------------------------------------
// OVERLAPP MELLOM TIMEFØRINGER (2026-11-04): to føringer for samme ansatt som dekker samme tidsrom teller timene to ganger (lønn). Funnet i dataene: Ismail 2.11 og Henrik 30.9/7.10/10.10.
// Appen advarer nå før en admin-utstempling og en manuell føring lagres; brukeren kan likevel velge å lagre (f.eks. en reell rettelse), men får se overlappet først.
// ---------------------------------------------------------------------------------------------------------------
function tidTilMinutter(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
// Ren sjekk (testes uten db): overlapper to tidsrom «HH:MM»–«HH:MM» (samme dag)? Et tidsrom som slutter før/samtidig som det starter regnes som over midnatt. Tidsrom som bare tangerer (slutt = start) overlapper ikke.
function tidsrommOverlapper(aStart, aStopp, bStart, bStopp) {
  let a1 = tidTilMinutter(aStart), a2 = tidTilMinutter(aStopp), b1 = tidTilMinutter(bStart), b2 = tidTilMinutter(bStopp);
  if (a1 == null || a2 == null || b1 == null || b2 == null) return false;
  if (a2 < a1) a2 += 1440;
  if (b2 < b1) b2 += 1440;
  if (a1 === a2 || b1 === b2) return false;   // start = stopp (Start og Stopp i samme minutt) er null varighet, ikke et døgn
  return a1 < b2 && b1 < a2;
}
// Finner eksisterende arbeidstid (normal/manuell) for ansatten samme dato som overlapper start–stopp. Leser ferskt fra databasen (ikke bare S.timer). Svikter oppslaget, returneres tom liste
// (en advarsel skal aldri hindre at timer kan føres). unntattId: en rad som ikke skal telle (f.eks. den som er i ferd med å lagres på nytt).
async function finnOverlappendeTimeforinger(ansattId, dato, start, stopp, unntattId) {
  if (!db) return [];
  try {
    // Høyst 4 sekunder: en advarsel skal aldri kunne holde føringen fanget (svak dekning kan la et kall henge uten å feile).
    const svar = await Promise.race([Promise.resolve(db.from('timer_entries').select('id,type,start,stopp').eq('ansatt_id', ansattId).eq('dato', dato)), new Promise(ok => setTimeout(() => ok({ tidsavbrudd: true }), 4000))]);
    if (svar && svar.tidsavbrudd) { console.error('Overlapp-sjekken tok for lang tid og ble hoppet over'); return []; }
    const { data, error } = svar || {};
    if (error || !Array.isArray(data)) { if (error) console.error('Kunne ikke sjekke overlapp i timeføringer:', error.message); return []; }
    return data.filter(r => r && r.id !== unntattId && (r.type === 'normal' || r.type === 'manuell') && r.start && r.stopp && tidsrommOverlapper(start, stopp, r.start, r.stopp))
      .map(r => ({ id: r.id, start: r.start, stopp: r.stopp }));
  } catch (e) { console.error('Kunne ikke sjekke overlapp i timeføringer:', e && e.message); return []; }
}
function overlappAdvarselTekst(navn, dato, start, stopp, overlapp) {
  const liste = overlapp.map(r => `${r.start}–${r.stopp}`).join(', ');
  return `${navn} har allerede timer ${dato} som overlapper ${start}–${stopp}: ${liste}.\n\nLagres begge, telles tiden i overlappet to ganger i lønnsgrunnlaget. Vil du lagre likevel?`;
}
function adminUtstemplingEntryId(ansattId, stempletInnIso) { return 'tadm_' + ansattId + '_' + new Date(stempletInnIso).getTime(); }
function formaterVarighet(mins) { return mins >= 60 ? `${Math.floor(mins / 60)} t ${mins % 60} min` : `${mins} min`; }

let stempleUtAnsattId = null;
function apneStempleUtModal(ansattId) {
  if (!me || me.rolle !== 'admin') return;
  const a = (S.ansatte || []).find(x => x.id === ansattId);
  if (!a || !a.stempletInnSiden) { visToast('Den ansatte er ikke stemplet inn', 'feil'); return; }
  stempleUtAnsattId = ansattId;
  const inn = new Date(a.stempletInnSiden);
  const pad = n => String(n).padStart(2, '0');
  const erIdag = inn.toDateString() === new Date().toDateString();
  document.getElementById('stempleUtNavn').textContent = a.navn;
  document.getElementById('stempleUtInfo').textContent = 'Stemplet inn ' + inn.toLocaleDateString('no', { weekday: 'long', day: 'numeric', month: 'long' }) + ' kl. ' + pad(inn.getHours()) + ':' + pad(inn.getMinutes());
  // I dag: nå. En glemt utstempling fra en tidligere dag: 15:00 som utgangspunkt (admin retter til det riktige).
  const naa = new Date();
  document.getElementById('stempleUtTid').value = erIdag ? pad(naa.getHours()) + ':' + pad(naa.getMinutes()) : '15:00';
  oppdaterStempleUtOppsummering();
  openModal('stempleUt');
}
function oppdaterStempleUtOppsummering() {
  const el = document.getElementById('stempleUtOppsummering'); const knapp = document.getElementById('stempleUtBekreft');
  const a = (S.ansatte || []).find(x => x.id === stempleUtAnsattId);
  if (!el || !a || !a.stempletInnSiden) return;
  const r = beregnAdminUtstempling(a.stempletInnSiden, document.getElementById('stempleUtTid').value);
  if (r.feil) { el.style.color = '#fca5a5'; el.textContent = r.feil; if (knapp) knapp.disabled = true; return; }
  el.style.color = '#86efac';
  el.textContent = `${r.start} – ${r.stopp}: ${formaterVarighet(r.mins)} registreres` + (r.pause ? ` (${r.pause} min pause trukket)` : '');
  if (knapp) knapp.disabled = false;
}

async function adminStempleUt() {
  if (!me || me.rolle !== 'admin' || !db) return;
  const knapp = document.getElementById('stempleUtBekreft');
  if (knapp && knapp.disabled) return;
  if (knapp) knapp.disabled = true;
  try {
    const id = stempleUtAnsattId;
    const a = (S.ansatte || []).find(x => x.id === id);
    if (!a) return;
    // 1) Ferskt fra databasen.
    const les = await db.from('ansatte').select('stemplet_inn_siden').eq('id', id).single();
    if (les.error) { visToast('Kunne ikke sjekke stemplingen. Prøv igjen.', 'feil'); console.error('adminStempleUt: lesing feilet:', les.error.message); return; }
    const innIso = les.data && les.data.stemplet_inn_siden;
    if (!innIso) {
      a.stempletInnSiden = null; renderStempletInnNa(); closeModal('stempleUt');
      visToast(`${a.navn} er allerede stemplet ut`, 'ok'); return;
    }
    a.stempletInnSiden = innIso;
    const r = beregnAdminUtstempling(innIso, document.getElementById('stempleUtTid').value);
    if (r.feil) { visToast(r.feil, 'feil'); oppdaterStempleUtOppsummering(); return; }
    // 2) Timene, med fast id (idempotent).
    const rad = { id: adminUtstemplingEntryId(id, innIso), ansatt_id: id, ansatt: a.navn, dato: r.dato, type: 'normal', start: r.start, stopp: r.stopp, mins: r.mins };
    // Advarsel hvis ansatten allerede har timer som dekker samme tidsrom (en rad med samme faste id er et nytt forsøk av denne utstemplingen og teller ikke). Ingen endring er gjort ennå, så Avbryt er trygt.
    const overlapp = await finnOverlappendeTimeforinger(id, r.dato, r.start, r.stopp, rad.id);
    if (overlapp.length && !confirm(overlappAdvarselTekst(a.navn, r.dato, r.start, r.stopp, overlapp))) return;
    const ins = await db.from('timer_entries').insert(rad);
    if (ins.error && ins.error.code !== '23505') {
      visToast('Kunne ikke registrere timene. Ingen er stemplet ut.', 'feil'); console.error('adminStempleUt: innsetting feilet:', ins.error.message); return;
    }
    if (ins.error) {
      // 23505: samme innstempling er registrert før (nytt forsøk). Er den registrert med ANDRE klokkeslett enn de admin har valgt nå, ville skjermen og klokkene si noe annet enn lønnsgrunnlaget: avbryt med beskjed.
      const ex = await db.from('timer_entries').select('start,stopp').eq('id', rad.id).single();
      if (ex && ex.data && (ex.data.start !== rad.start || ex.data.stopp !== rad.stopp)) {
        visToast(`Utstemplingen er allerede registrert som ${ex.data.start}–${ex.data.stopp}. Velg ${ex.data.stopp} for å fullføre, eller rediger føringen først.`, 'feil'); return;
      }
    }
    // 3) Nullstill stemplingen, bare hvis den fortsatt er den vi leste.
    const upd = await db.from('ansatte').update({ stemplet_inn_siden: null }).eq('id', id).eq('stemplet_inn_siden', innIso).select('id');
    if (upd.error || !upd.data || !upd.data.length) {
      console.error('adminStempleUt: nullstilling feilet:', upd.error && upd.error.message);
      visToast('Timene er registrert, men stemplingen ble ikke nullstilt. Trykk «Stemple ut» igjen.', 'feil'); return;
    }
    // Lokalt: timen inn i S.timer (Realtime legger den ikke til to ganger), stemplingen nullstilt, ordre-klokka stoppet.
    if (!(S.timer || []).find(t => t.id === rad.id)) S.timer.unshift(dbToTimer(rad));
    a.stempletInnSiden = null;
    // Ordreklokkene stoppes på det VALGTE utstemplingstidspunktet (ikke nå): en økt som startet etter det får null varighet, aldri negativ eller tid etter utstemplingen.
    const klokkeRes = await stoppOrdreKlokkerForAnsatt(id, a.navn, r.stoppMs);
    if (typeof planleggLocalSpeiling === 'function') planleggLocalSpeiling();
    renderStempletInnNa();
    if (typeof renderTimerMaaned === 'function') { renderTimerHistorikk(); renderTimerMaaned(); }
    closeModal('stempleUt');
    visToast(`${a.navn} er stemplet ut kl. ${r.stopp} (${formaterVarighet(r.mins)} registrert)` + (klokkeRes === 'reserve' ? `. Ordreklokkene ble stoppet nå, ikke kl. ${r.stopp} (kunne ikke stoppe på valgt tid).` : klokkeRes === 'feilet' ? '. Ordreklokkene kunne IKKE stoppes: stopp dem fra ordren (Stopp…).' : ''), klokkeRes === 'feilet' ? 'feil' : 'ok');
  } finally {
    if (knapp) knapp.disabled = false;
  }
}

// Den ansattes egen enhet: klokka går lokalt (timerStart + localStorage) og vet ikke at admin har stemplet ut. Kalles
// (a) fra Realtime når MIN stemplet_inn_siden går fra satt til tom uten at jeg selv gjorde det, og (b) når siden
// gjenoppretter en lagret klokke ved oppstart. Klokka stoppes BARE hvis databasen viser at stemplingen er borte OG det
// finnes en timeføring på meg opprettet etter at klokka startet (beviset på at tiden allerede er ført av en annen). Ellers
// beholdes klokka: en mislykket innstemplingsskriving eller en urelatert oppdatering skal aldri slette en ekte klokke.
async function sjekkAdminUtstempling() {
  if (!me || !timerStart || !db) return false;
  const start = timerStart;
  const fersk = await db.from('ansatte').select('stemplet_inn_siden').eq('id', me.id).single();
  if (fersk.error || !fersk.data || fersk.data.stemplet_inn_siden) return false;
  const reg = await db.from('timer_entries').select('id').eq('ansatt_id', me.id).eq('type', 'normal')
    .gte('created_at', new Date(start).toISOString()).limit(1);
  if (reg.error || !reg.data || !reg.data.length) {
    // Tom stempling og ingen føring: dette er IKKE en admin-utstempling (den fører timene først), men en innstempling som aldri kom frem til databasen. Skriv stemplingen på nytt.
    if (!reg.error && timerStart === start && Date.now() - start < STEMPLING_MAKS_ALDER_MS && await settStempletInnSiden(new Date(start).toISOString())) await gjenopptaEtterReparasjon();
    return false;
  }
  if (timerStart !== start) return false; // en ny klokke startet i mellomtiden
  timerStartFjern(me.id);
  timerStart = null;
  stoppTimer();
  const t = document.getElementById('clockT'); if (t) t.textContent = '00';
  const m = document.getElementById('clockM'); if (m) m.textContent = '00';
  const rng = document.getElementById('clockRange'); if (rng) rng.textContent = '--:-- – --:--';
  const p = document.getElementById('clockPause'); if (p) p.textContent = '';
  oppdaterKlokkeRing(0, false);
  me.stempletInnSiden = null;
  visToast('Du er stemplet ut av administrator. Timene er allerede registrert.', 'ok');
  return true;
}
