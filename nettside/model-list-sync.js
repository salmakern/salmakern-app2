(function () {
  var API_BASE = "https://forhandler.salmaker.as";

  // Slugs that have their own dedicated, hand-written page on the site.
  // Any slug not in this list is linked through the generic modell.html page instead.
  // (hero-rotasjon.js har en egen kopi av lista - hold dem like.)
  var KNOWN_PAGES = {
    "kia-ev9": true,
    "mercedes-gls": true,
    "mercedes-g": true,
    "land-rover-defender-110": true,
    "land-rover-defender-130": true,
    "land-rover-defender-octa": true,
    "land-rover-discovery-5": true,
    "kgm-rexton": true,
    "dodge-ram": true,
    "dodge-durango": true,
    "mercedes-eqv": true,
    "mercedes-vito": true,
    "mercedes-vklasse": true,
    "toyota-lc-150": true,
    "toyota-lc-250": true,
    "vw-id-buzz-kort": true,
    "vw-id-buzz-lang": true,
  };

  // Merker med mellomrom i navnet - samme liste som splitModelName() i Forhandlerportalen (src/lib/modelName.ts),
  // så merkene grupperes likt som på portalens Produkter-side.
  var MULTI_WORD_BRANDS = ["Land Rover", "Alfa Romeo", "Aston Martin", "Rolls Royce", "Range Rover", "Great Wall"];
  var DETAIL_TIMEOUT_MS = 4000; // så lenge vi venter på variantantall før oversikten tegnes uten dem

  var vehicleGrid = document.getElementById("modelsGrid");
  // Antall-tekster ("N MODELLER") merket data-model-count settes fra den samme
  // lista - tallet i HTML-en er bare en reserve hvis API-et ikke svarer.
  var countEls = document.querySelectorAll("[data-model-count]");
  if (!vehicleGrid && countEls.length === 0) return;

  // Hide the static fallback list until we know whether real data replaces it -
  // avoids a visible flash of the old boxes right before they get swapped out.
  if (vehicleGrid) vehicleGrid.style.visibility = "hidden";

  function reveal() {
    if (vehicleGrid) vehicleGrid.style.visibility = "";
  }

  function pageFor(slug) {
    return KNOWN_PAGES[slug] ? slug + ".html" : "modell.html?slug=" + encodeURIComponent(slug);
  }

  // "KIA EV9" -> { brand: "KIA", model: "EV9" }. Ukjent/uvanlig navn gir hele navnet som merke og tom modell.
  function splitModelName(name) {
    var clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) return { brand: "", model: "" };
    var lower = clean.toLowerCase();
    for (var i = 0; i < MULTI_WORD_BRANDS.length; i++) {
      var b = MULTI_WORD_BRANDS[i];
      var l = b.toLowerCase();
      if (lower === l) return { brand: b, model: "" };
      if (lower.indexOf(l + " ") === 0) return { brand: clean.slice(0, b.length), model: clean.slice(b.length + 1) };
    }
    var sp = clean.indexOf(" ");
    return sp === -1 ? { brand: clean, model: "" } : { brand: clean.slice(0, sp), model: clean.slice(sp + 1) };
  }

  function slugOf(text) {
    var s = String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "ukjent";
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  // Gruppering og rekkefølge som på portalens Produkter-side (src/lib/brandGroups.ts): modellene beholder rekkefølgen fra
  // lista innenfor hvert merke; merker med minst én ferdig modell først, flest modeller øverst, ellers det som kommer først;
  // merker der alt er "kommer snart" helt sist. Ferdig = har varianter (ukjent antall regnes som ferdig).
  function groupByBrand(items) {
    var byKey = {};
    var order = [];
    items.forEach(function (item, index) {
      var brand = item.brand || "Andre";
      var key = brand.toLowerCase();
      var g = byKey[key];
      if (!g) {
        g = { brand: brand, first: index, ready: [], soon: [] };
        byKey[key] = g;
        order.push(g);
      }
      (item.variantCount === 0 ? g.soon : g.ready).push(item);
    });
    order.sort(function (a, b) {
      return (
        Number(b.ready.length > 0) - Number(a.ready.length > 0) ||
        b.ready.length + b.soon.length - (a.ready.length + a.soon.length) ||
        a.first - b.first
      );
    });
    var used = {};
    order.forEach(function (g) {
      var id = "merke-" + slugOf(g.brand);
      for (var n = 2; used[id]; n++) id = "merke-" + slugOf(g.brand) + "-" + n;
      used[id] = true;
      g.id = id;
      g.count = g.ready.length + g.soon.length;
    });
    return order;
  }

  // Bildene (opptil 4 MB originalt) hentes via portalens bildeoptimalisering (se hero-rotasjon.js), ikke som original.
  function optimized(url, width) {
    return API_BASE + "/_next/image?url=" + encodeURIComponent(url) + "&w=" + width + "&q=75";
  }

  function buildThumb(item) {
    var thumb = document.createElement("div");
    thumb.className = "thumb";
    if (item.imageUrl) {
      var img = document.createElement("img");
      img.alt = item.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.sizes = "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 260px";
      img.srcset = [384, 640, 828].map(function (w) { return optimized(item.imageUrl, w) + " " + w + "w"; }).join(", ");
      img.src = optimized(item.imageUrl, 640);
      // Svikter optimaliseringen, vis originalbildet i stedet for et tomt kort.
      img.onerror = function () {
        img.onerror = null;
        img.removeAttribute("srcset");
        img.src = item.imageUrl;
      };
      thumb.appendChild(img);
    } else {
      // Samme "Kommer snart"-plate som Forhandlerportalen viser for modeller uten bilde
      // (NoImagePlaceholder i portalen) - se .thumb-placeholder i site.css.
      var placeholder = document.createElement("div");
      placeholder.className = "thumb-placeholder";
      var plate = document.createElement("span");
      plate.className = "thumb-placeholder-label";
      plate.textContent = "Kommer snart";
      placeholder.appendChild(plate);
      thumb.appendChild(placeholder);
    }
    return thumb;
  }

  function buildCard(item) {
    var a = document.createElement("a");
    a.className = "model-card";
    a.href = pageFor(item.slug);
    a.appendChild(buildThumb(item));
    var body = document.createElement("div");
    body.className = "body";
    var name = document.createElement("p");
    name.className = "name";
    name.textContent = item.shortName;
    body.appendChild(name);
    if (item.variantCount != null) {
      var count = document.createElement("p");
      count.className = "count";
      count.textContent = plural(item.variantCount, "variant", "varianter");
      body.appendChild(count);
    }
    a.appendChild(body);
    return a;
  }

  // Modell uten varianter ennå: et lavt, dempet kort bakerst i merkegruppen (som i portalen).
  function buildSoonCard(item) {
    var a = document.createElement("a");
    a.className = "model-soon";
    a.href = pageFor(item.slug);
    var name = document.createElement("p");
    name.className = "name";
    name.textContent = item.shortName;
    var label = document.createElement("p");
    label.className = "mono soon-label";
    label.textContent = "KOMMER SNART";
    a.appendChild(name);
    a.appendChild(label);
    return a;
  }

  function renderOverview(items) {
    var groups = groupByBrand(items);
    var tab = vehicleGrid.parentNode;

    // Verktøylinje: søk + "Hopp til"-knapper (samme oppsett som portalen, uten prisliste).
    var toolbar = document.createElement("div");
    toolbar.className = "models-toolbar";
    var searchWrap = document.createElement("label");
    searchWrap.className = "models-search";
    var search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Søk modell eller produktnummer";
    search.setAttribute("aria-label", "Søk i modellene");
    searchWrap.appendChild(search);
    toolbar.appendChild(searchWrap);

    var jump = document.createElement("div");
    jump.className = "models-jump";
    jump.setAttribute("role", "group");
    jump.setAttribute("aria-label", "Hopp til merke");
    var jumpLabel = document.createElement("span");
    jumpLabel.className = "mono jump-label";
    jumpLabel.textContent = "HOPP TIL";
    jump.appendChild(jumpLabel);

    function chip(text, count, href) {
      var c = document.createElement("a");
      c.className = "jump-chip";
      c.href = href;
      c.appendChild(document.createTextNode(text));
      var n = document.createElement("i");
      n.className = "mono";
      n.textContent = String(count);
      c.appendChild(n);
      return c;
    }
    var allChip = chip("Alle", items.length, "#modeller");
    allChip.classList.add("is-active");
    jump.appendChild(allChip);

    var empty = document.createElement("p");
    empty.className = "models-empty";
    empty.textContent = "Ingen modeller passer søket.";
    empty.hidden = true;

    var grid = document.createElement("div");
    grid.className = "brand-grid";
    var groupEls = [];
    var chipEls = [allChip];

    groups.forEach(function (g) {
      var span = Math.max(g.ready.length, g.soon.length, 1);
      var section = document.createElement("section");
      section.className = "brand-group";
      section.id = g.id;
      section.style.setProperty("--n3", Math.min(3, span));
      section.style.setProperty("--n5", Math.min(5, span));

      var head = document.createElement("div");
      head.className = "brand-head";
      var h3 = document.createElement("h3");
      h3.textContent = g.brand;
      var cnt = document.createElement("span");
      cnt.className = "mono";
      cnt.textContent = plural(g.count, "MODELL", "MODELLER") + (g.ready.length > 0 && g.soon.length > 0 ? " · " + g.soon.length + " KOMMER SNART" : "");
      var line = document.createElement("span");
      line.className = "line";
      line.setAttribute("aria-hidden", "true");
      head.appendChild(h3);
      head.appendChild(cnt);
      head.appendChild(line);
      section.appendChild(head);

      var members = [];
      if (g.ready.length) {
        var cards = document.createElement("div");
        cards.className = "brand-cards";
        g.ready.forEach(function (item) {
          var el = buildCard(item);
          cards.appendChild(el);
          members.push({ el: el, haystack: item.haystack });
        });
        section.appendChild(cards);
      }
      if (g.soon.length) {
        var soon = document.createElement("div");
        soon.className = "brand-cards brand-cards-soon";
        g.soon.forEach(function (item) {
          var el = buildSoonCard(item);
          soon.appendChild(el);
          members.push({ el: el, haystack: item.haystack });
        });
        section.appendChild(soon);
      }
      grid.appendChild(section);
      groupEls.push({ el: section, members: members });

      var c = chip(g.brand, g.count, "#" + g.id);
      jump.appendChild(c);
      chipEls.push(c);
    });

    function setActive(chipEl) {
      chipEls.forEach(function (c) { c.classList.toggle("is-active", c === chipEl); });
    }

    function applyFilter() {
      var q = search.value.trim().toLowerCase();
      var any = false;
      groupEls.forEach(function (g) {
        var visible = 0;
        g.members.forEach(function (m) {
          var show = !q || m.haystack.indexOf(q) !== -1;
          m.el.hidden = !show;
          if (show) visible++;
        });
        g.el.hidden = visible === 0;
        if (visible) any = true;
      });
      empty.hidden = any;
    }
    search.addEventListener("input", applyFilter);

    // Klikk på et merke tømmer søket (ellers kan målgruppa være skjult) og hopper dit; klikk på "Alle" går til toppen av lista.
    chipEls.forEach(function (c, idx) {
      c.addEventListener("click", function (e) {
        if (search.value) { search.value = ""; applyFilter(); }
        setActive(c);
        var target = idx === 0 ? tab : groupEls[idx - 1].el;
        var header = document.querySelector(".site-header");
        target.style.scrollMarginTop = (header ? header.offsetHeight : 70) + 12 + "px";
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    vehicleGrid.innerHTML = "";
    vehicleGrid.className = "reveal models-overview";
    vehicleGrid.appendChild(toolbar);
    vehicleGrid.appendChild(jump);
    vehicleGrid.appendChild(grid);
    vehicleGrid.appendChild(empty);
  }

  // Variantantall (og variantnavn/produktnummer til søket) finnes bare i detaljkallet per modell, ikke i lista.
  function fetchDetail(slug) {
    return fetch(API_BASE + "/api/public/models/" + encodeURIComponent(slug))
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  fetch(API_BASE + "/api/public/models")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (models) {
      if (!models || models.length === 0) return;

      for (var i = 0; i < countEls.length; i++) {
        countEls[i].textContent = String(models.length);
      }

      if (!vehicleGrid) return;

      var details = Promise.all(models.map(function (m) { return fetchDetail(m.slug); }));
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, DETAIL_TIMEOUT_MS); });
      return Promise.race([details, timeout]).then(function (detailList) {
        var items = models.map(function (m, idx) {
          var d = detailList && detailList[idx];
          var variants = d && d.variants ? d.variants : null;
          var parts = splitModelName(m.name);
          var haystack = [m.name].concat(variants ? variants.map(function (v) { return (v.variantName || "") + " " + (v.productNumber || ""); }) : []).join(" ").toLowerCase();
          return {
            name: m.name,
            slug: m.slug,
            imageUrl: m.imageUrl,
            brand: parts.brand,
            shortName: parts.model || m.name.trim(),
            variantCount: variants ? variants.length : null,
            haystack: haystack
          };
        });
        renderOverview(items);
      });
    })
    .catch(function () {
      // Leave the existing static/placeholder content in place if the API is unreachable.
    })
    .finally(reveal);
})();
