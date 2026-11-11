/**
 * Duplicate detection for Anki plain-text exports.
 * Pure functions only: imported by the browser UI and the Node tests.
 */

import { cleanCell, normalizeText } from './anki.js';

export const MATCH_MODES = ['term-reading', 'term', 'note'];

export const MATCH_MODE_LABELS = {
  'term-reading': 'Expression + reading',
  term: 'Expression only',
  note: 'Exact note row',
};

const ANNOTATION_RE = /^(.+?)\s*[\[［(（]([^\]］)）]+)[\]］)）]$/;

/** Normalized key text: NFKC, collapsed whitespace, case-insensitive. */
function fold(value) {
  return normalizeText(value).toLowerCase();
}

/** Drop a trailing `word[reading]` annotation from the matching key. */
function foldTerm(value) {
  const text = fold(value);
  const annotated = text.match(ANNOTATION_RE);
  return annotated ? fold(annotated[1]) : text;
}

export function termForRow(row, parsed) {
  return cleanCell(row[parsed.termCol] ?? '', parsed.html);
}

export function readingForRow(row, parsed) {
  if (parsed.readingCol < 0) return '';
  return cleanCell(row[parsed.readingCol] ?? '', parsed.html);
}

/** Build the grouping key for one note row. Returns '' when the row is unusable. */
export function keyForRow(row, parsed, mode = 'term-reading') {
  if (mode === 'note') {
    return row.map((cell) => cleanCell(cell, parsed.html).toLowerCase()).join('\u0001');
  }

  const term = foldTerm(termForRow(row, parsed));
  if (!term) return '';
  if (mode === 'term') return term;

  const reading = fold(readingForRow(row, parsed));
  return `${term}\u0001${reading}`;
}

/**
 * Flatten every loaded file into occurrences.
 * @param {Array<{id:string, name:string, parsed:object}>} files
 */
export function collectOccurrences(files, { mode = 'term-reading' } = {}) {
  const occurrences = [];
  let skipped = 0;

  for (const file of files) {
    const parsed = file.parsed;
    parsed.rows.forEach((row, index) => {
      const key = keyForRow(row, parsed, mode);
      if (!key) {
        skipped += 1;
        return;
      }

      const term = termForRow(row, parsed);
      const reading = readingForRow(row, parsed);
      const allCells = row.map((cell) => cleanCell(cell, parsed.html)).filter(Boolean);
      const otherCells = row
        .map((cell, index) => ({ index, text: cleanCell(cell, parsed.html) }))
        .filter(({ index, text }) => text && index !== parsed.termCol && index !== parsed.readingCol)
        .map(({ text }) => text);
      const previewCells = otherCells.length ? otherCells : allCells;

      occurrences.push({
        key,
        term,
        reading,
        preview: previewCells.slice(0, 5).join(' · '),
        fileId: file.id,
        fileName: file.name,
        note: index + 1,
      });
    });
  }

  return { occurrences, skipped };
}

/** Keep only keys that appear more than once, with per-group file info. */
export function groupDuplicates(occurrences) {
  const map = new Map();

  for (const occurrence of occurrences) {
    let group = map.get(occurrence.key);
    if (!group) {
      group = { key: occurrence.key, occurrences: [] };
      map.set(occurrence.key, group);
    }
    group.occurrences.push(occurrence);
  }

  const groups = [];
  for (const group of map.values()) {
    if (group.occurrences.length < 2) continue;

    const fileNames = [...new Set(group.occurrences.map((item) => item.fileName))];
    const readings = [...new Set(group.occurrences.map((item) => item.reading).filter(Boolean))];
    const first = group.occurrences[0];

    groups.push({
      key: group.key,
      term: first.term || first.preview || '(empty)',
      readings,
      count: group.occurrences.length,
      fileCount: fileNames.length,
      fileNames,
      occurrences: group.occurrences,
    });
  }

  return groups;
}

/** High-level numbers used by the scoreboard. */
export function summarize(occurrences, groups) {
  const notes = occurrences.length;
  const unique = new Set(occurrences.map((item) => item.key)).size;
  const duplicateNotes = groups.reduce((total, group) => total + group.count, 0);
  const extraCopies = duplicateNotes - groups.length;
  const acrossFiles = groups.filter((group) => group.fileCount > 1).length;

  return {
    files: 0,
    notes,
    unique,
    groupCount: groups.length,
    duplicateNotes,
    extraCopies,
    acrossFiles,
    withinFile: groups.length - acrossFiles,
    duplicateRate: notes > 0 ? duplicateNotes / notes : 0,
  };
}
