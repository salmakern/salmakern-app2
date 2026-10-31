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
const SENTRY_DSN = 'https://0d9ac7114a72a938a776e0c6adb8ce99@o4512338671828992.ingest.de.sentry.io/4512338683166800';

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

// ════════════════════════════════════════════════════
// AUTO-SKJUL TOPPBAR VED SCROLL
// ════════════════════════════════════════════════════
// Toppbaren (logo/varsler/logg ut + faneknappene) er alltid synlig (position:sticky) og tar
// opp mye skjermplass på mobil, spesielt inne på en ordre som allerede har sin egen sticky
// knapperad rett under. Skjuler toppbaren når brukeren scroller NEDOVER forbi en liten
// dødsone (for å unngå flimring ved småskjelving), viser den igjen ved MINSTE oppover-
// scroll eller nær toppen av siden - bedt om av Henrik 2026-10-29 ("skreller ned over så
// forsvinner den, blar litt opp så kommer den fram igjen"). Ordre-detaljens egen sticky
// knapperad (se buildOrdreDetail() i ordre-detalj.js) følger automatisk med via CSS-
// variabelen --top-h i stedet for en fast px-verdi beregnet kun én gang ved rendering,
// slik at den alltid flytter seg til der toppbaren faktisk er (0 når den er skjult).
let toppbarHoyde = 0;
let toppbarSkjult = false;
let toppbarSisteScrollY = 0;
function oppdaterToppbarHoyde() {
  const el = document.querySelector('.top');
  if (el) toppbarHoyde = el.offsetHeight;
  document.documentElement.style.setProperty('--top-h', (toppbarSkjult ? 0 : toppbarHoyde) + 'px');
}
function settToppbarSkjult(skjul) {
  if (skjul === toppbarSkjult) return;
  toppbarSkjult = skjul;
  document.querySelector('.top')?.classList.toggle('skjult', skjul);
  document.documentElement.style.setProperty('--top-h', (toppbarSkjult ? 0 : toppbarHoyde) + 'px');
}
if (typeof window !== 'undefined') {
  window.addEventListener('load', oppdaterToppbarHoyde);
  window.addEventListener('resize', oppdaterToppbarHoyde);
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const diff = y - toppbarSisteScrollY;
    if (y > 80 && diff > 4) settToppbarSkjult(true);
    else if (diff < -4 || y <= 80) settToppbarSkjult(false);
    toppbarSisteScrollY = y;
  }, { passive: true });
}

// Skrur av nettleserens "husk det jeg skrev sist"-forslag (autofyll) på alle felt i
// appen - både de som finnes ved sideinnlasting og de som lages dynamisk senere
// (skjemaer, modaler, rad-redigering i f.eks. Kontakter/Admin-ark). Rører aldri et
// felt som allerede har fått en bevisst autocomplete-verdi satt i markup.
function skruAvAutofyll(rot) {
  rot.querySelectorAll('input, textarea, select').forEach(el => {
    if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
  });
}
// Guard mot testmiljøet (Node vm-sandbox i test/): document der er en enkel objekt-stub
// uten ekte DOM-metoder (querySelectorAll/documentElement), og MutationObserver finnes
// ikke i det hele tatt - uten denne sjekken feiler HVER test som laster core.js.
if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function' && typeof MutationObserver !== 'undefined') {
  skruAvAutofyll(document);
  new MutationObserver(mutasjoner => {
    for (const m of mutasjoner) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('input, textarea, select')) node.setAttribute('autocomplete', 'off');
        skruAvAutofyll(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

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

// ════════════════════════════════════════════════════
// KALL TIL EDGE FUNCTIONS (fiken-fakturer, send-frakt-epost, vegvesen-oppslag, send-push)
// ════════════════════════════════════════════════════
// ALLE kall til /functions/v1/ skal gå via denne - aldri en direkte fetch() (vokter:
// test/ingen-direkte-edge-kall.test.js). Funksjonene skal kreve at kalleren er en innlogget
// ansatt: ansatt = anonym Supabase-sesjon + PIN, og access-token-et i sesjonen bærer
// ansatt_id/rolle/session_token (custom_access_token_hook). Funksjonene verifiserer
// token-et mot databasen (rpc/current_ansatt): i dag gjør fiken-fakturer og send-frakt-epost
// det, men i MYK modus (logger, blokkerer ikke) til EDGE_AUTH_ENFORCE slås på; vegvesen-oppslag
// og send-push har ennå ingen sjekk. Den offentlige SUPA_KEY (som står i åpen kildekode og
// ikke er en JWT) skal ikke lenger være nok alene - den sendes bare som apikey-header.
// Returnerer en vanlig Response, akkurat som fetch(), så hvert kallsted beholder sin egen
// parsing/feilhåndtering. Body må kunne sendes to ganger (streng/JSON, ikke en stream) siden
// et 401 gir ÉN fornyelse av sesjonen og ÉTT nytt forsøk - aldri flere (ingen løkke).
// Supabase-porten (verify_jwt) avviser et ugyldig/utløpt JWT med 401 FØR funksjonen kjører,
// så 401 er det vanlige tegnet på utløpt sesjon. Kaster (og viser toast) hvis det ikke
// finnes noen sesjon i det hele tatt - alle kallstedene har try/catch eller .catch().
// `stille` (s00-022 punkt 3) - for kall som er rene bakgrunnsvarsler (send-push-kallene i
// timer.js/lager.js/arkiv-mer.js) der kalleren allerede har sin egen .catch() og en feilende
// toast bare forvirrer en ansatt som ikke selv ba om noe. `navigator.onLine` brukes til å
// skille "faktisk ikke innlogget" fra "bare offline akkurat nå" - uten det viste et vanlig
// nettbrudd samme skremmende "logg inn på nytt"-melding som en reelt utløpt sesjon.
// typeof-vakt siden `navigator` ikke finnes i de isolerte vm-testmiljøene (se
// test/edge-fetch-og-utlogging.test.js) - i en ekte nettleser finnes den alltid.
function erOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }
let edgeFetchAktive = 0;
async function edgeFetch(funksjon, init = {}, { stille = false } = {}) {
  edgeFetchAktive++;
  try {
    const url = `${SUPA_URL}/functions/v1/${funksjon}`;
    const hentToken = async (fornyet) => {
      if (!db) return null;
      const { data } = fornyet ? await db.auth.refreshSession() : await db.auth.getSession();
      return data?.session?.access_token || null;
    };
    const kall = (token) => {
      // Headers (ikke et vanlig objekt) slik at en Authorization fra kalleren, uansett store/små
      // bokstaver, alltid erstattes av ansatt-token-et i stedet for å bli sendt ved siden av.
      const headers = new Headers(init.headers);
      headers.set('Authorization', 'Bearer ' + token);
      headers.set('apikey', SUPA_KEY);
      return fetch(url, { ...init, headers });
    };

    let token = null;
    try { token = await hentToken(false); } catch(e) { console.warn('Kunne ikke hente sesjon:', e); }
    if (!token) {
      const melding = erOffline()
        ? 'Ingen nettforbindelse akkurat nå - prøv igjen når du er tilkoblet'
        : 'Du er ikke innlogget - logg inn på nytt';
      if (!stille) visToast(melding);
      throw new Error(melding);
    }

    let res = await kall(token);
    if (res.status !== 401) return res;

    let nyttToken = null;
    try { nyttToken = await hentToken(true); } catch(e) { console.warn('Sesjonsfornyelse feilet:', e); }
    if (nyttToken) res = await kall(nyttToken);
    if (res.status === 401 && !stille) {
      visToast(erOffline()
        ? 'Ingen nettforbindelse akkurat nå - prøv igjen når du er tilkoblet'
        : 'Innloggingen din er utløpt eller ugyldig - logg ut og inn igjen');
    }
    return res;
  } finally {
    edgeFetchAktive--;
  }
}

// Delt av dokDrop() (ordre-diverse.js) og fullmaktDrop() (ansatte-utstyr.js) - begge gjorde
// tidligere INGENTING (ingen toast, ingen feilmelding) når en drag-og-slipp ikke inneholdt
// noen faktisk fil, noe som så ut som appen "hang" fremfor at noe faktisk feilet. Vanligste
// årsak (bekreftet 2026-10-22, se kildene i samtalen): den nye Outlook-appen blokkerer å dra
// vedlegg direkte fra en e-post inn i nettlesere - en Microsoft-side begrensning som gjelder
// alle nettsider, ikke noe som kan rettes i denne appens kode. Eneste praktiske løsning er å
// lagre vedlegget til disk først.
function visTomDropToast() {
  visToast('Fant ingen fil i det du dro inn. Vanligste årsak: den nye Outlook-appen tillater ikke å dra vedlegg direkte fra en e-post til en nettside - lagre vedlegget på datamaskinen først, og dra/velg den lagrede filen i stedet.');
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
  {id:'hentet',         lbl:'Hentet',               border:'#2dd4bf', bg:'#03302888', txt:'#99f6e4'},
];
function statusInfo(id) { return STATUSER.find(s=>s.id===id) || STATUSER[1]; }
// rolle lagres/sammenlignes alltid med små bokstaver (ansatt/godkjenner/admin) - denne
// er KUN for visning, rører aldri selve verdien noe sted den brukes i logikk/sammenligning.
function rolleVis(rolle) { return rolle ? rolle.charAt(0).toUpperCase() + rolle.slice(1) : ''; }
const STATUS_SORT = {hentet:0,klar_henting:2,vist_biltilsyn:3,klar_visning:4,ikke_veid:5,paabegynt:6,ikke_paabegynt:7,paa_vei:8};
// "Bestilt frakt" er ikke lenger en verdi i ordreStatus-nedtrekkslisten (bedt om av Henrik
// 2026-09-30: den krevde et manuelt valg som lett ble glemt, og "stjal" plassen til den
// faktiske statusen). I stedet en uavhengig markering PÅ ordren - samme mønster som
// `prioritert` (kantlinje+merkelapp på ordrekortet, se BESTILT_FRAKT_BADGE_FARGE/
// bestiltFraktBadgeHTML() og oversikt-kalender.js) - satt automatisk når frakt bestilles
// på e-post fra Admin-ark (js/admin-ark.js). henteKlarDato er en valgfri dato valgt i
// samme dialog, brukt i badge-teksten OG til å sortere listene under (mest hastverk øverst).
const BESTILT_FRAKT_BADGE_FARGE = '#a78bfa';
// Skjules når ordren faktisk er hentet (bedt om av Henrik 2026-10-01) - badgen/kant-
// fargen er bare relevant mens man venter på henting, ikke lenger når det faktisk har
// skjedd (bestiltFrakt-flagget på ordren røres ikke, kun selve visningen). Samme regel
// styrer filteret «Bestilt frakt» i Ordre-lista (oversikt-kalender.js), så lista viser
// akkurat de kortene som har merket.
function erBestiltFraktAktiv(o) { return !!o.bestiltFrakt && o.ordreStatus !== 'hentet'; }
function bestiltFraktBadgeHTML(o, offsetCss) {
  if (!erBestiltFraktAktiv(o)) return '';
  const tekst = o.henteKlarDato ? `HENTEKLAR ${fmtDatoKort(o.henteKlarDato)}` : 'BESTILT FRAKT';
  return `<span style="position:absolute;top:-9px;${offsetCss};background:#18181b;padding:0 6px;font-size:10px;font-weight:700;color:${BESTILT_FRAKT_BADGE_FARGE};letter-spacing:.03em">${tekst}</span>`;
}
// Ordre som kom fra Forhandlerportalen (Bestill-knappen): «PORTAL» (blå) når Salmakerverksted har bekreftet, og «PORTAL · IKKE BEKREFTET» (gul/amber)
// til en ansatt har sett over chassis.nr og trykket Bekreft i ordredetaljen. Selve merket er KUN visning og står i kortets egen rad (ikke absolutt-
// posisjonert: hjørnene er opptatt av PRIORITERT og BESTILT FRAKT). `kort` gir bare «PORTAL» (fargen viser fortsatt bekreftet/ikke): brukes i ordredetaljens smale
// høyrekolonne, der en lang tekst kunne presse chassis.nr smalere enn 17 tegn på en liten telefon (banneret sier «ikke bekreftet» tydelig der). erUbekreftetPortalOrdre
// brukes også av filteret «Fra portal, ikke bekreftet».
function erUbekreftetPortalOrdre(o) { return !!o.portalBestillingId && !o.portalBekreftetAt; }
function portalBadgeHTML(o, kort) {
  if (!o.portalBestillingId) return '';
  const ubekreftet = !o.portalBekreftetAt;
  const stil = ubekreftet
    ? 'background:#1c1008;border:1px solid #b45309;color:#fbbf24'
    : 'background:#172554;border:1px solid #1d4ed8;color:#93c5fd';
  const tittel = ubekreftet ? 'Bestilt i Forhandlerportalen - ikke bekreftet av Salmakerverksted ennå' : 'Bestilt i Forhandlerportalen' + (o.portalBekreftetAv ? ' - bekreftet av ' + esc(o.portalBekreftetAv) : '');
  return `<span title="${tittel}" style="display:inline-flex;align-items:center;${stil};border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:.03em;white-space:nowrap">${ubekreftet && !kort ? 'PORTAL · IKKE BEKREFTET' : 'PORTAL'}</span>`;
}
function sorterOrdre(a,b) {
  const pd = (b.prioritert?1:0) - (a.prioritert?1:0);
  if (pd !== 0) return pd;
  // Henteklar-dato (valgt ved fraktbestilling) sorteres nærmeste dato først - mest
  // hastverk øverst. Ordre uten dato havner etter de som har en.
  if (a.henteKlarDato && b.henteKlarDato) {
    const hd = a.henteKlarDato.localeCompare(b.henteKlarDato);
    if (hd !== 0) return hd;
  } else if (a.henteKlarDato && !b.henteKlarDato) return -1;
  else if (!a.henteKlarDato && b.henteKlarDato) return 1;
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
let S  = {ansatte:[], ordrer:[], timer:[], flater:[], dagensPIN:'1234', nextId:100, gps:{lat:null,lng:null,radius:300}, beskjeder:[], kontakter:[], utstyrMaler:[], drivstoffSatser:[], moter:[], godkjennerMeldinger:[], hmsAvvik:[], hmsRisikovurderinger:[], hmsStoffkartotek:[], hmsVernerunder:[], hmsVernerundeMal:null, hmsHandbok:null};
let me = null;
// Satt av et klikk på et push-varsel om en bestemt ordre (postMessage fra sw.js) - kan
// komme inn før innlogging/datahenting er ferdig, derfor mellomlagres den her og
// hentes ut av apneOrdreFraVarselHvisKlar() når S.ordrer faktisk er klar.
let pendingDeepLinkOrdreId = null;
function apneOrdreFraVarselHvisKlar() {
  if (!pendingDeepLinkOrdreId || !me || !S.ordrer.length) return;
  const id = pendingDeepLinkOrdreId;
  pendingDeepLinkOrdreId = null;
  if (S.ordrer.find(o => o.id === id)) openOrdre(id);
}
let activeOrdreId = null;
let openedFromArkiv = false;
const ignorerRealtimeFor = new Set(); // ordre-ID-er vi nettopp lagret
const ignorerRealtimeAnsatt = new Set(); // ansatt-ID-er vi nettopp lagret
const ignorerRealtimeAdminArk = new Set(); // admin_ark-ID-er vi nettopp lagret
const ignorerRealtimeFlate = new Set(); // flate-ID-er vi nettopp lagret
const ignorerRealtimeTimer = new Set(); // timer_entries-ID-er vi nettopp lagret
let ignorerRealtimeInnstillinger = false; // innstillinger er én rad - enkelt flagg holder
let ignorerRealtimeInnstillingerTimer = null;
let flyttOrdreId  = null;
let timerStart    = null;
let timerType     = 'normal';
let timerTick     = null;
let timerPINMode  = 'gps'; // 'gps' eller 'manuell'
let ordreTimerTicks = {}; // nøkkel: felt+'_'+ordreId - to uavhengige tidtakere kan gå samtidig på samme ordre
let calWeekOffset = 0;

// ════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loadingOverlay').style.display = 'flex';
  try {
    db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    // En vanlig utlogging i ÉN fane/PWA-vindu avslutter Auth-sesjonen for HELE enheten (samme
    // localStorage), men andre åpne faner/vinduer visste ikke om det (funnet i sikkerhets-
    // gjennomgangen 29.10, s00-022 punkt 4) - PIN-bytte hadde allerede sin egen varsling via
    // innstillinger-sanntid over, men en vanlig utlogging hadde ingen tilsvarende. Supabase sin
    // egen onAuthStateChange fanger SIGNED_OUT på tvers av faner (via localStorage-hendelsen
    // supabase-js lytter på). `me` er allerede null i fanen som selv logget ut (se utforLogout,
    // som nuller den FØR selve signOut-kallet) - denne håndteringen rammer derfor kun de ANDRE.
    // typeof-vakt: den falske test-klienten (vm-testmiljøet) har ikke onAuthStateChange.
    if (typeof db.auth.onAuthStateChange === 'function') {
      db.auth.onAuthStateChange((event) => {
        // Kaller IKKE doLogout()/avsluttSesjon() her - sesjonen er allerede avsluttet et
        // annet sted (derav SIGNED_OUT), så et nytt logg_ut/signOut-kall herfra ville bare
        // vært et virkningsløst, forvirrende dobbelt-kall mot en allerede død sesjon.
        if (event === 'SIGNED_OUT' && me) {
          visToast('Du ble logget ut i en annen fane/økt på denne enheten');
          nullstillLokalOkt();
          sikkerReload();
        }
      });
    }
    // Anonym Auth-sesjon kreves for at databasen (RLS + Realtime) skal vite
    // hvem som spør. Selve identiteten (hvilken ansatt) knyttes først etter
    // riktig PIN i tryLogin() - uten en PIN er denne sesjonen ikke koblet
    // til noen ansatt og RLS slipper den ikke til noe som helst.
    await sikreAnonymSesjon();
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
    S.standardtider    = S.standardtider    || {};
    S.hmsAvvik             = S.hmsAvvik             || [];
    S.hmsRisikovurderinger = S.hmsRisikovurderinger || [];
    S.hmsStoffkartotek     = S.hmsStoffkartotek     || [];
    S.hmsVernerunder       = S.hmsVernerunder       || [];
    S.hmsVernerundeMal     = S.hmsVernerundeMal     || null;
    S.hmsHandbok           = S.hmsHandbok           || null;
    S.flater           = S.flater           || [];
    S.lagervarer       = S.lagervarer       || [];
    S.lagerhistorikk   = S.lagerhistorikk   || [];
    S.lagerOppskrifter = S.lagerOppskrifter || [];
    S.adminArk         = S.adminArk         || [];
    S.moter            = S.moter            || [];
    S.godkjennerMeldinger = S.godkjennerMeldinger || [];
    S.ordrer = (S.ordrer||[]).map(o => ({
      ...o,
      utstyrSjekkliste:   o.utstyrSjekkliste   || [],
      utstyrMalNavn:      o.utstyrMalNavn       || '',
      visningsSjekkliste: o.visningsSjekkliste  || [],
      visningsMalNavn:    o.visningsMalNavn      || '',
      bilderAnkomst:      o.bilderAnkomst        || [null,null,null,null,null,null],
      bilderLevering:     o.bilderLevering       || [null,null,null,null,null,null],
      bilderAvstandSkader: o.bilderAvstandSkader || [null,null,null],
      bilderManglendeDeler: o.bilderManglendeDeler || [],
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
  S.ansatte   = (aR.data||[]).map(a=>({...a, kanForeLonn: a.kan_fore_lonn !== false, stempletInnSiden: a.stemplet_inn_siden||null}));
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
    S.standardtider  = sR.data?.standardtider   || {};
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
  // Flåter hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett).
  // Feil logges (men sluker ikke unntaket) - disse tabellene finnes i produksjon nå, så en
  // feil her er ikke lenger "forventet", og ble tidligere helt usynlig (rapportert av
  // Henrik 2026-10-01: Admin-ark tomt for én spesifikk admin, ingen feil å se noe sted).
  try {
    const fR = await db.from('flater').select('*').order('created_at');
    if (!fR.error) S.flater = (fR.data||[]).map(dbToFlate);
    else console.error('Feil ved henting av flater:', fR.error);
  } catch(e) { console.error('Feil ved henting av flater:', e); }
  // Varelager hentes for seg selv - tabellene finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const [lvR, lhR, loR] = await Promise.all([
      db.from('lagervarer').select('*').order('navn'),
      db.from('lagerhistorikk').select('*').order('created_at', {ascending:false}).limit(500),
      db.from('lager_oppskrifter').select('*').order('navn')
    ]);
    if (!lvR.error) S.lagervarer = (lvR.data||[]).map(dbToLagervare);
    else console.error('Feil ved henting av lagervarer:', lvR.error);
    if (!lhR.error) S.lagerhistorikk = (lhR.data||[]).map(dbToLagerhistorikk);
    else console.error('Feil ved henting av lagerhistorikk:', lhR.error);
    if (!loR.error) S.lagerOppskrifter = (loR.data||[]).map(dbToLagerOppskrift);
    else console.error('Feil ved henting av lager_oppskrifter:', loR.error);
  } catch(e) { console.error('Feil ved henting av varelager:', e); }
  // Admin-ark hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const aaR = await db.from('admin_ark').select('*');
    if (!aaR.error) S.adminArk = (aaR.data||[]).map(dbToAdminArkRad);
    else console.error('Feil ved henting av admin_ark:', aaR.error);
  } catch(e) { console.error('Feil ved henting av admin_ark:', e); }
  // Møter hentes for seg selv - tabellen finnes kanskje ikke ennå (krever eget SQL-oppsett)
  try {
    const mR = await db.from('moter').select('*').order('dato').order('tid');
    if (!mR.error) S.moter = (mR.data||[]).map(dbToMote);
    else console.error('Feil ved henting av moter:', mR.error);
  } catch(e) { console.error('Feil ved henting av moter:', e); }
  // Chat mellom admin/godkjennere - RLS skjuler raden helt for andre roller, så et
  // avslag her er normalt (ikke logges som feil) hvis innlogget ansatt er vanlig ansatt.
  try {
    const gR = await db.from('godkjenner_meldinger').select('*').order('created_at');
    if (!gR.error) S.godkjennerMeldinger = (gR.data||[]).map(dbToGodkjennerMelding);
  } catch(_) {}
  // HMS - tabellene finnes kanskje ikke ennå (krever eget SQL-oppsett, se migrasjon 20261030150000)
  try {
    const [havR, hriR, hstR, hvmR, hvgR, hhbR] = await Promise.all([
      db.from('hms_avvik').select('*').order('created_at', {ascending:false}),
      db.from('hms_risikovurdering').select('*').order('created_at', {ascending:false}),
      db.from('hms_stoffkartotek').select('*').order('produktnavn'),
      db.from('hms_vernerunde_mal').select('*').eq('id', 1).maybeSingle(),
      db.from('hms_vernerunde_gjennomforing').select('*').order('dato', {ascending:false}),
      db.from('hms_handbok').select('*').eq('id', 1).maybeSingle()
    ]);
    if (!havR.error) S.hmsAvvik = (havR.data||[]).map(dbToHmsAvvik);
    else console.error('Feil ved henting av hms_avvik:', havR.error);
    if (!hriR.error) S.hmsRisikovurderinger = (hriR.data||[]).map(dbToHmsRisiko);
    else console.error('Feil ved henting av hms_risikovurdering:', hriR.error);
    if (!hstR.error) S.hmsStoffkartotek = (hstR.data||[]).map(dbToHmsStoff);
    else console.error('Feil ved henting av hms_stoffkartotek:', hstR.error);
    if (!hvmR.error) S.hmsVernerundeMal = hvmR.data ? dbToHmsVernerundeMal(hvmR.data) : null;
    else console.error('Feil ved henting av hms_vernerunde_mal:', hvmR.error);
    if (!hvgR.error) S.hmsVernerunder = (hvgR.data||[]).map(dbToHmsVernerundeGjennomforing);
    else console.error('Feil ved henting av hms_vernerunde_gjennomforing:', hvgR.error);
    if (!hhbR.error) S.hmsHandbok = hhbR.data ? dbToHmsHandbok(hhbR.data) : null;
    else console.error('Feil ved henting av hms_handbok:', hhbR.error);
  } catch(e) { console.error('Feil ved henting av HMS-data:', e); }
}

function dbToOrdre(r) {
  const dv = {totalvekt:{a:'',e:'',v:''},vogntog:{a:'',e:'',v:''},foraksel:{a:'',e:'',v:''},bakaksel:{a:'',e:'',v:''}};
  return {
    id:r.id, regnr:r.regnr, kunde:r.kunde||'', eier:r.eier||'',
    ombygging:r.ombygging||{nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false},
    merke:r.merke||'', type:r.type||'', modell:r.modell||'', variant:r.variant||'', versjon:r.versjon||'', chassis:r.chassis||'', farge:r.farge||'',
    ankomstdato:r.ankomstdato||'', status:r.status||'aktiv',
    ordreStatus:r.ordre_status||'ikke_paabegynt',
    kalenderDato:r.kalender_dato||'', kalenderTid:r.kalender_tid||'',
    vekter:r.vekter||dv, drivstoff:r.drivstoff||{totalpris:'',satsId:''},
    utstyr:r.utstyr||{har:'',skalHa:'',hengerfeste:'ikke_hengerfeste',hengerfesteMontert:'ikke_montert',hengerfesteBestilt:'ikke_bestilt',skalHaBekreftet:false},
    bilderAnkomst:r.bilder_ankomst||[null,null,null,null,null,null],
    bilderLevering:r.bilder_levering||[null,null,null,null,null,null],
    bilderAvstandSkader:r.bilder_avstand_skader||[null,null,null],
    bilderManglendeDeler:r.bilder_manglende_deler||[],
    ansatteSignert:r.ansatte_signert||[], signatur:r.signatur||null,
    godkjent:r.godkjent||false, godkjennerNavn:r.godkjenner_navn||'',
    diagnose:r.diagnose||false, diagnoseAv:r.diagnose_av||'',
    fakturert:r.fakturert||false, fakturertAv:r.fakturert_av||'',
    ordreStart:r.ordre_start||null, ordreStopp:r.ordre_stopp||null,
    ordreTimerSessions:r.ordre_timer_sessions||[], klargjoringTimerSessions:r.klargjoring_timer_sessions||[],
    fikenLinjer:r.fiken_linjer||[],
    notater:r.notater||'', endringer:r.endringer||[],
    utstyrSjekkliste:r.utstyr_sjekkliste||[], utstyrMalNavn:r.utstyr_mal_navn||'',
    visningsSjekkliste:r.visnings_sjekkliste||[], visningsMalNavn:r.visnings_mal_navn||'',
    flateId:r.flate_id||null, prioritert:!!r.prioritert, dokumenter:r.dokumenter||[],
    coc:r.coc||'har_ikke', fullmakt:r.fullmakt||'har_ikke', godkjentBiltilsyn:!!r.godkjent_biltilsyn,
    tidBiltilsynet:r.tid_biltilsynet||'', tidBiltilsynetTid:r.tid_biltilsynet_tid||'', tidBiltilsynetSted:r.tid_biltilsynet_sted||'',
    datoKlarHenting:r.dato_klar_henting||'',
    typegodkjenning:r.typegodkjenning||'', egenvektCoc:r.egenvekt_coc||'', forhandlerOrgnr:r.forhandler_orgnr||'',
    vegvesenFingerprint:r.vegvesen_fingerprint||null,
    bestiltFrakt:!!r.bestilt_frakt, henteKlarDato:r.hente_klar_dato||'',
    kjoreseddelSkilt:r.kjoreseddel_skilt||'',
    fikenKladdUrl:r.fiken_kladd_url||'',
    // Bestilling fra Forhandlerportalen (se supabase/migrations/20261030200000_portal_bestilling_grunnlag.sql). Disse tre kolonnene LESES bare her og står
    // bevisst IKKE i ordreToDb(): en ansatt som lagrer et annet felt kan aldri nullstille bekreftelsen. De settes bare av koblingsfunksjonen i databasen
    // (portal_koble_bestilling) og av portal_bekreft_ordre / portal_avvis_ordre.
    portalBestillingId:r.portal_bestilling_id||null, portalBekreftetAt:r.portal_bekreftet_at||null, portalBekreftetAv:r.portal_bekreftet_av||''
  };
}
function ordreToDb(o) {
  return {
    id:o.id, regnr:o.regnr, kunde:o.kunde, eier:o.eier,
    ombygging:o.ombygging||{nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false},
    merke:o.merke||'', type:o.type||'', modell:o.modell||'', variant:o.variant||'', versjon:o.versjon||'', chassis:o.chassis, farge:o.farge||'', ankomstdato:o.ankomstdato||null,
    status:o.status, ordre_status:o.ordreStatus||'ikke_paabegynt',
    kalender_dato:o.kalenderDato||null, kalender_tid:o.kalenderTid,
    vekter:o.vekter, drivstoff:o.drivstoff, utstyr:o.utstyr,
    bilder_ankomst:o.bilderAnkomst, bilder_levering:o.bilderLevering, bilder_avstand_skader:o.bilderAvstandSkader,
    bilder_manglende_deler:o.bilderManglendeDeler,
    ansatte_signert:o.ansatteSignert, signatur:o.signatur||null,
    godkjent:o.godkjent, godkjenner_navn:o.godkjennerNavn,
    diagnose:o.diagnose||false, diagnose_av:o.diagnoseAv||'',
    fakturert:o.fakturert, fakturert_av:o.fakturertAv,
    ordre_start:o.ordreStart, ordre_stopp:o.ordreStopp,
    ordre_timer_sessions:o.ordreTimerSessions||[], klargjoring_timer_sessions:o.klargjoringTimerSessions||[],
    fiken_linjer:o.fikenLinjer||[],
    notater:o.notater, endringer:o.endringer,
    utstyr_sjekkliste:o.utstyrSjekkliste||[], utstyr_mal_navn:o.utstyrMalNavn||'',
    visnings_sjekkliste:o.visningsSjekkliste||[], visnings_mal_navn:o.visningsMalNavn||'',
    flate_id:o.flateId||null,
    coc:o.coc||'har_ikke', fullmakt:o.fullmakt||'har_ikke',
    typegodkjenning:o.typegodkjenning||'', egenvekt_coc:o.egenvektCoc||'', forhandler_orgnr:o.forhandlerOrgnr||'',
    kjoreseddel_skilt:o.kjoreseddelSkilt||null,
    updated_at:new Date().toISOString()
  };
}
function dbToFlate(r) {
  return { id:r.id, flatenummer:r.flatenummer||'', kunde:r.kunde||'', status:r.status||'aktiv', primaerOrdreId:r.primaer_ordre_id||null, createdAt:r.created_at||'', vegvesenFingerprint:r.vegvesen_fingerprint||null };
}
function dbToLagervare(r) {
  return { id:r.id, navn:r.navn||'', kategori:r.kategori||'', modell:r.modell||'', tegningsnummer:r.tegningsnummer||'', leverandor:r.leverandor||'', kostpris:r.kostpris==null?null:Number(r.kostpris), antall:Number(r.antall)||0, enhet:r.enhet||'stk', minAntall:Number(r.min_antall)||0, notat:r.notat||'', bestilt:!!r.bestilt, rekkefolge:Number(r.rekkefolge)||0, createdAt:r.created_at||'' };
}
function dbToLagerhistorikk(r) {
  return { id:r.id, vareId:r.vare_id, vareNavn:r.vare_navn||'', endring:Number(r.endring)||0, type:r.type||'justering', ordreId:r.ordre_id||null, batchId:r.batch_id||null, oppskriftId:r.oppskrift_id||null, ansattNavn:r.ansatt_navn||'', kommentar:r.kommentar||'', createdAt:r.created_at||'' };
}
function dbToLagerOppskrift(r) {
  return { id:r.id, navn:r.navn||'', biltype:r.biltype||'', type:r.type||'ombygging', ingredienser:r.ingredienser||[], fikenProduktnummer:r.fiken_produktnummer||'', kostpris:r.kostpris||0, createdAt:r.created_at||'' };
}
function dbToAdminArkRad(r) {
  return { id:r.id, chassisNr:r.chassis_nr||'', aar:Number(r.aar)||0, rekkefolge:Number(r.rekkefolge)||0,
    forhandler:r.forhandler||'', kontaktperson:r.kontaktperson||'',
    serienummer:r.serienummer||'', mottatt:!!r.mottatt, papirer:r.papirer||'', dokumenter:!!r.dokumenter, fraktselskap:r.fraktselskap||'',
    bestiltFrakt:!!r.bestilt_frakt, hentetVarslet:!!r.hentet_varslet, utstyr:r.utstyr||'',
    merknader:r.merknader||'', flateHypotetisk:r.flate_hypotetisk||'', timeBekreftet:r.time_bekreftet||'', timeBekreftetTid:r.time_bekreftet_tid||'', timeBekreftetSted:r.time_bekreftet_sted||'', ventendeTimer:r.ventende_timer||'', arkivert:!!r.arkivert };
}
function dbToMote(r) {
  return { id:r.id, tittel:r.tittel||'', dato:r.dato||'', tid:r.tid||'', opprettetAv:r.opprettet_av||'', varslet:!!r.varslet, deltakerIder:r.deltaker_ider||[], type:r.type||'møte' };
}
function dbToGodkjennerMelding(r) {
  return { id:r.id, avsenderId:r.avsender_id, avsenderNavn:r.avsender_navn||'', tekst:r.tekst||'', createdAt:r.created_at||'' };
}
function dbToTimer(r) {
  return {id:r.id,ansattId:r.ansatt_id,ansatt:r.ansatt,dato:r.dato,
    type:r.type,start:r.start||r.start_tid||'',stopp:r.stopp||r.stopp_tid||'',mins:r.mins||r.minutter||0,
    betalt:r.betalt!==false,egenmeldingPeriodeId:r.egenmelding_periode_id||null,
    sykemeldingLevert:!!r.sykemelding_levert};
}

let realtimeChannel = null;
let realtimeReconnectTimer = null;
// Persisteres i localStorage (ikke bare denne JS-øktens levetid) - en enhet som
// restarter/laster appen på nytt midt i en gjenoppkoblings-runde (f.eks. en tablet med
// ustabil WiFi som restarter seg selv, eller en PWA OS-en dreper og relanserer i
// bakgrunnen) startet ellers ALLTID tilbake på det RASKESTE forsøket (1 sek) igjen og
// igjen, i stedet for å faktisk nå frem til et rolig nivå - bekreftet reell hendelse
// 2026-10-22: ca. 2,7 MILLIONER gjenoppkoblinger (hver med en full nedlasting av hele
// datasettet) over 43 dager, et snitt på under 1,5 sekund mellom hver - mye raskere enn
// den tiltenkte backoff-en alene skulle tillate selv i verste fall. Resulterte i en
// egress-regning på over 1,9 PETABYTE på et datasett som til sammen er noen få MB.
// Verdien forfaller (nullstilles) av seg selv etter 10 minutter uten noen ny feil - en
// ekte, varig gjenopprettet forbindelse skal ikke holde enheten tilbake for alltid.
//
// OPPDATERT 2026-10-28: 5-minutters-taket over var IKKE nok til å stoppe kostnaden helt -
// Supabase bekreftet fortsatt ~54 GB egress/døgn to dager senere. En enhet som ALDRI klarer
// å holde en stabil forbindelse (ikke bare midlertidig ustabil) fortsatte å gjøre en full
// nedlasting hvert eneste 5. minutt i det UENDELIGE (288 ganger/døgn × ~188 MB ≈ nøyaktig de
// 54 GB-ene Supabase målte). Lagrer derfor nå også tidspunktet for FØRSTE feil i en
// sammenhengende feil-rekke - har den vart over 60 minutter, gir vi opp den automatiske
// bakgrunns-gjenoppkoblingen helt (REALTIME_GIVE_UP_MS under). Enheten faller da tilbake på
// den vanlige "oppdater når fanen kommer i forgrunnen"-logikken (se visibilitychange under),
// som uansett kun trigges av faktisk bruk - ikke en enhet som flapper alene i bakgrunnen uten
// noen bruker til stede.
const REALTIME_BACKOFF_KEY = 'realtimeBackoff_v1';
const REALTIME_GIVE_UP_MS = 60 * 60 * 1000;
function lesRealtimeBackoff() {
  try {
    const raw = localStorage.getItem(REALTIME_BACKOFF_KEY);
    if (!raw) return { forsok: 0, forsteFeil: 0 };
    const { forsok, tid, forsteFeil } = JSON.parse(raw);
    if (!forsok || Date.now() - tid > 10 * 60 * 1000) return { forsok: 0, forsteFeil: 0 };
    return { forsok, forsteFeil: forsteFeil || tid };
  } catch(e) { return { forsok: 0, forsteFeil: 0 }; }
}
function lagreRealtimeBackoff(forsok, forsteFeil) {
  try {
    if (!forsok) { localStorage.removeItem(REALTIME_BACKOFF_KEY); return; }
    localStorage.setItem(REALTIME_BACKOFF_KEY, JSON.stringify({ forsok, tid: Date.now(), forsteFeil }));
  } catch(e) {}
}
let { forsok: realtimeReconnectForsok, forsteFeil: realtimeForsteFeil } = lesRealtimeBackoff();
// Nullstilles kun etter at forbindelsen har stått STABIL en liten stund (se
// subscribeRealtime() sin 'SUBSCRIBED'-håndtering under) - en forbindelse som lykkes helt
// kort og så umiddelbart feiler igjen ("flapper") skal IKKE få lov til å nullstille
// backoff-nivået og dermed starte helt forfra på 1 sek, som i praksis opphevet hele
// backoff-mekanismen ved akkurat denne typen ustabil tilkobling.
let realtimeStabilTimer = null;

// Flere Realtime-hendelser (f.eks. et flerrads-lagre et annet sted gjør, som sender én
// hendelse PER rad selv om skrivingen var samlet i ett databasekall) kom tidligere rett
// etter hverandre og trigget et fullt renderAll()/renderAdminArk() PER hendelse - fem
// fulle sider tegnet på nytt fem ganger på rad for fem rader endret i samme handling.
// Disse samler i stedet en kort byge med hendelser til ÉN rendering etterpå - selve
// tilstands-oppdateringen (S.ordrer[i]=... osv.) skjer fortsatt umiddelbart og synkront
// for hver hendelse, kun selve den kostbare tegningen er utsatt. Funnet i gjennomgang av
// "appen føles treig" 2026-10-08.
let _renderAllTimer = null;
function planleggRenderAll() {
  clearTimeout(_renderAllTimer);
  _renderAllTimer = setTimeout(renderAll, 150);
}
let _renderAdminArkTimer = null;
function planleggRenderAdminArk() {
  clearTimeout(_renderAdminArkTimer);
  _renderAdminArkTimer = setTimeout(() => renderAdminArk(), 150);
}

function subscribeRealtime() {
  if (!db) return;
  if (realtimeReconnectTimer) { clearTimeout(realtimeReconnectTimer); realtimeReconnectTimer = null; }
  clearTimeout(realtimeStabilTimer);
  if (realtimeChannel) { try { db.removeChannel(realtimeChannel); } catch(_){} realtimeChannel = null; }

  realtimeChannel = db.channel('salmakern_live')
    .on('postgres_changes',{event:'*',schema:'public',table:'ordrer'}, p => {
      if (p.eventType==='INSERT') {
        if (!S.ordrer.find(o=>o.id===p.new.id)) { S.ordrer.push(dbToOrdre(p.new)); planleggRenderAll(); }
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeFor.has(p.new.id)) return;
        const i=S.ordrer.findIndex(o=>o.id===p.new.id);
        if(i>=0){
          S.ordrer[i]=dbToOrdre(p.new);
          planleggRenderAll();
          if(activeOrdreId===p.new.id) buildOrdreDetail();
        }
      } else if (p.eventType==='DELETE') {
        S.ordrer = S.ordrer.filter(o=>o.id!==p.old.id);
        if (activeOrdreId===p.old.id) tilbakeOrdreList();
        planleggRenderAll();
      }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'ansatte'}, p => {
      const mapA = a => ({...a, kanForeLonn: a.kan_fore_lonn !== false, stempletInnSiden: a.stemplet_inn_siden||null});
      if (p.eventType==='INSERT') {
        if (!S.ansatte.find(a=>a.id===p.new.id)) S.ansatte.push(mapA(p.new));
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeAnsatt.has(String(p.new.id))) return;
        const i=S.ansatte.findIndex(a=>a.id===p.new.id); if(i>=0) S.ansatte[i]=mapA(p.new);
      } else if (p.eventType==='DELETE') {
        S.ansatte = S.ansatte.filter(a=>a.id!==p.old.id);
      }
      if(me) { renderMer(); if (typeof renderStempletInnNa==='function') renderStempletInnNa(); }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'timer_entries'}, p => {
      if (p.eventType==='INSERT') {
        if (!S.timer.find(t=>t.id===p.new.id)) S.timer.unshift(dbToTimer(p.new));
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeTimer.has(String(p.new.id))) return;
        const i=S.timer.findIndex(t=>t.id===p.new.id); if(i>=0) S.timer[i]=dbToTimer(p.new);
      } else if (p.eventType==='DELETE') {
        S.timer = S.timer.filter(t=>t.id!==p.old.id);
      }
      planleggRenderAll();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'flater'}, p => {
      S.flater = S.flater || [];
      if (p.eventType==='INSERT') {
        if (!S.flater.find(f=>f.id===p.new.id)) S.flater.push(dbToFlate(p.new));
      } else if (p.eventType==='UPDATE') {
        if (ignorerRealtimeFlate.has(String(p.new.id))) return;
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
      if (document.getElementById('admin')?.classList.contains('active')) planleggRenderAdminArk();
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
      if (me) planleggRenderAll();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'godkjenner_meldinger'}, p => {
      S.godkjennerMeldinger = S.godkjennerMeldinger || [];
      if (p.eventType==='INSERT') {
        if (!S.godkjennerMeldinger.find(m=>m.id===p.new.id)) S.godkjennerMeldinger.push(dbToGodkjennerMelding(p.new));
      } else if (p.eventType==='DELETE') {
        S.godkjennerMeldinger = S.godkjennerMeldinger.filter(m=>m.id!==p.old.id);
      }
      if (me && (me.rolle==='admin'||me.rolle==='godkjenner')) renderGodkjennerChat();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'innstillinger'}, p => {
      if (ignorerRealtimeInnstillinger || !p.new) return;
      const row = p.new;
      // Dagens PIN har byttet (enten admin sitt "Ny PIN"-trykk, eller den daglige
      // automatiske rotasjonen ved midnatt) - da skal ALLE andre innloggede logges ut med
      // en gang, ikke bare se en oppdatert PIN de aldri fikk vite om (bedt om av Henrik
      // 2026-09-16: "alle brukerne skal også logge ut automatisk"). Klienten som selv
      // gjorde endringen har allerede ignorerRealtimeInnstillinger satt over, så den
      // rammes ikke av dette - kun alle ANDRE åpne økter.
      const pinByttet = S.dagensPIN && row.dagens_pin && S.dagensPIN !== row.dagens_pin;
      S.dagensPIN = row.dagens_pin || '1234';
      if (pinByttet && me) { visToast('Dagens PIN er byttet - logger ut'); doLogout(true); return; }
      S.gps = {lat: row.gps_lat||null, lng: row.gps_lng||null, radius: row.gps_radius||300};
      S.utstyrMaler = row.utstyr_maler || [];
      S.drivstoffSatser = row.drivstoff_satser || [];
      S.beskjeder = row.beskjeder || [];
      S.kontakter = row.kontakter || [];
      S.standardtider = row.standardtider || {};
      if (me) renderMer();
    })
    .subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        prosesserOfflineKo(); // sanntidskanalen kom opp igjen - sterkt signal om at nettet er tilbake
        // Nullstiller IKKE backoff-nivået med en gang - kun etter at forbindelsen faktisk har
        // stått stabil i 60 sek. En forbindelse som flapper (lykkes kort, feiler igjen med én
        // gang) skal IKKE få lov til å nullstille og dermed starte helt forfra på 1 sek hver
        // gang - se toppkommentaren på REALTIME_BACKOFF_KEY for hvorfor dette er kritisk.
        clearTimeout(realtimeStabilTimer);
        realtimeStabilTimer = setTimeout(() => {
          realtimeReconnectForsok = 0;
          realtimeForsteFeil = 0;
          lagreRealtimeBackoff(0);
        }, 60000);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Sanntid frakoblet:', status, err);
        clearTimeout(realtimeStabilTimer);
        if (!realtimeForsteFeil) realtimeForsteFeil = Date.now();
        // Gir opp den automatiske bakgrunns-gjenoppkoblingen etter 60 min sammenhengende
        // feil (se toppkommentaren på REALTIME_BACKOFF_KEY) - en enhet som aldri stabiliserer
        // seg skal ikke fortsette å laste ned hele datasettet hvert 5. minutt i det uendelige.
        // Faner som faktisk brukes tar seg selv opp igjen via visibilitychange-lytteren under.
        if (Date.now() - realtimeForsteFeil > REALTIME_GIVE_UP_MS) {
          console.warn('Sanntid: gir opp automatisk gjenoppkobling etter 60 min sammenhengende feil');
        } else if (!realtimeReconnectTimer && db && me) {
          // Tak økt fra 30 sek til 5 min 2026-10-22 - 30 sek var ikke nok til å hindre en
          // reell løpsk kostnad (se toppkommentaren på REALTIME_BACKOFF_KEY): en enhet som
          // aldri klarer å koble stabilt til bør IKKE prøve på nytt oftere enn hvert 5.
          // minutt, siden hvert forsøk utløser en full nedlasting av hele datasettet.
          const forsinkelse = Math.min(1000 * Math.pow(2, realtimeReconnectForsok), 300000);
          realtimeReconnectForsok++;
          lagreRealtimeBackoff(realtimeReconnectForsok, realtimeForsteFeil);
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
    merke:'', type:'', modell:'', variant, versjon:'', chassis:'', farge:'',
    ankomstdato: ankomst, status:'aktiv', ordreStatus: startStatus || 'ikke_paabegynt',
    kalenderDato: kDato, kalenderTid: kTid,
    vekter: {
      totalvekt:{a:'',e:'',v:''}, vogntog:{a:'',e:'',v:''},
      foraksel:{a:'',e:'',v:''}, bakaksel:{a:'',e:'',v:''}
    },
    drivstoff:{totalpris:'',satsId:''},
    utstyr:{har, skalHa, hengerfeste:'ikke_hengerfeste', hengerfesteMontert:'ikke_montert', hengerfesteBestilt:'ikke_bestilt', skalHaBekreftet:false},
    bilderAnkomst:[null,null,null,null,null,null],
    bilderLevering:[null,null,null,null,null,null],
    bilderAvstandSkader:[null,null,null],
    bilderManglendeDeler:[],
    ansatteSignert:[], signatur:null,
    godkjent:false, godkjennerNavn:'',
    diagnose:false, diagnoseAv:'',
    fakturert:false, fakturertAv:'',
    ordreStart:null, ordreStopp:null, ordreTimerSessions:[], klargjoringTimerSessions:[],
    fikenLinjer:[],
    notater:'', endringer:[],
    utstyrSjekkliste:[], utstyrMalNavn:'',
    visningsSjekkliste:[], visningsMalNavn:'', prioritert:false,
    bestiltFrakt:false, henteKlarDato:''
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
// localStorage-speilingen av HELE S (alle ordre, arkiv, ansatte, lager, admin-ark osv.) er
// bare en nødløsning for tilfellet der Supabase-oppstarten selv feiler (se catch-blokken i
// init-koden lenger opp, som er eneste sted S noensinne leses TILBAKE fra localStorage) -
// den har ingenting med selve lagringen av ordren å gjøre. Å kjøre JSON.stringify(S) på
// HELE appens datasett synkront på hovedtråden ved HVER ENESTE feltlagring i hele appen
// (60+ kallsteder) var en reell treghetskilde som vokser med mengden data (flere år med
// ordre-arkiv, lagerhistorikk, admin-ark) - uavhengig av hvor liten den ENE ordren som
// faktisk redigeres er. Debounces til 400ms etter siste kall i stedet for å skrive på hvert
// kall - selve Supabase-lagringen under er fortsatt umiddelbar og urørt, kun denne lokale
// nødkopien er utsatt. Funnet i en full gjennomgang av "appen føles treig" 2026-10-08.
let _saveLocalSpeilingTimer = null;
function planleggLocalSpeiling() {
  clearTimeout(_saveLocalSpeilingTimer);
  _saveLocalSpeilingTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch(e) {}
  }, 400);
}
function save(ordreId) {
  planleggLocalSpeiling();
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
  // endringer utelates av samme grunn (lagt til 2026-10-22) - den skrives nå KUN av
  // logChange() sitt eget atomiske RPC-kall (se ordre-detalj.js), ellers kunne denne
  // full-rad-lagringen overskrive en logglinje en ANNEN økt nettopp la til på samme ordre.
  const payload = ordreToDb(o);
  delete payload.status; delete payload.ordre_status;
  delete payload.godkjent; delete payload.godkjenner_navn;
  delete payload.endringer;
  // ansatte_signert/ordre_timer_sessions/klargjoring_timer_sessions/fiken_linjer utelates av
  // samme grunn (lagt til 2026-10-29) - alle fire har sine egne atomiske RPC-kall
  // (oppdater_ordre_ansatt_signert/oppdater_ordre_timer_sesjon/oppdater_ordre_timer_fase/
  // oppdater_ordre_fiken_linje(_ved_id)) som ALLTID brukes for å endre dem (bekreftet - ingen
  // UI-sti muterer disse feltene uten å også kalle riktig RPC). Denne generelle full-rad-
  // lagringen skrev dem likevel med, så en ansatt som lagret et helt urelatert felt (f.eks.
  // farge) fra en litt gammel lokal kopi kunne stille overskrive en fakturalinje, påmelding
  // eller timer-sesjon en ANNEN ansatt nettopp hadde endret via riktig vei - samme rotårsak
  // som status/endringer-kappløpet over.
  delete payload.ansatte_signert; delete payload.ordre_timer_sessions;
  delete payload.klargjoring_timer_sessions; delete payload.fiken_linjer;
  // vekter utelates av samme grunn (lagt til 2026-10-30, s09-005) - har to egne atomiske
  // skrivesteder (oppdater_ordre_vekter_felt() for direkte redigering via sv(), og
  // oppdater_ordre_fra_primaer() for flåte-synkronisering via synkroniserFraPrimaer()) -
  // denne generelle full-rad-lagringen skrev den likevel med fra nettleserens lokale kopi,
  // så en ansatt som lagret et urelatert felt (f.eks. farge) fra en litt gammel kopi kunne
  // stille overskrive en vekt nettopp satt av en av de to atomiske rutene (samme rotårsak
  // som de andre feltene over).
  delete payload.vekter;
  // fiken_kladd_url utelates likeledes (lagt til 2026-10-30, s09-006) - skrives KUN av
  // fiken-fakturer-funksjonen selv, server-side, aldri av klienten.
  delete payload.fiken_kladd_url;
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
  document.querySelectorAll('.pin-dot').forEach((dot,i) => {
    dot.style.background = i < pinBuf.length ? '#ef4444' : '#27272a';
  });
}
async function tryLogin() {
  // PIN-sjekken skjer i databasen (logg_inn_med_pin), ikke lokalt mot
  // S.ansatte - PIN-koder lastes ikke ned til nettleseren i det hele tatt.
  // Funksjonen kobler i tillegg vår anonyme Auth-sesjon til ansatt-raden
  // (via auth.uid()), slik at RLS og Realtime vet hvem som spør etterpå.
  let user = null;
  let forMangeForsok = false;
  let ingenSesjon = false;
  if (db) {
    try {
      // doLogout() avslutter Auth-sesjonen (se utforLogout) - vent til den er ferdig, ellers
      // kunne PIN-en kobles til en sesjon som akkurat da blir slettet, og så startes en NY
      // anonym sesjon her (logg_inn_med_pin krever auth.uid(), se migrasjon 20261029140000).
      if (utloggingPagar) await utloggingPagar;
      if (!(await sikreAnonymSesjon())) {
        ingenSesjon = true;
      } else {
        const { data, error } = await db.rpc('logg_inn_med_pin', { kandidat_pin: pinBuf });
        if (error) {
          console.warn('PIN-sjekk feilet:', error.message);
          if (error.message?.includes('FOR_MANGE_FORSOK')) forMangeForsok = true;
          else if (error.message?.includes('IKKE_INNLOGGET')) ingenSesjon = true;
        }
        else if (data && data.length) user = { ...data[0], kanForeLonn: data[0].kan_fore_lonn !== false };
      }
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
      // Åpnet via ?ordre=<id> i url-en (et push-varsel som måtte åpne et helt nytt
      // vindu/fane, se notificationclick i sw.js) - hopp rett til den ordren, og
      // fjern parameteret så en vanlig omlasting ikke havner der på nytt.
      const varselOrdreId = new URLSearchParams(location.search).get('ordre');
      if (varselOrdreId) {
        pendingDeepLinkOrdreId = varselOrdreId;
        history.replaceState(null, '', location.pathname);
      }
      apneOrdreFraVarselHvisKlar();
    } catch(e) {
      console.warn('Datahenting etter innlogging feilet:', e);
      visToast('Klarte ikke å hente data. Trykk 🔄 øverst for å prøve igjen.');
    }
    document.getElementById('loadingOverlay').style.display = 'none';
  } else {
    document.getElementById('pinErr').textContent = forMangeForsok
      ? 'For mange feilforsøk – vent noen minutter og prøv igjen'
      : ingenSesjon
        ? 'Kunne ikke starte innlogging – sjekk nettet og prøv igjen'
        : 'Feil PIN – prøv igjen';
    pinBuf = '';
    refreshPinDots();
  }
}
// Sørger for at det finnes en Auth-sesjon (anonym). Brukes ved oppstart og rett før PIN-sjekken
// i tryLogin(): logg_inn_med_pin krever auth.uid(), og etter utlogging finnes det bevisst INGEN
// sesjon før neste innlogging - den startes først når noen faktisk taster PIN (ikke ved
// utlogging, så en enhet som står ulogget ikke bruker opp Supabase sin grense for anonyme
// innlogginger per IP). Returnerer true hvis det finnes en sesjon etterpå.
async function sikreAnonymSesjon() {
  const { data: { session } } = await db.auth.getSession();
  if (session) return true;
  const { data, error } = await db.auth.signInAnonymously();
  if (error) { console.warn('Anonym innlogging feilet:', error.message); return false; }
  return !!data?.session;
}

// Løser med 'tidsavbrudd' hvis løftet ikke er ferdig innen ms - brukes slik at en treg
// forbindelse ikke kan henge utloggingen (og dermed neste innlogging) i det uendelige.
function medTidsgrense(lofte, ms) {
  let tid;
  const frist = new Promise(r => { tid = setTimeout(() => r('tidsavbrudd'), ms); });
  return Promise.race([lofte, frist]).finally(() => clearTimeout(tid));
}

// Avslutter innloggingen ordentlig, ikke bare på skjermen. Før dette satt me = null og ingenting
// mer: ansatt-token og refresh-token ble liggende i nettleseren og gjaldt videre (for kontoen med
// flere_enheter ble de aldri ugyldiggjort av en ny innlogging heller). Nå:
//  1. logg_ut() (migrasjon 20261029150000) fjerner ansatt_id/rolle/session_token fra DENNE Auth-
//     brukeren - kun denne enhetens anonyme bruker, aldri ansatte-raden, så andre enheter (og
//     flere_enheter-kontoen) berøres ikke. Også en refresh-token som skulle ha lekket gir da et
//     token uten ansattrettigheter.
//  2. signOut({scope:'local'}) sletter sesjonen og refresh-token på serveren og fjerner den fra
//     nettleseren. Access-token som allerede er utstedt gjelder ut sin levetid (maks 1 time) -
//     det kan ikke trekkes tilbake, men det ligger ikke lenger noe sted i nettleseren.
async function avsluttSesjon() {
  if (!db) return;
  try {
    const r = await medTidsgrense(db.rpc('logg_ut'), 5000);
    if (r === 'tidsavbrudd' || r?.error) console.warn('logg_ut feilet:', r === 'tidsavbrudd' ? 'tidsavbrudd' : r.error.message);
  } catch(e) { console.warn('logg_ut feilet:', e); }
  let feil = null;
  try {
    const r = await medTidsgrense(db.auth.signOut({ scope: 'local' }), 5000);
    feil = r === 'tidsavbrudd' ? 'tidsavbrudd' : r?.error;
  } catch(e) { feil = e; }
  if (feil) {
    // supabase-js beholder sesjonen i nettleseren hvis selve utloggingskallet feiler (f.eks.
    // uten nett) - da fjerner vi den selv, ellers ville en "utlogget" enhet fortsatt ha token-et.
    console.warn('signOut feilet, fjerner sesjonen lokalt:', feil);
    try { localStorage.removeItem('sb-' + new URL(SUPA_URL).hostname.split('.')[0] + '-auth-token'); } catch(e) {}
  }
}

// Nullstiller all lokal tilstand knyttet til den innloggede ansatte og laster siden på nytt -
// delt av den vanlige utloggingsflyten (utforLogout, som i tillegg selv avslutter Auth-
// sesjonen) og onAuthStateChange sin SIGNED_OUT-håndtering (der sesjonen allerede ER
// avsluttet et annet sted, så den skal IKKE kalle logg_ut/signOut en gang til).
function nullstillLokalOkt() {
  if (timerTick) clearInterval(timerTick);
  timerTick = null; timerStart = null;
  me = null;
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  // Stopp sanntid: kanalen er knyttet til den innloggede ansatte og skal ikke bli stående
  // (en ny innlogging starter den på nytt, se tryLogin()).
  if (realtimeReconnectTimer) { clearTimeout(realtimeReconnectTimer); realtimeReconnectTimer = null; }
  clearTimeout(realtimeStabilTimer);
  if (realtimeChannel && db) { try { db.removeChannel(realtimeChannel); } catch(_){} }
  realtimeChannel = null;
  // Nullstill backoff-telleren for DENNE sideøkten (s00-022 punkt 2) - uten dette kunne en
  // ansatt som logget ut og inn igjen uten å laste siden på nytt arve en gammel
  // realtimeForsteFeil fra FORRIGE innlogging, og sanntiden kunne da feilaktig tro den
  // allerede hadde stått frakoblet lenge og gi opp den automatiske gjenoppkoblingen med en
  // gang ved første feil i den nye økten.
  realtimeReconnectForsok = 0;
  realtimeForsteFeil = 0;
}
// Fullstendig omlasting i stedet for bare å bytte skjerm (s00-022 punkt 6) - uten dette kunne
// forrige ansatts åpne modaler/skjermtilstand bli stående synlig til neste ansatt logget inn.
// En frisk side garanterer at ingenting av forrige økt henger igjen. Kalles ETTER at
// avsluttSesjon() (nettverkskall) er ferdig, ellers kan omlastingen avbryte dem midt i.
// typeof-vakt: location.reload finnes ikke i de isolerte vm-testmiljøene.
function sikkerReload() {
  if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
}

// Pågående utlogging (null ellers) - tryLogin() venter på den, se kommentaren der.
let utloggingPagar = null;
// tvungen = true når appen selv logger ut (dagens PIN byttet): ingen spørsmål om ulagrede endringer.
function doLogout(tvungen) {
  if (!utloggingPagar) utloggingPagar = utforLogout(!!tvungen).finally(() => { utloggingPagar = null; });
  return utloggingPagar;
}
async function utforLogout(tvungen) {
  // Endringer som ligger i offline-køen (mislykkede lagringer) får en siste sjanse nå, mens
  // sesjonen ennå er gyldig - uten sesjon kan de ikke lagres før neste innlogging, og da
  // erstattes S av det som ligger i databasen (loadFromSupabase), så de ulagrede endringene
  // ville gått tapt. Lykkes det ikke, spør vi (ved vanlig utlogging) før vi logger ut.
  await medTidsgrense(prosesserOfflineKo(), 3000);
  if (!tvungen && offlineKo.size > 0) {
    const n = offlineKo.size;
    if (!confirm(`${n} endring${n===1?'':'er'} er ikke lagret ennå (ingen kontakt med serveren). Logger du ut nå kan ${n===1?'den':'de'} gå tapt. Logg ut likevel?`)) return;
  }
  // Vent på pågående Fiken-/frakt-kall (s00-022 punkt 5) - signOut midt i et slikt kall kan gi
  // at edge-funksjonens EGET oppfølgende databasekall (f.eks. å lagre fiken_kladd_url) feiler
  // fordi RLS-sesjonen er død. 10 sek er god margin for et enkelt edge-kall; venter vi forgjeves
  // logger vi ut likevel i stedet for å låse brukeren fast.
  if (edgeFetchAktive > 0) {
    await medTidsgrense(new Promise(r => {
      const sjekk = setInterval(() => { if (edgeFetchAktive <= 0) { clearInterval(sjekk); r(); } }, 200);
    }), 10000);
  }
  nullstillLokalOkt();
  await avsluttSesjon();
  sikkerReload();
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

// headerKnapp er en kompakt 🔔/🔕-ikonknapp i selve toppmenyen (bedt om av Henrik
// 2026-09-27: "det må være i toppen ved siden av meldinger og logg ut"). Erstattet det
// tidligere Varsler-kortet i Daglig-seksjonen på Mer-siden, som ble fjernet samme dag etter
// ønske fra Henrik siden knappen her dekker det samme.
async function oppdaterVarselKnapp() {
  const headerKnapp = document.getElementById('varselHeaderBtn');
  if (!headerKnapp) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    headerKnapp.disabled = true; headerKnapp.title = 'Varsler støttes ikke på denne enheten';
    return;
  }
  const perm = Notification.permission;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (perm === 'denied') {
    headerKnapp.textContent = '🔕'; headerKnapp.disabled = true; headerKnapp.title = 'Varsler er blokkert - åpne telefoninnstillinger for å tillate';
  } else if (sub) {
    // Sjekk om endepunktet har rotert siden sist (f.eks. iOS i bakgrunnen)
    // og rydd opp den gamle raden hvis så, slik at vi ikke får dupliserte varsler.
    if (sub.endpoint !== localStorage.getItem(PUSH_ENDPOINT_LS_KEY)) {
      await lagrePushAbonnement(sub);
    }
    headerKnapp.textContent = '🔔'; headerKnapp.disabled = false; headerKnapp.title = 'Varsler er på - trykk for å skru av';
  } else {
    headerKnapp.textContent = '🔕'; headerKnapp.disabled = false; headerKnapp.title = 'Varsler er av - trykk for å skru på';
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

