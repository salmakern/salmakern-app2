(function () {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var els = document.querySelectorAll(".reveal, .rule");
  if (!els.length) return;

  els.forEach(function (el) {
    el.classList.add("will-reveal");
  });

  // Vises når toppen av elementet er 40 px inne i skjermen - IKKE når en andel (f.eks. threshold: 0.15) av
  // elementet er synlig. En andel av et høyt element er høyere enn selve skjermen: modelllista på varebil.html
  // er ca. 5000 px høy på mobil, 15 % av det er ca. 750 px, og på telefoner med synlig høyde under det ble listen
  // aldri synlig (målt 2026-10-15: 375x664 og 375x500 aldri, større skjermer akkurat så vidt).
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0, rootMargin: "0px 0px -40px 0px" }
  );

  els.forEach(function (el) {
    observer.observe(el);
  });
})();
