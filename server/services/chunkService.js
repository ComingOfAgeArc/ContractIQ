// Clause-aware chunking.
//
// Idea: contracts are already organised into numbered clauses
// ("9. Limitation of Liability"). A clause is the natural unit a person
// asks about, so we cut at clause headings instead of every N characters.
// Only clauses that are too long for one chunk get split further, and then
// at sub-clause boundaries ("9.2 ...") rather than mid-sentence.

export const MAX_CHUNK_CHARS = 2400; // ≈ 600 tokens: one clause fits, the answer stays focused

// A line is a heading if it matches one of these AND is short (checked below).
const HEADING_PATTERNS = [
  // "Section 5. Payment" / "Clause 12: Term"
  { re: /^(?:section|clause)\s+(\d+(?:\.\d+)*)[.:)]?\s+(.+)$/i },
  // "ARTICLE IV – CONFIDENTIALITY" / "Article 3 Term"
  { re: /^article\s+([ivxlcdm]+|\d+)\s*[.:\-–—)]?\s*(.+)$/i },
  // "9. Limitation of Liability" / "9) Fees"   (top-level numbers only; "9.1 ..." is body text)
  { re: /^(\d{1,3})[.)]\s+([A-Z].*)$/, numbered: true },
  // "LIMITATION OF LIABILITY" (all caps, no number)
  { re: /^()([A-Z][A-Z0-9 &,'’\-\/]{3,})$/ },
];

// Lines that start a sub-clause or list item: "9.2 ...", "(a) ...", "(iv) ..."
const SUBCLAUSE_START = /^(\d+\.\d+(?:\.\d+)*\.?\s|\([a-z0-9]{1,4}\)\s)/i;

function matchHeading(line, lastNumber) {
  // Headings are short titles, not sentences
  if (line.length > 80 || line.split(/\s+/).length > 10 || /[.;:,]$/.test(line)) return null;

  for (const { re, numbered } of HEADING_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    const [, number, title] = m;
    if (numbered) {
      // Numbered headings must go up (1, 2, 3...). This stops a numbered list
      // inside clause 9 ("1. the Customer ...") from being mistaken for clause 1.
      if (Number(number) <= lastNumber) return null;
      if (title.includes('. ')) return null; // "3. Fees are due. Late fees..." is a sentence
    }
    return { number: number || null, title: title.trim() };
  }
  return null;
}

// pages → [{ text, page }]: one entry per non-empty line, remembering its page
function toLines(pages) {
  const lines = [];
  for (const p of pages) {
    for (const raw of p.text.split('\n')) {
      const text = raw.trim();
      lines.push({ text, page: p.pageNumber }); // keep blank lines: they mark paragraph breaks
    }
  }
  return lines;
}

// Step 1: group lines into sections, starting a new section at each heading
function splitIntoSections(lines) {
  const sections = [];
  let current = { number: null, title: 'Preamble', lines: [] }; // text before the first heading
  let lastNumber = 0;

  for (const line of lines) {
    const heading = line.text && matchHeading(line.text, lastNumber);
    if (heading) {
      if (current.lines.some((l) => l.text)) sections.push(current);
      current = { ...heading, headingLine: line, lines: [] };
      if (/^\d+$/.test(heading.number || '')) lastNumber = Number(heading.number);
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.text)) sections.push(current);

  // No headings found at all → it's not really a preamble
  if (sections.length === 1 && !sections[0].headingLine) sections[0].title = 'Full text';
  return sections;
}

// Step 2: split a section's lines into "units" we are allowed to cut between:
// sub-clauses (9.1, 9.2, (a), (b)) and blank-line paragraphs.
function toUnits(lines) {
  const units = [];
  let current = [];
  for (const line of lines) {
    const startsNew = !line.text || SUBCLAUSE_START.test(line.text);
    if (startsNew && current.length) {
      units.push(current);
      current = [];
    }
    if (line.text) current.push(line);
  }
  if (current.length) units.push(current);
  return units;
}

// Last resort for a single unit that is still too long: cut between lines.
function splitLongUnit(unit) {
  const pieces = [];
  let piece = [];
  let size = 0;
  for (const line of unit) {
    if (size + line.text.length > MAX_CHUNK_CHARS && piece.length) {
      pieces.push(piece);
      piece = [];
      size = 0;
    }
    piece.push(line);
    size += line.text.length + 1;
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

// Step 3: pack units into chunks of at most MAX_CHUNK_CHARS
function packUnits(units) {
  const groups = [];
  let group = [];
  let size = 0;
  for (const unit of units.flatMap((u) => (unitLength(u) > MAX_CHUNK_CHARS ? splitLongUnit(u) : [u]))) {
    const len = unitLength(unit);
    if (size + len > MAX_CHUNK_CHARS && group.length) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(...unit);
    size += len;
  }
  if (group.length) groups.push(group);
  return groups;
}

const unitLength = (unit) => unit.reduce((n, l) => n + l.text.length + 1, 0);

function headingText(section) {
  if (section.number) return `${section.number}. ${section.title}`;
  return section.title;
}

// Main entry: contract pages → chunk drafts (no embeddings yet)
export function chunkPages(pages) {
  const sections = splitIntoSections(toLines(pages));
  const chunks = [];

  for (const section of sections) {
    const groups = packUnits(toUnits(section.lines));
    groups.forEach((groupLines, part) => {
      const heading = headingText(section) + (groups.length > 1 ? ` (part ${part + 1} of ${groups.length})` : '');
      const body = groupLines.map((l) => l.text).join('\n');
      const pagesInChunk = groupLines.map((l) => l.page);
      if (part === 0 && section.headingLine) pagesInChunk.unshift(section.headingLine.page);

      chunks.push({
        chunkIndex: chunks.length,
        sectionNumber: section.number,
        sectionTitle: section.title,
        // The heading is repeated in every part so each chunk makes sense on its own
        text: `${heading}\n${body}`,
        pageStart: Math.min(...pagesInChunk),
        pageEnd: Math.max(...pagesInChunk),
      });
    });
  }
  return chunks;
}
