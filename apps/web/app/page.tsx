import { ScriptoriumMilestoneOnePersisted } from "../components/ScriptoriumMilestoneOnePersisted";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="masthead">
        <p className="eyebrow">Scriptorium</p>
        <h1>Scholarly reading, annotation, citation, and research memory.</h1>
      </header>
      <ScriptoriumMilestoneOnePersisted />
    </main>
  );
}
