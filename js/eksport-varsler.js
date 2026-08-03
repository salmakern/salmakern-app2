// ════════════════════════════════════════════════════
// FIKEN-EKSPORT (timelogg for lønn)
// ════════════════════════════════════════════════════
function eksportFiken() {
  const maanedNavn=['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const timer = S.timer.filter(t=>t.dato?.startsWith(prefix));
  if (!timer.length) { alert('Ingen timer registrert denne måneden.'); return; }

  const linjer = [['Ansatt','Normal tid (t)','50% overtid (t)','100% overtid (t)','Syk (dager)','Egenmelding (dager)','Ferie (dager)','Permisjon (dager)']];
  S.ansatte.filter(a=>a.aktiv && a.kanForeLonn!==false).forEach(a => {
    const aTimer = timer.filter(t=>t.ansattId===a.id);
    const arbTimer = aTimer.filter(t=>t.mins>0);
    if (!aTimer.length) return;
    let normal=0, ot50=0, ot100=0;
    arbTimer.forEach(t=>{ const ot=beregnOvertid(t.mins,t.dato); normal+=ot.normal; ot50+=ot.ot50; ot100+=ot.ot100; });
    linjer.push([
      a.navn,
      (normal/60).toFixed(2).replace('.',','),
      (ot50/60).toFixed(2).replace('.',','),
      (ot100/60).toFixed(2).replace('.',','),
      aTimer.filter(t=>t.type==='syk').length,
      aTimer.filter(t=>t.type==='egenmelding').length,
      aTimer.filter(t=>t.type==='ferie').length,
      aTimer.filter(t=>t.type==='permisjon').length
    ]);
  });

  const csv = linjer.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
  const mNavn = maanedNavn[now.getMonth()];
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = `fiken_lonn_${mNavn}_${now.getFullYear()}.csv`;
  a.click();
}
function eksportCSV() {
  const rows=[['Ansatt','Dato','Type','Fra','Til','Minutter'],...S.timer.map(t=>[t.ansatt,t.dato,t.type,t.start,t.stopp,t.mins])];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download='salmakern_timer_'+new Date().toISOString().split('T')[0]+'.csv';
  a.click();
}

// ════════════════════════════════════════════════════
// PDF (enkel utskrift)
// ════════════════════════════════════════════════════
function genPDF(id) {
  const o=S.ordrer.find(x=>x.id===id); if(!o) return;
  const LOGO=document.querySelector('#appScreen img')?.src||'';
  const label=ordreLabel(o);
  const dato=new Date().toLocaleDateString('nb-NO');

  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Ordre ${label}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;padding:32px;max-width:820px;margin:auto;color:#1a1a1a;background:#fff}
  .pdf-header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #cc0000;padding-bottom:16px;margin-bottom:24px}
  .pdf-header img{height:56px;object-fit:contain}
  .pdf-title{font-size:22px;font-weight:bold;color:#cc0000}
  .pdf-sub{font-size:13px;color:#555;margin-top:4px}
  h2{margin-top:20px;margin-bottom:6px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#cc0000;border-bottom:1px solid #eee;padding-bottom:3px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:4px}
  .info-row{display:flex;gap:6px;margin-bottom:3px;font-size:13px}
  .info-label{font-weight:bold;min-width:90px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  td,th{border:1px solid #ddd;padding:5px 8px;text-align:left}
  th{background:#f7f7f7;font-weight:bold}
  img.sig{max-width:280px;border:1px solid #ccc;border-radius:4px}
  img.foto{max-width:100%;max-height:180px;object-fit:cover;border-radius:4px}
  .foto-grid{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
  .badge-ok{display:inline-block;background:#d4edda;color:#155724;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold}
  .badge-nei{display:inline-block;background:#f8d7da;color:#721c24;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold}
</style></head><body>
<div class="pdf-header">
  <img src="${LOGO}" alt="Salmakern">
  <div style="text-align:right">
    <div class="pdf-title">Ordrebekreftelse</div>
    <div class="pdf-sub">${label} &nbsp;|&nbsp; Utskrift: ${dato}</div>
  </div>
</div>
<div class="grid">
  <div>
    <h2>Kjoretoy</h2>
    <div class="info-row"><span class="info-label">Merke/Type:</span><span>${[o.merke,o.type].filter(Boolean).join(' ')||'--'}</span></div>
    <div class="info-row"><span class="info-label">Modell:</span><span>${o.modell||'--'}</span></div><div class="info-row"><span class="info-label">Variant:</span><span>${o.variant||'--'}</span></div><div class="info-row"><span class="info-label">Versjon:</span><span>${o.versjon||'--'}</span></div>
    <div class="info-row"><span class="info-label">Reg.nr:</span><span>${o.regnr||'--'}</span></div>
    <div class="info-row"><span class="info-label">Chassis:</span><span>${o.chassis||'--'}</span></div>
    <div class="info-row"><span class="info-label">Ankomst:</span><span>${o.ankomstdato||'--'}</span></div>
  </div>
  <div>
    <h2>Kunde</h2>
    <div class="info-row"><span class="info-label">Kundenavn:</span><span>${o.kunde||'--'}</span></div>
    <div class="info-row"><span class="info-label">Eier:</span><span>${o.eier||'--'}</span></div>
  </div>
</div>
<div class="grid" style="margin-top:0">
  <div>
    <h2>Utstyr - har</h2>
    <div style="font-size:13px;white-space:pre-wrap">${o.utstyr.har||'--'}</div>
  </div>
  <div>
    <h2>Utstyr - skal ha</h2>
    <div style="font-size:13px;white-space:pre-wrap">${o.utstyr.skalHa||'--'}</div>
  </div>
</div>
<h2>Vekter (kg)</h2>
<table><tr><th></th><th>Ved ankomst</th><th>Endring</th><th>For visning</th></tr>
${[['totalvekt','Totalvekt'],['vogntog','Vogntog'],['foraksel','Foraksel'],['bakaksel','Bakaksel']].map(([k,l])=>`<tr><td>${l}</td><td>${o.vekter[k].a||'--'}</td><td>${o.vekter[k].e||'--'}</td><td>${o.vekter[k].v||'--'}</td></tr>`).join('')}
</table>
<h2>Drivstoff</h2>
<div style="font-size:13px"><b>Pris:</b> ${o.drivstoff.pris||'--'} kr &nbsp;|&nbsp; <b>Sats:</b> ${o.drivstoff.sats||'--'} kr</div>
<h2>Bilder - Ankomst</h2>
<div class="foto-grid">${o.bilderAnkomst.filter(Boolean).map(b=>`<img class="foto" src="${b}">`).join('')||'<span style="font-size:13px;color:#999">Ingen bilder</span>'}</div>
<h2>Bilder - Levering</h2>
<div class="foto-grid">${o.bilderLevering.filter(Boolean).map(b=>`<img class="foto" src="${b}">`).join('')||'<span style="font-size:13px;color:#999">Ingen bilder</span>'}</div>
<h2>Ansatte</h2>
<div style="font-size:13px">${o.ansatteSignert.map(a=>`<div>${a.navn} – ${a.tid}</div>`).join('')||'Ingen'}</div>
<h2>Signatur</h2>
${o.signatur?`<img class="sig" src="${o.signatur}">`:'<span style="font-size:13px;color:#999">Ingen signatur</span>'}
<h2>Godkjenning</h2>
${o.godkjent?`<span class="badge-ok">Godkjent av ${o.godkjennerNavn}</span>`:'<span class="badge-nei">Ikke godkjent</span>'}
<h2>Notater</h2>
<p style="font-size:13px;white-space:pre-wrap">${o.notater||'--'}</p>
</body></html>`;

  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='Ordre-'+label.replace(/[^a-zA-Z0-9\-]/g,'_')+'-'+new Date().toISOString().split('T')[0]+'.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ════════════════════════════════════════════════════
// OPPDATERINGSVARSEL (ny appversjon tilgjengelig)
// ════════════════════════════════════════════════════
function visOppdateringsToast() {
  // Auto-reload hvis ingen modal er åpen og ingen input er aktiv
  const modalApen = document.querySelector('.modal.show');
  const inputAktiv = document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if (!modalApen && !inputAktiv) {
    window.location.reload();
    return;
  }
  // Ellers vis toast slik at brukeren kan velge tidspunkt
  if (document.getElementById('updateToast')) return;
  const toast = document.createElement('div');
  toast.id = 'updateToast';
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>🔄 Ny versjon klar!</span>
    <button onclick="window.location.reload()">Oppdater nå</button>`;
  document.body.appendChild(toast);
  // Auto-reload etter 10 sek uansett
  setTimeout(()=>window.location.reload(), 10000);
}

