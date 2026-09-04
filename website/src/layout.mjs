/**
 * The page shell every page is poured into.
 *
 * Kept as one function rather than a template engine: three pages do not
 * justify a dependency, and a shell that is plain JavaScript can compute the
 * navigation state, the canonical URL and the JSON-LD block from the same
 * argument that names the page.
 */
import { facts } from "./data.mjs";

const NAV = [
  { href: "index.html", id: "home", label: "Overview" },
  { href: "demo.html", id: "demo", label: "Demo" },
  { href: "build.html", id: "build", label: "Build & deploy" },
];

/** The wordmark, drawn from the same geometry as public/icon.svg. */
const MARK = `<svg class="mark" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
        <rect width="512" height="512" rx="120" fill="currentColor" />
        <path d="M155 363V149h55l96 126V149h51v214h-49L206 231v132z" fill="var(--paper)" />
      </svg>`;

export function page({ id, title, description, body, scripts = [] }) {
  const nav = NAV.map(
    (item) =>
      `<a href="${item.href}"${item.id === id ? ' aria-current="page"' : ""}>${item.label}</a>`,
  ).join("\n          ");

  return `<!doctype html>
<html lang="en" data-page="${id}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="color-scheme" content="light dark" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:type" content="website" />
<link rel="icon" href="assets/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="assets/site.css" />
<!-- Applied before first paint so a dark-theme visitor never sees a white flash. -->
<script>
  try {
    var stored = localStorage.getItem("nutricore-theme");
    if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored;
  } catch (error) { /* Private mode: fall through to the media query. */ }
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
  <div class="masthead-inner">
    <a class="wordmark" href="index.html">
      ${MARK}
      <span>NutriCore</span>
    </a>
    <nav class="nav" aria-label="Primary">
      ${nav}
    </nav>
    <div class="masthead-actions">
      <button class="icon-button" type="button" data-theme-toggle aria-label="Switch colour theme">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="i-sun"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9"/></svg>
        <svg viewBox="0 0 24 24" aria-hidden="true" class="i-moon"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/></svg>
      </button>
      <a class="ghost-link" href="${facts.repo}" rel="noreferrer noopener">
        <svg viewBox="0 0 16 16" aria-hidden="true" class="i-github"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        <span>GitHub</span>
      </a>
    </div>
    <button class="icon-button menu-button" type="button" data-menu-toggle aria-expanded="false" aria-label="Menu">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7h17M3.5 12h17M3.5 17h17"/></svg>
    </button>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      ${MARK}
      <p>
        Nutrition tracking that runs on hardware you own, against food databases
        that ship inside the image.
      </p>
    </div>
    <nav class="footer-nav" aria-label="Site">
      <h2>Site</h2>
      <a href="index.html">Overview</a>
      <a href="demo.html">Interactive demo</a>
      <a href="build.html">Build &amp; deploy</a>
    </nav>
    <nav class="footer-nav" aria-label="Source">
      <h2>Source</h2>
      <a href="${facts.repo}" rel="noreferrer noopener">Repository</a>
      <a href="${facts.repo}/blob/main/README.md" rel="noreferrer noopener">README</a>
      <a href="${facts.repo}/blob/main/docs/ARCHITECTURE.md" rel="noreferrer noopener">Architecture</a>
      <a href="${facts.repo}/blob/main/docs/BODY_SCAN.md" rel="noreferrer noopener">Body scanning</a>
    </nav>
    <div class="footer-meta">
      <h2>Status</h2>
      <p><span class="dot"></span> v${facts.version} &middot; pre-1.0</p>
      <p class="fine">${facts.license}</p>
      <p class="fine">
        Food data is licensed by its publishers. BLS 4.0 and USDA FoodData
        Central carry their own terms; see the repository.
      </p>
    </div>
  </div>
  <div class="footer-rule">
    <span>Built from the repository &mdash; every figure on this site is read out of the source tree at build time.</span>
    <span class="fine">&copy; 2026 NutriCore contributors</span>
  </div>
</footer>

<script src="assets/site.js"></script>
${scripts.map((src) => `<script src="${src}"></script>`).join("\n")}
</body>
</html>
`;
}
