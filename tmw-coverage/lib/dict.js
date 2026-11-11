/**
 * Build an in-memory TMW frequency index and check card coverage against it.
 */

import {
  getReadingVariants,
  getTermVariants,
  normalizeText,
  tierForEntry,
} from './anki.js';
import { resolveEntry } from './binindex.js';

const TERM_META_RE = /^term_meta_bank_\d+\.json$/i;

export function isMetaBankName(name) {
  return TERM_META_RE.test(name);
}

function pickBetter(current, candidate) {
  if (!current) return true;
  if (candidate.rank !== current.rank) return candidate.rank < current.rank;
  return candidate.reading.length > current.reading.length;
}

/**
 * @param {Array<{name: string, text: string}>} files
 */
export function buildFrequencyIndex(files, onProgress) {
  const termMap = new Map();
  const readingMap = new Map();
  let entryCount = 0;
  let duplicateCount = 0;
  let total = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    let data;

    try {
      data = JSON.parse(file.text);
    } catch {
      throw new Error(`Could not parse "${file.name}" as JSON.`);
    }

    if (!Array.isArray(data)) continue;

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const [rawTerm, kind, meta] = item;
      if (kind !== 'freq') continue;

      const frequency = meta?.frequency;
      if (!frequency || typeof frequency !== 'object') continue;

      const rank = Number(frequency.value);
      if (!Number.isFinite(rank)) continue;

      const term = normalizeText(rawTerm);
      if (!term) continue;

      const reading = normalizeText(meta?.reading ?? '');
      const displayValue = String(frequency.displayValue ?? '').trim();
      const tiers = displayValue
        .split(',')
        .map((tier) => tier.trim())
        .filter(Boolean);

      const entry = {
        term: String(rawTerm),
        reading,
        rank,
        tiers,
        displayValue,
        tier: tierForEntry(rank, displayValue),
      };

      entryCount += 1;
      total += 1;

      const existing = termMap.get(term);
      if (!existing) {
        termMap.set(term, entry);
      } else {
        duplicateCount += 1;
        if (pickBetter(existing, entry)) termMap.set(term, entry);
      }

      if (reading) {
        const existingReading = readingMap.get(reading);
        if (!existingReading || pickBetter(existingReading, entry)) {
          readingMap.set(reading, entry);
        }
      }
    }

    onProgress?.(fileIndex + 1, files.length);
  }

  if (termMap.size === 0) {
    throw new Error('No TMW frequency entries were found in this archive.');
  }

  let minRank = Infinity;
  let maxRank = -Infinity;
  for (const entry of termMap.values()) {
    if (entry.rank < minRank) minRank = entry.rank;
    if (entry.rank > maxRank) maxRank = entry.rank;
  }

  return {
    termMap,
    readingMap,
    entryCount,
    totalEntries: total,
    duplicateCount,
    termCount: termMap.size,
    readingCount: readingMap.size,
    minRank,
    maxRank,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

export function describeIndex(index) {
  return `${formatNumber(index.termCount)} terms · ${formatNumber(index.entryCount)} entries`;
}

/**
 * Check rows of `{term, reading, index}` against the index.
 * @param {ReturnType<typeof buildFrequencyIndex>} index
 * @param {Array<{term: string, reading?: string, index?: number}>} rows
 * @param {{matchReading?: boolean}} options
 */
export function checkRows(index, rows, { matchReading = false } = {}) {
  return rows.map((row) => {
    const variants = getTermVariants(row.term);
    let match = null;
    let matchType = '';

    for (let i = 0; i < variants.length; i += 1) {
      const hit = index.termMap.get(variants[i]);
      if (hit !== undefined) {
        match = resolveEntry(index, hit);
        matchType = i === 0 ? 'expression' : 'annotation';
        break;
      }
    }

    if (!match && matchReading && row.reading) {
      for (const reading of getReadingVariants(row.reading)) {
        const hit = index.readingMap.get(reading);
        if (hit !== undefined) {
          match = resolveEntry(index, hit);
          matchType = 'reading';
          break;
        }
      }
    }

    return {
      index: row.index,
      term: row.term,
      reading: row.reading ?? '',
      covered: Boolean(match),
      rank: match ? match.rank : null,
      tier: match ? match.tier : null,
      tiers: match ? match.tiers : [],
      displayValue: match ? match.displayValue : '',
      matchType,
      matchedTerm: match ? match.term : '',
      matchedReading: match ? match.reading : '',
    };
  });
}
