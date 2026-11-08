// Google Analytics (GA4). Loaded only when VITE_GA_ID is set at build time.

/**
 * 環境変数 VITE_GA_ID に測定 ID があれば gtag.js を読み込み、計測を始める。
 * 未設定なら何もしない（開発時など）。
 */
export function initAnalytics() {
  const id = import.meta.env.VITE_GA_ID;
  if (!id) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}
