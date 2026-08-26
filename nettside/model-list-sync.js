(function () {
  var API_BASE = "https://forhandler.salmaker.as";

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

  var vehicleGrid = document.getElementById("modelsGrid");
  var modulGrid = document.getElementById("modulGrid");
  if (!vehicleGrid && !modulGrid) return;

  function buildTag(model) {
    var a = document.createElement("a");
    a.className = "model-tag-img";
    a.href = KNOWN_PAGES[model.slug]
      ? model.slug + ".html"
      : "modell.html?slug=" + encodeURIComponent(model.slug);

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    if (model.imageUrl) {
      var img = document.createElement("img");
      img.src = model.imageUrl;
      img.alt = model.name;
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      var placeholder = document.createElement("span");
      placeholder.className = "thumb-placeholder";
      placeholder.textContent = model.category === "MODULSYSTEM" ? "📦" : "🚐";
      thumb.appendChild(placeholder);
    }

    var label = document.createElement("div");
    label.className = "label";
    label.textContent = model.name;

    a.appendChild(thumb);
    a.appendChild(label);
    return a;
  }

  fetch(API_BASE + "/api/public/models")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (models) {
      if (!models || models.length === 0) return;

      var vehicles = models.filter(function (m) {
        return m.category !== "MODULSYSTEM";
      });
      var modulSystems = models.filter(function (m) {
        return m.category === "MODULSYSTEM";
      });

      if (vehicleGrid && vehicles.length > 0) {
        vehicleGrid.innerHTML = "";
        vehicles.forEach(function (model) {
          vehicleGrid.appendChild(buildTag(model));
        });
      }

      if (modulGrid && modulSystems.length > 0) {
        modulGrid.innerHTML = "";
        modulSystems.forEach(function (model) {
          modulGrid.appendChild(buildTag(model));
        });
      }
      // If there are no Modul-System models yet, leave the "kommer snart"
      // placeholder already in the HTML in place.
    })
    .catch(function () {
      // Leave the existing static/placeholder content in place if the API is unreachable.
    });
})();
