# Booklet Imposer

Turns a PDF into a print-ready saddle-stitch booklet, entirely in the browser.
The server only delivers static files; documents are never uploaded.

## Run it

With the published image (replace `OWNER` with the GitHub account or
organisation that hosts this repository):

```sh
docker run -d -p 8080:8080 --read-only --tmpfs /tmp ghcr.io/OWNER/pdf-booklet-imposer:latest
```

Or build it yourself:

```sh
docker compose up -d --build     # http://localhost:8080
```

The image is nginx (unprivileged, port 8080) serving the built app, for
`linux/amd64` and `linux/arm64`. It uses relative URLs, so it also works
behind a reverse proxy under a sub-path. `/healthz` answers `ok` for health
checks. There is nothing to configure and no data to persist.

## Using it

1. Drop a PDF on the page, or try the built-in sample booklet.
2. Step through the sheets to check the page order. The coloured guides show
   margin, trim, bleed and fold.
3. Download the booklet and print it double-sided at 100 %. A short print
   recipe with the right dialog settings appears after each download.

## Features

- **Imposition**: pages are reordered two-up for folding; the page count is
  padded to a multiple of four (blanks at the end or before the back cover).
- **Margins and scaling**: a margin is kept free on every sheet edge and the
  booklet, including bleed and marks, is scaled down to fit. Scaling can also
  fill the sheet or be switched off, and the sheet can be sized automatically.
- **Bleed and crop marks**: bleed is entered manually (default 3 mm on every
  edge) or read from the PDF's TrimBox/BleedBox. Bleed is printed on the outer
  edges and into the gutter, never across the fold. Crop marks and fold marks
  are on by default.
- **Creep and centre gutter**: each sheet nested inside another is shifted
  towards the spine by one paper thickness, derived from paper weight and
  type or entered directly. The automatic gutter is twice the total creep, so
  the innermost pages meet exactly at the fold and no content is lost. Crop
  marks follow the shifted pages.
- **Office duplex**: back sides are turned 180° for printers that flip on the
  long edge (the default), sheets can be output in portrait, and fronts and
  backs can be exported separately for manual duplexing.
- **Duplex offset calibration**: print the calibration sheet double-sided,
  hold it against a light with the back facing you, read the two rulers and
  add the values to the X/Y offset. Back sides are shifted to compensate.
  Reprinting the sheet verifies the result (both lines on 0). The sheet lists
  the settings it was made with. The procedure has been verified in print.
- **Templates**: any set of settings, including the duplex offset, can be
  saved under a name, re-applied, updated and deleted. Templates live in the
  browser; export them to a JSON file to move them to another browser.

Settings and templates are kept in the browser's local storage. New versions
keep what you saved: changed defaults only apply to settings you never touched.

## Limits

- One signature (saddle stitch). Very thick books need multiple signatures,
  which this tool does not produce.
- Left-to-right binding only.
- Password-protected PDFs must be unlocked first.
- Section animations and some layout details need a current browser; older
  ones fall back to plainer behaviour.

## Development

The project uses [Vite+](https://viteplus.dev) (`vp`) for the dev server,
formatting, linting, type checks, tests and the build.

```sh
vp install       # install dependencies
vp run dev       # dev server
vp check         # format, lint and type checks (vp check --fix to apply fixes)
vp test          # unit tests (layout maths, PDF output)
vp run test:e2e  # browser tests (Playwright) against a fresh build
vp run build     # production build to dist/
```

`vp run dev` and `vp run build` go through the package scripts, which first
copy the pdf.js runtime assets into `public/pdfjs`. Without the `vp` CLI
installed, `npm install` and `npm run dev|check|test|build` do the same.

| Path                                  | Purpose                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| `src/lib/layout.ts`                   | Page order, scaling, creep and gutter (pure maths)             |
| `src/lib/source.ts`                   | Page boxes, bleed detection, page rotation                     |
| `src/lib/impose.ts`                   | Draws the sheets with pdf-lib                                  |
| `src/lib/calibration.ts`              | Duplex calibration sheet                                       |
| `src/lib/persist.ts`                  | Saved settings: storage format and migration                   |
| `src/lib/sample.ts`                   | Built-in sample booklet                                        |
| `src/lib/preview.ts`                  | pdf.js preview                                                 |
| `src/main.ts`                         | App shell: state, settings form, preview, wiring               |
| `src/ui/templates.ts`                 | Settings templates                                             |
| `src/ui/onboarding.ts`                | First-booklet tips and the bleed question                      |
| `src/ui/sections.ts`                  | Sidebar accordion with pinned headings                         |
| `src/ui/diagrams.ts`                  | Sidebar diagrams and the preview guide overlay                 |
| `src/ui/dropzone.ts`, `src/ui/dom.ts` | Drag and drop, small DOM helpers                               |
| `src/style.css`                       | Styles; sizes and timings shared with script are CSS variables |
| `e2e/`                                | Browser tests                                                  |

The browser tests live in `e2e/`. They need a browser once:
`npx playwright install chromium`, or set `E2E_CHANNEL=chrome` to use an
installed Chrome. Set `E2E_BASE_URL` to test something already running, for
example the Docker image on `http://localhost:8080/`.

### Continuous delivery

`.github/workflows/publish.yml` runs on every push to `main`:

1. It builds the image. The Docker build runs `vp check` and the unit tests.
2. It starts that image and runs the browser tests against it, so nginx, the
   security headers and the built files are tested as they will ship.
3. Only then does it push `ghcr.io/OWNER/REPO:latest` and `:sha-<commit>` for
   amd64 and arm64.

It needs no secrets beyond the built-in `GITHUB_TOKEN`. The package is private
on first publish; change its visibility in the repository's package settings
if others should pull it.

## Licence

Copyright © the Booklet Imposer contributors. Licensed under the
[European Union Public Licence v. 1.2](LICENSE) (EUPL-1.2).

Bundled third-party components keep their own licences:
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), and the
[Archivo](https://github.com/Omnibus-Type/Archivo) and
[IBM Plex Mono](https://github.com/IBM/plex) typefaces (SIL OFL 1.1).
