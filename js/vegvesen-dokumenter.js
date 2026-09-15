// ════════════════════════════════════════════════════
// VEGVESEN-DOKUMENTER — automatisk generering av Egenerklæring, Vektfordeling,
// Fabrikantattest, trinn 2-lapp, Kjøretøyliste og Melding om registrering.
// Kun for ordre med o.ombygging.nyttKjoretoy=true, og kun for modeller det finnes
// mal + geometri for (se VEGVESEN_MODELLER under).
// ════════════════════════════════════════════════════

// Faste fysiske mål per bilmodell (akselavstand, seteposisjon, varerommets lengde) -
// IKKE del av ordrens egne vekter, brukes i jevnt-fordelt-last-beregningen
// (EU 2021/535, Section B). Kun KIA EV9 foreløpig - flere modeller legges til etter
// hvert som Henrik gir tilsvarende referansedokumenter for dem.
const VEKTFORDELING_GEOMETRI = {
  'KIA EV9': { a: 3.100, b: 1.480, d: 2.120 }
};
function vegvesenGeometri(merke, modell) {
  const noekkel = `${(merke || '').trim()} ${(modell || '').trim()}`.trim().toUpperCase();
  const treff = Object.keys(VEKTFORDELING_GEOMETRI).find(k => k.toUpperCase() === noekkel);
  return treff ? VEKTFORDELING_GEOMETRI[treff] : null;
}

// Selve jevnt-fordelt-last-beregningen (EU 2021/535, Section B / N1 2018/858 pk 3.6.1) -
// gjenskaper formlene fra Telemark Salmakerverksted sitt eget Vektfordeling-regneark.
// P/P1/P2 = Teknisk tillatt totalvekt/aksel 1/aksel 2 (fra Vekter -> Ved ankomst).
// M/M1/M2 = Masse i kjøreklar stand totalt/aksel 1/aksel 2 (fra Vekter -> Før visning).
// geometri = {a: akselavstand, b: avstand sete-foraksel, d: lengde lasterom}.
function beregnVektfordeling(P, P1, P2, M, M1, M2, geometri) {
  const { a, b, d } = geometri;
  const c = d / 2 + 1.75;
  const nyttelast = n => P - M - (n + 1) * 75;
  const frontLast = n => ((n + 1) * 75 * (a - b) + nyttelast(n) * (a - c)) / a;
  const bakLast = n => ((n + 1) * 75 * b + nyttelast(n) * c) / a;
  const frontMaks = P1 - M1;
  const bakMaks = P2 - M2;
  const rader = [0, 1, 2].map(n => {
    const front = frontLast(n);
    const bak = bakLast(n);
    return { n, nyttelast: nyttelast(n), front, frontOk: front <= frontMaks, bak, bakOk: bak <= bakMaks };
  });
  // Krav (spesifisert av Henrik): alle tre "n" for framaksel må være sanne, men for
  // bakaksel er det kun de to øverste passasjertallene (n=1 og n=2 - "de to nederste
  // radene" i regnearket) som må være sanne. n=0 på bakaksel kan være usann.
  const frontOppfylt = rader.every(r => r.frontOk);
  const bakOppfylt = rader[1].bakOk && rader[2].bakOk;
  return { rader, frontMaks, bakMaks, frontOppfylt, bakOppfylt, oppfylt: frontOppfylt && bakOppfylt, c };
}

// Finner den høyeste heltalls-totalvekten (P) som tilfredsstiller kravet over, uten å
// prøve-og-feile - løst algebraisk ut fra de samme formlene (se beregnVektfordeling).
// Returnerer alltid <= opprinnelig P (senker aldri en verdi som allerede er lav nok,
// og runder alltid NED til nærmeste hele kg, som spesifisert av Henrik).
function finnJustertTotalvekt(P, P1, P2, M, M1, M2, geometri) {
  const { a, b, d } = geometri;
  const c = d / 2 + 1.75;
  const frontMaks = P1 - M1;
  const bakMaks = P2 - M2;
  // Løser P <= ... for hvert krav som MÅ være sant (front: n=0,1,2 / bak: n=1,2).
  const maksPFront = n => M + (n + 1) * 75 + (a * frontMaks - (n + 1) * 75 * (a - b)) / (a - c);
  const maksPBak = n => M + (n + 1) * 75 + (a * bakMaks - (n + 1) * 75 * b) / c;
  const kandidater = [maksPFront(0), maksPFront(1), maksPFront(2), maksPBak(1), maksPBak(2)];
  const grense = Math.floor(Math.min(...kandidater));
  return Math.min(P, grense);
}

// ── PDF-oppsett (pdf-lib) ──────────────────────────────────────────────────

// Logo og signatur hentes én gang og caches - begge er små, statiske filer som
// brukes på alle genererte dokumenter.
const vegvesenAssetCache = {};
async function vegvesenLastAsset(sti) {
  if (vegvesenAssetCache[sti]) return vegvesenAssetCache[sti];
  const res = await fetch(sti);
  if (!res.ok) throw new Error('Fant ikke ' + sti);
  const bytes = await res.arrayBuffer();
  vegvesenAssetCache[sti] = bytes;
  return bytes;
}

function vegvesenDatoNorsk(d) {
  const MAANEDER = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  d = d || new Date();
  return `Skien, ${d.getDate()}. ${MAANEDER[d.getMonth()]} ${d.getFullYear()}`;
}

// Bryter en tekststreng til flere linjer som passer innenfor maksBredde ved gitt
// skriftstørrelse - pdf-lib har ingen innebygd automatisk tekstbryting.
function vegvesenOmbrytTekst(tekst, font, storrelse, maksBredde) {
  const ord = tekst.split(' ');
  const linjer = [];
  let gjeldende = '';
  for (const w of ord) {
    const test = gjeldende ? gjeldende + ' ' + w : w;
    if (gjeldende && font.widthOfTextAtSize(test, storrelse) > maksBredde) {
      linjer.push(gjeldende);
      gjeldende = w;
    } else {
      gjeldende = test;
    }
  }
  if (gjeldende) linjer.push(gjeldende);
  return linjer;
}

// Tegner det felles brevhodet (logo øverst venstre, adresse øverst høyre) som brukes
// på Egenerklæring/Vektfordeling/Fabrikantattest - alle er brevark fra Salmakerverksted.
async function vegvesenTegnBrevhode(page, font, fontBold, logoImg, bredde, toppY) {
  const H = 3734;
  if (logoImg) {
    const logoBredde = 130;
    const logoHoyde = logoImg.height * (logoBredde / logoImg.width);
    page.drawImage(logoImg, { x: 40, y: toppY - logoHoyde, width: logoBredde, height: logoHoyde });
  }
  const adresseLinjer = [
    ['Bataljonvegen 25', ''], ['3734 Skien', ''],
    ['Telefon', '35 59 33 95'], ['Mobil', '915 67 363'],
    ['E-post', 'post@salmaker.as'], ['Internet', 'www.salmaker.as'],
    ['Bank', '2801.56.52790'], ['Org.nr.', '983 885 713 MVA'],
    ['Innehaver', 'Jan Børre Sigurdsen']
  ];
  let y = toppY;
  adresseLinjer.forEach(([lbl, verdi]) => {
    if (verdi) {
      page.drawText(lbl, { x: bredde - 260, y, size: 9, font });
      page.drawText(verdi, { x: bredde - 175, y, size: 9, font });
    } else {
      page.drawText(lbl, { x: bredde - 260, y, size: 9, font });
    }
    y -= 13;
  });
  return Math.min(toppY - 9 * 13, toppY - 60) - 20;
}

// ── Egenerklæring ────────────────────────────────────────────────────────

// Kun teksten om hva som demonteres/fjernes skiller Standard fra Panorama-varianten
// (Panorama har i tillegg en bakre sjalusi på glasstaket som må fjernes).
const EGENERKLAERING_AVSNITT3_FELLES_START = 'I forbindelse med ombygging av denne bilen blir andre og tredje seteradene med tilhørende braketter/deksler';
function egenerklaeringAvsnitt(variant, chassis, merkeModell) {
  const demontering = variant === 'panorama'
    ? ', kanaler til klima i taket og bakre sjalusi på glasstak demontert og fjernet.'
    : ' og kanaler til klima i taket demontert og fjernet.';
  return [
    `Ombyggingen gjelder en ${merkeModell}, ${chassis}.`,
    'Telemark Salmakerverksted, påbyggerverksted nr. 31067, bekrefter herved at ombyggingen av denne bilen tilfredsstiller de krav som er beskrevet i Bilforskriften, og at det ikke er laget nye fester eller gjort inngrep i bilens karosseri ved monteringen av innredningen, da det her kun er tatt i bruk originale fester.',
    `${EGENERKLAERING_AVSNITT3_FELLES_START}${demontering} Sikkerhetsbelter blir løsnet i endefestene som er synlig i bilen, men selve belterullen blir stående. Så foldes beltestroppen sammen og en skumplast blir lagt rundt for å beskytte mot skader, og så legges disse bak sidepanelene. Deretter blir støttebraketter montert i gulvet, og disse blir festet ved bruk av originale skruer og i de originale festene i gulvet. Så monteres gulvplatene på disse brakettene med nagler. Skilleveggen blir montert i framkant av gulvplaten med skruer, og i egne takbraketter som festes i de originale festene til håndtakene i taket.`,
    'Bilen er vist med taktrekk, men uten et uoriginalt teppe som legges løst inn etter godkjenning. Dette må fjernes dersom «statskassen» skal plasseres i bilen på et senere tidspunkt. Takbrakettenes mål kan kontrolleres på vedlagt tegning dersom det er mistanke om at det er gjort endinger på disse. Når vi fremviser denne bilen så bruker vi beskyttelser i hjørnene på «statskassen», og det er derfor viktig at det vises aktsomhet dersom denne skal plasseres på en senere kontroll slik at ikke taktrekket skades unødvendig.',
    'Beregning av jevnt fordelt last er gjort i henhold til direktiv 2021/535, Seksjon B.',
    'Bilen er merket med merkeplate for trinn 2 påbygger i henhold til direktiv 2021/535.',
    'Se vedlagt Fabrikantattest for dokumentasjon av krav og endringer gjort på kjøretøyet.',
    'All vedlagt dokumentasjon inkludert denne egenerklæringen er som forretningshemmeligheter å regne og skal ikke utleveres til andre aktører.'
  ];
}

// Avgjør Standard/Panorama ut fra ordrens utstyrsjekkliste (huket punkt som inneholder
// "panorama") - se Henriks forklaring: valget følger utstyrsmalen, ikke et eget felt.
function egenerklaeringVariant(o) {
  const harPanorama = (o.utstyrSjekkliste || []).some(p => p.ok && /panorama/i.test(p.punkt || ''));
  return harPanorama ? 'panorama' : 'standard';
}

// Antall sitteplasser (Inn) på Fabrikantattest avhenger av hvilken seterad-variant som er
// huket av på Utstyr - Har ved ankomst: "5-seter bak" -> 7 seter totalt, "4-seter bak" ->
// 6 seter totalt (bekreftet av Henrik 2026-09-14). Fallback 7 (vanligste variant) hvis
// ingen av punktene er huket av.
function fabrikantattestSitteplasser(o) {
  const punkt = (o.utstyrSjekkliste || []).find(p => p.ok && /\d\s*-?\s*seter\s*bak/i.test(p.punkt || ''));
  if (!punkt) return 7;
  const antall = parseInt(punkt.punkt.match(/(\d)\s*-?\s*seter\s*bak/i)[1], 10);
  return antall === 4 ? 6 : 7;
}

async function genEgenerklaeringPDF(o) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await vegvesenLastAsset('logoer/SALMAKERN LOGOFORSLAG NY.png');
  const logoImg = await pdfDoc.embedPng(logoBytes);

  const BREDDE = 595.28, HOYDE = 841.89; // A4 punkter
  const page = pdfDoc.addPage([BREDDE, HOYDE]);
  const venstreMarg = 40, hoyreMarg = 40;
  const tekstBredde = BREDDE - venstreMarg - hoyreMarg;

  let y = await vegvesenTegnBrevhode(page, font, fontBold, logoImg, BREDDE, HOYDE - 40);

  const variant = egenerklaeringVariant(o);
  const merkeModell = `${o.merke || ''} ${o.modell || ''}`.trim();
  const tittel = 'EGENERKLÆRING PÅ OMBYGGING TIL VAREBIL N1.';
  page.drawText(tittel, { x: venstreMarg, y, size: 12, font: fontBold });
  y -= 26;

  const avsnitt = egenerklaeringAvsnitt(variant, o.chassis || '', merkeModell);
  const storrelse = 10.5, linjeHoyde = 14;
  avsnitt.forEach(tekst => {
    const linjer = vegvesenOmbrytTekst(tekst, font, storrelse, tekstBredde);
    linjer.forEach(linje => { page.drawText(linje, { x: venstreMarg, y, size: storrelse, font }); y -= linjeHoyde; });
    y -= 8;
  });

  y -= 10;
  // Rødt i Henriks originaldokumenter markerer bare "dette er en variabel verdi i
  // malen" - i det ferdig genererte dokumentet er alt reelt utfylt, så alt skal være
  // vanlig sort tekst, ikke bare denne datoen.
  page.drawText(vegvesenDatoNorsk(), { x: venstreMarg, y, size: 10.5, font });
  y -= 45;

  const sigBytes = await vegvesenLastAsset('assets/signatur-jbs.png');
  const sigImg = await pdfDoc.embedPng(sigBytes);
  const sigBredde = 110, sigHoyde = sigImg.height * (sigBredde / sigImg.width);
  page.drawImage(sigImg, { x: venstreMarg - 5, y: y - sigHoyde + 20, width: sigBredde, height: sigHoyde });
  y -= 5;
  ['Jan Børre Sigurdsen', 'Teknisk leder', 'Telemark Salmakerverksted'].forEach(linje => {
    page.drawText(linje, { x: venstreMarg, y, size: 10.5, font });
    y -= 14;
  });

  return pdfDoc.save();
}

// ── Vektfordeling ────────────────────────────────────────────────────────

function vegvesenFmtKg(n) {
  const avrundet = Math.round(n * 100) / 100;
  return (Number.isInteger(avrundet) ? avrundet : avrundet.toFixed(2)).toString().replace('.', ',');
}
function vegvesenFmtM(n) { return n.toFixed(3).replace('.', ','); }

async function genVektfordelingPDF(o, P, P1, P2, M, M1, M2, geometri) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const BREDDE = 841.89, HOYDE = 595.28; // A4 liggende
  const page = pdfDoc.addPage([BREDDE, HOYDE]);
  // Samme fargepalett som i Henriks ekte referansedokumenter (Excel sitt
  // standard oransje/grønn/blå-tema for seksjonsoverskrifter og SANN/USANN-celler).
  const ORANSJE = rgb(1, 0.753, 0), GRONN_BG = rgb(0.573, 0.816, 0.314), BLA_BG = rgb(0, 0.690, 0.941);
  const ROD_BG = rgb(0.957, 0.502, 0.502);
  const sannTekst = v => v ? 'SANN' : 'USANN';
  const sannBg = v => v ? GRONN_BG : ROD_BG;

  const beregning = beregnVektfordeling(P, P1, P2, M, M1, M2, geometri);
  const { a, b, d } = geometri, c = beregning.c;

  // Tegner en fylt bakgrunnsstripe bak en rad med tekst (radhøyde ~11.5pt).
  function fylturRad(x, yTop, bredde, farge, hoyde = 11.5) {
    page.drawRectangle({ x, y: yTop - hoyde + 2.5, width: bredde, height: hoyde, color: farge });
  }

  const merkeModell = `${o.merke||''} ${o.modell||''}`.trim();
  let y = HOYDE - 40;
  const vX = 40, hX = 460;
  page.drawText(merkeModell, { x: vX, y, size: 13, font: fontBold }); y -= 16;
  [['Type:', o.type||''], ['Variant:', o.variant||''], ['Versjon:', o.versjon||''], ['Ch. nr.', o.chassis||'']].forEach(([lbl,val]) => {
    page.drawText(lbl, { x: vX, y, size: 9.5, font });
    page.drawText(val, { x: vX+65, y, size: 9.5, font });
    y -= 12;
  });
  y -= 10;

  fylturRad(vX, y+3, 355, ORANSJE, 15);
  page.drawText('Beregning av jevntfordelt last N1', { x: vX, y, size: 10.5, font: fontBold });
  page.drawText('2021/535, Section B', { x: vX+230, y, size: 10.5, font });
  y -= 16;
  page.drawText('Defenisjoner:', { x: vX, y, size: 9.5, font: fontBold });
  page.drawText('Verdi:', { x: vX+230, y, size: 9.5, font: fontBold });
  y -= 13;
  const defRader = [
    ['Teknisk tillatt totalvekt', 'P', vegvesenFmtKg(P), 'kg'],
    ['Teknisk tillatt totalvekt 1. aksel', 'P1', vegvesenFmtKg(P1), 'kg'],
    ['Teknisk tillatt totalvekt 2. aksel', 'P2', vegvesenFmtKg(P2), 'kg'],
    ['Masse i kjøreklar stand', 'M', vegvesenFmtKg(M), 'kg'],
    ['Masse i kjøreklar stand 1. aksel', 'M1', vegvesenFmtKg(M1), 'kg'],
    ['Masse i kjøreklar stand 2. aksel', 'M2', vegvesenFmtKg(M2), 'kg'],
    ['Antall passasjerer', 'n', '1,00', 'stk'],
    ['Akselavstand', 'a', vegvesenFmtM(a), 'm'],
    ['Avstand fra sete til senter foraksel', 'b', vegvesenFmtM(b), 'm'],
    ['Avstand fra lastens tyngdepunkt til senter foraksel', 'c', vegvesenFmtM(c), 'm'],
    ['', 'd', vegvesenFmtM(d), 'm']
  ];
  defRader.forEach(([navn,bokstav,verdi,enhet]) => {
    page.drawText(navn, { x: vX, y, size: 8.5, font });
    page.drawText(bokstav, { x: vX+200, y, size: 8.5, font });
    page.drawText(verdi, { x: vX+230, y, size: 8.5, font });
    page.drawText(enhet, { x: vX+275, y, size: 8.5, font });
    y -= 11.5;
  });
  y -= 8;

  fylturRad(vX, y+3, 355, ORANSJE);
  page.drawText('Beregnet verdi nyttelast i varerom for kjøretøyet', { x: vX, y, size: 9.5, font: fontBold });
  page.drawText('n', { x: vX+340, y, size: 9.5, font: fontBold });
  y -= 13.5;
  beregning.rader.forEach(r => {
    page.drawText(`Antall passasjerer "n" ${r.n}`, { x: vX, y, size: 8.5, font });
    page.drawText(vegvesenFmtKg(r.nyttelast) + ' kg', { x: vX+230, y, size: 8.5, font });
    y -= 11.5;
  });
  y -= 8;

  fylturRad(vX, y+3, 355, ORANSJE);
  page.drawText('Beregnet verdi "P1" på 1.aksel (framaksel)', { x: vX, y, size: 9.5, font: fontBold });
  page.drawText('n', { x: vX+230, y, size: 8.5, font: fontBold });
  page.drawText('Belastning', { x: vX+255, y, size: 8.5, font: fontBold });
  page.drawText('NA', { x: vX+330, y, size: 8.5, font: fontBold });
  page.drawText('Tilfredsstilt', { x: vX+360, y, size: 8.5, font: fontBold });
  y -= 13.5;
  beregning.rader.forEach(r => {
    page.drawText(`Antall passasjerer "n" ${r.n}`, { x: vX, y, size: 8.5, font });
    page.drawText(vegvesenFmtKg(r.front) + ' kg  <= ' + vegvesenFmtKg(beregning.frontMaks), { x: vX+230, y, size: 8.5, font });
    fylturRad(vX+360, y+3, 40, sannBg(r.frontOk));
    page.drawText(sannTekst(r.frontOk), { x: vX+362, y, size: 8.5, font: fontBold });
    y -= 11.5;
  });
  y -= 8;

  fylturRad(vX, y+3, 355, GRONN_BG);
  page.drawText('Beregnet verdi "P2" på 2.aksel (bakaksel)', { x: vX, y, size: 9.5, font: fontBold });
  page.drawText('n', { x: vX+230, y, size: 8.5, font: fontBold });
  y -= 13.5;
  beregning.rader.forEach(r => {
    page.drawText(`Antall passasjerer "n" ${r.n}`, { x: vX, y, size: 8.5, font });
    page.drawText(vegvesenFmtKg(r.bak) + ' kg  <= ' + vegvesenFmtKg(beregning.bakMaks), { x: vX+230, y, size: 8.5, font });
    fylturRad(vX+360, y+3, 40, sannBg(r.bakOk));
    page.drawText(sannTekst(r.bakOk), { x: vX+362, y, size: 8.5, font: fontBold });
    y -= 11.5;
  });

  // ── Høyre kolonne: gjenværende nyttelast (N1 2018/858, pk 3.6.1) + bildiagram ──
  let hy = HOYDE - 40;
  try {
    const diagramBytes = await vegvesenLastAsset('assets/vektfordeling-diagram.jpg');
    const diagramImg = await pdfDoc.embedJpg(diagramBytes);
    const diagramBredde = 280, diagramHoyde = diagramImg.height * (diagramBredde / diagramImg.width);
    page.drawImage(diagramImg, { x: hX + 60, y: hy - diagramHoyde, width: diagramBredde, height: diagramHoyde });
    hy -= diagramHoyde + 15;
  } catch (e) { console.error('Fant ikke bildiagram:', e.message); }

  const Kp = P, Km = M + 75, Kn = 1;
  fylturRad(hX, hy+3, 340, ORANSJE);
  page.drawText('Beregning av gjenværende nyttelast for N1 2018/858, pk 3.6.1', { x: hX, y: hy, size: 9, font: fontBold }); hy -= 16;
  [['Tillatt totalvekt', 'P', vegvesenFmtKg(Kp)+' kg'], ['Egenvekt inklusiv fører', 'M', vegvesenFmtKg(Km)+' kg'], ['Antall passasjerer', 'N', '1,00 Stk.']].forEach(([lbl,b_,v]) => {
    page.drawText(lbl, { x: hX, y: hy, size: 9, font });
    page.drawText(b_, { x: hX+190, y: hy, size: 9, font });
    page.drawText(v, { x: hX+215, y: hy, size: 9, font });
    hy -= 13;
  });
  hy -= 6;

  const metodeA_relevant = false; // N>0 -> alltid Urelevant (n er alltid 1 i malen)
  const vilkarA = Kp - Km >= 100;
  fylturRad(hX, hy+3, 340, ORANSJE, 38);
  page.drawText('Beregningsmetode a', { x: hX, y: hy, size: 9, font: fontBold });
  page.drawText(metodeA_relevant?'Relevant':'Urelevant', { x: hX+180, y: hy, size: 9, font }); hy -= 12;
  page.drawText('kun førerplass N=0', { x: hX, y: hy, size: 8, font }); hy -= 11;
  page.drawText('P-M>=100kg', { x: hX, y: hy, size: 8, font });
  page.drawText(sannTekst(vilkarA), { x: hX+180, y: hy, size: 8, font: fontBold }); hy -= 20;

  const metodeB_relevant = true; // N===1 -> alltid Relevant
  const vilkarB = (Kp - (Km + Kn*68)) >= 150;
  fylturRad(hX, hy+3, 340, GRONN_BG, 38);
  page.drawText('Beregnings metode b', { x: hX, y: hy, size: 9, font: fontBold });
  page.drawText(metodeB_relevant?'Relevant':'Urelevant', { x: hX+180, y: hy, size: 9, font }); hy -= 12;
  page.drawText('Antall sitteplasser (N) uten fører er 1 eller 2', { x: hX, y: hy, size: 8, font }); hy -= 11;
  page.drawText('P-(M+(Nx68))>=150kg', { x: hX, y: hy, size: 8, font });
  page.drawText(sannTekst(vilkarB), { x: hX+180, y: hy, size: 8, font: fontBold }); hy -= 20;

  const metodeC_relevant = false; // N===1 (ikke >2) -> alltid Urelevant
  const vilkarC = (Kp - (Km + Kn*68)) >= (Kn*68);
  fylturRad(hX, hy+3, 340, BLA_BG, 38);
  page.drawText('Beregnings metode c', { x: hX, y: hy, size: 9, font: fontBold });
  page.drawText(metodeC_relevant?'Relevant':'Urelevant', { x: hX+180, y: hy, size: 9, font }); hy -= 12;
  page.drawText('Antall sitteplasser (N) er mer enn 2. N>2', { x: hX, y: hy, size: 8, font }); hy -= 11;
  page.drawText('P-(M+(Nx68))>=Nx68', { x: hX, y: hy, size: 8, font });
  page.drawText(sannTekst(vilkarC), { x: hX+180, y: hy, size: 8, font: fontBold }); hy -= 26;

  page.drawText(vegvesenDatoNorsk(), { x: hX, y: hy, size: 9.5, font }); hy -= 40;
  const sigBytes = await vegvesenLastAsset('assets/signatur-jbs.png');
  const sigImg = await pdfDoc.embedPng(sigBytes);
  const sigBredde = 90, sigHoyde = sigImg.height * (sigBredde / sigImg.width);
  page.drawImage(sigImg, { x: hX-5, y: hy - sigHoyde + 16, width: sigBredde, height: sigHoyde });
  hy -= 4;
  ['Jan Børre Sigurdsen', 'Teknisk leder', 'Telemark Salmakerverksted'].forEach(linje => {
    page.drawText(linje, { x: hX, y: hy, size: 9.5, font });
    hy -= 12;
  });

  return { bytes: await pdfDoc.save(), beregning };
}

// ── Fabrikantattest ─────────────────────────────────────────────────────────

// De 9 kravradene er 100% fast tekst for denne modellen (samme krav/testrapport-numre
// på alle KIA EV9-ombygginger) - kun selve tallene i "Andre endringer" varierer per bil.
const FABRIKANTATTEST_KRAVRADER = [
  ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177', 'TÜV NORD'],
  ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2 og 6', 'No. 8124392177', 'TÜV NORD'],
  ['A2', 'Seterygger', 'FN-Reg. 17', 'Annex 7', 'No. 8124392177', 'TÜV NORD'],
  ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
  ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
  ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177', 'TÜV NORD'],
  ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 812439217', 'TÜV NORD'],
  ['Airbager i 2. seterad', '', '', 'Annex 5 og 6', 'No. 8124392177', 'TÜV NORD'],
  ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177 / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
];

async function genFabrikantattestPDF(o, endringP, endringVogntog, egenvektUt) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const ORANSJE = rgb(1, 0.753, 0);
  const SORT = rgb(0,0,0);

  const BREDDE = 595.28, HOYDE = 841.89; // A4 stående
  const page = pdfDoc.addPage([BREDDE, HOYDE]);
  const vX = 40, tabellBredde = 515;

  function ramme(x, y, bredde, hoyde) {
    page.drawRectangle({ x, y, width: bredde, height: hoyde, borderColor: SORT, borderWidth: 0.75 });
  }
  function tekstLinjer(x, yTop, linjer, storrelse=8.5, linjeHoyde=11) {
    linjer.forEach((l, i) => { if (l) page.drawText(l, { x, y: yTop - i*linjeHoyde, size: storrelse, font }); });
  }

  let y = HOYDE - 40;
  page.drawText('FABRIKANTATTEST', { x: vX, y, size: 13, font: fontBold });
  page.drawText(`${o.merke||''} ${o.modell||''}`.trim(), { x: vX+220, y, size: 13, font: fontBold });
  y -= 24;

  // Fabrikant 1 / Kjøretøyet / Typegodkjenning
  const kol1X = vX, kol2X = vX+175, kol3X = vX+350;
  page.drawText('FABRIKANT 1', { x: kol1X, y, size: 9, font: fontBold });
  page.drawText('KJØRETØYET', { x: kol2X, y, size: 9, font: fontBold });
  page.drawText('TYPEGODKJENNING', { x: kol3X, y, size: 9, font: fontBold });
  y -= 13;
  tekstLinjer(kol1X, y, ['KIA Coporation', '12, Heolleung-ro, Seocho-gu', 'Seoul', 'Korea']);
  tekstLinjer(kol2X, y, [`Type:  ${o.type||''}`, `Variant:  ${o.variant||''}`, `Versjon:  ${o.versjon||''}`, `Understellnummer:  ${o.chassis||''}`]);
  tekstLinjer(kol3X, y, [o.typegodkjenning || '']);
  y -= 4*11 + 10;

  page.drawText('FABRIKANT 2', { x: kol1X, y, size: 9, font: fontBold });
  page.drawText('KJØRETØYET', { x: kol2X, y, size: 9, font: fontBold });
  y -= 13;
  tekstLinjer(kol1X, y, ['Telemark Salmakerverksted', 'Bataljonvegen 25', '3734 SKIEN', 'Org. nr. 983 885 713 MVA']);
  tekstLinjer(kol2X, y, ['Konvertering fra M1 til N1']);
  y -= 4*11 + 14;

  // Krav-tabellen
  const kravKolBredder = [140, 90, 60, 125, 100];
  const kravKolX = [vX]; kravKolBredder.forEach(b => kravKolX.push(kravKolX[kravKolX.length-1]+b));
  const hodeHoyde = 13;
  page.drawRectangle({ x: vX, y: y-hodeHoyde+3, width: tabellBredde, height: hodeHoyde, color: ORANSJE });
  ['Kravområde','Kravnivå','Typegodkjenning','Testrapport','Utarbeidet av'].forEach((t,i) => {
    page.drawText(t, { x: kravKolX[i]+3, y: y-9, size: 8, font: fontBold });
  });
  y -= hodeHoyde;
  const kravRadHoyde = 26;
  FABRIKANTATTEST_KRAVRADER.forEach(([l1a,l1b,kravniva,testrapp,testnr,utarbeidet]) => {
    ramme(vX, y-kravRadHoyde, tabellBredde, kravRadHoyde);
    kravKolBredder.forEach((b,i) => { if (i>0) ramme(kravKolX[i], y-kravRadHoyde, 0.01, kravRadHoyde); });
    tekstLinjer(kravKolX[0]+3, y-9, [l1a, l1b], 8, 10);
    tekstLinjer(kravKolX[1]+3, y-9, [kravniva], 8, 10);
    tekstLinjer(kravKolX[2]+3, y-9, ['NEI'], 8, 10);
    tekstLinjer(kravKolX[3]+3, y-9, [testnr, testrapp], 8, 10);
    tekstLinjer(kravKolX[4]+3, y-9, [utarbeidet], 7.5, 10);
    y -= kravRadHoyde;
  });
  y -= 10;

  // "Andre endringer"-tabellen - Egenvekt/Tillatt totalvekt/Tillatt vogntogvekt/Karosserikode/
  // Antall sitteplasser/Varerommets lengde er fast tekst per modell, kun selve tallene varierer.
  const endrKolBredder = [140, 70, 70, 120, 115];
  const endrKolX = [vX]; endrKolBredder.forEach(b => endrKolX.push(endrKolX[endrKolX.length-1]+b));
  page.drawRectangle({ x: vX, y: y-hodeHoyde+3, width: tabellBredde, height: hodeHoyde, color: ORANSJE });
  ['Andre endringer','Inn','Ut','Testrapport','Utarbeidet av'].forEach((t,i) => {
    page.drawText(t, { x: endrKolX[i]+3, y: y-9, size: 8, font: fontBold });
  });
  y -= hodeHoyde;
  // Inn-verdiene for totalvekt/vogntogvekt hentes fra ordrens egen Vekter -> Ved ankomst
  // (IKKE et fast modell-tall) - bekreftet av Henrik 2026-09-14: "alt må hentes fra
  // vekter". Ut = Endring (samme kg trukket fra som i Vektfordeling, se endringP/endringVogntog).
  const innTotalvekt = parseFloat(String(o.vekter?.totalvekt?.a||'').replace(',','.')) || 0;
  const innVogntog = parseFloat(String(o.vekter?.vogntog?.a||'').replace(',','.')) || 0;
  const endrRader = [
    ['Egenvekt', vegvesenFmtKg(o.egenvektCoc||0)+'kg', vegvesenFmtKg(egenvektUt)+'kg', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
    ['Tillatt totalvekt', vegvesenFmtKg(innTotalvekt)+'kg', vegvesenFmtKg(endringP)+'kg', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Tillatt vogntogvekt', vegvesenFmtKg(innVogntog)+'kg', vegvesenFmtKg(endringVogntog)+'kg', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Karosserikode', 'AC', 'BB', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Antall sitteplasser', String(fabrikantattestSitteplasser(o)), '2', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Varerommets lengde', '-', '2120mm', 'Egenerklæring', 'Telemark Salmakerverksted']
  ];
  const endrRadHoyde = 13.5;
  endrRader.forEach(rad => {
    ramme(vX, y-endrRadHoyde, tabellBredde, endrRadHoyde);
    rad.forEach((verdi,i) => page.drawText(verdi, { x: endrKolX[i]+3, y: y-9.5, size: 8, font }));
    y -= endrRadHoyde;
  });
  y -= 14;

  page.drawText('Disse kravområdene bekreftes oppfylt i henhold til', { x: vX, y, size: 9, font }); y -= 12;
  page.drawText('Forskrift om godkjenning av bil og tilhenger til bil - FOR-2022-06-28-1233.', { x: vX, y, size: 9, font }); y -= 20;

  page.drawText('Særlig anmerkninger', { x: vX, y, size: 9.5, font: fontBold });
  page.drawLine({ start:{x:vX,y:y-2}, end:{x:vX+90,y:y-2}, thickness:0.5, color: SORT }); y -= 13;
  page.drawText('Det er gjort en endring på baksiden av seteryggene på framstolene', { x: vX, y, size: 9, font }); y -= 22;

  page.drawText(vegvesenDatoNorsk(), { x: vX, y, size: 9.5, font }); y -= 40;
  const sigBytes = await vegvesenLastAsset('assets/signatur-jbs.png');
  const sigImg = await pdfDoc.embedPng(sigBytes);
  const sigBredde = 90, sigHoyde = sigImg.height * (sigBredde / sigImg.width);
  page.drawImage(sigImg, { x: vX-5, y: y - sigHoyde + 16, width: sigBredde, height: sigHoyde });
  y -= 4;
  ['Jan Børre Sigurdsen', 'Teknisk leder', 'Telemark Salmakerverksted'].forEach(linje => {
    page.drawText(linje, { x: vX, y, size: 9.5, font });
    y -= 12;
  });

  return pdfDoc.save();
}

// ── Melding om registrering ──────────────────────────────────────────────
// I motsetning til de tre over er dette IKKE et Salmakerverksted-brevark, men det
// offisielle skjemaet fra Statens vegvesen selv (samme layout på alle ekte eksempler
// Henrik har delt) - derfor Vegvesen-logoen sentrert øverst i stedet for
// vegvesenTegnBrevhode(). Signaturen ligger inni selve underskrift-cellene i tabellen,
// IKKE nede ved navn/dato som på de andre dokumentene (bekreftet av Henrik 2026-09-14:
// "signaturen på alt utenom melding om registring skal signaturen være nede ved navn og
// dato" - dette dokumentet er det uttalte unntaket). Melder er alltid Telemark
// Salmakerverksted selv (fast org.nr/navn/signatur i alle ekte referanseeksempler), og
// Eier er forhandleren på ordren, signert av samme signatur på forhandlerens vegne i
// alle referanseeksemplene (også når det ikke er noen Fullmakt-kobling å sjekke mot).
function vegvesenFormaterOrgnr(v) {
  const siffer = String(v || '').replace(/\D/g, '');
  return siffer.length === 9 ? siffer.slice(0,3) + ' ' + siffer.slice(3,6) + ' ' + siffer.slice(6) : (v || '');
}
async function genMeldingOmRegistreringPDF(o) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const SORT = rgb(0,0,0), GRA = rgb(0.941,0.941,0.941), BLA = rgb(0.078,0.353,0.694);

  const BREDDE = 595.28, HOYDE = 841.89; // A4 stående
  const page = pdfDoc.addPage([BREDDE, HOYDE]);
  const vX = 40, tabellBredde = 515, labelBredde = 225, verdiBredde = tabellBredde - labelBredde;

  function ramme(x, y, bredde, hoyde, fyll) {
    if (fyll) page.drawRectangle({ x, y, width: bredde, height: hoyde, color: fyll });
    page.drawRectangle({ x, y, width: bredde, height: hoyde, borderColor: SORT, borderWidth: 0.75 });
  }
  // Tegner én tabellrad: labelLinjer (1-2 strenger) i venstre (grå) celle, og kaller
  // verdiTegn(x, y, bredde) for å fylle høyre celle - ulikt innhold per rad (vanlig
  // tekst, radioknapper, eller en signatur-bilde) uten å gjenta ramme-/posisjoneringskode.
  function rad(y, hoyde, labelLinjer, verdiTegn) {
    ramme(vX, y - hoyde, labelBredde, hoyde, GRA);
    ramme(vX + labelBredde, y - hoyde, verdiBredde, hoyde, null);
    const labelY = y - hoyde/2 + (labelLinjer.length===1 ? -3 : 4);
    labelLinjer.forEach((l,i) => page.drawText(l, { x: vX+8, y: labelY - i*11, size: 9, font: fontBold }));
    verdiTegn(vX + labelBredde + 10, y - hoyde/2 - 5, verdiBredde - 20);
    return y - hoyde;
  }

  let y = HOYDE - 40;
  const logoBytes = await vegvesenLastAsset('assets/statens-vegvesen-logo.png');
  const logoImg = await pdfDoc.embedPng(logoBytes);
  const logoBredde = 100, logoHoyde = logoImg.height * (logoBredde / logoImg.width);
  page.drawImage(logoImg, { x: (BREDDE - logoBredde)/2, y: y - logoHoyde, width: logoBredde, height: logoHoyde });
  y -= logoHoyde + 30;

  page.drawText('Melding om registrering', { x: vX, y, size: 14, font: fontBold }); y -= 22;

  const introBredde = tabellBredde;
  [
    'Skjemaet skal benyttes for å bekrefte melder og/eller kjøretøyeiers identitet (legitimering og signatur) ved førstegangsregistrering i Norge, jf. forskrift om bruk av kjøretøy § 2-5.',
    'Feltet for melder fylles ut av den som er ansvarlig for avgiften og melder kjøretøyet til registrering.'
  ].forEach(avsnitt => {
    vegvesenOmbrytTekst(avsnitt, font, 9.5, introBredde).forEach(linje => { page.drawText(linje, { x: vX, y, size: 9.5, font }); y -= 13; });
    y -= 6;
  });
  const forVegvesenLenke = 'Eierskapet kan enklest bekreftes digitalt via ';
  page.drawText(forVegvesenLenke, { x: vX, y, size: 9.5, font: fontBold });
  page.drawText('vegvesen.no', { x: vX + fontBold.widthOfTextAtSize(forVegvesenLenke, 9.5), y, size: 9.5, font: fontBold, color: BLA });
  y -= 24;

  // ── Kjøretøy ──
  y = rad(y, 22, ['Understellsnummer*'], (x,ty,w) => page.drawText(o.chassis||'', { x, y: ty, size: 14, font }));
  y = rad(y, 22, ['Merke*'], (x,ty,w) => page.drawText(o.merke||'KIA', { x, y: ty, size: 14, font }));
  y = rad(y, 22, ['Kjøretøygruppe*'], (x,ty,w) => page.drawText('N1', { x, y: ty, size: 14, font }));
  y = rad(y, 22, ['Farge på kjøretøy'], (x,ty,w) => page.drawText(o.farge||'', { x, y: ty, size: 14, font }));
  // Denne raden har et bredere label-felt (selve spørsmålet) og radioknappene helt til
  // høyre - egen layout i stedet for den vanlige rad()-hjelperen sin faste kolonnedeling.
  {
    const hoyde = 22;
    ramme(vX, y-hoyde, tabellBredde, hoyde, GRA);
    page.drawText('Skal registrering fullføres på trafikkstasjonen?', { x: vX+8, y: y-hoyde/2-3, size: 9, font: fontBold });
    const radioY = y - hoyde/2, neiX = vX + 360, jaX = vX + 430;
    page.drawText('Nei', { x: neiX, y: radioY-3, size: 9.5, font });
    page.drawCircle({ x: neiX+28, y: radioY+1, size: 5, borderColor: SORT, borderWidth: 0.75, color: SORT });
    page.drawText('Ja', { x: jaX, y: radioY-3, size: 9.5, font });
    page.drawCircle({ x: jaX+22, y: radioY+1, size: 5, borderColor: SORT, borderWidth: 0.75 });
    y -= hoyde;
  }
  y -= 18;

  const sigBytes = await vegvesenLastAsset('assets/signatur-jbs.png');
  const sigImg = await pdfDoc.embedPng(sigBytes);
  function tegnSignatur(x, ty, w) {
    const sigBredde = 85, sigHoyde = sigImg.height * (sigBredde / sigImg.width);
    page.drawImage(sigImg, { x, y: ty - sigHoyde/2 + 10, width: sigBredde, height: sigHoyde });
  }

  // ── Melder (alltid Telemark Salmakerverksted) ──
  y = rad(y, 24, ['Melders fødselsnummer/','organisasjonsnummer*'], (x,ty,w) => page.drawText('983 885 713', { x, y: ty-4, size: 14, font }));
  y = rad(y, 22, ['Navn på melder*'], (x,ty,w) => page.drawText('Telemark Salmakerverksted', { x, y: ty, size: 14, font }));
  y = rad(y, 48, ['Melders underskrift*','(Legitimasjon må fremvises)'], tegnSignatur);
  y -= 18;

  // ── Eier (forhandleren på ordren) ──
  y = rad(y, 24, ['fødselsnummer/','organisasjonsnummer eier*'], (x,ty,w) => page.drawText(vegvesenFormaterOrgnr(o.forhandlerOrgnr), { x, y: ty-4, size: 14, font }));
  y = rad(y, 22, ['Navn på eier*'], (x,ty,w) => page.drawText(o.kunde||'', { x, y: ty, size: 14, font }));
  y = rad(y, 48, ['Eiers underskrift*','(Legitimasjon må fremvises)'], tegnSignatur);
  y -= 18;

  // ── Medeier (aldri i bruk her - alltid tomt) ──
  y = rad(y, 24, ['fødselsnummer/','organisasjonsnummer medeier'], () => {});
  y = rad(y, 22, ['Navn på medeier'], () => {});
  y = rad(y, 24, ['Medeiers underskrift','(Legitimasjon må fremvises)'], () => {});
  y -= 20;

  page.drawText('Punkter/felter med * MÅ fylles ut, med mindre de er bekreftet digitalt.', { x: vX, y, size: 9, font: fontBold }); y -= 16;
  vegvesenOmbrytTekst('Punktene/feltene uten stjerne KAN fylles ut ved behov. Dersom kjøretøyet skal ha medeier, MÅ de nederste punktene/feltene fylles ut.', font, 9, introBredde)
    .forEach(linje => { page.drawText(linje, { x: vX, y, size: 9, font }); y -= 13; });

  return pdfDoc.save();
}

// ── Vektberegning + Endring-oppdatering ─────────────────────────────────────
// Kjører jevnt-fordelt-last-beregningen (P/P1/P2 fra Vekter->Ved ankomst,
// M/M1/M2 fra Vekter->Før visning), justerer totalvekt ned til den blir gyldig hvis
// nødvendig, og skriver resultatet til Endring-kolonnen under Vekter på ordren -
// disse 4 verdiene er det som siden brukes i Fabrikantattest sine Ut-felt og på
// trinn 2-lappen (spesifisert av Henrik 2026-09-14). Aksel 1/2 sin Endring er alltid
// lik Ved ankomst (aldri selv justert). Returnerer null hvis vektfelt mangler.
function vegvesenBeregnOgSettEndring(o) {
  const geometri = vegvesenGeometri(o.merke, o.modell);
  if (!geometri) return null;
  const tall = v => parseFloat(String(v||'').replace(',','.')) || 0;
  const P = tall(o.vekter?.totalvekt?.a), P1 = tall(o.vekter?.foraksel?.a), P2 = tall(o.vekter?.bakaksel?.a);
  const M = tall(o.vekter?.totalvekt?.v), M1 = tall(o.vekter?.foraksel?.v), M2 = tall(o.vekter?.bakaksel?.v);
  const vogntogVedAnkomst = tall(o.vekter?.vogntog?.a);
  if (!P || !P1 || !P2 || !M || !M1 || !M2) return null;

  const justertP = finnJustertTotalvekt(P, P1, P2, M, M1, M2, geometri);
  const delta = P - justertP;
  const justertVogntog = vogntogVedAnkomst - delta;
  const beregning = beregnVektfordeling(justertP, P1, P2, M, M1, M2, geometri);

  o.vekter.totalvekt.e = String(justertP);
  o.vekter.vogntog.e = String(justertVogntog);
  o.vekter.foraksel.e = String(P1);
  o.vekter.bakaksel.e = String(P2);
  logChange(o, 'Vektfordeling beregnet' + (delta>0 ? ` - totalvekt justert ned ${delta} kg` : ''));
  save(o.id);

  return { geometri, P, P1, P2, M, M1, M2, justertP, justertVogntog, beregning };
}

// ── Lagring i ordrens dokument-mappe ────────────────────────────────────────
// Samme lagringsmekanikk (bucket, samme-filnavn-erstatter-forrige-versjon) som
// lastOppDokument() i ordre-diverse.js bruker for manuelt opplastede filer - her bare
// fra genererte PDF-byte i stedet for en fil valgt i en input.
async function vegvesenLagreGenerertDokument(ordreId, filnavn, pdfBytes) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  if (!db) { visToast('Ikke koblet til Supabase'); return; }
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const tryggNavn = filnavn.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9.\-]/g, '_');
  const lagringsnavn = `${ordreId}/${Date.now()}_${tryggNavn}`;
  const { error } = await db.storage.from('ordre-dokumenter').upload(lagringsnavn, blob, { contentType: 'application/pdf', cacheControl: '31536000' });
  if (error) { visToast('Feil ved lagring av ' + filnavn + ': ' + error.message); return; }
  const { data } = db.storage.from('ordre-dokumenter').getPublicUrl(lagringsnavn);
  o.dokumenter = o.dokumenter || [];
  const gammelIdx = o.dokumenter.findIndex(d => d.navn === filnavn);
  const nyttDok = { navn: filnavn, url: data.publicUrl, lastetOppAv: me?.navn || 'Automatisk', dato: new Date().toISOString() };
  if (gammelIdx !== -1) {
    const gammel = o.dokumenter[gammelIdx];
    const gammeltFilnavn = gammel.url.split('/ordre-dokumenter/')[1];
    if (gammeltFilnavn) await db.storage.from('ordre-dokumenter').remove([gammeltFilnavn]);
    o.dokumenter[gammelIdx] = nyttDok;
    o.dokumenter = [...o.dokumenter];
    logChange(o, 'Erstattet dokument med ny versjon: ' + filnavn);
  } else {
    o.dokumenter = [...o.dokumenter, nyttDok];
    logChange(o, 'Generert dokument: ' + filnavn);
  }
  db.from('ordrer').update({ dokumenter: o.dokumenter }).eq('id', ordreId)
    .then(r => { if (r.error) console.error('Dokument-oppdatering feilet:', r.error.message); });
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
  const listEl = document.getElementById('dokumenterListe_' + ordreId);
  if (listEl) listEl.innerHTML = dokumenterListeHTML(o);
}

// Alle genererte dokumentnavn følger mønsteret "<Dokumenttype>-<chassis>.pdf".
function vegvesenFilnavn(dokumenttype, chassis) {
  return `${dokumenttype}-${chassis || 'UKJENT'}.pdf`;
}

// Manuell test-utløser mens funksjonene bygges ut én etter én - den automatiske
// "genereres når ordren veies"-koblingen kommer når alle seks er ferdige og bekreftet.
// Genererer foreløpig Egenerklæring, Vektfordeling, Fabrikantattest og Melding om
// registrering (trinn 2-lapp og Kjøretøyliste gjenstår).
async function genererVegvesenDokumenter(ordreId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  const geometri = vegvesenGeometri(o.merke, o.modell);
  if (!geometri) { visToast('Ingen mal/geometri lagt inn for ' + (o.merke||'?') + ' ' + (o.modell||'?') + ' ennå'); return; }
  visToast('Genererer dokumenter...', 'ok');
  try {
    const egenerklaeringBytes = await genEgenerklaeringPDF(o);
    await vegvesenLagreGenerertDokument(ordreId, vegvesenFilnavn('Egenerklæring', o.chassis), egenerklaeringBytes);

    // Uavhengig av vektberegningen under - trenger kun ordrens egne stamdata.
    const meldingBytes = await genMeldingOmRegistreringPDF(o);
    await vegvesenLagreGenerertDokument(ordreId, vegvesenFilnavn('Melding om registrering', o.chassis), meldingBytes);

    const resultat = vegvesenBeregnOgSettEndring(o);
    if (!resultat) {
      visToast('Egenerklæring og Melding om registrering generert. Mangler Vekter (Ved ankomst/Før visning) for Vektfordeling/Fabrikantattest.', 'ok');
      return;
    }
    const { P1, P2, M, M1, M2, justertP, justertVogntog, geometri: geom } = resultat;
    const { bytes: vektfordelingBytes } = await genVektfordelingPDF(o, justertP, P1, P2, M, M1, M2, geom);
    await vegvesenLagreGenerertDokument(ordreId, vegvesenFilnavn('Vektfordeling', o.chassis), vektfordelingBytes);

    const fabrikantattestBytes = await genFabrikantattestPDF(o, justertP, justertVogntog, M);
    await vegvesenLagreGenerertDokument(ordreId, vegvesenFilnavn('Fabrikantattest', o.chassis), fabrikantattestBytes);

    visToast('Egenerklæring, Vektfordeling, Fabrikantattest og Melding om registrering generert og lagret', 'ok');
  } catch (e) {
    console.error('Feil ved generering av Vegvesen-dokumenter:', e);
    visToast('Feil ved generering: ' + e.message);
  }
}
