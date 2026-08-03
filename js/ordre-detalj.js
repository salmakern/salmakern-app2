// ════════════════════════════════════════════════════
// ORDRE DETAIL
// ════════════════════════════════════════════════════
let ordreListScrollY = 0;

function openOrdre(id, fraArkiv=false) {
  ordreListScrollY = window.scrollY;
  activeOrdreId = id;
  openedFromArkiv = fraArkiv;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('ordre').classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab')[1].classList.add('active');
  document.getElementById('ordreList').style.display   = 'none';
  document.getElementById('ordreDetail').style.display = 'block';
  buildOrdreDetail();
  window.scrollTo(0, 0);
}

function tilbakeOrdreList() {
  activeOrdreId = null;
  document.getElementById('ordreDetail').style.display = 'none';
  if (openedFromArkiv) {
    openedFromArkiv = false;
    document.getElementById('ordreList').style.display = 'block';
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('arkiv').classList.add('active');
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab')[3].classList.add('active');
    renderArkiv();
  } else {
    openedFromArkiv = false;
    document.getElementById('ordreList').style.display = 'block';
    renderOrdreList();
  }
  setTimeout(() => window.scrollTo(0, ordreListScrollY), 0);
}

function utstyrMalDropdown(ordreId, selectId, applyFn, biltype, gjeldendeMalNavn) {
  const maler = (S.utstyrMaler||[]);
  if (!maler.length) return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
    <span class="muted small">Ingen maler opprettet ennå.</span>
    ${me&&me.rolle==='admin'?`<button class="btn sm red" onclick="openModal('nyUtstyrMal')">+ Lag mal</button>`:'<span class="muted small">Admin kan lage maler under Mer.</span>'}
  </div>`;
  const gjeldendeIdx = gjeldendeMalNavn ? maler.findIndex(m=>m.navn===gjeldendeMalNavn) : -1;
  return `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
    <select id="${selectId}" style="flex:1;background:#27272a;color:#f4f4f5;border:1px solid #3f3f46;border-radius:10px;padding:7px;font-size:12px">
      <option value="">– Velg mal –</option>
      ${maler.map((m,i)=>`<option value="${i}" ${i===gjeldendeIdx?'selected':''}>${m.navn}${m.biltype?' ('+m.biltype+')':''}</option>`).join('')}
    </select>
    <button class="btn sm red" onclick="const si=document.getElementById('${selectId}').selectedIndex-1; if(si>=0) ${applyFn}('${ordreId}',si)">Bruk</button>
  </div>`;
}

function utstyrSjekklisteHTML(sjekk, ordreId, toggleFn, malNavn) {
  if (!sjekk.length) return `<div class="muted small" style="margin-top:6px;padding:8px 0">Velg en mal over for å legge inn punkter.</div>`;
  const ok = sjekk.filter(p=>p.ok).length;
  return `<div style="margin-top:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span class="small muted">${malNavn}</span>
      <span class="pill ${ok===sjekk.length?'ok':'warn'}">${ok}/${sjekk.length} ✓</span>
    </div>
    ${sjekk.map((p,i)=>`
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #27272a30;cursor:pointer;${p.ok?'background:#052e1620;border-radius:8px;padding-left:6px':''}">
        <input type="checkbox" ${p.ok?'checked':''} onchange="${toggleFn}('${ordreId}',${i})" style="width:16px;height:16px;accent-color:#22c55e;flex-shrink:0">
        <span style="font-size:13px;${p.ok?'color:#4ade80':''}">${p.ok?'✓ ':''} ${esc(p.punkt)}</span>
      </label>`).join('')}
  </div>`;
}

function buildOrdreDetail() {
  try {
  const o = S.ordrer.find(x=>x.id===activeOrdreId);
  if (!o) return;
  // Ikke rebuild mens bruker har et interaktivt element fokusert i detaljvisningen
  const detailEl = document.getElementById('ordreDetail');
  const focusTag = document.activeElement?.tagName;
  if (detailEl?.contains(document.activeElement) && (focusTag==='SELECT'||focusTag==='INPUT'||focusTag==='TEXTAREA')) return;
  const tf = tvangsflyt(o);
  const kanLukke = tf.every(t=>t.ok);
  const erGodkjenner = me && (me.rolle==='godkjenner'||me.rolle==='admin');
  const headerH = document.querySelector('.top')?.offsetHeight || 0;

  document.getElementById('ordreDetail').innerHTML = `
  <div style="position:sticky;top:${headerH}px;z-index:40;background:#09090b;padding:8px 0;border-bottom:1px solid #27272a;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <button class="btn sm" onclick="tilbakeOrdreList()">${openedFromArkiv ? '← Tilbake til arkiv' : '← Alle ordrer'}</button>
    <div style="display:flex;gap:8px;align-items:center">
      <button id="prioritertBtn_${o.id}" class="btn sm" onclick="togglePrioritert('${o.id}')" style="${o.prioritert?'background:#78350f;border-color:#facc15;color:#facc15':''}">${o.prioritert?'PRIORITERT ✕':'+ Prioriter'}</button>
      <button id="oppdaterOrdreKnapp" class="btn sm" onclick="oppdaterAktivOrdre()" title="Hent siste endringer" style="padding:6px 10px">🔄</button>
      ${me?.rolle==='admin' ? `<button class="btn sm" onclick="slettOrdre('${o.id}')" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">🗑 Slett ordre</button>` : ''}
    </div>
  </div>
  ${o.status==='arkivert'?`<div style="background:#1c1008;border:1px solid #78350f;border-radius:10px;padding:10px 14px;margin-bottom:10px;color:#fbbf24;font-size:13px;font-weight:600">🗄 Arkivert ordre — kun visning</div>`:''}
  <div class="card">
    <div class="row">
      <div>
        <div class="title">${ordreLabel(o)}</div>
        ${o.chassis&&o.regnr?`<div class="small" style="color:#a1a1aa;margin-top:1px">Chassis: ${o.chassis}</div>`:''}
        <div class="muted" style="margin-top:2px">${o.type}${o.variant?' – '+o.variant:''}</div>
        <div class="small muted">Eier: ${o.eier||'–'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        ${statusDropdown(o.id, o.ordreStatus, 'font-size:13px;padding:7px 12px;')}
        <span class="pill ${o.godkjent?'ok':'bad'}" style="font-size:11px">${o.godkjent?'Godkjent / lukket':'Aktiv'}</span>
      </div>
    </div>
  </div>

  <div class="grid g2l">
    <div>

      <div class="card">
        <div class="h">Kunde og bilinfo</div>

        <div class="grid g2" style="gap:8px;margin-top:10px">
          <div>
            <label>Kundenavn</label>
            <div style="display:flex;gap:6px">
              <input value="${esc(o.kunde)}" onchange="sf('${o.id}','kunde',this.value)" style="flex:1">
              ${o.kunde?`<button class="btn sm" onclick="visKundeHistorikk('${esc(o.kunde)}')" title="Se alle ordrer for denne kunden" style="white-space:nowrap;flex-shrink:0">📋 Historikk</button>`:''}
            </div>
          </div>
          <div><label>Eier</label><input value="${esc(o.eier)}" onchange="sf('${o.id}','eier',this.value)"></div>
          <div><label>Merke</label><input value="${esc(o.merke||'')}" onchange="sf('${o.id}','merke',this.value);oppdaterOmbyggingVariant('${o.id}')"></div>
          <div><label>Type</label><input value="${esc(o.type||'')}" onchange="sf('${o.id}','type',this.value)"></div>
          <div><label>Modell</label><input value="${esc(o.modell||'')}" onchange="sf('${o.id}','modell',this.value);oppdaterOmbyggingVariant('${o.id}')"></div>
          <div><label>Variant</label><input value="${esc(o.variant||'')}" onchange="sf('${o.id}','variant',this.value)"></div>
          <div><label>Ankomstdato</label><input type="date" value="${o.ankomstdato}" onchange="sf('${o.id}','ankomstdato',this.value)"></div>
          <div><label>Versjon</label><input value="${esc(o.versjon||'')}" onchange="sf('${o.id}','versjon',this.value)"></div>
          <div>
            <label>Ombygging (for lager-oppskrift)</label>
            <select id="ombyggingVariantSelect_${o.id}" onchange="sfOmbyggingVariant('${o.id}',this.value)">${ombyggingVariantSelectOptions(o)}</select>
          </div>
        </div>

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #27272a">
          <div class="small muted" style="margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:10px">Identifikasjon</div>
          <div class="grid g2" style="gap:8px">
            <div>
              <label>Reg.nr</label>
              <div style="display:flex;gap:6px">
                <input id="regnr_${o.id}" value="${esc(o.regnr)}" onchange="sf('${o.id}','regnr',this.value.toUpperCase());this.value=this.value.toUpperCase()" style="text-transform:uppercase">
                <button class="btn sm red" onclick="slaOppRegnr('${o.id}')" title="Hent bilinfo fra Statens vegvesen" style="white-space:nowrap;flex-shrink:0">🔍 Søk</button>
              </div>
              <div id="regnrStatus_${o.id}" class="small" style="margin-top:4px"></div>
            </div>
            <div>
              <label>Chassis-nr (VIN)</label>
              <input value="${esc(o.chassis)}" maxlength="17" oninput="this.nextElementSibling.textContent=this.value.length+'/17'" onchange="sf('${o.id}','chassis',this.value)">
              <div class="small muted" style="margin-top:2px">${(o.chassis||'').length}/17</div>
            </div>
          </div>
        </div>

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #27272a">
          <label>Flåte</label>
          <div class="small" style="padding:6px 0">${(() => {
            const f = (S.flater||[]).find(x=>x.id===o.flateId);
            return f ? esc(f.flatenummer) : 'Ingen flåte';
          })()}</div>
        </div>
      </div>

      <div class="card">
        <div class="h">Ombygging</div>
        <div id="ombyggingBoks_${o.id}">${ombyggingBoksHTML(o)}</div>
      </div>

      <div class="card">
        <div class="h">Varer fra lager</div>
        <div id="ordreLagerbruk_${o.id}" style="margin-top:8px"></div>
      </div>

      <div class="card">
        <div class="h">Vekter (kg)</div>
        <table><thead><tr><th></th><th>Ved ankomst</th><th>Endring</th><th>Før visning</th></tr></thead><tbody>
          ${[['totalvekt','Totalvekt'],['vogntog','Vogntog'],['foraksel','Foraksel'],['bakaksel','Bakaksel']].map(([k,lbl],i)=>{
            const rod = ['totalvekt','vogntog'].includes(k) && o.vekter[k].e && o.vekter[k].a && o.vekter[k].e !== o.vekter[k].a;
            return `<tr>
              <td class="small muted" style="padding:6px 8px;white-space:nowrap">${lbl}</td>
              <td><input value="${o.vekter[k].a}" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" onkeydown="vektEnter(event,${i},'a')" onchange="sv('${o.id}','${k}','a',this.value)"></td>
              <td><input value="${o.vekter[k].e}" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" onkeydown="vektEnter(event,${i},'e')" onchange="sv('${o.id}','${k}','e',this.value)" style="${rod?'color:#ef4444;border-color:#ef4444':''}"></td>
              <td>${k==='vogntog' ? '<span class="small muted">–</span>' : `<input value="${o.vekter[k].v}" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" onkeydown="vektEnter(event,${i},'v')" onchange="sv('${o.id}','${k}','v',this.value)">`}</td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>

      <div class="card">
        <div class="h">Drivstoff</div>
        <div id="drivstoffKort_${o.id}" style="margin-top:10px">${drivstoffKortHTML(o)}</div>
      </div>

      <div class="card">
        <div class="h">Utstyr – Har ved ankomst</div>
${utstyrMalDropdown(o.id,'uMalValgAnkomst','applyUtstyrMal',o.type||'',o.utstyrMalNavn||'')}
        <div id="utstyrSjekkliste_${o.id}">${utstyrSjekklisteHTML(o.utstyrSjekkliste||[], o.id, 'toggleUtstyrPunkt', o.utstyrMalNavn||'')}</div>
      </div>

      <div class="card">
        <div class="h">Utstyr – Skal ha etter visning</div>
        <textarea rows="4" style="margin-top:8px" onchange="su('${o.id}','skalHa',this.value)">${esc(o.utstyr?.skalHa||'')}</textarea>
      </div>

      <div class="card">
        <div class="h">Hengerfeste</div>
        <select onchange="su('${o.id}','hengerfeste',this.value)" style="margin-top:8px;background:${o.utstyr?.hengerfeste==='hengerfeste'?'#42200688':'#09090b88'};color:${o.utstyr?.hengerfeste==='hengerfeste'?'#fef08a':'#e4e4e7'};border:2px solid ${o.utstyr?.hengerfeste==='hengerfeste'?'#facc15':'#3f3f46'};border-radius:10px;padding:7px 10px;font-size:13px;font-weight:700;cursor:pointer">
          <option value="ikke_hengerfeste" ${o.utstyr?.hengerfeste==='hengerfeste'?'':'selected'}>Ikke hengerfeste</option>
          <option value="hengerfeste" ${o.utstyr?.hengerfeste==='hengerfeste'?'selected':''}>Hengerfeste</option>
        </select>
      </div>

      <div class="card">
        <div class="h">Bilder – Ankomst (<span id="bildeTeller_a_${o.id}">${o.bilderAnkomst.filter(Boolean).length}/6</span>)</div>
        <div class="photo-grid">${['Front','Høyre','Venstre','Bak','Div 1','Div 2'].map((lbl,i)=>`
          <div class="photo-box" id="foboks_a_${i}" onclick="${o.bilderAnkomst[i]?`openLightbox('fo_a_${i}_src')`:`document.getElementById('fo_a_${i}').click()`}">
            ${o.bilderAnkomst[i]
              ? `<img id="fo_a_${i}_src" src="${o.bilderAnkomst[i]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px 8px 0 0">
                 <div class="hover-del" onclick="event.stopPropagation()">
                   <button data-viewonly onclick="openLightbox('fo_a_${i}_src')" title="Vis fullt bilde">🔍</button>
                   <button onclick="document.getElementById('fo_a_${i}').click()" title="Bytt bilde">📷</button>
                   <button onclick="slettFoto('${o.id}','a',${i})" title="Slett">🗑</button>
                 </div>`
              : `<div style="font-size:22px">📷</div><div>${lbl}</div>`}
          </div>
          <input type="file" id="fo_a_${i}" accept="image/*" capture="environment" style="display:none" onchange="lastOppFoto(event,'${o.id}','a',${i})">`).join('')}</div>
      </div>

      <div class="card">
        <div class="h">Bilder – Levering (<span id="bildeTeller_l_${o.id}">${o.bilderLevering.filter(Boolean).length}/6</span>)</div>
        <div class="photo-grid">${['Front','Høyre','Venstre','Bak','Div 1','Div 2'].map((lbl,i)=>`
          <div class="photo-box" id="foboks_l_${i}" onclick="${o.bilderLevering[i]?`openLightbox('fo_l_${i}_src')`:`document.getElementById('fo_l_${i}').click()`}">
            ${o.bilderLevering[i]
              ? `<img id="fo_l_${i}_src" src="${o.bilderLevering[i]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px 8px 0 0">
                 <div class="hover-del" onclick="event.stopPropagation()">
                   <button data-viewonly onclick="openLightbox('fo_l_${i}_src')" title="Vis fullt bilde">🔍</button>
                   <button onclick="document.getElementById('fo_l_${i}').click()" title="Bytt bilde">📷</button>
                   <button onclick="slettFoto('${o.id}','l',${i})" title="Slett">🗑</button>
                 </div>`
              : `<div style="font-size:22px">📷</div><div>${lbl}</div>`}
          </div>
          <input type="file" id="fo_l_${i}" accept="image/*" capture="environment" style="display:none" onchange="lastOppFoto(event,'${o.id}','l',${i})">`).join('')}</div>
      </div>

      <div class="card" id="ordretimerKort_${o.id}">
        ${ordreTimerKortHTML(o)}
      </div>

      <div class="card">
        <div class="h">Notater</div>
        <textarea rows="3" style="margin-top:8px" onchange="sf('${o.id}','notater',this.value)">${esc(o.notater)}</textarea>
      </div>

      <div class="card">
        <div class="h">Endringer</div>
        ${o.endringer.length?[...o.endringer].reverse().map(e=>`<div class="small muted" style="margin-bottom:3px">${e.av} – ${e.tid}: ${e.txt}</div>`).join(''):'<div class="small muted">Ingen registrerte endringer</div>'}
      </div>
    </div>

    <!-- SIDEBAR -->
    <div>
      <div class="card">
        <div class="h">Tvangsflyt</div>
        <div style="margin-top:6px">${tf.map(t=>`<span class="pill ${t.ok?'ok':'bad'}">${t.lbl}</span>`).join('')}</div>
      </div>

      <div class="card">
        <div class="h">Time på biltilsynet</div>
        <div class="grid g2" style="margin-top:8px">
          <div><label>Dato</label><div style="background:#27272a;border:1px solid #3f3f46;border-radius:12px;padding:9px 12px;font-size:13px">${o.kalenderDato||'Ikke satt'}</div></div>
          <div><label>Tid</label><div style="background:#27272a;border:1px solid #3f3f46;border-radius:12px;padding:9px 12px;font-size:13px">${o.kalenderTid||'Ikke satt'}</div></div>
        </div>
        <button class="btn sm" style="margin-top:8px" onclick="openFlytt('${o.id}')">Sett i kalender</button>
      </div>

      <div class="card">
        <div class="h">Ansatte på ordren</div>
        <div style="margin-top:6px" id="ansOrdre">${renderAnsOrdre(o)}</div>
        ${!o.ansatteSignert.find(a=>a.id===me.id)
          ?`<button class="btn sm" style="margin-top:8px;width:100%" onclick="meldPaa('${o.id}')">+ Meld meg på</button>`
          :`<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
              <span class="small ok-text">✓ Du er meldt på</span>
              <button class="btn sm" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5" onclick="meldAv('${o.id}')">Meld meg av</button>
            </div>`
        }
      </div>

      <div class="card">
        <div class="h">Godkjenning</div>
        ${o.godkjent?`<span class="pill ok">Godkjent av ${o.godkjennerNavn}</span>`:`
          <div class="muted small" style="margin-bottom:8px">Godkjenner kontrollerer arbeidet og lukker ordren.</div>
          ${!kanLukke?`<div class="muted small" style="margin-bottom:6px">Fullfør tvangsflyt først:</div>${tf.filter(t=>!t.ok).map(t=>`<div class="small err-text">✗ ${t.lbl}</div>`).join('')}<br>`:''}
          <button class="btn red" ${kanLukke&&erGodkjenner?'':'disabled'} onclick="openModal('godkjenn')">${kanLukke?(erGodkjenner?'Godkjenn og lukk':'Krever godkjenner-rolle'):'Ufullstendig'}</button>`}
      </div>

      <div class="card">
        <div class="h">PDF / Rapport</div>
        <div class="muted small" style="margin-bottom:8px">Vekter, bilder, signatur og info.</div>
        <button class="btn" onclick="genPDF('${o.id}')">Last ned PDF</button>
      </div>

      <div class="card">
        <div class="h">Diagnose</div>
        <div style="margin-top:8px">
          ${o.diagnose
            ? `<span class="pill ok">✔ Diagnose utført av ${o.diagnoseAv}</span>
               <button class="btn sm" style="margin-top:8px;width:100%" onclick="toggleDiagnose('${o.id}')">Fjern diagnose</button>`
            : `<div class="muted small" style="margin-bottom:8px">Ikke utført</div>
               <button class="btn sm red" style="width:100%" onclick="toggleDiagnose('${o.id}')">✔ Merk diagnose utført</button>`}
        </div>
      </div>

      ${me&&me.rolle==='admin'?`
      <div class="card">
        <div class="h">Fakturering</div>
        <div style="margin-top:8px">
          ${o.fakturert
            ? `<span class="pill ok">✔ Fakturert av ${o.fakturertAv}</span>
               <button class="btn sm" style="margin-top:8px;width:100%" onclick="toggleFakturert('${o.id}')">Merk som ikke fakturert</button>`
            : `<div class="muted small" style="margin-bottom:8px">Ikke fakturert</div>
               <button class="btn sm red" style="width:100%" onclick="toggleFakturert('${o.id}')">✔ Merk som fakturert</button>`}
        </div>
      </div>`:''}

      ${o.godkjent?`<div class="card"><button class="btn" onclick="arkiver('${o.id}')">Arkiver ordre</button></div>`:''}
      ${erGodkjenner?`<div class="card"><button class="btn sm" onclick="gjenopprettFotos('${o.id}')">🔄 Gjenopprett bilder fra Storage</button></div>`:''}
    </div>
  </div>`;
  renderOrdreLagerbruk();
  if (o.status === 'arkivert') {
    const detail = document.getElementById('ordreDetail');
    const header = detail.firstElementChild;
    detail.querySelectorAll('input, textarea, select').forEach(el => {
      el.disabled = true;
      el.style.cursor = 'not-allowed';
    });
    detail.querySelectorAll('button').forEach(btn => {
      if (!header.contains(btn) && !btn.hasAttribute('data-viewonly')) { btn.disabled = true; btn.style.opacity = '0.4'; }
    });
  }
  } catch(err) {
    document.getElementById('ordreDetail').innerHTML = `<div class="card"><div class="err-text">Feil ved lasting av ordre: ${err.message}</div><button class="btn sm" style="margin-top:8px" onclick="tilbakeOrdreList()">← Tilbake</button></div>`;
  }
}

function toggleDiagnose(id) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.diagnose = !o.diagnose;
  o.diagnoseAv = o.diagnose ? me.navn : '';
  logChange(o, o.diagnose ? 'Diagnose utført' : 'Diagnose fjernet');
  save(id); buildOrdreDetail();
}

function toggleFakturert(id) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.fakturert = !o.fakturert;
  o.fakturertAv = o.fakturert ? me.navn : '';
  logChange(o, o.fakturert ? 'Merket som fakturert' : 'Fakturert-markering fjernet');
  save(id);
  if (o.status === 'arkivert') renderArkiv();
  else buildOrdreDetail();
}

function togglePrioritert(id) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.prioritert = !o.prioritert;
  logChange(o, o.prioritert ? 'Merket som prioritert' : 'Fjernet prioritering');
  try{localStorage.setItem(STORE,JSON.stringify(S));}catch(e){}
  if (db) db.from('ordrer').update({prioritert:o.prioritert}).eq('id', id)
    .then(r=>{if(r.error) console.error('Prioritering-oppdatering feilet:', r.error.message);});
  renderOrdreList(); renderOversikt();
  const btn = document.getElementById('prioritertBtn_' + id);
  if (btn) { btn.textContent = o.prioritert ? 'PRIORITERT ✕' : '+ Prioriter'; btn.style.background = o.prioritert ? '#78350f' : ''; btn.style.borderColor = o.prioritert ? '#facc15' : ''; btn.style.color = o.prioritert ? '#facc15' : ''; }
}

function renderAnsOrdre(o) {
  if (!o.ansatteSignert.length) return '<div class="small muted">Ingen ansatte meldt på</div>';
  return o.ansatteSignert.map(a=>`<div class="small" style="margin-bottom:3px">${a.navn} – ${a.tid}</div>`).join('');
}

function tvangsflyt(o) {
  const ombyggingValgt = o.ombygging && Object.values(o.ombygging).some(Boolean);
  return [
    {lbl:'Diagnose utført',   ok: !!o.diagnose},
    {lbl:'6 bilder ankomst',  ok: o.bilderAnkomst.every(Boolean)},
    {lbl:'6 bilder levering', ok: o.bilderLevering.every(Boolean)},
    {lbl:'Ansatt meldt på',   ok: o.ansatteSignert.length>0},
    {lbl:'Vekter fylt ut',    ok: !!o.vekter.totalvekt.a},
    {lbl:'Ombygging valgt',   ok: ombyggingValgt}
  ];
}
function ombyggingBoksHTML(o) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
    ${[['nyttKjoretoy','Nytt Kjøretøy'],['bruktKjoretoy','Brukt Kjøretøy'],['lafinto','Lafinto'],['personbil','Personbil']].map(([k,lbl])=>`
      <label style="display:flex;align-items:center;gap:10px;background:#18181b;border:2px solid ${o.ombygging?.[k]?'#ef4444':'#27272a'};border-radius:12px;padding:12px;cursor:pointer">
        <input type="checkbox" ${o.ombygging?.[k]?'checked':''} onchange="sfOmbygging('${o.id}','${k}',this.checked)" style="width:18px;height:18px;accent-color:#ef4444;flex-shrink:0">
        <span style="font-weight:600">${lbl}</span>
      </label>
    `).join('')}
  </div>`;
}
function sfOmbygging(id, felt, val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  if (!o.ombygging) o.ombygging = {nyttKjoretoy:false,bruktKjoretoy:false,lafinto:false,personbil:false};
  o.ombygging[felt] = val;
  save(id);
  // Oppdater kun ombygging-boksen - ikke bygg om hele ordresiden (samme fiks som utstyr-sjekklisten).
  const container = document.getElementById('ombyggingBoks_' + id);
  if (container) container.innerHTML = ombyggingBoksHTML(o);
}

// ════════════════════════════════════════════════════
// SAVE HELPERS
// ════════════════════════════════════════════════════
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function ordreLabel(o){ return o.regnr || (o.chassis ? 'Chassis: '+o.chassis : 'Uten reg.nr'); }

// Kjente modeller = biltype-feltet på utstyr-malene, siden de allerede er satt opp per modell
function alleKjenteModeller() {
  return [...new Set((S.utstyrMaler||[]).map(m=>m.biltype).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'no'));
}
function modellSelectOptions(gjeldende) {
  const modeller = alleKjenteModeller();
  if (gjeldende && !modeller.includes(gjeldende)) { modeller.push(gjeldende); modeller.sort((a,b)=>a.localeCompare(b,'no')); }
  return `<option value="">– Velg modell –</option>` + modeller.map(m=>`<option value="${esc(m)}" ${m===gjeldende?'selected':''}>${esc(m)}</option>`).join('');
}

// Merke + Modell er det som faktisk fylles ut på ordrer i praksis, og brukes derfor
// som modell-nøkkelen for å matche oppskrifter - ikke det separate Type-feltet.
function merkeModell(o) { return `${o.merke||''} ${o.modell||''}`.trim(); }

// Hvilke ombyggings-varianter (oppskrifter) som finnes for modellen på denne ordren.
// Lagres i o.ombygging.variant - samme JSONB-objekt som de andre ombyggings-valgene,
// så det trengs ingen ny databasekolonne.
// Ingenting velges automatisk - feltet står på "Ingen valgt" til noen faktisk velger
// en variant selv, og ingenting trekkes fra lager før det skjer.
const OMBYGGING_INGEN_VALGT = '__ingen_valgt__';
function ombyggingVariantSelectOptions(o) {
  const modellTekst = merkeModell(o).toLowerCase();
  if (!modellTekst) return `<option value="${OMBYGGING_INGEN_VALGT}">– Fyll inn Merke/Modell først –</option>`;
  const varianter = [...new Set((S.lagerOppskrifter||[])
    .filter(r => r.biltype && (modellTekst.includes(r.biltype.toLowerCase()) || r.biltype.toLowerCase().includes(modellTekst)))
    .map(r => r.variant || ''))];
  if (!varianter.length) return `<option value="${OMBYGGING_INGEN_VALGT}">Ingen oppskrift for "${esc(merkeModell(o))}" ennå</option>`;
  const gjeldende = o.ombygging?.variant; // undefined = ingenting valgt ennå
  varianter.sort((a,b)=> a===''?-1 : b===''?1 : a.localeCompare(b,'no'));
  const placeholder = `<option value="${OMBYGGING_INGEN_VALGT}" ${gjeldende===undefined?'selected':''}>– Ingen valgt –</option>`;
  const valgOpts = varianter.map(v => `<option value="${esc(v)}" ${gjeldende===v?'selected':''}>${v ? esc(v) : 'Standard (alle varianter)'}</option>`).join('');
  return placeholder + valgOpts;
}
function oppdaterOmbyggingVariant(ordreId) {
  const sel = document.getElementById('ombyggingVariantSelect_' + ordreId);
  if (!sel) return;
  const o = S.ordrer.find(x=>x.id===ordreId); if (!o) return;
  sel.innerHTML = ombyggingVariantSelectOptions(o);
}
function sfOmbyggingVariant(id, val) {
  const o = S.ordrer.find(x=>x.id===id); if (!o) return;
  o.ombygging = o.ombygging || {};
  if (val === OMBYGGING_INGEN_VALGT) {
    delete o.ombygging.variant;
    logChange(o, 'Ombygging-variant tilbakestilt til ingen valgt');
    save(id);
    return;
  }
  o.ombygging.variant = val;
  logChange(o, 'Ombygging-variant satt til: ' + (val || 'Standard'));
  save(id);
  autoTrekkOppskrift(id);
}
function fmt(d){ return d.toLocaleTimeString('no',{hour:'2-digit',minute:'2-digit'}); }

function logChange(o, txt) { o.endringer.push({av:me?.navn||'?', tid:new Date().toLocaleString('no'), txt}); }

function sf(id, field, val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o[field]=val; logChange(o,field+' oppdatert'); save(id);
  if (['type','variant','versjon'].includes(field)) synkroniserFraPrimaer(id);
}
function sv(id,k,col,val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  o.vekter[k][col]=val;
  if (['foraksel','bakaksel'].includes(k) && col==='a') {
    o.vekter[k].e = val;
    const rader = ['totalvekt','vogntog','foraksel','bakaksel'];
    const inp = document.querySelector('#ordreDetail table')?.querySelectorAll('tbody tr')[rader.indexOf(k)]?.querySelectorAll('input')[1];
    if (inp) inp.value = val;
  }
  save(id);
  if (['totalvekt','vogntog'].includes(k) && (col==='a'||col==='e')) oppdaterVektFarge(id,k);
  synkroniserFraPrimaer(id);
}
function synkroniserFraPrimaer(id) {
  const primaer = S.ordrer.find(x=>x.id===id); if (!primaer) return;
  const flater = (S.flater||[]).filter(f => f.primaerOrdreId === id);
  if (!flater.length) return;
  flater.forEach(f => {
    (S.ordrer||[]).filter(o => o.flateId===f.id && o.id!==id).forEach(o => {
      o.type = primaer.type; o.variant = primaer.variant; o.versjon = primaer.versjon;
      o.vekter = JSON.parse(JSON.stringify(primaer.vekter));
      save(o.id);
    });
  });
}
function oppdaterVektFarge(id,k) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  const rod = o.vekter[k].e && o.vekter[k].a && o.vekter[k].e !== o.vekter[k].a;
  const rader = ['totalvekt','vogntog','foraksel','bakaksel'];
  const table = document.querySelector('#ordreDetail table');
  if (!table) return;
  const inp = table.querySelectorAll('tbody tr')[rader.indexOf(k)]?.querySelectorAll('input')[1];
  if (!inp) return;
  inp.style.color = rod ? '#ef4444' : '';
  inp.style.borderColor = rod ? '#ef4444' : '';
}
function vektEnter(e, rad, kol) {
  const cols = ['a','e','v'];
  const ki = cols.indexOf(kol);
  const k = e.key;
  if (!['Enter','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(k)) return;
  const table = e.target.closest('table');
  if (!table) return;
  const rows = table.querySelectorAll('tbody tr');
  let nr = rad, nk = ki;
  if (k === 'Enter' || k === 'ArrowDown')  nr = rad + 1;
  else if (k === 'ArrowUp')                nr = rad - 1;
  else if (k === 'ArrowRight') { if (ki < 2) nk = ki + 1; else { nr = rad + 1; nk = 0; } }
  else if (k === 'ArrowLeft')  { if (ki > 0) nk = ki - 1; else { nr = rad - 1; nk = 2; } }
  if (nr < 0 || nr >= rows.length) return;
  e.preventDefault();
  const inp = rows[nr].querySelectorAll('input')[nk];
  if (inp) { inp.focus(); inp.select(); }
}
function sd(id,f,val) {
  const o = S.ordrer.find(x=>x.id===id); if(!o) return;
  if(!o.drivstoff) o.drivstoff={totalpris:'',satsId:''};
  o.drivstoff[f]=val; save(id);
  const el = document.getElementById('drivstoffKort_'+id);
  if (el) el.innerHTML = drivstoffKortHTML(o);
}

function drivstoffKortHTML(o) {
  const df = o.drivstoff||{};
  const totalpris = parseFloat(String(df.totalpris||df.literpris||'').replace(',','.'))||0;
  const satsId = df.satsId||'';
  const satser = S.drivstoffSatser||[];
  const sats = satser.find(s=>s.id===satsId);
  const kr = n=>n.toLocaleString('no-NO',{minimumFractionDigits:2,maximumFractionDigits:2});
  let endringHTML = '';
  if (totalpris && sats) {
    let kundepris = totalpris;
    if(sats.type==='kr_rabatt')      kundepris=totalpris-parseFloat(sats.verdi||0);
    if(sats.type==='prosent_rabatt') kundepris=totalpris*(1-parseFloat(sats.verdi||0)/100);
    if(sats.type==='uten_moms')      kundepris=totalpris/1.25;
    if(sats.type==='uten_mva')       kundepris=totalpris*0.8;
    if(sats.type==='bos')            kundepris=(totalpris*0.8)/0.97;
    if(sats.type==='prosent')        kundepris=totalpris*(parseFloat(sats.verdi||100)/100);
    if(sats.type==='fast_pris')      kundepris=parseFloat(sats.verdi||0);
    if(kundepris<0) kundepris=0;
    const endring=totalpris-kundepris;
    endringHTML=`<div style="flex:1;min-width:100px">
      <label>Endring</label>
      <div style="background:#052e16;border:1px solid #16a34a66;border-radius:10px;padding:10px;text-align:center;font-size:14px;font-weight:800;color:#86efac;line-height:1.4">${kr(kundepris)} kr</div>
    </div>`;
  }
  return `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
    <div style="flex:1;min-width:120px">
      <label>Totalpris (kr)</label>
      <input inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" value="${df.totalpris||df.literpris||''}" onchange="sd('${o.id}','totalpris',this.value)">
    </div>
    <div style="flex:2;min-width:160px">
      <label>Sats</label>
      <select onchange="sd('${o.id}','satsId',this.value)" style="width:100%;background:#27272a;color:#f4f4f5;border:1px solid #3f3f46;border-radius:10px;padding:10px;font-size:13px">
        <option value="">– Ingen sats –</option>
        ${satser.map(s=>`<option value="${s.id}" ${satsId===s.id?'selected':''}>${s.navn}</option>`).join('')}
      </select>
    </div>
    ${endringHTML}
  </div>`;
}

