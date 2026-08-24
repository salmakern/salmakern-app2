// Ambient-deklarasjoner for de globalene som deles på tvers av de 11 script-
// filene (se CLAUDE.md - "Arkitektur"). Dette er IKKE kjørende kode, kun
// typeinformasjon for editoren/TypeScript sin JSDoc-sjekk (`// @ts-check`).
// Bevisst løst typet (mye `any`) - målet er å gjøre `@ts-check` brukbart i
// filer som refererer disse, ikke å modellere hele appens tilstand nøyaktig.

interface Ansatt {
  id: number;
  navn: string;
  rolle: 'admin' | 'godkjenner' | 'ansatt';
  aktiv: boolean;
  kanForeLonn: boolean;
}

declare let S: {
  ordrer: any[];
  timer: any[];
  ansatte: Ansatt[];
  adminArk: any[];
  flater: any[];
  lagervarer: any[];
  lagerhistorikk: any[];
  lagerOppskrifter: any[];
  moter: any[];
  drivstoffSatser: any[];
  beskjeder: any[];
  kontakter: any[];
  hms: any[];
  utstyrMaler: any[];
  dagensPIN: string;
  gps: { lat: number | null; lng: number | null; radius: number };
  nextId: number;
  [key: string]: any;
};

declare let me: Ansatt | null;
declare let db: any;
declare let activeOrdreId: string | null;

declare function esc(s: string | null | undefined): string;
declare function ordreLabel(o: any): string;
declare function ordreLabelFull(o: any): string;
declare function samsvarerChassis(a: string | null | undefined, b: string | null | undefined): boolean;
declare function visToast(melding: string, type?: 'ok' | 'feil'): void;
declare function openModal(id: string): void;
declare function closeModal(id: string): void;
declare function save(id: string): void;
declare function saveInnstillinger(): void;
declare function renderAll(): void;
declare function renderMer(): void;
declare function buildOrdreDetail(): void;
