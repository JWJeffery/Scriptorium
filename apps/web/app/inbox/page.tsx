import { AppNav } from "../../components/library/AppNav";

export const metadata = { title: "Inbox · Scriptorium" };

// Reserved. The Research Inbox (articles, newsletters, feeds and alerts waiting for a decision) is the next phase.
export default function InboxPage() {
  return (
    <div className="libPage">
      <AppNav current="inbox" />
      <main className="libDetail">
        <h1>Inbox</h1>
        <p className="libEmpty">Nothing to review. This is where articles, newsletters, feeds and research alerts will arrive for you to accept or dismiss. For now, anything you add goes straight to your <a href="/library">Library</a>.</p>
      </main>
    </div>
  );
}
