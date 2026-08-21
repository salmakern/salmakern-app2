// ════════════════════════════════════════════════════
// FLÅTEGODKJENNING
// ════════════════════════════════════════════════════
let flaterVisning = 'aktiv'; // 'aktiv' | 'arkivert'
let aktivFlateId  = null;

function visFlaterModal() {
  aktivFlateId = null;
  document.getElementById('flaterListeView').style.display = 'block';
  document.getElementById('flateDetaljView').style.display = 'none';
  renderFlaterListe();
  openModal('flaterModal');
}

function toggleFlaterVisning() {
  flaterVisning = flaterVisning === 'aktiv' ? 'arkivert' : 'aktiv';
  document.getElementById('flaterVisningBtn').textContent = flaterVisning === 'aktiv' ? 'Aktive flåter' : 'Arkiverte flåter';
  renderFlaterListe();
}

function renderFlaterListe() {
  const liste = (S.flater||[]).filter(f => f.status === flaterVisning).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const el = document.getElementById('flaterListe');
  el.innerHTML = liste.length ? liste.map(f => {
    const ordrer = (S.ordrer||[]).filter(o=>o.flateId===f.id);
    const aktiveOrdrer = ordrer.filter(o=>o.status==='aktiv');
    return `<div class="box" style="margin-bottom:8px;cursor:pointer" onclick="visFlateDetalj('${f.id}')">
      <div class="row">
        <div><b>${esc(f.flatenummer)}</b></div>
        <span class="small muted">${ordrer.length} ordre${ordrer.length===1?'':'r'}</span>
      </div>
      ${aktiveOrdrer.length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${aktiveOrdrer.map(o=>{
        const si = statusInfo(o.ordreStatus);
        return `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:${si.bg};color:${si.txt};border:1px solid ${si.border}">${si.lbl}</span>`;
      }).join('')}</div>` : ''}
    </div>`;
  }).join('') : `<div class="muted small">Ingen ${flaterVisning==='aktiv'?'aktive':'arkiverte'} flåter</div>`;
}

function apneNyFlate() {
  document.getElementById('nyFlateNummer').value = '';
  document.getElementById('nyFlatePrimaerSok').value = '';
  document.getElementById('nyFlatePrimaerResultat').innerHTML = '';
  document.getElementById('nyFlatePrimaerValgt').textContent = '';
  document.getElementById('nyFlatePrimaerId').value = '';
  openModal('nyFlateModal');
}

function renderNyFlatePrimaerSok(q) {
  const el = document.getElementById('nyFlatePrimaerResultat');
  q = q.trim().toLowerCase();
  if (!q) { el.innerHTML=''; return; }
  const treff = (S.ordrer||[]).filter(o => (
    (o.regnr||'').toLowerCase().includes(q) ||
    (o.chassis||'').toLowerCase().includes(q) ||
    (o.kunde||'').toLowerCase().includes(q)
  )).slice(0, 15);
  el.innerHTML = treff.length ? treff.map(o=>`<div class="box" style="margin-bottom:4px;padding:8px;display:flex;justify-content:space-between;align-items:center;gap:6px">
    <div><b>${ordreLabel(o)}</b> <span class="small muted">${esc(o.kunde||'')}</span></div>
    <button class="btn sm" onclick="velgNyFlatePrimaer('${o.id}')">Velg</button>
  </div>`).join('') : '<div class="muted small">Ingen treff</div>';
}

function velgNyFlatePrimaer(ordreId) {
  const o = S.ordrer.find(x=>x.id===ordreId); if (!o) return;
  document.getElementById('nyFlatePrimaerId').value = ordreId;
  document.getElementById('nyFlatePrimaerValgt').innerHTML = `Valgt: <b>${ordreLabel(o)}</b>`;
  document.getElementById('nyFlatePrimaerSok').value = '';
  document.getElementById('nyFlatePrimaerResultat').innerHTML = '';
}

function lagreNyFlate() {
  const nr = document.getElementById('nyFlateNummer').value.trim();
  if (!nr) { alert('Skriv inn et flåtenummer'); return; }
  const primaerId = document.getElementById('nyFlatePrimaerId').value || null;
  const id = 'flate_' + Date.now();
  const flate = { id, flatenummer:nr, status:'aktiv', primaerOrdreId:primaerId, createdAt:new Date().toISOString() };
  S.flater = S.flater || [];
  S.flater.push(flate);
  if (db) db.from('flater').insert({id, flatenummer:nr, status:'aktiv', primaer_ordre_id:primaerId})
    .then(r=>{if(r.error) console.error('Flåte-lagring feilet:', r.error.message);});
  if (primaerId) {
    const o = S.ordrer.find(x=>x.id===primaerId);
    if (o) { o.flateId = id; logChange(o,'Lagt i flåte som primær kjøretøy'); save(primaerId); }
  }
  closeModal('nyFlateModal');
  renderFlaterListe();
}

function visFlateDetalj(id) {
  aktivFlateId = id;
  document.getElementById('flaterListeView').style.display = 'none';
  document.getElementById('flateDetaljView').style.display = 'block';
  document.getElementById('flateSokInput').value = '';
  document.getElementById('flateSokResultat').innerHTML = '';
  renderFlateDetalj();
}

function tilbakeFlaterListe() {
  aktivFlateId = null;
  document.getElementById('flaterListeView').style.display = 'block';
  document.getElementById('flateDetaljView').style.display = 'none';
  renderFlaterListe();
}

function renderFlateDetalj() {
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId); if (!f) return;
  document.getElementById('flateDetaljTittel').value = f.flatenummer || '';
  document.getElementById('flateArkiverBtn').textContent = f.status === 'aktiv' ? 'Arkiver flåte' : 'Gjenopprett flåte';

  const ordrer = (S.ordrer||[]).filter(o=>o.flateId===f.id).sort(sorterOrdre);
  const el = document.getElementById('flateOrdreListe');
  el.innerHTML = ordrer.length ? ordrer.map(o => {
    const si = statusInfo(o.ordreStatus);
    const erPrimaer = f.primaerOrdreId === o.id;
    return `<div style="background:#111114;border:2px solid ${erPrimaer?'#facc15':si.border};border-radius:16px;padding:10px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <b style="cursor:pointer" onclick="closeModal('flaterModal');openOrdre('${o.id}')">${erPrimaer?'⭐ ':''}${ordreLabel(o)}</b>
        ${statusDropdown(o.id, o.ordreStatus)}
      </div>
      ${erPrimaer?'<div class="small" style="color:#facc15;margin-top:2px">Primær kjøretøy – kilden for type/variant/versjon/vekter</div>':''}
      <div class="small muted" style="margin-top:3px">${esc(o.kunde||'')}${o.status==='arkivert'?' · <span class="err-text">Arkivert</span>':''}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${erPrimaer?'':`<button class="btn sm" onclick="settFlatePrimaer('${o.id}')">☆ Gjør til primær</button>`}
        <button class="btn sm" onclick="fjernOrdreFraFlate('${o.id}')">✕ Fjern fra flåte</button>
      </div>
    </div>`;
  }).join('') : '<div class="muted small">Ingen ordrer i denne flåten ennå</div>';
}

function renderFlateSok(q) {
  const el = document.getElementById('flateSokResultat');
  q = q.trim().toLowerCase();
  if (!q) { el.innerHTML=''; return; }
  const treff = (S.ordrer||[]).filter(o => o.flateId !== aktivFlateId && (
    (o.regnr||'').toLowerCase().includes(q) ||
    (o.chassis||'').toLowerCase().includes(q) ||
    (o.kunde||'').toLowerCase().includes(q)
  )).slice(0, 15);
  el.innerHTML = treff.length ? treff.map(o=>`<div class="box" style="margin-bottom:4px;padding:8px;display:flex;justify-content:space-between;align-items:center;gap:6px">
    <div><b>${ordreLabel(o)}</b> <span class="small muted">${esc(o.kunde||'')}</span></div>
    <button class="btn sm" onclick="leggOrdreIFlate('${o.id}')">+ Legg til</button>
  </div>`).join('') : '<div class="muted small">Ingen treff</div>';
}

function leggOrdreIFlate(ordreId) {
  const o = S.ordrer.find(x=>x.id===ordreId); if (!o) return;
  o.flateId = aktivFlateId;
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId);
  if (f && f.primaerOrdreId && f.primaerOrdreId !== ordreId) {
    const primaer = S.ordrer.find(x=>x.id===f.primaerOrdreId);
    if (primaer) {
      o.type = primaer.type; o.variant = primaer.variant; o.versjon = primaer.versjon;
      o.vekter = JSON.parse(JSON.stringify(primaer.vekter));
    }
  }
  logChange(o, 'Lagt i flåte');
  save(ordreId);
  document.getElementById('flateSokInput').value = '';
  document.getElementById('flateSokResultat').innerHTML = '';
  renderFlateDetalj();
}

function fjernOrdreFraFlate(ordreId) {
  const o = S.ordrer.find(x=>x.id===ordreId); if (!o) return;
  o.flateId = null;
  logChange(o, 'Fjernet fra flåte');
  save(ordreId);
  renderFlateDetalj();
}

function sfFlate(field, val) {
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId); if (!f) return;
  val = val.trim();
  if (field === 'flatenummer' && !val) { alert('Flåtenummer kan ikke være tomt'); renderFlateDetalj(); return; }
  f[field] = val;
  if (db) db.from('flater').update({[field]:val}).eq('id', f.id)
    .then(r=>{if(r.error) console.error('Flåte-oppdatering feilet:', r.error.message);});
  renderFlaterListe();
}

function toggleArkiverFlate() {
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId); if (!f) return;
  f.status = f.status === 'aktiv' ? 'arkivert' : 'aktiv';
  if (db) db.from('flater').update({status:f.status}).eq('id', f.id)
    .then(r=>{if(r.error) console.error('Flåte-oppdatering feilet:', r.error.message);});
  renderFlateDetalj();
}

function settFlatePrimaer(ordreId) {
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId); if (!f) return;
  f.primaerOrdreId = ordreId;
  if (db) db.from('flater').update({primaer_ordre_id:ordreId}).eq('id', f.id)
    .then(r=>{if(r.error) console.error('Flåte-oppdatering feilet:', r.error.message);});
  synkroniserFraPrimaer(ordreId);
  renderFlateDetalj();
}

function slettFlate() {
  const f = (S.flater||[]).find(x=>x.id===aktivFlateId); if (!f) return;
  if (!confirm(`Slette flåten "${f.flatenummer}" helt? Ordrene i den blir ikke slettet, bare koblet fra flåten.`)) return;
  const medlemmer = (S.ordrer||[]).filter(o=>o.flateId===f.id);
  medlemmer.forEach(o => { o.flateId = null; });
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  S.flater = (S.flater||[]).filter(x=>x.id!==f.id);
  if (db) {
    // Ett samlet kall for alle medlemsordrene i stedet for ett save()-kall (og dermed
    // ett update-kall) per ordre - samme mønster som de andre batch-fiksene i dag.
    if (medlemmer.length) db.from('ordrer').upsert(medlemmer.map(ordreToDb), {onConflict:'id'})
      .then(r=>{if(r.error) console.error('Frakobling fra flåte feilet:', r.error.message);});
    db.from('flater').delete().eq('id', f.id)
      .then(r=>{if(r.error) console.error('Sletting av flåte feilet:', r.error.message);});
  }
  tilbakeFlaterListe();
}

