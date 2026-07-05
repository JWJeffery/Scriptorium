const documents = [
  {
    title: "Lumen Gentium",
    meta: "PDF · source metadata pending"
  },
  {
    title: "Wesley and Ecclesial Order",
    meta: "DOCX snapshot planned"
  },
  {
    title: "Methodist Orders Research Notes",
    meta: "Markdown · local notes"
  }
];

export function DocumentLibrary() {
  return (
    <section className="panel" aria-label="Document library">
      <h2>Library</h2>
      <p>Register source files, snapshots, and bibliographic records.</p>
      <ul className="documentList">
        {documents.map((document) => (
          <li className="documentCard" key={document.title}>
            <strong>{document.title}</strong>
            <span>{document.meta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
