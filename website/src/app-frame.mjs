/**
 * The demo's page shell: the application's own chrome, not the website's.
 *
 * The demo used to be a website page that described the screens in the site's
 * typography. It is now the application - the same stylesheet, the same top
 * bar, the same three destinations, the same cards - running against a fixture
 * instead of a database, with one banner across the top saying so and leading
 * back to the site.
 *
 * Nothing here restyles the application. `assets/app.css` is `src/app/globals.css`
 * copied verbatim by the build, so a change to the product's design reaches
 * this page without anybody remembering to mirror it; `assets/demo.css` adds
 * the banner and the handful of affordances a static page needs, and touches
 * no class the application defines.
 */
import { facts, t } from "./data.mjs";

/** The three destinations of `NAV` in src/components/app-shell.tsx. */
export const SCREENS = [
  { id: "today", label: t("nav.today", {}, "Today"), icon: "◉" },
  { id: "foods", label: t("nav.foods", {}, "Foods"), icon: "⌕" },
  { id: "progress", label: t("nav.progress", {}, "Progress"), icon: "◔" },
];

const BANNER = `Static data for demo only &mdash; click here to go back to the website`;

const navLinks = (className) =>
  SCREENS.map(
    (screen, index) => `<a href="#${screen.id}" data-screen="${screen.id}"${index === 0 ? ' aria-current="page"' : ""}>${
      className === "bottom-nav" ? `<span aria-hidden="true">${screen.icon}</span>` : ""
    }${screen.label}</a>`,
  ).join("\n        ");

/**
 * Without JavaScript nothing can be switched, so nothing is hidden: every
 * screen, every day and every dialog is in the HTML already, and the page
 * becomes one long readable document instead of an empty frame.
 */
const NOSCRIPT_STYLE = `
    [data-screen-panel][hidden],
    [data-day][hidden],
    .demo-day-label[hidden] { display: block !important; }
    .app-dialog:not([open]) {
      display: block;
      position: static;
      width: auto;
      max-width: none;
      margin: 0;
      border: 0;
      border-top: 1px solid var(--line);
      background: transparent;
      color: inherit;
    }
    .app-dialog:not([open]) .icon-btn { display: none; }
    [data-demo-only-with-script] { display: none !important; }`;

export function appPage({ title, description, screens, fab }) {
  return `<!doctype html>
<html lang="en" data-theme="system">
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
<!-- The application's stylesheet, copied out of src/app/globals.css by the build. -->
<link rel="stylesheet" href="assets/app.css" />
<link rel="stylesheet" href="assets/demo.css" />
<!-- The application's own pre-paint theme restore, from src/components/theme-script.tsx. -->
<script>
  (function () {
    try {
      var stored = localStorage.getItem("nutricore-theme") || "system";
      document.documentElement.setAttribute("data-theme", stored);
    } catch { /* Private mode: the media query still decides. */ }
  })();
</script>
<noscript><style>${NOSCRIPT_STYLE}
  </style></noscript>
</head>
<body>

<a class="demo-banner" href="index.html">
  <span class="demo-banner-mark" aria-hidden="true">●</span>
  <span>${BANNER} <span class="demo-banner-arrow" aria-hidden="true">&rarr;</span></span>
</a>

<div class="shell shell--with-fab">
  <header class="topbar">
    <a class="brand" href="#today" data-screen="today">
      <span class="brand-mark" aria-hidden="true">N</span>
      NutriCore
    </a>

    <nav class="nav" aria-label="${t("nav.main", {}, "Main navigation")}">
      ${navLinks("nav")}
    </nav>

    <div class="topbar-actions">
      <div role="group" aria-label="${t("settings.theme", {}, "Theme")}" style="display:flex;gap:2px" data-theme-group>
        <button type="button" class="btn btn-quiet" data-theme-set="light" title="${t("settings.themes.light", {}, "Light")}"><span aria-hidden="true">☀</span><span class="sr-only">${t("settings.themes.light", {}, "Light")}</span></button>
        <button type="button" class="btn btn-quiet" data-theme-set="dark" title="${t("settings.themes.dark", {}, "Dark")}"><span aria-hidden="true">☾</span><span class="sr-only">${t("settings.themes.dark", {}, "Dark")}</span></button>
        <button type="button" class="btn btn-quiet" data-theme-set="system" aria-pressed="true" title="${t("settings.themes.system", {}, "System")}"><span aria-hidden="true">◐</span><span class="sr-only">${t("settings.themes.system", {}, "System")}</span></button>
      </div>
      <button class="btn btn-quiet" type="button" data-demo-inert>${t("nav.signOut", {}, "Sign out")}</button>
      <span class="avatar" title="${"Anna Reuter"}" data-demo-inert><span aria-hidden="true">AR</span><span class="sr-only">${t("nav.account", {}, "Account")}</span></span>
    </div>
  </header>

  <main id="main">
${screens}
  </main>
</div>

<nav class="bottom-nav" aria-label="${t("nav.main", {}, "Main navigation")}">
  ${navLinks("bottom-nav")}
</nav>

${fab}

<p class="demo-toast" role="status" aria-live="polite" data-demo-toast hidden>
  Static demo &mdash; nothing here is saved. <a href="index.html">Back to the website</a> for what the real thing does.
</p>

<footer class="demo-foot">
  <span>A fixture of the NutriCore interface. No database, no requests, nothing stored.</span>
  <span><a href="index.html">Website</a> &middot; <a href="build.html">Run the real thing</a> &middot; <a href="${facts.repo}" rel="noreferrer noopener">Source</a></span>
</footer>

<script src="assets/demo.js"></script>
</body>
</html>
`;
}
