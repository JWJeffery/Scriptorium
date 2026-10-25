import { Suspense } from "react";
import { LibraryView } from "../../components/library/LibraryView";

export const metadata = { title: "Library · Scriptorium" };

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}
