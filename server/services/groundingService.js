// Cheap, deterministic checks that an AI statement is backed by the text it cites.
// No extra AI call: plain string matching, so it is fast, free and unit-tested.
//
// What these checks CAN tell you:
//   - a citation points at a source the model was really given
//   - a statement has (or lacks) a citation
//   - a number in a statement ("90 days", "EUR 120,000", "99.9%") does / does not
//     appear in the text it cites
// What they CANNOT tell you: that the statement is correct. A cited sentence can
// still misread its source. The UI says "check the source", never "verified true".

// Number words that contracts often spell out ("thirty (30) days", "twelve months")
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, forty_five: 45, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

const CITATION_MARKER = /\[S\d+\]/gi;

// "120,000" → "120000", "99.90" → "99.9", "030" → "30"; keeps decimals
function normalizeNumber(raw) {
  let n = raw;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, ''); // thousands separators
  if (/^\d{1,3}(\.\d{3})+$/.test(n) && n.split('.').length > 2) n = n.replace(/\./g, ''); // 1.200.000
  if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '');
  return n.replace(/^0+(?=\d)/, '');
}

// All numbers written with digits in a text, normalised
export function extractNumbers(text = '') {
  const plain = text.replace(CITATION_MARKER, ' ');
  return [...new Set([...plain.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => normalizeNumber(m[0].replace(/[.,]$/, ''))))];
}

// Numbers present in evidence text, including spelled-out ones ("thirty" → "30")
export function evidenceNumbers(text = '') {
  const found = new Set(extractNumbers(text));
  const words = text.toLowerCase().replace(/forty[\s-]five/g, 'forty_five').match(/[a-z_]+/g) ?? [];
  for (const w of words) if (NUMBER_WORDS[w] != null) found.add(String(NUMBER_WORDS[w]));
  return found;
}

// Numbers in `claim` that appear in none of the evidence texts
export function unsupportedNumbers(claim, evidenceTexts) {
  const available = evidenceNumbers(evidenceTexts.join('\n'));
  return extractNumbers(claim).filter((n) => !available.has(n));
}

// Split an answer into statements: one per sentence, bullets kept separate.
// Returns [{ text, paragraph }] where paragraph groups sentences on one line/bullet.
export function splitStatements(answer = '') {
  const out = [];
  answer.split(/\n+/).forEach((line, paragraph) => {
    const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!body) return;
    // Sentence end = . ! ? (optionally followed by citation markers) then a space.
    // "9.2" and "EUR 1.5m" are safe because there is no space after the dot.
    const parts = body.split(/(?<=[.!?](?:\s*\[S\d+\])*)\s+(?=[A-Z("“])/);
    for (const text of parts) if (text.trim()) out.push({ text: text.trim(), paragraph });
  });
  return out;
}

// Statements that do not need a citation: headings ("Vendor A 2025:"), very short
// fragments, and sentences that say something is NOT in the contract.
const SAYS_MISSING = /\b(not (stated|specified|mentioned|found|covered|addressed|included)|does not (say|state|specify|mention|contain|include|cover)|do not (say|state|specify|mention|contain|include|cover)|no (information|mention|clause|provision)|could not find|is silent)\b/i;

export function needsCitation(text) {
  const plain = text.replace(CITATION_MARKER, '').trim();
  if (!plain || plain.endsWith(':')) return false;
  if (SAYS_MISSING.test(plain)) return false;
  const words = plain.split(/\s+/).length;
  return words >= 5 || extractNumbers(plain).length > 0;
}

// Text a source "contains", for number checks: its clause text plus the labels we
// showed the model (contract title, vendor, version, section, pages).
export function sourceEvidence(source) {
  return [
    source.text,
    source.contractTitle,
    source.vendor,
    source.version,
    source.sectionNumber,
    source.sectionTitle,
    source.pageStart != null && `page ${source.pageStart}`,
    source.pageEnd != null && `page ${source.pageEnd}`,
  ].filter(Boolean).join('\n');
}

// Check every statement of an answer against the sources it cites.
// A statement without its own citation is "covered" by a citation later in the
// same paragraph ("X applies. It lasts 12 months [S2].") — a common writing style.
export function checkStatements(answer, sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const statements = splitStatements(answer).map((s) => ({
    ...s,
    ids: [...new Set([...s.text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]).filter((id) => byId.has(id)))],
  }));

  return statements.map((s, i) => {
    let ids = s.ids;
    let inherited = false;
    if (!ids.length) {
      const later = statements.slice(i + 1).find((x) => x.paragraph === s.paragraph && x.ids.length);
      if (later) {
        ids = later.ids;
        inherited = true;
      }
    }
    const text = s.text.replace(CITATION_MARKER, '').replace(/\s+([.,;:])/g, '$1').trim();
    const required = needsCitation(text);
    return {
      text,
      citations: ids,
      inherited,
      needsCitation: required,
      uncited: required && !ids.length,
      unsupportedValues: ids.length ? unsupportedNumbers(text, ids.map((id) => sourceEvidence(byId.get(id)))) : [],
    };
  });
}
