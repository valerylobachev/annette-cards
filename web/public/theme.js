// Applies the theme chosen in Settings before the first paint, so a dark theme does not flash white.
// A separate file, not an inline script: the server's CSP (`default-src 'self'`) blocks inline scripts.
try {
  const theme = localStorage.getItem('annette.theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch (_) {}
