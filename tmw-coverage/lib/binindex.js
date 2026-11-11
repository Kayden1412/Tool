/**
 * Compact binary frequency index generated from tmw-freq.zip.
 *
 * Layout (little-endian):
 *   0   magic "TMWF"
 *   4   uint8 version
 *   5   uint8 display label count
 *   6   uint16 reserved
 *   8   uint32 entry count
 *   12  uint32 UTF-8 string block byte length
 *   16  uint32 metadata JSON byte length
 *   20  metadata JSON: the archive's index.json, UTF-8
 *   ..  display table: [uint8 byteLength, UTF-8 bytes] per label
 *   ..  zero padding to a 4-byte boundary
 *   ..  uint32 rank per entry
 *   ..  uint8 display label id per entry
 *   ..  UTF-8 block: `term\nreading` joined by `\n` (no trailing newline)
 *
 * Version 2 stores term/reading strings already NFKC-normalized by the
 * generator, so building the lookup maps does not re-normalize 450k strings.
 * The maps point at integer entry offsets instead of allocating 240k objects.
 */

import { tierForEntry } from './anki.js';

const MAGIC = 'TMWF';
const VERSION = 2;

export function parsePackedIndex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 20) throw new Error('Packed index is too small.');
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== MAGIC) {
    throw new Error('Packed index has an invalid magic header.');
  }

  const version = bytes[4];
  if (version !== VERSION) {
    throw new Error(`Packed index version ${version} is not supported (expected ${VERSION}).`);
  }

  const displayCount = bytes[5];
  const entryCount = view.getUint32(8, true);
  const stringLength = view.getUint32(12, true);
  const metadataLength = view.getUint32(16, true);

  let offset = 20;
  if (offset + metadataLength > bytes.length) {
    throw new Error('Packed index is truncated.');
  }

  const decoder = new TextDecoder('utf-8');
  let meta = null;
  if (metadataLength > 0) {
    try {
      meta = JSON.parse(decoder.decode(bytes.subarray(offset, offset + metadataLength)));
    } catch {
      throw new Error('Packed index metadata is not valid JSON.');
    }
  }
  offset += metadataLength;

  const displayValues = [];
  for (let i = 0; i < displayCount; i += 1) {
    if (offset + 1 > bytes.length) throw new Error('Packed index is truncated.');
    const length = bytes[offset];
    offset += 1;
    if (offset + length > bytes.length) throw new Error('Packed index is truncated.');
    displayValues.push(decoder.decode(bytes.subarray(offset, offset + length)));
    offset += length;
  }

  offset = (offset + 3) & ~3;
  const ranksOffset = offset;
  const idsOffset = ranksOffset + entryCount * 4;
  const stringsOffset = idsOffset + entryCount;

  if (stringsOffset + stringLength > bytes.length) {
    throw new Error('Packed index is truncated.');
  }

  const ranks = new Uint32Array(entryCount);
  for (let i = 0; i < entryCount; i += 1) {
    ranks[i] = view.getUint32(ranksOffset + i * 4, true);
  }

  const displayIds = bytes.subarray(idsOffset, idsOffset + entryCount);
  const text = decoder.decode(bytes.subarray(stringsOffset, stringsOffset + stringLength));

  // A single split('\n') over a ~8.6 MB block is surprisingly slow in V8;
  // slicing on a manual newline scan is roughly 3× faster.
  const parts = [];
  let textStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      parts.push(text.slice(textStart, i));
      textStart = i + 1;
    }
  }
  parts.push(text.slice(textStart));

  if (parts.length !== entryCount * 2) {
    throw new Error(
      `Packed index string block mismatch (${parts.length} parts for ${entryCount} entries).`,
    );
  }

  return {
    parts,
    ranks,
    displayIds,
    displayValues,
    entryCount,
    meta,
  };
}

function pickBetter(index, current, candidate, reading) {
  if (current === undefined) return true;
  if (index.ranks[candidate] !== index.ranks[current]) {
    return index.ranks[candidate] < index.ranks[current];
  }
  return reading.length > index.parts[current * 2 + 1].length;
}

/** Build lookup maps from the parsed packed index. Strings are already normalized. */
export function buildPackedIndex(parsed, onProgress) {
  const { parts, ranks, displayIds, displayValues, entryCount } = parsed;
  const termMap = new Map();
  const readingMap = new Map();
  let minRank = Infinity;
  let maxRank = -Infinity;
  let duplicateCount = 0;

  for (let i = 0; i < entryCount; i += 1) {
    const term = parts[i * 2];
    const reading = parts[i * 2 + 1];
    const rank = ranks[i];

    if (!term) continue;
    if (rank < minRank) minRank = rank;
    if (rank > maxRank) maxRank = rank;

    const current = termMap.get(term);
    if (current === undefined) {
      termMap.set(term, i);
    } else {
      duplicateCount += 1;
      if (pickBetter(parsed, current, i, reading)) termMap.set(term, i);
    }

    if (reading && pickBetter(parsed, readingMap.get(reading), i, reading)) {
      readingMap.set(reading, i);
    }

    if ((i & 16383) === 0) onProgress?.(i, entryCount);
  }

  onProgress?.(entryCount, entryCount);

  return {
    format: 'packed',
    parts,
    ranks,
    displayIds,
    displayValues,
    termMap,
    readingMap,
    entryCount,
    totalEntries: entryCount,
    duplicateCount,
    termCount: termMap.size,
    readingCount: readingMap.size,
    minRank,
    maxRank,
    meta: parsed.meta,
    cache: new Map(),
  };
}

function packedEntry(index, entryIndex) {
  const cached = index.cache.get(entryIndex);
  if (cached) return cached;

  const displayValue = index.displayValues[index.displayIds[entryIndex]] ?? '';
  const tiers = displayValue
    .split(',')
    .map((tier) => tier.trim())
    .filter(Boolean);

  const entry = {
    term: index.parts[entryIndex * 2],
    reading: index.parts[entryIndex * 2 + 1],
    rank: index.ranks[entryIndex],
    displayValue,
    tiers,
    tier: tierForEntry(index.ranks[entryIndex], displayValue),
  };
  index.cache.set(entryIndex, entry);
  return entry;
}

/** Maps can hold either entry objects (zip path) or integer offsets (packed path). */
export function resolveEntry(index, value) {
  return typeof value === 'number' ? packedEntry(index, value) : value;
}
