# Paperwork — open-source PDF editor

A Sejda-inspired PDF workspace built with React 18, TypeScript, Vite, Tailwind, PDF.js/react-pdf, and pdf-lib. Express and self-hosted Gotenberg convert Office and text documents. MIT-licensed application code; no paid SDK, license key, account, or AI service is required. This is an independent project, not affiliated with Sejda.

**Delivery status:** the app, real PDF export engine, conversion API, tests, and deployment configuration are implemented. Automated tests and the production build have been run; see [TESTING.md](TESTING.md) for results and unverified gates. The hosted static edition supports local PDF editing. Non-PDF conversion requires the included Node/Gotenberg service. Do not treat this initial release as a completed security audit, universal PDF compatibility guarantee, or an already load-tested production service.

## Run locally

Prerequisites: **Node.js 22.13+** (or Node 24 LTS), npm, and Docker Engine with Compose v2. Node 20.19+ is technically supported by the selected toolchain; Node 22+ is the recommended baseline. No Python is needed to run or test the application.

From the project root:

```bash
npm ci
docker compose up -d          # Gotenberg, host loopback port 3001
```

In one terminal:

```bash
cd backend
npm run dev                  # API on http://localhost:4000
```

In a second terminal:

```bash
cd frontend
npm run dev                  # Editor on http://localhost:5173
```

The requested independent installation commands also work inside the npm workspace:

```bash
cd backend && npm install && npm run dev
# In another terminal, starting at project root:
cd frontend && npm install && npm run dev
```

The root lockfile is authoritative. Prefer `npm ci` at root for reproducibility. The postinstall script copies the PDF.js character maps, fallback fonts, and WASM decoders locally, so rendering does not depend on a third-party CDN. The PDF worker is bundled by Vite.

For the complete stack with no local Node processes:

```bash
docker compose --profile full up -d --build
# Open http://localhost:8080
```

Linux users can run the same OCI images using Podman and a compatible Compose provider. Rootless networking and internal network support depend on that provider; the delivered Compose configuration targets Docker Compose and has not been validated with Podman.

## What works

| Tool / flow                 | Behavior                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| PDF upload                  | Local-only parsing and editing; original source bytes are preserved                |
| DOCX / PPTX                 | Validated Office archives converted through Gotenberg LibreOffice                  |
| HTML / HTM / Markdown / TXT | UTF-8 input sanitized and converted through Gotenberg Chromium                     |
| Existing text               | Click to edit; blue dashed box, multiline input, floating formatting bar           |
| Formatting                  | Helvetica, Times, Courier; all 12 bold/italic variants; size and color             |
| Apply changes               | Covers original text and writes real PDF text at its original transformed baseline |
| Added text                  | Click empty space with Text selected                                               |
| Whiteout                    | Drag a cover rectangle and choose its color                                        |
| Annotate                    | Drag a translucent highlight rectangle                                             |
| Shapes                      | Draw a rectangle or ellipse; resize, move, rotate, or remove before applying       |
| Images                      | Place PNG/JPEG, adjust dimensions and position                                     |
| Sign                        | Place a typed italic signature; not a cryptographic digital signature              |
| Links                       | Create actual PDF URI link annotations by dragging a target area                   |
| Forms                       | Create new fillable text fields with names and default values                      |
| Undo / redo                 | Up to 100 complete edit transactions; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z              |
| Navigation                  | Page input, previous/next, virtualized thumbnail window, zoom and fit to width     |
| Download                    | Applies any pending edits and downloads the resulting PDF                          |

Click **Done**, select another object/tool, or press Escape inside the text box to finish a draft. Apply commits the whole workspace and resets the undo history. Select added objects with the Text tool. Move selected objects using the inspector arrows. There is no server-side PDF session, account, autosave, or document history. Download before closing the tab.

## Configuration

Defaults work without any `.env` file. Environment examples live in each workspace. Vite reads `frontend/.env.local` automatically. For the Node backend, export variables in your shell, configure the process manager, or use Node's environment-file option:

```bash
# After copying backend/.env.example to backend/.env and editing it:
cd backend
node --env-file=.env --import tsx src/index.ts
```

| Variable                 | Default                                       | Purpose                                                         |
| ------------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| `GOTENBERG_URL`          | `http://127.0.0.1:3001`                       | Trusted conversion service; Docker uses `http://gotenberg:3000` |
| `PORT`                   | `4000`                                        | Backend HTTP port                                               |
| `CORS_ORIGINS`           | `http://localhost:5173,http://localhost:4173` | Exact allowed frontend origins, comma separated                 |
| `CONVERSION_CONCURRENCY` | `2`                                           | Per-process upper bound on uploads plus conversion jobs, 1–16   |
| `UPLOAD_DIR`             | `uploads` relative to backend cwd             | Private, temporary upload directory                             |
| `TRUST_PROXY_HOPS`       | `0`                                           | Exact number of trusted reverse proxies; do not set blindly     |
| `VITE_API_URL`           | empty                                         | Build-time API origin; empty means same-origin `/api`           |

No secret belongs in a `VITE_` variable: these values are public frontend configuration. Never accept a user-provided Gotenberg URL.

## API

`POST /api/convert`: multipart form with exactly one file named `file`. Returns PDF bytes with `Content-Type: application/pdf` and `Cache-Control: no-store`. Returning bytes instead of a public upload URL avoids retaining exposed documents.

```bash
curl -f http://localhost:4000/api/convert \
  -F file=@tests/fixtures/sample.docx -o converted.pdf
```

`GET /api/health` reports process liveness and active conversion count. `GET /api/ready` checks upstream Gotenberg health. Errors use `{ "error": "Actionable message" }` with appropriate 400, 403, 413, 415, 422, 429, 502, 503, or 504 status. Capacity rejection includes `Retry-After: 5`.

Limits: 25 MB uploaded file, 5 MB textual input, 50 MB converted output, 500 PDF pages in the editor, 8 MB / 25 megapixels per inserted image, 100 MB declared expanded Office archive, 5,000 ZIP entries. Rate limiting permits 30 conversions per IP per 15 minutes by default.

## Conversion security and privacy

- PDFs never go to the backend through the normal UI. Images are read into local memory.
- Non-PDF conversion uploads are private, randomly named, removed in `finally`, and not served through Express. Abandoned matching uploads older than 10 minutes are cleaned at startup. Full Docker mode uses temporary memory-backed storage.
- Office validation inspects the ZIP structure, decompression sizes, expected document parts, XML declarations and external relationships. Macros, embedded objects, ActiveX, XML entities, and external linked images are rejected. A filename or MIME type alone is not trusted.
- Uploaded HTML loses JavaScript, iframes, event handlers, active content, arbitrary styles and remote images. Only a conservative formatting subset and embedded PNG/JPEG data images remain. Markdown passes through the same sanitizer.
- Gotenberg has JavaScript, download-from, webhooks, and outbound HTTP(S) resources disabled. Its Docker network is internal and isolated from the frontend. Gotenberg 8.34.0 adds upstream LibreOffice restrictions on linked untrusted resources; do not silently downgrade the image.
- The API bounds jobs, applies timeouts, sanitizes errors, restricts allowed browser origins, and avoids logging uploaded filenames or contents. The full deployment adds reverse-proxy size limits and a Content Security Policy.

These controls reduce exposure; they do not make complex document parsers invulnerable. CORS is **not authentication**. Keep local ports loopback-bound. Before offering public conversion, add authenticated admission or an appropriate public-service abuse policy at the ingress, distributed rate limiting, TLS, patched images, egress controls, and operational monitoring. Run the real conversion gate against the exact images you deploy.

## PDF geometry and accepted limits

`textExtractor.ts` reads PDF.js text runs and normalizes the complete `[a,b,c,d,e,f]` transform into a local glyph coordinate system. It multiplies that matrix by the page viewport for CSS placement, preserving text rotation, shear, horizontal scaling, crop translation, and page rotation. Export pushes the same affine transform around pdf-lib drawing commands. No `pageHeight - y` shortcut is used for general placement.

Text runs remain separate deliberately; blindly grouping nearby runs can merge different columns or formats. Newlines are supported within each edited run. The per-character helper estimates advances from a caller-provided text measurer; it does not claim exact glyph positions for ligatures or custom kerning.

Important limitations:

1. **Whiteout is not redaction.** Covered text remains searchable/extractable in the content stream. Never use this feature to remove confidential information. Hidden original text may be selectable again after reimport. Use a dedicated verified redaction tool for that task.
2. Fonts are approximated with StandardFonts. Family/weight detection is heuristic. Existing text color is not extracted from graphics operators; the replacement starts with the editor's ink color. Choose color and background cover manually when necessary.
3. StandardFonts support Latin/WinAnsi text, not arbitrary Unicode, emoji, Arabic shaping, or CJK. Export rejects unsupported characters clearly instead of silently replacing them. Custom Unicode embedding/shaping is a future extension.
4. No OCR, text-as-path editing, vertical text layout, paragraph reflow, background reconstruction, or perfect custom-font matching. Expanded text may overlap adjacent content. Cover colors cannot reconstruct gradients or images.
5. Forms create new text fields; existing form-field editing and existing-link editing are not implemented. Created form widgets use rectangular page bounds; rotated form appearances may differ from the on-page placeholder.
6. Password-protected documents are rejected. Editing digitally signed PDFs may invalidate existing signatures. Typed signatures provide a visual mark only.
7. Apply resets object/undo state. Reimported annotations/shapes are ordinary PDF content, not editable workspace objects. Closing/reloading loses unapplied edits.
8. HTML conversion prioritizes static, safe content. External stylesheets, fonts, images, scripts, and complex layout do not survive sanitization. Embed resources or convert the original document yourself if those are essential.
9. Large PDFs and exports consume browser memory; pdf-lib loads the complete file. Rendering is page-oriented with a bounded thumbnail window, but this is not a streaming document editor. No large-scale load test has been performed.

## Build, test, and deploy

```bash
npm run typecheck
npm test
npm run build
docker compose up -d
npm run test:conversion       # actual DOCX/PPTX/HTML/MD/TXT conversion gate
npm audit --omit=dev
```

The build produces the static frontend in `dist/` and the Express backend in `backend/dist/`. `npm run build` also creates a downloadable source archive for the hosted editor. See [TESTING.md](TESTING.md) for the scope and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and scaling. `.github/workflows/ci.yml` runs unit/component tests, the build, and the real Gotenberg conversion gate in a Docker-capable runner.

## Project layout

```text
frontend/src/components/   editor workspace, modal
frontend/src/utils/        affine geometry, extraction, export, history, sample PDF
frontend/src/types.ts      typed text blocks, edits, page metadata
backend/src/              API, conversion, validation, errors
backend/tests/            API, sanitization, Office validation, live conversion gate
tests/                    geometry, export, extraction, component tests and fixtures
scripts/                  PDF asset preparation, source packaging
docker-compose.yml        isolated Gotenberg and optional complete stack
```

## Primary references and licenses

- [React-PDF documentation](https://github.com/wojtekmaj/react-pdf) and [PDF.js API](https://mozilla.github.io/pdf.js/api/) — MIT / Apache-2.0.
- [pdf-lib API](https://pdf-lib.js.org/docs/api/) — MIT.
- [Gotenberg configuration](https://gotenberg.dev/docs/configuration) and its documented HTML conversion route — MIT service, with separately licensed bundled software.
- [Express](https://expressjs.com/), [Multer](https://github.com/expressjs/multer), [sanitize-html](https://github.com/apostrophecms/sanitize-html), React, Vite, Tailwind and Lucide use open-source licenses. Gotenberg's bundled LibreOffice and Chromium retain their upstream licenses.

The application license is in [LICENSE](LICENSE). Package licenses remain with their respective owners. The included Northline sample is fictional and created for this project.
