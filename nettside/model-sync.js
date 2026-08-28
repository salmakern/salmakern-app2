(function () {
  var API_BASE = "https://forhandler.salmaker.as";
  var slug = document.body.dataset.modelSlug;
  if (!slug) return;

  var prodGrid = document.getElementById("prodGrid");
  var mainImg = document.getElementById("mainImg");
  var thumbContainer = document.getElementById("thumbContainer");
  var modelTitle = document.getElementById("modelTitle");
  var featList = document.getElementById("featList");
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

  var currentVariants = [];
  var currentVariantIndex = 0;
  var variantNav = null;

  function selectVariant(index) {
    currentVariantIndex = index;
    var items = prodGrid.querySelectorAll(".prod-item");
    items.forEach(function (el, i) {
      el.classList.toggle("active", i === index);
    });
    buildThumbs(currentVariants[index].imageUrls);
    updateVariantNav();
  }

  function updateVariantNav() {
    if (!variantNav) return;
    var multi = currentVariants.length > 1;
    variantNav.style.display = multi ? "" : "none";
    if (!multi) return;
    variantNav.querySelector(".variant-nav-label").textContent =
      currentVariantIndex + 1 + " / " + currentVariants.length;
  }

  function renderVariants(variants) {
    currentVariants = variants;
    prodGrid.innerHTML = "";
    variants.forEach(function (variant, i) {
      var item = document.createElement("div");
      item.className = "prod-item" + (i === 0 ? " active" : "");
      var strong = document.createElement("strong");
      strong.textContent = variant.variantName;
      var span = document.createElement("span");
      span.textContent = "Prod. " + variant.productNumber;
      item.appendChild(strong);
      item.appendChild(span);
      item.addEventListener("click", function () {
        selectVariant(i);
      });
      prodGrid.appendChild(item);
    });

    if (!variantNav) {
      variantNav = document.createElement("div");
      variantNav.className = "variant-nav";
      variantNav.innerHTML =
        '<button type="button" class="variant-nav-btn variant-nav-prev" aria-label="Forrige variant">&#8249; Forrige</button>' +
        '<span class="variant-nav-label"></span>' +
        '<button type="button" class="variant-nav-btn variant-nav-next" aria-label="Neste variant">Neste &#8250;</button>';
      prodGrid.insertAdjacentElement("afterend", variantNav);
      variantNav.querySelector(".variant-nav-prev").addEventListener("click", function () {
        selectVariant((currentVariantIndex - 1 + currentVariants.length) % currentVariants.length);
      });
      variantNav.querySelector(".variant-nav-next").addEventListener("click", function () {
        selectVariant((currentVariantIndex + 1) % currentVariants.length);
      });
    }

    if (variants.length > 0) selectVariant(0);
  }

  function renderEmpty() {
    prodGrid.innerHTML =
      '<div style="background:#fdf0ee;border:1px solid #f5c6c0;border-radius:10px;padding:16px 18px;">' +
      '<p style="font-size:14px;color:#c0392b;font-weight:600;">Ta kontakt for full produktinformasjon og tilbud på denne modellen.</p></div>';
    var galleryMain = document.querySelector(".gallery-main");
    if (galleryMain) {
      var placeholder = document.createElement("div");
      placeholder.className = "img-placeholder";
      placeholder.innerHTML = '<span style="font-size:36px;">📷</span>Legg til bilder her';
      galleryMain.replaceWith(placeholder);
    }
    if (thumbContainer) thumbContainer.remove();
  }

  function renderNotFound() {
    if (modelTitle) modelTitle.textContent = "Modell ikke funnet";
    if (featList) featList.remove();
    if (prodGrid) {
      prodGrid.innerHTML =
        '<p style="font-size:14px;color:#666;">Fant ingen modell med dette navnet. ' +
        '<a href="varebil.html" style="color:#c0392b;">Se alle modeller →</a></p>';
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
        renderNotFound();
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
