// "Finn forhandler" på salmaker.as: kunden velger modell, skriver inn postnummer/sted
// (eller bruker posisjonen sin), ser forhandlerne som selger modellen - nærmest først -
// og kan sende en forespørsel til opptil tre av dem.
//
// Forhandlerdata og utsending ligger i Forhandlerportalen (forhandler.salmaker.as):
//   GET  /api/public/dealers       - forhandlere (kun firmaopplysninger) + modell-slugs
//   GET  /api/public/models        - modellnavn
//   POST /api/public/foresporsel   - sender forespørselen som e-post til de valgte
// Postnummer/sted slås opp direkte hos Kartverket (Geonorge, åpent og uten nøkkel) -
// det passerer aldri våre egne servere.
(function () {
  "use strict";

  var API_BASE = "https://forhandler.salmaker.as";
  var GEONORGE = "https://ws.geonorge.no";
  var MAX_VALGT = 3;
  // Steds-typer som regnes som "et sted man bor" når kunden skriver et stedsnavn.
  var PLACE_TYPES = ["By", "Tettsted", "Tettbebyggelse", "Bygd", "Grend", "Kommune", "Bydel"];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

  function $(id) { return document.getElementById(id); }
  var els = {
    loading: $("fhLoading"), empty: $("fhEmpty"), loadError: $("fhLoadError"),
    search: $("fhSearch"), model: $("fhModel"), query: $("fhQuery"), locate: $("fhLocate"), searchStatus: $("fhSearchStatus"),
    results: $("fhResults"), resultsTitle: $("fhResultsTitle"), resultsSub: $("fhResultsSub"), list: $("fhList"), pickHint: $("fhPickHint"),
    request: $("fhRequest"), chosen: $("fhChosen"), chosenLabel: $("fhChosenLabel"), send: $("fhSend"), requestError: $("fhRequestError"),
    navn: $("fhNavn"), telefon: $("fhTelefon"), epost: $("fhEpost"), melding: $("fhMelding"), website: $("fhWebsite"), consent: $("fhConsent"),
    success: $("fhSuccess")
  };
  if (!els.search) return;
  show(els.loading, true); // skjult i HTML (uten JavaScript står <noscript>-teksten igjen i stedet)

  var state = {
    dealers: [],       // fra API-et
    modelNames: Object.create(null), // slug -> navn (uten prototype: ?modell=constructor skal ikke gi treff)
    modell: "",        // valgt modell-slug
    pos: null,         // { lat, lon } fra søk/posisjon
    posLabel: "",
    valgt: [],         // dealer-id-er, i den rekkefølgen de ble huket av
    soek: 0            // løpenummer: bare det nyeste søket/posisjonsoppslaget får lov å sette posisjon
  };

  // ---------- små hjelpere ----------

  function show(el, on) { if (el) el.hidden = !on; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fetchJson(url, options, timeoutMs) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000) : null;
    var opts = options || {};
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return null; }).then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function titleCase(s) {
    return String(s || "").toLowerCase().replace(/(^|[\s-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatKm(km) {
    return km < 10 ? km.toFixed(1).replace(".", ",") : String(Math.round(km));
  }

  function finitePoint(lat, lon) {
    return typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon);
  }

  // ---------- stedsoppslag (Kartverket) ----------

  // Kartverket som er nede/overbelastet (5xx/429) er noe annet enn "fant ikke stedet" -
  // det første kaster, slik at kunden får riktig melding.
  function sjekkTjeneste(r) {
    if (r.status >= 500 || r.status === 429) throw new Error("Geonorge " + r.status);
    return r;
  }

  function geocodePostnummer(pn) {
    return fetchJson(GEONORGE + "/adresser/v1/sok?postnummer=" + pn + "&treffPerSide=500&utkoordsys=4258").then(sjekkTjeneste).then(function (r) {
      var list = r.ok && r.body && Array.isArray(r.body.adresser) ? r.body.adresser : [];
      var pts = list.map(function (a) { return a.representasjonspunkt; })
        .filter(function (p) { return p && finitePoint(p.lat, p.lon); });
      if (!pts.length) return null;
      var lat = 0, lon = 0;
      pts.forEach(function (p) { lat += p.lat; lon += p.lon; });
      var sted = list[0] && list[0].poststed ? " " + titleCase(list[0].poststed) : "";
      return { lat: lat / pts.length, lon: lon / pts.length, label: pn + sted };
    });
  }

  function geocodeSted(q) {
    var enc = encodeURIComponent(q);
    return fetchJson(GEONORGE + "/stedsnavn/v1/navn?sok=" + enc + "&fuzzy=true&treffPerSide=10&utkoordsys=4258").then(sjekkTjeneste).then(function (r) {
      var names = r.ok && r.body && Array.isArray(r.body.navn) ? r.body.navn : [];
      var places = names.filter(function (n) {
        var p = n.representasjonspunkt;
        return PLACE_TYPES.indexOf(n.navneobjekttype) !== -1 && p && finitePoint(p.nord, p["øst"]);
      });
      var lower = q.trim().toLowerCase();
      var best = places.filter(function (n) { return String(n["skrivemåte"] || "").toLowerCase() === lower; })[0] || places[0];
      if (best) {
        // Kommunen med i etiketten (det finnes flere "Bø", "Hamar" osv.) - første treff velges.
        var kommune = best.kommuner && best.kommuner[0] && best.kommuner[0].kommunenavn;
        var navn = best["skrivemåte"] || q;
        return { lat: best.representasjonspunkt.nord, lon: best.representasjonspunkt["øst"], label: kommune && kommune !== navn ? navn + " (" + kommune + ")" : navn };
      }
      // Ikke et stedsnavn - prøv som full adresse ("Storgata 1, Oslo").
      return fetchJson(GEONORGE + "/adresser/v1/sok?sok=" + enc + "&treffPerSide=1&utkoordsys=4258").then(sjekkTjeneste).then(function (r2) {
        var a = r2.ok && r2.body && Array.isArray(r2.body.adresser) ? r2.body.adresser[0] : null;
        var p = a && a.representasjonspunkt;
        if (!p || !finitePoint(p.lat, p.lon)) return null;
        return { lat: p.lat, lon: p.lon, label: [a.adressetekst, titleCase(a.poststed)].filter(Boolean).join(", ") };
      });
    });
  }

  function geocode(q) {
    var compact = q.replace(/\s+/g, "");
    return /^\d{4}$/.test(compact) ? geocodePostnummer(compact) : geocodeSted(q);
  }

  // ---------- visning ----------

  // Teksten settes et lite øyeblikk ETTER at regionen vises - en live-region som blir synlig og
  // fylt i samme øyeblikk annonseres ofte ikke av skjermlesere.
  function setSearchStatus(text, isError) {
    els.searchStatus.classList.toggle("is-error", !!isError);
    if (!text) { els.searchStatus.textContent = ""; show(els.searchStatus, false); return; }
    show(els.searchStatus, true);
    setTimeout(function () { els.searchStatus.textContent = text; }, 60);
  }

  function dealersForModel() {
    var list = state.dealers.filter(function (d) { return d.modeller.indexOf(state.modell) !== -1; });
    list.forEach(function (d) {
      d.km = state.pos && finitePoint(d.lat, d.lng) ? haversineKm(state.pos, { lat: d.lat, lon: d.lng }) : null;
    });
    list.sort(function (a, b) {
      if (a.km != null && b.km != null) return a.km - b.km;
      return a.navn.localeCompare(b.navn, "nb");
    });
    return list;
  }

  function buildCard(d) {
    var card = el("article", "fh-card");

    var info = el("div");
    info.appendChild(el("h3", "fh-name", d.navn));
    var addr = [d.adresse, [d.postnummer, d.poststed].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (addr) info.appendChild(el("p", "fh-addr", addr));
    var links = el("div", "fh-links");
    if (d.telefon) {
      var tel = el("a", null, d.telefon);
      tel.href = "tel:" + String(d.telefon).replace(/[^\d+]/g, "");
      links.appendChild(tel);
    }
    if (addr) {
      var route = el("a", null, "Veibeskrivelse");
      route.href = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(d.navn + ", " + addr);
      route.target = "_blank";
      route.rel = "noopener";
      links.appendChild(route);
    }
    info.appendChild(links);
    card.appendChild(info);

    var side = el("div", "fh-side");
    if (d.km != null) {
      var dist = el("div", "fh-dist", "ca. " + formatKm(d.km) + " km");
      dist.appendChild(el("small", null, "LUFTLINJE"));
      side.appendChild(dist);
    }
    var choose = el("label", "fh-choose");
    choose.setAttribute("data-id", d.id);
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = d.id;
    cb.checked = state.valgt.indexOf(d.id) !== -1;
    cb.addEventListener("change", function () { onPick(d.id, cb.checked); });
    cb.setAttribute("aria-label", "Send forespørsel til " + d.navn);
    choose.appendChild(cb);
    choose.appendChild(el("span", null, "Send forespørsel hit"));
    side.appendChild(choose);
    card.appendChild(side);
    return card;
  }

  function renderResults() {
    if (!state.modell) { show(els.results, false); updateRequestPanel(); return; }
    var list = dealersForModel();
    var modelName = state.modelNames[state.modell] || state.modell;

    els.resultsTitle.textContent = list.length + (list.length === 1 ? " forhandler" : " forhandlere") + " for " + modelName;
    els.resultsSub.textContent = state.pos
      ? "Sortert etter avstand fra " + state.posLabel
      : "Skriv inn postnummer eller sted for å se avstand";
    els.list.textContent = "";
    list.forEach(function (d) { els.list.appendChild(buildCard(d)); });
    show(els.results, true);
    refreshChoices();
    updateRequestPanel();
  }

  // Oppdaterer avkryssingene uten å bygge lista på nytt (beholder fokus og scrollposisjon).
  function refreshChoices() {
    var full = state.valgt.length >= MAX_VALGT;
    Array.prototype.forEach.call(els.list.querySelectorAll(".fh-choose"), function (label) {
      var cb = label.querySelector("input");
      var on = state.valgt.indexOf(label.getAttribute("data-id")) !== -1;
      cb.checked = on;
      cb.disabled = full && !on;
      label.classList.toggle("is-on", on);
      label.classList.toggle("is-disabled", full && !on);
    });
    els.pickHint.textContent = full
      ? "Du har valgt " + MAX_VALGT + " forhandlere – det er maks. Fjern en for å velge en annen."
      : "Huk av opptil " + MAX_VALGT + " forhandlere for å sende forespørsel.";
  }

  function updateRequestPanel() {
    var names = state.valgt.map(function (id) {
      var d = state.dealers.filter(function (x) { return x.id === id; })[0];
      return d ? d.navn : null;
    }).filter(Boolean);
    show(els.request, names.length > 0);
    if (!names.length) return;
    els.chosen.textContent = "";
    names.forEach(function (n) { els.chosen.appendChild(el("span", "fh-chip", n)); });
    els.chosenLabel.textContent = "FORESPØRSEL TIL (" + names.length + " AV " + MAX_VALGT + ")";
    els.send.textContent = "Send forespørsel til " + names.length + (names.length === 1 ? " forhandler" : " forhandlere");
  }

  function onPick(id, on) {
    var i = state.valgt.indexOf(id);
    if (on && i === -1 && state.valgt.length < MAX_VALGT) state.valgt.push(id);
    if (!on && i !== -1) state.valgt.splice(i, 1);
    show(els.success, false);
    show(els.requestError, false);
    els.consent.checked = false; // samtykket gjelder akkurat dem som var valgt
    refreshChoices();
    updateRequestPanel();
  }

  // ---------- søk ----------

  function applyPosition(pos) {
    state.pos = { lat: pos.lat, lon: pos.lon };
    state.posLabel = pos.label;
    setSearchStatus(state.modell ? "Viser avstand fra " + pos.label + "." : "Fant " + pos.label + ". Velg modell for å se forhandlerne.", false);
    renderResults();
  }

  els.search.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = els.query.value.trim();
    if (!q) { setSearchStatus("Skriv inn postnummer eller sted først.", true); els.query.focus(); return; }
    setSearchStatus("Søker …", false);
    var mitt = ++state.soek;
    geocode(q).then(function (pos) {
      if (mitt !== state.soek) return; // et nyere søk/posisjonsoppslag har tatt over
      if (!pos) {
        setSearchStatus("Fant ikke «" + q + "». Sjekk skrivemåten, eller prøv med postnummeret.", true);
        return;
      }
      applyPosition(pos);
    }, function () {
      if (mitt !== state.soek) return;
      setSearchStatus("Kunne ikke slå opp stedet akkurat nå (Kartverket svarer ikke). Prøv igjen om litt.", true);
    });
  });

  els.locate.addEventListener("click", function () {
    if (!navigator.geolocation) {
      setSearchStatus("Nettleseren din støtter ikke posisjon. Skriv inn postnummer i stedet.", true);
      return;
    }
    setSearchStatus("Henter posisjonen din …", false);
    var min = ++state.soek;
    navigator.geolocation.getCurrentPosition(function (p) {
      if (min !== state.soek) return;
      els.query.value = "";
      applyPosition({ lat: p.coords.latitude, lon: p.coords.longitude, label: "din posisjon" });
    }, function (err) {
      if (min !== state.soek) return;
      setSearchStatus(err && err.code === 1
        ? "Du har ikke gitt tilgang til posisjonen din. Skriv inn postnummer i stedet."
        : "Fant ikke posisjonen din. Skriv inn postnummer i stedet.", true);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  els.model.addEventListener("change", function () {
    state.modell = els.model.value;
    state.valgt = [];
    els.consent.checked = false;
    show(els.success, false);
    try {
      var url = new URL(window.location.href);
      if (state.modell) url.searchParams.set("modell", state.modell); else url.searchParams.delete("modell");
      window.history.replaceState(null, "", url.toString());
    } catch (err) { /* adressefeltet er bare en bekvemmelighet */ }
    renderResults();
  });

  // ---------- forespørsel ----------

  function showRequestError(text, focusEl) {
    els.requestError.textContent = text;
    show(els.requestError, true);
    if (focusEl) focusEl.focus();
  }

  els.request.addEventListener("submit", function (e) {
    e.preventDefault();
    show(els.requestError, false);

    var navn = els.navn.value.trim();
    var epost = els.epost.value.trim();
    var telefon = els.telefon.value.trim();
    if (state.valgt.length === 0) return showRequestError("Velg minst én forhandler.");
    if (navn.length < 2) return showRequestError("Skriv inn navnet ditt.", els.navn);
    if (!EMAIL_RE.test(epost)) return showRequestError("Sjekk e-postadressen (f.eks. navn@epost.no).", els.epost);
    if (telefon && telefon.replace(/\D/g, "").length < 8) return showRequestError("Telefonnummeret ser feil ut.", els.telefon);
    if (!els.consent.checked) return showRequestError("Du må godta at opplysningene sendes til forhandlerne du har valgt.", els.consent);

    var payload = {
      modell: state.modell,
      forhandlere: state.valgt.slice(),
      navn: navn,
      epost: epost,
      telefon: telefon,
      melding: els.melding.value.trim(),
      samtykke: true,
      kontaktref: els.website.value, // honeypot - skjult felt, skal alltid være tomt
      // Tid siden siden ble åpnet - en robot som sender med en gang avsløres av dette.
      ms: Math.round(typeof performance !== "undefined" ? performance.now() : 0)
    };

    var label = els.send.textContent;
    els.send.disabled = true;
    els.send.textContent = "Sender …";
    var generic = "Kunne ikke sende forespørselen akkurat nå. Prøv igjen om litt, eller ring oss på 35 59 33 95.";

    fetchJson(API_BASE + "/api/public/foresporsel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, 20000).then(function (r) {
      els.send.disabled = false;
      els.send.textContent = label;
      if (r.ok && r.body && r.body.ok) {
        var sent = Array.isArray(r.body.sendtTil) ? r.body.sendtTil : [];
        els.success.textContent = "";
        els.success.appendChild(el("strong", null, "Forespørselen er sendt!"));
        els.success.appendChild(document.createTextNode(
          (sent.length ? " Den gikk til " + sent.join(", ") + "." : "") +
          " Forhandlerne svarer deg på e-post eller telefon. Sjekk søppelpost-mappen hvis du ikke har hørt noe innen et par dager."
        ));
        state.valgt = [];
        els.request.reset();
        show(els.request, false);
        refreshChoices();
        show(els.success, true);
        els.success.focus(); // skjemaet som hadde fokus er borte - flytt fokus (og skjermleser) til beskjeden
        els.success.scrollIntoView({ block: "center" });
      } else {
        showRequestError((r.body && r.body.error) || generic);
      }
    }, function () {
      els.send.disabled = false;
      els.send.textContent = label;
      showRequestError(generic);
    });
  });

  // ---------- oppstart ----------

  function init(dealersRes, modelsRes) {
    var dealers = dealersRes.ok && dealersRes.body && Array.isArray(dealersRes.body) ? dealersRes.body : null;
    if (!dealers) { show(els.loading, false); show(els.loadError, true); return; }

    state.dealers = dealers.filter(function (d) {
      return d && typeof d.id === "string" && typeof d.navn === "string" && Array.isArray(d.modeller);
    });
    var models = modelsRes && modelsRes.ok && Array.isArray(modelsRes.body) ? modelsRes.body : [];
    models.forEach(function (m) { if (m && m.slug) state.modelNames[m.slug] = m.name; });

    show(els.loading, false);
    if (state.dealers.length === 0) { show(els.empty, true); return; }

    // Bare modeller som har minst én forhandler, i samme rekkefølge som på ombygginger-siden.
    var counts = Object.create(null);
    state.dealers.forEach(function (d) { d.modeller.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; }); });
    var slugs = models.map(function (m) { return m.slug; }).filter(function (s) { return counts[s]; });
    Object.keys(counts).forEach(function (s) { if (slugs.indexOf(s) === -1) slugs.push(s); });

    els.model.appendChild(new Option("Velg modell …", ""));
    slugs.forEach(function (s) {
      els.model.appendChild(new Option((state.modelNames[s] || s) + " (" + counts[s] + ")", s));
    });
    show(els.search, true);

    var wanted = new URLSearchParams(window.location.search).get("modell") || "";
    if (wanted && counts[wanted]) {
      state.modell = wanted;
    } else if (wanted && state.modelNames[wanted]) {
      // Kunden kom fra en bestemt modell som ingen forhandler selger ennå: si det rett ut og
      // la modellen stå uvalgt - stille forhåndsvalg av en ANNEN bil kunne ført til feil forespørsel.
      setSearchStatus("Vi har ingen forhandlere for " + state.modelNames[wanted] + " ennå. Velg en annen modell, eller ta kontakt direkte på 35 59 33 95.", false);
    } else if (slugs.length === 1) {
      state.modell = slugs[0];
    }
    els.model.value = state.modell;
    renderResults();
  }

  Promise.all([
    fetchJson(API_BASE + "/api/public/dealers"),
    fetchJson(API_BASE + "/api/public/models").catch(function () { return null; })
  ]).then(function (res) { init(res[0], res[1]); }, function () {
    show(els.loading, false);
    show(els.loadError, true);
  });
})();
