// ════════════════════════════════════════════════════
// SKAL PÅ BILEN (trinn 3 av «Én produktliste», Henrik 17.11.2026)
// ════════════════════════════════════════════════════
// Appen velger selv ombygging og tillegg ut fra modell + bestilling + «Har ved ankomst»-sjekklista, og viser dem som én liste med
// produktnummer, oppskrift og deler (valg A). De ansatte retter bare avvik («Rett», «+ Legg til utstyr»).
//  * Bestilling fra portalen (o.portalLinjer): lista er det som er bestilt. Sjekklista legger ikke til noe; sier den noe annet,
//    varsler appen bare («bestillingen gjelder»).
//  * Uten bestilling: ombyggingen ut fra Nytt/Brukt/Lafinto/Personbil-boksene (finnFikenOmbyggingModell, trinn 2) pluss hvert tillegg/
//    variant i portalen der et «velges når»-punkt (portal_produkter.velges_nar) er huket av i sjekklista.
//  * «Kun ekstrautstyr» (Henrik 19.11): «Har ved ankomst»-kortet finnes ikke i en slik ordre, så sjekklista styrer ikke radene (bare «+ Legg til utstyr» og «Rett»).
//  * Rettelsene lagres som en logg på ordren (ordrer.produkt_rettelser, RPC legg_til_ordre_produkt_rettelse, aldri via save()).
//  * Oppskrift per produkt: en oppskrift som dekker FLERE av produktene (f.eks. «500, 502» = ombygging med 180-stoler) velges før de
//    enkelte, så delene aldri trekkes to ganger; ellers oppskriften koblet til portal-id (trinn 1), ellers ÉN ukoblet med akkurat det nummeret.
//  * Lager trekkes ved ankomst (status forbi «På vei») via lager_trekk_oppskrift (idempotent per ordre+oppskrift), aldri når sjekklista
//    fylles ut før ankomst. Rettes noe etter ankomst, trekkes/legges delene tilbake med en gang.
//  * Gjelder bare ordrer opprettet etter PRODUKTLISTE_FRA. Eldre ordrer beholder dagens avkrysning (renderOrdreLagerbruk i lager.js).
//  * KIA EV9 (Henrik 18.11): (A) et spørsmål «180 eller ikke?» i kortet når bestillingen ikke avgjør det (svaret er en vanlig rettelse på 502),
//    og (B) «Dørbeskyttere» (en ombygging-oppskrift uten produktnummer: bare deler, ingen fakturalinje) følger med så lenge ordren ikke har
//    noe ekstra utstyr (ikke på en «kun ekstrautstyr»-ordre, og ikke når portalens produktliste ikke er lastet). Raden har kilde 'deler' og
//    oppskriftens id som nøkkel (nr), så alle steder som antar et Fiken-nummer må hoppe over den. Oppskriften må ikke døpes om, få produktnummer
//    eller finnes i flere like utgaver (da gjenkjennes den ikke, og delene legges tilbake ved neste bevisste handling): se CLAUDE.md.

// Slått på 17.11.2026 (Henrik: «Ja, slå på»). Bare ordrer opprettet etter dette tidspunktet får «Skal på bilen»; eldre ordrer beholder
// avkrysningen. null = av for alle.
const PRODUKTLISTE_FRA = '2026-11-17T17:20:53Z';

function erNyProduktliste(o) {
  if (!o || !PRODUKTLISTE_FRA || (typeof erLeveranse === 'function' && erLeveranse(o))) return false;
  // En ordre som nettopp er laget i appen har ingen createdAt før den er lest fra databasen: da brukes tidspunktet i id-en (ord_<ms>).
  let t = Date.parse(o.createdAt || '');
  if (!Number.isFinite(t)) { const m = /^ord_(\d{12,14})/.exec(String(o.id || '')); t = m ? Number(m[1]) : NaN; }
  return Number.isFinite(t) && t >= Date.parse(PRODUKTLISTE_FRA);
}
function erAnkommet(o) {
  return !!o && !!o.ordreStatus && o.ordreStatus !== 'paa_vei';
}
const _norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// En verdi i en JS-streng med apostrofer inni onclick="...": HTML-escapet (esc), bakstrek FØRST (ellers spiser en avsluttende \ apostrofen og
// strengen lukkes for tidlig: SyntaxError eller kode i et portalnavn), så apostrof, og linjeskift/linjeseparatorer blir mellomrom (en rå
// linjeskift i en JS-streng er en SyntaksError). Bruk den for ALLE portalstyrte verdier i onclick her, aldri bare esc(...).replace(/'/g, ...).
const _LINJESKIFT = new RegExp('[\\r\\n\\u2028\\u2029]+', 'g');
const _onclickStr = s => esc(String(s == null ? '' : s)).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(_LINJESKIFT, ' ');

// KIA EV9: portal-slug, tillegget «180 graders stoler» (Fiken-nummer) og navnet på oppskriften med bare deler.
const EV9_SLUG = 'kia-ev9';
const EV9_180_NR = '502';
const EV9_DORBESKYTTERE_NAVN = 'dørbeskyttere';
const EV9_DORBESKYTTERE_GRUNN = 'KIA EV9 uten ekstra utstyr, bare ombygging';

// En rettelse gjelder et Fiken-produktnummer, eller (bare for en rad med deler) id-en til en oppskrift. Alt annet i loggen ignoreres.
const _erProduktnummer = nr => /^[1-9][0-9]{0,9}$/.test(String(nr == null ? '' : nr));
const OPPSKRIFT_ID_PREFIKS = 'oppskrift_'; // oppskrifts-id-er (oppskrift_<ms>) er aldri produktnummer; databasen avviser dem som fakturalinje
const _rettelseDato = r => (r && r.at ? new Date(r.at).toLocaleDateString('no-NO', { day: 'numeric', month: 'numeric' }) : '');

// Rettelsesloggen (ordrer.produkt_rettelser) som tilstand per nøkkel: tilstand = siste fjern/legg_til (angre tar tilstanden bort, tilbake til det
// appen selv valgte), lagtTil = siste legg_til siden siste angre (også når en fjern kom etterpå: «ble lagt til for hånd»).
function rettelseTilstand(o) {
  const tilstand = new Map();
  const lagtTil = new Map();
  for (const r of (Array.isArray(o.produktRettelser) ? o.produktRettelser : [])) {
    if (!r || !r.produktnummer) continue;
    if (r.handling === 'angre') { tilstand.delete(r.produktnummer); lagtTil.delete(r.produktnummer); continue; }
    if (r.handling === 'fjern' || r.handling === 'legg_til') {
      tilstand.set(r.produktnummer, r);
      if (r.handling === 'legg_til') lagtTil.set(r.produktnummer, r);
    }
  }
  return { tilstand, lagtTil };
}

// Oppskriften «Dørbeskyttere» for denne ordren: type ombygging, passer bilen, riktig navn og INGEN produktnummer (ingen fakturalinje).
// Finnes den ikke, eller er det flere like (uklart hvilken som gjelder), skjer ingenting.
function ev9DorbeskytterOppskrift(o) {
  const alle = Array.isArray(S.lagerOppskrifter) ? S.lagerOppskrifter : [];
  const treff = alle.filter(x => x && x.type === 'ombygging' && _norm(x.navn) === EV9_DORBESKYTTERE_NAVN
    && oppskriftProduktnumre(x).length === 0 && typeof oppskriftMatcherOrdre === 'function' && oppskriftMatcherOrdre(x, o));
  return treff.length === 1 ? treff[0] : null;
}

// Regelen for dørbeskyttere: bilen har en aktiv ombyggingsrad og INGEN aktiv rad er ekstra utstyr. En rad er ikke ekstra utstyr når den har
// en rolle (ombygging/personbil/Lafinto) eller oppskriften har type «ombygging» (for en rad som deler oppskrift med en annen: oppskriften til den
// som holder den). Alt annet, også en rad uten oppskrift, teller som ekstra utstyr: tvil hindrer dørbeskyttere (forsiktig).
function ev9DorbeskyttereRegel(rader) {
  const aktive = rader.filter(r => !r.fjernet && r.kilde !== 'deler');
  if (!aktive.some(r => r.rolle === 'ombygging')) return false;
  const erOmbygging = r => {
    if (r.rolle) return true;
    const holder = r.oppskriftViaNr ? rader.find(x => x.nr === r.oppskriftViaNr) : r;
    return !!(holder && holder.oppskrift && holder.oppskrift.type === 'ombygging');
  };
  return aktive.every(erOmbygging);
}

// Modellens slug og produkter (fra portal_produkter). Lang ID. Buzz uten egne produkter faller tilbake på radens slug (som i trinn 2).
function produktlisteModell(o) {
  const kan = kanoniskMerkeModell(o);
  const modell = finnFikenOmbyggingModell(kan.merke, kan.modell, o.portalModellSlug);
  const alle = Array.isArray(S.portalProdukter) ? S.portalProdukter : [];
  const sluggerIRekkefolge = [o.portalModellSlug, modell && modell.slug].filter(Boolean);
  let slug = null, produkter = [];
  for (const s of sluggerIRekkefolge) {
    const p = alle.filter(x => x.modell_slug === s);
    if (p.length) { slug = s; produkter = p; break; }
  }
  return { modell, slug: slug || (modell && modell.slug) || null, produkter };
}

// Selve lista. Ren: leser bare o og S. Gir { rader, varsler, bestilt, spm180 } (spm180: 180-spørsmålet for KIA EV9, ellers null).
function beregnSkalPaaBilen(o) {
  const { modell, slug, produkter } = produktlisteModell(o);
  const finnProdukt = nr => produkter.find(p => p.fiken_nummer === nr) || null;
  const bestilt = Array.isArray(o.portalLinjer) && o.portalLinjer.length > 0;
  // «Kun ekstrautstyr (ingen ombygging)» (Henrik 2026-11-17): aldri en ombyggingsrad (ombygging/personbil/Lafinto), verken fra boksene eller fra en
  // bestilling. Sjekkliste-treff, «+ Legg til utstyr» og «Rett» virker som ellers, og lageret trekkes ved ankomst som ellers.
  const kun = o.kunEkstrautstyr === true;
  const rader = [];
  const varsler = [];
  const leggTil = (nr, navn, kilde, grunn, extra = {}) => {
    if (!nr || rader.some(r => r.nr === nr)) return;
    const p = finnProdukt(nr);
    rader.push({ nr, navn: navn || (p && p.navn) || nr, kilde, grunn, portalId: p ? p.portal_id : null, type: p ? p.type : null, rolle: p ? (p.app_rolle || null) : null, fjernet: false, ...extra });
  };
  // «Kun ekstrautstyr» (Henrik 2026-11-19): «Har ved ankomst»-kortet er borte fra ordren, så sjekklista styrer ikke lenger radene. De kommer bare fra
  // «+ Legg til utstyr» og «Rett». Hva som måtte stå i o.utstyrSjekkliste fra før (en eldre ordre) røres ikke, men teller ikke.
  const okPunkter = kun ? [] : (o.utstyrSjekkliste || []).filter(p => p && p.ok).map(p => String(p.punkt || '').trim()).filter(Boolean);
  const okSett = new Map(okPunkter.map(p => [_norm(p), p]));
  const regelTreff = p => (Array.isArray(p.velges_nar) ? p.velges_nar : []).map(v => okSett.get(_norm(v))).find(Boolean) || null;

  if (bestilt) {
    for (const l of o.portalLinjer) {
      const nr = String(l && l.produktnummer || '');
      const p = finnProdukt(nr);
      if (kun && p && p.app_rolle) { varsler.push(`Bestillingen har ${nr} ${p.navn}, men ordren er merket «Kun ekstrautstyr (ingen ombygging)», så den er ikke med.`); continue; }
      // Trinn 5: en bestilling på e-post har kilde 'epost' og antall (Mengde i e-posten), men ingen frosset rabatt.
      const fraEpost = !!(l && l.kilde === 'epost');
      leggTil(nr, l && l.navn, 'bestilling', fraEpost ? 'Bestilt på e-post' : 'Bestilt i portalen', { antall: Number(l && l.antall) > 1 ? Math.floor(Number(l.antall)) : 1, fraEpost });
    }
    for (const p of produkter) {
      if (p.nummer_status !== 'ok' || rader.some(r => r.nr === p.fiken_nummer)) continue;
      const punkt = regelTreff(p);
      if (punkt) varsler.push(`Sjekklista sier «${punkt}», men bestillingen har ikke ${p.fiken_nummer} ${p.navn}. Bestillingen gjelder; legg det til med «+ Legg til utstyr» hvis det skal på bilen.`);
    }
  } else {
    const b = kun ? {} : (o.ombygging || {});
    if (modell && (b.nyttKjoretoy || b.bruktKjoretoy)) {
      const lafinto = !!(b.lafinto && modell.lafinto);
      const rolle = lafinto ? 'lafinto' : 'ombygging';
      const nr = ombyggingNummerFor(o, modell, rolle).nummer;
      leggTil(nr, null, 'ombygging', `${b.nyttKjoretoy ? 'Nytt' : 'Brukt'} kjøretøy er huket av${lafinto ? ', og Lafinto' : ''}`, { rolle });
    }
    if (modell && b.personbil && modell.personbil) {
      leggTil(ombyggingNummerFor(o, modell, 'personbil').nummer, null, 'ombygging', 'Personbil er huket av', { rolle: 'personbil' });
    }
    for (const p of produkter) {
      if (p.nummer_status !== 'ok') continue;
      const punkt = regelTreff(p);
      if (punkt) leggTil(p.fiken_nummer, p.navn, 'sjekkliste', `Sjekklista: «${punkt}» er huket av`);
    }
  }

  // Rettelsene, i rekkefølge: fjern / legg_til / angre (angre = tilbake til det appen selv valgte).
  const { tilstand, lagtTil } = rettelseTilstand(o);
  for (const [nr, r] of tilstand) {
    if (!_erProduktnummer(nr)) continue; // en oppskrifts-id (dørbeskyttere) behandles under, aldri som et Fiken-produkt
    const rad = rader.find(x => x.nr === nr);
    const dato = _rettelseDato(r);
    if (r.handling === 'fjern') {
      if (rad) Object.assign(rad, { fjernet: true, rettet: { av: r.av || '', dato } });
    } else if (!rad) {
      leggTil(nr, r.navn, 'manuell', `Lagt til av ${r.av || 'ukjent'}${dato ? ' ' + dato : ''}`, { rettet: { av: r.av || '', dato } });
    }
  }
  velgOppskrifter(o, rader.filter(r => !r.fjernet));

  // (A) KIA EV9: «180 eller ikke?». Spørsmålet gjelder bare når bestillingen ikke avgjør det (ingen portalbestilling), ordren har en
  // ombygging, og tillegget 502 finnes i portalen. Svaret er en vanlig rettelse på 502 (legg_til = ja, fjern = nei) eller sjekklista
  // («Tillegg for 180 graders stoler»); ubesvart gir standardombyggingen (trygg standard).
  let spm180 = null;
  const p180 = slug === EV9_SLUG ? finnProdukt(EV9_180_NR) : null;
  if (p180 && p180.nummer_status === 'ok' && !bestilt && !kun && rader.some(r => !r.fjernet && r.rolle === 'ombygging')) {
    const t = tilstand.get(EV9_180_NR);
    const rad180 = rader.find(r => r.nr === EV9_180_NR);
    spm180 = { svar: null, av: '', dato: '', kilde: null, nr: EV9_180_NR, navn: p180.navn || EV9_180_NR, portalId: p180.portal_id || '' };
    if (t) Object.assign(spm180, { svar: t.handling === 'legg_til' ? 'ja' : 'nei', av: t.av || '', dato: _rettelseDato(t), kilde: 'rettelse' });
    else if (rad180 && !rad180.fjernet) Object.assign(spm180, { svar: 'ja', kilde: 'sjekkliste' });
    // Svaret går foran sjekklista (en bevisst rettelse), men er det «Nei» mens sjekklista senere ble huket av for 180, sier appen fra: ellers
    // trekkes standarddelene og 502 kommer ikke på fakturaen for en bil som kan være en 180-bil, uten at noen ser motsigelsen.
    const punkt180 = spm180.svar === 'nei' ? regelTreff(p180) : null;
    if (punkt180) varsler.push(`Sjekklista sier «${punkt180}», men svaret på spørsmålet om 180 graders stoler er Nei, så standarddelene brukes og ${EV9_180_NR} kommer ikke på fakturaen. Trykk «Endre» hvis bilen er en 180-bil.`);
  }

  // (B) KIA EV9: «Dørbeskyttere» (bare deler, ingen fakturalinje). Regelen gir raden når ordren ikke har ekstra utstyr; en ansatt kan legge den
  // til for hånd (legg_til gir raden uansett regelen) eller fjerne den (fjern gir en overstrøket rad så lenge regelen ellers ville gitt den
  // eller den var lagt til for hånd).
  const dor = slug === EV9_SLUG ? ev9DorbeskytterOppskrift(o) : null;
  if (dor) {
    const t = tilstand.get(dor.id);
    const hand = lagtTil.get(dor.id);
    // Regelen gir aldri raden av seg selv på en «kun ekstrautstyr»-ordre (en ansatt kan legge den til for hånd, og en hånd-lagt ombygging på en
    // slik ordre gir den heller ikke) og aldri når modellen ikke har noen produkter i portalen (lista er ikke lastet: tvil hindrer dørbeskyttere).
    const regel = !kun && produkter.length > 0 && ev9DorbeskyttereRegel(rader);
    const leggTilDor = (grunn, extra = {}) => rader.push({ nr: dor.id, navn: dor.navn || 'Dørbeskyttere', kilde: 'deler', grunn, portalId: null, type: null, rolle: null, fjernet: false, oppskrift: dor, ...extra });
    const lagtTilGrunn = x => `Lagt til av ${x.av || 'ukjent'}${_rettelseDato(x) ? ' ' + _rettelseDato(x) : ''}`;
    if (t && t.handling === 'legg_til') {
      leggTilDor(lagtTilGrunn(t), { manuell: true, rettet: { av: t.av || '', dato: _rettelseDato(t) } });
    } else if (t && t.handling === 'fjern') {
      if (regel || hand) leggTilDor(regel ? EV9_DORBESKYTTERE_GRUNN : lagtTilGrunn(hand), { fjernet: true, manuell: !regel && !!hand, rettet: { av: t.av || '', dato: _rettelseDato(t) } });
    } else if (regel) {
      leggTilDor(EV9_DORBESKYTTERE_GRUNN);
    }
  }
  return { rader, varsler, bestilt, spm180 };
}

// Oppskrift per aktiv rad (setter rad.oppskrift og ev. rad.oppskriftDeltMed). Se toppen av fila for rekkefølgen.
function velgOppskrifter(o, aktive) {
  aktive = aktive.filter(r => r.kilde !== 'deler'); // en rad med bare deler har sin oppskrift satt direkte og skal aldri få den overskrevet
  const nrs = new Set(aktive.map(r => r.nr));
  const alle = Array.isArray(S.lagerOppskrifter) ? S.lagerOppskrifter : [];
  const passer = r => typeof oppskriftMatcherOrdre === 'function' && oppskriftMatcherOrdre(r, o);
  const dekket = new Set();
  const kombo = alle
    .map(r => ({ r, n: oppskriftProduktnumre(r) }))
    .filter(x => x.n.length >= 2 && x.n.every(nr => nrs.has(nr)) && (passer(x.r) || x.r.portalVariantId || x.r.portalTilleggId))
    .sort((a, b) => b.n.length - a.n.length || String(a.r.id).localeCompare(String(b.r.id)));
  for (const { r, n } of kombo) {
    if (n.some(nr => dekket.has(nr))) continue;
    n.forEach(nr => dekket.add(nr));
    const rader = aktive.filter(x => n.includes(x.nr));
    rader.forEach((rad, i) => { rad.oppskrift = i === 0 ? r : null; rad.oppskriftDeltMed = rader.filter(x => x !== rad).map(x => x.nr); if (i > 0) rad.oppskriftViaNr = rader[0].nr; });
  }
  for (const rad of aktive) {
    if (dekket.has(rad.nr)) continue;
    let r = rad.portalId ? alle.find(x => x.portalVariantId === rad.portalId || x.portalTilleggId === rad.portalId) : null;
    if (!r) {
      const kandidater = alle.filter(x => !x.portalVariantId && !x.portalTilleggId && passer(x) && oppskriftProduktnumre(x).length === 1 && oppskriftProduktnumre(x)[0] === rad.nr);
      if (kandidater.length === 1) r = kandidater[0];
      else if (kandidater.length > 1) rad.oppskriftFlere = kandidater.length;
    }
    rad.oppskrift = r || null;
  }
}

function produktlisteTrukket(o, oppskriftId) {
  return (S.lagerhistorikk || []).some(h => h.ordreId === o.id && h.oppskriftId === oppskriftId);
}
function produktlisteManglerDeler(r) {
  return (r.ingredienser || []).filter(i => { const v = (S.lagervarer || []).find(x => x.id === i.vareId); return !v || Number(v.antall) < Number(i.antall); }).length;
}

// ── Synk: «Utstyr - Skal ha etter visning» (Henrik 27.11.2026) ─────────────────────────────────────────────────────
// Navnet på hvert aktivt produkt i «Skal på bilen» står som egen linje i o.utstyr.skalHa (fritekstfeltet den som klargjør bilen leser), med
// «× N» når antall > 1. Ikke selve ombyggingen (en rad med rolle: ombygging/personbil/Lafinto, eller kilde 'ombygging'): samme regel som den
// gamle avkrysningen (oppdaterSkalHaForOppskrift, «kun Ekstra utstyr»), men uten de gamle per-modell-unntakene. Dørbeskyttere (kilde 'deler') er med.
// Full avstemming hver gang (synkProduktliste kjører på hver opptegning). o.utstyr.skalHaAuto er linjene automatikken har «tatt»: lagt inn selv
// mens produktet er på lista. Bare de kan fjernes igjen; alt annet i feltet er skrevet for hånd og blir stående (formatet kan likevel bli ryddet:
// mellomrom i hver linje trimmes og tomme linjer forsvinner når synken skriver feltet, som den gamle oppdaterSkalHaForOppskrift alltid har gjort).
// En linje som alt sto der for hånd blir aldri tatt, så den fjernes aldri. Sletter noen en automatisk linje for hånd, beholdes den i skalHaAuto og
// legges ikke inn igjen før produktet har vært borte fra lista og kommer tilbake. Et navn som bare er et tall (et produkt uten navn får nummeret
// som navn) tas aldri med: hentFikenLinjerFraUtstyr leser tall-linjer i feltet som produktnumre og ville laget en ekstra fakturalinje.
// Skriving (rettet etter gjennomgangen 27.11): synken kjører ved HVER opptegning, også når noen bare åpner ordren, så den gjør aldri en full save()
// (den ville skrevet hele den lokale, kanskje utdaterte kopien). I stedet en MÅLRETTET update av bare kolonnen `utstyr` (samme mønster som
// leveranseSettKalender), og o.utstyr i minnet endres først når skrivingen har lykkes: feiler den, står minnet urørt og neste synk prøver igjen.
// Aldri mens noen står i tekstfeltet (ulagret skriving kunne gått tapt; neste opptegning tar det). Endres teksten mens den er bekreftet, nullstilles
// bekreftelsen og detaljen tegnes på nytt (samme regel som su()); den nye runden finner ingen endring og skriver ikke igjen.
// Høyst én skriving per ordre om gangen (_skalHaIGang): kommer en ny synk mens en skriving pågår, merkes ordren (_skalHaPaaNytt) og én ny runde
// kjøres med den ferske tilstanden når skrivingen er ferdig. Uten dette kunne to update-er med ulikt innhold gå samtidig og lande i feil rekkefølge.
const _skalHaLinje = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
function skalHaOnskedeLinjer(rader) {
  const ut = [];
  for (const r of rader || []) {
    if (!r || r.fjernet || r.rolle || r.kilde === 'ombygging') continue;
    const navn = _skalHaLinje(r.navn);
    if (!navn || /^\d+$/.test(navn)) continue;
    const linje = r.antall > 1 ? `${navn} × ${r.antall}` : navn;
    if (!ut.includes(linje)) ut.push(linje);
  }
  return ut;
}
const _skalHaIGang = new Set();
const _skalHaPaaNytt = new Set();
const _skalHaFeilVist = new Set();
// Gir true hvis noe ble lagret. Kaster aldri.
async function synkSkalHaFraProduktliste(o, rader) {
  if (!o || !erNyProduktliste(o) || !o.utstyr || typeof o.utstyr !== 'object') return false;
  if (_skalHaIGang.has(o.id)) { _skalHaPaaNytt.add(o.id); return false; }
  const felt = document.getElementById('skalHaInput_' + o.id);
  if (felt && document.activeElement === felt) return false;
  const onsket = skalHaOnskedeLinjer(rader);
  const forrige = Array.isArray(o.utstyr.skalHaAuto) ? o.utstyr.skalHaAuto.map(_skalHaLinje).filter(Boolean) : [];
  const forTekst = String(o.utstyr.skalHa || '');
  const linjer = forTekst.split('\n').map(l => l.trim()).filter(Boolean);
  // Automatiske linjer som ikke lenger er på lista fjernes (en hånd-linje med samme tekst står aldri i forrige).
  const nyeLinjer = linjer.filter(l => !(forrige.includes(l) && !onsket.includes(l)));
  const auto = [];
  for (const l of onsket) {
    if (forrige.includes(l)) { auto.push(l); continue; } // vår fra før (står der, eller er slettet for hånd: legges ikke inn igjen)
    if (nyeLinjer.includes(l)) continue; // skrevet for hånd: røres ikke
    nyeLinjer.push(l); auto.push(l);
  }
  const nyTekst = nyeLinjer.join('\n');
  const tekstEndret = nyTekst !== linjer.join('\n');
  if (!tekstEndret && JSON.stringify(auto) === JSON.stringify(forrige)) return false;
  if (!db) return false;
  const nullstill = tekstEndret && !!o.utstyr.skalHaBekreftet;
  const endring = { skalHaAuto: auto };
  if (tekstEndret) endring.skalHa = nyTekst;
  if (nullstill) endring.skalHaBekreftet = false;
  _skalHaIGang.add(o.id);
  let lagret = false, tegnPaaNytt = false;
  try {
    ignorerRealtimeFor.add(o.id);
    setTimeout(() => ignorerRealtimeFor.delete(o.id), 10000);
    let error = null;
    try { ({ error } = await db.from('ordrer').update({ utstyr: { ...o.utstyr, ...endring } }).eq('id', o.id)); } catch (e) { error = e; }
    if (error) {
      // Én beskjed per ordre til en skriving lykkes (synken kjører ved hver opptegning, f.eks. uten nett).
      if (!_skalHaFeilVist.has(o.id)) { _skalHaFeilVist.add(o.id); visToast('Kunne ikke lagre utstyrslista: ' + (error.message || error)); }
    } else if (String(o.utstyr.skalHa || '') !== forTekst) {
      // Teksten ble endret lokalt mens skrivingen gikk (den som endret den lagrer selv): ikke skriv over minnet, ta en ny runde etterpå.
      _skalHaPaaNytt.add(o.id);
    } else {
      Object.assign(o.utstyr, endring);
      lagret = true;
      _skalHaFeilVist.delete(o.id);
      const feltNa = document.getElementById('skalHaInput_' + o.id);
      if (feltNa && tekstEndret && document.activeElement !== feltNa) feltNa.value = nyTekst;
      tegnPaaNytt = nullstill && activeOrdreId === o.id;
    }
  } catch (e) {
    console.error('synkSkalHaFraProduktliste:', e);
  } finally {
    _skalHaIGang.delete(o.id);
  }
  // Etter at vernet er fjernet: omtegningen kjører synken igjen (renderOrdreLagerbruk), og den skal finne alt lagret, ikke bli merket for en ny runde.
  if (tegnPaaNytt) { try { buildOrdreDetail(); } catch (e) { console.error('synkSkalHaFraProduktliste:', e); } }
  if (_skalHaPaaNytt.delete(o.id)) {
    const fersk = (S.ordrer || []).find(x => x.id === o.id) || o;
    try { if (await synkSkalHaFraProduktliste(fersk, beregnSkalPaaBilen(fersk).rader)) lagret = true; } catch (e) { console.error('synkSkalHaFraProduktliste:', e); }
  }
  return lagret;
}

// ── Synk: fakturalinjer og lager ────────────────────────────────────────────────────────────────────────────────
const _produktlisteIGang = new Set();
// tillatAngre: bare fra en bevisst handling (Rett, sjekkliste, boksene). Fra en vanlig opptegning legges aldri noe tilbake på lager.
async function synkProduktliste(o, { tillatAngre = false } = {}) {
  if (!erNyProduktliste(o)) return;
  const { rader, bestilt } = beregnSkalPaaBilen(o);
  const { produkter } = produktlisteModell(o);
  // 0) En fakturalinje med en oppskrifts-id som produktnummer er aldri et Fiken-produkt (fiken-fakturer ville svart «Fant ikke Fiken-produkt»). Den
  //    kan bare komme fra en GAMMEL klient (åpen fane/tilbakerulling) som leste en dørbeskyttere-rettelse som et vanlig produkt: rydd den bort.
  for (const nr of (o.fikenLinjer || []).map(l => String(l && l.produktnummer || '')).filter(nr => nr.startsWith(OPPSKRIFT_ID_PREFIKS))) {
    await oppdaterFikenLinjeForOppskrift(nr, false, o.id);
  }
  // 1) Fakturalinjer for det appen la til (sjekkliste) eller som er lagt til for hånd. Ombyggingen styres av synkroniserOmbyggingFikenLinjer,
  //    og bestilte linjer (med frosset rabatt) av Bekreft; en linje med rabatt fjernes aldri automatisk (oppdaterFikenLinjeForOppskrift).
  //    En rad med bare deler (kilde 'deler', f.eks. dørbeskyttere) har ingen fakturalinje og går aldri hit.
  for (const r of rader) {
    if (r.kilde === 'sjekkliste' || r.kilde === 'manuell') await oppdaterFikenLinjeForOppskrift(r.nr, !r.fjernet, o.id);
    // Trinn 5: bestilt på e-post. Fakturalinjen (med antall, uten rabatt: kundens avtalte rabatt brukes) kommer når ordren er bekreftet.
    else if (r.kilde === 'bestilling' && r.fraEpost && typeof epostOrdreBekreftet === 'function' && epostOrdreBekreftet(o)) {
      if (r.fjernet) await oppdaterFikenLinjeForOppskrift(r.nr, false, o.id);
      else await epostSikreFakturalinje(o, r.nr, r.antall || 1);
    }
  }
  // Ikke for «Kun ekstrautstyr»: sjekklista styrer ikke radene der, så en fakturalinje som en eldre sjekkliste-avkrysning la inn skal ikke fjernes stille (den står i
  // Fakturering, og fakturaSjekk sier fra hvis den ikke er på «Skal på bilen»).
  if (!bestilt && o.kunEkstrautstyr !== true) {
    for (const p of produkter) {
      if (p.nummer_status !== 'ok' || !(p.velges_nar || []).length) continue;
      if (!rader.some(r => r.nr === p.fiken_nummer && !r.fjernet)) await oppdaterFikenLinjeForOppskrift(p.fiken_nummer, false, o.id);
    }
  }
  // Et produkt som ble lagt til for hånd og så angret, har ingen rad lenger: linjen det fikk skal også bort (funnet i nettlesertest 17.11).
  const lagtTilForHand = new Set((Array.isArray(o.produktRettelser) ? o.produktRettelser : []).filter(r => r && r.handling === 'legg_til' && _erProduktnummer(r.produktnummer)).map(r => r.produktnummer));
  for (const nr of lagtTilForHand) {
    if (!rader.some(r => r.nr === nr)) await oppdaterFikenLinjeForOppskrift(nr, false, o.id);
  }
  // «Skal ha etter visning» følger lista (se synkSkalHaFraProduktliste over: målrettet update av bare `utstyr`, aldri full save()). Regnes ut på
  // nytt her, ikke fra `rader` fra toppen: ordren kan ha endret seg mens RPC-ene over gikk.
  try { await synkSkalHaFraProduktliste(o, beregnSkalPaaBilen(o).rader); } catch (e) { console.error('synkSkalHaFraProduktliste:', e); }
  // 2) Lager, bare etter ankomst.
  if (!erAnkommet(o) || !db) return;
  const onsket = new Map();
  for (const r of rader) if (!r.fjernet && r.oppskrift) onsket.set(r.oppskrift.id, r.oppskrift);
  for (const [id, opp] of onsket) {
    if (produktlisteTrukket(o, id)) continue;
    await produktlisteTrekk(o, opp);
  }
  if (tillatAngre) {
    const trukne = new Set((S.lagerhistorikk || []).filter(h => h.ordreId === o.id && h.oppskriftId).map(h => h.oppskriftId));
    for (const id of trukne) if (!onsket.has(id)) await produktlisteAngre(o, id);
  }
}

async function produktlisteTrekk(o, r) {
  const nokkel = o.id + '|' + r.id;
  if (_produktlisteIGang.has(nokkel) || !(r.ingredienser || []).length) return;
  _produktlisteIGang.add(nokkel);
  try {
    const { data, error } = await db.rpc('lager_trekk_oppskrift', { p_ordre_id: o.id, p_oppskrift_id: r.id, p_ansatt: me?.navn || '' });
    if (error) { if (error.message !== 'ALLEREDE_TRUKKET') visToast('Kunne ikke trekke fra lager: ' + error.message); return; }
    (r.ingredienser || []).forEach(i => {
      const v = (S.lagervarer || []).find(x => x.id === i.vareId);
      if (v) registrerLagerEndring(v, -Math.abs(i.antall), 'ut', o.id, r.navn, data?.batchId, null, r.id, true);
    });
    if (data?.ikkeFunnet) visToast(`${r.navn}: ${data.ikkeFunnet} vare(r) finnes ikke lenger på lager og ble ikke trukket.`);
  } finally { _produktlisteIGang.delete(nokkel); }
}

async function produktlisteAngre(o, oppskriftId) {
  const nokkel = o.id + '|' + oppskriftId;
  if (_produktlisteIGang.has(nokkel)) return;
  _produktlisteIGang.add(nokkel);
  try {
    const { error } = await db.rpc('lager_angre_oppskrift_trekk', { p_ordre_id: o.id, p_oppskrift_id: oppskriftId });
    if (error) { if (error.message !== 'IKKE_TRUKKET') visToast('Kunne ikke legge delene tilbake: ' + error.message); return; }
    const rader = (S.lagerhistorikk || []).filter(h => h.ordreId === o.id && h.oppskriftId === oppskriftId);
    rader.forEach(h => { const v = (S.lagervarer || []).find(x => x.id === h.vareId); if (v) v.antall = (Number(v.antall) || 0) - h.endring; });
    S.lagerhistorikk = (S.lagerhistorikk || []).filter(h => !(h.ordreId === o.id && h.oppskriftId === oppskriftId));
  } finally { _produktlisteIGang.delete(nokkel); }
}

// ── Rettelser ────────────────────────────────────────────────────────────────────────────────────────────────────
const _produktRettelseIGang = new Set();
async function produktRettelse(ordreId, handling, nr, navn, portalId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o || !db) return;
  if (_produktRettelseIGang.has(ordreId)) return;
  _produktRettelseIGang.add(ordreId);
  try {
    if (typeof ignorerRealtimeFor !== 'undefined') { ignorerRealtimeFor.add(ordreId); setTimeout(() => ignorerRealtimeFor.delete(ordreId), 10000); }
    if (typeof merkLokalOrdreEndring === 'function') merkLokalOrdreEndring(ordreId);
    const { data, error } = await db.rpc('legg_til_ordre_produkt_rettelse', { p_ordre_id: ordreId, p_rettelse: { handling, produktnummer: nr, navn: navn || null, portalId: portalId || null } });
    if (error) { visToast('Kunne ikke lagre rettelsen: ' + error.message); return; }
    o.produktRettelser = Array.isArray(data) ? data : o.produktRettelser;
    // En rad med bare deler har en oppskrifts-id som nøkkel: loggen bruker da navnet, aldri den rå nøkkelen.
    const etikett = _erProduktnummer(nr) ? nr : (navn || ((Array.isArray(S.lagerOppskrifter) ? S.lagerOppskrifter : []).find(x => x.id === nr) || {}).navn || 'deler');
    const tekst = handling === 'fjern' ? `Fjernet ${etikett} fra «Skal på bilen»` : handling === 'legg_til' ? `La til ${etikett} på «Skal på bilen»` : `Angret rettelse på ${etikett}`;
    if (typeof logChange === 'function') logChange(o, tekst);
    await synkProduktliste(o, { tillatAngre: true });
  } finally {
    _produktRettelseIGang.delete(ordreId);
    renderSkalPaaBilen(ordreId);
  }
}

// ── Visning ─────────────────────────────────────────────────────────────────────────────────────────────────────
const _skalPaaBilenApneRett = new Set();
let _skalPaaBilenSok = { ordreId: null, tekst: '' };

function skalPaaBilenHTML(o) {
  const { rader, varsler, bestilt, spm180 } = beregnSkalPaaBilen(o);
  const { slug, produkter } = produktlisteModell(o);
  const ankommet = erAnkommet(o);
  const idJs = _onclickStr(o.id);
  const arg = _onclickStr; // verdi i en JS-streng inni onclick (HTML-escapet, bakstrek og apostrof escapet, linjeskift borte)
  const pill = (txt, farge) => {
    const f = { gron: ['rgba(34,197,94,.12)', '#86efac', 'rgba(34,197,94,.35)'], gul: ['rgba(245,158,11,.12)', '#fbbf24', 'rgba(245,158,11,.4)'], bla: ['rgba(59,130,246,.12)', '#93c5fd', 'rgba(59,130,246,.4)'], gra: ['#18181b', '#a1a1aa', '#27272a'] }[farge];
    return `<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:${f[0]};color:${f[1]};border:1px solid ${f[2]}">${esc(txt)}</span>`;
  };
  const radHTML = r => {
    const nrJs = _onclickStr(r.nr);
    const opp = r.oppskrift;
    let status = '';
    if (r.fjernet) status = pill('Fjernet', 'gra');
    else if (r.oppskriftViaNr) status = pill(`Deler i ${r.oppskriftViaNr}`, 'gra');
    else if (!opp) status = pill(r.oppskriftFlere ? `${r.oppskriftFlere} oppskrifter` : 'Ingen oppskrift', 'gra');
    else if (produktlisteTrukket(o, opp.id)) status = pill('Trukket fra lager', 'gron');
    else {
      // Manglende deler vises også før ankomst, så de kan bestilles i tide.
      const m = produktlisteManglerDeler(opp);
      status = (ankommet ? pill('Trekkes nå', 'bla') : pill('Trekkes ved ankomst', 'bla')) + (m ? ' ' + pill(`${m} ${m === 1 ? 'del' : 'deler'} mangler på lager`, 'gul') : '');
    }
    const deler = opp && !r.oppskriftViaNr ? (opp.ingredienser || []).map(i => {
      const v = (S.lagervarer || []).find(x => x.id === i.vareId);
      return v ? `${esc(v.navn)} ${fmtAntall(i.antall)}` : null;
    }).filter(Boolean).join(' · ') : '';
    const erDeler = r.kilde === 'deler';
    const typeTekst = erDeler ? 'Deler' : r.rolle === 'personbil' ? 'Personbil' : r.rolle === 'lafinto' ? 'Lafinto' : r.rolle === 'ombygging' ? 'Ombygging' : r.type === 'variant' ? 'Variant' : r.type === 'losning' ? 'Løsning' : 'Tillegg';
    const apen = _skalPaaBilenApneRett.has(o.id + '|' + r.nr);
    // En rad med bare deler har en oppskrifts-id som nøkkel og sender navnet med (til logglinjen). Er den lagt til for hånd og så fjernet, legges
    // den tilbake med legg_til (angre ville tatt den helt bort); er den regelens egen rad, er angre veien tilbake til regelen.
    const navnArg = erDeler ? `,'${arg(r.navn)}'` : '';
    const leggTilbake = erDeler && r.manuell ? 'legg_til' : 'angre';
    const meny = !apen ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${r.kilde === 'ombygging'
        ? `<span class="small muted">Ombyggingen endres med Nytt/Brukt/Lafinto/Personbil-boksene over.</span>`
        : r.fjernet
          ? `<button class="btn sm" onclick="produktRettelse('${idJs}','${leggTilbake}','${nrJs}'${navnArg})">Legg tilbake</button>`
          : `<button class="btn sm red" onclick="produktRettelse('${idJs}','fjern','${nrJs}'${navnArg})">Fjern fra bilen</button>`}
      ${r.kilde === 'manuell' || r.manuell ? `<button class="btn sm" onclick="produktRettelse('${idJs}','angre','${nrJs}'${navnArg})">Angre (ta bort igjen)</button>` : ''}
      ${r.kilde === 'bestilling' && !r.fjernet && !r.fraEpost ? `<span class="small muted">Linjen i Fakturering har bestillingens rabatt og fjernes der hvis den ikke skal faktureres.</span>` : ''}
    </div>`;
    return `<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 12px;border-radius:10px;background:#0f0f12;border:1px solid ${r.rettet ? 'rgba(245,158,11,.45)' : '#27272a'};${r.fjernet ? 'opacity:.6' : ''}">
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;font-size:13.5px;${r.fjernet ? 'text-decoration:line-through' : ''}">${esc(r.navn)}${r.antall > 1 ? ` <span style="color:#a1a1aa;font-weight:600">× ${r.antall}</span>` : ''} ${r.rettet ? pill('Rettet', 'gul') : ''}</div>
        <div style="font-family:ui-monospace,monospace;font-size:11px;color:#a1a1aa">${erDeler ? 'Kun deler, ingen fakturalinje' : esc(r.nr)} · ${typeTekst}</div>
        <div style="font-size:11.5px;color:#a1a1aa;margin-top:2px">Valgt fordi: ${esc(r.fjernet && r.rettet ? `${r.grunn}. Fjernet av ${r.rettet.av} ${r.rettet.dato}` : r.grunn)}</div>
        ${deler ? `<div style="font-size:11.5px;color:#71717a;margin-top:2px">${deler}</div>` : ''}
        ${meny}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">${status}
        <button class="btn sm" onclick="skalPaaBilenVeksleRett('${idJs}','${nrJs}')">${apen ? 'Lukk' : 'Rett'}</button></div>
    </div>`;
  };
  const sok = _skalPaaBilenSok.ordreId === o.id ? _skalPaaBilenSok.tekst : null;
  const aktiveNr = new Set(rader.filter(r => !r.fjernet).map(r => r.nr));
  const treff = sok === null ? [] : produkter
    .filter(p => p.nummer_status === 'ok' && !aktiveNr.has(p.fiken_nummer))
    .filter(p => { const ord = _norm(sok).split(' ').filter(Boolean); const t = _norm(`${p.fiken_nummer} ${p.navn}`); return ord.every(w => t.includes(w)); })
    .slice(0, 8);
  // KIA EV9: dørbeskyttere (bare deler) kan legges til for hånd også når ordren har ekstra utstyr. Tilbys bare når raden ikke er aktiv.
  const dorOpp = slug === EV9_SLUG ? ev9DorbeskytterOppskrift(o) : null;
  const dorTreff = sok !== null && dorOpp && !rader.some(r => r.kilde === 'deler' && !r.fjernet)
    && _norm(sok).split(' ').filter(Boolean).every(w => _norm(`${dorOpp.navn} (bare deler)`).includes(w));
  const dorKnapp = dorTreff
    ? `<button class="btn sm" style="text-align:left;justify-content:flex-start" onclick="produktRettelse('${idJs}','legg_til','${arg(dorOpp.id)}','${arg(dorOpp.navn)}','');skalPaaBilenLukkSok()">${esc(dorOpp.navn)} (bare deler)</button>`
    : '';
  const sokHTML = sok === null
    ? `<button class="btn sm" onclick="skalPaaBilenApneSok('${idJs}')">+ Legg til utstyr</button>`
    : `<div style="display:grid;gap:6px">
        <input id="skalPaaBilenSok_${esc(o.id)}" value="${esc(sok)}" placeholder="Søk på navn eller produktnummer (${produkter.length} produkter for modellen)" oninput="skalPaaBilenSok('${idJs}',this.value)" autocomplete="off">
        ${treff.map(p => `<button class="btn sm" style="text-align:left;justify-content:flex-start" onclick="produktRettelse('${idJs}','legg_til','${arg(p.fiken_nummer)}','${arg(p.navn)}','${arg(p.portal_id)}');skalPaaBilenLukkSok()">${esc(p.fiken_nummer)} ${esc(p.navn)}</button>`).join('')}
        ${dorKnapp}
        ${produkter.length ? '' : '<div class="small muted">Fant ingen produkter for denne modellen i portalen. Trykk «Hent produkter fra portalen» under Kontakter (admin).</div>'}
        <button class="btn sm" onclick="skalPaaBilenLukkSok()">Lukk søk</button>
      </div>`;
  // KIA EV9: «180 eller ikke?». Ubesvart: en ravgul boks med to knapper. Besvart: en kompakt linje med «Endre», som bytter svaret
  // (ja = legg_til 502, nei = fjern 502; produktRettelse kjører synkProduktliste med tillatAngre, så delene byttes hvis bilen er ankommet).
  let spmHTML = '';
  if (spm180) {
    const args = `'${arg(spm180.nr)}','${arg(spm180.navn)}','${arg(spm180.portalId)}'`;
    if (spm180.svar === null) {
      spmHTML = `<div id="spm180_${esc(o.id)}" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.5);border-radius:12px;padding:10px 12px;display:grid;gap:8px">
        <div style="font-weight:700;font-size:13px;color:#fbbf24">Er dette en 180-bil? (${esc(spm180.navn)}, ${esc(spm180.nr)})</div>
        <div style="font-size:11.5px;color:#a1a1aa">Svaret avgjør om ombyggingen bruker standarddelene eller 180-delene. Uten svar brukes standard.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm" onclick="produktRettelse('${idJs}','legg_til',${args})">Ja, 180</button>
          <button class="btn sm" onclick="produktRettelse('${idJs}','fjern',${args})">Nei, standard</button>
        </div>
      </div>`;
    } else {
      const ja = spm180.svar === 'ja';
      const hvem = spm180.kilde === 'sjekkliste' ? 'fra sjekklista' : `svart av ${spm180.av || 'ukjent'}${spm180.dato ? ' ' + spm180.dato : ''}`;
      spmHTML = `<div id="spm180_${esc(o.id)}" style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:12px;color:#a1a1aa;padding:2px 2px">
        <span>180 graders stoler: <b style="color:#e4e4e7">${ja ? 'Ja' : 'Nei'}</b>, ${esc(hvem)}</span>
        <button class="btn sm" title="Bytt svaret til ${ja ? 'Nei' : 'Ja'}" onclick="produktRettelse('${idJs}','${ja ? 'fjern' : 'legg_til'}',${args})">Endre</button>
      </div>`;
    }
  }
  return `<div class="card" style="display:grid;gap:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="card-title" style="margin:0">Skal på bilen</div>${bestilt ? pill(o.portalLinjer.some(l => l && l.kilde === 'epost') ? 'Fra e-post' : 'Fra portalen', 'bla') : ''}</div>
    ${spmHTML}
    ${varsler.map(v => `<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);border-radius:12px;padding:8px 10px;font-size:12px;color:#fbbf24">⚠ ${esc(v)}</div>`).join('')}
    ${rader.length ? rader.map(radHTML).join('') : (o.kunEkstrautstyr === true ? '<div class="small muted">Ingenting valgt ennå. Legg til utstyret med «+ Legg til utstyr».</div>' : '<div class="small muted">Ingenting valgt ennå. Huk av Nytt/Brukt kjøretøy, fyll ut «Har ved ankomst», eller legg til utstyr.</div>')}
    ${sokHTML}
    ${ankommet ? '' : '<div class="small muted">Delene trekkes fra lageret når bilen settes til «Ikke påbegynt» (ankommet).</div>'}
  </div>`;
}

function renderSkalPaaBilen(ordreId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  const el = document.getElementById('ordreLagerbruk_' + ordreId); if (!el) return;
  el.innerHTML = skalPaaBilenHTML(o);
}
function skalPaaBilenVeksleRett(ordreId, nr) {
  const k = ordreId + '|' + nr;
  if (_skalPaaBilenApneRett.has(k)) _skalPaaBilenApneRett.delete(k); else _skalPaaBilenApneRett.add(k);
  renderSkalPaaBilen(ordreId);
}
function skalPaaBilenApneSok(ordreId) {
  _skalPaaBilenSok = { ordreId, tekst: '' };
  renderSkalPaaBilen(ordreId);
  const el = document.getElementById('skalPaaBilenSok_' + ordreId); if (el) el.focus();
}
function skalPaaBilenSok(ordreId, tekst) {
  _skalPaaBilenSok = { ordreId, tekst: String(tekst || '').slice(0, 60) };
  renderSkalPaaBilen(ordreId);
  const el = document.getElementById('skalPaaBilenSok_' + ordreId);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function skalPaaBilenLukkSok() {
  const id = _skalPaaBilenSok.ordreId;
  _skalPaaBilenSok = { ordreId: null, tekst: '' };
  if (id) renderSkalPaaBilen(id);
}
