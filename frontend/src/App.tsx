import { lazy, Suspense, Component, type ReactNode } from "react";
const PdfEditor = lazy(() => import("./components/PdfEditor"));
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Something interrupted the editor.</h1>
        <p>
          Reload to open a fresh workspace. Your original file has not changed.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Reload editor
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="boot">
            <span className="spinner" />
            Opening your workspace…
          </div>
        }
      >
        <PdfEditor />
      </Suspense>
    </ErrorBoundary>
  );
}
