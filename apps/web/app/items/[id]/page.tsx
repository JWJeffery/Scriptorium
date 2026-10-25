import { ItemDetailView } from "../../../components/library/ItemDetailView";

export const metadata = { title: "Book · Scriptorium" };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return <ItemDetailView id={(await params).id} />;
}
