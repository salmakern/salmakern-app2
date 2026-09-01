// ════════════════════════════════════════════════════
// ADMIN-ARK — excel-lignende oversikt over ordre, admin-only
// ════════════════════════════════════════════════════
let adminArkAar = new Date().getFullYear();
let adminArkTable = null;

// Chassis-nummer skal matche uansett store/små bokstaver - en admin_ark-rad skrevet inn
// som "test123" må fortsatt finne/kobles til en ordre lagret som "TEST123". Ren "==="
// sammenligning brøt sammen for slikt (Time bekreftet synket da aldri til ordren/kalenderen).
/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
function samsvarerChassis(a, b) {
  return !!a && !!b && String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

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

// Lagrer ny rekkefølge for ALLE rader etter en rad-flytting (enten native
// enkelt-rad-dra via rowMoved, eller egen flere-rader-dra via radFlyttFlereRader) -
// setter rekkefolge fortløpende, legger posisjonsbasert Ventende timer (fra
// snapshotet TATT FØR draget) tilbake på riktig plass, og batch-upserter alt i ett kall.
async function adminArkPersisterRekkefolge(ventendeTimerSnapshot) {
  const rader = adminArkTable.getData();
  const oppdateringer = [];
  rader.forEach((rad, idx) => {
    const posisjonsbasertVentendeTimer = ventendeTimerSnapshot[idx] ?? '';
    let ark = rad._arkId ? (S.adminArk||[]).find(r => r.id === rad._arkId) : null;
    if (!ark && rad.chassisNr) ark = (S.adminArk||[]).find(r => samsvarerChassis(r.chassisNr, rad.chassisNr) && !r.arkivert);
    if (!ark) {
      if (!rad.chassisNr) return;
      ark = { id: 'ark_' + Date.now() + '_' + idx, chassisNr: rad.chassisNr, aar: adminArkAar, rekkefolge: idx,
        forhandler: rad._erOrdre ? '' : (rad.forhandler||''), kontaktperson: rad._erOrdre ? '' : (rad.kontaktperson||''),
        serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', flateHypotetisk:'', timeBekreftet:'', timeBekreftetTid:'', timeBekreftetSted:'', ventendeTimer: posisjonsbasertVentendeTimer, arkivert:false };
      S.adminArk = [...(S.adminArk||[]), ark];
    } else {
      ark.rekkefolge = idx;
      ark.ventendeTimer = posisjonsbasertVentendeTimer;
    }
    oppdateringer.push({ id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: idx,
      forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
      serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
      fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', flate_hypotetisk: ark.flateHypotetisk||'', time_bekreftet: ark.timeBekreftet||null,
      time_bekreftet_tid: ark.timeBekreftetTid||'', time_bekreftet_sted: ark.timeBekreftetSted||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert });
  });
  // Oppdaterer selve tabellvisningen slik at Ventende timer-kolonnen faktisk viser
  // den posisjonsbaserte verdien med en gang, ikke verdien som fulgte bilen(e).
  adminArkTable.getRows().forEach((r, idx) => r.update({ ventendeTimer: ventendeTimerSnapshot[idx] ?? '' }));
  adminArkOppdaterVentendeTimerSnapshot();
  if (oppdateringer.length) {
    // Samme echo-unngåelse som adminArkLagreFelter() - uten denne vil hver
    // rekkefølge-endring (drag/flytt rad) trigge en full re-rendering av tabellen.
    oppdateringer.forEach(o => {
      ignorerRealtimeAdminArk.add(o.id);
      setTimeout(()=>ignorerRealtimeAdminArk.delete(o.id), 10000);
    });
    const { error } = await db.from('admin_ark').upsert(oppdateringer, {onConflict:'id'});
    if (error) console.error('Rekkefølge-lagring feilet:', error.message);
  }
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
  return (S.adminArk||[]).find(r => samsvarerChassis(r.chassisNr, chassisNr)) || null;
}

function adminArkFlateNavn(o) {
  if (!o.flateId) return '';
  const f = (S.flater||[]).find(x => x.id === o.flateId);
  return f ? (f.flatenummer || f.kunde || '') : '';
}

// Time bekreftet skrives inn som fri tekst "DD.MM - HH:MM" (tiden er valgfri), med et
// valgfritt STED til slutt (f.eks. "21.08 - 11:30 Skien") - biltilsyn kan være ulike
// steder. Året hentes automatisk fra året arket står på, siden det uansett er året
// ordren tilhører.
function fmtTimeBekreftetVis(dato, tid, sted) {
  if (!dato) return '';
  const deler = String(dato).split('-');
  if (deler.length !== 3) return dato;
  const [, mnd, dag] = deler;
  return dag + '.' + mnd + (tid ? ' - ' + tid : '') + (sted ? ' ' + sted : '');
}
function parseTimeBekreftetTekst(tekst) {
  const m = tekst.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\s*-?\s*(\d{1,2}):(\d{2}))?\s*(.*)$/);
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
  const sted = (m[5] || '').trim();
  return { dato, tid, sted };
}

// Rader kommer fra to kilder: ekte ordre (matchet mot admin_ark via chassis.nr),
// og "løse" admin_ark-rader uten noen matchende ordre ennå (lagt til med "+ Ny rad").
// Så snart en ordre opprettes med samme chassis.nr, plukkes den løse raden opp av
// ordre-grenen under og forsvinner fra de løse radene - de finner hverandre automatisk.
// Gir neste ledige rekkefolge-verdi for inneværende år - én høyere enn det høyeste
// som faktisk er i bruk. Brukes både ved visning av en helt ny, uten en lagret
// admin_ark-rad ennå, og når den raden faktisk lagres for første gang (se
// adminArkLagreFelter) - slik at en ny ordre alltid havner nederst i arket,
// uansett hvor mange rader som totalt finnes (på tvers av år/arkiverte rader).
function adminArkNesteRekkefolge() {
  const maks = Math.max(0, ...(S.adminArk||[]).filter(r=>r.aar===adminArkAar).map(r=>Number(r.rekkefolge)||0));
  return maks + 1;
}

function adminArkByggRader() {
  const ordre = (S.ordrer||[]).filter(o => {
    const aar = o.ankomstdato ? Number(String(o.ankomstdato).slice(0,4)) : null;
    return aar === adminArkAar;
  });
  const brukteArkId = new Set();
  // Flere nye ordre uten lagret rad ennå skal likevel havne i riktig innbyrdes
  // rekkefølge (eldst øverst av dem, nyest nederst) - ikke alfabetisk om hverandre.
  let nesteRekkefolge = adminArkNesteRekkefolge();
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
      // Viser datoen ordren ble satt til Klar for henting (satt av endreStatus() i
      // oversikt-kalender.js) - blir stående permanent i arket selv etter at ordren
      // går videre til Hentet eller en annen status, siden dette er en historikk-dato
      // og ikke en live statusindikator. Eldre ordre som allerede sto i denne statusen
      // før dette feltet fantes har ingen lagret dato ennå - faller da tilbake til et
      // kryss, men bare mens ordren fortsatt faktisk STÅR i klar_henting-status.
      henteklarVis: o.datoKlarHenting ? fmtDatoKort(o.datoKlarHenting) : (o.ordreStatus === 'klar_henting' ? '✓' : ''),
      merknader: ark?.merknader || '',
      flateVis: adminArkFlateNavn(o) || ark?.flateHypotetisk || '',
      _flateErEkte: !!adminArkFlateNavn(o),
      timeBekreftet: ark?.timeBekreftet || '',
      timeBekreftetTid: ark?.timeBekreftetTid || '',
      timeBekreftetSted: ark?.timeBekreftetSted || '',
      timeBekreftetVis: fmtTimeBekreftetVis(ark?.timeBekreftet, ark?.timeBekreftetTid, ark?.timeBekreftetSted),
      ventendeTimer: ark?.ventendeTimer || '',
      rekkefolge: ark ? (ark.rekkefolge ?? 999999) : nesteRekkefolge++,
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
      timeBekreftetSted: r.timeBekreftetSted || '',
      timeBekreftetVis: fmtTimeBekreftetVis(r.timeBekreftet, r.timeBekreftetTid, r.timeBekreftetSted),
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
  if (!ark && rad.chassisNr) ark = (S.adminArk||[]).find(r => samsvarerChassis(r.chassisNr, rad.chassisNr) && !r.arkivert);
  if (!ark) {
    ark = { id: 'ark_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), chassisNr: rad.chassisNr||'', aar: adminArkAar, rekkefolge: adminArkNesteRekkefolge(),
      forhandler: rad._erOrdre ? '' : (rad.forhandler||''), kontaktperson: rad._erOrdre ? '' : (rad.kontaktperson||''),
      serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', flateHypotetisk:'', timeBekreftet:'', timeBekreftetTid:'', timeBekreftetSted:'', ventendeTimer:'', arkivert:false };
    S.adminArk = [...(S.adminArk||[]), ark];
  }
  Object.assign(ark, endringer);
  // Alltid upsert med hele radens nåværende tilstand - unngår racen der en update
  // kan lande på serveren FØR den tilhørende insert-en, som stille treffer 0 rader.
  const payload = { id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: ark.rekkefolge,
    forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
    serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
    fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', flate_hypotetisk: ark.flateHypotetisk||'', time_bekreftet: ark.timeBekreftet||null,
    time_bekreftet_tid: ark.timeBekreftetTid||'', time_bekreftet_sted: ark.timeBekreftetSted||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert };
  // Unngår at sanntids-echo av vår egen skriving trigger en unødvendig re-rendering av
  // hele Admin-ark-tabellen like etterpå (samme mønster som ordre bruker via save()).
  ignorerRealtimeAdminArk.add(ark.id);
  setTimeout(()=>ignorerRealtimeAdminArk.delete(ark.id), 10000);
  const { error } = await db.from('admin_ark').upsert(payload, {onConflict:'id'});
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  // "Time på biltilsynet" på selve ordren speiler alltid Time bekreftet fra Admin-ark.
  // Verkstedkalenderen (kalender_dato/kalender_tid) skal speile den samme verdien begge
  // veier - settes Time bekreftet, settes kalenderen; fjernes Time bekreftet, fjernes den
  // tilsvarende kalenderplasseringen igjen (ellers blir det stående en "spøkelses-time" i
  // oversikten som ikke lenger stemmer med noe bekreftet).
  if ('timeBekreftet' in endringer || 'timeBekreftetTid' in endringer) {
    const o = S.ordrer.find(x => samsvarerChassis(x.chassis, ark.chassisNr));
    if (o) {
      o.tidBiltilsynet = ark.timeBekreftet||'';
      o.tidBiltilsynetTid = ark.timeBekreftetTid||'';
      o.tidBiltilsynetSted = ark.timeBekreftetSted||'';
      logChange(o, 'Time på biltilsynet satt fra Admin-ark: ' + (o.tidBiltilsynet ? (o.tidBiltilsynet+' '+o.tidBiltilsynetTid+(o.tidBiltilsynetSted?' '+o.tidBiltilsynetSted:'')) : '(fjernet)'));
      // Nullstiller "allerede varslet"-merket - en flyttet/ny time skal gi et friskt 30-min-varsel.
      const oppdatering = { tid_biltilsynet: ark.timeBekreftet||null, tid_biltilsynet_tid: ark.timeBekreftetTid||null, tid_biltilsynet_sted: ark.timeBekreftetSted||'', biltilsyn_varslet: false, endringer: o.endringer };
      o.kalenderDato = ark.timeBekreftet || '';
      o.kalenderTid = ark.timeBekreftet ? (ark.timeBekreftetTid || o.kalenderTid || '09:00') : '';
      oppdatering.kalender_dato = o.kalenderDato || null;
      oppdatering.kalender_tid = o.kalenderTid || null;
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
    await adminArkLagreFelter(rad, { timeBekreftet: tolket.dato, timeBekreftetTid: tolket.tid, timeBekreftetSted: tolket.sted, ventendeTimer: '' });
    ok++;
    if (row) row.update({ timeBekreftetVis: fmtTimeBekreftetVis(tolket.dato, tolket.tid, tolket.sted), ventendeTimer: '' });
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
  await adminArkLagreFelter(rad, { timeBekreftet:'', timeBekreftetTid:'', timeBekreftetSted:'', ventendeTimer: tekst });
  row.update({ timeBekreftetVis:'', ventendeTimer: tekst });
  visToast('Satt tilbake til Ventende timer', 'ok');
}

// ── Merking og flytting av FLERE HELE RADER via '#'-kolonnen ──
// Samme mekanikk som Ventende timer-merkingen: klikk-og-dra nedover på '#' markerer
// en sammenhengende rekke rader (helramme rundt hele raden), et NYTT klikk-og-dra som
// starter INNENFOR markeringen flytter alle de markerte radene samlet dit du slipper -
// hele bil-info følger med (som ved vanlig enkelt-rad-dra), men Ventende timer blir
// IKKE med - den blir værende på sin radplass, akkurat som ved enkelt-rad-dra.
let radMerking = { aktiv:false, startIdx:null, rader:new Set(), fikkDrag:false };

function radMerkOppdaterVisning() {
  if (!adminArkTable) return;
  adminArkTable.getRows().forEach(r => {
    const el = r.getElement();
    if (!el) return;
    const erMarkert = radMerking.rader.has(r.getPosition());
    el.style.outline = erMarkert ? '3px solid #3b82f6' : '';
    el.style.outlineOffset = erMarkert ? '-2px' : '';
  });
}
function radMerkNullstill() {
  radMerking = { aktiv:false, startIdx:null, rader:new Set(), fikkDrag:false };
  radMerkOppdaterVisning();
}
if (!window._radMerkGlobaleLyttereBundet) {
  window._radMerkGlobaleLyttereBundet = true;
  window.addEventListener('mouseup', () => {
    if (radMerking.aktiv) { radMerking.aktiv = false; radMerkOppdaterVisning(); }
  });
  window.addEventListener('mousedown', e => {
    if (radMerking.rader.size && !e.target.closest('.admin-ark-radnr-celle')) radMerkNullstill();
  });
}

function radFraCelle(cellEl) {
  const trEl = cellEl?.closest('.tabulator-row');
  return trEl ? adminArkTable.getRows().find(r => r.getElement() === trEl) : null;
}

// Starter en ren musesporet flytting av HELE den markerte rad-blokken (kalt fra
// mousedown på en '#'-celle som allerede er markert). Slippes det på en annen rad,
// flyttes hele blokken dit (i samme innbyrdes rekkefølge), kaskadert fra der du slipper.
function radStartFlytting(startEvent) {
  startEvent.preventDefault();
  document.body.style.cursor = 'grabbing';
  let hoverRadEl = null;

  function rensHover() {
    if (hoverRadEl) { hoverRadEl.style.outline = ''; hoverRadEl.style.background = ''; hoverRadEl = null; }
  }
  function finnMaalCelle(e) {
    return document.elementFromPoint(e.clientX, e.clientY)?.closest('.admin-ark-radnr-celle');
  }
  function paMove(e) {
    const trEl = finnMaalCelle(e)?.closest('.tabulator-row') || null;
    if (trEl === hoverRadEl) return;
    rensHover();
    if (trEl) { trEl.style.outline = '3px dashed #60a5fa'; trEl.style.outlineOffset = '-2px'; trEl.style.background = '#60a5fa22'; hoverRadEl = trEl; }
  }
  function paUp(e) {
    document.removeEventListener('mousemove', paMove);
    document.removeEventListener('mouseup', paUp);
    document.body.style.cursor = '';
    const maalRad = radFraCelle(finnMaalCelle(e));
    rensHover();
    const radIndekser = [...radMerking.rader].sort((a, b) => a - b);
    radMerkNullstill();
    if (!maalRad || radIndekser.includes(maalRad.getPosition())) return;
    radFlyttFlereRader(radIndekser, maalRad.getPosition());
  }
  document.addEventListener('mousemove', paMove);
  document.addEventListener('mouseup', paUp);
}

// Flytter de markerte radene (kildePosisjoner) samlet til å starte på maalPosisjon,
// i samme innbyrdes rekkefølge de hadde - resten av radene skyves nedover fra der du
// slipper. Ventende timer er IKKE med i flyttingen (adminArkPersisterRekkefolge legger
// posisjonsbasert Ventende timer tilbake etterpå, akkurat som ved enkelt-rad-dra).
async function radFlyttFlereRader(kildePosisjoner, maalPosisjon) {
  const alleRader = adminArkTable.getRows();
  const posisjonerSortert = alleRader.map(r => r.getPosition()).sort((a, b) => a - b);
  const gammelData = adminArkTable.getData();
  const kildeIdxSet = new Set(kildePosisjoner.map(pos => posisjonerSortert.indexOf(pos)));
  const flyttetRaderData = kildePosisjoner.slice().sort((a, b) => a - b)
    .map(pos => gammelData[posisjonerSortert.indexOf(pos)]);
  const maalRadData = gammelData[posisjonerSortert.indexOf(maalPosisjon)];
  const gjenvarende = gammelData.filter((_, idx) => !kildeIdxSet.has(idx));
  const settInnIndeks = gjenvarende.indexOf(maalRadData);
  gjenvarende.splice(settInnIndeks, 0, ...flyttetRaderData);
  const ventendeTimerFor = adminArkVentendeTimerPerPosisjon;
  await adminArkTable.setData(gjenvarende);
  await adminArkPersisterRekkefolge(ventendeTimerFor);
  visToast(kildePosisjoner.length === 1 ? 'Flyttet 1 rad' : `Flyttet ${kildePosisjoner.length} rader`, 'ok');
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
    {title:'#', hozAlign:'center', width:40, headerSort:false, frozen:true, cssClass:'admin-ark-radnr-celle',
      formatter: (cell, params, onRendered) => {
        const radIdx = cell.getRow().getPosition();
        onRendered(() => {
          const el = cell.getElement();
          if (!kanRedigere) return;
          el.style.cursor = 'grab';
          el.title = 'Klikk og dra nedover for å markere flere rader. Klikk og dra en markert rad for å flytte alle sammen (Ventende timer blir liggende igjen på plassen sin).';
          el.addEventListener('mousedown', e => {
            if (radMerking.rader.has(radIdx)) { radStartFlytting(e); return; }
            e.preventDefault();
            radMerking = { aktiv:true, startIdx:radIdx, rader:new Set([radIdx]), fikkDrag:false };
            radMerkOppdaterVisning();
          });
          el.addEventListener('mouseenter', () => {
            if (!radMerking.aktiv) return;
            radMerking.fikkDrag = true;
            const alleIdx = adminArkTable.getRows().map(r => r.getPosition());
            const fraPos = alleIdx.indexOf(radMerking.startIdx);
            const tilPos = alleIdx.indexOf(radIdx);
            if (fraPos === -1 || tilPos === -1) return;
            const [lav, hoy] = fraPos <= tilPos ? [fraPos, tilPos] : [tilPos, fraPos];
            radMerking.rader = new Set(alleIdx.slice(lav, hoy + 1));
            radMerkOppdaterVisning();
          });
        });
        return cell.getRow().getPosition();
      }
    },
    {title:'Forhandler', field:'forhandler', minWidth:90, headerSort:false, hozAlign:'left', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Kontaktperson', field:'kontaktperson', minWidth:90, headerSort:false, hozAlign:'left', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Chassis.nr', field:'chassisNr', width:155, headerSort:false, hozAlign:'center', editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Serienummer', field:'serienummer', width:95, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Mottatt', field:'mottatt', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dato', field:'dato', width:85, headerSort:false, hozAlign:'center', editable:false, formatter: cell => fmtDatoKort(cell.getValue()), rowHandle:true},
    {title:'Papirer', field:'papirer', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dokumenter', field:'dokumenter', width:80, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Fakturert', field:'fakturertVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Fraktselskap', field:'fraktselskap', minWidth:70, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Henteklar', field:'henteklarVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Merknader', field:'merknader', minWidth:90, headerSort:false, hozAlign:'left', editor: kanRedigere ? 'input' : false, rowHandle:true},
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
    {title:'Ventende timer', field:'ventendeTimer', minWidth:100, headerSort:false, hozAlign:'center', editor: kanRedigere ? 'input' : false,
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
  // Noen kolonner (Forhandler, Kontaktperson, Fraktselskap, Merknader) har ingen fast
  // "width" lenger - de tilpasser seg selv til innholdet (som i Excel), så her bruker vi
  // kun et grovt anslag (minWidth/100) FØR Tabulator finnes. Det egentlige, nøyaktige
  // målet skjer i adminArkOppdaterTabellBredde() rett under, kalt fra tableBuilt.
  const totalKolonneBredde = kolonner.reduce((sum, k) => sum + (k.width || k.minWidth || 100), 0);
  const arkElForBredde = document.getElementById('adminArkTabell');
  const tilgjengeligBredde = window.innerWidth - arkElForBredde.getBoundingClientRect().left - 24;
  arkElForBredde.style.width = adminArkManuellBredde || Math.min(totalKolonneBredde + 20, Math.max(400, tilgjengeligBredde)) + 'px';

  // Etter at Tabulator faktisk har bygget og målt kolonnene (fitData tilpasser bredden på
  // de "auto"-kolonnene til det virkelige innholdet), korrigerer vi boksbredden til det den
  // EGENTLIG trenger - slik at arket utvider seg for å vise lange navn fullt ut, ikke "BOS Jes...".
  function adminArkOppdaterTabellBredde() {
    if (adminArkManuellBredde) { arkElForBredde.style.width = adminArkManuellBredde; return; }
    // .tabulator-header scroller i takt med selve tabellkroppen og er derfor alltid begrenset
    // til boksens SYNLIGE bredde - .tabulator-tableholder sitt scrollWidth er det som faktisk
    // viser hvor bred hele det virkelige innholdet (alle kolonnene) er.
    const holder = arkElForBredde.querySelector('.tabulator-tableholder');
    const naturligBredde = (holder ? holder.scrollWidth : totalKolonneBredde) + 20;
    const naaTilgjengelig = window.innerWidth - arkElForBredde.getBoundingClientRect().left - 24;
    arkElForBredde.style.width = Math.min(naturligBredde, Math.max(400, naaTilgjengelig)) + 'px';
  }

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
  adminArkTable.on('tableBuilt', () => {
    adminArkOppdaterVentendeTimerSnapshot();
    adminArkOppdaterTabellBredde();
  });
  // De auto-brede kolonnene (Forhandler/Kontaktperson/Fraktselskap/Merknader) kan trenge
  // MER enn én layout-runde før Tabulator har regnet ut sin endelige, innholds-tilpassede
  // bredde - tableBuilt alene var for tidlig. renderComplete fyrer på nytt hver gang
  // Tabulator selv har måttet justere rad/kolonne-mål videre, så vi korrigerer boksbredden
  // igjen der - trygt å kalle flere ganger, den regner bare ut på nytt fra faktiske DOM-mål.
  adminArkTable.on('renderComplete', () => adminArkOppdaterTabellBredde());

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

    // Forhandler/Kontaktperson/Chassis.nr er kun redigerbare for LØSE rader (kunLose i
    // kolonnedefinisjonen) - for en rad som kommer fra en ekte ordre er disse hentet FRA
    // ordren og skal ikke kunne endres herfra. `editable`-innstillingen hindrer vanlig
    // klikk-og-skriv-redigering, men lim inn (Ctrl+V, clipboardPasteAction:'update' lenger
    // opp) går via `editable` i det hele tatt - Tabulator kaller cell.setValue() direkte
    // uansett, som fortsatt trigger cellEdited og ville lagret endringen. Derfor en egen
    // sjekk her, ikke bare i kolonnedefinisjonen.
    if (['forhandler', 'kontaktperson', 'chassisNr'].includes(felt) && rad._erOrdre) {
      cell.restoreOldValue();
      return;
    }

    if (felt === 'flateVis') {
      if (rad._flateErEkte) { cell.restoreOldValue(); return; }
      if (!rad.chassisNr) { visToast('Denne raden mangler chassisnummer og kan ikke lagres'); cell.restoreOldValue(); return; }
      adminArkLagreFelter(rad, { flateHypotetisk: cell.getValue() || '' });
      return;
    }

    if (felt === 'timeBekreftetVis') {
      if (!rad.chassisNr) { visToast('Denne raden mangler chassisnummer og kan ikke lagres'); cell.restoreOldValue(); return; }
      const tekst = (cell.getValue()||'').trim();
      if (!tekst) { adminArkLagreFelter(rad, {timeBekreftet:'', timeBekreftetTid:'', timeBekreftetSted:''}); return; }
      const tolket = parseTimeBekreftetTekst(tekst);
      if (!tolket) { visToast('Ugyldig format - skriv f.eks. 07.08 - 09:00 Skien'); cell.restoreOldValue(); return; }
      // Normaliserer visningen (f.eks. "7.8-9:00 skien" -> "07.08 - 09:00 skien") uten et
      // fullt gjenoppbygg av tabellen. Bruker row.update (ikke cell.setValue) - det siste
      // trigger et nytt cellEdited-kall og ender i en unødvendig dobbel-lagring.
      adminArkLagreFelter(rad, {timeBekreftet: tolket.dato, timeBekreftetTid: tolket.tid, timeBekreftetSted: tolket.sted})
        .then(() => cell.getRow().update({ timeBekreftetVis: fmtTimeBekreftetVis(tolket.dato, tolket.tid, tolket.sted) }));
      return;
    }

    if (!ADMIN_ARK_EDITERBARE_FELT.includes(felt)) return;
    // Ventende timer skal kunne fylles inn på en fri rad UTEN at bilen/chassis-nummeret
    // er kjent ennå - det er jo poenget med en "ventende" (uavklart) time. De andre
    // feltene krever fortsatt chassis-nr (eller er selve identifikasjonsfeltene).
    const KREVER_IKKE_CHASSIS = new Set(['chassisNr', 'forhandler', 'kontaktperson', 'ventendeTimer']);
    if (!KREVER_IKKE_CHASSIS.has(felt) && !rad.chassisNr) {
      visToast('Denne raden mangler chassisnummer og kan ikke lagres');
      cell.restoreOldValue();
      return;
    }
    // Chassis-nr normaliseres til store bokstaver med en gang det skrives inn - forhindrer
    // at en admin_ark-rad og en ordre havner med ulik store/små-skriving av samme
    // chassisnummer og dermed aldri finner hverandre (samsvarerChassis tåler det uansett,
    // men konsekvent visning er ryddigere). Bruker row.update (ikke cell.setValue) for
    // visnings-normaliseringen - det siste ville trigget et nytt cellEdited-kall.
    const verdi = felt === 'chassisNr' ? (cell.getValue()||'').trim().toUpperCase() : cell.getValue();
    adminArkLagreFelter(rad, {[felt]: verdi})
      .then(() => { if (felt === 'chassisNr' && verdi !== cell.getValue()) cell.getRow().update({ chassisNr: verdi }); });
  });

  adminArkTable.on('rowMoved', () => {
    if (!kanRedigere) return;
    adminArkPersisterRekkefolge(adminArkVentendeTimerPerPosisjon);
  });
}
