/* This script changes only the UI palette, not tree data or editor state. */
(() => {
  const STORAGE_KEY = 'syntax-tree-builder-color-mode-v1';
  let initialMode = 'light';

  try {
    if (localStorage.getItem(STORAGE_KEY) === 'dark') {
      initialMode = 'dark';
    }
  } catch (_) {
    // Private browsing or blocked storage: stay in light mode.
  }

  document.documentElement.dataset.theme = initialMode;

  const syncButton = () => {
    const button = document.getElementById('themeToggle');
    if (!button) return;

    const isDark = document.documentElement.dataset.theme === 'dark';
    button.textContent = isDark ? '☀ Light mode' : '☾ Dark mode';
    button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('aria-pressed', String(isDark));
    button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  };

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('themeToggle');
    if (!button) return;

    button.addEventListener('click', () => {
      const nextMode = document.documentElement.dataset.theme === 'dark'
        ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextMode;

      try {
        localStorage.setItem(STORAGE_KEY, nextMode);
      } catch (_) {
        // Theme still switches for this page if storage is unavailable.
      }

      syncButton();
      // The canvas is an SVG, so it must redraw its own theme colors.
      document.dispatchEvent(new Event('syntax-tree-theme-change'));
    });

    syncButton();
  });
})();
