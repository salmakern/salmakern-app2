(function () {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var els = document.querySelectorAll(".reveal, .rule");
  if (!els.length) return;

  els.forEach(function (el) {
    el.classList.add("will-reveal");
  });

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  els.forEach(function (el) {
    observer.observe(el);
  });
})();
