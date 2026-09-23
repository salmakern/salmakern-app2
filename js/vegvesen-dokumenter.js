// ════════════════════════════════════════════════════
// VEGVESEN-DOKUMENTER — automatisk generering av Egenerklæring, Vektfordeling,
// Fabrikantattest, Kjøretøyliste og Melding om registrering (trinn 2-lapp gjenstår).
// Kun for ordre med o.ombygging.nyttKjoretoy=true, og kun for modeller det finnes
// mal + geometri for (se VEGVESEN_MODELLER under). Når ordren er del av en flåte
// (se vegvesenFlateKontext) deles Egenerklæring/Vektfordeling/Fabrikantattest/Melding
// om registrering for hele flåten i stedet for én per bil, og Kjøretøyliste genereres
// i tillegg med det faktiske chassisnummeret for hver bil (bekreftet av Henrik
// 2026-09-21).
// ════════════════════════════════════════════════════

// Per-modell data for Vegvesen-dokumentene - lagt inn etter hvert som Henrik gir
// ekte referansedokumenter for hver modell (se salmakern-app/Dokumenter til ordrer/).
// Alt under (geometri, produsentadresse, krav-rader, særlig anmerkning) er hentet
// direkte fra disse referansedokumentene 2026-09-18 - IKKE gjettet/interpolert.
// Toyota Land Cruiser 250 mangler fortsatt referansedokumenter (tomme mapper) og er
// derfor ikke med ennå.
//
// geometri: {a,b,d,cOffset} - a=akselavstand, b=avstand sete-foraksel, d=varerommets
// lengde (m), cOffset=konstanten i c = d/2 + cOffset (VARIERER per modell - bekreftet
// ved å lese selve Excel-formelen i hvert referanseark, IKKE en universell EU-konstant
// slik det først så ut fra KIA EV9 alene).
//
// kravRader: samme 6-kolonners form som før: [kravLinje1, kravLinje2, kravnivå,
// testrapport, testnr/kilde, utarbeidetAv] - alle modellers krav-tabeller er hentet
// rad for rad fra deres egne Fabrikantattest-referanseark.
//
// Land Rover-familien (Defender/Discovery 5) har en ekstra teknisk operasjon (bytte av
// støtdempertårn) som ikke finnes i noen andre modellers tekst, og avslutter
// skilleveggsetningen uten "tak"-prefikset på braketten - gjengitt eksakt fra
// referansedokumentene (Defender 110 og Discovery 5 sine tekster er ord-for-ord like).
function egenerklaeringAvsnittLandRover(chassis, merkeModell) {
  return [
    `Ombyggingen gjelder en ${merkeModell}, ${chassis}.`,
    'Telemark Salmakerverksted, påbyggerverksted 31067, bekrefter herved at ombyggingen av denne bilen tilfredsstiller de krav som er beskrevet i Bilforskriften, og at det ikke er laget nye fester eller gjort inngrep i bilens karosseri ved monteringen av innredningen. Det er kun tatt i bruk originale fester.',
    'I forbindelse med ombygging av denne bilen blir andre og eventuelt tredje seterad, med tilhørende braketter og deksler demontert og fjernet. Sikkerhetsbelter blir løsnet i endefestene som er synlig i bilen, men selve belterullen blir stående. Så foldes beltestroppen sammen og en skumplast blir lagt rundt for å beskytte mot skader, så legges disse bak sidepanelene. Så blir de originale støtdempertårnene byttet ut med egentilvirkede støtdempertårn. Deretter blir støttebraketter montert i gulvet, og disse blir festet ved bruk av originale skruer og i de originale festene i gulvet. Så monteres to gulvplater på disse brakettene med nagler. Skilleveggen blir montert i framkant av gulvplaten med skruer og nagler, og i egne braketter som festes i de originale festene til håndtakene i taket.',
    'Bilen er vist med taktrekk, men uten et uoriginalt teppe som blir lagt løst inn i bilen etter godkjenning. Dette teppe må fjernes dersom «statskassen» skal plasseres i bilen på et senere tidspunkt. Takbrakettenes mål kan kontrolleres på vedlagt tegning dersom det er mistanke om at det er gjort endinger på disse. Når vi fremviser denne bilen så bruker vi beskyttelser i hjørnene på statskassen, og det er derfor viktig at det vises aktsomhet dersom denne skal plasseres på en senere kontroll slik at ikke taktrekket skades unødvendig.',
    'Beregning av jevnt fordelt last er gjort i henhold til direktiv 2021/535, Section B.',
    'Bilen er merket med merkeplate for trinn 2 påbygger i henhold til direktiv 2021/535.',
    'Se vedlagt Fabrikantattest for dokumentasjon av krav og endringer gjort på kjøretøyet.',
    'All vedlagt dokumentasjon inkludert denne egenerklæringen er som forretningshemmeligheter å regne og skal ikke utleveres til andre aktører.'
  ];
}
// Mercedes-familien (Geländewagen/GLS) - generisk tekst uten klimakanal-setningen
// (bekreftet bevisst av Henrik 2026-09-18: Mercedes-modellene har ingen slike
// takkanaler å fjerne), gjengitt fra GLS/Geländewagen sine referansedokumenter.
function egenerklaeringAvsnittMercedes(chassis, merkeModell) {
  return [
    `Ombyggingen gjelder en ${merkeModell}, ${chassis}.`,
    'Telemark Salmakerverksted, påbyggerverksted 31067, bekrefter herved at ombyggingen av denne bilen tilfredsstiller de krav som er beskrevet i Bilforskriften. Det er ikke laget nye fester eller gjort inngrep i bilens karosseri ved monteringen av innredningen, da det her kun er tatt i bruk originale fester.',
    'I forbindelse med ombygging av denne bilen blir andre og tredje seteradene, med tilhørende braketter og deksler demontert og fjernet. Sikkerhetsbelter blir løsnet i endefestene som er synlig i bilen, men selve belterullen blir stående. Så foldes beltestroppen sammen og en skumplast blir lagt rundt for å beskytte mot skader, og så legges disse bak sidepanelene. Deretter blir støttebraketter montert i gulvet, og disse blir festet ved bruk av originale skruer og i de originale festene i gulvet. Så monteres gulvplaten på disse brakettene med nagler. Skilleveggen blir montert i framkant av gulvplaten med skruer og nagler, og i egne braketter som festes i originale fester i taket.',
    'Bilen er vist med taktrekk, men uten et uoriginalt teppe som legges løst inn etter godkjenning. Dette må fjernes dersom «statskassen» skal plasseres i bilen på et senere tidspunkt. Takbrakettenes mål kan kontrolleres på vedlagt tegning dersom det er mistanke om at det er gjort endinger på disse. Når vi fremviser denne bilen så bruker vi beskyttelser i hjørnene på «statskassen», og det er derfor viktig at det vises aktsomhet dersom denne skal plasseres på en senere kontroll slik at ikke taktrekket skades unødvendig.',
    'Beregning av jevnt fordelt last er gjort i henhold til direktiv 2021/535, Seksjon B.',
    'Bilen er merket med merkeplate for trinn 2 påbygger i henhold til direktiv 2021/535.',
    'Se vedlagt Fabrikantattest for dokumentasjon av krav og endringer gjort på kjøretøyet.',
    'All vedlagt dokumentasjon inkludert denne egenerklæringen er som forretningshemmeligheter å regne og skal ikke utleveres til andre aktører.'
  ];
}
// KGM Rexton - vesentlig avvikende fra alle andre (bekrefter et fysisk inngrep i
// karosseriet gjort av et eksternt skadeverksted, kun andre seterad fjernes (ikke
// tredje), og et eget avsnitt om at original sete-/beltefester ikke er rørt slik at
// bilen kan bygges tilbake til personbil senere) - gjengitt fra Rexton sitt eget
// referansedokument, IKKE forenklet til en av de andre malene.
function egenerklaeringAvsnittRexton(chassis, merkeModell) {
  return [
    `Ombyggingen gjelder en ${merkeModell}, ${chassis}.`,
    'Telemark Salmakerverksted, påbyggerverksted nr. 31067, bekrefter herved at ombyggingen av denne bilen tilfredsstiller de krav som er beskrevet i Bilforskriften. Det er under ombyggingen til varebil klasse 2 av denne bilen blitt gjort et inngrep i bilens karosseri, se vedlagt dokumentasjon. Det er ikke laget nye fester eller gjort andre inngrep i bilens karosseri ved monteringen av den resterende innredningen, da det her kun er tatt i bruk originale fester.',
    'I forbindelse med den resterende ombygging av denne bilen blir andre seteraden med tilhørende braketter og deksler fjernet. Sikkerhetsbelter blir løsnet i endefestene som er synlig i bilen, men selve belterullen blir stående. Så foldes beltestroppen sammen og en skumplast blir lagt rundt for å beskytte mot skader, og så legges disse bak sidepanelene. Deretter blir støttebraketter montert i gulvet og disse blir festet ved bruk av originale skruer i de originale festene i gulvet, eller med montasje lim. Så monteres gulvplaten på disse brakettene med nagler. Skilleveggen blir montert i framkant av gulvplaten med skruer, og i egne takbraketter som festes i de originale festene til håndtakene i taket.',
    'Bilen er vist med taktrekk, men uten et uoriginalt teppe og en skumsats. Teppe og skumsatsen er lagt løst inn i bilen etter godkjenning, og disse må fjernes dersom «statskassen» skal plasseres i bilen på et senere tidspunkt. Takbrakettenes mål kan kontrolleres på vedlagt tegning dersom det er mistanke om at det er gjort endinger på disse. Når vi fremviser denne bilen så bruker vi beskyttelser i hjørnene på «statskassen», og det er derfor viktig at det vises aktsomhet dersom denne skal plasseres på en senere kontroll slik at ikke taktrekket skades unødvendig.',
    'Inngrepet på karosseriet er gjort av Star Bilskade, skadeverksted 02 nr. 4835. Dokumentasjonen på dette ligger vedlagt. Det er ikke airbager i 2. seteraden på denne bilen.',
    'Beregning av jevnt fordelt last er gjort i henhold til direktiv 2021/535, Section B.',
    'Bilen er merket med fabrikasjonsplate for trinn 2 påbygger i henhold til direktiv 2021/535.',
    'Se vedlagt Fabrikantattest for dokumentasjon av krav og endringer gjort på kjøretøyet.',
    'Det er ikke gjort endringer på de originale festene til setene og sikkerhetsbeltene, slik at endringen ikke påvirker ombyggingen tilbake til personbil på et senere tidspunkt.',
    'All vedlagt dokumentasjon inkludert denne egenerklæringen er som forretningshemmeligheter å regne og skal ikke utleveres til andre aktører.'
  ];
}

const VEGVESEN_MODELLER = [
  {
    match: /\bev9\b/i, navn: 'KIA EV9',
    geometri: { a: 3.100, b: 1.480, d: 2.120, cOffset: 1.75 },
    fabrikant1: { navn: 'KIA Coporation', adresse: ['12, Heolleung-ro, Seocho-gu', 'Seoul', 'Korea'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2 og 6', 'No. 8124392177', 'TÜV NORD'],
      ['A2', 'Seterygger', 'FN-Reg. 17', 'Annex 7', 'No. 8124392177', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 812439217', 'TÜV NORD'],
      ['Airbager i 2. seterad', '', '', 'Annex 5 og 6', 'No. 8124392177', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177 / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    saerligAnmerkning: 'Det er gjort en endring på baksiden av seteryggene på framstolene',
    antallSitteplasser: o => ({ inn: String(fabrikantattestSitteplasser(o)), ut: '2' }),
    // egenerklaeringAvsnitt() er definert lenger ned i filen (Standard/Panorama-varianten
    // som allerede fantes for KIA EV9 - urørt) - function-deklarasjoner heises, så det er
    // trygt å referere til den herfra.
    egenerklaering: (chassis, merkeModell, variant) => egenerklaeringAvsnitt(variant, chassis, merkeModell)
  },
  {
    match: /\brexton\b/i, navn: 'KGM Rexton',
    geometri: { a: 2.865, b: 1.430, d: 2.061, cOffset: 1.75 },
    fabrikant1: { navn: 'KGM Mobility Corp.', adresse: ['455-12, Dongsak-ro, Pyeongtaek-21', 'Gyeonggi-do', 'Korea'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8123999128-YK', 'TÜV NORD'],
      ['C7', 'Stabilitetskontroll', 'FN-Reg. 13-H / FN-Reg. 140', 'Annex 2', 'No. 8123999128-YK', 'TÜV NORD'],
      ['G1', 'Støynivå', 'FN-Reg. 51', 'Annex 3', 'No. 8123999128-YK', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 4', 'No. 8123999128-YK', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 5', 'No. 8123999128-YK', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8123999128-YK / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted'],
      ['Airbager i 2. seterad', '', '', 'Egenerklæring', '', 'Telemark Salmakerverksted']
    ],
    saerligAnmerkning: 'Bakre eksosanlegg er merket med delenummer: TS 2430036411',
    antallSitteplasser: () => ({ inn: '5', ut: '2' }),
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnittRexton(chassis, merkeModell)
  },
  {
    match: /defender\b/i, navn: 'Land Rover Defender',
    geometri: { a: 3.022, b: 1.600, d: 1.600, cOffset: 1.94 },
    fabrikant1: { navn: 'Jaguar Land Rover Ireland Ltd', adresse: ['Abbey Road Whitley', 'Coventry CV3 4LF', 'United Kingdom'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177-LE', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2', 'No. 8124392177-LE', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177-LE', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 8124392177-LE', 'TÜV NORD'],
      ['Støtdempertårn', '', '', 'Annex 5 og 6 / 7 og 8', 'No. 8124392177-LE', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177-LE / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    saerligAnmerkning: 'Støtdempertårn er merket med delenummer: TS 095866/034244 L/R',
    antallSitteplasser: () => ({ inn: '5/6/7', ut: '2/3' }),
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnittLandRover(chassis, merkeModell)
  },
  {
    match: /discovery\s*5\b/i, navn: 'Land Rover Discovery 5',
    geometri: { a: 2.923, b: 1.550, d: 1.860, cOffset: 1.97 },
    fabrikant1: { navn: 'Jaguar Land Rover Ireland Ltd', adresse: ['Abbey Road Whitley', 'Coventry CV3 4LF', 'United Kingdom'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177-LR', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2', 'No. 8124392177-LR', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177-LR', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 8124392177-LR', 'TÜV NORD'],
      ['Støtdempertårn', '', '', 'Annex 5 og 6 / 7 og 8', 'No. 8124392177-LE', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177-LE / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    saerligAnmerkning: 'Støtdempertårn er merket med delenummer: TS 095866/034244 L/R',
    antallSitteplasser: () => ({ inn: '5/7', ut: '2' }),
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnittLandRover(chassis, merkeModell)
  },
  {
    match: /\bgls\b/i, navn: 'Mercedes-Benz GLS',
    geometri: { a: 3.135, b: 1.510, d: 2.080, cOffset: 1.88 },
    fabrikant1: { navn: 'Mercedes-Benz AG', adresse: ['DE-70372 Stuttgart', 'Germany'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177_M-GLS', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2 og 6', 'No. 8124392177_M-GLS', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177_M-GLS', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 8124392177_M-GLS', 'TÜV NORD'],
      ['Airbager i 2. seterad', '', '', 'Annex 5 og 6', 'No. 8124392177_M-GLS', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177_M-GLS / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    saerligAnmerkning: null,
    antallSitteplasser: () => ({ inn: '7', ut: '2' }),
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnittMercedes(chassis, merkeModell)
  },
  {
    match: /gel[aä]ndewagen/i, navn: 'Mercedes-Benz Geländewagen',
    geometri: { a: 2.890, b: 1.490, d: 1.620, cOffset: 1.87 },
    fabrikant1: { navn: 'Mercedes-Benz AG', adresse: ['DE-70372 Stuttgart', 'Germany'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177_M-G', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2 og 6', 'No. 8124392177_M-G', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177_M-G', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 8124392177_M-G', 'TÜV NORD'],
      ['Airbager i 2. seterad', '', '', 'Annex 5 og 6', 'No. 8124392177_M-G', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177_M-G / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    saerligAnmerkning: null,
    antallSitteplasser: () => ({ inn: '5', ut: '2' }),
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnittMercedes(chassis, merkeModell)
  },
  {
    match: /id\.?\s*buzz/i, navn: 'Volkswagen ID.Buzz',
    geometri: { a: 3.239, b: 1.180, d: 2.416, cOffset: 1.55 },
    fabrikant1: { navn: 'Volkswagen AG', adresse: ['Berliner Ring 2', '38 440 Wolfsburg', 'Germany'] },
    kravRader: [
      ['A25', 'Sidekollisjon', 'FN-Reg. 95', 'Annex 1', 'No. 8124392177-EB', 'TÜV NORD'],
      ['A6', 'Bilbeltevarslere', 'FN-Reg. 16', 'Annex 2', 'No. 8124392177-EB', 'TÜV NORD'],
      ['F7', 'Fabrikasjonsplate', 'EU 2021/535', 'Seksjon B', 'Egenerklæring', 'Telemark Salmakerverksted'],
      ['F11', 'Masser og dimensjoner', 'EU 2021/535', 'Seksjon B', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
      ['Skilleveggens styrke', '', 'EU 2018/858', 'Punkt 3.4.2 / Annex 3', 'No. 8124392177-EB', 'TÜV NORD'],
      ['Sideairbagers konflikt', 'med skilleveggen', 'Forskrift om engangsavgift', 'Annex 4', 'No. 8124392177-EB', 'TÜV NORD'],
      ['Konvertering fra', 'M1 til N1', '', 'No. 8124392177-EB / Egenerklæring', '', 'TÜV NORD / Telemark Salmakerverksted']
    ],
    // Henrik 2026-09-18: referansedokumentet for ID.Buzz var et ufullstendig utkast
    // (motsatt betydning på teppe-setningen, manglet hele avsnitt) - bruk derfor samme
    // fulle standardmal som KIA/Mercedes i stedet for å gjenskape utkastet.
    saerligAnmerkning: null,
    antallSitteplasser: () => ({ inn: '7', ut: '2' }),
    // Henrik 2026-09-18: bruk samme fulle "standard"-tekst som KIA EV9 (inkl.
    // klimakanal-setningen) - ingen egen Panorama-variant for VW.
    egenerklaering: (chassis, merkeModell) => egenerklaeringAvsnitt('standard', chassis, merkeModell)
  }
];
function vegvesenFinnModell(merke, modell) {
  const tekst = `${merke || ''} ${modell || ''}`.trim();
  return VEGVESEN_MODELLER.find(m => m.match.test(tekst)) || null;
}
function vegvesenGeometri(merke, modell) {
  const m = vegvesenFinnModell(merke, modell);
  return m ? m.geometri : null;
}

// Selve jevnt-fordelt-last-beregningen (EU 2021/535, Section B / N1 2018/858 pk 3.6.1) -
// gjenskaper formlene fra Telemark Salmakerverksted sitt eget Vektfordeling-regneark.
// P/P1/P2 = Teknisk tillatt totalvekt/aksel 1/aksel 2 (fra Vekter -> Ved ankomst).
// M/M1/M2 = Masse i kjøreklar stand totalt/aksel 1/aksel 2 (fra Vekter -> Før visning).
// geometri = {a: akselavstand, b: avstand sete-foraksel, d: lengde lasterom, cOffset}.
// cOffset (konstanten i c = d/2 + cOffset) er IKKE en universell EU-konstant slik det
// først så ut fra KIA EV9 alene - bekreftet ved å lese Excel-formelen i hvert
// referanseark, og den varierer reelt per modell (1.55-1.97) - se VEGVESEN_MODELLER.
function beregnVektfordeling(P, P1, P2, M, M1, M2, geometri) {
  const { a, b, d, cOffset } = geometri;
  const c = d / 2 + cOffset;
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
  const { a, b, d, cOffset } = geometri;
  const c = d / 2 + cOffset;
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

  // Hver modell(-familie) har sin egen, reelt forskjellige avsnitt-tekst (ikke bare
  // modellnavn byttet ut - bekreftet ved å lese ekte referansedokumenter for hver
  // modell 2026-09-18) - se VEGVESEN_MODELLER. Faller tilbake til KIA sin mal hvis
  // ingen modell er funnet (skal ikke skje i praksis, siden genererVegvesenDokumenter
  // allerede sjekker dette før noe genereres).
  const vegvesenModell = vegvesenFinnModell(o.merke, o.modell);
  const avsnitt = vegvesenModell
    ? vegvesenModell.egenerklaering(o.chassis || '', merkeModell, variant)
    : egenerklaeringAvsnitt(variant, o.chassis || '', merkeModell);
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

async function genFabrikantattestPDF(o, endringP, endringVogntog, egenvektUt) {
  const vegvesenModell = vegvesenFinnModell(o.merke, o.modell);
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
  tekstLinjer(kol1X, y, [vegvesenModell.fabrikant1.navn, ...vegvesenModell.fabrikant1.adresse]);
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
  vegvesenModell.kravRader.forEach(([l1a,l1b,kravniva,testrapp,testnr,utarbeidet]) => {
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
  const sitteplasser = vegvesenModell.antallSitteplasser(o);
  const varerommetUtMm = Math.round(vegvesenModell.geometri.d * 1000) + 'mm';
  const endrRader = [
    ['Egenvekt', vegvesenFmtKg(o.egenvektCoc||0)+'kg', vegvesenFmtKg(egenvektUt)+'kg', 'Vektfordelingsskjema', 'Telemark Salmakerverksted'],
    ['Tillatt totalvekt', vegvesenFmtKg(innTotalvekt)+'kg', vegvesenFmtKg(endringP)+'kg', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Tillatt vogntogvekt', vegvesenFmtKg(innVogntog)+'kg', vegvesenFmtKg(endringVogntog)+'kg', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Karosserikode', 'AC', 'BB', 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Antall sitteplasser', sitteplasser.inn, sitteplasser.ut, 'Egenerklæring', 'Telemark Salmakerverksted'],
    ['Varerommets lengde', '-', varerommetUtMm, 'Egenerklæring', 'Telemark Salmakerverksted']
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

  if (vegvesenModell.saerligAnmerkning) {
    page.drawText('Særlig anmerkninger', { x: vX, y, size: 9.5, font: fontBold });
    page.drawLine({ start:{x:vX,y:y-2}, end:{x:vX+90,y:y-2}, thickness:0.5, color: SORT }); y -= 13;
    page.drawText(vegvesenModell.saerligAnmerkning, { x: vX, y, size: 9, font }); y -= 22;
  } else {
    y -= 14;
  }

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
  y = rad(y, 22, ['Merke*'], (x,ty,w) => page.drawText(o.merke||'', { x, y: ty, size: 14, font }));
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

// ── Kjøretøyliste ────────────────────────────────────────────────────────────
// Kun generert når ordren er del av en flåte (se vegvesenFlateKontext) - siden alle
// biler i en flåte er samme modell, deles Egenerklæring/Vektfordeling/Fabrikantattest/
// Melding om registrering for hele flåten i stedet for én per bil (bekreftet av Henrik
// 2026-09-21), med "Se kjøretøyliste" i stedet for et enkelt chassisnummer der. Denne
// lista er stedet det faktiske chassisnummeret for hver bil i flåten står.
async function genKjoretoylistePDF(flate, primaer, medlemmer) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await vegvesenLastAsset('logoer/SALMAKERN LOGOFORSLAG NY.png');
  const logoImg = await pdfDoc.embedPng(logoBytes);

  const BREDDE = 595.28, HOYDE = 841.89; // A4 stående
  const page = pdfDoc.addPage([BREDDE, HOYDE]);
  const venstreMarg = 40;

  let y = await vegvesenTegnBrevhode(page, font, fontBold, logoImg, BREDDE, HOYDE - 40);

  const merkeModell = `${primaer.merke||''} ${primaer.modell||''}`.trim();
  page.drawText('KJØRETØYLISTE', { x: venstreMarg, y, size: 12, font: fontBold });
  y -= 18;
  page.drawText(`${merkeModell} — Flåte ${flate.flatenummer||''}`, { x: venstreMarg, y, size: 10.5, font });
  y -= 28;

  const kolX = [venstreMarg, venstreMarg+180, venstreMarg+360];
  function seksjonshode(tittel) {
    page.drawText(tittel, { x: venstreMarg, y, size: 10.5, font: fontBold });
    y -= 15;
    ['Chassis-nr', 'Forhandler', 'Org.nr'].forEach((t,i) => page.drawText(t, { x: kolX[i], y, size: 8.5, font: fontBold }));
    y -= 12;
  }
  function kjoretoyRad(m) {
    page.drawText(m.chassis||'', { x: kolX[0], y, size: 9.5, font });
    page.drawText(m.kunde||'', { x: kolX[1], y, size: 9.5, font });
    page.drawText(vegvesenFormaterOrgnr(m.forhandlerOrgnr), { x: kolX[2], y, size: 9.5, font });
    y -= 14;
  }

  seksjonshode('Primærkjøretøy');
  kjoretoyRad(primaer);
  y -= 12;

  const sekundaere = medlemmer.filter(m => m.id !== primaer.id);
  seksjonshode('Sekundærkjøretøy');
  if (sekundaere.length) sekundaere.forEach(kjoretoyRad);
  else { page.drawText('Ingen', { x: kolX[0], y, size: 9.5, font }); y -= 14; }

  y -= 20;
  page.drawText(vegvesenDatoNorsk(), { x: venstreMarg, y, size: 10.5, font });
  y -= 45;
  const sigBytes = await vegvesenLastAsset('assets/signatur-jbs.png');
  const sigImg = await pdfDoc.embedPng(sigBytes);
  const sigBredde = 110, sigHoyde = sigImg.height * (sigBredde / sigImg.width);
  page.drawImage(sigImg, { x: venstreMarg - 5, y: y - sigHoyde + 20, width: sigBredde, height: sigHoyde });
  y -= 5;
  ['Jan Børre Sigurdsen', 'Teknisk leder', 'Telemark Salmakerverksted'].forEach(linje => {
    page.drawText(linje, { x: venstreMarg, y, size: 9.5, font });
    y -= 12;
  });

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

// De 5 dokumentnavn-prefiksene automatikken selv genererer - brukt til å identifisere
// (og evt. fjerne igjen) tidligere auto-genererte Vegvesen-dokumenter uten å røre
// manuelt opplastede dokumenter med andre navn. Samme rekkefølge som vegvesenSkrivUt().
const VEGVESEN_DOKUMENTTYPER = ['Egenerklæring-', 'Vektfordeling-', 'Fabrikantattest-', 'Melding om registrering-', 'Kjøretøyliste-'];

// Fjerner tidligere auto-genererte Vegvesen-dokumenter fra en ordre (og eventuelle
// søsken-ordre i samme flåte som deler dem, samme fjerningsmønster som slettDokument()
// i ordre-diverse.js) - kalt fra sfOmbygging() når nyttKjoretoy skrus AV. Uten dette blir
// tidligere genererte dokumenter stående og se gyldige ut for en kategori ordren ikke
// lenger tilhører (funnet via en ekte ordre 2026-09-23 - en "Brukt Kjøretøy"-ordre som
// fortsatt viste "Nytt Kjøretøy"-papirer generert før kategorien ble rettet).
// Sjekker kilde.ombygging (primær hvis flåte, ellers ordren selv) - samme kilde som
// avgjør om automatikken genererer i utgangspunktet (se vegvesenAutoGenererHvisKomplett)
// - rører ingenting hvis det er et SEKUNDÆRKJØRETØY i flåten som fikk sin egen,
// funksjonsløse nyttKjoretoy-hake endret, ikke den som faktisk styrer generering.
async function vegvesenFjernGenererteDokumenterHvisIkkeLengerAktuelt(o) {
  const kontekst = vegvesenFlateKontext(o);
  const kilde = kontekst ? kontekst.primaer : o;
  if (kilde.ombygging?.nyttKjoretoy) return;

  const gamle = (o.dokumenter || []).filter(d => VEGVESEN_DOKUMENTTYPER.some(p => d.navn.startsWith(p)));
  if (!gamle.length) return;

  for (const dok of gamle) {
    const beroerte = kontekst
      ? kontekst.medlemmer.filter(m => (m.dokumenter||[]).some(d => d.navn===dok.navn && d.url===dok.url))
      : [o];
    if (db && dok.url) {
      const filnavn = dok.url.split('/ordre-dokumenter/')[1];
      if (filnavn) await db.storage.from('ordre-dokumenter').remove([filnavn]);
    }
    beroerte.forEach(m => {
      m.dokumenter = (m.dokumenter||[]).filter(d => !(d.navn===dok.navn && d.url===dok.url));
      logChange(m, 'Fjernet utdatert Vegvesen-dokument (Nytt Kjøretøy fjernet): ' + dok.navn);
    });
    if (db) db.from('ordrer').upsert(beroerte.map(m=>({id:m.id, dokumenter:m.dokumenter})), {onConflict:'id'})
      .then(r=>{if(r.error) console.error('Dokument-oppdatering feilet:', r.error.message);});
    beroerte.forEach(m => {
      const listEl = document.getElementById('dokumenterListe_' + m.id);
      if (listEl) listEl.innerHTML = dokumenterListeHTML(m);
    });
  }

  // Nullstiller fingerprint slik at automatikken regenererer helt friskt igjen hvis
  // "Nytt Kjøretøy" hukes av på nytt senere, i stedet for å tro alt fortsatt stemmer.
  kilde.vegvesenFingerprint = null;
  if (db) db.from('ordrer').update({vegvesen_fingerprint:null}).eq('id', kilde.id)
    .then(r=>{if(r.error) console.error('Nullstilling av fingerprint feilet:', r.error.message);});
  if (kontekst) {
    kontekst.flate.vegvesenFingerprint = null;
    if (db) db.from('flater').update({vegvesen_fingerprint:null}).eq('id', kontekst.flate.id)
      .then(r=>{if(r.error) console.error('Nullstilling av flåte-fingerprint feilet:', r.error.message);});
  }
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
  visToast(`Fjernet ${gamle.length} utdatert${gamle.length===1?'':'e'} Vegvesen-dokument${gamle.length===1?'':'er'} siden "Nytt Kjøretøy" ble fjernet`, 'ok');
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

// Alle genererte dokumentnavn følger mønsteret "<Dokumenttype>-<chassis>.pdf" - eller
// "<Dokumenttype>-<flåtenummer>.pdf" når dokumentet gjelder en hel flåte (se
// vegvesenFlateKontext), siden det da ikke finnes ett enkelt chassisnummer å bruke.
function vegvesenFilnavn(dokumenttype, chassisEllerFlatenummer) {
  return `${dokumenttype}-${chassisEllerFlatenummer || 'UKJENT'}.pdf`;
}

// Løser opp flåte-tilhørighet for en ordre. Returnerer null hvis ordren ikke er i noen
// (aktiv) flåte, ellers {flate, primaer, medlemmer} - primaer er samme kildeordre som
// flate.js allerede henter type/variant/versjon/vekter fra (leggOrdreIFlate/
// settFlatePrimaer), så Vegvesen-dokumentene bruker konsekvent samme kilde som resten
// av appen. medlemmer er ALLE ordre i flåten, inkl. primær, sortert stabilt på chassis.
function vegvesenFlateKontext(o) {
  if (!o.flateId) return null;
  const flate = (S.flater || []).find(f => f.id === o.flateId);
  if (!flate) return null;
  // Vanlig strengsammenligning (ikke localeCompare) med vilje - chassisnummer/VIN er
  // rent ASCII uten språkspesifikk betydning, og localeCompare() uten eksplisitt locale
  // ga overraskende ikke-alfabetisk rekkefølge for repeterte bokstaver under nb-NO
  // (f.eks. "AAA" > "BBB") - oppdaget i test 2026-09-21.
  const medlemmer = (S.ordrer || []).filter(x => x.flateId === flate.id).sort((a, b) => {
    const ca = (a.chassis || '').toUpperCase(), cb = (b.chassis || '').toUpperCase();
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
  if (!medlemmer.length) return null;
  const primaer = medlemmer.find(x => x.id === flate.primaerOrdreId) || medlemmer[0];
  return { flate, primaer, medlemmer };
}

// Som vegvesenLagreGenerertDokument, men for et dokument som gjelder en hel flåte -
// lastes opp ÉN gang (under den første ordreId-en i lista), men samme offentlige URL
// legges inn i dokumentlisten til ALLE ordrene i flåten (bekreftet av Henrik
// 2026-09-21: skal være synlig uansett hvilken ordre i flåten man åpner). Faller
// tilbake til den vanlige enkelt-ordre-varianten når det bare er én ordreId.
async function vegvesenLagreGenerertDokumentFlere(ordreIder, filnavn, pdfBytes) {
  if (ordreIder.length === 1) return vegvesenLagreGenerertDokument(ordreIder[0], filnavn, pdfBytes);
  if (!db) { visToast('Ikke koblet til Supabase'); return; }
  const forsteOrdre = S.ordrer.find(x => x.id === ordreIder[0]);
  const forrige = forsteOrdre && (forsteOrdre.dokumenter || []).find(d => d.navn === filnavn);

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const tryggNavn = filnavn.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9.\-]/g, '_');
  const lagringsnavn = `${ordreIder[0]}/${Date.now()}_${tryggNavn}`;
  const { error } = await db.storage.from('ordre-dokumenter').upload(lagringsnavn, blob, { contentType: 'application/pdf', cacheControl: '31536000' });
  if (error) { visToast('Feil ved lagring av ' + filnavn + ': ' + error.message); return; }
  const { data } = db.storage.from('ordre-dokumenter').getPublicUrl(lagringsnavn);
  const nyttDok = { navn: filnavn, url: data.publicUrl, lastetOppAv: me?.navn || 'Automatisk', dato: new Date().toISOString() };

  if (forrige) {
    const gammeltFilnavn = forrige.url.split('/ordre-dokumenter/')[1];
    if (gammeltFilnavn) db.storage.from('ordre-dokumenter').remove([gammeltFilnavn]).then(() => {});
  }

  const oppdaterte = [];
  ordreIder.forEach(id => {
    const o = S.ordrer.find(x => x.id === id); if (!o) return;
    o.dokumenter = o.dokumenter || [];
    const gammelIdx = o.dokumenter.findIndex(d => d.navn === filnavn);
    o.dokumenter = gammelIdx !== -1 ? o.dokumenter.map((d, i) => i === gammelIdx ? nyttDok : d) : [...o.dokumenter, nyttDok];
    logChange(o, 'Generert dokument (flåte): ' + filnavn);
    oppdaterte.push(o);
  });
  if (db && oppdaterte.length) {
    db.from('ordrer').upsert(oppdaterte.map(o => ({ id: o.id, dokumenter: o.dokumenter })), { onConflict: 'id' })
      .then(r => { if (r.error) console.error('Dokument-oppdatering (flåte) feilet:', r.error.message); });
  }
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
  oppdaterte.forEach(o => {
    const listEl = document.getElementById('dokumenterListe_' + o.id);
    if (listEl) listEl.innerHTML = dokumenterListeHTML(o);
  });
}

// Selve genererings-kjernen, delt mellom det manuelle "Regenerer"-trykket og den
// automatiske trigger-funksjonen under. kilde er ordren dataene faktisk hentes fra
// (primærkjøretøyet hvis flåte, ellers ordren selv). kontekst er null for en
// frittstående ordre, ellers {flate, primaer, medlemmer} fra vegvesenFlateKontext.
// Når kontekst finnes deles Egenerklæring/Vektfordeling/Fabrikantattest/Melding om
// registrering for hele flåten (bekreftet av Henrik 2026-09-21 - alle biler i en flåte
// er samme modell), med "Se kjøretøyliste" i stedet for et enkelt chassisnummer, og en
// egen Kjøretøyliste med det faktiske chassisnummeret for hver bil i flåten.
async function vegvesenGenererOgLagre(kilde, kontekst) {
  const visningsOrdre = kontekst ? { ...kilde, chassis: 'Se kjøretøyliste' } : kilde;
  const malOrdreIder = kontekst ? kontekst.medlemmer.map(m => m.id) : [kilde.id];
  const filnavnNokkel = kontekst ? (kontekst.flate.flatenummer || kontekst.flate.id) : (kilde.chassis || 'UKJENT');

  const egenerklaeringBytes = await genEgenerklaeringPDF(visningsOrdre);
  await vegvesenLagreGenerertDokumentFlere(malOrdreIder, vegvesenFilnavn('Egenerklæring', filnavnNokkel), egenerklaeringBytes);

  // Uavhengig av vektberegningen under - trenger kun ordrens egne stamdata.
  const meldingBytes = await genMeldingOmRegistreringPDF(visningsOrdre);
  await vegvesenLagreGenerertDokumentFlere(malOrdreIder, vegvesenFilnavn('Melding om registrering', filnavnNokkel), meldingBytes);

  const resultat = vegvesenBeregnOgSettEndring(kilde);
  if (!resultat) {
    return { status: 'delvis', melding: 'Egenerklæring og Melding om registrering generert. Mangler Vekter (Ved ankomst/Før visning) for Vektfordeling/Fabrikantattest.' };
  }
  const { P1, P2, M, M1, M2, justertP, justertVogntog, geometri: geom } = resultat;
  const { bytes: vektfordelingBytes } = await genVektfordelingPDF(visningsOrdre, justertP, P1, P2, M, M1, M2, geom);
  await vegvesenLagreGenerertDokumentFlere(malOrdreIder, vegvesenFilnavn('Vektfordeling', filnavnNokkel), vektfordelingBytes);

  const fabrikantattestBytes = await genFabrikantattestPDF(visningsOrdre, justertP, justertVogntog, M);
  await vegvesenLagreGenerertDokumentFlere(malOrdreIder, vegvesenFilnavn('Fabrikantattest', filnavnNokkel), fabrikantattestBytes);

  if (kontekst) {
    const kjoretoylisteBytes = await genKjoretoylistePDF(kontekst.flate, kontekst.primaer, kontekst.medlemmer);
    await vegvesenLagreGenerertDokumentFlere(malOrdreIder, vegvesenFilnavn('Kjøretøyliste', filnavnNokkel), kjoretoylisteBytes);
  }

  return { status: 'ok', melding: kontekst ? 'Vegvesen-dokumenter generert og lagret for hele flåten (inkl. Kjøretøyliste)' : 'Egenerklæring, Vektfordeling, Fabrikantattest og Melding om registrering generert og lagret' };
}

// Manuell knapp - tvinger fram en ny generering uansett om noe faktisk har endret seg
// siden sist (i motsetning til vegvesenAutoGenererHvisKomplett under, som kun kjører
// når fingerprinten er annerledes). Oppdaterer fingerprinten etterpå slik at
// auto-triggeren ikke umiddelbart regenererer på nytt av seg selv.
async function genererVegvesenDokumenter(ordreId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  const kontekst = vegvesenFlateKontext(o);
  const kilde = kontekst ? kontekst.primaer : o;
  const geometri = vegvesenGeometri(kilde.merke, kilde.modell);
  if (!geometri) { visToast('Ingen mal/geometri lagt inn for ' + (kilde.merke||'?') + ' ' + (kilde.modell||'?') + ' ennå'); return; }
  visToast('Genererer dokumenter...', 'ok');
  try {
    const resultat = await vegvesenGenererOgLagre(kilde, kontekst);
    vegvesenLagreFingerprint(kilde, kontekst);
    visToast(resultat.melding, 'ok');
  } catch (e) {
    console.error('Feil ved generering av Vegvesen-dokumenter:', e);
    visToast('Feil ved generering: ' + e.message);
  }
}

// Sjekker at alt som faktisk trengs for å generere dokumentene er fylt ut på kilde-
// ordren (primærkjøretøyet hvis flåte, ellers ordren selv) - chassis, farge, forhandler
// og alle 6 vektfeltene (Ved ankomst + Før visning for total/for/bak-aksel).
function vegvesenErKomplett(o) {
  const tall = v => parseFloat(String(v || '').replace(',', '.'));
  const vekt = felt => o.vekter?.[felt]?.a && o.vekter?.[felt]?.v && !isNaN(tall(o.vekter[felt].a)) && !isNaN(tall(o.vekter[felt].v));
  return !!(o.chassis && o.farge && o.kunde && o.forhandlerOrgnr && vekt('totalvekt') && vekt('foraksel') && vekt('bakaksel'));
}

// Fingerprint av alt som faktisk påvirker de genererte dokumentene. Endres ett av disse
// feltene skal dokumentene regenereres, ellers ikke - billig strengsammenligning på
// hver render i stedet for å bygge PDF-er på nytt hver gang buildOrdreDetail() kjører.
// For en flåte inngår hele medlemslista (chassis/forhandler/org.nr per bil) også, siden
// Kjøretøylisten skal oppdateres når noen legges til/fjernes fra flåten.
function vegvesenFingerprint(kilde, kontekst) {
  const felt = o => [o.merke, o.modell, o.type, o.variant, o.versjon, o.typegodkjenning, o.chassis, o.farge, o.kunde, o.forhandlerOrgnr, o.egenvektCoc, JSON.stringify(o.vekter)];
  const deler = felt(kilde);
  if (kontekst) deler.push(kontekst.flate.flatenummer, ...kontekst.medlemmer.map(m => `${m.id}:${m.chassis}:${m.kunde}:${m.forhandlerOrgnr}`));
  return JSON.stringify(deler);
}

function vegvesenLagreFingerprint(kilde, kontekst) {
  const fp = vegvesenFingerprint(kilde, kontekst);
  if (kontekst) {
    kontekst.flate.vegvesenFingerprint = fp;
    if (db) db.from('flater').update({ vegvesen_fingerprint: fp }).eq('id', kontekst.flate.id)
      .then(r => { if (r.error) console.error('Flåte-fingerprint feilet:', r.error.message); });
  } else {
    kilde.vegvesenFingerprint = fp;
    if (db) db.from('ordrer').update({ vegvesen_fingerprint: fp }).eq('id', kilde.id)
      .then(r => { if (r.error) console.error('Vegvesen-fingerprint feilet:', r.error.message); });
  }
}

// Ordre/flåte-id-er med en genererings-jobb i gang akkurat nå - unngår at flere raske
// re-render-kall (f.eks. Realtime-echo) starter samme jobb dobbelt før fingerprinten
// er lagret. Samme mønster som ignorerRealtimeFor andre steder i appen.
const vegvesenGenererer = new Set();

// Selvhelbredende auto-trigger - kalt fra buildOrdreDetail() på hver render (se
// ordre-detalj.js). Genererer automatisk Vegvesen-dokumentene så snart alt nødvendig
// er fylt ut, og regenererer hvis noe som påvirker dem endres etterpå. Bekreftet av
// Henrik 2026-09-21: automatikk fremfor manuell knapp, men brukeren må selv trykke
// "Skriv ut" siden nettlesere ikke kan skrive ut helt stille uten et brukerklikk.
async function vegvesenAutoGenererHvisKomplett(o) {
  // Sjekker kilde.ombygging (primær hvis flåte), IKKE o.ombygging direkte - flate.js
  // kopierer kun type/variant/versjon/vekter fra primær til resten av flåten, ikke
  // ombygging-flaggene, så et sekundærkjøretøy kan mangle nyttKjoretoy=true på seg
  // selv selv om flåten faktisk skal ha Vegvesen-dokumenter (funnet i test 2026-09-21).
  const kontekst = vegvesenFlateKontext(o);
  const kilde = kontekst ? kontekst.primaer : o;
  if (!kilde.ombygging?.nyttKjoretoy) return;
  if (!vegvesenGeometri(kilde.merke, kilde.modell)) return;
  if (!vegvesenErKomplett(kilde)) return;

  const id = kontekst ? 'flate:' + kontekst.flate.id : 'ordre:' + kilde.id;
  if (vegvesenGenererer.has(id)) return;
  const fp = vegvesenFingerprint(kilde, kontekst);
  const lagretFp = kontekst ? kontekst.flate.vegvesenFingerprint : kilde.vegvesenFingerprint;
  if (fp === lagretFp) return;

  vegvesenGenererer.add(id);
  try {
    const resultat = await vegvesenGenererOgLagre(kilde, kontekst);
    if (resultat.status === 'ok') {
      vegvesenLagreFingerprint(kilde, kontekst);
      visToast('📄 Vegvesen-dokumenter generert automatisk' + (kontekst ? ' for hele flåten' : '') + ' - husk å skrive ut', 'ok');
    }
    // status 'delvis' (mangler vekter) lagrer bevisst IKKE fingerprinten - da prøver
    // auto-triggeren på nytt neste gang noe endres, helt til vektene også er fylt ut.
  } catch (e) {
    console.error('Automatisk generering av Vegvesen-dokumenter feilet:', e);
  } finally {
    vegvesenGenererer.delete(id);
  }
}

// Slår sammen de genererte Vegvesen-PDF-ene (i lesbar rekkefølge) til ett dokument og
// åpner det i en ny fane med utskriftsdialogen klar - nettlesere krever uansett at
// brukeren selv klikker i den dialogen, det finnes ingen helt stille utskrift.
async function vegvesenSkrivUt(ordreId) {
  const o = S.ordrer.find(x => x.id === ordreId); if (!o) return;
  const kontekst = vegvesenFlateKontext(o);
  const kildeDok = (kontekst ? kontekst.primaer : o).dokumenter || [];
  const REKKEFOLGE = ['Egenerklæring-', 'Vektfordeling-', 'Fabrikantattest-', 'Melding om registrering-', 'Kjøretøyliste-'];
  const relevante = REKKEFOLGE.map(p => kildeDok.find(d => d.navn.startsWith(p))).filter(Boolean);
  if (!relevante.length) { visToast('Ingen Vegvesen-dokumenter å skrive ut ennå'); return; }

  visToast('Henter dokumenter for utskrift...', 'ok');
  try {
    const { PDFDocument } = PDFLib;
    const samlet = await PDFDocument.create();
    for (const d of relevante) {
      const res = await fetch(d.url);
      const bytes = await res.arrayBuffer();
      const kildedoc = await PDFDocument.load(bytes);
      const sider = await samlet.copyPages(kildedoc, kildedoc.getPageIndices());
      sider.forEach(s => samlet.addPage(s));
    }
    const ferdig = await samlet.save();
    const url = URL.createObjectURL(new Blob([ferdig], { type: 'application/pdf' }));
    const vindu = window.open(url, '_blank');
    if (vindu) vindu.onload = () => vindu.print();
    else visToast('Kunne ikke åpne utskriftsvindu - sjekk om popup ble blokkert');
  } catch (e) {
    console.error('Feil ved sammenslåing/utskrift av Vegvesen-dokumenter:', e);
    visToast('Feil ved utskrift: ' + e.message);
  }
}
