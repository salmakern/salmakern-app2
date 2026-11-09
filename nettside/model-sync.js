(function () {
  var API_BASE = "https://forhandler.salmaker.as";
  var slug = document.body.dataset.modelSlug;
  if (!slug) return;

  // "Finn forhandler"-knapp i CTA-en nederst, med denne modellen forhåndsvalgt.
  var ctaButtons = document.querySelector(".cta-red .hero-btns");
  if (ctaButtons) {
    var findDealer = document.createElement("a");
    findDealer.href = "finn-forhandler.html?modell=" + encodeURIComponent(slug);
    findDealer.className = "btn btn-outline-on-red";
    findDealer.textContent = "Finn forhandler";
    ctaButtons.insertBefore(findDealer, ctaButtons.lastElementChild);
  }
  // Samme knapp i valgboksen ved innredningene (.mk-cta, se under).
  var mkFinnForhandler = document.getElementById("mkFinnForhandler");
  if (mkFinnForhandler) mkFinnForhandler.href = "finn-forhandler.html?modell=" + encodeURIComponent(slug);

  var prodGrid = document.getElementById("prodGrid");
  var mainImg = document.getElementById("mainImg");
  var thumbContainer = document.getElementById("thumbContainer");
  var modelTitle = document.getElementById("modelTitle");
  var featList = document.getElementById("featList");
  var chipsEl = document.getElementById("variantChips");
  var galleryCaption = document.getElementById("galleryCaption");
  var valgtBox = document.getElementById("mkValgtBox");
  var valgtNavn = document.getElementById("mkValgt");
  var valgtProd = document.getElementById("mkProd");
  // En håndlaget side har sin egen tittel i HTML-en (modell.html står med «Laster …» til svaret kommer). Finnes ikke modellen i
  // portalen (404), skal en håndlaget side beholde tittelen og vise «Kommer snart» med «ta kontakt», ikke «Modell ikke funnet»
  // (gjelder Defender 130, Defender OCTA og Dodge RAM per 2026-11-09: sidene finnes og står i rulleteksten, men ikke i portalen).
  var harStatiskSide = !!modelTitle && modelTitle.textContent.trim() !== "" && modelTitle.textContent.trim().indexOf("Laster") !== 0;
  var modelImageUrl = null;
  var currentImages = [];
  var currentIndex = 0;

  // ── Lightbox (bygges én gang, gjenbrukes) ──────────────────────────
  var lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.innerHTML =
    '<button type="button" class="lightbox-close" aria-label="Lukk">&times;</button>' +
    '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Forrige bilde">&#8249;</button>' +
    '<img class="lightbox-img" alt="">' +
    '<button type="button" class="lightbox-nav lightbox-next" aria-label="Neste bilde">&#8250;</button>' +
    '<span class="lightbox-counter"></span>';
  document.body.appendChild(lightbox);

  var lightboxImg = lightbox.querySelector(".lightbox-img");
  var lightboxCounter = lightbox.querySelector(".lightbox-counter");

  function showLightboxImage() {
    lightboxImg.src = currentImages[currentIndex];
    lightboxCounter.textContent =
      currentImages.length > 1 ? currentIndex + 1 + " / " + currentImages.length : "";
    var multi = currentImages.length > 1;
    lightbox.querySelector(".lightbox-prev").style.display = multi ? "" : "none";
    lightbox.querySelector(".lightbox-next").style.display = multi ? "" : "none";
  }

  function openLightbox(index) {
    if (currentImages.length === 0) return;
    currentIndex = index;
    showLightboxImage();
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
  }

  function lightboxPrev() {
    currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
    showLightboxImage();
  }

  function lightboxNext() {
    currentIndex = (currentIndex + 1) % currentImages.length;
    showLightboxImage();
  }

  lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  lightbox.querySelector(".lightbox-prev").addEventListener("click", lightboxPrev);
  lightbox.querySelector(".lightbox-next").addEventListener("click", lightboxNext);
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lightboxPrev();
    if (e.key === "ArrowRight") lightboxNext();
  });
  var touchStartX = null;
  lightbox.addEventListener("touchstart", function (e) {
    touchStartX = e.touches[0].clientX;
  });
  lightbox.addEventListener("touchend", function (e) {
    if (touchStartX === null) return;
    var delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 40) {
      if (delta > 0) lightboxPrev();
      else lightboxNext();
    }
    touchStartX = null;
  });

  if (mainImg) {
    mainImg.style.cursor = "zoom-in";
    mainImg.addEventListener("click", function () {
      openLightbox(currentIndex);
    });
  }

  // ── Galleri (miniatyrbilder) ────────────────────────────────────────
  function buildThumbs(images) {
    thumbContainer.innerHTML = "";
    var list = images.length > 0 ? images : modelImageUrl ? [modelImageUrl] : [];
    currentImages = list;
    currentIndex = 0;
    list.forEach(function (url, i) {
      var img = document.createElement("img");
      img.src = url;
      img.alt = "";
      if (i === 0) {
        img.classList.add("active");
        mainImg.src = url;
      }
      img.addEventListener("click", function () {
        thumbContainer.querySelectorAll("img").forEach(function (t) {
          t.classList.remove("active");
        });
        img.classList.add("active");
        mainImg.src = url;
        currentIndex = i;
      });
      thumbContainer.appendChild(img);
    });
    if (list.length === 0) {
      mainImg.removeAttribute("src");
    }
  }

  // ── Valg av innredning (2026-11-09, forslag A: galleriet står fast til venstre, valgene til høyre) ──────
  // Variantene vises som en liste med radioknapper (rolle radio, piltaster), og bildene til venstre følger valget. Ved mange
  // varianter kan listen filtreres i grupper, utledet av navnet (ingen data i portalen må endres). Valgboksen under listen
  // (.mk-cta) viser hva som er valgt og er alltid synlig (klebrig nederst).
  var KATEGORIER = ["Standard", "Gulv", "Oppbevaring", "Gummimatte", "Skuffer", "Beskyttelse", "Tilbehør"];
  var MIN_VARIANTER_FOR_FILTER = 8; // under dette er listen kort nok uten filterknapper

  function kategori(navn) {
    var l = String(navn || "").toLowerCase();
    if (l.indexOf("standard ombygging") !== -1) return "Standard";
    if (l.indexOf("skuff") !== -1) return "Skuffer";
    if (l.indexOf("beskyttelse") !== -1) return "Beskyttelse";
    if (l.indexOf("gummimatt") !== -1) return "Gummimatte";
    if (l.indexOf("gulv") !== -1) return "Gulv";
    if (l.indexOf("kasse") !== -1) return "Oppbevaring";
    return "Tilbehør";
  }

  var currentVariants = [];
  var currentVariantIndex = 0;
  var rows = [];
  var aktivtFilter = "Alle";

  function synligeIndekser() {
    var ut = [];
    rows.forEach(function (row, i) {
      if (!row.hidden) ut.push(i);
    });
    return ut;
  }

  function selectVariant(index, settFokus) {
    var v = currentVariants[index];
    if (!v) return;
    currentVariantIndex = index;
    rows.forEach(function (row, i) {
      var paa = i === index;
      row.classList.toggle("on", paa);
      row.setAttribute("aria-checked", paa ? "true" : "false");
      row.tabIndex = paa ? 0 : -1;
    });
    if (settFokus) rows[index].focus();
    var bilder = v.imageUrls || [];
    buildThumbs(bilder);
    // Uten egne bilder viser galleriet modellbildet: si det, så ingen tror det er bilde av akkurat denne løsningen.
    if (galleryCaption) {
      galleryCaption.hidden = bilder.length > 0 || !modelImageUrl;
      galleryCaption.textContent = "Modellbilde · bilder av denne løsningen kommer";
    }
    if (valgtBox) valgtBox.hidden = false;
    if (valgtNavn) valgtNavn.textContent = v.variantName;
    if (valgtProd) valgtProd.textContent = v.productNumber ? "PROD. " + v.productNumber : "";
  }

  // Piltaster som i en vanlig radiogruppe: neste/forrige synlige valg, Home/End.
  function radioTaster(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+← er nettleserens «tilbake», Ctrl/Cmd-kombinasjoner er snarveier: ikke svelg dem
    var tast = e.key;
    var retning = tast === "ArrowDown" || tast === "ArrowRight" ? 1 : tast === "ArrowUp" || tast === "ArrowLeft" ? -1 : 0;
    if (!retning && tast !== "Home" && tast !== "End") return;
    var synlige = synligeIndekser();
    if (synlige.length === 0) return;
    e.preventDefault();
    var pos = synlige.indexOf(currentVariantIndex);
    var neste;
    if (tast === "Home") neste = synlige[0];
    else if (tast === "End") neste = synlige[synlige.length - 1];
    else neste = synlige[(pos + retning + synlige.length) % synlige.length];
    selectVariant(neste, true);
  }

  function settFilter(valg) {
    aktivtFilter = valg;
    if (chipsEl) {
      chipsEl.querySelectorAll(".mk-chip").forEach(function (chip) {
        chip.setAttribute("aria-pressed", chip.dataset.kat === valg ? "true" : "false");
      });
    }
    rows.forEach(function (row) {
      row.hidden = !(valg === "Alle" || row.dataset.kat === valg);
    });
    // Er det valgte skjult av filteret, velges første synlige (ellers står «Valgt» for noe man ikke ser).
    if (rows[currentVariantIndex] && rows[currentVariantIndex].hidden) {
      var synlige = synligeIndekser();
      if (synlige.length > 0) selectVariant(synlige[0]);
    }
  }

  function byggFilter(variants) {
    if (!chipsEl || variants.length < MIN_VARIANTER_FOR_FILTER) return;
    var tall = {};
    variants.forEach(function (v) {
      var k = kategori(v.variantName);
      tall[k] = (tall[k] || 0) + 1;
    });
    var brukte = KATEGORIER.filter(function (k) {
      return tall[k];
    });
    if (brukte.length < 2) return;
    chipsEl.innerHTML = "";
    [["Alle", variants.length]].concat(
      brukte.map(function (k) {
        return [k, tall[k]];
      })
    ).forEach(function (par) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mk-chip";
      chip.dataset.kat = par[0];
      chip.setAttribute("aria-pressed", par[0] === "Alle" ? "true" : "false");
      chip.textContent = par[0];
      var antall = document.createElement("small");
      antall.textContent = par[1];
      chip.appendChild(antall);
      chip.addEventListener("click", function () {
        settFilter(par[0]);
      });
      chipsEl.appendChild(chip);
    });
    chipsEl.hidden = false;
  }

  function renderVariants(variants) {
    currentVariants = variants;
    prodGrid.innerHTML = "";
    rows = [];
    variants.forEach(function (variant, i) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "mk-row";
      row.setAttribute("role", "radio");
      row.setAttribute("aria-checked", "false");
      row.tabIndex = -1;
      row.dataset.kat = kategori(variant.variantName);
      var dot = document.createElement("span");
      dot.className = "mk-dot";
      dot.setAttribute("aria-hidden", "true");
      var navn = document.createElement("b");
      navn.textContent = variant.variantName;
      var antall = (variant.imageUrls || []).length;
      var meta = document.createElement("span");
      meta.className = "meta" + (antall > 0 ? " ok" : "");
      meta.textContent = antall > 0 ? antall + (antall === 1 ? " BILDE" : " BILDER") : "BILDER KOMMER";
      row.appendChild(dot);
      row.appendChild(navn);
      row.appendChild(meta);
      row.addEventListener("click", function () {
        selectVariant(i);
      });
      row.addEventListener("keydown", radioTaster);
      prodGrid.appendChild(row);
      rows.push(row);
    });
    byggFilter(variants);
    if (variants.length > 0) selectVariant(0);
  }

  function renderEmpty() {
    if (chipsEl) chipsEl.hidden = true;
    if (valgtBox) valgtBox.hidden = true;
    prodGrid.removeAttribute("role");
    prodGrid.removeAttribute("aria-label");
    prodGrid.innerHTML =
      '<div style="background:#2d2d2d;border:1px solid #3d3d3d;padding:16px 18px;">' +
      '<p style="font-size:14px;color:#e2725f;font-weight:600;">Ta kontakt for full produktinformasjon og tilbud på denne modellen.</p></div>';
    var galleryMain = document.querySelector(".gallery-main");
    if (galleryMain) {
      // Samme "Kommer snart"-plate som modelllista og Forhandlerportalen (.thumb-placeholder i site.css). Bilderuta
      // (4:3 med rød kant) beholdes, bare tømt, så oppsettet er likt modeller med bilde.
      galleryMain.innerHTML = "";
      var placeholder = document.createElement("div");
      placeholder.className = "thumb-placeholder";
      var plate = document.createElement("span");
      plate.className = "thumb-placeholder-label";
      plate.textContent = "Kommer snart";
      placeholder.appendChild(plate);
      galleryMain.appendChild(placeholder);
    }
    if (thumbContainer) thumbContainer.remove();
  }

  function renderNotFound() {
    if (modelTitle) modelTitle.textContent = "Modell ikke funnet";
    if (featList) featList.remove();
    if (chipsEl) chipsEl.hidden = true;
    if (valgtBox) valgtBox.hidden = true;
    if (prodGrid) {
      prodGrid.removeAttribute("role");
      prodGrid.removeAttribute("aria-label");
      prodGrid.innerHTML =
        '<p style="font-size:14px;color:#9ca3af;">Fant ingen modell med dette navnet. ' +
        '<a href="varebil.html" style="color:#e2725f;">Se alle modeller →</a></p>';
    }
    var galleryMain = document.querySelector(".gallery-main");
    if (galleryMain) galleryMain.remove();
    if (thumbContainer) thumbContainer.remove();
  }

  function renderFeatures(features) {
    if (!featList || !features) return;
    featList.innerHTML = "";
    features.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      featList.appendChild(li);
    });
  }

  fetch(API_BASE + "/api/public/models/" + encodeURIComponent(slug))
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data) {
        if (harStatiskSide) renderEmpty();
        else renderNotFound();
        return;
      }
      if (modelTitle) {
        modelTitle.textContent = data.name;
        document.title = data.name + " – Telemark Salmakerverksted";
      }
      renderFeatures(data.features);
      modelImageUrl = data.imageUrl || null;
      if (!data.variants || data.variants.length === 0) {
        renderEmpty();
        return;
      }
      renderVariants(data.variants);
    })
    .catch(function () {
      renderEmpty();
    });
})();
