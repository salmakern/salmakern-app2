# js/vendor

Tredjepartsbibliotek som lastes ved behov av `js/lager-hylle.js` (ikke på hver sidelasting). Filene er hentet ferdig bygde og er IKKE endret.

| Fil | Bibliotek | Lisens | Brukt til |
|---|---|---|---|
| `qrcode.js` | qrcode-generator (Kazuhiko Arase, kazuhikoarase/qrcode-generator), hentet 2026-11-03 | MIT (se toppen av filen) | lage QR-koden på hylleetikettene |
| `jsQR.js` | jsQR (cozmo/jsQR), `dist/jsQR.js`, hentet 2026-11-03 | Apache-2.0 | lese QR-koden med kameraet der nettleseren ikke har innebygd `BarcodeDetector` (iPhone, PC) |

Oppdatering: bytt filen, kjør `npm test` (`test/lager-hylle.test.js` genererer en QR og leser den tilbake med jsQR) og se at skanningen fortsatt virker i en ekte nettleser.
