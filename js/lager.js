// ════════════════════════════════════════════════════
// VARELAGER
// ════════════════════════════════════════════════════
let aktivVareId = null;

function fmtAntall(n) {
  n = Number(n)||0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/,'');
}

function oppdaterLagerVarselBadge() {
  const el = document.getElementById('lagerVarselBadge');
  if (!el) return;
  const varer = S.lagervarer||[];
  const lave = varer.filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
  el.innerHTML = lave.length
    ? `<span style="color:#f87171">⚠ Lav beholdning: ${lave.map(v=>
        `<a href="#" onclick="event.preventDefault();visVareDetalj('${v.id}')" style="color:#f87171;text-decoration:underline;cursor:pointer">${esc(v.navn)} (${fmtAntall(v.antall)} ${esc(v.enhet)})</a>`
      ).join(', ')}</span>`
    : `${varer.length} vare${varer.length===1?'':'r'} på lager`;
}

let aktivKategori = null;

function renderLagerListe() {
  oppdaterLagerVarselBadge();
  const el = document.getElementById('lagerListe');
  const sok = (document.getElementById('lagerSokInput')?.value||'').toLowerCase().trim();
  let varer = (S.lagervarer||[]).slice().sort((a,b)=>a.navn.localeCompare(b.navn,'no'));

  const dl = document.getElementById('lagerKategoriListe');
  if (dl) {
    const alleKat = [...new Set((S.lagervarer||[]).map(v=>v.kategori).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'no'));
    dl.innerHTML = alleKat.map(k=>`<option value="${esc(k)}">`).join('');
  }

  if (sok) {
    // Ved søk: vis treffene direkte, uten å måtte inn i en kategori
    varer = varer.filter(v => v.navn.toLowerCase().includes(sok) || (v.kategori||'').toLowerCase().includes(sok) || (v.leverandor||'').toLowerCase().includes(sok));
    el.innerHTML = varer.length ? `<div class="grid g3">${varer.map(v => vareBoksHTML(v)).join('')}</div>` : '<div class="card"><div class="muted small">Ingen varer funnet</div></div>';
    return;
  }

  if (!varer.length) { el.innerHTML = '<div class="card"><div class="muted small">Ingen varer i lageret ennå</div></div>'; return; }

  const grupper = {};
  varer.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
  const kategorier = Object.keys(grupper).sort((a,b)=> a==='Uten kategori'?1 : b==='Uten kategori'?-1 : a.localeCompare(b,'no'));

  el.innerHTML = `<div class="grid g3">${kategorier.map(kat => {
    const lavtIKat = grupper[kat].filter(v=>v.minAntall>0 && v.antall<=v.minAntall && !v.bestilt).length;
    return `<div class="box" style="cursor:pointer" onclick="visKategoriDetalj('${kat.replace(/'/g,"\\'")}')">
      <div class="row">
        <b>${esc(kat)}</b>
        <span style="color:#a1a1aa">›</span>
      </div>
      <div class="small muted" style="margin-top:2px">${grupper[kat].length} vare${grupper[kat].length===1?'':'r'}${lavtIKat?` · <span style="color:#f87171">⚠ ${lavtIKat} lav</span>`:''}</div>
    </div>`;
  }).join('')}</div>`;
}

function vareBoksHTML(v) {
  const lavt = v.minAntall > 0 && v.antall <= v.minAntall;
  return `<div class="box" style="cursor:pointer;${lavt && !v.bestilt?'border-color:#ef4444':''}" onclick="visVareDetalj('${v.id}')">
    <div class="row">
      <b>${esc(v.navn)}</b>
      <span style="font-weight:700;${lavt && !v.bestilt?'color:#f87171':''}">${fmtAntall(v.antall)} ${esc(v.enhet)}</span>
    </div>
    ${v.leverandor?`<div class="small muted" style="margin-top:2px">${esc(v.leverandor)}</div>`:''}
    ${lavt?`<div class="small" style="color:${v.bestilt?'#4ade80':'#f87171'};margin-top:4px">${v.bestilt?'✓ Bestilt':'⚠ Lav beholdning'}</div>`:''}
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
  const varer = (S.lagervarer||[]).filter(v => (v.kategori || 'Uten kategori') === aktivKategori).sort((a,b)=>a.navn.localeCompare(b.navn,'no'));
  const el = document.getElementById('kategoriVareListe');
  el.innerHTML = varer.length ? `<div class="grid g3">${varer.map(v => vareBoksHTML(v)).join('')}</div>` : '<div class="card"><div class="muted small">Ingen varer i denne kategorien ennå</div></div>';
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
  varer.forEach(v => {
    v.kategori = trimmet;
    if (db) db.from('lagervarer').update({kategori:trimmet}).eq('id', v.id)
      .then(r=>{if(r.error) console.error('Kategori-oppdatering feilet:', r.error.message);});
  });
  aktivKategori = trimmet || 'Uten kategori';
  renderKategoriDetalj();
}

function apneNyVare() {
  document.getElementById('nyVareModalTittel').textContent = 'Ny vare';
  document.getElementById('redigerVareId').value = '';
  document.getElementById('nyVareNavn').value = '';
  document.getElementById('nyVareKategori').value = '';
  document.getElementById('nyVareLeverandor').value = '';
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
  document.getElementById('nyVareLeverandor').value = v.leverandor||'';
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
  const leverandor = document.getElementById('nyVareLeverandor').value.trim();
  const enhet      = document.getElementById('nyVareEnhet').value.trim() || 'stk';
  const minAntall  = Number(document.getElementById('nyVareMinAntall').value) || 0;
  const notat      = document.getElementById('nyVareNotat').value.trim();

  if (redigerId) {
    const v = (S.lagervarer||[]).find(x=>x.id===redigerId); if (!v) return;
    v.navn = navn; v.kategori = kategori; v.leverandor = leverandor; v.enhet = enhet; v.minAntall = minAntall; v.notat = notat;
    if (db) db.from('lagervarer').update({navn, kategori, leverandor, enhet, min_antall:minAntall, notat}).eq('id', v.id)
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
    const vare = { id, navn, kategori, leverandor, antall, enhet, minAntall, notat:notatMedAvvik, createdAt:new Date().toISOString() };
    S.lagervarer = S.lagervarer || [];
    S.lagervarer.push(vare);
    if (db) db.from('lagervarer').insert({id, navn, kategori, leverandor, antall, enhet, min_antall:minAntall, notat:notatMedAvvik})
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
  document.getElementById('vareDetaljUndertekst').textContent = [v.kategori, v.leverandor].filter(Boolean).join(' · ');
  document.getElementById('vareDetaljAntall').textContent = fmtAntall(v.antall);
  document.getElementById('vareDetaljEnhet').textContent = v.enhet;
  const lavt = v.minAntall > 0 && v.antall <= v.minAntall;
  document.getElementById('vareLavLagerVarsel').innerHTML = lavt
    ? `<span style="color:${v.bestilt?'#4ade80':'#f87171'}">${v.bestilt?'✓ Bestilt':'⚠ Lav beholdning'} (varsler ved ${fmtAntall(v.minAntall)} ${esc(v.enhet)})</span>
       <button class="btn sm" style="margin-left:8px;padding:2px 8px;font-size:11px" onclick="settVareBestilt('${v.id}',${!v.bestilt})">${v.bestilt?'Fjern bestilt-merking':'✓ Merk som bestilt'}</button>`
    : (v.notat ? `<span class="muted">${esc(v.notat)}</span>` : '');

  const historikk = (S.lagerhistorikk||[]).filter(h=>h.vareId===v.id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const el = document.getElementById('vareHistorikkListe');
  el.innerHTML = historikk.length ? historikk.slice(0,50).map(h => {
    const positiv = h.endring > 0;
    const o = h.ordreId ? S.ordrer.find(x=>x.id===h.ordreId) : null;
    const tid = h.createdAt ? new Date(h.createdAt).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="box" style="margin-bottom:5px;padding:8px 10px">
      <div class="row">
        <div class="small">${tid} · ${esc(h.ansattNavn||'—')}</div>
        <b style="color:${positiv?'#4ade80':'#f87171'}">${positiv?'+':''}${fmtAntall(h.endring)}</b>
      </div>
      ${(o || h.kommentar) ? `<div class="small muted" style="margin-top:2px">${o?`Ordre: ${esc(ordreLabel(o))}`:''}${o && h.kommentar?' · ':''}${esc(h.kommentar||'')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="muted small">Ingen historikk ennå</div>';
}

function fyllPaLager() {
  document.getElementById('lagerEndringTittel').textContent = 'Fyll på lager';
  document.getElementById('lagerEndringVareId').value = aktivVareId;
  document.getElementById('lagerEndringFortegn').value = '1';
  document.getElementById('lagerEndringAntall').value = '';
  document.getElementById('lagerEndringKommentar').value = '';
  document.getElementById('lagerEndringForventet').value = '';
  document.getElementById('lagerEndringForventetWrap').style.display = 'block';
  document.getElementById('lagerEndringAntallLabel').textContent = 'Mottatt antall';
  openModal('lagerEndringModal');
}
function taUtFraLager() {
  document.getElementById('lagerEndringTittel').textContent = 'Ta ut fra lager';
  document.getElementById('lagerEndringVareId').value = aktivVareId;
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
  renderVareDetalj();
}

function varselMangelfullLevering(v, forventet, mottatt, mangler) {
  fetch(SUPA_URL + '/functions/v1/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPA_KEY },
    body: JSON.stringify({ type: 'mangelfull_levering', vareNavn: v.navn, forventet, mottatt, mangler, enhet: v.enhet })
  }).catch(e => console.warn('Mangelfull leverings-varsel feilet:', e));
}

function registrerLagerEndring(v, endring, type, ordreId, kommentar, batchId) {
  const varLavFor = v.minAntall > 0 && (Number(v.antall)||0) <= v.minAntall;
  v.antall = (Number(v.antall)||0) + endring;
  const erLavNa = v.minAntall > 0 && v.antall <= v.minAntall;

  // Nullstill "bestilt"-merking automatisk når varen fylles opp over grensen igjen,
  // slik at neste gang den blir lav gir et nytt, friskt varsel.
  if (!erLavNa && v.bestilt) {
    v.bestilt = false;
    if (db) db.from('lagervarer').update({bestilt:false}).eq('id', v.id)
      .then(r=>{if(r.error) console.error('Bestilt-nullstilling feilet:', r.error.message);});
  }

  if (db) db.from('lagervarer').update({antall:v.antall}).eq('id', v.id)
    .then(r=>{if(r.error) console.error('Lagerbeholdning-oppdatering feilet:', r.error.message);});
  const hId = 'lh_' + Date.now() + '_' + Math.floor(Math.random()*1000);
  const hist = { id:hId, vareId:v.id, vareNavn:v.navn, endring, type, ordreId:ordreId||null, batchId:batchId||null, ansattNavn: me?me.navn:'', kommentar:kommentar||'', createdAt:new Date().toISOString() };
  S.lagerhistorikk = S.lagerhistorikk || [];
  S.lagerhistorikk.unshift(hist);
  if (db) db.from('lagerhistorikk').insert({id:hId, vare_id:v.id, vare_navn:v.navn, endring, type, ordre_id:ordreId||null, batch_id:batchId||null, ansatt_navn: me?me.navn:'', kommentar:kommentar||''})
    .then(r=>{if(r.error) console.error('Lagerhistorikk-lagring feilet:', r.error.message);});
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
// BESTILLINGSLISTE — samler alle lave varer i én liste, gruppert per leverandør
// ════════════════════════════════════════════════════
function laveVarerForBestilling() {
  return (S.lagervarer||[]).filter(v => v.minAntall > 0 && v.antall <= v.minAntall && !v.bestilt);
}

// Gruppert per leverandør, og innenfor hver leverandør videre per kategori
function bestillingslisteGruppert() {
  const grupper = {};
  laveVarerForBestilling().forEach(v => {
    const lev = v.leverandor || 'Uten leverandør';
    const kat = v.kategori || 'Uten kategori';
    grupper[lev] = grupper[lev] || {};
    (grupper[lev][kat] = grupper[lev][kat] || []).push(v);
  });
  return grupper;
}

function visBestillingsliste() {
  const grupper = bestillingslisteGruppert();
  const leverandorer = Object.keys(grupper);
  const antall = leverandorer.reduce((s,lev)=>s+Object.values(grupper[lev]).reduce((s2,a)=>s2+a.length,0), 0);
  const el = document.getElementById('bestillingslisteInnhold');
  el.innerHTML = antall
    ? leverandorer.map(lev => `
        <div style="margin-bottom:14px">
          <div style="font-weight:700;color:#f87171;margin-bottom:6px">${esc(lev)}</div>
          ${Object.entries(grupper[lev]).map(([kat, varer]) => `
            <div style="margin-bottom:8px;margin-left:8px">
              <div class="small muted" style="font-weight:600;margin-bottom:2px">${esc(kat)}</div>
              ${varer.map(v=>`
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #27272a30">
                  <span>${esc(v.navn)}</span>
                  <span class="small muted">${fmtAntall(v.antall)} / ${fmtAntall(v.minAntall)} ${esc(v.enhet)}</span>
                </div>`).join('')}
            </div>`).join('')}
        </div>`).join('')
    : '<div class="muted small">Ingen varer er under lav-grensen akkurat nå.</div>';
  document.getElementById('bestillingslisteHandlinger').style.display = antall ? 'flex' : 'none';
  openModal('bestillingslisteModal');
}

function bestillingslisteSomTekst() {
  const grupper = bestillingslisteGruppert();
  const dato = new Date().toLocaleDateString('no');
  let tekst = `Bestillingsliste – ${dato}\n\n`;
  Object.entries(grupper).forEach(([lev, kategorier]) => {
    tekst += `${lev}:\n`;
    Object.entries(kategorier).forEach(([kat, varer]) => {
      tekst += `  ${kat}:\n`;
      varer.forEach(v => { tekst += `  - ${v.navn} (${fmtAntall(v.antall)} av ${fmtAntall(v.minAntall)} ${v.enhet} igjen)\n`; });
    });
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
  const grupper = {};
  lave.forEach(v => { const k = v.kategori || 'Uten kategori'; (grupper[k] = grupper[k] || []).push(v); });
  el.style.display = 'block';
  el.innerHTML = `<div style="background:#450a0a;border:1px solid #ef4444cc;border-radius:10px;padding:8px 10px;margin-top:8px;font-size:12px;color:#fca5a5">
    ${Object.entries(grupper).map(([kat, varer]) => `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <b>⚠ ${esc(kat)}:</b>
        ${varer.map(v=>`<span style="white-space:nowrap">${esc(v.navn)} (${fmtAntall(v.antall)} ${esc(v.enhet)})
          <a href="#" onclick="event.preventDefault();gaaTilVareFraVarsel('${v.id}')" style="color:#fca5a5">vis</a> ·
          <a href="#" onclick="event.preventDefault();settVareBestilt('${v.id}',true)" style="color:#fca5a5">bestilt</a></span>`).join(', ')}
        <button onclick="settKategoriBestilt('${kat.replace(/'/g,"\\'")}')" class="btn sm" style="padding:2px 8px;font-size:10px;margin-left:auto">✓ Bestill hele kategorien</button>
      </div>
    `).join('')}
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
    return `<div class="box" style="cursor:pointer" onclick="visOppskriftModell('${m.replace(/'/g,"\\'")}')">
      <div class="row"><b>${esc(m)}</b><span style="color:#a1a1aa">›</span></div>
      <div class="small muted" style="margin-top:2px">${varianter.length ? varianter.length+' variant'+(varianter.length===1?'':'er') : 'Ingen oppskrift ennå'}</div>
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
  variantEl.innerHTML = varianter.length ? varianter.map(o => `
    <div class="box" style="margin-bottom:6px;padding:10px">
      <div class="row">
        <b>${o.variant ? esc(o.variant) : 'Generelt (alle varianter)'}</b>
        <div style="display:flex;gap:6px">
          <button class="btn sm" onclick="apneRedigerOppskrift('${o.id}')">✎ Rediger</button>
          <button class="btn sm red" onclick="slettOppskrift('${o.id}')">🗑</button>
        </div>
      </div>
      <div class="small muted" style="margin-top:4px">${(o.ingredienser||[]).map(i=>{
        const v = (S.lagervarer||[]).find(x=>x.id===i.vareId);
        return v ? `${fmtAntall(i.antall)} ${esc(v.enhet)} ${esc(v.navn)}` : null;
      }).filter(Boolean).join(', ') || 'Ingen deler lagt til'}</div>
    </div>`).join('') : '<div class="muted small">Ingen varianter opprettet ennå for denne modellen</div>';
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
    ${varer.map(v => {
      const valgt = forhaandsvalgt[v.id] != null;
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #27272a">
        <input type="checkbox" class="oppskrift-vare-chk" data-vare-id="${v.id}" ${valgt?'checked':''} onchange="this.nextElementSibling.style.display=this.checked?'inline-block':'none'" style="width:16px;height:16px;accent-color:#ef4444;flex-shrink:0">
        <input type="number" class="oppskrift-vare-antall" min="0" step="any" value="${valgt?forhaandsvalgt[v.id]:1}" style="width:64px;display:${valgt?'inline-block':'none'};flex-shrink:0">
        <span style="font-size:13px;flex:1">${esc(v.navn)} <span class="muted small">(${esc(v.enhet)})</span></span>
      </label>`;
    }).join('')}
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
  (r.ingredienser||[]).forEach(i => {
    const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
    registrerLagerEndring(v, -Math.abs(i.antall), 'ut', o.id, r.navn, batchId);
  });
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

  nye.forEach(r => {
    const batchId = 'batch_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    let underMinimum = false;
    (r.ingredienser||[]).forEach(i => {
      const v = (S.lagervarer||[]).find(x=>x.id===i.vareId); if (!v) return;
      if (v.antall < i.antall) underMinimum = true;
      registrerLagerEndring(v, -Math.abs(i.antall), 'ut', ordreId, r.navn, batchId);
    });
    visToast(`Trukket fra lager: ${r.navn}${underMinimum ? ' (noen varer gikk i minus)' : ''}`, underMinimum ? 'feil' : 'ok');
  });
  if (activeOrdreId === ordreId) renderOrdreLagerbruk();
}

function angreLagerBatch(batchId) {
  if (!confirm('Angre denne uttrekkingen og legge varene tilbake på lager?')) return;
  const rader = (S.lagerhistorikk||[]).filter(h=>h.batchId===batchId);
  rader.forEach(h => {
    const v = (S.lagervarer||[]).find(x=>x.id===h.vareId);
    if (v) {
      v.antall = (Number(v.antall)||0) - h.endring;
      if (db) db.from('lagervarer').update({antall:v.antall}).eq('id', v.id)
        .then(r=>{if(r.error) console.error('Lagerbeholdning-oppdatering feilet:', r.error.message);});
    }
    if (db) db.from('lagerhistorikk').delete().eq('id', h.id)
      .then(r=>{if(r.error) console.error('Sletting av lagerhistorikk feilet:', r.error.message);});
  });
  S.lagerhistorikk = (S.lagerhistorikk||[]).filter(h=>h.batchId!==batchId);
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
