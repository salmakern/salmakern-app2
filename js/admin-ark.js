// ════════════════════════════════════════════════════
// ADMIN-ARK — excel-lignende oversikt over ordre, admin-only
// ════════════════════════════════════════════════════
let adminArkAar = new Date().getFullYear();
let adminArkTable = null;

// Brukeren kan dra i det innebygde endre-størrelse-håndtaket nederst til høyre på
// tabellboksen (CSS resize:both) for å gjøre arket høyere/bredere enn det som
// automatisk tilpasses vinduet/innholdet - siden/tabellen får da scrolle for å vise
// resten. Så snart brukeren har gjort det manuelt, skal ikke den automatiske
// tilpasningen overskrive valget deres igjen.
let adminArkManuellHoyde = null;
let adminArkManuellBredde = null;
if (!window._adminArkManuellHoydeLytterBundet) {
  window._adminArkManuellHoydeLytterBundet = true;
  document.addEventListener('mouseup', () => {
    const el = document.getElementById('adminArkTabell');
    if (!el) return;
    if (el.style.height) adminArkManuellHoyde = el.style.height;
    if (el.style.width) adminArkManuellBredde = el.style.width;
  });
}

// Som i Excel: Enter mens man redigerer en celle skal hoppe til samme kolonne på
// raden under. Fanges opp i CAPTURE-fasen på document - det garanterer at flagget
// rekker å settes FØR Tabulators egen (bubble-fase) Enter-håndtering på selve inputen
// rekker å fullføre redigeringen og fyre cellEdited, uansett rekkefølge ellers.
let adminArkSisteTastVarEnter = false;

// Ventende timer skal høre til RADPLASSEN i lista, ikke til bilen - når en rad dras til
// ny posisjon skal IKKE Ventende timer-verdien flytte seg med den (i motsetning til
// alt annet på raden, som følger bilen som vanlig). Derfor tar vi vare på hvilken
// Ventende timer-verdi som lå på hver posisjon FØR hvert dra, og legger den tilbake
// på samme posisjon etterpå, uansett hvilken bil som nå havnet der.
let adminArkVentendeTimerPerPosisjon = [];
function adminArkOppdaterVentendeTimerSnapshot() {
  if (!adminArkTable) return;
  adminArkVentendeTimerPerPosisjon = adminArkTable.getRows()
    .sort((a, b) => a.getPosition() - b.getPosition())
    .map(r => r.getData().ventendeTimer || '');
}
if (!window._adminArkEnterLytterBundet) {
  window._adminArkEnterLytterBundet = true;
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('adminArkTabell')?.contains(document.activeElement)) {
      adminArkSisteTastVarEnter = true;
    }
  }, true);
}

function adminArkNaviger(dir) {
  adminArkAar += dir;
  renderAdminArk();
}

// Brukes ved VISNING - skal vise raden uansett arkivert-status, ellers forsvinner
// låst innhold sporløst fra visningen etter arkivering.
function adminArkFinnRadForVisning(chassisNr) {
  if (!chassisNr) return null;
  return (S.adminArk||[]).find(r => r.chassisNr === chassisNr) || null;
}

function adminArkFlateNavn(o) {
  if (!o.flateId) return '';
  const f = (S.flater||[]).find(x => x.id === o.flateId);
  return f ? (f.flatenummer || f.kunde || '') : '';
}

// Time bekreftet skrives inn som fri tekst "DD.MM - HH:MM" (tiden er valgfri) - året
// hentes automatisk fra året arket står på, siden det uansett er året ordren tilhører.
function fmtTimeBekreftetVis(dato, tid) {
  if (!dato) return '';
  const deler = String(dato).split('-');
  if (deler.length !== 3) return dato;
  const [, mnd, dag] = deler;
  return dag + '.' + mnd + (tid ? ' - ' + tid : '');
}
function parseTimeBekreftetTekst(tekst) {
  const m = tekst.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\s*-?\s*(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const dag = Number(m[1]), mnd = Number(m[2]);
  if (dag < 1 || dag > 31 || mnd < 1 || mnd > 12) return null;
  let tid = '';
  if (m[3] !== undefined) {
    const time = Number(m[3]), min = Number(m[4]);
    if (time > 23 || min > 59) return null;
    tid = String(time).padStart(2,'0') + ':' + String(min).padStart(2,'0');
  }
  const dato = adminArkAar + '-' + String(mnd).padStart(2,'0') + '-' + String(dag).padStart(2,'0');
  return { dato, tid };
}

// Rader kommer fra to kilder: ekte ordre (matchet mot admin_ark via chassis.nr),
// og "løse" admin_ark-rader uten noen matchende ordre ennå (lagt til med "+ Ny rad").
// Så snart en ordre opprettes med samme chassis.nr, plukkes den løse raden opp av
// ordre-grenen under og forsvinner fra de løse radene - de finner hverandre automatisk.
function adminArkByggRader() {
  const ordre = (S.ordrer||[]).filter(o => {
    const aar = o.ankomstdato ? Number(String(o.ankomstdato).slice(0,4)) : null;
    return aar === adminArkAar;
  });
  const brukteArkId = new Set();
  const ordreRader = ordre.map(o => {
    const ark = adminArkFinnRadForVisning(o.chassis);
    if (ark) brukteArkId.add(ark.id);
    return {
      _ordreId: o.id,
      _arkId: ark ? ark.id : null,
      _erOrdre: true,
      forhandler: o.kunde || '',
      kontaktperson: o.eier || '',
      chassisNr: o.chassis || '',
      serienummer: ark?.serienummer || '',
      mottatt: ark?.mottatt || false,
      dato: o.ankomstdato || '',
      papirer: ark?.papirer || false,
      dokumenter: ark?.dokumenter || false,
      fakturertVis: o.fakturert ? '✓' : '',
      fraktselskap: ark?.fraktselskap || '',
      henteklarVis: o.ordreStatus === 'klar_henting' ? '✓' : '',
      merknader: ark?.merknader || '',
      flateVis: adminArkFlateNavn(o) || ark?.flateHypotetisk || '',
      _flateErEkte: !!adminArkFlateNavn(o),
      timeBekreftet: ark?.timeBekreftet || '',
      timeBekreftetTid: ark?.timeBekreftetTid || '',
      timeBekreftetVis: fmtTimeBekreftetVis(ark?.timeBekreftet, ark?.timeBekreftetTid),
      ventendeTimer: ark?.ventendeTimer || '',
      rekkefolge: ark?.rekkefolge ?? 999999,
      _arkivert: ark?.arkivert || false
    };
  });
  const loseRader = (S.adminArk||[])
    .filter(r => r.aar === adminArkAar && !brukteArkId.has(r.id))
    .map(r => ({
      _ordreId: null,
      _arkId: r.id,
      _erOrdre: false,
      forhandler: r.forhandler || '',
      kontaktperson: r.kontaktperson || '',
      chassisNr: r.chassisNr || '',
      serienummer: r.serienummer || '',
      mottatt: r.mottatt || false,
      dato: '',
      papirer: r.papirer || false,
      dokumenter: r.dokumenter || false,
      fakturertVis: '',
      fraktselskap: r.fraktselskap || '',
      henteklarVis: '',
      merknader: r.merknader || '',
      flateVis: r.flateHypotetisk || '',
      _flateErEkte: false,
      timeBekreftet: r.timeBekreftet || '',
      timeBekreftetTid: r.timeBekreftetTid || '',
      timeBekreftetVis: fmtTimeBekreftetVis(r.timeBekreftet, r.timeBekreftetTid),
      ventendeTimer: r.ventendeTimer || '',
      rekkefolge: r.rekkefolge ?? 999999,
      _arkivert: r.arkivert || false
    }));
  return [...ordreRader, ...loseRader]
    .sort((a,b) => a.rekkefolge - b.rekkefolge || (a.chassisNr||'').localeCompare(b.chassisNr||'','no'));
}

const ADMIN_ARK_EDITERBARE_FELT = ['forhandler','kontaktperson','chassisNr','serienummer','mottatt','papirer','dokumenter','fraktselskap','merknader','ventendeTimer'];

// Legger til en tom, ikke-lagret rad nederst i arket - blir først lagret i databasen
// når brukeren skriver noe i en av cellene.
function adminArkNyRad() {
  const rad = { id: 'ark_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), chassisNr:'', aar: adminArkAar, rekkefolge: Number.MAX_SAFE_INTEGER,
    forhandler:'', kontaktperson:'', serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', flateHypotetisk:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer:'', arkivert:false };
  S.adminArk = [...(S.adminArk||[]), rad];
  renderAdminArk();
}

// endringer er et objekt med ett eller flere felt->verdi (f.eks. {serienummer:'x'} eller
// {timeBekreftet:'2026-08-07', timeBekreftetTid:'09:00'}) - lagres samlet i én upsert.
async function adminArkLagreFelter(rad, endringer) {
  let ark = rad._arkId ? (S.adminArk||[]).find(r => r.id === rad._arkId) : null;
  if (!ark && rad.chassisNr) ark = (S.adminArk||[]).find(r => r.chassisNr === rad.chassisNr && !r.arkivert);
  if (!ark) {
    ark = { id: 'ark_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), chassisNr: rad.chassisNr||'', aar: adminArkAar, rekkefolge: (S.adminArk||[]).length,
      forhandler: rad._erOrdre ? '' : (rad.forhandler||''), kontaktperson: rad._erOrdre ? '' : (rad.kontaktperson||''),
      serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', flateHypotetisk:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer:'', arkivert:false };
    S.adminArk = [...(S.adminArk||[]), ark];
  }
  Object.assign(ark, endringer);
  // Alltid upsert med hele radens nåværende tilstand - unngår racen der en update
  // kan lande på serveren FØR den tilhørende insert-en, som stille treffer 0 rader.
  const payload = { id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: ark.rekkefolge,
    forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
    serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
    fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', flate_hypotetisk: ark.flateHypotetisk||'', time_bekreftet: ark.timeBekreftet||null,
    time_bekreftet_tid: ark.timeBekreftetTid||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert };
  const { error } = await db.from('admin_ark').upsert(payload, {onConflict:'id'});
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  // "Time på biltilsynet" på selve ordren speiler alltid Time bekreftet fra Admin-ark.
  // Når Time bekreftet faktisk får en verdi, settes den samme datoen/tiden også i
  // verkstedkalenderen (kalender_dato/kalender_tid) - men vi TØMMER den ikke igjen
  // hvis Time bekreftet fjernes, siden kalenderplasseringen kan være satt uavhengig.
  if ('timeBekreftet' in endringer || 'timeBekreftetTid' in endringer) {
    const o = S.ordrer.find(x => x.chassis === ark.chassisNr);
    if (o) {
      o.tidBiltilsynet = ark.timeBekreftet||'';
      o.tidBiltilsynetTid = ark.timeBekreftetTid||'';
      logChange(o, 'Time på biltilsynet satt fra Admin-ark: ' + (o.tidBiltilsynet ? (o.tidBiltilsynet+' '+o.tidBiltilsynetTid) : '(fjernet)'));
      // Nullstiller "allerede varslet"-merket - en flyttet/ny time skal gi et friskt 30-min-varsel.
      const oppdatering = { tid_biltilsynet: ark.timeBekreftet||null, tid_biltilsynet_tid: ark.timeBekreftetTid||null, biltilsyn_varslet: false, endringer: o.endringer };
      if (ark.timeBekreftet) {
        o.kalenderDato = ark.timeBekreftet;
        o.kalenderTid = ark.timeBekreftetTid || o.kalenderTid || '09:00';
        oppdatering.kalender_dato = o.kalenderDato;
        oppdatering.kalender_tid = o.kalenderTid;
      }
      const { error: oErr } = await db.from('ordrer').update(oppdatering).eq('id', o.id);
      if (oErr) console.error('Kunne ikke oppdatere tid_biltilsynet på ordre:', oErr.message);
    }
  }
}

// Kalles når én eller flere Ventende timer-verdier bekreftes over på Time bekreftet -
// hver rad tolkes og lagres i sin EGEN Time bekreftet-celle, og Ventende timer tømmes.
// Oppdaterer kun de berørte radene direkte i tabellen (row.update) istedenfor et fullt
// gjenoppbygg (renderAdminArk) - det siste oppleves som at "hele siden laster på nytt".
async function adminArkBekreftFlereVentendeTid(radTekstListe) {
  let ok = 0, feilet = 0;
  for (const { row, rad, tekst } of radTekstListe) {
    const tolket = parseTimeBekreftetTekst(tekst);
    if (!tolket) { feilet++; continue; }
    await adminArkLagreFelter(rad, { timeBekreftet: tolket.dato, timeBekreftetTid: tolket.tid, ventendeTimer: '' });
    ok++;
    if (row) row.update({ timeBekreftetVis: fmtTimeBekreftetVis(tolket.dato, tolket.tid), ventendeTimer: '' });
  }
  if (ok && !feilet) visToast(ok === 1 ? 'Time bekreftet' : `${ok} timer bekreftet`, 'ok');
  else if (ok && feilet) visToast(`${ok} bekreftet, ${feilet} kunne ikke tolkes`, 'ok');
  else visToast('Kan ikke tolkes som dato/tid - skriv f.eks. 07.08 - 09:00 i Ventende timer først');
}

// ── Merking og flytting av flere rader i Ventende timer-kolonnen ──
// Som i Excel: klikk-og-dra nedover markerer en sammenhengende rekke rader (tjukk
// kantlinje). Et NYTT klikk-og-dra som starter INNENFOR den markeringen flytter/
// bekrefter i stedet. Selve flyttingen spores med rene musehendelser (mousemove/
// mouseup på document + elementFromPoint) i stedet for nettleserens native HTML5
// dra-og-slipp, som viste seg upålitelig for korte drag mellom to tilstøtende
// kolonner i denne tabellen.
let vtMerking = { aktiv:false, startIdx:null, rader:new Set(), fikkDrag:false };
let vtFlyttHoverEl = null;

function vtMerkOppdaterVisning() {
  if (!adminArkTable) return;
  adminArkTable.getRows().forEach(r => {
    const el = r.getCell('ventendeTimer')?.getElement();
    if (!el) return;
    const erMarkert = vtMerking.rader.has(r.getPosition());
    el.style.outline = erMarkert ? '3px solid #3b82f6' : '';
    el.style.outlineOffset = '-3px';
    el.style.cursor = erMarkert ? 'grab' : '';
  });
}
function vtMerkNullstill() {
  vtMerking = { aktiv:false, startIdx:null, rader:new Set(), fikkDrag:false };
  vtMerkOppdaterVisning();
}
if (!window._vtMerkGlobaleLyttereBundet) {
  window._vtMerkGlobaleLyttereBundet = true;
  window.addEventListener('mouseup', () => {
    if (vtMerking.aktiv) { vtMerking.aktiv = false; vtMerkOppdaterVisning(); }
  });
  window.addEventListener('mousedown', e => {
    if (vtMerking.rader.size && !e.target.closest('[tabulator-field="ventendeTimer"]')) vtMerkNullstill();
  });
}

// Starter en ren musesporet "flytting" av den nåværende markeringen (kalt fra
// mousedown på en celle som allerede er markert). Følger musepekeren til mouseup,
// og sjekker da hva som ligger under pekeren via elementFromPoint:
//  - slippes det på en Time bekreftet-celle: bekreftes alle markerte rader (som før).
//  - slippes det på en ANNEN Ventende timer-celle: flyttes verdiene dit i samme
//    rekkefølge, kaskadert nedover fra der du slipper (kilde-radene tømmes).
function vtStartFlytting(startEvent) {
  startEvent.preventDefault();
  document.body.style.cursor = 'grabbing';

  function rensHover() {
    if (vtFlyttHoverEl) { vtFlyttHoverEl.style.outline = ''; vtFlyttHoverEl.style.background = ''; vtFlyttHoverEl = null; }
  }
  function finnMaal(e) {
    return document.elementFromPoint(e.clientX, e.clientY)?.closest('.admin-ark-tb-celle, .admin-ark-vt-celle');
  }
  function paMove(e) {
    const el = finnMaal(e);
    if (el === vtFlyttHoverEl) return;
    rensHover();
    if (el) { el.style.outline = '3px dashed #60a5fa'; el.style.outlineOffset = '-3px'; el.style.background = '#60a5fa33'; vtFlyttHoverEl = el; }
  }
  function paUp(e) {
    document.removeEventListener('mousemove', paMove);
    document.removeEventListener('mouseup', paUp);
    document.body.style.cursor = '';
    const maalEl = finnMaal(e);
    rensHover();
    const radIndekser = [...vtMerking.rader].sort((a, b) => a - b);
    vtMerkNullstill();
    if (!maalEl) return;

    if (maalEl.classList.contains('admin-ark-tb-celle')) {
      const radTekstListe = radIndekser.map(idx => {
        const r = adminArkTable.getRows().find(x => x.getPosition() === idx);
        return r && r.getData().ventendeTimer ? { row: r, rad: r.getData(), tekst: r.getData().ventendeTimer } : null;
      }).filter(Boolean);
      if (radTekstListe.length) adminArkBekreftFlereVentendeTid(radTekstListe);
      return;
    }

    const maalRad = adminArkTable.getRows().find(r => r.getCell('ventendeTimer').getElement() === maalEl);
    if (!maalRad || radIndekser.includes(maalRad.getPosition())) return;
    vtFlyttInnadIKolonne(radIndekser, maalRad.getPosition());
  }
  document.addEventListener('mousemove', paMove);
  document.addEventListener('mouseup', paUp);
}

// Flytter de markerte Ventende timer-verdiene (kildePosisjoner, topp til bunn) til å
// starte på startMaalPosisjon og kaskadere nedover derfra - kilde-radene tømmes, og
// mål-radenes eventuelle eksisterende verdi overskrives uten videre.
async function vtFlyttInnadIKolonne(kildePosisjoner, startMaalPosisjon) {
  const alleRader = adminArkTable.getRows();
  const tekster = kildePosisjoner.map(pos => alleRader.find(r => r.getPosition() === pos)?.getData().ventendeTimer || '');

  for (const pos of kildePosisjoner) {
    const rad = alleRader.find(r => r.getPosition() === pos);
    if (!rad) continue;
    await adminArkLagreFelter(rad.getData(), { ventendeTimer: '' });
    rad.update({ ventendeTimer: '' });
  }

  const posisjonerSortert = alleRader.map(r => r.getPosition()).sort((a, b) => a - b);
  const startIdx = posisjonerSortert.indexOf(startMaalPosisjon);
  let antallFlyttet = 0;
  for (let i = 0; i < tekster.length; i++) {
    const pos = posisjonerSortert[startIdx + i];
    if (pos === undefined || !tekster[i]) continue;
    const rad = alleRader.find(r => r.getPosition() === pos);
    if (!rad) continue;
    await adminArkLagreFelter(rad.getData(), { ventendeTimer: tekster[i] });
    rad.update({ ventendeTimer: tekster[i] });
    antallFlyttet++;
  }
  visToast(antallFlyttet === 1 ? 'Flyttet 1 rad' : `Flyttet ${antallFlyttet} rader`, 'ok');
}

// Motsatt retning: dra en bekreftet Time bekreftet-celle tilbake ned til Ventende
// timer på SAMME rad, for å sette den tilbake til uavklart. Bare én rad om gangen -
// ingen markerings-mekanikk her, siden det å "avbekrefte" er en handling per rad.
function tbStartFlytting(startEvent, kildeCell) {
  document.body.style.cursor = 'grabbing';
  const kildeRadPos = kildeCell.getRow().getPosition();
  let hoverEl = null;

  function rensHover() {
    if (hoverEl) { hoverEl.style.outline = ''; hoverEl.style.background = ''; hoverEl = null; }
  }
  function erSammeRadsVentendeTimerCelle(el) {
    if (!el) return null;
    const rad = adminArkTable.getRows().find(r => r.getCell('ventendeTimer').getElement() === el);
    return rad && rad.getPosition() === kildeRadPos ? rad : null;
  }
  function paMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.admin-ark-vt-celle');
    if (el === hoverEl) return;
    rensHover();
    if (erSammeRadsVentendeTimerCelle(el)) { el.style.outline = '3px dashed #60a5fa'; el.style.outlineOffset = '-3px'; el.style.background = '#60a5fa33'; hoverEl = el; }
  }
  function paUp(e) {
    document.removeEventListener('mousemove', paMove);
    document.removeEventListener('mouseup', paUp);
    document.body.style.cursor = '';
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.admin-ark-vt-celle');
    rensHover();
    const maalRad = erSammeRadsVentendeTimerCelle(el);
    if (!maalRad) return;
    const rad = kildeCell.getRow().getData();
    const tekst = rad.timeBekreftetVis;
    if (!tekst) return;
    tbFlyttTilbake(rad, tekst, kildeCell.getRow());
  }
  document.addEventListener('mousemove', paMove);
  document.addEventListener('mouseup', paUp);
}
async function tbFlyttTilbake(rad, tekst, row) {
  await adminArkLagreFelter(rad, { timeBekreftet:'', timeBekreftetTid:'', ventendeTimer: tekst });
  row.update({ timeBekreftetVis:'', ventendeTimer: tekst });
  visToast('Satt tilbake til Ventende timer', 'ok');
}

function adminArkOppdaterStatus() {
  const el = document.getElementById('adminArkStatus');
  const btn = document.getElementById('adminArkArkiverBtn');
  const nyRadBtn = document.getElementById('adminArkNyRadBtn');
  document.getElementById('adminArkAarTittel').textContent = adminArkAar;
  const radene = (S.adminArk||[]).filter(r => r.aar === adminArkAar);
  const harAktive = radene.some(r => !r.arkivert);
  const harNoen = radene.length > 0;
  const laast = harNoen && !harAktive;
  if (nyRadBtn) nyRadBtn.style.display = laast ? 'none' : '';
  if (!harNoen) { el.textContent = ''; btn.style.display = 'none'; return; }
  if (laast) {
    el.innerHTML = '<span style="color:#facc15">🔒 Dette arket er arkivert (skrivebeskyttet)</span>';
    btn.style.display = 'none';
  } else {
    el.textContent = '';
    btn.style.display = '';
  }
}

async function arkiverAdminArk() {
  if (!confirm(`Arkivere hele arket for ${adminArkAar}? Radene låses for redigering, men blir stående for innsyn og kopiering.`)) return;
  const { error } = await db.from('admin_ark').update({ arkivert: true }).eq('aar', adminArkAar).eq('arkivert', false);
  if (error) { visToast('Kunne ikke arkivere: ' + error.message); return; }
  (S.adminArk||[]).forEach(r => { if (r.aar === adminArkAar) r.arkivert = true; });
  visToast('Arket for ' + adminArkAar + ' er arkivert', 'ok');
  renderAdminArk();
}

// Setter tabellhøyden til nøyaktig det som er igjen av vinduet under den, slik
// at hele siden aldri trenger å scrolle - da holder Tabulators egen overskrift
// seg alltid synlig øverst, det er kun radene inni som scroller.
function adminArkTilpassHoyde() {
  const el = document.getElementById('adminArkTabell');
  if (!el) return;
  if (adminArkManuellHoyde) { el.style.height = adminArkManuellHoyde; return; }
  const topp = el.getBoundingClientRect().top;
  el.style.height = Math.max(300, window.innerHeight - topp - 24) + 'px';
}
if (!window._adminArkResizeBundet) {
  window._adminArkResizeBundet = true;
  window.addEventListener('resize', () => {
    if (!document.getElementById('admin')?.classList.contains('active')) return;
    adminArkTilpassHoyde();
    if (adminArkTable) adminArkTable.redraw(true);
  });
}

function renderAdminArk() {
  vtMerking = { aktiv:false, startIdx:null, rader:new Set(), fikkDrag:false };
  adminArkOppdaterStatus();
  adminArkTilpassHoyde();
  const data = adminArkByggRader();
  const arkRaderIAar = (S.adminArk||[]).filter(r => r.aar === adminArkAar);
  const kanRedigere = arkRaderIAar.length ? arkRaderIAar.some(r => !r.arkivert) : true;
  const kunLose = (cell) => kanRedigere && !cell.getRow().getData()._erOrdre;

  // rowHandle:true betyr at man kan gripe/dra hele raden fra den kolonnen.
  // Satt på alle kolonner til og med Flåte - ikke på Time bekreftet/Ventende
  // timer, slik at drahandtaket ikke kommer i konflikt med de siste feltene.
  const kolonner = [
    {title:'#', formatter:'rownum', hozAlign:'center', width:40, headerSort:false, frozen:true, rowHandle:true},
    {title:'Forhandler', field:'forhandler', width:135, headerSort:false, hozAlign:'left', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Kontaktperson', field:'kontaktperson', width:135, headerSort:false, hozAlign:'left', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Chassis.nr', field:'chassisNr', width:155, headerSort:false, hozAlign:'center', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Serienummer', field:'serienummer', width:95, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Mottatt', field:'mottatt', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dato', field:'dato', width:85, headerSort:false, hozAlign:'center', editable:false, formatter: cell => fmtDatoKort(cell.getValue()), rowHandle:true},
    {title:'Papirer', field:'papirer', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dokumenter', field:'dokumenter', width:80, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Fakturert', field:'fakturertVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Fraktselskap', field:'fraktselskap', width:100, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Henteklar', field:'henteklarVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Merknader', field:'merknader', width:125, headerSort:false, hozAlign:'left', editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Flåte', field:'flateVis', width:80, headerSort:false, hozAlign:'center',
      editor: kanRedigere ? 'input' : false, editable: cell => kanRedigere && !cell.getRow().getData()._flateErEkte, rowHandle:true},
    {title:'Time bekreftet', field:'timeBekreftetVis', width:115, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false,
      cssClass:'admin-ark-slippmal admin-ark-tb-celle',
      formatter: (cell, params, onRendered) => {
        const verdi = cell.getValue() || '';
        onRendered(() => {
          const el = cell.getElement();
          if (!kanRedigere || !verdi) return;
          el.style.cursor = 'grab';
          el.title = 'Klikk og dra ned på Ventende timer for å sette tilbake til uavklart';
          el.addEventListener('mousedown', e => {
            e.preventDefault();
            tbStartFlytting(e, cell);
          });
        });
        return verdi;
      }
    },
    {title:'Ventende timer', field:'ventendeTimer', width:100, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false,
      cssClass:'admin-ark-vt-celle',
      formatter: (cell, params, onRendered) => {
        const verdi = cell.getValue() || '';
        const radIdx = cell.getRow().getPosition();
        onRendered(() => {
          const el = cell.getElement();
          if (!kanRedigere || !verdi) return;
          el.title = 'Klikk og dra nedover for å markere flere rader. Klikk og dra en markert celle over på Time bekreftet for å bekrefte.';

          // Som i Excel: klikk-og-dra på en UMARKERT celle starter en ny markering
          // (dra nedover for å ta med flere rader). Klikk-og-dra på en celle som
          // ALLEREDE er markert flytter/bekrefter i stedet.
          el.addEventListener('mousedown', e => {
            if (vtMerking.rader.has(radIdx)) { vtStartFlytting(e); return; }
            // Uten dette starter nettleseren sin egen tekstmarkering (blå highlight) når
            // man drar over teksten, som ellers hindrer mouseenter-basert merking under.
            e.preventDefault();
            vtMerking = { aktiv:true, startIdx:radIdx, rader:new Set([radIdx]), fikkDrag:false };
            vtMerkOppdaterVisning();
          });
          el.addEventListener('mouseenter', () => {
            if (!vtMerking.aktiv) return;
            vtMerking.fikkDrag = true;
            const alleIdx = adminArkTable.getRows().map(r => r.getPosition());
            const fraPos = alleIdx.indexOf(vtMerking.startIdx);
            const tilPos = alleIdx.indexOf(radIdx);
            if (fraPos === -1 || tilPos === -1) return;
            const [lav, hoy] = fraPos <= tilPos ? [fraPos, tilPos] : [tilPos, fraPos];
            vtMerking.rader = new Set(alleIdx.slice(lav, hoy + 1));
            vtMerkOppdaterVisning();
          });
        });
        return verdi ? `<span style="user-select:none;-webkit-user-select:none">${verdi}</span>` : '';
      }
    }
  ].map(k => ({...k, headerHozAlign:'center'}));

  // Setter en eksplisitt pixel-bredde på selve tabell-boksen (summen av kolonnene, pluss
  // litt slingring for kantlinjer/scrollbar) - ellers strekker boksen seg over hele
  // vinduet selv om innholdet (fitData) stopper mye tidligere.
  // Er summen av kolonnene bredere enn det som faktisk er plass til i vinduet, caper vi
  // boksens bredde til det synlige - da får boksen sin EGEN vannrette scrollbar (overflow:
  // auto er allerede satt) med de frosne kolonnene liggende fast, i stedet for at siste
  // kolonne (Ventende timer) rett og slett havner utenfor skjermen og blir usynlig.
  const totalKolonneBredde = kolonner.reduce((sum, k) => sum + (k.width || 0), 0);
  const arkElForBredde = document.getElementById('adminArkTabell');
  const tilgjengeligBredde = window.innerWidth - arkElForBredde.getBoundingClientRect().left - 24;
  arkElForBredde.style.width = adminArkManuellBredde || Math.min(totalKolonneBredde + 20, Math.max(400, tilgjengeligBredde)) + 'px';

  if (adminArkTable) { adminArkTable.destroy(); adminArkTable = null; }
  adminArkTable = new Tabulator('#adminArkTabell', {
    data,
    layout: 'fitData',
    columns: kolonner,
    movableRows: kanRedigere,
    clipboard: true,
    clipboardPasteAction: 'update',
    placeholder: 'Ingen ordre for ' + adminArkAar
  });

  // Tabulator bygger radene asynkront - et snapshot tatt rett etter new Tabulator(...)
  // kan derfor bli tomt. tableBuilt garanterer at radene faktisk finnes når vi leser dem.
  adminArkTable.on('tableBuilt', () => adminArkOppdaterVentendeTimerSnapshot());

  adminArkTable.on('cellEdited', cell => {
    if (!adminArkSisteTastVarEnter) return;
    adminArkSisteTastVarEnter = false;
    const felt = cell.getField();
    const posNaa = cell.getRow().getPosition();
    const nesteRad = adminArkTable.getRows().find(r => r.getPosition() === posNaa + 1);
    const nesteCelle = nesteRad?.getCell(felt);
    if (nesteCelle) setTimeout(() => nesteCelle.edit(true), 0);
  });

  adminArkTable.on('cellEdited', cell => {
    const felt = cell.getField();
    const rad = cell.getRow().getData();

    if (felt === 'flateVis') {
      if (rad._flateErEkte) { cell.restoreOldValue(); return; }
      if (!rad.chassisNr) { visToast('Denne raden mangler chassisnummer og kan ikke lagres'); cell.restoreOldValue(); return; }
      adminArkLagreFelter(rad, { flateHypotetisk: cell.getValue() || '' });
      return;
    }

    if (felt === 'timeBekreftetVis') {
      if (!rad.chassisNr) { visToast('Denne raden mangler chassisnummer og kan ikke lagres'); cell.restoreOldValue(); return; }
      const tekst = (cell.getValue()||'').trim();
      if (!tekst) { adminArkLagreFelter(rad, {timeBekreftet:'', timeBekreftetTid:''}); return; }
      const tolket = parseTimeBekreftetTekst(tekst);
      if (!tolket) { visToast('Ugyldig format - skriv f.eks. 07.08 - 09:00'); cell.restoreOldValue(); return; }
      // Normaliserer visningen (f.eks. "7.8-9:00" -> "07.08 - 09:00") uten et fullt
      // gjenoppbygg av tabellen. Bruker row.update (ikke cell.setValue) - det siste
      // trigger et nytt cellEdited-kall og ender i en unødvendig dobbel-lagring.
      adminArkLagreFelter(rad, {timeBekreftet: tolket.dato, timeBekreftetTid: tolket.tid})
        .then(() => cell.getRow().update({ timeBekreftetVis: fmtTimeBekreftetVis(tolket.dato, tolket.tid) }));
      return;
    }

    if (!ADMIN_ARK_EDITERBARE_FELT.includes(felt)) return;
    if (felt !== 'chassisNr' && felt !== 'forhandler' && felt !== 'kontaktperson' && !rad.chassisNr) {
      visToast('Denne raden mangler chassisnummer og kan ikke lagres');
      cell.restoreOldValue();
      return;
    }
    adminArkLagreFelter(rad, {[felt]: cell.getValue()});
  });

  adminArkTable.on('rowMoved', () => {
    if (!kanRedigere) return;
    const rader = adminArkTable.getData();
    const oppdateringer = [];
    rader.forEach((rad, idx) => {
      // Ventende timer skal bli værende på RADPLASSEN (idx), ikke følge bilen som
      // akkurat ble flyttet inn dit - bruk snapshotet fra FØR dette draget.
      const posisjonsbasertVentendeTimer = adminArkVentendeTimerPerPosisjon[idx] ?? '';
      let ark = rad._arkId ? (S.adminArk||[]).find(r => r.id === rad._arkId) : null;
      if (!ark && rad.chassisNr) ark = (S.adminArk||[]).find(r => r.chassisNr === rad.chassisNr && !r.arkivert);
      if (!ark) {
        if (!rad.chassisNr) return;
        ark = { id: 'ark_' + Date.now() + '_' + idx, chassisNr: rad.chassisNr, aar: adminArkAar, rekkefolge: idx,
          forhandler: rad._erOrdre ? '' : (rad.forhandler||''), kontaktperson: rad._erOrdre ? '' : (rad.kontaktperson||''),
          serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', flateHypotetisk:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer: posisjonsbasertVentendeTimer, arkivert:false };
        S.adminArk = [...(S.adminArk||[]), ark];
      } else {
        ark.rekkefolge = idx;
        ark.ventendeTimer = posisjonsbasertVentendeTimer;
      }
      oppdateringer.push({ id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: idx,
        forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
        serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
        fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', flate_hypotetisk: ark.flateHypotetisk||'', time_bekreftet: ark.timeBekreftet||null,
        time_bekreftet_tid: ark.timeBekreftetTid||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert });
    });
    // Oppdaterer selve tabellvisningen slik at Ventende timer-kolonnen faktisk viser
    // den posisjonsbaserte verdien med en gang, ikke verdien som fulgte bilen.
    adminArkTable.getRows().forEach((r, idx) => r.update({ ventendeTimer: adminArkVentendeTimerPerPosisjon[idx] ?? '' }));
    adminArkOppdaterVentendeTimerSnapshot();
    if (oppdateringer.length) {
      db.from('admin_ark').upsert(oppdateringer, {onConflict:'id'})
        .then(r => { if (r.error) console.error('Rekkefølge-lagring feilet:', r.error.message); });
    }
  });
}
