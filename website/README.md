# NutriCore website

The public site: an overview of what the application does, an interactive demo
running on a static fixture, and a deep dive on setup, the codebase and
deployment. It is published to GitHub Pages by
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
    ├── data.mjs           figures read out of the repository
    ├── demo-data.mjs      the demo fixture — the only invented data here
    ├── layout.mjs         the page shell shared by all three pages
    ├── pages/
    │   ├── home.mjs       overview, one section per decision in the code
    │   ├── demo.mjs       the reconstructed screens
    │   └── build.mjs      setup, configuration, deployment, CI
    └── assets/
        ├── site.css       the whole design system
        ├── site.js        theme, navigation, reveals, copy buttons
        └── demo.js        demo panels, day switch, search filter
```

## Conventions

- **The palette is the application's**, taken from `src/app/globals.css`: the
  same jade, the same amber for carbohydrate, the same violet for fat. The site
  sits on a warmer paper so it reads as documentation about the tool rather than
  as the tool.
- **Both themes are complete.** No colour is defined only inside a media query,
  and the toggle stores an explicit choice while no stored value means the
  operating system decides — the same three states the application has.
- **Every page works without JavaScript.** The demo renders all of its panels,
  days and search results at build time; the script only hides, shows and
  filters what is already in the HTML.
- **Claims name their file.** If a sentence on the site asserts something about
  how NutriCore behaves, the file that implements it is named nearby, so a
  reader can check and a future editor can tell when it stopped being true.

## Adding a page

Add a module under `src/pages/` that calls `page()` from `src/layout.mjs`,
register it in the `PAGES` map in `build.mjs`, and add it to `NAV` in
`src/layout.mjs`. Links between pages are relative filenames (`demo.html`), so
the site works from a project subpath, a user site or a local directory without
a base URL.
