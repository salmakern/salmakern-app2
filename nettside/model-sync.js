(function () {
  var API_BASE = "https://forhandlerportal-umber.vercel.app";
  var slug = document.body.dataset.modelSlug;
  if (!slug) return;

  var prodGrid = document.getElementById("prodGrid");
  var mainImg = document.getElementById("mainImg");
  var thumbContainer = document.getElementById("thumbContainer");
  var modelImageUrl = null;

  function buildThumbs(images) {
    thumbContainer.innerHTML = "";
    var list = images.length > 0 ? images : (modelImageUrl ? [modelImageUrl] : []);
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
      });
      thumbContainer.appendChild(img);
    });
    if (list.length === 0) {
      mainImg.removeAttribute("src");
    }
  }

  function renderVariants(variants) {
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
        prodGrid.querySelectorAll(".prod-item").forEach(function (el) {
          el.classList.remove("active");
        });
        item.classList.add("active");
        buildThumbs(variant.imageUrls);
      });
      prodGrid.appendChild(item);
    });
    if (variants.length > 0) buildThumbs(variants[0].imageUrls);
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

  fetch(API_BASE + "/api/public/models/" + slug)
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (!data || !data.variants || data.variants.length === 0) {
        renderEmpty();
        return;
      }
      modelImageUrl = data.imageUrl || null;
      renderVariants(data.variants);
    })
    .catch(function () {
      renderEmpty();
    });
})();
