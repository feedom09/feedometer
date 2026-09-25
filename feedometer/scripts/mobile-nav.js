(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var btn = document.getElementById('nav-hamburger');
  if (!header || !btn) return;

  function setOpen(open) {
    header.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!header.classList.contains('menu-open'));
  });

  document.addEventListener('click', function (e) {
    if (!header.classList.contains('menu-open')) return;
    if (!header.contains(e.target)) setOpen(false);
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768) setOpen(false);
  });
})();
