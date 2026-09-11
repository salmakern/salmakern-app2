// ════════════════════════════════════════════════════
// VARELAGER
// ════════════════════════════════════════════════════
let aktivVareId = null;

function fmtAntall(n) {
  n = Number(n)||0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/,'');
}

function erLavBeholdning(v) {
  return v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt;
}

// Lav beholdning øverst, deretter egen (manuelt satt) rekkefølge innad i hver gruppe
function sorterLagerVarer(a, b) {
  const lavA = erLavBeholdning(a), lavB = erLavBeholdning(b);
  if (lavA !== lavB) return lavA ? -1 : 1;
  return (a.rekkefolge||0) - (b.rekkefolge||0) || a.navn.localeCompare(b.navn,'no');
}

// Flytter en vare opp/ned i sin kategori (retning: -1 opp, 1 ned). Normaliserer
// rekkefølge til nåværende visningsposisjon først, slik at flyttingen alltid gir
// en synlig endring uansett hvilken rekkefølge-verdi varene hadde fra før.
function flyttVare(id, retning) {
  if (!aktivKategori) return;
  const gruppevarer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori')===aktivKategori && (v.modell||'')===(aktivModell||'')).sort(sorterLagerVarer);
  const i = gruppevarer.findIndex(v=>v.id===id);
  const j = i + retning;
  if (i<0 || j<0 || j>=gruppevarer.length) return;
  if (erLavBeholdning(gruppevarer[i]) !== erLavBeholdning(gruppevarer[j])) return; // ikke flytt over lav/ikke-lav-skillet
  gruppevarer.forEach((v, idx) => { v.rekkefolge = idx; });
  const tmp = gruppevarer[i].rekkefolge; gruppevarer[i].rekkefolge = gruppevarer[j].rekkefolge; gruppevarer[j].rekkefolge = tmp;
  // Én samlet upsert i stedet for én update-kall per vare - mange samtidige
  // enkeltkall til Supabase viste seg upålitelig (noen av dem forsvant stille).
  if (db) db.from('lagervarer').upsert(gruppevarer.map(v=>({id:v.id, rekkefolge:v.rekkefolge})), {onConflict:'id'})
    .then(r=>{if(r.error) console.error('Rekkefølge-oppdatering feilet:', r.error.message);});
  renderKategoriDetalj();
}

function oppdaterLagerVarselBadge() {
  const el = document.getElementById('lagerVarselBadge');
  if (!el) return;
  const varer = S.lagervarer||[];
  const lave = varer.filter(erLavBeholdning);
  const modeller = new Set(varer.map(v=>v.modell).filter(Boolean)).size;
  const deler = [
    `${varer.length} vare${varer.length===1?'':'r'}`,
    modeller ? `${modeller} modell${modeller===1?'':'er'}` : null,
    lave.length ? `<span style="color:#fca5a5">${lave.length} under minimum</span>` : null
  ].filter(Boolean);
  el.innerHTML = deler.join(' · ');
}

let aktivKategori = null;
let aktivModell = null; // satt når man er inne i en modells underkategorier (f.eks. "EV9"), ellers null

// Delt av renderLagerListe() (flate kategorier uten modell) og renderModellDetalj()
// (underkategorier for én modell) - samme boks-utseende begge steder.
function kategoriBoksHTML(kat, varerIKat, onclickAttr) {
  const lavtIKat = varerIKat.filter(erLavBeholdning).length;
  const sumEnheter = varerIKat.reduce((s,v)=>s+(Number(v.antall)||0),0);
  const sumMin = varerIKat.reduce((s,v)=>s+(Number(v.minAntall)||0),0);
  const pct = sumMin>0 ? sumEnheter/sumMin*100 : 100;            // til farge
  const fyllPct = sumMin>0 ? Math.max(4, Math.min(100, pct)) : 100; // til bredde
  const stripeFarge = sumMin===0 ? '#3f3f46' : (pct<=100 ? '#ef4444' : (pct<150 ? '#facc15' : '#22c55e'));
  return `<div class="box" style="cursor:pointer;border-color:${lavtIKat?'rgba(239,68,68,.3)':'#27272a'}" onclick="${onclickAttr}">
    <div class="row">
      <b>${esc(kat)}</b>
      ${lavtIKat?`<span class="pill bad" style="margin:0;font-size:11px">${lavtIKat} lavt</span>`:'<span style="color:#a1a1aa">›</span>'}
    </div>
    <div class="small muted" style="margin-top:2px">${varerIKat.length} vare${varerIKat.length===1?'':'r'} · ${fmtAntall(sumEnheter)} enheter</div>
    <div style="margin-top:9px;height:4px;border-radius:999px;background:#0f0f12;overflow:hidden">
      <div style="height:100%;width:${fyllPct}%;background:${stripeFarge};border-radius:999px"></div>
    </div>
    ${sumMin>0?`<div class="small muted" style="margin-top:4px;font-size:11px">${Math.round(pct)}% av samlet minimum (${fmtAntall(sumMin)})</div>`:''}
  </div>`;
}
function modellBoksHTML(modell, varerIModell) {
  const antallKat = new Set(varerIModell.map(v=>v.kategori||'Uten kategori')).size;
  const lavt = varerIModell.filter(erLavBeholdning).length;
  const sumEnheter = varerIModell.reduce((s,v)=>s+(Number(v.antall)||0),0);
  const sumMin = varerIModell.reduce((s,v)=>s+(Number(v.minAntall)||0),0);
  const pct = sumMin>0 ? sumEnheter/sumMin*100 : 100;
  const fyllPct = sumMin>0 ? Math.max(4, Math.min(100, pct)) : 100;
  const stripeFarge = sumMin===0 ? '#3f3f46' : (pct<=100 ? '#ef4444' : (pct<150 ? '#facc15' : '#22c55e'));
  return `<div class="box" style="cursor:pointer;border-color:${lavt?'rgba(239,68,68,.3)':'#27272a'}" onclick="visModellDetalj('${esc(modell).replace(/'/g,"\\'")}')">
    <div class="row">
      <b>${esc(modell)}</b>
      ${lavt?`<span class="pill bad" style="margin:0;font-size:11px">${lavt} lavt</span>`:'<span style="color:#a1a1aa">›</span>'}
    </div>
    <div class="small muted" style="margin-top:2px">${antallKat} underkategori${antallKat===1?'':'er'} · ${varerIModell.length} vare${varerIModell.length===1?'':'r'} · ${fmtAntall(sumEnheter)} enheter</div>
    <div style="margin-top:9px;height:4px;border-radius:999px;background:#0f0f12;overflow:hidden">
      <div style="height:100%;width:${fyllPct}%;background:${stripeFarge};border-radius:999px"></div>
    </div>
    ${sumMin>0?`<div class="small muted" style="margin-top:4px;font-size:11px">${Math.round(pct)}% av samlet minimum</div>`:''}
  </div>`;
}

function renderLagerListe() {
  oppdaterLagerVarselBadge();
  const el = document.getElementById('lagerListe');
  const sok = (document.getElementById('lagerSokInput')?.value||'').toLowerCase().trim();
  let varer = (S.lagervarer||[]).slice().sort(sorterLagerVarer);

  const dlKat = document.getElementById('lagerKategoriListe');
  if (dlKat) {
    const alleKat = [...new Set((S.lagervarer||[]).map(v=>v.kategori).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'no'));
    dlKat.innerHTML = alleKat.map(k=>`<option value="${esc(k)}">`).join('');
  }
  const dlModell = document.getElementById('lagerModellListe');
  if (dlModell) {
    const alleModeller = [...new Set((S.lagervarer||[]).map(v=>v.modell).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'no'));
    dlModell.innerHTML = alleModeller.map(m=>`<option value="${esc(m)}">`).join('');
  }

  if (sok) {
    // Ved søk: vis treffene direkte, uten å måtte inn i en kategori/modell
    varer = varer.filter(v => v.navn.toLowerCase().includes(sok) || (v.kategori||'').toLowerCase().includes(sok) || (v.modell||'').toLowerCase().includes(sok) || (v.tegningsnummer||'').toLowerCase().includes(sok));
    el.innerHTML = varer.length
      ? `<div class="small muted" style="margin-bottom:10px">${varer.length} treff på «${esc(sok)}»</div><div class="lager-grid">${varer.map(v => vareBoksHTML(v, false, true)).join('')}</div>`
      : `<div class="box" style="text-align:center;padding:24px">
           <div class="muted small">Ingen varer matcher «${esc(sok)}»</div>
           <button class="btn sm red" style="margin-top:10px" onclick="apneNyVare()">+ Opprett «${esc(sok)}» som ny vare</button>
         </div>`;
    return;
  }

  if (!varer.length) { el.innerHTML = '<div class="card"><div class="muted small">Ingen varer i lageret ennå</div></div>'; return; }

  // To nivåer: varer MED modell (f.eks. "EV9") grupperes først på modell - trykker du inn
  // på en modell, ser du KUN dens underkategorier (kategori-feltet). Varer UTEN modell
  // (generelle deler som ikke hører til én bestemt bil) vises som før, direkte som flate
  // kategori-bokser.
  const medModell = varer.filter(v => v.modell);
  const utenModell = varer.filter(v => !v.modell);

  const modellGrupper = {};
  medModell.forEach(v => { (modellGrupper[v.modell] = modellGrupper[v.modell] || []).push(v); });
  const modeller = Object.keys(modellGrupper).sort((a,b)=>a.localeCompare(b,'no'));

  const katGrupper = {};
  utenModell.forEach(v => { const k = v.kategori || 'Uten kategori'; (katGrupper[k] = katGrupper[k] || []).push(v); });
  const kategorier = Object.keys(katGrupper).sort((a,b)=> a==='Uten kategori'?1 : b==='Uten kategori'?-1 : a.localeCompare(b,'no'));

  const seksjon = (tittel, antall, innhold, forste) => `
    <div style="display:flex;align-items:center;gap:11px;margin:${forste?'14px':'22px'} 0 9px">
      <span style="font-size:10.5px;letter-spacing:.14em;color:#71717a">${tittel}</span>
      <span style="font-size:11px;color:#52525b">${antall}</span>
      <span style="flex:1;height:1px;background:#27272a"></span>
    </div>
    <div class="lager-grid">${innhold}</div>`;

  const hint = (!modeller.length && kategorier.length)
    ? `<div class="box" style="margin-top:14px;padding:11px 14px">
         <div class="small muted">Fyll inn <b>Modell</b> på en vare for å gruppere den under en bilmodell med egne underkategorier.</div>
       </div>` : '';

  el.innerHTML = hint +
    (modeller.length ? seksjon('MODELLER', modeller.length, modeller.map(m=>modellBoksHTML(m, modellGrupper[m])).join(''), true) : '') +
    (kategorier.length ? seksjon('KATEGORIER', kategorier.length, kategorier.map(kat=>kategoriBoksHTML(kat, katGrupper[kat], `visKategoriDetalj('','${esc(kat).replace(/'/g,"\\'")}')`)).join(''), !modeller.length) : '');
}

function vareBoksHTML(v, kanFlytte, visKontekst) {
  const lavt = erLavBeholdning(v);
  const bestilt = !!v.bestilt;
  const harMin = v.minAntall > 0;
  // Hvor langt under minimum: gir "mangler 6" i stedet for bare "lavt"
  const mangler = harMin && v.antall < v.minAntall ? v.minAntall - v.antall : 0;
  const pct = harMin ? (Number(v.antall)||0) / v.minAntall * 100 : 100;
  const fyllPct = harMin ? Math.max(3, Math.min(100, pct)) : 100;
  const stripeFarge = !harMin ? '#3f3f46' : (lavt ? '#ef4444' : (pct < 150 ? '#facc15' : '#22c55e'));

  return `<div class="box" style="position:relative;padding:14px;display:flex;flex-direction:column;gap:11px;border-color:${lavt?'rgba(239,68,68,.35)':(bestilt?'rgba(34,197,94,.3)':'#27272a')}">
    ${kanFlytte?`<div style="position:absolute;top:10px;right:10px;display:flex;flex-direction:column;gap:2px;z-index:1">
      <button onclick="event.stopPropagation();flyttVare('${v.id}',-1)" title="Flytt opp"
        style="background:#18181b;border:1px solid #27272a;color:#a1a1aa;border-radius:8px 8px 4px 4px;width:26px;height:19px;font-size:9px;line-height:1;padding:0;cursor:pointer">▲</button>
      <button onclick="event.stopPropagation();flyttVare('${v.id}',1)" title="Flytt ned"
        style="background:#18181b;border:1px solid #27272a;color:#a1a1aa;border-radius:4px 4px 8px 8px;width:26px;height:19px;font-size:9px;line-height:1;padding:0;cursor:pointer">▼</button>
    </div>`:''}

    <div onclick="visVareDetalj('${v.id}')" style="cursor:pointer;display:flex;flex-direction:column;gap:8px;${kanFlytte?'padding-right:34px':''}">
      <div style="min-width:0">
        <b style="font-size:15px">${esc(v.navn)}</b>
        ${visKontekst && (v.modell || v.kategori)
          ? `<div class="small" style="font-size:11px;color:#8f8f96;margin-top:2px">${[v.modell, v.kategori].filter(Boolean).map(esc).join(' › ')}</div>`
          : ''}
        ${v.tegningsnummer?`<div class="small muted" style="font-size:11.5px">${esc(v.tegningsnummer)}</div>`:''}
      </div>
      <div style="display:flex;align-items:baseline;gap:7px;flex-wrap:wrap">
        <span style="font-size:27px;font-weight:800;letter-spacing:-.6px;line-height:1;color:${lavt?'#fca5a5':'#f4f4f5'}">${fmtAntall(v.antall)}</span>
        <span class="muted" style="font-size:13px">${esc(v.enhet)}</span>
        ${bestilt?'<span class="pill ok" style="margin:0;font-size:11px;padding:3px 9px">✓ Bestilt</span>'
          :(mangler?`<span class="pill bad" style="margin:0;font-size:11px;padding:3px 9px">mangler ${fmtAntall(mangler)}</span>`:'')}
      </div>
      ${harMin?`<div>
        <div style="height:4px;border-radius:999px;background:#0f0f12;overflow:hidden">
          <div style="height:100%;width:${fyllPct}%;background:${stripeFarge};border-radius:999px"></div>
        </div>
        <div class="small muted" style="font-size:10.5px;margin-top:3px">min ${fmtAntall(v.minAntall)} ${esc(v.enhet)}</div>
      </div>`:''}
    </div>

    <div style="display:flex;gap:7px">
      <button onclick="event.stopPropagation();fyllPaLager('${v.id}')"
        style="flex:1;background:#18181b;border:1px solid #27272a;color:#4ade80;border-radius:14px;padding:9px;font-size:13px;cursor:pointer">+ Fyll på</button>
      <button onclick="event.stopPropagation();taUtFraLager('${v.id}')"
        style="flex:1;background:#18181b;border:1px solid #27272a;color:#fca5a5;border-radius:14px;padding:9px;font-size:13px;cursor:pointer">− Ta ut</button>
    </div>
  </div>`;
}

// Modell-oversikt (underkategoriene til én modell, f.eks. "EV9") - selve
// varelisten for hver underkategori vises fortsatt av renderKategoriDetalj().
function visModellDetalj(modell) {
  aktivModell = modell;
  document.getElementById('lagerListeView').style.display = 'none';
  document.getElementById('modellDetaljView').style.display = 'block';
  document.getElementById('kategoriDetaljView').style.display = 'none';
  document.getElementById('vareDetaljView').style.display = 'none';
  const sokInput = document.getElementById('modellDetaljSokInput');
  if (sokInput) sokInput.value = '';
  renderModellDetalj();
  window.scrollTo(0, 0);
}

function tilbakeFraModellDetalj() {
  aktivModell = null;
  document.getElementById('modellDetaljView').style.display = 'none';
  tilbakeLagerListe();
}

function renderModellDetalj() {
  if (!aktivModell) return;
  document.getElementById('modellDetaljTittel').textContent = aktivModell;
  const varer = (S.lagervarer||[]).filter(v => v.modell === aktivModell);
  const el = document.getElementById('modellKategoriListe');
  if (!varer.length) {
    el.innerHTML = `<div class="box" style="text-align:center;padding:24px">
      <div class="muted small">Ingen varer i denne modellen ennå</div>
      <button class="btn sm red" style="margin-top:10px" onclick="apneNyVareIKategori()">+ Legg til første vare</button>
    </div>`;
    return;
  }
  const laveIModell = varer.filter(erLavBeholdning);
  const modellVarsel = laveIModell.length ? `
    <div class="box" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;border-color:rgba(239,68,68,.35)">
      <span style="flex-shrink:0;width:32px;height:32px;border-radius:999px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.4);color:#fca5a5;display:flex;align-items:center;justify-content:center;font-weight:800">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#fca5a5;font-size:13.5px">${laveIModell.length} vare${laveIModell.length===1?'':'r'} under minimum</div>
        <div class="small muted">Fordelt på ${new Set(laveIModell.map(v=>v.kategori||'Uten kategori')).size} underkategori${new Set(laveIModell.map(v=>v.kategori||'Uten kategori')).size===1?'':'er'}</div>
      </div>
    </div>` : '';

  const sok = (document.getElementById('modellDetaljSokInput')?.value||'').toLowerCase().trim();
  if (sok) {
    const treff = varer.filter(v => v.navn.toLowerCase().includes(sok) || (v.kategori||'').toLowerCase().includes(sok) || (v.tegningsnummer||'').toLowerCase().includes(sok));
    el.innerHTML = modellVarsel + (treff.length
      ? `<div class="small muted" style="margin-bottom:10px">${treff.length} treff på «${esc(sok)}»</div><div class="lager-grid">${treff.map(v => vareBoksHTML(v, false, true)).join('')}</div>`
      : `<div class="box" style="text-align:center;padding:24px"><div class="muted small">Ingen varer matcher «${esc(sok)}»</div></div>`);
    return;
  }

  const grupper = {};
  varer.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
  const kategorier = Object.keys(grupper).sort((a,b)=> a==='Uten kategori'?1 : b==='Uten kategori'?-1 : a.localeCompare(b,'no'));
  const modellEsc = esc(aktivModell).replace(/'/g,"\\'");
  el.innerHTML = modellVarsel + `<div class="lager-grid">${kategorier.map(kat=>kategoriBoksHTML(kat, grupper[kat], `visKategoriDetalj('${modellEsc}','${esc(kat).replace(/'/g,"\\'")}')`)).join('')}</div>`;
}

function visKategoriDetalj(modell, kat) {
  aktivModell = modell || null;
  aktivKategori = kat;
  document.getElementById('lagerListeView').style.display = 'none';
  document.getElementById('modellDetaljView').style.display = 'none';
  document.getElementById('kategoriDetaljView').style.display = 'block';
  document.getElementById('vareDetaljView').style.display = 'none';
  const tilbakeBtn = document.getElementById('kategoriDetaljTilbakeBtn');
  if (tilbakeBtn) tilbakeBtn.textContent = aktivModell ? '← ' + aktivModell : '← Alle kategorier';
  const sokInput = document.getElementById('kategoriDetaljSokInput');
  if (sokInput) sokInput.value = '';
  renderKategoriDetalj();
  window.scrollTo(0, 0);
}

// Går tilbake til modellens underkategori-liste hvis vi kom derfra, ellers rett til
// hovedoversikten - se visKategoriDetalj() som setter aktivModell riktig i utgangspunktet.
function tilbakeFraKategoriDetalj() {
  aktivKategori = null;
  document.getElementById('kategoriDetaljView').style.display = 'none';
  if (aktivModell) {
    document.getElementById('modellDetaljView').style.display = 'block';
    renderModellDetalj();
  } else {
    tilbakeLagerListe();
  }
}

function renderKategoriDetalj() {
  if (!aktivKategori) return;
  document.getElementById('kategoriDetaljTittel').textContent = aktivModell ? `${aktivModell} – ${aktivKategori}` : aktivKategori;
  const varer = (S.lagervarer||[]).filter(v => (v.kategori || 'Uten kategori') === aktivKategori && (v.modell||'') === (aktivModell||'')).sort(sorterLagerVarer);
  const lave = varer.filter(erLavBeholdning);
  const el = document.getElementById('kategoriVareListe');

  if (!varer.length) {
    el.innerHTML = `<div class="box" style="text-align:center;padding:24px">
      <div class="muted small">Ingen varer i denne kategorien ennå</div>
      <button class="btn sm red" style="margin-top:10px" onclick="apneNyVareIKategori()">+ Legg til første vare</button>
    </div>`;
    return;
  }

  const varsel = lave.length ? `
    <div class="box" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;border-color:rgba(239,68,68,.35)">
      <span style="flex-shrink:0;width:32px;height:32px;border-radius:999px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.4);color:#fca5a5;display:flex;align-items:center;justify-content:center;font-weight:800">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#fca5a5;font-size:13.5px">${lave.length} vare${lave.length===1?'':'r'} under minimum</div>
        <div class="small muted">${lave.slice(0,3).map(v=>esc(v.navn)).join(', ')}${lave.length>3?` +${lave.length-3} til`:''}</div>
      </div>
      <div style="display:flex;gap:7px;flex-shrink:0">
        <button class="btn sm" onclick="apneBestillingslisteForKategori('${esc(aktivModell||'').replace(/'/g,"\\'")}','${esc(aktivKategori).replace(/'/g,"\\'")}')">📋 Bestillingsliste</button>
        <button class="btn sm" onclick="settKategoriBestilt('${esc(aktivKategori).replace(/'/g,"\\'")}','${esc(aktivModell||'').replace(/'/g,"\\'")}');renderKategoriDetalj()">✓ Merk bestilt</button>
      </div>
    </div>` : '';

  const sok = (document.getElementById('kategoriDetaljSokInput')?.value||'').toLowerCase().trim();
  const visVarer = sok ? varer.filter(v => v.navn.toLowerCase().includes(sok) || (v.tegningsnummer||'').toLowerCase().includes(sok)) : varer;
  const treffTekst = sok ? `<div class="small muted" style="margin-bottom:10px">${visVarer.length} treff på «${esc(sok)}»</div>` : '';
  const grid = visVarer.length
    ? `<div class="lager-grid">${visVarer.map(v => vareBoksHTML(v, !sok)).join('')}</div>`
    : `<div class="box" style="text-align:center;padding:24px"><div class="muted small">Ingen varer matcher «${esc(sok)}»</div></div>`;

  el.innerHTML = varsel + treffTekst + grid;
}

function apneNyVareIKategori() {
  apneNyVare();
  if (aktivModell) document.getElementById('nyVareModell').value = aktivModell;
  if (aktivKategori && aktivKategori !== 'Uten kategori') document.getElementById('nyVareKategori').value = aktivKategori;
}

// Kategori er bare et tekstfelt delt av flere varer - "å endre navn" betyr å
// oppdatere kategori-feltet på alle varene som har den, samlet sett.
function redigerKategoriNavn() {
  if (!aktivKategori) return;
  const naavaerende = aktivKategori === 'Uten kategori' ? '' : aktivKategori;
  const nyttNavn = prompt('Nytt navn på kategorien:', naavaerende);
  if (nyttNavn === null) return;
  const trimmet = nyttNavn.trim();
  const gammelKategori = aktivKategori;
  const varer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori') === gammelKategori && (v.modell||'') === (aktivModell||''));
  varer.forEach(v => { v.kategori = trimmet; });
  // Ett samlet kall for alle varene i kategorien i stedet for ett update-kall per vare
  // (samme upålitelighets-mønster som flyttVare()/registrerLagerEndring() løste likt).
  if (db && varer.length) db.from('lagervarer').upsert(varer.map(v=>({id:v.id, kategori:trimmet})), {onConflict:'id'})
    .then(r=>{if(r.error) console.error('Kategori-oppdatering feilet:', r.error.message);});
  aktivKategori = trimmet || 'Uten kategori';
  renderKategoriDetalj();
}

function apneNyVare() {
  document.getElementById('nyVareModalTittel').textContent = 'Ny vare';
  document.getElementById('redigerVareId').value = '';
  document.getElementById('nyVareNavn').value = '';
  document.getElementById('nyVareModell').value = '';
  document.getElementById('nyVareKategori').value = '';
  document.getElementById('nyVareTegningsnummer').value = '';
  document.getElementById('nyVareForventet').value = '';
  document.getElementById('nyVareForventetWrap').style.display = 'block';
  document.getElementById('nyVareAntallLabel').textContent = 'Mottatt antall';
  document.getElementById('nyVareAntall').value = '0';
  document.getElementById('nyVareAntall').disabled = false;
  document.getElementById('nyVareEnhet').value = 'stk';
  document.getElementById('nyVareMinAntall').value = '0';
  document.getElementById('nyVareNotat').value = '';
  openModal('nyVareModal');
}

function apneRedigerVare() {
  const v = (S.lagervarer||[]).find(x=>x.id===aktivVareId); if (!v) return;
  document.getElementById('nyVareModalTittel').textContent = 'Rediger vare';
  document.getElementById('redigerVareId').value = v.id;
  document.getElementById('nyVareNavn').value = v.navn;
  document.getElementById('nyVareModell').value = v.modell||'';
  document.getElementById('nyVareKategori').value = v.kategori||'';
  document.getElementById('nyVareTegningsnummer').value = v.tegningsnummer||'';
  document.getElementById('nyVareForventetWrap').style.display = 'none';
  document.getElementById('nyVareAntallLabel').textContent = 'Antall på lager';
  document.getElementById('nyVareAntall').value = v.antall;
  document.getElementById('nyVareAntall').disabled = true; // antall endres via Fyll på/Ta ut, ikke her
  document.getElementById('nyVareEnhet').value = v.enhet||'stk';
  document.getElementById('nyVareMinAntall').value = v.minAntall||0;
  document.getElementById('nyVareNotat').value = v.notat||'';
  openModal('nyVareModal');
}

function lagreVare() {
  const navn = document.getElementById('nyVareNavn').value.trim();
  if (!navn) { alert('Skriv inn et navn på varen'); return; }
  const redigerId  = document.getElementById('redigerVareId').value;
  const modell     = document.getElementById('nyVareModell').value.trim();
  const kategori   = document.getElementById('nyVareKategori').value.trim();
  const tegningsnummer = document.getElementById('nyVareTegningsnummer').value.trim();
  const enhet      = document.getElementById('nyVareEnhet').value.trim() || 'stk';
  const minAntall  = Number(document.getElementById('nyVareMinAntall').value) || 0;
  const notat      = document.getElementById('nyVareNotat').value.trim();

  if (redigerId) {
    const v = (S.lagervarer||[]).find(x=>x.id===redigerId); if (!v) return;
    v.navn = navn; v.modell = modell; v.kategori = kategori; v.tegningsnummer = tegningsnummer; v.enhet = enhet; v.minAntall = minAntall; v.notat = notat;
    if (db) db.from('lagervarer').update({navn, modell, kategori, tegningsnummer, enhet, min_antall:minAntall, notat}).eq('id', v.id)
      .then(r=>{if(r.error) console.error('Lagervare-oppdatering feilet:', r.error.message);});
    closeModal('nyVareModal');
    renderVareDetalj();
  } else {
    const antall = Number(document.getElementById('nyVareAntall').value) || 0;
    const forventet = Number(document.getElementById('nyVareForventet').value) || 0;
    const mangler = forventet > antall ? forventet - antall : 0;
    let notatMedAvvik = notat;
    if (mangler > 0) {
      const manglerTekst = `Forventet ${fmtAntall(forventet)}, mottatt ${fmtAntall(antall)} (mangler ${fmtAntall(mangler)} ${enhet})`;
      notatMedAvvik = notat ? notat + ' — ' + manglerTekst : manglerTekst;
    }
    const id = 'vare_' + Date.now();
    const vare = { id, navn, modell, kategori, tegningsnummer, antall, enhet, minAntall, notat:notatMedAvvik, createdAt:new Date().toISOString() };
    S.lagervarer = S.lagervarer || [];
    S.lagervarer.push(vare);
    if (db) db.from('lagervarer').insert({id, navn, modell, kategori, tegningsnummer, antall, enhet, min_antall:minAntall, notat:notatMedAvvik})
      .then(r=>{if(r.error) console.error('Lagervare-lagring feilet:', r.error.message);});
    if (mangler > 0) varselMangelfullLevering({navn, enhet}, forventet, antall, mangler);
    closeModal('nyVareModal');
    // Oppdater den visningen man faktisk står i - "+ Ny vare" kan trykkes fra
    // hovedoversikten, fra en modell (uten underkategori valgt ennå) og inne fra en
    // underkategori (apneNyVareIKategori()), og da må riktig av de tre oppdateres, ikke
    // den skjulte hovedoversikten (samme fiks som lagreLagerEndring() har for samme problem).
    if (document.getElementById('kategoriDetaljView')?.style.display === 'block') renderKategoriDetalj();
    else if (document.getElementById('modellDetaljView')?.style.display === 'block') renderModellDetalj();
    else renderLagerListe();
  }
}

function slettVare() {
  const v = (S.lagervarer||[]).find(x=>x.id===aktivVareId); if (!v) return;
  if (!confirm(`Slette "${v.navn}" fra varelageret? Historikken beholdes, men varen forsvinner fra listen.`)) return;
  S.lagervarer = (S.lagervarer||[]).filter(x=>x.id!==v.id);
  if (db) db.from('lagervarer').delete().eq('id', v.id)
    .then(r=>{if(r.error) console.error('Sletting av lagervare feilet:', r.error.message);});
  tilbakeLagerListe();
}

function visVareDetalj(id) {
  aktivVareId = id;
  document.getElementById('lagerListeView').style.display = 'none';
  document.getElementById('kategoriDetaljView').style.display = 'none';
  document.getElementById('vareDetaljView').style.display = 'block';
  document.getElementById('vareDetaljTilbakeBtn').textContent = aktivKategori ? '← ' + (aktivModell ? aktivModell+' – '+aktivKategori : aktivKategori) : '← Alle varer';
  renderVareDetalj();
  window.scrollTo(0, 0);
}

function tilbakeFraVareDetalj() {
  aktivVareId = null;
  if (aktivKategori) {
    document.getElementById('vareDetaljView').style.display = 'none';
    document.getElementById('kategoriDetaljView').style.display = 'block';
    renderKategoriDetalj();
  } else {
    tilbakeLagerListe();
  }
}

function tilbakeLagerListe() {
  aktivVareId = null;
  aktivKategori = null;
  aktivModell = null;
  oppskriftAktivModell = null;
  document.getElementById('lagerListeView').style.display = 'block';
  document.getElementById('modellDetaljView').style.display = 'none';
  document.getElementById('kategoriDetaljView').style.display = 'none';
  document.getElementById('vareDetaljView').style.display = 'none';
  document.getElementById('oppskriftModellerView').style.display = 'none';
  document.getElementById('oppskriftModellDetaljView').style.display = 'none';
  renderLagerListe();
}

function renderVareDetalj() {
  const v = (S.lagervarer||[]).find(x=>x.id===aktivVareId);
  if (!v) { tilbakeLagerListe(); return; }
  document.getElementById('vareDetaljNavn').textContent = v.navn;
  document.getElementById('vareDetaljUndertekst').textContent = [v.modell, v.kategori, v.tegningsnummer].filter(Boolean).join(' · ');
  document.getElementById('vareDetaljAntall').textContent = fmtAntall(v.antall);
  document.getElementById('vareDetaljEnhet').textContent = v.enhet;
  const lavtLager = v.minAntall > 0 && v.antall <= v.minAntall;
  document.getElementById('vareLavLagerVarsel').innerHTML = lavtLager
    ? `<span style="color:${v.bestilt?'#4ade80':'#f87171'}">${v.bestilt?'✓ Bestilt':'⚠ Lav beholdning'} (varsler ved ${fmtAntall(v.minAntall)} ${esc(v.enhet)})</span>
       <button class="btn sm" style="margin-left:8px;padding:2px 8px;font-size:11px" onclick="settVareBestilt('${v.id}',${!v.bestilt})">${v.bestilt?'Fjern bestilt-merking':'✓ Merk som bestilt'}</button>`
    : '';
  const boks = document.getElementById('vareAntallBoks');
  const antEl = document.getElementById('vareDetaljAntall');
  if (boks) boks.style.borderColor = lavtLager ? 'rgba(239,68,68,.35)' : '#27272a';
  if (antEl) antEl.style.color = lavtLager ? '#fca5a5' : '#f4f4f5';
  const notatBoks = document.getElementById('vareNotatBoks');
  const notatEl = document.getElementById('vareDetaljNotat');
  if (notatBoks && notatEl) {
    notatBoks.style.display = v.notat ? 'block' : 'none';
    notatEl.textContent = v.notat || '';
  }

  const historikk = (S.lagerhistorikk||[]).filter(h=>h.vareId===v.id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const el = document.getElementById('vareHistorikkListe');
  el.innerHTML = historikk.length ? historikk.slice(0,50).map(h => {
    const positiv = h.endring > 0;
    const o = h.ordreId ? S.ordrer.find(x=>x.id===h.ordreId) : null;
    const tid = h.createdAt ? new Date(h.createdAt).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="box" style="margin-bottom:6px;padding:11px 13px;display:flex;gap:12px;align-items:flex-start">
      <span style="flex-shrink:0;min-width:46px;text-align:center;padding:4px 8px;border-radius:10px;font-weight:800;font-size:14px;
        background:${positiv?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'};color:${positiv?'#4ade80':'#f87171'}">${positiv?'+':''}${fmtAntall(h.endring)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px">${esc(h.ansattNavn||'—')}<span class="muted small"> · ${tid}</span></div>
        ${h.kommentar?`<div class="small muted" style="margin-top:2px">${esc(h.kommentar)}</div>`:''}
        ${o?`<span class="pill" style="margin:5px 0 0;font-size:11px;padding:3px 10px">${ordreLabel(o)}</span>`:''}
      </div>
    </div>`;
  }).join('') : '<div class="box" style="text-align:center;padding:20px"><div class="muted small">Ingen historikk ennå</div></div>';
}

function fyllPaLager(vareId) {
  const id = vareId || aktivVareId; if (!id) return;
  const v = (S.lagervarer||[]).find(x=>x.id===id); if (!v) return;
  document.getElementById('lagerEndringTittel').textContent = 'Fyll på lager';
  document.getElementById('lagerEndringUndertekst').textContent = `${v.navn} · ${fmtAntall(v.antall)} ${v.enhet} på lager`;
  document.getElementById('lagerEndringVareId').value = id;
  document.getElementById('lagerEndringFortegn').value = '1';
  document.getElementById('lagerEndringAntall').value = '';
  document.getElementById('lagerEndringKommentar').value = '';
  document.getElementById('lagerEndringForventet').value = '';
  document.getElementById('lagerEndringForventetWrap').style.display = 'block';
  document.getElementById('lagerEndringAntallLabel').textContent = 'Mottatt antall';
  openModal('lagerEndringModal');
}
function taUtFraLager(vareId) {
  const id = vareId || aktivVareId; if (!id) return;
  const v = (S.lagervarer||[]).find(x=>x.id===id); if (!v) return;
  document.getElementById('lagerEndringTittel').textContent = 'Ta ut fra lager';
  document.getElementById('lagerEndringUndertekst').textContent = `${v.navn} · ${fmtAntall(v.antall)} ${v.enhet} på lager`;
  document.getElementById('lagerEndringVareId').value = id;
  document.getElementById('lagerEndringFortegn').value = '-1';
  document.getElementById('lagerEndringAntall').value = '';
  document.getElementById('lagerEndringKommentar').value = '';
  document.getElementById('lagerEndringForventetWrap').style.display = 'none';
  document.getElementById('lagerEndringAntallLabel').textContent = 'Antall';
  openModal('lagerEndringModal');
}
function lagreLagerEndring() {
  const vareId    = document.getElementById('lagerEndringVareId').value;
  const fortegn   = Number(document.getElementById('lagerEndringFortegn').value) || 1;
  const antallRaw = Number(document.getElementById('lagerEndringAntall').value);
  let   kommentar = document.getElementById('lagerEndringKommentar').value.trim();
  const forventetRaw = fortegn>0 ? (Number(document.getElementById('lagerEndringForventet').value) || 0) : 0;
  if (!antallRaw || antallRaw <= 0) { alert('Skriv inn et antall større enn 0'); return; }
  const v = (S.lagervarer||[]).find(x=>x.id===vareId); if (!v) return;
  const endring = fortegn * antallRaw;
  if (endring < 0 && v.antall + endring < 0) {
    alert(`Kan ikke ta ut ${fmtAntall(antallRaw)} ${v.enhet} - det er kun ${fmtAntall(v.antall)} igjen på lager.`);
    return;
  }
  // Kom det mindre enn forventet? Noter det i historikken og varsle, slik at
  // noen kan følge opp med leverandøren om resten av leveransen.
  const mangler = forventetRaw > antallRaw ? forventetRaw - antallRaw : 0;
  if (mangler > 0) {
    const manglerTekst = `Forventet ${fmtAntall(forventetRaw)}, mottatt ${fmtAntall(antallRaw)} (mangler ${fmtAntall(mangler)} ${v.enhet})`;
    kommentar = kommentar ? kommentar + ' — ' + manglerTekst : manglerTekst;
  }
  registrerLagerEndring(v, endring, endring>0?'inn':'ut', null, kommentar);
  if (mangler > 0) varselMangelfullLevering(v, forventetRaw, antallRaw, mangler);
  closeModal('lagerEndringModal');
  // Oppdater den visningen man faktisk står i
  if (document.getElementById('vareDetaljView')?.style.display === 'block') renderVareDetalj();
  else if (document.getElementById('kategoriDetaljView')?.style.display === 'block') renderKategoriDetalj();
  else renderLagerListe();
}

function varselMangelfullLevering(v, forventet, mottatt, mangler) {
  fetch(SUPA_URL + '/functions/v1/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY },
    body: JSON.stringify({ type: 'mangelfull_levering', vareNavn: v.navn, forventet, mottatt, mangler, enhet: v.enhet })
  }).catch(e => console.warn('Mangelfull leverings-varsel feilet:', e));
}

// Endrer beholdning for én vare og logger det i historikken. Sendes et lagerBatch-
// objekt (fra lagerBatchNy()) inn, samles database-skrivingene opp der i stedet for
// å sendes hver for seg med en gang - kalleren flusher dem samlet etterpå med
// lagerBatchFlush(). Mange samtidige enkeltkall til Supabase har vist seg upålitelige
// i denne appen før (noen forsvinner stille) - se flyttVare() som løste det likt for
// rekkefølge-oppdatering. Uten batch (vanlig enkelt-vare-endring) lagres som før, med
// en gang.
function registrerLagerEndring(v, endring, type, ordreId, kommentar, batchId, lagerBatch, oppskriftId) {
  const varLavFor = v.minAntall > 0 && (Number(v.antall)||0) <= v.minAntall;
  v.antall = (Number(v.antall)||0) + endring;
  const erLavNa = v.minAntall > 0 && v.antall <= v.minAntall;

  // Nullstill "bestilt"-merking automatisk når varen fylles opp over grensen igjen,
  // slik at neste gang den blir lav gir et nytt, friskt varsel.
  let bestiltEndret = false;
  if (!erLavNa && v.bestilt) {
    v.bestilt = false;
    bestiltEndret = true;
  }

  const hId = 'lh_' + Date.now() + '_' + Math.floor(Math.random()*1000);
  const hist = { id:hId, vareId:v.id, vareNavn:v.navn, endring, type, ordreId:ordreId||null, batchId:batchId||null, oppskriftId:oppskriftId||null, ansattNavn: me?me.navn:'', kommentar:kommentar||'', createdAt:new Date().toISOString() };
  S.lagerhistorikk = S.lagerhistorikk || [];
  S.lagerhistorikk.unshift(hist);

  const vareOppdatering = bestiltEndret ? {id:v.id, antall:v.antall, bestilt:false} : {id:v.id, antall:v.antall};
  const historikkInnsetting = {id:hId, vare_id:v.id, vare_navn:v.navn, endring, type, ordre_id:ordreId||null, batch_id:batchId||null, oppskrift_id:oppskriftId||null, ansatt_navn: me?me.navn:'', kommentar:kommentar||''};
  if (lagerBatch) {
    lagerBatch.vareOppdateringer.push(vareOppdatering);
    lagerBatch.historikkInnsettinger.push(historikkInnsetting);
  } else if (db) {
    db.from('lagervarer').upsert(vareOppdatering, {onConflict:'id'})
      .then(r=>{if(r.error) console.error('Lagerbeholdning-oppdatering feilet:', r.error.message);});
    db.from('lagerhistorikk').insert(historikkInnsetting)
      .then(r=>{if(r.error) console.error('Lagerhistorikk-lagring feilet:', r.error.message);});
  }
  oppdaterLagerVarselBadge();
  renderGlobalLavLagerVarsel();

  // Send push kun i det øyeblikket varen krysser under grensen, ikke hver gang den er lav
  if (erLavNa && !varLavFor) {
    fetch(SUPA_URL + '/functions/v1/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY },
      body: JSON.stringify({ type: 'lav_lager', vareNavn: v.navn, antall: v.antall, enhet: v.enhet, minAntall: v.minAntall })
    }).catch(e => console.warn('Lav lager-varsel feilet:', e));
  }
  return hist;
}

// Se registrerLagerEndring() sin kommentar - samler opp flere varers endringer for én
// samlet upsert/insert i stedet for ett Supabase-kall per vare i en oppskrift.
function lagerBatchNy() {
  return { vareOppdateringer: [], historikkInnsettinger: [] };
}
async function lagerBatchFlush(lagerBatch) {
  if (!db || !lagerBatch) return;
  if (lagerBatch.vareOppdateringer.length) {
    const { error } = await db.from('lagervarer').upsert(lagerBatch.vareOppdateringer, {onConflict:'id'});
    if (error) console.error('Lagerbeholdning-batch-oppdatering feilet:', error.message);
  }
  if (lagerBatch.historikkInnsettinger.length) {
    const { error } = await db.from('lagerhistorikk').insert(lagerBatch.historikkInnsettinger);
    if (error) console.error('Lagerhistorikk-batch-lagring feilet:', error.message);
  }
}

// Marker en enkelt vare som bestilt (skjuler den fra lav-lager-varselet til den fylles opp igjen)
function settVareBestilt(vareId, val) {
  const v = (S.lagervarer||[]).find(x=>x.id===vareId); if (!v) return;
  v.bestilt = !!val;
  if (db) db.from('lagervarer').update({bestilt:v.bestilt}).eq('id', v.id)
    .then(r=>{if(r.error) console.error('Bestilt-oppdatering feilet:', r.error.message);});
  oppdaterLagerVarselBadge();
  renderGlobalLavLagerVarsel();
  if (document.getElementById('vareDetaljView')?.style.display === 'block') renderVareDetalj();
}

// Marker alle lave, ikke-bestilte varer i en kategori (innenfor en gitt modell, om satt)
// som bestilt samlet - modell trengs for å ikke blande sammen samme kategorinavn brukt av
// flere modeller (f.eks. "Modul-system" for både EV9 og en annen modell).
function settKategoriBestilt(kategori, modell) {
  const varer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori') === kategori && (v.modell||'') === (modell||'') && v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
  varer.forEach(v => settVareBestilt(v.id, true));
}

// ════════════════════════════════════════════════════
// BESTILLINGSLISTE — samler alle lave varer i én liste, gruppert per modell+kategori.
// Kan også begrenses til én bestemt underkategori (bestillingslisteFilter) - satt av
// apneBestillingslisteForKategori(), brukt til å laste ned/skrive ut en egen
// bestillingsliste-PDF per underkategori (f.eks. for å sende til riktig leverandør) i
// stedet for alltid den store samlelisten. Virker automatisk for enhver ny underkategori
// som lages, siden det bare filtrerer på modell+kategori-verdiene, ikke en fast liste.
// ════════════════════════════════════════════════════
let bestillingslisteFilter = null; // null = alt, ellers {modell, kategori}

function laveVarerForBestilling() {
  return (S.lagervarer||[]).filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
}

function bestillingslisteGruppert() {
  const grupper = {};
  let varer = laveVarerForBestilling();
  if (bestillingslisteFilter) {
    varer = varer.filter(v => (v.kategori||'Uten kategori') === bestillingslisteFilter.kategori && (v.modell||'') === (bestillingslisteFilter.modell||''));
  }
  varer.forEach(v => {
    const nokkel = v.modell ? `${v.modell} – ${v.kategori||'Uten kategori'}` : (v.kategori || 'Uten kategori');
    (grupper[nokkel] = grupper[nokkel] || []).push(v);
  });
  return grupper;
}

// Hovedinngangen fra Lager-oversikten og de globale lav-lager-varslene - viser ALT.
function apneBestillingslisteGlobal() {
  bestillingslisteFilter = null;
  visBestillingsliste();
}

// Fra en underkategori-side (kategoriDetaljView) - viser KUN denne underkategorien, slik
// at man kan laste den ned/skrive den ut for seg selv.
function apneBestillingslisteForKategori(modell, kategori) {
  bestillingslisteFilter = { modell: modell||'', kategori };
  visBestillingsliste();
}

function visBestillingsliste() {
  const grupper = bestillingslisteGruppert();
  const antall = Object.values(grupper).reduce((s,a)=>s+a.length, 0);
  const el = document.getElementById('bestillingslisteInnhold');

  const tittelEl = document.getElementById('bestillingslisteTittel');
  const undertekstEl = document.getElementById('bestillingslisteUndertekst');
  if (tittelEl && undertekstEl) {
    if (bestillingslisteFilter) {
      const navn = bestillingslisteFilter.modell ? `${bestillingslisteFilter.modell} – ${bestillingslisteFilter.kategori}` : bestillingslisteFilter.kategori;
      tittelEl.textContent = 'Bestillingsliste – ' + navn;
      undertekstEl.textContent = `Kun varer under lav-grensen i denne underkategorien.`;
    } else {
      tittelEl.textContent = 'Bestillingsliste';
      undertekstEl.textContent = 'Alle varer under lav-grensen, gruppert per kategori.';
    }
  }

  el.innerHTML = antall ? `
    <div class="box" style="display:flex;align-items:center;gap:13px;margin-bottom:12px;border-color:rgba(239,68,68,.35)">
      <span style="flex-shrink:0;width:36px;height:36px;border-radius:999px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.4);color:#fca5a5;display:flex;align-items:center;justify-content:center;font-weight:800">!</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#fca5a5">${antall} vare${antall===1?'':'r'} under minimum</div>
        <div class="small muted">Fordelt på ${Object.keys(grupper).length} kategori${Object.keys(grupper).length===1?'':'er'}</div>
      </div>
    </div>` + Object.entries(grupper).map(([kat, varer]) => `
      <div class="box" style="padding:0;overflow:hidden;margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid #27272a">
          <b style="font-size:14px">${esc(kat)}</b>
          <div style="display:flex;gap:7px;align-items:center;flex-shrink:0">
            <span class="pill bad" style="margin:0;font-size:11px;padding:3px 10px">${varer.length}</span>
            <button class="btn sm" style="padding:4px 10px;font-size:11.5px"
              onclick="settKategoriBestilt('${esc(varer[0].kategori||'Uten kategori').replace(/'/g,"\\'")}','${esc(varer[0].modell||'').replace(/'/g,"\\'")}');visBestillingsliste()">✓ Bestilt</button>
          </div>
        </div>
        ${varer.map(v=>`
          <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid #ffffff08">
            <input type="checkbox" class="bestill-chk" data-vare-id="${v.id}"
              style="width:17px;height:17px;accent-color:#22c55e;flex-shrink:0;cursor:pointer">
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.navn)}</div>
              ${v.tegningsnummer?`<div class="small muted" style="font-size:11.5px">${esc(v.tegningsnummer)}</div>`:''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;color:#fca5a5;font-weight:700">${fmtAntall(v.antall)} / ${fmtAntall(v.minAntall)}</div>
              <div class="small muted" style="font-size:11px">${esc(v.enhet)}</div>
            </div>
          </div>`).join('')}
      </div>`).join('')
    : '<div class="box" style="text-align:center;padding:26px"><div style="font-size:26px;margin-bottom:6px">✓</div><div class="muted small">Ingen varer er under lav-grensen akkurat nå.</div></div>';

  document.getElementById('bestillingslisteHandlinger').style.display = antall ? 'flex' : 'none';
  openModal('bestillingslisteModal');
}

// Merker bare varene brukeren faktisk har huket av. I praksis bestiller man fra
// én leverandør av gangen, ikke hele listen samtidig.
function bestillAvhukede() {
  const ids = [...document.querySelectorAll('.bestill-chk:checked')].map(c => c.dataset.vareId);
  if (!ids.length) { visToast('Huk av varene du har bestilt'); return; }
  ids.forEach(id => settVareBestilt(id, true));
  renderLagerListe();
  visToast(`${ids.length} vare${ids.length===1?'':'r'} merket som bestilt`);
  visBestillingsliste();
}

function bestillingslisteSomTekst() {
  const grupper = bestillingslisteGruppert();
  const dato = new Date().toLocaleDateString('no');
  let tekst = `Bestillingsliste – ${dato}\n\n`;
  Object.entries(grupper).forEach(([kat, varer]) => {
    tekst += `${kat}:\n`;
    varer.forEach(v => { tekst += `- ${v.navn}${v.tegningsnummer?` (${v.tegningsnummer})`:''} (${fmtAntall(v.antall)} av ${fmtAntall(v.minAntall)} ${v.enhet} igjen)\n`; });
    tekst += '\n';
  });
  return tekst.trim();
}

function kopierBestillingsliste() {
  const tekst = bestillingslisteSomTekst();
  navigator.clipboard.writeText(tekst)
    .then(()=>visToast('Bestillingsliste kopiert'))
    .catch(()=>visToast('Klarte ikke å kopiere'));
}

// Åpner et rent, utskriftsvennlig ark og trigger utskriftsdialogen direkte -
// ingen PDF-nedlasting nødvendig, bruker skriver rett fra nettleseren.
// Felles ark for både utskrift og PDF - samme mal, så de aldri kommer i utakt.
function bestillingslisteArkHTML() {
  const grupper = bestillingslisteGruppert();
  const antallVarer = Object.values(grupper).reduce((s,v)=>s+v.length,0);
  const dato = new Date().toLocaleDateString('nb-NO', {day:'numeric', month:'long', year:'numeric'});
  const LOGO = 'logoer/logo-lys-bakgrunn.png';
  const omfangTekst = bestillingslisteFilter
    ? (bestillingslisteFilter.modell ? `${bestillingslisteFilter.modell} – ${bestillingslisteFilter.kategori}` : bestillingslisteFilter.kategori)
    : "Salmaker'n · varelager";

  const innhold = Object.entries(grupper).map(([kat, varer]) => `
    <h2>${esc(kat)} <span class="kat-antall">${varer.length} vare${varer.length===1?'':'r'}</span></h2>
    <table>
      <tr class="hode">
        <td class="boks-hode"></td>
        <td>Vare</td>
        <td class="antall">På lager / minimum</td>
      </tr>
      ${varer.map(v=>`
        <tr>
          <td class="boks"></td>
          <td>${esc(v.navn)}${v.tegningsnummer?` <span class="tegn">${esc(v.tegningsnummer)}</span>`:''}</td>
          <td class="antall"><b>${fmtAntall(v.antall)}</b> / ${fmtAntall(v.minAntall)} ${esc(v.enhet)}</td>
        </tr>`).join('')}
    </table>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bestillingsliste ${dato}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;padding:32px;max-width:760px;margin:0 auto}
      .topp{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #cc0000;padding-bottom:14px;margin-bottom:6px}
      .topp img{height:52px;object-fit:contain}
      h1{font-size:22px;font-weight:bold;color:#cc0000;margin:0}
      .undertittel{font-size:12.5px;color:#666;margin-top:3px}
      .topp-h{text-align:right}
      .dato{font-size:13px;color:#555}
      .antall-varsel{font-weight:bold;font-size:14px;margin-top:3px}
      h2{font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#cc0000;
         border-bottom:1px solid #e5e5e5;padding-bottom:5px;margin:26px 0 2px;
         display:flex;justify-content:space-between;align-items:baseline}
      .kat-antall{font-size:11px;letter-spacing:0;text-transform:none;color:#999;font-weight:normal}
      table{width:100%;border-collapse:collapse}
      td{padding:8px 4px;border-bottom:1px dotted #d4d4d8;font-size:14px;vertical-align:middle}
      td.boks{width:26px}
      td.boks::before{content:'';display:block;width:16px;height:16px;border:1.5px solid #1a1a1a;border-radius:3px}
      td.antall{text-align:right;color:#555;white-space:nowrap;font-size:13px}
      tr.hode td{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#8a8a8a;
                 border-bottom:1.5px solid #1a1a1a;padding-bottom:4px}
      tr.hode td.boks-hode::before{content:none}
      .tegn{color:#999;font-size:12px}
      .signaturer{display:flex;gap:28px;margin-top:44px;page-break-inside:avoid}
      .sign{flex:1}
      .sign-linje{height:36px;border-bottom:1px solid #1a1a1a}
      .sign-lbl{font-size:12px;color:#666;margin-top:6px}
      .bunn{margin-top:28px;padding-top:10px;border-top:1px solid #e5e5e5;font-size:11px;color:#999;text-align:center}
      @media print{ body{padding:0} h2{page-break-after:avoid} tr{page-break-inside:avoid} }
    </style></head>
    <body>
      <div class="topp">
        <img src="${LOGO}" alt="Salmaker'n">
        <div class="topp-h">
          <h1>Bestillingsliste</h1>
          <div class="undertittel">${esc(omfangTekst)}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span class="dato">${dato}</span>
        <span class="antall-varsel">${antallVarer} vare${antallVarer===1?'':'r'} under minimum</span>
      </div>
      ${innhold || '<p style="color:#666">Ingen varer er under lav-grensen akkurat nå.</p>'}
      <div class="signaturer">
        <div class="sign"><div class="sign-linje"></div><div class="sign-lbl">Bestilt av</div></div>
        <div class="sign"><div class="sign-linje"></div><div class="sign-lbl">Dato</div></div>
      </div>
      <div class="bunn">Generert fra Salmaker'n · ${dato}</div>
    </body></html>`;
}

// Åpner arket i eget vindu og trigger utskriftsdialogen. Venter på logoen først,
// ellers mangler den i PDF-en - samme mønster som genPDF().
function apneBestillingslisteArk() {
  const vindu = window.open('', '_blank');
  if (!vindu) { visToast('Nettleseren blokkerte vinduet – tillat popup og prøv igjen'); return; }
  vindu.document.write(bestillingslisteArkHTML());
  vindu.document.close();

  let skrevetUt = false;
  const skrivUt = () => { if (skrevetUt) return; skrevetUt = true; vindu.focus(); vindu.print(); };
  const bilder = [...vindu.document.images];
  if (!bilder.length) skrivUt();
  else {
    let lastet = 0;
    const ferdig = () => { if (++lastet >= bilder.length) skrivUt(); };
    bilder.forEach(img => img.complete ? ferdig() : (img.addEventListener('load', ferdig), img.addEventListener('error', ferdig)));
  }
  setTimeout(skrivUt, 4000);
}

function skrivUtBestillingsliste() { apneBestillingslisteArk(); }

function lastNedBestillingslistePDF() {
  visToast('Velg «Lagre som PDF» i utskriftsdialogen');
  apneBestillingslisteArk();
}

function bestillAltFraListe() {
  const varer = laveVarerForBestilling();
  if (!varer.length) return;
  if (!confirm(`Merk alle ${varer.length} varer på listen som bestilt?`)) return;
  varer.forEach(v => settVareBestilt(v.id, true));
  renderLagerListe();
  closeModal('bestillingslisteModal');
}

// Globalt lav-lager-varsel i toppmenyen, synlig uansett hvilken side man er på
function renderGlobalLavLagerVarsel() {
  const el = document.getElementById('globalLavLagerVarsel');
  if (!el) return;
  const paaLagerSiden = document.getElementById('lager')?.classList.contains('active');
  if (!me || me.rolle !== 'admin' || !paaLagerSiden) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const lave = (S.lagervarer||[]).filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
  if (!lave.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  const navn = lave.slice(0,3).map(v=>esc(v.navn)).join(', ') + (lave.length>3?` +${lave.length-3} til`:'');
  el.innerHTML = `<div onclick="apneBestillingslisteGlobal()" style="cursor:pointer;background:#450a0a;border:1px solid #ef4444cc;border-radius:16px;padding:12px 14px;margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span style="flex-shrink:0;width:32px;height:32px;border-radius:999px;background:#7f1d1d;color:#fca5a5;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px">!</span>
    <div style="flex:1;min-width:0">
      <div style="color:#fca5a5;font-weight:700;font-size:13px">${lave.length} vare${lave.length===1?'':'r'} under minimum</div>
      <div class="small muted" style="margin-top:1px">${navn}</div>
    </div>
    <span class="small" style="color:#fca5a5;flex-shrink:0;white-space:nowrap">Åpne bestillingsliste →</span>
  </div>`;
}

// Naviger til Lager-fanen og rett inn i varen fra varselet, uansett hvilken side man star pa
function gaaTilVareFraVarsel(vareId) {
  showPage('lager', document.getElementById('lagerTab'));
  visVareDetalj(vareId);
}

// ════════════════════════════════════════════════════
// LAGER-OPPSKRIFTER
// ════════════════════════════════════════════════════
let oppskriftAktivModell = null;

function refreshOppskriftVisning() {
  if (oppskriftAktivModell && document.getElementById('oppskriftModellDetaljView')?.style.display !== 'none') {
    renderOppskriftModellDetalj();
  } else if (document.getElementById('oppskriftModellerView')?.style.display !== 'none') {
    renderOppskriftModellerListe();
  }
}

function visOppskriftModeller() {
  oppskriftAktivModell = null;
  document.getElementById('lagerListeView').style.display = 'none';
  document.getElementById('kategoriDetaljView').style.display = 'none';
  document.getElementById('vareDetaljView').style.display = 'none';
  document.getElementById('oppskriftModellDetaljView').style.display = 'none';
  document.getElementById('oppskriftModellerView').style.display = 'block';
  renderOppskriftModellerListe();
  window.scrollTo(0, 0);
}

function renderOppskriftModellerListe() {
  const el = document.getElementById('oppskriftModellerListe');
  const modeller = [...new Set([...alleKjenteModeller(), ...(S.lagerOppskrifter||[]).map(o=>o.biltype).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'no'));
  if (!modeller.length) { el.innerHTML = '<div class="card"><div class="muted small">Ingen modeller ennå. Lag en utstyr-mal med en biltype under Mer først.</div></div>'; return; }
  el.innerHTML = `<div class="grid g3">${modeller.map(m => {
    const oppskrifter = (S.lagerOppskrifter||[]).filter(o=>o.biltype===m);
    const antallDeler = new Set(oppskrifter.flatMap(o => (o.ingredienser||[]).map(i=>i.vareId))).size;
    return `<div class="box" style="cursor:pointer" onclick="visOppskriftModell('${esc(m).replace(/'/g,"\\'")}')">
      <div class="row"><b>${esc(m)}</b><span style="color:#a1a1aa">›</span></div>
      <div class="small muted" style="margin-top:2px">${
        oppskrifter.length
          ? `${oppskrifter.length} oppskrift${oppskrifter.length===1?'':'er'} · ${antallDeler} deler totalt`
          : 'Ingen oppskrift ennå'
      }</div>
    </div>`;
  }).join('')}</div>`;
}

function visOppskriftModell(modell) {
  oppskriftAktivModell = modell;
  document.getElementById('oppskriftModellerView').style.display = 'none';
  document.getElementById('oppskriftModellDetaljView').style.display = 'block';
  renderOppskriftModellDetalj();
  window.scrollTo(0, 0);
}

function tilbakeFraOppskriftModell() {
  document.getElementById('oppskriftModellDetaljView').style.display = 'none';
  visOppskriftModeller();
}

function renderOppskriftModellDetalj() {
  const modell = oppskriftAktivModell; if (!modell) return;
  document.getElementById('oppskriftModellTittel').textContent = modell;
  const oppskrifter = (S.lagerOppskrifter||[]).filter(o=>o.biltype===modell)
    .sort((a,b)=> (a.type||'ombygging').localeCompare(b.type||'ombygging') || a.navn.localeCompare(b.navn,'no'));

  // Generell oversikt: alle deler brukt i minst én oppskrift for modellen, uavhengig av hvilken
  const delerMap = {};
  oppskrifter.forEach(o => (o.ingredienser||[]).forEach(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
    (delerMap[i.vareId] = delerMap[i.vareId] || {navn:v.navn, enhet:v.enhet, bruk:[]}).bruk.push({navn:o.navn, antall:i.antall});
  }));
  const generellEl = document.getElementById('oppskriftModellGenerellOversikt');
  const delerListe = Object.values(delerMap).sort((a,b)=>a.navn.localeCompare(b.navn,'no'));
  generellEl.innerHTML = delerListe.length ? delerListe.map(d => `
    <div class="box" style="margin-bottom:5px;padding:8px 10px">
      <b>${esc(d.navn)}</b>
      <div class="small muted" style="margin-top:2px">${d.bruk.map(b=>`${fmtAntall(b.antall)} ${esc(d.enhet)} – ${esc(b.navn)}`).join(', ')}</div>
    </div>`).join('') : '<div class="muted small">Ingen deler lagt til på noen oppskrift ennå</div>';

  const TYPE_LABEL = {ombygging:'Ombygging', ekstra_utstyr:'Ekstra utstyr'};
  const oppskriftBoksHTML = o => {
    const deler = (o.ingredienser||[]).map(i => {
      const v = (S.lagervarer||[]).find(x=>x.id===i.vareId);
      return v ? `<span class="pill" style="margin:0;font-size:11.5px;padding:3px 10px">${fmtAntall(i.antall)} ${esc(v.enhet)} · ${esc(v.navn)}</span>` : null;
    }).filter(Boolean);
    return `<div class="box" style="margin-bottom:7px;padding:13px 14px">
      <div class="row">
        <b>${esc(o.navn)}</b>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <span class="pill" style="margin:0;font-size:11px;padding:3px 10px">${(o.ingredienser||[]).length} deler</span>
          <button class="btn sm" onclick="apneRedigerOppskrift('${o.id}')">✎</button>
          <button class="btn sm red" onclick="slettOppskrift('${o.id}')">🗑</button>
        </div>
      </div>
      ${deler.length
        ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:9px">${deler.join('')}</div>`
        : '<div class="small muted" style="margin-top:6px">Ingen deler lagt til</div>'}
    </div>`;
  };
  // To egne seksjoner (Ombygging/Ekstra utstyr) - samme inndeling som avkrysningslistene
  // på selve ordren, se renderOrdreLagerbruk() i lager.js, slik at det er tydelig hvilken
  // liste en ny oppskrift havner i.
  const seksjonHTML = (type, modellEsc) => {
    const treff = oppskrifter.filter(o => (o.type||'ombygging')===type);
    return `<div class="card" style="margin-top:12px">
      <div class="row">
        <div class="h">${TYPE_LABEL[type]}</div>
        <button class="btn sm red" onclick="apneNyOppskrift('${modellEsc}','${type}')">+ Ny oppskrift</button>
      </div>
      ${treff.length
        ? treff.map(oppskriftBoksHTML).join('')
        : `<div class="muted small" style="margin-top:8px">Ingen ${TYPE_LABEL[type].toLowerCase()}-oppskrifter for denne modellen ennå</div>`}
    </div>`;
  };
  const modellEsc = esc(modell).replace(/'/g,"\\'");
  document.getElementById('oppskriftVariantListeKort').innerHTML =
    seksjonHTML('ombygging', modellEsc) + seksjonHTML('ekstra_utstyr', modellEsc);
}

let oppskriftVisAlleVarer = false;

// Filtrerer på Modell (ikke Kategori) - matcher det som velges i "Modell"-feltet på
// oppskriften mot lagervarer.modell. Grupperingen under (per v.kategori) viser dermed
// automatisk ALLE underkategoriene for modellen (Modul-system, Kasse, Plater, osv.) som
// egne bolker i velgeren, slik at man kan huke av deler fra flere underkategorier i én
// og samme oppskrift - se lagervarer.modell/kategori i renderLagerListe()/renderModellDetalj().
function fyllOppskriftVareListe(forhaandsvalgt) {
  forhaandsvalgt = forhaandsvalgt || {};
  const biltype = document.getElementById('oppskriftBiltype').value;
  const el = document.getElementById('oppskriftIngrediensListe');
  let varer = (S.lagervarer||[]).slice();
  // Varer UTEN modell satt regnes som felles for alle modeller (f.eks. en "Skruer"-
  // kategori som brukes på tvers) - tas alltid med i tillegg til den valgte modellens egne.
  const iModell = biltype ? varer.filter(v => !v.modell || v.modell.toLowerCase() === biltype.toLowerCase()) : [];
  const brukAlle = oppskriftVisAlleVarer || !biltype || !iModell.length;
  varer = (brukAlle ? varer : iModell).sort((a,b)=>a.navn.localeCompare(b.navn,'no'));

  if (!varer.length) {
    el.innerHTML = '<div class="muted small">Ingen varer i lageret ennå. Legg til varer under Lager først.</div>';
    return;
  }

  // Hver underkategori vises som en nedtrekkbar boks ("X av Y valgt") i stedet for alltid
  // synlig - samme mønster/funksjoner som Ombygging/Ekstra utstyr-listene på ordren
  // (toggleOppskriftDropdown()/lukkAlleOppskriftDropdowns() lenger opp i denne filen).
  // Trenger ikke gjenopprette åpen-tilstand ved re-render slik den andre bruken gjør,
  // siden avkrysning her ikke trigger noen re-render av hele listen.
  el.innerHTML = `
    ${(!brukAlle || (biltype && iModell.length)) ? `<div class="small" style="margin-bottom:6px">
      <a href="#" onclick="event.preventDefault();oppskriftVisAlleVarer=!oppskriftVisAlleVarer;fyllOppskriftVareListe(lesOppskriftIngredienser());" style="color:#f87171">
        ${oppskriftVisAlleVarer ? '↩ Vis kun varer i "'+esc(biltype)+'"-modellen' : '+ Vis alle varer i lageret (ikke bare "'+esc(biltype)+'")'}
      </a>
    </div>` : ''}
    ${(() => {
      const grupper = {};
      varer.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
      return Object.entries(grupper).map(([kat, katVarer], idx) => {
        const valgtIKat = katVarer.filter(v => forhaandsvalgt[v.id] != null).length;
        const ddId = 'oppskriftKatDD_' + idx + '_' + kat.replace(/[^a-zA-Z0-9]/g,'_');
        return `<div class="felt-wrap oppskrift-dd-wrap" style="margin-bottom:10px">
          <div onclick="toggleOppskriftDropdown(event,'${ddId}')" style="width:100%;padding:9px 12px;border-radius:12px;background:#27272a;color:#f4f4f5;border:1px solid ${valgtIKat?'#ef4444':'#3f3f46'};font-size:13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span>${esc(kat)} — <span id="${ddId}_teller">${valgtIKat} av ${katVarer.length}</span> valgt</span>
            <span style="flex-shrink:0;color:#a1a1aa">▾</span>
          </div>
          <div class="felt-dropdown" id="${ddId}">
            ${katVarer.map(v => {
              const valgt = forhaandsvalgt[v.id] != null;
              return `<label style="display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid #ffffff08">
                <input type="checkbox" class="oppskrift-vare-chk" data-vare-id="${v.id}" ${valgt?'checked':''}
                  onchange="this.nextElementSibling.style.display=this.checked?'inline-block':'none';oppdaterOppskriftKatTeller('${ddId}')"
                  style="width:16px;height:16px;accent-color:#ef4444;flex-shrink:0">
                <input type="number" class="oppskrift-vare-antall" min="0" step="any" value="${valgt?forhaandsvalgt[v.id]:1}"
                  style="width:64px;display:${valgt?'inline-block':'none'};flex-shrink:0">
                <span style="font-size:13px;flex:1;min-width:0">${esc(v.navn)} <span class="muted small">(${esc(v.enhet)})</span></span>
              </label>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
    })()}
  `;
}

// Oppdaterer "X av Y valgt"-teksten og rammefargen på trigger-raden når en avkrysning
// endres inni en underkategori-dropdown i oppskrift-vare-velgeren.
function oppdaterOppskriftKatTeller(ddId) {
  const dd = document.getElementById(ddId); if (!dd) return;
  const alle = dd.querySelectorAll('.oppskrift-vare-chk');
  const valgt = dd.querySelectorAll('.oppskrift-vare-chk:checked');
  const teller = document.getElementById(ddId + '_teller');
  if (teller) teller.textContent = `${valgt.length} av ${alle.length}`;
  const trigger = dd.previousElementSibling;
  if (trigger) trigger.style.borderColor = valgt.length ? '#ef4444' : '#3f3f46';
}

function lesOppskriftIngredienser() {
  const valgt = {};
  document.querySelectorAll('#oppskriftIngrediensListe .oppskrift-vare-chk').forEach(chk => {
    if (chk.checked) valgt[chk.dataset.vareId] = Number(chk.nextElementSibling.value) || 1;
  });
  return valgt;
}

function apneNyOppskrift(forhaandsvalgtModell, forhaandsvalgtType) {
  if (!(S.lagervarer||[]).length) { alert('Legg til minst én vare i lageret først'); return; }
  document.getElementById('oppskriftModalTittel').textContent = 'Ny oppskrift';
  document.getElementById('redigerOppskriftId').value = '';
  document.getElementById('oppskriftNavn').value = '';
  document.getElementById('oppskriftBiltype').innerHTML = modellSelectOptions(forhaandsvalgtModell||'');
  document.getElementById('oppskriftType').value = forhaandsvalgtType || 'ombygging';
  oppskriftVisAlleVarer = false;
  fyllOppskriftVareListe();
  openModal('nyOppskriftModal');
}

function apneRedigerOppskrift(id) {
  const o = (S.lagerOppskrifter||[]).find(x=>x.id===id); if (!o) return;
  document.getElementById('oppskriftModalTittel').textContent = 'Rediger oppskrift';
  document.getElementById('redigerOppskriftId').value = o.id;
  document.getElementById('oppskriftNavn').value = o.navn;
  document.getElementById('oppskriftBiltype').innerHTML = modellSelectOptions(o.biltype||'');
  document.getElementById('oppskriftType').value = o.type||'ombygging';
  oppskriftVisAlleVarer = false;
  const forhaandsvalgt = {};
  (o.ingredienser||[]).forEach(i => forhaandsvalgt[i.vareId] = i.antall);
  fyllOppskriftVareListe(forhaandsvalgt);
  openModal('nyOppskriftModal');
}

function lagreOppskrift() {
  const navn = document.getElementById('oppskriftNavn').value.trim();
  if (!navn) { alert('Skriv inn et navn på oppskriften'); return; }
  const biltype = document.getElementById('oppskriftBiltype').value.trim();
  const type = document.getElementById('oppskriftType').value;
  const editId = document.getElementById('redigerOppskriftId').value;
  const valgt = lesOppskriftIngredienser();
  const ingredienser = Object.entries(valgt).map(([vareId, antall]) => ({vareId, antall})).filter(i => i.antall > 0);
  if (!ingredienser.length) { alert('Huk av minst én vare med antall større enn 0'); return; }

  if (editId) {
    const o = (S.lagerOppskrifter||[]).find(x=>x.id===editId); if (!o) return;
    o.navn = navn; o.biltype = biltype; o.type = type; o.ingredienser = ingredienser;
    if (db) db.from('lager_oppskrifter').update({navn, biltype, type, ingredienser}).eq('id', o.id)
      .then(r=>{if(r.error) console.error('Oppskrift-oppdatering feilet:', r.error.message);});
  } else {
    const id = 'oppskrift_' + Date.now();
    const oppskrift = { id, navn, biltype, type, ingredienser, createdAt:new Date().toISOString() };
    S.lagerOppskrifter = S.lagerOppskrifter || [];
    S.lagerOppskrifter.push(oppskrift);
    if (db) db.from('lager_oppskrifter').insert({id, navn, biltype, type, ingredienser})
      .then(r=>{if(r.error) console.error('Oppskrift-lagring feilet:', r.error.message);});
  }
  closeModal('nyOppskriftModal');
  refreshOppskriftVisning();
  if (activeOrdreId) renderOrdreLagerbruk();
}

function slettOppskrift(id) {
  const o = (S.lagerOppskrifter||[]).find(x=>x.id===id); if (!o) return;
  if (!confirm(`Slette oppskriften "${o.navn}"?`)) return;
  S.lagerOppskrifter = (S.lagerOppskrifter||[]).filter(x=>x.id!==id);
  if (db) db.from('lager_oppskrifter').delete().eq('id', id)
    .then(r=>{if(r.error) console.error('Sletting av oppskrift feilet:', r.error.message);});
  refreshOppskriftVisning();
  if (activeOrdreId) renderOrdreLagerbruk();
}

// ════════════════════════════════════════════════════
// VARER FRA LAGER PÅ ORDRE
// ════════════════════════════════════════════════════
// En oppskrift matcher en ordre kun på modell (Merke + Modell) - IKKE lenger på variant.
// Ombygging kan bestå av flere uavhengige oppskrifter som gjelder samtidig (f.eks. både
// "Takluke" og "Annet feste i gulvet"), så matching er bevisst bredere enn før - hvilke
// som faktisk gjelder denne bilen hakes av manuelt på ordren, se renderOrdreLagerbruk().
function oppskriftMatcherOrdre(r, o) {
  if (!r.biltype) return false;
  const biltypeTekst = merkeModell(o).toLowerCase();
  if (!biltypeTekst) return false;
  const biltypeR = r.biltype.toLowerCase();
  return biltypeTekst.includes(biltypeR) || biltypeR.includes(biltypeTekst);
}

// Ombygging/Ekstra utstyr-oppskriftene vises som nedtrekkbare avkrysningslister (én per
// type) i stedet for alltid-synlige bokser - noen modeller har opptil 10+ oppskrifter, og
// da blir siden fort veldig lang. Trigger-raden viser bare "X av Y valgt", selve listen
// åpnes/lukkes ved klikk (holder seg åpen mens man haker av flere, lukkes ved klikk
// utenfor) - se toggleOppskriftDropdown()/lukkAlleOppskriftDropdowns() lenger ned.
let apneOppskriftDropdowns = new Set();
function toggleOppskriftDropdown(e, ddId) {
  e.stopPropagation();
  const el = document.getElementById(ddId); if (!el) return;
  const varAllerdeApen = el.style.display === 'block';
  lukkAlleOppskriftDropdowns();
  if (!varAllerdeApen) { el.style.display = 'block'; apneOppskriftDropdowns.add(ddId); }
}
function lukkAlleOppskriftDropdowns() {
  apneOppskriftDropdowns.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  apneOppskriftDropdowns.clear();
}
document.addEventListener('click', e => {
  if (!e.target.closest('.oppskrift-dd-wrap')) lukkAlleOppskriftDropdowns();
});

// Viser Ombygging- og Ekstra utstyr-oppskrifter som matcher ordrens modell som to
// nedtrekkbare avkrysningslister. Å hake av trekker oppskriftens deler fra lager med en
// gang; å fjerne haken angrer trekket (samme som "↩ Angre" gjorde før) - se
// toggleOppskriftPaaOrdre(). Avkrysset-tilstanden er ikke lagret for seg selv, den er
// avledet fra om det finnes en lagerhistorikk-batch for denne ordren med
// kommentar=oppskriftens navn.
function renderOrdreLagerbruk() {
  const el = document.getElementById('ordreLagerbruk_' + activeOrdreId);
  if (!el) return;
  const o = S.ordrer.find(x=>x.id===activeOrdreId); if (!o) return;

  const ordreBatchRader = (S.lagerhistorikk||[]).filter(h=>h.ordreId===o.id && h.batchId);
  // Trekk matches primært via oppskriftId (satt fra og med 2026-09-11). Eldre rader fra
  // før den kolonnen fantes har ingen oppskriftId - de faller tilbake på navn-matching,
  // men mister koblingen hvis oppskriften byttes navn i ettertid (kjent, akseptert
  // begrensning for historiske rader - se migrasjonsfilens kommentar).
  const erOppskriftHuket = r => ordreBatchRader.some(h => h.oppskriftId ? h.oppskriftId===r.id : h.kommentar===r.navn);

  const seksjonHTML = (type, tittel) => {
    const treff = (S.lagerOppskrifter||[]).filter(r => (r.type||'ombygging')===type && oppskriftMatcherOrdre(r, o));
    if (!treff.length) return '';
    const valgt = treff.filter(erOppskriftHuket);
    const rader = treff.map(r => {
      const huket = erOppskriftHuket(r);
      const delerTekst = (r.ingredienser||[]).map(i => {
        const v = (S.lagervarer||[]).find(x=>x.id===i.vareId);
        return v ? `${fmtAntall(i.antall)} ${esc(v.enhet)} ${esc(v.navn)}` : null;
      }).filter(Boolean).join(', ');
      return `<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid #27272a">
        <input type="checkbox" ${huket?'checked':''} onchange="toggleOppskriftPaaOrdre('${r.id}',this.checked)" style="width:17px;height:17px;accent-color:#ef4444;flex-shrink:0;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600">${esc(r.navn)}</div>
          ${delerTekst?`<div class="small muted" style="margin-top:2px">${delerTekst}</div>`:''}
        </div>
      </label>`;
    }).join('');
    const ddId = 'oppskriftDD_' + type;
    return `<div class="felt-wrap oppskrift-dd-wrap" style="margin-bottom:12px">
      <label>${tittel}</label>
      <div onclick="toggleOppskriftDropdown(event,'${ddId}')" style="width:100%;padding:9px 12px;border-radius:12px;background:#27272a;color:#f4f4f5;border:1px solid ${valgt.length?'#ef4444':'#3f3f46'};font-size:13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${valgt.length} av ${treff.length} valgt</span>
        <span style="flex-shrink:0;color:#a1a1aa">▾</span>
      </div>
      <div class="felt-dropdown" id="${ddId}">${rader}</div>
    </div>`;
  };

  const modellTekst = merkeModell(o);
  const html = seksjonHTML('ombygging', 'Ombygging') + seksjonHTML('ekstra_utstyr', 'Ekstra utstyr');
  el.innerHTML = html || `<div class="muted small">${modellTekst ? `Ingen oppskrift funnet for "${esc(modellTekst)}". Lag en under Lager-fanen.` : 'Fyll inn Merke og Modell på ordren for å se aktuelle oppskrifter.'}</div>`;
  // Gjenopprett åpen/lukket-tilstand - innerHTML over lager helt nye DOM-elementer, så
  // .felt-dropdown sin CSS-default (display:none) ville ellers lukket en åpen liste hver
  // gang man haker av ÉN vare (toggleOppskriftPaaOrdre kaller denne funksjonen på nytt).
  apneOppskriftDropdowns.forEach(id => { const dd = document.getElementById(id); if (dd) dd.style.display = 'block'; });
}

function trekkOppskriftForOrdre(oppskriftId) {
  const r = (S.lagerOppskrifter||[]).find(x=>x.id===oppskriftId); if (!r) return;
  const o = S.ordrer.find(x=>x.id===activeOrdreId); if (!o) return;
  // Trekkes uansett beholdning, med vilje - en oppskrift brukes ofte på nytt før
  // varene er fylt opp igjen (f.eks. rekvirert, men ikke levert ennå), og skal
  // fortsatt registreres/trekkes nå - beholdningen går i minus til påfyllingen
  // kommer og retter det opp. Ingen sperre eller advarsel her, i motsetning til
  // manuelt uttak i lagreLagerEndring() som ER en bevisst engangshandling.

  const batchId = 'batch_' + Date.now();
  const lagerBatch = lagerBatchNy();
  (r.ingredienser||[]).forEach(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
    registrerLagerEndring(v, -Math.abs(i.antall), 'ut', o.id, r.navn, batchId, lagerBatch, r.id);
  });
  lagerBatchFlush(lagerBatch);
  renderOrdreLagerbruk();
}

// Onchange-handler for avkrysningsboksene i renderOrdreLagerbruk(). Kaller alltid
// renderOrdreLagerbruk() til slutt uansett utfall - både trekkOppskriftForOrdre() og
// angreLagerBatch() kan returnere tidlig via en confirm()-dialog brukeren avbryter, og da
// må boksen tilbakestilles til riktig (fortsatt uendret) tilstand med en gang, ikke bare
// stå igjen visuelt feil til noe annet tilfeldigvis rendrer siden på nytt.
function toggleOppskriftPaaOrdre(oppskriftId, huket) {
  const r = (S.lagerOppskrifter||[]).find(x=>x.id===oppskriftId);
  if (huket) {
    trekkOppskriftForOrdre(oppskriftId);
  } else {
    const rad = r && (S.lagerhistorikk||[]).find(h=>h.ordreId===activeOrdreId && h.batchId && (h.oppskriftId ? h.oppskriftId===r.id : h.kommentar===r.navn));
    if (rad) angreLagerBatch(rad.batchId);
  }
  // Kun Ekstra utstyr (ikke Ombygging) legges automatisk inn i "Utstyr – Skal ha etter
  // visning" - sjekker den FAKTISKE tilstanden i lagerhistorikk etterpå (ikke bare
  // "huket"-parameteren), siden trekkOppskriftForOrdre()/angreLagerBatch() kan returnere
  // uten å gjøre noe hvis brukeren avbryter en confirm()-dialog underveis.
  if (r && (r.type||'ombygging')==='ekstra_utstyr') {
    const faktiskHuket = (S.lagerhistorikk||[]).some(h=>h.ordreId===activeOrdreId && h.batchId && (h.oppskriftId ? h.oppskriftId===r.id : h.kommentar===r.navn));
    oppdaterSkalHaForOppskrift(r.navn, faktiskHuket);
  }
  renderOrdreLagerbruk();
}

// Se toggleOppskriftPaaOrdre() - legger til/fjerner oppskriftens navn som egen linje i
// o.utstyr.skalHa, uten å røre annen tekst som er skrevet inn for hånd. Siden dette er det
// SAMME feltet som allerede vises på ordrekort, i kalenderen og i PDF-rapporten, trengs
// ingen egen kode noe annet sted for at valgt Ekstra utstyr skal synes der også.
function oppdaterSkalHaForOppskrift(oppskriftNavn, skalStaa) {
  const o = S.ordrer.find(x=>x.id===activeOrdreId); if (!o) return;
  const linjer = (o.utstyr?.skalHa||'').split('\n').map(l=>l.trim()).filter(Boolean);
  const finnes = linjer.includes(oppskriftNavn);
  if (skalStaa === finnes) return;
  const ny = (skalStaa ? [...linjer, oppskriftNavn] : linjer.filter(l=>l!==oppskriftNavn)).join('\n');
  su(o.id, 'skalHa', ny);
  const textareaEl = document.getElementById('skalHaInput_' + o.id);
  if (textareaEl) textareaEl.value = ny;
}

async function angreLagerBatch(batchId) {
  if (!confirm('Angre denne uttrekkingen og legge varene tilbake på lager?')) return;
  const rader = (S.lagerhistorikk||[]).filter(h=>h.batchId===batchId);
  // Samler opp vare- og historikk-endringene og sender dem som to samlede kall (én
  // upsert, én batch-delete) i stedet for to Supabase-kall per vare i oppskriften -
  // se registrerLagerEndring() sin kommentar for hvorfor.
  const vareOppdateringer = [];
  rader.forEach(h => {
    const v = (S.lagervarer||[]).find(x=>x.id===h.vareId);
    if (v) {
      v.antall = (Number(v.antall)||0) - h.endring;
      vareOppdateringer.push({id:v.id, antall:v.antall});
    }
  });
  S.lagerhistorikk = (S.lagerhistorikk||[]).filter(h=>h.batchId!==batchId);
  if (db) {
    if (vareOppdateringer.length) {
      const { error } = await db.from('lagervarer').upsert(vareOppdateringer, {onConflict:'id'});
      if (error) console.error('Lagerbeholdning-batch-oppdatering feilet:', error.message);
    }
    if (rader.length) {
      const { error } = await db.from('lagerhistorikk').delete().in('id', rader.map(h=>h.id));
      if (error) console.error('Sletting av lagerhistorikk feilet:', error.message);
    }
  }
  oppdaterLagerVarselBadge();
  renderOrdreLagerbruk();
}

// ════════════════════════════════════════════════════
// MODALS
// ════════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
// Delegert på document (ikke querySelectorAll ved script-kjøring) slik at klikk-utenfor-lukker
// virker for ALLE modaler, uansett om HTML-en for dem står før eller etter dette scriptet i dokumentet.
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal')) e.target.classList.remove('show');
});
