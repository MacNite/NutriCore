# NutriCore website

The public site: an overview of what the application does, the application's
own interface running on a static fixture, and a deep dive on setup, the
codebase and deployment. It is published to GitHub Pages by
[`.github/workflows/website.yml`](../.github/workflows/website.yml).

```
node website/build.mjs --check          # build into website/dist
python3 -m http.server -d website/dist 4000
```

There are no dependencies and no install step. The generator is plain Node
reading this repository.

## Why there is a build step at all

Three pages of HTML do not need a framework. What they do need is the one thing
hand-written HTML cannot do: read the repository. Every figure on the site —
the food counts and dataset versions, the nutrient total and its vitamin and
mineral split, the number of Prisma models, the number of documented settings,
the test and Playwright-suite counts, the Node and PostgreSQL versions — is
derived at build time in [`src/data.mjs`](src/data.mjs) from
`datasets/bundled/manifest.json`, `src/lib/nutrients.ts`,
`prisma/schema.prisma`, `.env.example`, `package.json`, `src/`, `tests/`,
`e2e/`, the `Dockerfile` and `docker-compose.yml`. Every read falls back rather
than throwing, so the site still builds from a checkout without the dataset
artifacts. A number typed into a page is a number that goes stale silently; a
number read out of the source tree cannot.

`--check` verifies the output before it is published: no internal link may
point at a page that was not emitted, no referenced asset may be missing, and
no page may come out empty.

## Layout

```
website/
├── build.mjs              the generator, and the --check pass
└── src/
    ├── data.mjs           figures, strings and nutrients read out of the repository
    ├── demo-data.mjs      the demo fixture — the only invented data here
    ├── layout.mjs         the page shell the two written pages share
    ├── app-frame.mjs      the demo's shell: the application's own chrome
    ├── pages/
    │   ├── home.mjs       overview, one section per decision in the code
    │   ├── demo.mjs       the application's screens, on the fixture
    │   └── build.mjs      setup, configuration, deployment, CI
    └── assets/
        ├── site.css       the design system of the two written pages
        ├── site.js        theme, navigation, reveals, copy buttons
        ├── demo.css       the demo banner, and nothing the application styles
        └── demo.js        screens, day switch, dialogs, search filter
```

## Conventions

- **The two written pages quote the application's palette**, taken from
  `src/app/globals.css`: the same jade, the same amber for carbohydrate, the
  same violet for fat, on a warmer paper so they read as documentation about the
  tool rather than as the tool. The demo does not quote it — it loads
  `globals.css` itself and is the tool.
- **The demo says what it is.** One banner across the top of every screen,
  saying the data is static and leading back to the site, and a line under every
  control a fixture cannot honour. Nothing else on the page pretends to be
  documentation: the interface is the argument.
- **Both themes are complete.** No colour is defined only inside a media query,
  and the toggle stores an explicit choice while no stored value means the
  operating system decides — the same three states the application has.
- **Every page works without JavaScript.** The demo renders every screen, both
  days, every meal dialog and every food at build time; the script only hides,
  shows and filters what is already in the HTML. With the script off, the page
  stops hiding them and becomes one long readable document.
- **Claims name their file.** If a sentence on the site asserts something about
  how NutriCore behaves, the file that implements it is named nearby, so a
  reader can check and a future editor can tell when it stopped being true.

## Adding a page

Add a module under `src/pages/` that calls `page()` from `src/layout.mjs`
(`appPage()` from `src/app-frame.mjs` is the demo's shell, not a general one),
register it in the `PAGES` map in `build.mjs`, and add it to `NAV` in
`src/layout.mjs`. Links between pages are relative filenames (`demo.html`), so
the site works from a project subpath, a user site or a local directory without
a base URL.
