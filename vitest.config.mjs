import { defineConfig, configDefaults } from "vitest/config";

// forhandlerportal-app/ er et eget, gitignored Next.js-prosjekt som tilfeldigvis ligger nestet
// inni denne mappen (ikke en del av dette repoet). Uten dette unntaket plukker Vitest sin
// standard-glob opp SCRATCH-testfiler derfra (f.eks. forhandlerportal-app/.tmp/status-test/*)
// når de finnes lokalt, og "npm test" her viser feil som i virkeligheten er en helt annen
// app sine midlertidige testfiler (de finnes ikke i en fersk klone, så dette er ikke et
// CI-problem - bare støy i lokal output. Funnet 2026-11-01).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "forhandlerportal-app/**"],
  },
});
