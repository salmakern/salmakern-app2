// Roterende hero på forsiden: viser profilbildet til hver modell vi har, hentet live fra
// Forhandlerportalens offentlige API (samme kilde som model-list-sync.js). Alle bildene ligger i
// NØYAKTIG samme ramme (.hero-media = absolutt, inset 0, object-fit: cover, se site.css), så
// størrelsen er lik uansett bilde. Det statiske bildet i HTML-en (hero-bil.jpg) vises først og er
// fallback: svarer ikke API-et, finnes det under to bilder, eller ønsker besøkende redusert
// bevegelse, er siden uendret og uten feil.
// Originalbildene er opptil 4 MB, så de hentes via portalens egen bildeforminskning (/api/bilde,
// 46-275 KB WebP). Bare neste bilde forhåndslastes, ikke alle på en gang.
(function () {
  var API_BASE = "https://forhandler.salmaker.as";
  var INTERVAL_MS = 6000;       // tid hvert bilde står
  var FADE_MS = 1500;           // kryssovergang (må tilsvare transition i site.css)
  var LOAD_TIMEOUT_MS = 8000;   // et bilde som ikke lastes innen dette hoppes over
  var WIDTHS = [828, 1200, 1920]; // standardbredder i Next.js sin bildeoptimalisering

  // Slugs som har egen, håndlaget side - alt annet går via modell.html?slug=X (hold lik model-list-sync.js).
  var KNOWN_PAGES = {
    "kia-ev9": true, "mercedes-gls": true, "mercedes-g": true,
    "land-rover-defender-110": true, "land-rover-defender-130": true, "land-rover-defender-octa": true,
    "land-rover-discovery-5": true, "kgm-rexton": true, "dodge-ram": true, "dodge-durango": true,
    "mercedes-eqv": true, "mercedes-vito": true, "mercedes-vklasse": true,
    "toyota-lc-150": true, "toyota-lc-250": true, "vw-id-buzz-kort": true, "vw-id-buzz-lang": true
  };

  var hero = document.querySelector(".hero");
  var first = hero && hero.querySelector(".hero-media");
  var gradient = hero && hero.querySelector(".hero-gradient");
  if (!hero || !first || !gradient) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function optimized(url, width) {
    // Portalens egen bildeforminskning (live siden 6.11) i stedet for Next.js sin egen
    // /_next/image - unngår Vercel sin bildekvote helt. Nøyaktig denne formen/rekkefølgen
    // (bredde må være en av 64/128/256/384/640/828/1200/1920, q nøyaktig 75, ingen andre
    // parametre), ellers svarer portalen 400 - se supabase/README.md i forhandlerportal-app.
    return API_BASE + "/api/bilde?url=" + encodeURIComponent(url) + "&w=" + width + "&q=75";
  }
  function pageFor(slug) {
    return KNOWN_PAGES[slug] ? slug + ".html" : "modell.html?slug=" + encodeURIComponent(slug);
  }

  fetch(API_BASE + "/api/public/models")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (models) {
      var slides = (models || []).filter(function (m) { return m && m.imageUrl && m.slug; });
      if (slides.length >= 2) start(slides);
    })
    .catch(function () { /* behold det statiske bildet */ });

  function start(slides) {
    var current = first;
    var index = -1;
    var timer = null;

    var label = document.createElement("a");
    label.className = "hero-modell mono";
    label.hidden = true;
    hero.appendChild(label);

    first.setAttribute("data-static", "1");
    first.classList.add("is-active");
    hero.classList.add("has-slides");

    // Lager <img> for et bilde (og starter nedlastingen). Cachet, så hvert bilde lages bare én gang.
    function load(slide) {
      if (slide.el) return slide.el;
      var img = document.createElement("img");
      img.className = "hero-media";
      img.alt = slide.name || "";
      img.decoding = "async";
      img.sizes = "100vw";
      img.srcset = WIDTHS.map(function (w) { return optimized(slide.imageUrl, w) + " " + w + "w"; }).join(", ");
      img.src = optimized(slide.imageUrl, 1200);
      slide.el = img;
      return img;
    }

    function whenLoaded(img, ok, fail) {
      var done = false;
      function finish(fn) { if (!done) { done = true; clearTimeout(guard); fn(); } }
      var guard = setTimeout(function () { finish(fail); }, LOAD_TIMEOUT_MS);
      if (img.complete && img.naturalWidth) return finish(ok);
      img.addEventListener("load", function () { finish(ok); }, { once: true });
      img.addEventListener("error", function () { finish(fail); }, { once: true });
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(next, INTERVAL_MS);
    }

    function show(slide, img) {
      hero.insertBefore(img, gradient);
      void img.offsetWidth; // gjør at overgangen starter fra gjennomsiktig
      var old = current;
      old.classList.remove("is-active");
      old.classList.add("is-leaving");
      img.classList.add("is-active");
      current = img;
      label.hidden = false;
      label.textContent = (slide.name || "") + " →";
      label.href = pageFor(slide.slug);
      setTimeout(function () {
        old.classList.remove("is-leaving");
        if (old.getAttribute("data-static")) old.parentNode && old.parentNode.removeChild(old);
      }, FADE_MS + 100);
      load(slides[(index + 1) % slides.length]); // forhåndslast neste
      schedule();
    }

    function next() {
      timer = null;
      if (document.hidden) return; // visibilitychange tar opp igjen
      var tries = slides.length;
      (function attempt() {
        if (!slides.length || tries-- <= 0) { schedule(); return; }
        index = (index + 1) % slides.length;
        var slide = slides[index];
        whenLoaded(load(slide), function () { show(slide, slide.el); }, function () {
          slides.splice(index, 1); // bildet kan ikke lastes: dropp det og prøv neste
          index--;
          attempt();
        });
      })();
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (!timer) schedule();
    });

    load(slides[0]); // forhåndslast første bilde mens det statiske vises
    schedule();
  }
})();
