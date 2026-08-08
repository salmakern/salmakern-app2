// ════════════════════════════════════════════════════
// PAGE ROUTING
// ════════════════════════════════════════════════════
function showPage(id, btn) {
  if (id === 'ordre') activeOrdreId = null;
  if (id === 'lager') aktivVareId = null;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector('.wrap').classList.toggle('full', id === 'admin');
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if (id==='oversikt') renderOversikt();
  if (id==='ordre')    renderOrdreList();
  if (id==='timer')    { renderTimerHistorikk(); renderTimerMaaned(); }
  if (id==='arkiv')    renderArkiv();
  if (id==='lager')    { aktivKategori=null; oppskriftAktivModell=null; document.getElementById('lagerListeView').style.display='block'; document.getElementById('kategoriDetaljView').style.display='none'; document.getElementById('vareDetaljView').style.display='none'; document.getElementById('oppskriftModellerView').style.display='none'; document.getElementById('oppskriftModellDetaljView').style.display='none'; renderLagerListe(); }
  if (id==='mer')      renderMer();
  if (id==='admin')    renderAdminArk();
  renderGlobalLavLagerVarsel();
}
function renderAll() { renderOversikt(); renderArkiv(); renderMer(); renderOrdreList(); renderGlobalLavLagerVarsel(); }

function renderOrdreList() {
  const listEl   = document.getElementById('ordreList');
  const detailEl = document.getElementById('ordreDetail');
  if (activeOrdreId) {
    listEl.style.display = 'none';
    detailEl.style.display = 'block';
    return; // Ikke rebuild detail fra renderAll — forstyrrer skriving i inputfelter
  }
  // Ikke rebuild mens bruker har et interaktivt element fokusert (bakgrunnsoppdatering ville lukket picker/miste input)
  // - unntatt søkefeltet selv, ellers slutter søk-mens-du-skriver å virke siden feltet har fokus mens man skriver i det.
  const aktivtEl = document.activeElement;
  const sokFokusert = aktivtEl?.id === 'ordreSok';
  const focusTag = aktivtEl?.tagName;
  if (!sokFokusert && listEl?.contains(aktivtEl) && (focusTag==='SELECT'||focusTag==='INPUT'||focusTag==='TEXTAREA')) return;
  const sokCursorPos = sokFokusert ? aktivtEl.selectionStart : null;
  detailEl.style.display = 'none';
  listEl.style.display   = 'block';
  const gammelSok = document.getElementById('ordreSok')?.value || '';
  const sokTekst = gammelSok.toLowerCase().trim();
  const alle = S.ordrer.filter(o => {
    if (o.status !== 'aktiv') return false;
    if (!sokTekst) return true;
    return (o.regnr||'').toLowerCase().includes(sokTekst) ||
           (o.kunde||'').toLowerCase().includes(sokTekst) ||
           (o.eier||'').toLowerCase().includes(sokTekst) ||
           (o.type||'').toLowerCase().includes(sokTekst) ||
           (o.merke||'').toLowerCase().includes(sokTekst) ||
           (o.modell||'').toLowerCase().includes(sokTekst) ||
           (o.chassis||'').toLowerCase().includes(sokTekst);
  }).sort(sorterOrdre);
  listEl.innerHTML = `
    ${me ? `<div class="card" style="margin-bottom:14px">
      <div class="h">Flåtegodkjenning</div>
      <div class="muted small" style="margin-bottom:8px">Grupper ordrer i flåter og se status på tvers.</div>
      <button class="btn" style="width:100%" onclick="visFlaterModal()">Åpne flåtegodkjenning</button>
    </div>` : ''}
    <div class="card">
      <div class="row">
        <div><div class="h">Alle ordrer</div><div class="muted small">${alle.length} ordre${alle.length===1?'':'r'} · Klikk for å åpne</div></div>
        <button class="btn red" onclick="apneNyOrdreModal()">+ Ny ordre</button>
      </div>
      <div style="margin-top:10px">
        <input id="ordreSok" type="search" placeholder="Søk på regnr, kunde, biltype..." oninput="renderOrdreList()" style="width:100%;background:#27272a;color:#f4f4f5;border:1px solid #3f3f46;border-radius:12px;padding:9px 12px;font-size:14px">
      </div>
      <div class="grid g3" style="margin-top:12px">
        ${alle.length ? alle.map(o=>{
          const si = statusInfo(o.ordreStatus);
          return `<div style="position:relative;background:#111114;border:2px solid ${o.prioritert?'#facc15':si.border};border-radius:14px;padding:9px 10px;display:flex;flex-direction:column;gap:3px;min-width:0">
            ${o.prioritert?'<span style="position:absolute;top:-9px;left:12px;background:#111114;padding:0 6px;font-size:10px;font-weight:700;color:#facc15;letter-spacing:.03em">PRIORITERT</span>':''}
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
              <b style="cursor:pointer" onclick="openOrdre('${o.id}')">${ordreLabelFull(o)}</b>
              ${statusDropdown(o.id, o.ordreStatus)}
            </div>
            <span class="small muted" onclick="openOrdre('${o.id}')" style="cursor:pointer">${o.variant||''}</span>
            ${dokStatusKortHTML(o)}
            <div style="display:flex;justify-content:flex-start">${hengerfesteKortHTML(o)}</div>
            <div class="small muted" onclick="openOrdre('${o.id}')" style="cursor:pointer">Ankomst: ${o.ankomstdato||'—'}</div>
            <div class="small muted" onclick="openOrdre('${o.id}')" style="cursor:pointer">${o.utstyr?.skalHa?o.utstyr.skalHa.replace(/\n/g,', '):'—'}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
              <span class="small" onclick="openOrdre('${o.id}')" style="cursor:pointer">${o.kalenderDato ? o.kalenderDato+' '+o.kalenderTid : 'Ikke i kalender'}</span>
              ${godkjentKortHTML(o)}
            </div>
          </div>`;
        }).join('') : `<div class="muted small" style="grid-column:1/-1">${sokTekst?'Ingen ordrer matcher søket':'Ingen aktive ordrer'}</div>`}
      </div>
    </div>`;
  if (sokFokusert) {
    const inp = document.getElementById('ordreSok');
    if (inp) { inp.value = gammelSok; inp.focus(); const pos = sokCursorPos ?? gammelSok.length; inp.setSelectionRange(pos, pos); }
  }
}

// ════════════════════════════════════════════════════
// OVERSIKT
// ════════════════════════════════════════════════════
function renderOversikt(q) {
  q = q || (document.getElementById('sokInput')||{}).value || '';
  const now = new Date();
  const mnd = now.getMonth(), yr = now.getFullYear();
  const denneMnd = S.ordrer.filter(o=>{const d=new Date(o.ankomstdato);return d.getMonth()===mnd&&d.getFullYear()===yr;});
  document.getElementById('s1').textContent = denneMnd.length;
  document.getElementById('s2').textContent = S.ordrer.filter(o=>o.status==='aktiv'&&['klar_henting','bestilt_frakt','hentet'].includes(o.ordreStatus)).length;
  document.getElementById('s3').textContent = S.ordrer.filter(o=>o.status==='aktiv'&&['paabegynt','ikke_veid','klar_visning','vist_biltilsyn'].includes(o.ordreStatus)).length;

  const match = o => !q || ordreLabel(o).toLowerCase().includes(q.toLowerCase())||(o.chassis||'').toLowerCase().includes(q.toLowerCase())||(o.kunde||'').toLowerCase().includes(q.toLowerCase())||(o.eier||'').toLowerCase().includes(q.toLowerCase());
  const aktive  = S.ordrer.filter(o=>o.status==='aktiv'&&['paabegynt','ikke_veid','klar_visning','vist_biltilsyn'].includes(o.ordreStatus)&&match(o)).sort(sorterOrdre);
  const pending = S.ordrer.filter(o=>o.status==='aktiv'&&(o.ordreStatus==='ikke_paabegynt'||o.ordreStatus==='paa_vei')&&match(o)).sort(sorterOrdre);

  const activeEl = document.getElementById('activeList');
  const activeElHarFokusertValg = activeEl.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
  if (!activeElHarFokusertValg) activeEl.innerHTML = aktive.length
    ? aktive.map(o => {
        const si = statusInfo(o.ordreStatus);
        return `<div class="drag-card" onpointerdown="dragOrdreStart(event,'${o.id}')" style="position:relative;background:#111114;border:2px solid ${o.prioritert?'#facc15':si.border};border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:6px;min-width:0">
          ${o.prioritert?'<span style="position:absolute;top:-9px;left:12px;background:#111114;padding:0 6px;font-size:10px;font-weight:700;color:#facc15;letter-spacing:.03em">PRIORITERT</span>':''}
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
            <b style="cursor:pointer" onclick="openOrdre('${o.id}')">${ordreLabelFull(o)}</b>
            ${statusDropdown(o.id, o.ordreStatus)}
          </div>
          <div style="display:flex;justify-content:flex-start">${hengerfesteKortHTML(o)}</div>
          <div class="small muted" onclick="openOrdre('${o.id}')" style="cursor:pointer">Ankomst: ${o.ankomstdato||'—'}</div>
          <div class="small muted" onclick="openOrdre('${o.id}')" style="cursor:pointer">${o.utstyr?.skalHa?o.utstyr.skalHa.replace(/\n/g,', '):'—'}</div>
          <div class="small" onclick="openOrdre('${o.id}')" style="cursor:pointer">${o.kalenderDato?'📅 '+o.kalenderDato+' '+o.kalenderTid:'Ikke i kalender'}</div>
        </div>`;
      }).join('')
    : '<div class="muted small">Ingen aktive ordrer i kalender</div>';

  const pendEl = document.getElementById('pendingList');
  const pendElHarFokusertValg = pendEl.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
  if (!pendElHarFokusertValg) pendEl.innerHTML = pending.length
    ? pending.map(o => {
        const si = statusInfo(o.ordreStatus);
        return `<div class="drag-card" onpointerdown="dragOrdreStart(event,'${o.id}')" style="position:relative;background:#111114;border:2px solid ${o.prioritert?'#facc15':si.border};border-radius:16px;padding:12px;min-width:0">
          ${o.prioritert?'<span style="position:absolute;top:-9px;left:12px;background:#111114;padding:0 6px;font-size:10px;font-weight:700;color:#facc15;letter-spacing:.03em">PRIORITERT</span>':''}
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px">
            <b>${ordreLabelFull(o)}</b>
            ${statusDropdown(o.id, o.ordreStatus)}
          </div>
          <div style="display:flex;justify-content:flex-start">${hengerfesteKortHTML(o)}</div>
          ${o.ankomstdato?`<div class="small muted">Ankomst: ${o.ankomstdato}</div>`:''}
          ${o.utstyr?.skalHa?`<div class="small muted" style="margin-top:2px">${o.utstyr.skalHa.replace(/\n/g,', ')}</div>`:''}
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn sm" onclick="openOrdre('${o.id}')">Åpne</button>
            <button class="btn sm red" onclick="openFlytt('${o.id}')">Flytt til kalender</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="muted small">Ingen ventende ordrer</div>';

  renderWeek();
}

function calNaviger(dir) { calWeekOffset += dir; renderWeek(); }
function calIdag()       { calWeekOffset = 0;    renderWeek(); }

function renderWeek() {
  const el = document.getElementById('weekCal');
  const DAY_NAMES = ['Mandag','Tirsdag','Onsdag','Torsdag','Fredag'];
  const START_H = 7, END_H = 16;
  const SLOT_PX = 28;
  const HOUR_PX = SLOT_PX * 2;

  const now = new Date();
  const base = new Date(now);
  base.setDate(now.getDate() + calWeekOffset * 7);
  const mon = new Date(base);
  const dow = base.getDay();
  mon.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1));

  const dates = DAY_NAMES.map((_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return d;
  });
  const todayStr = now.toISOString().split('T')[0];
  const nowFrac  = now.getHours() + now.getMinutes() / 60;
  const nowTop   = Math.max(0, (nowFrac - (START_H + 0.5)) * HOUR_PX);

  // Date range label e.g. "21.–25. april 2026"
  const fri = dates[4];
  const mndNavn = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  const rangeLabel = mon.getDate()+'.'+(mon.getMonth()!==fri.getMonth()?' '+mndNavn[mon.getMonth()]:'')+' – '+fri.getDate()+'. '+mndNavn[fri.getMonth()]+' '+fri.getFullYear();

  const slots30 = [];
  for (let h = START_H; h < END_H; h++) {
    if (h === START_H) {
      slots30.push({h, m:30, label:`${String(h).padStart(2,'0')}:30`});
    } else {
      slots30.push({h, m:0,  label:`${String(h).padStart(2,'0')}:00`});
      slots30.push({h, m:30, label:''});
    }
  }
  const START_MIN = START_H * 60 + 30; // 07:30

  const timeCol = slots30.map(s =>
    `<div class="cal-hour-lbl" style="height:${SLOT_PX}px">${s.label}</div>`
  ).join('');

  const dayCols = dates.map((dt) => {
    const ds      = dt.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    const orders  = S.ordrer.filter(o => o.kalenderDato === ds && o.status === 'aktiv');
    const moter   = (S.moter||[]).filter(m => m.dato === ds);

    const slotEls = slots30.map(s => {
      const tid = `${String(s.h).padStart(2,'0')}:${s.m===0?'00':'30'}`;
      return `<div class="cal-slot" data-dato="${ds}" data-tid="${tid}" style="height:${SLOT_PX}px"></div>`;
    }).join('');

    const nowLine = (isToday && nowFrac >= START_H && nowFrac <= END_H)
      ? `<div class="cal-now" style="top:${nowTop}px"></div>` : '';

    const events = orders.map(o => {
      const si = statusInfo(o.ordreStatus);
      const [oh, om] = (o.kalenderTid || '09:00').split(':').map(Number);
      const top    = Math.max(0, (oh + om / 60 - (START_H + 0.5)) * HOUR_PX);
      const height = (o.regnr && !o.chassis) ? Math.max(36, SLOT_PX) : Math.max(42, SLOT_PX); // nok plass til lengre tekst (regnr + chassis) på 2 linjer, uten tomrom
      return `<div class="cal-event" onpointerdown="dragOrdreStart(event,'${o.id}')" style="top:${top}px;height:${height}px;background:${si.bg};border-color:${si.border}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;height:100%">
          <div onclick="openOrdre('${o.id}')" style="cursor:pointer;flex:1;min-width:0">
            <div class="cal-event-regnr" style="color:${si.txt}">${ordreLabelFull(o)}</div>
            <div class="cal-event-info" style="color:${si.txt};opacity:0.8">${o.kalenderTid} · ${statusInfo(o.ordreStatus).lbl}</div>
          </div>
          <div style="position:relative;flex-shrink:0">
            <button onclick="event.stopPropagation();toggleCalMenu('${o.id}')" style="background:none;border:none;color:${si.txt};font-size:18px;line-height:1;padding:0 2px;cursor:pointer" title="Valg">⋯</button>
            <div id="calMenu_${o.id}" style="display:none;position:absolute;top:22px;right:0;background:#18181b;border:1px solid #3f3f46;border-radius:12px;padding:6px;z-index:200;min-width:150px;box-shadow:0 4px 20px #000a">
              <button onclick="event.stopPropagation();closeCalMenu();openFlyttKalender('${o.id}')" style="display:block;width:100%;text-align:left;background:none;border:none;color:#f4f4f5;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#27272a'" onmouseout="this.style.background='none'">✎ Flytt</button>
              <button onclick="event.stopPropagation();closeCalMenu();fjernFraKalender('${o.id}')" style="display:block;width:100%;text-align:left;background:none;border:none;color:#fca5a5;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#27272a'" onmouseout="this.style.background='none'">✕ Fjern fra kalender</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const moteEvents = moter.map(m => {
      const [mh, mm] = (m.tid || '09:00').split(':').map(Number);
      const top = Math.max(0, (mh + mm / 60 - (START_H + 0.5)) * HOUR_PX);
      return `<div class="cal-event" style="top:${top}px;height:${Math.max(42,SLOT_PX)}px;background:#2e1065cc;border-color:#a78bfa">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;height:100%">
          <div style="flex:1;min-width:0">
            <div class="cal-event-regnr" style="color:#ddd6fe">📅 ${m.tittel}</div>
            <div class="cal-event-info" style="color:#ddd6fe;opacity:0.8">${m.tid} · Møte</div>
          </div>
          <button onclick="event.stopPropagation();slettMote('${m.id}')" style="background:none;border:none;color:#ddd6fe;font-size:16px;line-height:1;padding:0 2px;cursor:pointer" title="Slett møte">✕</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="cal-day-col${isToday?' cal-today-col':''}">${slotEls}${nowLine}${events}${moteEvents}</div>`;
  }).join('');

  const headCols = dates.map((dt, i) => {
    const ds      = dt.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    return `<div class="cal-col-head${isToday?' cal-today':''}">
      <div class="cal-day-name">${DAY_NAMES[i]}</div>
      <div class="cal-day-num${isToday?' cal-today-num':''}">${dt.getDate()}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <button class="btn sm" onclick="calNaviger(-1)">◀</button>
    <button class="btn sm" onclick="calIdag()">I dag</button>
    <button class="btn sm" onclick="calNaviger(1)">▶</button>
    <span class="small muted" style="margin-left:4px">${rangeLabel}</span>
  </div>
  <div class="cal-wrap">
    <div class="cal-head"><div class="cal-gutter"></div>${headCols}</div>
    <div class="cal-body-scroll">
      <div class="cal-body">
        <div class="cal-times">${timeCol}</div>
        <div class="cal-cols">${dayCols}</div>
      </div>
    </div>
  </div>`;
}

async function endreStatus(id, nyStatus) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  const forrigeStatus = o.ordreStatus;
  const forrigeArkivStatus = o.status;
  const forrigeEndringer = [...o.endringer];
  o.ordreStatus = nyStatus;
  // Ordren arkiveres automatisk når den er hentet
  if (nyStatus === 'hentet') o.status = 'arkivert';
  logChange(o, 'Status endret til: ' + statusInfo(nyStatus).lbl + (nyStatus==='hentet'?' (arkivert automatisk)':''));
  if (document.activeElement?.tagName === 'SELECT') document.activeElement.blur();
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  // Målrettet oppdatering av kun disse feltene - IKKE via den generelle
  // save(), slik at denne handlingen aldri kan overskrives av en gammel
  // kopi av ordren som lagres fra et annet sted i appen.
  let feil = null;
  if (db) {
    // Push-varsel sendes av databasetriggeren "ordre-push" (AFTER UPDATE på ordrer),
    // ikke herfra - ellers sendes varselet dobbelt.
    const { error } = await db.from('ordrer').update({ordre_status:o.ordreStatus, status:o.status, endringer:o.endringer}).eq('id', id);
    if (error) feil = error.message;
  }
  if (feil) {
    o.ordreStatus = forrigeStatus;
    o.status = forrigeArkivStatus;
    o.endringer = forrigeEndringer;
    visToast('Kunne ikke endre status: ' + feil + ' — prøv igjen.');
    return;
  }
  renderAll();
  if (activeOrdreId===id) buildOrdreDetail();
}

function statusDropdown(ordreId, currentStatus, extraStyle='') {
  const si = statusInfo(currentStatus);
  return `<select onchange="endreStatus('${ordreId}',this.value)" style="background:${si.bg};color:${si.txt};border:2px solid ${si.border};border-radius:10px;padding:5px 8px;font-size:12px;font-weight:700;cursor:pointer;width:auto;${extraStyle}">
    ${STATUSER.map(s=>`<option value="${s.id}" ${s.id===currentStatus?'selected':''}>${s.lbl}</option>`).join('')}
  </select>`;
}

function hengerfesteMontertDropdown(ordreId, montert) {
  const erMontert = montert === 'montert';
  return `<select onchange="settHengerfesteMontert('${ordreId}',this.value)" style="background:${erMontert?'#052e1688':'#42200688'};color:${erMontert?'#86efac':'#fef08a'};border:2px solid ${erMontert?'#22c55e':'#facc15'};border-radius:10px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;width:auto">
    <option value="ikke_montert" ${erMontert?'':'selected'}>Ikke montert</option>
    <option value="montert" ${erMontert?'selected':''}>Montert</option>
  </select>`;
}
function settHengerfesteMontert(id, val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.utstyr.hengerfesteMontert = val;
  logChange(o, 'Hengerfeste: ' + (val==='montert'?'Montert':'Ikke montert'));
  // Push-varsel sendes av databasetriggeren "ordre-push" (AFTER UPDATE på ordrer),
  // ikke herfra - ellers sendes varselet dobbelt.
  save(id); renderAll();
}
function hengerfesteKortHTML(o) {
  return o.utstyr?.hengerfeste==='hengerfeste' ? `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
    <span class="pill warn" style="font-size:11px;margin:0">Hengerfeste</span>
    ${hengerfesteMontertDropdown(o.id, o.utstyr?.hengerfesteMontert)}
  </div>` : '';
}

function dokStatusFarge(verdi) {
  if (verdi==='har') return {bg:'#052e1688', txt:'#86efac', border:'#22c55e'};
  if (verdi==='etterspurt') return {bg:'#42200688', txt:'#fef08a', border:'#facc15'};
  return {bg:'#450a0a88', txt:'#fca5a5', border:'#ef4444'}; // har_ikke
}
function dokStatusDropdown(ordreId, felt, verdi) {
  verdi = verdi || 'har_ikke';
  const f = dokStatusFarge(verdi);
  return `<select onchange="sf('${ordreId}','${felt}',this.value)" style="background:${f.bg};color:${f.txt};border:2px solid ${f.border};border-radius:10px;padding:7px 10px;font-size:13px;font-weight:700;cursor:pointer">
    <option value="har_ikke" ${verdi==='har_ikke'?'selected':''}>Har ikke</option>
    <option value="etterspurt" ${verdi==='etterspurt'?'selected':''}>Etterspurt</option>
    <option value="har" ${verdi==='har'?'selected':''}>Har</option>
  </select>`;
}
function dokStatusPillHTML(label, verdi) {
  verdi = verdi || 'har_ikke';
  const f = dokStatusFarge(verdi);
  const kort = verdi==='har_ikke' ? 'Mangler' : (verdi==='etterspurt' ? 'Etterspurt' : 'OK');
  return `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:${f.bg};color:${f.txt};border:1px solid ${f.border};white-space:nowrap">${label}: ${kort}</span>`;
}
function dokStatusKortHTML(o) {
  return `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">${dokStatusPillHTML('COC', o.coc)}${dokStatusPillHTML('Fullmakt', o.fullmakt)}</div>`;
}
function godkjentKortHTML(o) {
  return `<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${o.godkjentBiltilsyn?'#86efac':'#a1a1aa'};cursor:pointer;flex-shrink:0">
    Vedtak
    <input type="checkbox" ${o.godkjentBiltilsyn?'checked':''} onchange="toggleGodkjentBiltilsyn('${o.id}')" style="width:14px;height:14px;accent-color:#22c55e;cursor:pointer">
  </label>`;
}

let _dragOrdre = null;
let _dragScrollRAF = null;
let _longPressTimer = null;
function dragOrdreStart(e, id) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.closest('button, select, input, a, textarea')) return;
  const startX = e.clientX, startY = e.clientY;

  if (e.pointerType === 'touch') {
    // Vent på et lite trykk-og-hold før vi griper ordren, ellers blir
    // vanlig rulling i listen tolket som at man vil dra en ordre.
    const onEarlyMove = ev => { if (Math.hypot(ev.clientX-startX, ev.clientY-startY) > 10) cancelArm(); };
    const cancelArm = () => {
      clearTimeout(_longPressTimer);
      document.removeEventListener('pointermove', onEarlyMove);
      document.removeEventListener('pointerup', cancelArm);
    };
    document.addEventListener('pointermove', onEarlyMove);
    document.addEventListener('pointerup', cancelArm);
    _longPressTimer = setTimeout(() => { cancelArm(); armDrag(id, startX, startY); }, 350);
  } else {
    e.preventDefault();
    armDrag(id, startX, startY);
  }
}
function armDrag(id, startX, startY) {
  _dragOrdre = { id, startX, startY, x: startX, y: startY, moved: false, ghostEl: null };
  document.addEventListener('pointermove', dragOrdreMove);
  document.addEventListener('pointerup', dragOrdreEnd);
  _dragScrollRAF = setInterval(dragAutoScroll, 16);
}
function dragOrdreMove(e) {
  if (!_dragOrdre) return;
  e.preventDefault();
  _dragOrdre.x = e.clientX; _dragOrdre.y = e.clientY;
  const dx = e.clientX - _dragOrdre.startX, dy = e.clientY - _dragOrdre.startY;
  if (!_dragOrdre.moved && Math.hypot(dx, dy) > 8) {
    _dragOrdre.moved = true;
    const o = S.ordrer.find(x => x.id === _dragOrdre.id);
    const si = statusInfo(o?.ordreStatus);
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.style.borderColor = si.border;
    g.style.background = si.bg;
    g.style.color = si.txt;
    g.textContent = '📅 ' + (o ? ordreLabel(o) : 'Ordre');
    document.body.appendChild(g);
    _dragOrdre.ghostEl = g;
    document.body.style.userSelect = 'none';
  }
  if (_dragOrdre.moved) {
    _dragOrdre.ghostEl.style.left = e.clientX + 'px';
    _dragOrdre.ghostEl.style.top = e.clientY + 'px';
    document.querySelectorAll('.cal-slot.drag-over').forEach(s => s.classList.remove('drag-over'));
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cal-slot');
    if (slot) slot.classList.add('drag-over');
  }
}
function dragAutoScroll() {
  if (!_dragOrdre || !_dragOrdre.moved) return;
  const EDGE = 90, MAX_SPEED = 16;
  const y = _dragOrdre.y, h = window.innerHeight;
  if (y < EDGE)          window.scrollBy(0, -MAX_SPEED * (1 - y / EDGE));
  else if (y > h - EDGE) window.scrollBy(0,  MAX_SPEED * (1 - (h - y) / EDGE));
}
function dragOrdreEnd(e) {
  document.removeEventListener('pointermove', dragOrdreMove);
  document.removeEventListener('pointerup', dragOrdreEnd);
  if (_dragScrollRAF) { clearInterval(_dragScrollRAF); _dragScrollRAF = null; }
  if (!_dragOrdre) return;
  const { id, moved, ghostEl } = _dragOrdre;
  if (ghostEl) ghostEl.remove();
  document.body.style.userSelect = '';
  document.querySelectorAll('.cal-slot.drag-over').forEach(s => s.classList.remove('drag-over'));
  if (moved) {
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cal-slot');
    const o = S.ordrer.find(x => x.id === id);
    if (slot && o) {
      o.kalenderDato = slot.dataset.dato;
      o.kalenderTid  = slot.dataset.tid;
      logChange(o, 'Flyttet til kalender (dra): ' + o.kalenderDato + ' ' + o.kalenderTid);
      save(id); renderAll();
    }
  }
  _dragOrdre = null;
}

let _openCalMenu = null;
function toggleCalMenu(id) {
  const el = document.getElementById('calMenu_'+id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  closeCalMenu();
  if (!isOpen) { el.style.display = 'block'; _openCalMenu = id; }
}
function closeCalMenu() {
  if (_openCalMenu) {
    const el = document.getElementById('calMenu_'+_openCalMenu);
    if (el) el.style.display = 'none';
    _openCalMenu = null;
  }
}
document.addEventListener('click', closeCalMenu);

function fjernFraKalender(id) {
  const o = S.ordrer.find(x => x.id === id); if (!o) return;
  o.kalenderDato = ''; o.kalenderTid = '';
  logChange(o, 'Fjernet fra kalender');
  save(id); renderOversikt();
}

function openFlyttKalender(id) {
  flyttOrdreId = id;
  const o = S.ordrer.find(x => x.id === id);
  if (o && o.kalenderDato) {
    document.getElementById('fl_dato').value = o.kalenderDato;
    document.getElementById('fl_tid').value  = o.kalenderTid || '09:00';
  }
  openModal('flytt');
}

