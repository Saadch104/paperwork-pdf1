# Validation report

This report distinguishes tests that ran here from gates requiring a different runtime. It is not a claim that every possible PDF, browser, or deployment case has been tested.

## Executed checks

Observed final automated result: **76 passed, 5 explicitly skipped** across eight test files. The five skipped cases are the real Gotenberg integration tests described below.

The production export-worker bundle was also executed through a Node worker-thread messaging shim and returned a parseable PDF. This verifies its bundled logic and transfer protocol; it does not replace browser worker/CSP testing.

- TypeScript checks for both frontend and backend.
- Production build, including the PDF.js worker, local character maps/fonts/WASM decoders, PDF export worker, and Node server.
- Automated suite: geometry, transaction history, actual PDF exports, actual PDF.js extraction from exported bytes, editor component interactions, upload API guards, sanitized HTML, Office ZIP/XML validation, and conversion request/response handling.
- `npm audit --omit=dev`: no known production dependency vulnerabilities reported at the time of this delivery. This is a point-in-time registry result, not a security guarantee.

The component tests use jsdom and a mocked PDF rendering surface. PDF export and extraction are tested separately with real PDF bytes and the real libraries. The API request tests use a stub converter; conversion contract tests inspect actual multipart bodies but mock the HTTP service. None of these are represented as a real LibreOffice/Chromium conversion test.

## Covered cases

| Area               | Cases                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinates        | Full affine inverse, crop translation, page rotation, horizontal/vertical axes, skew, singular rejection                                       |
| Text export        | Original immutability, same baseline, multiline line spacing, rotated text, all 12 StandardFonts variants                                      |
| Output validation  | Reopens as a PDF, preserves page count/rotation/crop, PDF.js extracts replacement text at expected coordinates                                 |
| PDF tools          | Whiteout, highlight, rectangle, ellipse, PNG image, typed signature, URI link annotation, fillable text field                                  |
| Export errors      | Unsupported Unicode, invalid size/coordinates/page, invalid colors, unsafe URL protocols                                                       |
| Editing state      | Text selection, multiline typing, formatting, complete transaction undo/redo, apply reset, navigation and zoom persistence                     |
| File handling      | Invalid and empty files, wrong extension/content, binary/invalid UTF-8, input size limits, missing file, multiple files                        |
| API safeguards     | CORS rejection/preflight, per-IP rate limit, concurrency rejection/Retry-After, private file cleanup on success/failure                        |
| Office validation  | Real DOCX/PPTX archive structure, renamed format, synthetic macros, external resources, namespace/entity encoding bypasses, DTD rejection      |
| HTML               | Script/event/iframe removal, remote resource removal, unsafe data images, CSS URL stripping, simple formatting preservation                    |
| Converter contract | LibreOffice/Chromium routes, index.html filename, Markdown sanitization, upstream failure/overload/timeout, PDF response headers and signature |

## Defects fixed while testing and reviewing

- Multer/Busboy multipart boundary handling originally rejected valid single-file uploads. File and field limits remain enforced after correcting the part boundary allowance.
- Main viewer and thumbnails originally attempted to load the same transferable PDF bytes independently. Thumbnails now reuse the main PDF document handle.
- PDF overlays now have an explicit stacking context above the rendered text layer, so PDF.js text spans do not intercept editor hit targets.
- Multiline text overlays expand as text grows, with non-wrapping input and exported explicit line breaks.
- Office relationship validation now uses a namespace-aware XML parser rather than relying on regex attribute matching.
- Page-number input is rounded and clamped. Uploaded page dimensions and rendering canvas pixel counts are bounded.
- Export moved to a dedicated worker, preserving source bytes with a copied transferable buffer and keeping the UI responsive.

## Not executed in this workspace

1. **Real Gotenberg conversion — five integration cases.** Docker/Podman and LibreOffice executables are unavailable in this runtime. The tests for DOCX, PPTX, HTML, Markdown, and TXT are included and skipped by default. Run them with the commands below; the CI workflow is configured to run them on a Docker-capable runner. The workflow is delivered, not yet observed passing in GitHub Actions.
2. **Visual and browser end-to-end QA.** The supervised preview started successfully, but the provided cloud browser returned `ERR_BLOCKED_BY_CLIENT` before loading it. No browser screenshot, successful canvas interaction, mobile visual inspection, or accessibility audit is claimed.
3. **Docker image/Compose execution.** Configuration is provided but containers could not be built or started here. Validate the exact deployment, network flags, CORS and resource limits on the target host.
4. **Load, fuzz, and full compatibility testing.** No exhaustive malformed-PDF corpus, long-duration load test, multi-user quota test, or real device/browser matrix was run. Those remain production release gates.

## Reproduce

```bash
npm ci
npm run typecheck
npm test
npm run build
docker compose up -d
npm run test:conversion
docker compose --profile full up -d --build
```

Then exercise the app at `http://localhost:8080` with your document corpus. Check text edits and downloads in at least Chrome, Firefox and Safari; rotated/cropped pages; scanned/image-only pages; unusual fonts; image placement; links in an external reader; new form fields in a PDF reader; mobile/touch operation; keyboard navigation; 200% text zoom; canceled uploads; backend disconnects; and capacity rejection under concurrent requests. Compare exported pages visually, and verify non-confidential sample text by extraction. Confirm that whiteout is clearly understood as visual cover, not redaction.
