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
  const gruppevarer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori')===aktivKategori).sort(sorterLagerVarer);
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
  const lave = varer.filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
  el.innerHTML = lave.length
    ? `<a href="#" onclick="event.preventDefault();visBestillingsliste()" style="color:#f87171;text-decoration:underline;cursor:pointer">⚠ ${lave.length} vare${lave.length===1?'':'r'} med lav beholdning</a>`
    : `${varer.length} vare${varer.length===1?'':'r'} på lager`;
}

let aktivKategori = null;

function renderLagerListe() {
  oppdaterLagerVarselBadge();
  const el = document.getElementById('lagerListe');
  const sok = (document.getElementById('lagerSokInput')?.value||'').toLowerCase().trim();
  let varer = (S.lagervarer||[]).slice().sort(sorterLagerVarer);

  const dl = document.getElementById('lagerKategoriListe');
  if (dl) {
    const alleKat = [...new Set((S.lagervarer||[]).map(v=>v.kategori).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'no'));
    dl.innerHTML = alleKat.map(k=>`<option value="${esc(k)}">`).join('');
  }

  if (sok) {
    // Ved søk: vis treffene direkte, uten å måtte inn i en kategori
    varer = varer.filter(v => v.navn.toLowerCase().includes(sok) || (v.kategori||'').toLowerCase().includes(sok) || (v.tegningsnummer||'').toLowerCase().includes(sok));
    el.innerHTML = varer.length
      ? `<div class="small muted" style="margin-bottom:10px">${varer.length} treff på «${esc(sok)}»</div><div class="grid g3">${varer.map(v => vareBoksHTML(v)).join('')}</div>`
      : `<div class="box" style="text-align:center;padding:24px">
           <div class="muted small">Ingen varer matcher «${esc(sok)}»</div>
           <button class="btn sm red" style="margin-top:10px" onclick="apneNyVare()">+ Opprett «${esc(sok)}» som ny vare</button>
         </div>`;
    return;
  }

  if (!varer.length) { el.innerHTML = '<div class="card"><div class="muted small">Ingen varer i lageret ennå</div></div>'; return; }

  const grupper = {};
  varer.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
  const kategorier = Object.keys(grupper).sort((a,b)=> a==='Uten kategori'?1 : b==='Uten kategori'?-1 : a.localeCompare(b,'no'));

  el.innerHTML = `<div class="grid g3">${kategorier.map(kat => {
    const lavtIKat = grupper[kat].filter(v=>v.minAntall>0 && v.antall<=v.minAntall && !v.bestilt).length;
    const sumEnheter = grupper[kat].reduce((s,v)=>s+(Number(v.antall)||0),0);
    const sumMin = grupper[kat].reduce((s,v)=>s+(Number(v.minAntall)||0),0);
    const fyllPct = sumMin>0 ? Math.max(4, Math.min(100, sumEnheter/sumMin*100)) : 100;
    return `<div class="box" style="cursor:pointer;border-color:${lavtIKat?'rgba(239,68,68,.3)':'#27272a'}" onclick="visKategoriDetalj('${esc(kat).replace(/'/g,"\\'")}')">
      <div class="row">
        <b>${esc(kat)}</b>
        ${lavtIKat?`<span class="pill bad" style="margin:0;font-size:11px">${lavtIKat} lavt</span>`:'<span style="color:#a1a1aa">›</span>'}
      </div>
      <div class="small muted" style="margin-top:2px">${grupper[kat].length} vare${grupper[kat].length===1?'':'r'} · ${fmtAntall(sumEnheter)} enheter</div>
      <div style="margin-top:9px;height:4px;border-radius:999px;background:#0f0f12;overflow:hidden">
        <div style="height:100%;width:${fyllPct}%;background:${fyllPct<=100?'#ef4444':'#22c55e'};border-radius:999px"></div>
      </div>
      ${sumMin>0?`<div class="small muted" style="margin-top:4px;font-size:11px">${Math.round(fyllPct)}% av samlet minimum (${fmtAntall(sumMin)})</div>`:''}
    </div>`;
  }).join('')}</div>`;
}

function vareBoksHTML(v, kanFlytte) {
  const lavt = erLavBeholdning(v);
  const bestilt = !!v.bestilt;
  const harMin = v.minAntall > 0;
  // Hvor langt under minimum: gir "mangler 6" i stedet for bare "lavt"
  const mangler = harMin && v.antall < v.minAntall ? v.minAntall - v.antall : 0;
  const fyllPct = harMin ? Math.max(3, Math.min(100, (Number(v.antall)||0) / v.minAntall * 100)) : 100;
  const stripeFarge = !harMin ? '#3f3f46' : (lavt ? '#ef4444' : (fyllPct < 150 ? '#facc15' : '#22c55e'));

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

function visKategoriDetalj(kat) {
  aktivKategori = kat;
  document.getElementById('lagerListeView').style.display = 'none';
  document.getElementById('kategoriDetaljView').style.display = 'block';
  document.getElementById('vareDetaljView').style.display = 'none';
  renderKategoriDetalj();
  window.scrollTo(0, 0);
}

function renderKategoriDetalj() {
  if (!aktivKategori) return;
  document.getElementById('kategoriDetaljTittel').textContent = aktivKategori;
  const varer = (S.lagervarer||[]).filter(v => (v.kategori || 'Uten kategori') === aktivKategori).sort(sorterLagerVarer);
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
      <button class="btn sm" style="flex-shrink:0" onclick="settKategoriBestilt('${esc(aktivKategori).replace(/'/g,"\\'")}');renderKategoriDetalj()">✓ Merk bestilt</button>
    </div>` : '';

  el.innerHTML = varsel + `<div class="grid g3">${varer.map(v => vareBoksHTML(v, true)).join('')}</div>`;
}

function apneNyVareIKategori() {
  apneNyVare();
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
  const varer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori') === gammelKategori);
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
  const kategori   = document.getElementById('nyVareKategori').value.trim();
  const tegningsnummer = document.getElementById('nyVareTegningsnummer').value.trim();
  const enhet      = document.getElementById('nyVareEnhet').value.trim() || 'stk';
  const minAntall  = Number(document.getElementById('nyVareMinAntall').value) || 0;
  const notat      = document.getElementById('nyVareNotat').value.trim();

  if (redigerId) {
    const v = (S.lagervarer||[]).find(x=>x.id===redigerId); if (!v) return;
    v.navn = navn; v.kategori = kategori; v.tegningsnummer = tegningsnummer; v.enhet = enhet; v.minAntall = minAntall; v.notat = notat;
    if (db) db.from('lagervarer').update({navn, kategori, tegningsnummer, enhet, min_antall:minAntall, notat}).eq('id', v.id)
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
    const vare = { id, navn, kategori, tegningsnummer, antall, enhet, minAntall, notat:notatMedAvvik, createdAt:new Date().toISOString() };
    S.lagervarer = S.lagervarer || [];
    S.lagervarer.push(vare);
    if (db) db.from('lagervarer').insert({id, navn, kategori, tegningsnummer, antall, enhet, min_antall:minAntall, notat:notatMedAvvik})
      .then(r=>{if(r.error) console.error('Lagervare-lagring feilet:', r.error.message);});
    if (mangler > 0) varselMangelfullLevering({navn, enhet}, forventet, antall, mangler);
    closeModal('nyVareModal');
    renderLagerListe();
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
  document.getElementById('vareDetaljTilbakeBtn').textContent = aktivKategori ? '← ' + aktivKategori : '← Alle varer';
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
  oppskriftAktivModell = null;
  document.getElementById('lagerListeView').style.display = 'block';
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
  document.getElementById('vareDetaljUndertekst').textContent = [v.kategori, v.tegningsnummer].filter(Boolean).join(' · ');
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
    if (!confirm(`Det er kun ${fmtAntall(v.antall)} ${v.enhet} igjen. Fortsett og gå i minus?`)) return;
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
function registrerLagerEndring(v, endring, type, ordreId, kommentar, batchId, lagerBatch) {
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
  const hist = { id:hId, vareId:v.id, vareNavn:v.navn, endring, type, ordreId:ordreId||null, batchId:batchId||null, ansattNavn: me?me.navn:'', kommentar:kommentar||'', createdAt:new Date().toISOString() };
  S.lagerhistorikk = S.lagerhistorikk || [];
  S.lagerhistorikk.unshift(hist);

  const vareOppdatering = bestiltEndret ? {id:v.id, antall:v.antall, bestilt:false} : {id:v.id, antall:v.antall};
  const historikkInnsetting = {id:hId, vare_id:v.id, vare_navn:v.navn, endring, type, ordre_id:ordreId||null, batch_id:batchId||null, ansatt_navn: me?me.navn:'', kommentar:kommentar||''};
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

// Marker alle lave, ikke-bestilte varer i en kategori som bestilt samlet
function settKategoriBestilt(kategori) {
  const varer = (S.lagervarer||[]).filter(v => (v.kategori||'Uten kategori') === kategori && v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
  varer.forEach(v => settVareBestilt(v.id, true));
}

// ════════════════════════════════════════════════════
// BESTILLINGSLISTE — samler alle lave varer i én liste, gruppert per kategori
// ════════════════════════════════════════════════════
function laveVarerForBestilling() {
  return (S.lagervarer||[]).filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
}

function bestillingslisteGruppert() {
  const grupper = {};
  laveVarerForBestilling().forEach(v => {
    const kat = v.kategori || 'Uten kategori';
    (grupper[kat] = grupper[kat] || []).push(v);
  });
  return grupper;
}

function visBestillingsliste() {
  const grupper = bestillingslisteGruppert();
  const antall = Object.values(grupper).reduce((s,a)=>s+a.length, 0);
  const el = document.getElementById('bestillingslisteInnhold');

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
              onclick="settKategoriBestilt('${esc(kat).replace(/'/g,"\\'")}');visBestillingsliste()">✓ Bestilt</button>
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
  const LOGO = document.querySelector('#appScreen img')?.src || '';

  const innhold = Object.entries(grupper).map(([kat, varer]) => `
    <h2>${esc(kat)} <span class="kat-antall">${varer.length} vare${varer.length===1?'':'r'}</span></h2>
    <table>
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
      .topp img{height:48px;object-fit:contain}
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
        ${LOGO?`<img src="${LOGO}" alt="Salmaker'n">`:'<div></div>'}
        <div class="topp-h">
          <h1>Bestillingsliste</h1>
          <div class="undertittel">Salmaker'n · varelager</div>
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
  el.innerHTML = `<div onclick="visBestillingsliste()" style="cursor:pointer;background:#450a0a;border:1px solid #ef4444cc;border-radius:16px;padding:12px 14px;margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
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
    const varianter = (S.lagerOppskrifter||[]).filter(o=>o.biltype===m);
    const antallDeler = new Set(varianter.flatMap(o => (o.ingredienser||[]).map(i=>i.vareId))).size;
    return `<div class="box" style="cursor:pointer" onclick="visOppskriftModell('${esc(m).replace(/'/g,"\\'")}')">
      <div class="row"><b>${esc(m)}</b><span style="color:#a1a1aa">›</span></div>
      <div class="small muted" style="margin-top:2px">${
        varianter.length
          ? `${varianter.length} variant${varianter.length===1?'':'er'} · ${antallDeler} deler totalt`
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
  const varianter = (S.lagerOppskrifter||[]).filter(o=>o.biltype===modell).sort((a,b)=>(a.variant||'').localeCompare(b.variant||'','no'));

  // Generell oversikt: alle deler brukt i minst én variant av modellen, uavhengig av hvilken
  const delerMap = {};
  varianter.forEach(o => (o.ingredienser||[]).forEach(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
    (delerMap[i.vareId] = delerMap[i.vareId] || {navn:v.navn, enhet:v.enhet, bruk:[]}).bruk.push({variant:o.variant||'Generelt', antall:i.antall});
  }));
  const generellEl = document.getElementById('oppskriftModellGenerellOversikt');
  const delerListe = Object.values(delerMap).sort((a,b)=>a.navn.localeCompare(b.navn,'no'));
  generellEl.innerHTML = delerListe.length ? delerListe.map(d => `
    <div class="box" style="margin-bottom:5px;padding:8px 10px">
      <b>${esc(d.navn)}</b>
      <div class="small muted" style="margin-top:2px">${d.bruk.map(b=>`${fmtAntall(b.antall)} ${esc(d.enhet)} – ${esc(b.variant)}`).join(', ')}</div>
    </div>`).join('') : '<div class="muted small">Ingen deler lagt til på noen variant ennå</div>';

  const variantEl = document.getElementById('oppskriftVariantListeKort');
  variantEl.innerHTML = varianter.length ? varianter.map(o => {
    const deler = (o.ingredienser||[]).map(i => {
      const v = (S.lagervarer||[]).find(x=>x.id===i.vareId);
      return v ? `<span class="pill" style="margin:0;font-size:11.5px;padding:3px 10px">${fmtAntall(i.antall)} ${esc(v.enhet)} · ${esc(v.navn)}</span>` : null;
    }).filter(Boolean);
    return `<div class="box" style="margin-bottom:7px;padding:13px 14px">
      <div class="row">
        <b>${o.variant ? esc(o.variant) : 'Generelt (alle varianter)'}</b>
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
  }).join('') : `<div class="box" style="text-align:center;padding:22px">
      <div class="muted small">Ingen varianter opprettet ennå for denne modellen</div>
      <button class="btn sm red" style="margin-top:10px" onclick="apneNyOppskrift('${esc(modell).replace(/'/g,"\\'")}')">+ Ny variant</button>
    </div>`;
}

let oppskriftVisAlleVarer = false;

function fyllOppskriftVareListe(forhaandsvalgt) {
  forhaandsvalgt = forhaandsvalgt || {};
  const biltype = document.getElementById('oppskriftBiltype').value;
  const el = document.getElementById('oppskriftIngrediensListe');
  let varer = (S.lagervarer||[]).slice();
  const iKategori = biltype ? varer.filter(v => (v.kategori||'').toLowerCase() === biltype.toLowerCase()) : [];
  const brukAlle = oppskriftVisAlleVarer || !biltype || !iKategori.length;
  varer = (brukAlle ? varer : iKategori).sort((a,b)=>a.navn.localeCompare(b.navn,'no'));

  if (!varer.length) {
    el.innerHTML = '<div class="muted small">Ingen varer i lageret ennå. Legg til varer under Lager først.</div>';
    return;
  }

  el.innerHTML = `
    ${(!brukAlle || (biltype && iKategori.length)) ? `<div class="small" style="margin-bottom:6px">
      <a href="#" onclick="event.preventDefault();oppskriftVisAlleVarer=!oppskriftVisAlleVarer;fyllOppskriftVareListe(lesOppskriftIngredienser());" style="color:#f87171">
        ${oppskriftVisAlleVarer ? '↩ Vis kun varer i "'+esc(biltype)+'"-kategorien' : '+ Vis alle varer i lageret (ikke bare "'+esc(biltype)+'")'}
      </a>
    </div>` : ''}
    ${(() => {
      const grupper = {};
      varer.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
      return Object.entries(grupper).map(([kat, katVarer]) => {
        const valgtIKat = katVarer.filter(v => forhaandsvalgt[v.id] != null).length;
        return `<div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:5px;border-bottom:1px solid #27272a;margin-bottom:4px">
            <span class="small" style="font-weight:700;letter-spacing:.5px">${esc(kat)}</span>
            <span class="small muted" style="font-size:11px">${valgtIKat} av ${katVarer.length} valgt</span>
          </div>
          ${katVarer.map(v => {
            const valgt = forhaandsvalgt[v.id] != null;
            return `<label style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid #ffffff08">
              <input type="checkbox" class="oppskrift-vare-chk" data-vare-id="${v.id}" ${valgt?'checked':''}
                onchange="this.nextElementSibling.style.display=this.checked?'inline-block':'none'"
                style="width:16px;height:16px;accent-color:#ef4444;flex-shrink:0">
              <input type="number" class="oppskrift-vare-antall" min="0" step="any" value="${valgt?forhaandsvalgt[v.id]:1}"
                style="width:64px;display:${valgt?'inline-block':'none'};flex-shrink:0">
              <span style="font-size:13px;flex:1;min-width:0">${esc(v.navn)} <span class="muted small">(${esc(v.enhet)})</span></span>
            </label>`;
          }).join('')}
        </div>`;
      }).join('');
    })()}
  `;
}

function lesOppskriftIngredienser() {
  const valgt = {};
  document.querySelectorAll('#oppskriftIngrediensListe .oppskrift-vare-chk').forEach(chk => {
    if (chk.checked) valgt[chk.dataset.vareId] = Number(chk.nextElementSibling.value) || 1;
  });
  return valgt;
}

function fyllVariantForslag() {
  const dl = document.getElementById('oppskriftVariantListe');
  if (!dl) return;
  const fraOppskrifter = (S.lagerOppskrifter||[]).map(o=>o.variant).filter(Boolean);
  const fraOrdrer = (S.ordrer||[]).map(o=>o.variant).filter(Boolean);
  const alle = [...new Set([...fraOppskrifter, ...fraOrdrer])].sort((a,b)=>a.localeCompare(b,'no'));
  dl.innerHTML = alle.map(v=>`<option value="${esc(v)}">`).join('');
}

function apneNyOppskrift(forhaandsvalgtModell) {
  if (!(S.lagervarer||[]).length) { alert('Legg til minst én vare i lageret først'); return; }
  document.getElementById('oppskriftModalTittel').textContent = 'Ny oppskrift';
  document.getElementById('redigerOppskriftId').value = '';
  document.getElementById('oppskriftNavn').value = '';
  document.getElementById('oppskriftBiltype').innerHTML = modellSelectOptions(forhaandsvalgtModell||'');
  document.getElementById('oppskriftVariant').value = '';
  fyllVariantForslag();
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
  document.getElementById('oppskriftVariant').value = o.variant||'';
  fyllVariantForslag();
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
  const variant = document.getElementById('oppskriftVariant').value.trim();
  const editId = document.getElementById('redigerOppskriftId').value;
  const valgt = lesOppskriftIngredienser();
  const ingredienser = Object.entries(valgt).map(([vareId, antall]) => ({vareId, antall})).filter(i => i.antall > 0);
  if (!ingredienser.length) { alert('Huk av minst én vare med antall større enn 0'); return; }

  if (editId) {
    const o = (S.lagerOppskrifter||[]).find(x=>x.id===editId); if (!o) return;
    o.navn = navn; o.biltype = biltype; o.variant = variant; o.ingredienser = ingredienser;
    if (db) db.from('lager_oppskrifter').update({navn, biltype, variant, ingredienser}).eq('id', o.id)
      .then(r=>{if(r.error) console.error('Oppskrift-oppdatering feilet:', r.error.message);});
  } else {
    const id = 'oppskrift_' + Date.now();
    const oppskrift = { id, navn, biltype, variant, ingredienser, createdAt:new Date().toISOString() };
    S.lagerOppskrifter = S.lagerOppskrifter || [];
    S.lagerOppskrifter.push(oppskrift);
    if (db) db.from('lager_oppskrifter').insert({id, navn, biltype, variant, ingredienser})
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
// En oppskrift matcher en ordre på modell (Merke + Modell), og eksakt på
// ombygging-varianten valgt i dropdownen (blank/Standard = gjelder alle varianter).
function oppskriftMatcherOrdre(r, o) {
  if (!r.biltype) return false;
  const biltypeTekst = merkeModell(o).toLowerCase();
  if (!biltypeTekst) return false;
  const biltypeR = r.biltype.toLowerCase();
  if (!(biltypeTekst.includes(biltypeR) || biltypeR.includes(biltypeTekst))) return false;
  if (!r.variant) return true; // Standard-oppskrift uten variant gjelder uansett hvilken variant ordren har
  return o.ombygging?.variant === r.variant;
}

function renderOrdreLagerbruk() {
  const el = document.getElementById('ordreLagerbruk_' + activeOrdreId);
  if (!el) return;
  const o = S.ordrer.find(x=>x.id===activeOrdreId); if (!o) return;

  const treff = (S.lagerOppskrifter||[]).filter(r => oppskriftMatcherOrdre(r, o));

  const brukteBatcher = {};
  (S.lagerhistorikk||[]).filter(h => h.ordreId===o.id && h.batchId).forEach(h => {
    (brukteBatcher[h.batchId] = brukteBatcher[h.batchId] || []).push(h);
  });
  const brukteNavn = new Set(Object.values(brukteBatcher).map(rader=>rader[0].kommentar));
  const batchHTML = Object.entries(brukteBatcher).map(([batchId, rader]) => {
    const navn = rader[0].kommentar || 'Oppskrift';
    return `<div class="box" style="margin-bottom:6px;padding:10px">
      <div class="row">
        <b>${esc(navn)}</b>
        <button class="btn sm" onclick="angreLagerBatch('${batchId}')">↩ Angre</button>
      </div>
      <div class="small muted" style="margin-top:4px">${rader.map(r=>`${fmtAntall(Math.abs(r.endring))} ${esc(r.vareNavn)}`).join(', ')}</div>
    </div>`;
  }).join('');

  const ubrukteTreff = treff.filter(r => !brukteNavn.has(r.navn));
  const forslagHTML = ubrukteTreff.length ? ubrukteTreff.map(r => `
    <div class="box" style="margin-bottom:6px;padding:10px">
      <div class="row">
        <div><b>${esc(r.navn)}</b> <span class="small muted">– ${esc(r.biltype)}</span></div>
        <button class="btn sm red" onclick="trekkOppskriftForOrdre('${r.id}')">Trekk fra lager</button>
      </div>
      <div class="small muted" style="margin-top:4px">${(r.ingredienser||[]).map(i=>{
        const v=(S.lagervarer||[]).find(x=>x.id===i.vareId); return v?`${fmtAntall(i.antall)} ${esc(v.enhet)} ${esc(v.navn)}`:null;
      }).filter(Boolean).join(', ')}</div>
    </div>`).join('') : '';

  const modellTekst = merkeModell(o);
  el.innerHTML = `
    ${batchHTML ? `<div class="small muted" style="margin-bottom:6px">Trukket fra lager på denne ordren</div>${batchHTML}` : ''}
    ${forslagHTML ? `<div class="small muted" style="margin:${batchHTML?'10px':'0'} 0 6px">${batchHTML?'Andre':'Tilgjengelige'} oppskrifter for "${esc(modellTekst)}"</div>${forslagHTML}` : ''}
    ${!batchHTML && !forslagHTML ? `<div class="muted small">${modellTekst ? `Ingen oppskrift funnet for "${esc(modellTekst)}". Lag en under Lager-fanen.` : 'Fyll inn Merke og Modell på ordren for å se aktuelle oppskrifter.'}</div>` : ''}
  `;
}

function trekkOppskriftForOrdre(oppskriftId) {
  const r = (S.lagerOppskrifter||[]).find(x=>x.id===oppskriftId); if (!r) return;
  const o = S.ordrer.find(x=>x.id===activeOrdreId); if (!o) return;
  const mangler = (r.ingredienser||[]).filter(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId);
    return !v || v.antall < i.antall;
  });
  if (mangler.length && !confirm('Det er ikke nok på lager av alle varene i denne oppskriften. Fortsett og gå i minus der det trengs?')) return;

  const batchId = 'batch_' + Date.now();
  const lagerBatch = lagerBatchNy();
  (r.ingredienser||[]).forEach(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
    registrerLagerEndring(v, -Math.abs(i.antall), 'ut', o.id, r.navn, batchId, lagerBatch);
  });
  lagerBatchFlush(lagerBatch);
  renderOrdreLagerbruk();
}

// Kalles automatisk når type/modell settes på en ordre (sf() og opprettOrdre()).
// Trekker fra lager for alle matchende oppskrifter som ikke allerede er brukt på denne ordren.
// Kjører stille (ingen bekreftelsesdialog) siden den trigges i bakgrunnen - varsler heller med en toast.
function autoTrekkOppskrift(ordreId) {
  const o = S.ordrer.find(x=>x.id===ordreId); if (!o || !merkeModell(o)) return;
  const treff = (S.lagerOppskrifter||[]).filter(r => oppskriftMatcherOrdre(r, o));
  if (!treff.length) return;

  const brukteNavn = new Set((S.lagerhistorikk||[]).filter(h=>h.ordreId===ordreId && h.batchId).map(h=>h.kommentar));
  const nye = treff.filter(r => !brukteNavn.has(r.navn));
  if (!nye.length) return;

  const lagerBatch = lagerBatchNy();
  nye.forEach(r => {
    const batchId = 'batch_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    let underMinimum = false;
    (r.ingredienser||[]).forEach(i => {
      const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
      if (v.antall < i.antall) underMinimum = true;
      registrerLagerEndring(v, -Math.abs(i.antall), 'ut', ordreId, r.navn, batchId, lagerBatch);
    });
    visToast(`Trukket fra lager: ${r.navn}${underMinimum ? ' (noen varer gikk i minus)' : ''}`, underMinimum ? 'feil' : 'ok');
  });
  lagerBatchFlush(lagerBatch);
  if (activeOrdreId === ordreId) renderOrdreLagerbruk();
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
