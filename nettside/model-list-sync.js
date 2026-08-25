(function () {
  var API_BASE = "https://forhandlerportal-umber.vercel.app";

  // Slugs that have their own dedicated, hand-written page on the site.
  // Any slug not in this list is linked through the generic modell.html page instead.
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

  var grid = document.getElementById("modelsGrid");
  if (!grid) return;

  fetch(API_BASE + "/api/public/models")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (models) {
      if (!models || models.length === 0) return;
      grid.innerHTML = "";
      models.forEach(function (model) {
        var a = document.createElement("a");
        a.className = "model-tag";
        a.href = KNOWN_PAGES[model.slug]
          ? model.slug + ".html"
          : "modell.html?slug=" + encodeURIComponent(model.slug);
        a.textContent = model.name;
        grid.appendChild(a);
      });
    })
    .catch(function () {
      // Leave the existing static list in place if the API is unreachable.
    });
})();
