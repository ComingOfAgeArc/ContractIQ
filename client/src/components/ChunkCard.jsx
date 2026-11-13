// One chunk with its citation info. Used by the chunk viewer, search and answers.
export function pageLabel(chunk) {
  return chunk.pageStart === chunk.pageEnd ? `p. ${chunk.pageStart}` : `pp. ${chunk.pageStart}–${chunk.pageEnd}`;
}

// "vector #2 · keyword #1": which search found this chunk and at what rank
export function RankBadges({ ranks }) {
  if (!ranks) return null;
  return (
    <span className="flex gap-1">
      {ranks.vector && <span className="rounded bg-indigo-50 px-1 text-[11px] text-indigo-700">vector #{ranks.vector}</span>}
      {ranks.keyword && <span className="rounded bg-emerald-50 px-1 text-[11px] text-emerald-700">keyword #{ranks.keyword}</span>}
      {ranks.rerank && <span className="rounded bg-amber-50 px-1 text-[11px] text-amber-700">rerank #{ranks.rerank}</span>}
    </span>
  );
}

export default function ChunkCard({ chunk, source, score }) {
  const [heading, ...body] = chunk.text.split('\n');
  return (
    <article className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {source && <span className="font-medium text-slate-700">{source}</span>}
        <span>§ {chunk.sectionNumber || '–'}</span>
        <span>{pageLabel(chunk)}</span>
        <span>#{chunk.chunkIndex}</span>
        <RankBadges ranks={chunk.ranks} />
        {score != null && (
          <span className="ml-auto font-mono text-slate-700" title="Hybrid = RRF score; vector = cosine 0–1; keyword = BM25">
            {score.toFixed(score < 0.1 ? 4 : 3)}
          </span>
        )}
      </div>
      <h4 className="text-sm font-medium">{heading}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{body.join('\n')}</p>
    </article>
  );
}
