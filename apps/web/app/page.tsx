import { ScriptoriumWorkflow } from "../components/ScriptoriumWorkflow";

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

      <ScriptoriumWorkflow />
    </main>
  );
}
