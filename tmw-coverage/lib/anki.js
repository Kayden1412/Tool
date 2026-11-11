/**
 * Anki plain-text export parsing and shared text normalization helpers.
 * Pure functions only: used by the browser UI, the worker, and Node tests.
 */

export const TIER_ORDER = [
  'Student',
  'Trainee',
  'Debut',
  'Major',
  'Prima',
  'Divine',
  'Eternal',
  'Immortal',
  'Mythic',
];

const TIER_NAMES = new Set(TIER_ORDER);

export const HEADER_TERM_RE =
  /^(expression|word|term|vocabulary|vocab|front|japanese|kanji|単語|日本語|表現|見出し)$/i;
export const HEADER_READING_RE =
  /(reading|kana|furigana|pronunciation|よみ|読み|かな|ふりがな)/i;

const HEADER_NAMES = new Set([
  'expression',
  'word',
  'term',
  'vocabulary',
  'vocab',
  'front',
  'japanese',
  'kanji',
  'reading',
  'kana',
  'furigana',
  'pronunciation',
  'sentence',
  'meaning',
  'definition',
  'note',
  'notes',
  'audio',
  'image',
  'source',
  'tags',
  'frequency',
  'pitch',
  'part of speech',
  '単語',
  '日本語',
  '表現',
  '見出し',
  '読み',
  'よみ',
  'かな',
  'ふりがな',
  '意味',
  '例文',
  '音声',
  '画像',
  '出典',
  'タグ',
  '頻度',
]);

/** NFKC-normalize, strip zero-width characters, collapse whitespace, trim. */
export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip HTML tags and decode the handful of entities Anki exports commonly contain. */
export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:div|p|li|tr|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(parseInt(code, 16)));
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Read `#separator:` from Anki's export header. */
export function detectSeparator(text, override = 'auto') {
  if (override && override !== 'auto') {
    return (
      {
        tab: '\t',
        comma: ',',
        semicolon: ';',
        pipe: '|',
        space: ' ',
      }[override] ?? '\t'
    );
  }

  const match = String(text).match(/^\s*#separator:\s*([^\r\n]+)/im);
  if (match) {
    const value = match[1].trim().toLowerCase();
    if (value.startsWith('tab')) return '\t';
    if (value.startsWith('comma')) return ',';
    if (value.startsWith('semicolon')) return ';';
    if (value.startsWith('pipe')) return '|';
    if (value.startsWith('space')) return ' ';
  }

  return '\t';
}

/**
 * Parse a delimited export. Handles quoted fields, doubled quotes and embedded
 * newlines so that both tab-separated and CSV Anki exports work.
 */
export function parseDelimited(text, separator) {
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const finishField = () => {
    row.push(field);
    field = '';
  };

  const finishRow = () => {
    finishField();
    // Ignore metadata directives (`#separator:tab`, `#html:false`, ...).
    const isDirective = row.length > 0 && String(row[0]).trimStart().startsWith('#');
    const hasContent = row.some((cell) => normalizeText(cell) !== '');
    if (hasContent && !isDirective) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === separator) {
      finishField();
    } else if (char === '\n') {
      finishRow();
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) finishRow();
  return rows;
}

/** Heuristic: does this first row look like field names rather than card data? */
export function looksLikeHeader(row) {
  if (!row || row.length === 0) return false;
  const cells = row.map((cell) => normalizeText(cell).toLowerCase());
  const score = cells.filter((cell) => HEADER_NAMES.has(cell)).length;
  return score >= 2 || HEADER_NAMES.has(cells[0] ?? '');
}

const KANA_ONLY_RE = /^[\u3040-\u30ff\u30fc\uff66-\uff9f\s・、,./\[\]()（）「」]+$/;
const HAS_KANA_RE = /[\u3040-\u30ff]/;

function isKanaReading(value) {
  const text = normalizeText(value);
  return text !== '' && KANA_ONLY_RE.test(text) && HAS_KANA_RE.test(text);
}

/** Best-effort column detection; users can override both selectors in the UI. */
export function guessColumns(rows, header = null) {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let termCol = 0;
  let readingCol = -1;

  if (header) {
    const termIndex = header.findIndex((cell) => HEADER_TERM_RE.test(normalizeText(cell)));
    if (termIndex >= 0) termCol = termIndex;
    const readingIndex = header.findIndex((cell) => HEADER_READING_RE.test(normalizeText(cell)));
    if (readingIndex >= 0) readingCol = readingIndex;
  }

  if (readingCol < 0 && maxCols > 1) {
    const sample = rows.slice(0, 250);
    let bestIndex = -1;
    let bestRatio = 0;

    for (let col = 0; col < maxCols; col += 1) {
      if (col === termCol) continue;
      let filled = 0;
      let kana = 0;

      for (const row of sample) {
        const value = normalizeText(row[col]);
        if (!value) continue;
        filled += 1;
        if (isKanaReading(value)) kana += 1;
      }

      if (filled < 3) continue;
      const ratio = kana / filled;
      if (ratio >= 0.6 && ratio > bestRatio) {
        bestRatio = ratio;
        bestIndex = col;
      }
    }

    if (bestIndex >= 0) readingCol = bestIndex;
    else if (maxCols > 1) readingCol = termCol === 1 ? 0 : 1;
  }

  if (termCol >= maxCols) termCol = 0;
  if (readingCol >= maxCols) readingCol = -1;
  return { termCol, readingCol, maxCols };
}

/**
 * Parse an Anki notes export.
 * @returns {{
 *   separator: string, html: boolean, rows: string[][], header: string[]|null,
 *   hasHeader: boolean, termCol: number, readingCol: number, maxCols: number
 * }}
 */
export function parseAnkiFile(text, { delimiter = 'auto' } = {}) {
  const source = String(text ?? '');
  const separator = detectSeparator(source, delimiter);
  const html = /^\s*#html:\s*true\s*$/im.test(source);
  const parsedRows = parseDelimited(source, separator);

  const hasHeader = parsedRows.length > 0 && looksLikeHeader(parsedRows[0]);
  const header = hasHeader ? parsedRows[0] : null;
  const rows = (hasHeader ? parsedRows.slice(1) : parsedRows).filter((row) =>
    row.some((cell) => normalizeText(cell) !== ''),
  );
  const columns = guessColumns(rows, header);

  return {
    separator,
    html,
    rows,
    header,
    hasHeader,
    ...columns,
  };
}

/** Convert an exported cell into display/matching text. */
export function cleanCell(value, html) {
  return normalizeText(html ? stripHtml(value) : value);
}

/**
 * Variants tried against the dictionary, in order:
 * exact expression, annotated expression (`word[reading]`), whitespace-free.
 */
export function getTermVariants(value) {
  const text = normalizeText(value);
  if (!text) return [];

  const variants = [text];
  const annotated = text.match(/^(.+?)\s*[\[［(（]([^\]］)）]+)[\]］)）]$/);
  if (annotated) variants.push(normalizeText(annotated[1]));

  const compact = text.replace(/\s+/g, '');
  if (compact && compact !== text) variants.push(compact);

  return [...new Set(variants.filter(Boolean))];
}

/** Variants tried when the optional "match by reading" mode is enabled. */
export function getReadingVariants(value) {
  const text = normalizeText(value);
  if (!text) return [];

  const variants = [text];
  for (const part of text.split(/[\/、,，;；・]/)) {
    const cleaned = normalizeText(part).replace(/\s+/g, '');
    if (cleaned) variants.push(cleaned);
  }

  const compact = text.replace(/\s+/g, '');
  if (compact) variants.push(compact);

  return [...new Set(variants)];
}

/** Map a TMW numeric rank to its band. */
export function tierForRank(rank) {
  if (!Number.isFinite(rank)) return null;
  if (rank <= 620) return 'Student';
  if (rank <= 1619) return 'Trainee';
  if (rank <= 7936) return 'Debut';
  if (rank <= 16849) return 'Major';
  if (rank <= 27025) return 'Prima';
  if (rank <= 38548) return 'Divine';
  if (rank <= 51263) return 'Eternal';
  return 'Mythic';
}

/**
 * TMW's display value lists every rank a word belongs to, lowest first.
 * This matters for rank 99,999: Immortal and Mythic share that sentinel, so
 * only the label (e.g. "Immortal, Mythic") can tell them apart.
 */
export function tierForEntry(rank, displayValue) {
  for (const part of String(displayValue ?? '').split(',')) {
    const label = part.trim();
    if (TIER_NAMES.has(label)) return label;
  }
  return tierForRank(rank);
}
