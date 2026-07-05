import { CitationPanel } from "../components/CitationPanel";
import { DocumentLibrary } from "../components/DocumentLibrary";
import { HighlightPalette } from "../components/HighlightPalette";
import { PageMappingPanel } from "../components/PageMappingPanel";
import { ReaderWorkspace } from "../components/ReaderWorkspace";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="masthead">
        <p className="eyebrow">Scriptorium</p>
        <h1>Scholarly reading, annotation, citation, and research memory.</h1>
        <p className="lede">
          A clean-slate platform for reading texts, preserving notes, mapping book pages,
          and generating citations from the exact passage under study.
        </p>
      </header>

      <section className="workspaceGrid" aria-label="Scriptorium workspace mock">
        <DocumentLibrary />
        <ReaderWorkspace />
        <aside className="sideStack">
          <HighlightPalette />
          <PageMappingPanel />
          <CitationPanel />
        </aside>
      </section>
    </main>
  );
}
