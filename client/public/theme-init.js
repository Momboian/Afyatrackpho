// Applies the saved theme (light or dark) before the page draws, so there is no white flash in dark mode.
(function () {
  try {
    if (localStorage.getItem('afyatrack.theme') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) { /* storage blocked: keep the default light theme */ }
})();
