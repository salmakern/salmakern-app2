// ════════════════════════════════════════════════════
// ADMIN-ARK — excel-lignende oversikt over ordre, admin-only
// ════════════════════════════════════════════════════
let adminArkAar = new Date().getFullYear();
let adminArkTable = null;

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
      flateVis: adminArkFlateNavn(o),
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
      flateVis: '',
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
    forhandler:'', kontaktperson:'', serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer:'', arkivert:false };
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
      serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer:'', arkivert:false };
    S.adminArk = [...(S.adminArk||[]), ark];
  }
  Object.assign(ark, endringer);
  // Alltid upsert med hele radens nåværende tilstand - unngår racen der en update
  // kan lande på serveren FØR den tilhørende insert-en, som stille treffer 0 rader.
  const payload = { id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: ark.rekkefolge,
    forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
    serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
    fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', time_bekreftet: ark.timeBekreftet||null,
    time_bekreftet_tid: ark.timeBekreftetTid||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert };
  const { error } = await db.from('admin_ark').upsert(payload, {onConflict:'id'});
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  // "Time på biltilsynet" på selve ordren speiler alltid Time bekreftet fra Admin-ark.
  if ('timeBekreftet' in endringer || 'timeBekreftetTid' in endringer) {
    const o = S.ordrer.find(x => x.chassis === ark.chassisNr);
    if (o) {
      o.tidBiltilsynet = ark.timeBekreftet||'';
      o.tidBiltilsynetTid = ark.timeBekreftetTid||'';
      logChange(o, 'Time på biltilsynet satt fra Admin-ark: ' + (o.tidBiltilsynet ? (o.tidBiltilsynet+' '+o.tidBiltilsynetTid) : '(fjernet)'));
      const { error: oErr } = await db.from('ordrer').update({ tid_biltilsynet: ark.timeBekreftet||null, tid_biltilsynet_tid: ark.timeBekreftetTid||null, endringer: o.endringer }).eq('id', o.id);
      if (oErr) console.error('Kunne ikke oppdatere tid_biltilsynet på ordre:', oErr.message);
    }
  }
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
    {title:'Forhandler', field:'forhandler', width:135, headerSort:false, editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Kontaktperson', field:'kontaktperson', width:135, headerSort:false, editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Chassis.nr', field:'chassisNr', width:155, headerSort:false, editor:'input', editable:kunLose, frozen:true, rowHandle:true},
    {title:'Serienummer', field:'serienummer', width:95, headerSort:false, editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Mottatt', field:'mottatt', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dato', field:'dato', width:85, headerSort:false, editable:false, formatter: cell => fmtDatoKort(cell.getValue()), rowHandle:true},
    {title:'Papirer', field:'papirer', width:75, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Dokumenter', field:'dokumenter', width:80, headerSort:false, hozAlign:'center', formatter:'tickCross', formatterParams:{crossElement:false}, editor: kanRedigere ? 'tickCross' : false, editorParams:{crossElement:false}, rowHandle:true},
    {title:'Fakturert', field:'fakturertVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Fraktselskap', field:'fraktselskap', width:100, headerSort:false, editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Henteklar', field:'henteklarVis', width:75, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Merknader', field:'merknader', width:125, headerSort:false, editor: kanRedigere ? 'input' : false, rowHandle:true},
    {title:'Flåte', field:'flateVis', width:80, headerSort:false, editable:false, hozAlign:'center', rowHandle:true},
    {title:'Time bekreftet', field:'timeBekreftetVis', width:115, headerSort:false, editor: kanRedigere ? 'input' : false},
    {title:'Ventende timer', field:'ventendeTimer', width:100, headerSort:false, editor: kanRedigere ? 'input' : false}
  ].map(k => ({...k, headerHozAlign:'center'}));

  if (adminArkTable) { adminArkTable.destroy(); adminArkTable = null; }
  adminArkTable = new Tabulator('#adminArkTabell', {
    data,
    layout: 'fitDataFill',
    columns: kolonner,
    movableRows: kanRedigere,
    clipboard: true,
    clipboardPasteAction: 'update',
    placeholder: 'Ingen ordre for ' + adminArkAar
  });

  adminArkTable.on('cellEdited', cell => {
    const felt = cell.getField();
    const rad = cell.getRow().getData();

    if (felt === 'timeBekreftetVis') {
      if (!rad.chassisNr) { visToast('Denne raden mangler chassisnummer og kan ikke lagres'); cell.restoreOldValue(); return; }
      const tekst = (cell.getValue()||'').trim();
      if (!tekst) { adminArkLagreFelter(rad, {timeBekreftet:'', timeBekreftetTid:''}).then(renderAdminArk); return; }
      const tolket = parseTimeBekreftetTekst(tekst);
      if (!tolket) { visToast('Ugyldig format - skriv f.eks. 07.08 - 09:00'); cell.restoreOldValue(); return; }
      adminArkLagreFelter(rad, {timeBekreftet: tolket.dato, timeBekreftetTid: tolket.tid}).then(renderAdminArk);
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
      let ark = rad._arkId ? (S.adminArk||[]).find(r => r.id === rad._arkId) : null;
      if (!ark && rad.chassisNr) ark = (S.adminArk||[]).find(r => r.chassisNr === rad.chassisNr && !r.arkivert);
      if (!ark) {
        if (!rad.chassisNr) return;
        ark = { id: 'ark_' + Date.now() + '_' + idx, chassisNr: rad.chassisNr, aar: adminArkAar, rekkefolge: idx,
          forhandler: rad._erOrdre ? '' : (rad.forhandler||''), kontaktperson: rad._erOrdre ? '' : (rad.kontaktperson||''),
          serienummer:'', mottatt:false, papirer:false, dokumenter:false, fraktselskap:'', merknader:'', timeBekreftet:'', timeBekreftetTid:'', ventendeTimer:'', arkivert:false };
        S.adminArk = [...(S.adminArk||[]), ark];
      } else {
        ark.rekkefolge = idx;
      }
      oppdateringer.push({ id: ark.id, chassis_nr: ark.chassisNr||'', aar: ark.aar, rekkefolge: idx,
        forhandler: ark.forhandler||'', kontaktperson: ark.kontaktperson||'',
        serienummer: ark.serienummer||'', mottatt: !!ark.mottatt, papirer: !!ark.papirer, dokumenter: !!ark.dokumenter,
        fraktselskap: ark.fraktselskap||'', merknader: ark.merknader||'', time_bekreftet: ark.timeBekreftet||null,
        time_bekreftet_tid: ark.timeBekreftetTid||'', ventende_timer: ark.ventendeTimer||'', arkivert: ark.arkivert });
    });
    if (oppdateringer.length) {
      db.from('admin_ark').upsert(oppdateringer, {onConflict:'id'})
        .then(r => { if (r.error) console.error('Rekkefølge-lagring feilet:', r.error.message); });
    }
  });
}
