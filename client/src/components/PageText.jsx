// The raw extracted text, page by page
export default function PageText({ pages }) {
  return (
    <div className="space-y-4">
      {pages.map((p) => (
        <section key={p.pageNumber}>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">Page {p.pageNumber}</h3>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm">
            {p.text || '(no text on this page)'}
          </pre>
        </section>
      ))}
    </div>
  );
}
