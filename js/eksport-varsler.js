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
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  const LOGO = 'logoer/logo-lys-bakgrunn.png';
  const dato = new Date().toLocaleDateString('nb-NO', {day:'numeric', month:'long', year:'numeric'});
  const tf = tvangsflyt(o);
  const tfOk = tf.filter(t=>t.ok).length;
  const si = statusInfo(o.ordreStatus);

  const OK = '#1a7f37', NEI = '#c0392b';
  const merkeLinje = [o.merke, o.type, o.modell, o.variant, o.farge].filter(Boolean).join(' · ');

  // Toppmerkene: status, tvangsflyt og godkjent - det man vil se uten å lese hele arket
  const merke = (tekst, ok) =>
    `<span class="badge" style="border-color:${ok?OK:NEI};background:${ok?'#eaf6ec':'#fdeceb'};color:${ok?OK:NEI}">${tekst}</span>`;

  const infoRad = (lbl, val, farge) =>
    `<div class="rad"><span class="rad-lbl">${lbl}</span><span class="rad-val"${farge?` style="color:${farge}"`:''}>${val||'<span class="tom">—</span>'}</span></div>`;

  const avkryss = (tekst, ok, rod) => {
    const f = ok ? (rod?NEI:OK) : '#bbbbbb';
    return `<div class="sjekk" style="color:${ok?'#1a1a1a':'#8a8a8a'}">
      <span class="boks" style="border-color:${f};background:${ok?f:'transparent'}">${ok?'✓':''}</span>${tekst}</div>`;
  };

  // Bildeseksjon: fast 3-kolonners rutenett med etikett under hver rute, slik at
  // "front" og "lasterom" står på samme plass i hver PDF. Tomme ruter får striper.
  const fotoSeksjon = (side, tittel) => {
    const { felt, labler } = FOTO_SIDER[side];
    const bilder = o[felt] || [];
    const antall = bilder.filter(Boolean).length;
    return `<div class="seksjon">
      <div class="s-hode">
        <span class="s-tittel">${tittel}</span>
        <span class="s-tell" style="color:${antall===labler.length?OK:NEI}">${antall} av ${labler.length}</span>
      </div>
      <div class="foto-grid">
        ${labler.map((lbl,i)=>`<div class="foto-celle">
          <div class="foto-ramme${bilder[i]?'':' foto-tom'}">
            ${bilder[i]?`<img src="${bilder[i]}" alt="${esc(lbl)}">`:'<span class="foto-merke">Ikke tatt</span>'}
          </div>
          <div class="foto-lbl">${esc(lbl)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  };

  const html = `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Ordrebekreftelse ${ordreLabel(o)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:34px 40px}
  .ark{max-width:760px;margin:0 auto}

  /* Topp */
  .topp{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
        border-bottom:3px solid #cc0000;padding-bottom:14px}
  .topp img{height:58px;width:auto;display:block}
  .topp-h{text-align:right}
  .doktittel{font-size:21px;font-weight:bold;color:#cc0000;letter-spacing:-.2px}
  .dokdato{font-size:12.5px;color:#555;margin-top:3px}

  .ident{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;
         flex-wrap:wrap;margin-top:16px}
  .ident-lbl{font-size:9.5px;letter-spacing:.18em;color:#8a8a8a}
  .chassis{font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:25px;font-weight:bold;
           letter-spacing:.01em;margin-top:2px;word-break:break-all}
  .regnr{font-size:25px;font-weight:bold;letter-spacing:.02em;margin-top:2px}
  .ident-sub{font-size:13.5px;color:#444;margin-top:4px}
  .merker{display:flex;gap:7px;flex-wrap:wrap;flex-shrink:0}
  .badge{border:1.5px solid;padding:5px 12px;font-size:11.5px;font-weight:bold;white-space:nowrap}

  /* Seksjoner */
  .seksjon{margin-top:24px;page-break-inside:avoid}
  .s-hode{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
          border-bottom:1px solid #e0e0e0;padding-bottom:4px}
  .s-tittel{font-size:10.5px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#cc0000}
  .s-tell{font-size:11px;font-weight:bold;white-space:nowrap}
  .kol2{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:24px}
  .kol2 .seksjon{margin-top:0}

  /* Etikett/verdi-rader */
  .rad{display:flex;gap:10px;padding:5px 0;border-bottom:1px dotted #e8e8e8;font-size:13px}
  .rad-lbl{min-width:104px;color:#767676;flex-shrink:0}
  .rad-val{font-weight:bold;min-width:0;overflow-wrap:anywhere}
  .tom{color:#a0a0a0;font-weight:normal}

  /* Avkryssing */
  .sjekk{display:flex;align-items:center;gap:8px;padding:3.5px 0;font-size:12.5px}
  .boks{width:12px;height:12px;border:1.5px solid;display:flex;align-items:center;
        justify-content:center;font-size:8.5px;color:#fff;flex-shrink:0}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
  .chip{display:flex;align-items:center;gap:7px;border:1px solid #ddd;padding:6px 11px;font-size:12.5px;color:#8a8a8a}
  .chip-på{border-color:${NEI};background:#fdeceb;color:#1a1a1a;font-weight:bold}

  /* Vekttabell */
  .vekt{margin-top:6px}
  .vekt-hode,.vekt-rad{display:grid;grid-template-columns:82px repeat(3,1fr);gap:8px}
  .vekt-hode{padding:5px 0;border-bottom:1.5px solid #1a1a1a}
  .vekt-hode span{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#767676;text-align:right}
  .vekt-rad{padding:6.5px 0;border-bottom:1px dotted #e8e8e8;font-size:13px;align-items:baseline}
  .vekt-rad .v-lbl{color:#767676}
  .vekt-rad .v-tall{font-family:ui-monospace,'SF Mono',Consolas,monospace;text-align:right}
  .fotnote{font-size:10.5px;color:#8a8a8a;margin-top:7px}

  /* Bilder */
  .foto-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:10px}
  .foto-celle{page-break-inside:avoid}
  .foto-ramme{aspect-ratio:4/3;border:1px solid #bbb;overflow:hidden;display:flex;
              align-items:center;justify-content:center;background:#f7f7f7}
  .foto-ramme img{width:100%;height:100%;object-fit:cover;display:block}
  .foto-tom{border-color:#ddd;background:repeating-linear-gradient(45deg,#f4f4f4 0 7px,#ececec 7px 14px)}
  .foto-merke{background:#fff;border:1px solid #ccc;padding:3px 8px;font-size:9px;
              letter-spacing:.1em;text-transform:uppercase;color:#8a8a8a}
  .foto-lbl{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:#767676;margin-top:4px}

  /* Signatur og bunn */
  .signaturer{margin-top:28px;padding-top:16px;border-top:1.5px solid #1a1a1a;
              display:grid;grid-template-columns:repeat(3,1fr);gap:28px;page-break-inside:avoid}
  .sign-linje{height:34px;border-bottom:1px solid #1a1a1a}
  .sign-lbl{font-size:11px;color:#767676;margin-top:5px}
  .merknad{margin-top:26px;padding:14px 16px;border:1.5px solid #1a1a1a;display:flex;
           align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;page-break-inside:avoid}
  .bunn{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-top:22px;
        padding-top:9px;border-top:1px solid #e0e0e0;font-size:10.5px;color:#9a9a9a}
  .mono{font-family:ui-monospace,'SF Mono',Consolas,monospace}
  .sideskift{page-break-before:always}
  .logg{font-size:11px;color:#767676;margin-top:8px}
  .logg div{padding:2.5px 0;border-top:1px solid #f0f0f0}

  @media print{
    body{padding:0}
    .s-hode{page-break-after:avoid}
  }
</style></head><body>

<div class="ark">

  <div class="topp">
    <img src="${LOGO}" alt="Salmaker'n · Telemark Salmakerverksted">
    <div class="topp-h">
      <div class="doktittel">Ordrebekreftelse</div>
      <div class="dokdato">Utskrift ${dato}</div>
    </div>
  </div>

  <div class="ident">
    <div style="min-width:0">
      ${o.regnr
        ? `<div class="ident-lbl">REG.NR</div><div class="regnr">${esc(o.regnr)}</div>
           ${o.chassis?`<div class="ident-sub">Chassis <span class="mono">${esc(o.chassis)}</span></div>`:''}`
        : `<div class="ident-lbl">CHASSIS</div><div class="chassis">${esc(o.chassis)||'Uten reg.nr'}</div>`}
      ${merkeLinje?`<div class="ident-sub">${esc(merkeLinje)}</div>`:''}
    </div>
    <div class="merker">
      ${merke('Status: '+si.lbl, ['Klar for henting','Bestilt frakt','Hentet'].includes(si.lbl))}
      ${merke('Tvangsflyt '+tfOk+'/'+tf.length, tfOk===tf.length)}
      ${merke(o.godkjent?'Godkjent / lukket':'Ikke godkjent', !!o.godkjent)}
    </div>
  </div>

  <div class="kol2">
    <div class="seksjon">
      <div class="s-hode"><span class="s-tittel">Kjøretøy</span></div>
      ${infoRad('Merke', esc(o.merke))}
      ${infoRad('Type', esc(o.type))}
      ${infoRad('Modell', esc(o.modell))}
      ${infoRad('Variant', esc(o.variant))}
      ${infoRad('Versjon', esc(o.versjon))}
      ${infoRad('Farge', esc(o.farge))}
      ${infoRad('Reg.nr', esc(o.regnr))}
      ${infoRad('Ankomstdato', o.ankomstdato?fmtDatoKort(o.ankomstdato):'')}
    </div>
    <div class="seksjon">
      <div class="s-hode"><span class="s-tittel">Kunde og dokumenter</span></div>
      ${infoRad('Forhandler', esc(o.kunde))}
      ${infoRad('Kontaktperson', esc(o.eier))}
      ${infoRad('Flåte', esc(((S.flater||[]).find(f=>f.id===o.flateId)||{}).flatenummer||''))}
      ${infoRad('COC', esc(o.coc), o.coc==='Har'?OK:NEI)}
      ${infoRad('Fullmakt', esc(o.fullmakt), o.fullmakt==='Har'?OK:NEI)}
      ${infoRad('Diagnose', o.diagnose?'Utført av '+esc(o.diagnoseAv):'Ikke utført', o.diagnose?OK:NEI)}
      ${infoRad('Time biltilsyn', o.tidBiltilsynet?fmtDatoKort(o.tidBiltilsynet)+' '+(o.tidBiltilsynetTid||'')+(o.tidBiltilsynetSted?' · '+esc(o.tidBiltilsynetSted):''):'')}
      ${infoRad('Fakturert', o.fakturert?'Ja':'Ikke fakturert', o.fakturert?OK:NEI)}
    </div>
  </div>

  <div class="seksjon">
    <div class="s-hode"><span class="s-tittel">Ombygging</span></div>
    <div class="chips">
      ${[['nyttKjoretoy','Nytt Kjøretøy'],['bruktKjoretoy','Brukt Kjøretøy'],['lafinto','Lafinto'],['personbil','Personbil']]
        .map(([k,lbl])=>{
          const på = !!o.ombygging?.[k];
          return `<span class="chip${på?' chip-på':''}">
            <span class="boks" style="border-color:${på?NEI:'#bbb'};background:${på?NEI:'transparent'}">${på?'✓':''}</span>${lbl}</span>`;
        }).join('')}
    </div>
  </div>

  <div class="kol2">
    <div class="seksjon">
      <div class="s-hode">
        <span class="s-tittel">Utstyr — har ved ankomst</span>
        ${(o.utstyrSjekkliste||[]).length
          ? `<span class="s-tell" style="color:#767676">${esc(o.utstyrMalNavn||'')} · ${o.utstyrSjekkliste.filter(p=>p.ok).length} av ${o.utstyrSjekkliste.length}</span>`
          : ''}
      </div>
      <div style="margin-top:8px">
        ${(o.utstyrSjekkliste||[]).length
          ? o.utstyrSjekkliste.map(p=>avkryss(esc(p.punkt), p.ok)).join('')
          : '<div class="tom" style="font-size:13px">Ingen mal valgt</div>'}
      </div>
    </div>
    <div class="seksjon">
      <div class="s-hode"><span class="s-tittel">Utstyr — skal ha etter visning</span></div>
      <div style="margin-top:9px;font-size:13px">
        ${(o.utstyr?.skalHa||'').trim()
          ? esc(o.utstyr.skalHa).split('\n').filter(l=>l.trim()).map(l=>
              `<div style="display:flex;align-items:baseline;gap:9px;padding:3px 0">
                 <span style="width:13px;height:13px;border:1.5px solid #1a1a1a;flex-shrink:0;margin-top:2px"></span>
                 <span>${l}</span></div>`).join('')
          : '<div class="tom">Ingenting registrert</div>'}
      </div>
      <div class="s-hode" style="margin-top:20px"><span class="s-tittel">Hengerfeste</span></div>
      <div style="font-size:13px;margin-top:8px">${
        o.utstyr?.hengerfeste==='hengerfeste'
          ? 'Hengerfeste (' + (HENGERFESTE_MONTERT_LBL[o.utstyr?.hengerfesteMontert]||'Ikke montert').toLowerCase() + ')'
          : 'Ikke hengerfeste'}</div>
    </div>
  </div>

  <div class="kol2" style="grid-template-columns:1.35fr 1fr">
    <div class="seksjon">
      <div class="s-hode"><span class="s-tittel">Vekter (kg)</span></div>
      <div class="vekt">
        <div class="vekt-hode"><span></span><span>Ved ankomst</span><span>Endring</span><span>Før visning</span></div>
        ${[['totalvekt','Totalvekt'],['vogntog','Vogntog'],['foraksel','Foraksel'],['bakaksel','Bakaksel']].map(([k,lbl])=>{
          const v = o.vekter[k];
          const rod = ['totalvekt','vogntog'].includes(k) && v.e && v.a && v.e !== v.a;
          return `<div class="vekt-rad">
            <span class="v-lbl">${lbl}</span>
            <span class="v-tall">${v.a||'—'}</span>
            <span class="v-tall" style="font-weight:bold;color:${rod?NEI:'#1a1a1a'}">${v.e||'—'}</span>
            <span class="v-tall">${k==='vogntog'?'—':(v.v||'—')}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="fotnote">Rødt tall = endret fra vekten ved ankomst.</div>
    </div>
    <div class="seksjon">
      <div class="s-hode"><span class="s-tittel">Drivstoff</span></div>
      <div style="margin-top:9px">
        ${infoRad('Totalpris', o.drivstoff?.totalpris ? esc(String(o.drivstoff.totalpris))+' kr' : '')}
        ${infoRad('Sats', esc(((S.drivstoffSatser||[]).find(s=>s.id===(o.drivstoff?.satsId||''))||{}).navn||''))}
        ${infoRad('Kundepris', drivstoffKundeprisTekst(o))}
      </div>
      <div class="s-hode" style="margin-top:20px"><span class="s-tittel">Ansatte på ordren</span></div>
      <div style="margin-top:8px;font-size:13px">
        ${o.ansatteSignert.length
          ? o.ansatteSignert.map(a=>`<div style="padding:3px 0">${esc(a.navn)} <span style="color:#8a8a8a;font-size:11.5px">· ${a.tid}</span></div>`).join('')
          : '<div class="tom">Ingen meldt på</div>'}
      </div>
    </div>
  </div>

  ${(o.notater||'').trim() ? `<div class="seksjon">
    <div class="s-hode"><span class="s-tittel">Notater</span></div>
    <div style="margin-top:9px;font-size:13px;white-space:pre-wrap">${esc(o.notater)}</div>
  </div>` : ''}

  <div class="signaturer">
    <div><div class="sign-linje"></div><div class="sign-lbl">Utført av</div></div>
    <div><div class="sign-linje"></div><div class="sign-lbl">Mottatt av forhandler</div></div>
    <div><div class="sign-linje"></div><div class="sign-lbl">Dato</div></div>
  </div>

  <div class="bunn">
    <span>Salmaker'n · Telemark Salmakerverksted</span>
    <span class="mono">${esc(o.chassis)||esc(o.regnr)}</span>
    <span>Side 1</span>
  </div>

  <!-- ── ARK 2: bildedokumentasjon ── -->
  <div class="sideskift">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:20px;
                border-bottom:1.5px solid #1a1a1a;padding-bottom:9px">
      <div style="font-size:14px;font-weight:bold">Bildedokumentasjon</div>
      <div class="mono" style="font-size:11.5px;color:#767676">${esc(o.chassis)||esc(o.regnr)}</div>
    </div>

    ${fotoSeksjon('a','Bilder — ankomst')}
    ${fotoSeksjon('s','Bilder — avstand / skader')}
    ${fotoSeksjon('l','Bilder — levering')}

    <div class="merknad">
      <div>
        <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#767676">Merknader ved overlevering</div>
        <div style="font-size:11px;color:#8a8a8a;margin-top:2px">Fylles ut for hånd hvis noe avviker fra bildene</div>
      </div>
      <div style="flex:1;min-width:200px;border-bottom:1px solid #ccc;height:26px"></div>
    </div>

    <div class="bunn">
      <span>Salmaker'n · Telemark Salmakerverksted</span>
      <span>Utskrift ${dato}</span>
      <span>Side 2</span>
    </div>
  </div>

</div>
</body></html>`;

  // Åpner rapporten i et eget vindu og trigger nettleserens utskriftsdialog, der
  // "Lagre som PDF" gir en ekte PDF-fil - en ren HTML-nedlasting kalt "PDF" var
  // misvisende hvis den ble sendt videre til noen som forventet en faktisk PDF.
  const printVindu = window.open('', '_blank');
  if (!printVindu) { alert('Nettleseren blokkerte utskriftsvinduet - tillat sprettoppvinduer for denne siden og prøv igjen.'); return; }
  printVindu.document.write(html);
  printVindu.document.close();

  // Venter til bilder (logo + foto) er ferdig lastet før utskriftsdialogen åpnes,
  // ellers kan de mangle i PDF-en - med en makstid i tilfelle et bilde henger seg opp.
  let skrevetUt = false;
  const skrivUt = () => { if (skrevetUt) return; skrevetUt = true; printVindu.focus(); printVindu.print(); };
  const bilder = [...printVindu.document.images];
  if (!bilder.length) { skrivUt(); }
  else {
    let lastet = 0;
    const sjekkFerdig = () => { lastet++; if (lastet >= bilder.length) skrivUt(); };
    bilder.forEach(img => img.complete ? sjekkFerdig() : (img.addEventListener('load', sjekkFerdig), img.addEventListener('error', sjekkFerdig)));
  }
  setTimeout(skrivUt, 4000);
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

