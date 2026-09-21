/** iPhone/iPad Safari, where installing means Share → Add to Home Screen (UC-26). iPadOS reports a Mac. */
export function isIosSafari(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && nav.maxTouchPoints > 1)
  // Other iOS browsers add their own token (CriOS, FxiOS, EdgiOS…) and cannot install PWAs the same way.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)
}

/** Running as an installed app (Home Screen), not in a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}
