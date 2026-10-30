// ════════════════════════════════════════════════════
// HMS (Helse, miljø og sikkerhet)
// Internkontrollforskriften §5: avvik (pkt 7), risikovurderinger (pkt 6),
// vernerunder (løpende kartlegging/pkt 8) og håndboka (mål/ansvar/årlig
// gjennomgang - pkt 4,5,8). Stoffkartotek er et eget, konkret lovkrav for
// virksomheter som bruker/lagrer helsefarlige kjemikalier (lim/løsemidler).
//
// Alle 6 tabellene (se migrasjon 20261030150000) er bevisst IKKE lagt i
// supabase_realtime-publikasjonen (se den dokumenterte egress-hendelsen
// 2026-10) - sidene henter ferske data ved åpning/etter lagring i stedet.
// ════════════════════════════════════════════════════

function erHmsAdmin() { return !!(me && (me.rolle === 'admin' || me.rolle === 'verneombud')); }

// ---------- Hub-navigasjon ----------
function visHmsSeksjon(id) {
  ['hmsHubView','hmsAvvikView','hmsRisikoView','hmsStoffkartotekView','hmsVernerundeView','hmsHandbokView']
    .forEach(v => { const el = document.getElementById(v); if (el) el.style.display = (v === 'hms'+id.charAt(0).toUpperCase()+id.slice(1)+'View') ? 'block' : 'none'; });
  if (id === 'avvik') renderHmsAvvikListe();
  if (id === 'risiko') renderHmsRisikoListe();
  if (id === 'stoffkartotek') renderHmsStoffkartotekListe();
  if (id === 'vernerunde') { renderHmsVernerundeMal(); renderHmsVernerundeHistorikk(); }
  if (id === 'handbok') renderHmsHandbok();
}
function tilbakeHmsHub() {
  document.getElementById('hmsHubView').style.display = 'block';
  ['hmsAvvikView','hmsRisikoView','hmsStoffkartotekView','hmsVernerundeView','hmsHandbokView']
    .forEach(v => { const el = document.getElementById(v); if (el) el.style.display = 'none'; });
}
function renderHms() {
  renderHmsHubBadger();
  if (document.getElementById('hmsAvvikView')?.style.display === 'block') renderHmsAvvikListe();
  if (document.getElementById('hmsRisikoView')?.style.display === 'block') renderHmsRisikoListe();
  if (document.getElementById('hmsStoffkartotekView')?.style.display === 'block') renderHmsStoffkartotekListe();
  if (document.getElementById('hmsVernerundeView')?.style.display === 'block') { renderHmsVernerundeMal(); renderHmsVernerundeHistorikk(); }
  if (document.getElementById('hmsHandbokView')?.style.display === 'block') renderHmsHandbok();
}
function renderHmsHubBadger() {
  const apne = (S.hmsAvvik||[]).filter(a => a.status !== 'lukket').length;
  const hubEl = document.getElementById('hmsAvvikBadge');
  if (hubEl) hubEl.innerHTML = apne ? `<span class="pill warn">${apne} åpne</span>` : '<span class="pill ok">Ingen åpne</span>';
  const merEl = document.getElementById('merHmsBadge');
  if (merEl) merEl.innerHTML = apne ? `<span class="pill warn">${apne} åpne avvik</span>` : '<span class="pill ok">Ingen åpne avvik</span>';
}

// ════════════════════════════════════════════════════
// AVVIK
// ════════════════════════════════════════════════════
function apneNyAvvikModal() {
  ['avvikTittel','avvikBeskrivelse','avvikSted'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('avvikKategori').value = 'Avvik';
  document.getElementById('avvikBilderValgt').innerHTML = '';
  avvikBilderButch = [];
  openModal('nyAvvik');
}
let avvikBilderButch = [];
async function avvikVelgBilder(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const statusEl = document.getElementById('avvikBilderValgt');
  statusEl.innerHTML = '⏳ Laster opp ' + files.length + ' bilde(r)...';
  for (const file of files) {
    const komprimert = await komprimer(file, 1200, 0.82);
    const filnavn = `avvik/${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
    if (db) {
      const { error } = await db.storage.from('hms-vedlegg').upload(filnavn, komprimert, { contentType: 'image/jpeg', cacheControl: '31536000' });
      if (!error) {
        const { data } = db.storage.from('hms-vedlegg').getPublicUrl(filnavn);
        avvikBilderButch.push(data.publicUrl);
      } else {
        visToast('Opplasting feilet: ' + error.message);
      }
    }
  }
  statusEl.innerHTML = avvikBilderButch.length ? `✔ ${avvikBilderButch.length} bilde(r) lagt ved` : '';
  e.target.value = '';
}
async function lagreAvvik() {
  const tittel = document.getElementById('avvikTittel').value.trim();
  const beskrivelse = document.getElementById('avvikBeskrivelse').value.trim();
  if (!tittel || !beskrivelse) { alert('Tittel og beskrivelse er påkrevd'); return; }
  if (!me || !db) return;
  const rad = {
    meldt_av: me.id,
    meldt_av_navn: me.navn,
    tittel,
    beskrivelse,
    kategori: document.getElementById('avvikKategori').value,
    sted: document.getElementById('avvikSted').value.trim() || null,
    bilder: avvikBilderButch
  };
  const { data, error } = await db.from('hms_avvik').insert(rad).select().single();
  if (error) { visToast('Kunne ikke lagre avvik: ' + error.message); return; }
  S.hmsAvvik = S.hmsAvvik || [];
  S.hmsAvvik.unshift(dbToHmsAvvik(data));
  closeModal('nyAvvik');
  visToast('Avvik meldt', 'ok');
  renderHmsAvvikListe();
  renderHmsHubBadger();
}
async function oppdaterAvvikStatus(id, status) {
  if (!erHmsAdmin() || !db) return;
  const a = (S.hmsAvvik||[]).find(x => x.id === id); if (!a) return;
  const felter = { status };
  if (status === 'lukket') { felter.lukket_av = me.id; felter.lukket_av_navn = me.navn; felter.lukket_at = new Date().toISOString(); }
  else { felter.lukket_av = null; felter.lukket_av_navn = null; felter.lukket_at = null; }
  const { data, error } = await db.from('hms_avvik').update(felter).eq('id', id).select().single();
  if (error) { visToast('Kunne ikke oppdatere: ' + error.message); return; }
  Object.assign(a, dbToHmsAvvik(data));
  renderHmsAvvikListe();
  renderHmsHubBadger();
}
async function lagreAvvikTiltak(id, tiltak) {
  if (!erHmsAdmin() || !db) return;
  const a = (S.hmsAvvik||[]).find(x => x.id === id); if (!a) return;
  a.tiltak = tiltak;
  const { error } = await db.from('hms_avvik').update({ tiltak }).eq('id', id);
  if (error) visToast('Kunne ikke lagre tiltak: ' + error.message);
}
async function slettAvvik(id) {
  if (!me || me.rolle !== 'admin' || !db) return;
  if (!confirm('Slette dette avviket?')) return;
  const { error } = await db.from('hms_avvik').delete().eq('id', id);
  if (error) { visToast('Kunne ikke slette: ' + error.message); return; }
  S.hmsAvvik = (S.hmsAvvik||[]).filter(x => x.id !== id);
  renderHmsAvvikListe();
  renderHmsHubBadger();
}
function hmsAvvikStatusLabel(s) {
  return s === 'lukket' ? 'Lukket' : (s === 'under_oppfolging' ? 'Under oppfølging' : 'Meldt');
}
function hmsAvvikStatusPill(s) {
  const kl = s === 'lukket' ? 'ok' : (s === 'under_oppfolging' ? 'info' : 'warn');
  return `<span class="pill ${kl}">${hmsAvvikStatusLabel(s)}</span>`;
}
function renderHmsAvvikListe() {
  const el = document.getElementById('hmsAvvikListe'); if (!el) return;
  const liste = S.hmsAvvik || [];
  if (!liste.length) { el.innerHTML = '<div class="muted small">Ingen avvik registrert</div>'; return; }
  const admin = erHmsAdmin();
  el.innerHTML = liste.map(a => `
    <div class="box" style="margin-bottom:10px;${a.status==='lukket'?'opacity:0.6':''}">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span class="pill">${esc(a.kategori)}</span>
            ${hmsAvvikStatusPill(a.status)}
          </div>
          <div style="font-weight:700">${esc(a.tittel)}</div>
          <div class="small" style="margin-top:4px">${esc(a.beskrivelse)}</div>
          ${a.sted ? `<div class="small muted" style="margin-top:2px">📍 ${esc(a.sted)}</div>` : ''}
          <div class="small muted" style="margin-top:4px">${esc(a.meldtAvNavn)} · ${new Date(a.createdAt).toLocaleDateString('no',{day:'numeric',month:'short',year:'numeric'})}</div>
          ${(a.bilder||[]).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${a.bilder.map(u=>`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #27272a"></a>`).join('')}</div>` : ''}
          ${admin ? `
            <div style="margin-top:8px">
              <label class="small muted">Tiltak</label>
              <textarea rows="2" style="width:100%" onchange="lagreAvvikTiltak(${a.id},this.value)" placeholder="Hva gjøres for å rette/forebygge?">${esc(a.tiltak||'')}</textarea>
            </div>` : (a.tiltak ? `<div class="small muted" style="margin-top:6px">Tiltak: ${esc(a.tiltak)}</div>` : '')}
        </div>
        ${admin ? `
          <div style="display:flex;flex-direction:column;gap:6px">
            <select onchange="oppdaterAvvikStatus(${a.id},this.value)" style="font-size:12px;padding:5px 8px">
              <option value="meldt" ${a.status==='meldt'?'selected':''}>Meldt</option>
              <option value="under_oppfolging" ${a.status==='under_oppfolging'?'selected':''}>Under oppfølging</option>
              <option value="lukket" ${a.status==='lukket'?'selected':''}>Lukket</option>
            </select>
            <button class="btn sm" onclick="slettAvvik(${a.id})" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">Slett</button>
          </div>` : ''}
      </div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════
// RISIKOVURDERINGER
// ════════════════════════════════════════════════════
function hmsRisikoNiva(s, k) {
  const r = s * k;
  if (r >= 15) return { tekst: 'Høy', klasse: 'bad' };
  if (r >= 8) return { tekst: 'Middels', klasse: 'warn' };
  return { tekst: 'Lav', klasse: 'ok' };
}
function apneNyRisikoModal() {
  if (!erHmsAdmin()) return;
  ['risikoAktivitet','risikoFare','risikoTiltak'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('risikoSannsynlighet').value = '2';
  document.getElementById('risikoKonsekvens').value = '2';
  document.getElementById('risikoNesteGjennomgang').value = '';
  const ansvSel = document.getElementById('risikoAnsvarlig');
  ansvSel.innerHTML = '<option value="">– Ikke valgt –</option>' + (S.ansatte||[]).filter(a=>a.aktiv).map(a=>`<option value="${a.id}">${esc(a.navn)}</option>`).join('');
  openModal('nyRisiko');
}
async function lagreRisikovurdering() {
  const aktivitet = document.getElementById('risikoAktivitet').value.trim();
  const fare = document.getElementById('risikoFare').value.trim();
  if (!aktivitet || !fare) { alert('Aktivitet og fare er påkrevd'); return; }
  if (!me || !db) return;
  const ansvarligId = document.getElementById('risikoAnsvarlig').value || null;
  const ansvarlig = ansvarligId ? (S.ansatte||[]).find(a=>String(a.id)===String(ansvarligId)) : null;
  const rad = {
    aktivitet, fare,
    sannsynlighet: Number(document.getElementById('risikoSannsynlighet').value),
    konsekvens: Number(document.getElementById('risikoKonsekvens').value),
    tiltak: document.getElementById('risikoTiltak').value.trim() || null,
    ansvarlig_id: ansvarligId || null,
    ansvarlig_navn: ansvarlig ? ansvarlig.navn : null,
    neste_gjennomgang: document.getElementById('risikoNesteGjennomgang').value || null,
    laget_av: me.id,
    laget_av_navn: me.navn
  };
  const { data, error } = await db.from('hms_risikovurdering').insert(rad).select().single();
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  S.hmsRisikovurderinger = S.hmsRisikovurderinger || [];
  S.hmsRisikovurderinger.unshift(dbToHmsRisiko(data));
  closeModal('nyRisiko');
  visToast('Risikovurdering lagret', 'ok');
  renderHmsRisikoListe();
}
async function slettRisikovurdering(id) {
  if (!me || me.rolle !== 'admin' || !db) return;
  if (!confirm('Slette denne risikovurderingen?')) return;
  const { error } = await db.from('hms_risikovurdering').delete().eq('id', id);
  if (error) { visToast('Kunne ikke slette: ' + error.message); return; }
  S.hmsRisikovurderinger = (S.hmsRisikovurderinger||[]).filter(x => x.id !== id);
  renderHmsRisikoListe();
}
function renderHmsRisikoListe() {
  const el = document.getElementById('hmsRisikoListe'); if (!el) return;
  document.getElementById('nyRisikoBtn').style.display = erHmsAdmin() ? '' : 'none';
  const liste = S.hmsRisikovurderinger || [];
  if (!liste.length) { el.innerHTML = '<div class="muted small">Ingen risikovurderinger registrert</div>'; return; }
  const admin = erHmsAdmin();
  const iDag = new Date().toISOString().slice(0,10);
  el.innerHTML = liste.map(r => {
    const niva = hmsRisikoNiva(r.sannsynlighet, r.konsekvens);
    const forfalt = r.nesteGjennomgang && r.nesteGjennomgang < iDag;
    return `
    <div class="box" style="margin-bottom:10px">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span class="pill ${niva.klasse}">Risiko: ${niva.tekst} (${r.sannsynlighet}×${r.konsekvens})</span>
            ${forfalt ? '<span class="pill bad">Gjennomgang forfalt</span>' : ''}
          </div>
          <div style="font-weight:700">${esc(r.aktivitet)}</div>
          <div class="small" style="margin-top:4px"><b>Fare:</b> ${esc(r.fare)}</div>
          ${r.tiltak ? `<div class="small" style="margin-top:2px"><b>Tiltak:</b> ${esc(r.tiltak)}</div>` : ''}
          <div class="small muted" style="margin-top:4px">
            ${r.ansvarligNavn ? `Ansvarlig: ${esc(r.ansvarligNavn)} · ` : ''}
            ${r.nesteGjennomgang ? `Neste gjennomgang: ${new Date(r.nesteGjennomgang).toLocaleDateString('no')} · ` : ''}
            Laget av ${esc(r.lagetAvNavn)}
          </div>
        </div>
        ${admin ? `<button class="btn sm" onclick="slettRisikovurdering(${r.id})" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">Slett</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════
// STOFFKARTOTEK
// ════════════════════════════════════════════════════
let stoffSdbButch = [];
function apneNyStoffModal() {
  if (!erHmsAdmin()) return;
  ['stoffProduktnavn','stoffLeverandor','stoffBruksomrade','stoffVerneutstyr','stoffOppbevaring'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('stoffSdbValgt').innerHTML = '';
  stoffSdbButch = [];
  openModal('nyStoff');
}
async function stoffVelgSikkerhetsdatablad(e) {
  const file = e.target.files[0]; if (!file) return;
  const statusEl = document.getElementById('stoffSdbValgt');
  statusEl.innerHTML = '⏳ Laster opp...';
  const tryggNavn = file.name.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9.\-]/g,'_');
  const filnavn = `stoffkartotek/${Date.now()}_${tryggNavn}`;
  if (db) {
    const { error } = await db.storage.from('hms-vedlegg').upload(filnavn, file, { contentType: file.type || 'application/pdf', cacheControl: '31536000' });
    if (!error) {
      const { data } = db.storage.from('hms-vedlegg').getPublicUrl(filnavn);
      stoffSdbButch.push({ navn: file.name, url: data.publicUrl });
      statusEl.innerHTML = `✔ ${esc(file.name)} lagt ved`;
    } else {
      statusEl.innerHTML = '';
      visToast('Opplasting feilet: ' + error.message);
    }
  }
  e.target.value = '';
}
async function lagreStoffkartotek() {
  const produktnavn = document.getElementById('stoffProduktnavn').value.trim();
  if (!produktnavn) { alert('Produktnavn er påkrevd'); return; }
  if (!me || !db) return;
  const rad = {
    produktnavn,
    leverandor: document.getElementById('stoffLeverandor').value.trim() || null,
    bruksomrade: document.getElementById('stoffBruksomrade').value.trim() || null,
    verneutstyr: document.getElementById('stoffVerneutstyr').value.trim() || null,
    oppbevaring: document.getElementById('stoffOppbevaring').value.trim() || null,
    sikkerhetsdatablad: stoffSdbButch,
    lagt_til_av: me.id,
    lagt_til_av_navn: me.navn
  };
  const { data, error } = await db.from('hms_stoffkartotek').insert(rad).select().single();
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  S.hmsStoffkartotek = S.hmsStoffkartotek || [];
  S.hmsStoffkartotek.unshift(dbToHmsStoff(data));
  closeModal('nyStoff');
  visToast('Kjemikalie lagt til', 'ok');
  renderHmsStoffkartotekListe();
}
async function toggleStoffkartotekAktiv(id) {
  if (!erHmsAdmin() || !db) return;
  const s = (S.hmsStoffkartotek||[]).find(x => x.id === id); if (!s) return;
  const nyAktiv = !s.aktiv;
  const { error } = await db.from('hms_stoffkartotek').update({ aktiv: nyAktiv }).eq('id', id);
  if (error) { visToast('Kunne ikke oppdatere: ' + error.message); return; }
  s.aktiv = nyAktiv;
  renderHmsStoffkartotekListe();
}
async function slettStoffkartotek(id) {
  if (!me || me.rolle !== 'admin' || !db) return;
  if (!confirm('Slette denne kjemikalie-oppføringen helt? (vurder heller å deaktivere den)')) return;
  const { error } = await db.from('hms_stoffkartotek').delete().eq('id', id);
  if (error) { visToast('Kunne ikke slette: ' + error.message); return; }
  S.hmsStoffkartotek = (S.hmsStoffkartotek||[]).filter(x => x.id !== id);
  renderHmsStoffkartotekListe();
}
function renderHmsStoffkartotekListe() {
  const el = document.getElementById('hmsStoffkartotekListe'); if (!el) return;
  document.getElementById('nyStoffBtn').style.display = erHmsAdmin() ? '' : 'none';
  const admin = erHmsAdmin();
  const liste = (S.hmsStoffkartotek || []).filter(s => admin || s.aktiv);
  if (!liste.length) { el.innerHTML = '<div class="muted small">Ingen kjemikalier registrert</div>'; return; }
  el.innerHTML = liste.map(s => `
    <div class="box" style="margin-bottom:10px;${!s.aktiv?'opacity:0.5':''}">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-weight:700">${esc(s.produktnavn)} ${!s.aktiv?'<span class="pill">Utgått</span>':''}</div>
          ${s.leverandor ? `<div class="small muted">Leverandør: ${esc(s.leverandor)}</div>` : ''}
          ${s.bruksomrade ? `<div class="small" style="margin-top:4px"><b>Bruksområde:</b> ${esc(s.bruksomrade)}</div>` : ''}
          ${s.verneutstyr ? `<div class="small" style="margin-top:2px"><b>Verneutstyr:</b> ${esc(s.verneutstyr)}</div>` : ''}
          ${s.oppbevaring ? `<div class="small" style="margin-top:2px"><b>Oppbevaring:</b> ${esc(s.oppbevaring)}</div>` : ''}
          ${(s.sikkerhetsdatablad||[]).length ? `<div style="margin-top:6px">${s.sikkerhetsdatablad.map(d=>`<a href="${d.url}" target="_blank" rel="noopener" style="color:#ef4444;font-size:13px;display:block">📄 ${esc(d.navn)}</a>`).join('')}</div>` : '<div class="small muted" style="margin-top:6px">Ingen sikkerhetsdatablad lastet opp</div>'}
        </div>
        ${admin ? `
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="btn sm" onclick="toggleStoffkartotekAktiv(${s.id})">${s.aktiv?'Merk utgått':'Merk aktiv'}</button>
            <button class="btn sm" onclick="slettStoffkartotek(${s.id})" style="background:#3f0000;border-color:#7f1d1d;color:#fca5a5">Slett</button>
          </div>` : ''}
      </div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════
// VERNERUNDER
// ════════════════════════════════════════════════════
function renderHmsVernerundeMal() {
  const el = document.getElementById('hmsVernerundeSjekkpunkter'); if (!el) return;
  const admin = erHmsAdmin();
  document.getElementById('redigerVernerundeMalBtn').style.display = admin ? '' : 'none';
  const punkter = (S.hmsVernerundeMal && S.hmsVernerundeMal.sjekkpunkter) || [];
  el.innerHTML = punkter.length
    ? '<ol style="margin:0;padding-left:20px">' + punkter.map(p => `<li class="small" style="margin-bottom:4px">${esc(p)}</li>`).join('') + '</ol>'
    : '<div class="muted small">Ingen sjekkpunkter definert ennå</div>';
}
function apneRedigerVernerundeMal() {
  if (!erHmsAdmin()) return;
  const punkter = (S.hmsVernerundeMal && S.hmsVernerundeMal.sjekkpunkter) || [];
  document.getElementById('vernerundeMalTekst').value = punkter.join('\n');
  openModal('redigerVernerundeMal');
}
async function lagreVernerundeMal() {
  if (!erHmsAdmin() || !me || !db) return;
  const punkter = document.getElementById('vernerundeMalTekst').value.split('\n').map(p => p.trim()).filter(Boolean);
  const { data, error } = await db.from('hms_vernerunde_mal')
    .update({ sjekkpunkter: punkter, oppdatert_av: me.id, oppdatert_av_navn: me.navn, oppdatert_at: new Date().toISOString() })
    .eq('id', 1).select().single();
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  S.hmsVernerundeMal = dbToHmsVernerundeMal(data);
  closeModal('redigerVernerundeMal');
  visToast('Sjekkliste oppdatert', 'ok');
  renderHmsVernerundeMal();
}

function apneStartVernerunde() {
  const punkter = (S.hmsVernerundeMal && S.hmsVernerundeMal.sjekkpunkter) || [];
  if (!punkter.length) { alert('Ingen sjekkpunkter å gå gjennom - legg til punkter i sjekklisten først'); return; }
  const el = document.getElementById('vernerundeSkjema');
  el.innerHTML = punkter.map((p,i) => `
    <div class="box" style="margin-bottom:8px">
      <div class="small" style="font-weight:600;margin-bottom:6px">${esc(p)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <label class="small"><input type="radio" name="vp_${i}" value="ok" checked> OK</label>
        <label class="small"><input type="radio" name="vp_${i}" value="avvik"> Avvik</label>
        <label class="small"><input type="radio" name="vp_${i}" value="ikke_aktuelt"> Ikke aktuelt</label>
      </div>
      <input id="vpKommentar_${i}" placeholder="Kommentar (valgfritt)" style="width:100%;font-size:13px">
    </div>`).join('');
  document.getElementById('vernerundeNotat').value = '';
  openModal('startVernerunde');
}
async function lagreVernerundeGjennomforing() {
  if (!me || !db) return;
  const punkter = (S.hmsVernerundeMal && S.hmsVernerundeMal.sjekkpunkter) || [];
  const resultat = punkter.map((p,i) => ({
    punkt: p,
    status: document.querySelector(`input[name="vp_${i}"]:checked`)?.value || 'ok',
    kommentar: document.getElementById(`vpKommentar_${i}`)?.value.trim() || ''
  }));
  const rad = {
    utfort_av: me.id,
    utfort_av_navn: me.navn,
    resultat,
    notat: document.getElementById('vernerundeNotat').value.trim() || null
  };
  const { data, error } = await db.from('hms_vernerunde_gjennomforing').insert(rad).select().single();
  if (error) { visToast('Kunne ikke lagre vernerunde: ' + error.message); return; }
  S.hmsVernerunder = S.hmsVernerunder || [];
  S.hmsVernerunder.unshift(dbToHmsVernerundeGjennomforing(data));
  closeModal('startVernerunde');
  visToast('Vernerunde registrert', 'ok');
  renderHmsVernerundeHistorikk();

  // Punkter markert "avvik" under runden opprettes automatisk som egne avvik,
  // slik at de følges opp i samme avvikssystem som alt annet.
  const avvikPunkter = resultat.filter(r => r.status === 'avvik');
  for (const p of avvikPunkter) {
    const nyttAvvik = {
      meldt_av: me.id, meldt_av_navn: me.navn,
      tittel: 'Funn fra vernerunde: ' + p.punkt,
      beskrivelse: p.kommentar || p.punkt,
      kategori: 'Avvik'
    };
    const { data: avvikData, error: avvikErr } = await db.from('hms_avvik').insert(nyttAvvik).select().single();
    if (!avvikErr) { S.hmsAvvik = S.hmsAvvik || []; S.hmsAvvik.unshift(dbToHmsAvvik(avvikData)); }
  }
  if (avvikPunkter.length) { visToast(avvikPunkter.length + ' avvik opprettet fra vernerunden', 'ok'); renderHmsHubBadger(); }
}
function renderHmsVernerundeHistorikk() {
  const el = document.getElementById('hmsVernerundeHistorikk'); if (!el) return;
  const liste = S.hmsVernerunder || [];
  if (!liste.length) { el.innerHTML = '<div class="muted small">Ingen vernerunder gjennomført ennå</div>'; return; }
  el.innerHTML = liste.map(v => {
    const avvik = (v.resultat||[]).filter(r => r.status === 'avvik').length;
    return `
    <div class="box" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <div class="small"><b>${new Date(v.dato).toLocaleDateString('no',{day:'numeric',month:'short',year:'numeric'})}</b> · ${esc(v.utfortAvNavn)}</div>
        ${avvik ? `<span class="pill bad">${avvik} avvik funnet</span>` : '<span class="pill ok">Ingen avvik</span>'}
      </div>
      ${v.notat ? `<div class="small muted" style="margin-top:4px">${esc(v.notat)}</div>` : ''}
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════
// HMS-HÅNDBOK
// ════════════════════════════════════════════════════
function renderHmsHandbok() {
  const h = S.hmsHandbok || { mal:'', ansvarsfordeling:'', arligeGjennomganger:[] };
  const admin = erHmsAdmin();
  const malEl = document.getElementById('handbokMal');
  const ansvEl = document.getElementById('handbokAnsvar');
  if (document.activeElement !== malEl) malEl.value = h.mal || '';
  if (document.activeElement !== ansvEl) ansvEl.value = h.ansvarsfordeling || '';
  malEl.readOnly = !admin; ansvEl.readOnly = !admin;
  document.getElementById('handbokGjennomgangBtn').style.display = admin ? '' : 'none';
  const loggEl = document.getElementById('handbokGjennomgangLogg');
  const logg = h.arligeGjennomganger || [];
  loggEl.innerHTML = logg.length
    ? logg.slice().reverse().map(g => `<div class="small" style="padding:4px 0;border-bottom:1px solid #27272a30">${new Date(g.dato).toLocaleDateString('no',{day:'numeric',month:'short',year:'numeric'})} · ${esc(g.av)}${g.notat?' – '+esc(g.notat):''}</div>`).join('')
    : '<div class="muted small">Ingen årlig gjennomgang registrert ennå</div>';
}
async function lagreHandbokFelt(felt, verdi) {
  if (!erHmsAdmin() || !me || !db) return;
  S.hmsHandbok = S.hmsHandbok || {};
  S.hmsHandbok[felt] = verdi;
  const kolonne = felt === 'mal' ? 'mal' : 'ansvarsfordeling';
  const { error } = await db.from('hms_handbok').update({ [kolonne]: verdi, oppdatert_av: me.id, oppdatert_av_navn: me.navn, oppdatert_at: new Date().toISOString() }).eq('id', 1);
  if (error) visToast('Kunne ikke lagre: ' + error.message);
}
function apneRegistrerGjennomgang() {
  if (!erHmsAdmin()) return;
  document.getElementById('gjennomgangNotat').value = '';
  openModal('registrerGjennomgang');
}
async function lagreGjennomgang() {
  if (!erHmsAdmin() || !me || !db) return;
  const notat = document.getElementById('gjennomgangNotat').value.trim();
  const logg = [...((S.hmsHandbok && S.hmsHandbok.arligeGjennomganger) || []), { dato: new Date().toISOString(), av: me.navn, notat }];
  const { error } = await db.from('hms_handbok').update({ arlige_gjennomganger: logg, oppdatert_av: me.id, oppdatert_av_navn: me.navn, oppdatert_at: new Date().toISOString() }).eq('id', 1);
  if (error) { visToast('Kunne ikke lagre: ' + error.message); return; }
  S.hmsHandbok = S.hmsHandbok || {};
  S.hmsHandbok.arligeGjennomganger = logg;
  closeModal('registrerGjennomgang');
  visToast('Årlig gjennomgang registrert', 'ok');
  renderHmsHandbok();
}

// ---------- DB -> JS ----------
function dbToHmsAvvik(r) {
  return { id:r.id, meldtAv:r.meldt_av, meldtAvNavn:r.meldt_av_navn, tittel:r.tittel, beskrivelse:r.beskrivelse,
    kategori:r.kategori, sted:r.sted, bilder:r.bilder||[], status:r.status, tiltak:r.tiltak,
    lukketAv:r.lukket_av, lukketAvNavn:r.lukket_av_navn, lukketAt:r.lukket_at, createdAt:r.created_at };
}
function dbToHmsRisiko(r) {
  return { id:r.id, aktivitet:r.aktivitet, fare:r.fare, sannsynlighet:r.sannsynlighet, konsekvens:r.konsekvens,
    tiltak:r.tiltak, ansvarligId:r.ansvarlig_id, ansvarligNavn:r.ansvarlig_navn, nesteGjennomgang:r.neste_gjennomgang,
    lagetAv:r.laget_av, lagetAvNavn:r.laget_av_navn, oppdatertAt:r.oppdatert_at, createdAt:r.created_at };
}
function dbToHmsStoff(r) {
  return { id:r.id, produktnavn:r.produktnavn, leverandor:r.leverandor, bruksomrade:r.bruksomrade,
    verneutstyr:r.verneutstyr, oppbevaring:r.oppbevaring, sikkerhetsdatablad:r.sikkerhetsdatablad||[],
    aktiv:r.aktiv, lagtTilAv:r.lagt_til_av, lagtTilAvNavn:r.lagt_til_av_navn, createdAt:r.created_at };
}
function dbToHmsVernerundeMal(r) {
  return { id:r.id, sjekkpunkter:r.sjekkpunkter||[], oppdatertAv:r.oppdatert_av, oppdatertAvNavn:r.oppdatert_av_navn, oppdatertAt:r.oppdatert_at };
}
function dbToHmsVernerundeGjennomforing(r) {
  return { id:r.id, dato:r.dato, utfortAv:r.utfort_av, utfortAvNavn:r.utfort_av_navn, resultat:r.resultat||[], notat:r.notat, createdAt:r.created_at };
}
function dbToHmsHandbok(r) {
  return { id:r.id, mal:r.mal||'', ansvarsfordeling:r.ansvarsfordeling||'', arligeGjennomganger:r.arlige_gjennomganger||[],
    oppdatertAv:r.oppdatert_av, oppdatertAvNavn:r.oppdatert_av_navn, oppdatertAt:r.oppdatert_at };
}
