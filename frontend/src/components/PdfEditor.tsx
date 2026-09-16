import {
  useState,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import {
  FileText,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Maximize,
  Type,
  Link2,
  TextCursorInput,
  ImagePlus,
  PenLine,
  Eraser,
  Highlighter,
  Shapes,
  Undo2,
  Redo2,
  HelpCircle,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import type {
  Edit,
  TextBlock,
  PageInfo,
  Tool,
  FontFamily,
} from "../types";
import { extractText } from "../utils/textExtractor";
import { downloadPdf } from "../utils/pdfEngine";
import { exportPdf } from "../utils/exportClient";
import { createSamplePdf } from "../utils/samplePdf";
import { historyReducer, emptyHistory } from "../utils/history";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const toolsList = [
  { id: "text", name: "Text", icon: Type },
  { id: "links", name: "Links", icon: Link2 },
  { id: "forms", name: "Forms", icon: TextCursorInput },
  { id: "images", name: "Images", icon: ImagePlus },
  { id: "sign", name: "Sign", icon: PenLine },
  { id: "whiteout", name: "Whiteout", icon: Eraser },
  { id: "annotate", name: "Annotate", icon: Highlighter },
  { id: "shapes", name: "Shapes", icon: Shapes },
] as const;

const pdfOptions = {
  cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}wasm/`,
  isEvalSupported: false,
};

export default function PdfEditor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState(
    "Northline — Project proposal.pdf",
  );
  const [sample, setSample] = useState(true);

  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(0.9);
  const [fit, setFit] = useState(true);

  const [tool, setTool] = useState<Tool>("text");
  const [sideOpen, setSideOpen] = useState(true);
  const [, setHelp] = useState(false);
  const [, setUploadOpen] = useState(false);

  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const [draft, setDraft] = useState<Edit | null>(null);

  const [, setBlocks] = useState<TextBlock[]>([]);
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [imageData] = useState<{ url: string; ratio: number } | null>(
    null,
  );
  const [signature] = useState("");
  const [, setSignOpen] = useState(false);
  const [, setPendingFile] = useState<File | null>(null);
  const [pageInput, setPageInput] = useState("1");

  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const pageProxy = useRef<PDFPageProxy | null>(null);

  const importId = useRef(0);
  const conversionAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  // Keep the PDF input stable across toolbar and page-state updates.
  const documentFile = useMemo(
    () => (bytes ? { data: bytes.slice() } : null),
    [bytes],
  );

  const pending = useMemo(() => {
    if (!draft) return history.present;

    const others = history.present.filter((e) => e.id !== draft.id);
    return [...others, draft];
  }, [history.present, draft]);

  const draftChanged =
    !!draft &&
    JSON.stringify(history.present.find((e) => e.id === draft.id)) !==
      JSON.stringify(draft);

  const hasChanges =
    history.present.length > 0 ||
    !!(
      draft &&
      (!draft.original || draft.text !== draft.original.text || draftChanged)
    );

  useEffect(() => {
    mounted.current = true;

    createSamplePdf()
      .then((b) => {
        if (mounted.current) setBytes(b);
      })
      .catch(() => {
        if (mounted.current) {
          setError("Could not open the sample PDF. Please upload a file.");
        }
      });

    return () => {
      mounted.current = false;
      conversionAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setPageInput(String(pageNum));
    setBlocks([]);
    setInfo(null);
    pageProxy.current = null;
  }, [pageNum, bytes]);

  useEffect(() => {
    if (!fit || !info || !stage.current) return;

    const el = stage.current;

    const update = () =>
      setZoom(
        Math.min(
          1.15,
          Math.max(
            0.25,
            (el.clientWidth - (el.clientWidth < 600 ? 28 : 96)) /
              info.width,
          ),
        ),
      );

    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => observer.disconnect();
  }, [fit, info, sideOpen]);

  const commitDraft = useCallback(() => {
    let edits = history.present;

    if (draft) {
      const unchanged =
        draft.original &&
        draft.text === draft.original.text &&
        draft.size === draft.original.size &&
        draft.color === draft.original.color &&
        draft.family === draft.original.family &&
        draft.bold === draft.original.bold &&
        draft.italic === draft.original.italic &&
        JSON.stringify(draft.matrix) ===
          JSON.stringify(draft.original.matrix);

      edits = unchanged
        ? history.present.filter((e) => e.id !== draft.id)
        : pending;

      if (JSON.stringify(edits) !== JSON.stringify(history.present)) {
        dispatch({ type: "commit", edits });
      }
    }

    setDraft(null);
    return edits;
  }, [draft, history.present, pending]);

  const undo = useCallback(() => {
    if (draft) {
      commitDraft();
    }

    dispatch({ type: "undo" });
    setDraft(null);
  }, [draft, commitDraft]);

  const redo = useCallback(() => {
    commitDraft();
    dispatch({ type: "redo" });
  }, [commitDraft]);

  function changeTool(next: Tool) {
    commitDraft();
    setTool(next);

    if (next === "images" && !imageData) {
      imageInput.current?.click();
    }

    if (next === "sign" && !signature) {
      setSignOpen(true);
    }
  }

  function goPage(n: number) {
    commitDraft();
    setPageNum(Math.max(1, Math.min(numPages, Math.round(n))));
    stage.current?.scrollTo({ top: 0 });
  }

  async function loadFile(file: File) {
    const token = ++importId.current;

    conversionAbort.current?.abort();

    const controller = new AbortController();
    conversionAbort.current = controller;

    setError("");
    setBusy("Opening your document…");
    setUploadOpen(false);

    try {
      const result = new Uint8Array(await file.arrayBuffer());
      const parsed = await PDFDocument.load(result.slice(), {
        updateMetadata: false,
      });

      if (token !== importId.current) return;

      setDraft(null);
      dispatch({ type: "reset" });
      setBytes(result);
      setDoc(null);
      setNumPages(parsed.getPageCount());
      setPageNum(1);
      setFileName(file.name.replace(/\.[^.]+$/, "") + ".pdf");
      setSample(false);
      setNotice("Your document is ready to edit.");
      setFit(true);
    } catch (e) {
      if (token === importId.current) {
        setError(
          e instanceof Error ? e.message : "Could not open this file.",
        );
      }
    } finally {
      if (token === importId.current) {
        setBusy("");
      }
    }
  }

  function requestFile(file?: File) {
    if (!file) return;

    if (hasChanges) {
      setPendingFile(file);
      setUploadOpen(false);
    } else {
      void loadFile(file);
    }
  }

  async function apply(download = false) {
    if (!bytes || busy) return;

    const edits = commitDraft();

    setBusy(
      download ? "Preparing your download…" : "Applying your changes…",
    );
    setError("");

    try {
      const output = edits.length
        ? await exportPdf(bytes, edits)
        : bytes;

      if (download) {
        downloadPdf(output, fileName);
      }

      if (edits.length) {
        setDoc(null);
        setBytes(output);
        dispatch({ type: "reset" });
        setDraft(null);
      }

      setNotice("Changes applied successfully.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not apply changes.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadedPage(p: PDFPageProxy) {
    pageProxy.current = p;

    try {
      const result = await extractText(p);

      if (pageProxy.current === p) {
        setBlocks(result.blocks);
        setInfo(result.info);
      }
    } catch {
      setError("Text extraction failed on this page.");
    }
  }

  const canUndo = history.past.length > 0 || draftChanged;

  const thumbPages = Array.from(
    { length: Math.min(numPages, 7) },
    (_, i) => Math.max(1, Math.min(pageNum - 3, numPages - 6)) + i,
  ).filter((n) => n <= numPages);

  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf"
        aria-label="Open document"
        onChange={(e) => {
          requestFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <header className="app-header">
        <a
          href="#"
          className="brand"
          onClick={(e) => e.preventDefault()}
        >
          <span className="brand-mark">
            <FileText size={22} strokeWidth={1.8} />
          </span>
          paperwork<span className="brand-dot">.</span>
        </a>

        <span className="header-divider" />
        <span className="product-label">PDF Editor</span>

        <div className="header-right">
          <a
            href={`${import.meta.env.BASE_URL}paperwork-pdf-source.zip`}
            className="open-source"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span />
            Free &amp; open source
          </a>

          <button
            className="icon-btn help-btn"
            aria-label="Help and keyboard shortcuts"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={20} />
          </button>
        </div>
      </header>

      <div className="document-bar">
        <div className="document-title">
          <span className="pdf-icon">
            <FileText size={20} />
            <small>PDF</small>
          </span>

          <div>
            <div className="file-name">
              {fileName}
              {sample && <span className="sample-badge">Sample</span>}
            </div>
          </div>
        </div>

        <div className="document-actions">
          <button
            className="secondary upload-btn"
            onClick={() => fileInput.current?.click()}
            disabled={!!busy}
          >
            <Upload size={16} />
            <span>Open file</span>
          </button>

          <button
            className="primary"
            onClick={() => void apply(true)}
            disabled={!bytes || !!busy}
          >
            <Download size={16} />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      <nav className="tools-bar" aria-label="PDF editing tools">
        <div className="tools-list">
          {toolsList.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? "selected" : ""}`}
              onClick={() => changeTool(t.id)}
              disabled={!!busy}
            >
              <t.icon size={18} />
              {t.name}
            </button>
          ))}
        </div>

        <div className="undo-tools">
          <button
            className="icon-btn"
            aria-label="Undo"
            disabled={!canUndo || !!busy}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>

          <button
            className="icon-btn"
            aria-label="Redo"
            disabled={!history.future.length || !!busy}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
        </div>
      </nav>

      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button
            className="icon-btn"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <main className={`workspace ${!sideOpen ? "collapsed" : ""}`}>
        <aside className="pages-sidebar">
          <div className="sidebar-heading">
            <span>
              Pages <small>{numPages}</small>
            </span>

            <button
              className="icon-btn"
              aria-label="Toggle page sidebar"
              onClick={() => setSideOpen(!sideOpen)}
            >
              {sideOpen ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
          </div>

          {sideOpen && (
            <div className="thumbnail-scroll">
              {doc &&
                thumbPages.map((n) => (
                  <button
                    key={n}
                    className={`thumbnail-button ${
                      pageNum === n ? "current" : ""
                    }`}
                    onClick={() => goPage(n)}
                  >
                    <div className="thumbnail-paper">
                      <Page
                        pdf={doc}
                        pageNumber={n}
                        width={116}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </div>
                    <span>{n}</span>
                  </button>
                ))}
            </div>
          )}
        </aside>

        <section className="editor-area">
          <div className="view-bar">
            <div className="page-navigation">
              <span className="page-word">Page</span>

              <input
                type="number"
                aria-label="Page number"
                min="1"
                max={numPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => goPage(Number(pageInput) || pageNum)}
              />

              <span className="muted">of {numPages || "—"}</span>

              <div className="navigation-arrows">
                <button
                  className="icon-btn"
                  aria-label="Previous page"
                  disabled={pageNum <= 1}
                  onClick={() => goPage(pageNum - 1)}
                >
                  <ChevronLeft size={16} />
                </button>

                <button
                  className="icon-btn"
                  aria-label="Next page"
                  disabled={pageNum >= numPages}
                  onClick={() => goPage(pageNum + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="zoom-controls">
              <button
                className="icon-btn"
                aria-label="Zoom out"
                onClick={() => {
                  setFit(false);
                  setZoom(Math.max(0.25, zoom - 0.1));
                }}
                disabled={zoom <= 0.25}
              >
                <Minus size={16} />
              </button>

              <span>{Math.round(zoom * 100)}%</span>

              <button
                className="icon-btn"
                aria-label="Zoom in"
                onClick={() => {
                  setFit(false);
                  setZoom(Math.min(3, zoom + 0.1));
                }}
                disabled={zoom >= 3}
              >
                <Plus size={16} />
              </button>

              <span className="mini-divider" />

              <button
                className={`icon-btn ${fit ? "fit-active" : ""}`}
                title="Fit to width"
                aria-label="Fit to width"
                onClick={() => setFit(true)}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>

          <div className="stage" ref={stage}>
            <div className="surface-wrapper" ref={surface}>
              {documentFile && (
                <Document
                  options={pdfOptions}
                  file={documentFile}
                  onLoadSuccess={(d) => {
                    setDoc(d);
                    setNumPages(d.numPages);
                  }}
                  onLoadError={(e) => {
                    setError(
                      `This PDF could not be displayed: ${e.message}`,
                    );
                  }}
                >
                  <Page
                    pageNumber={pageNum}
                    scale={zoom}
                    onLoadSuccess={loadedPage}
                  />
                </Document>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}