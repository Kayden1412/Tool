import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  TIER_ORDER,
  cleanCell,
  getTermVariants,
  normalizeText,
  parseAnkiFile,
  tierForEntry,
  tierForRank,
} from '../lib/anki.js';
import { buildPackedIndex, parsePackedIndex, resolveEntry } from '../lib/binindex.js';
import { buildFrequencyIndex, checkRows, isMetaBankName } from '../lib/dict.js';
import { readZipTexts } from '../lib/zip.js';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.join(siteDir, 'tmw-freq.zip');
const miningPath = path.resolve(siteDir, '..', 'mining.txt');

console.log('Reading', zipPath);
const zipBuffer = fs.readFileSync(zipPath);
const texts = await readZipTexts(
  zipBuffer,
  (name) => name === 'index.json' || isMetaBankName(name),
);

const meta = JSON.parse(texts.get('index.json'));
assert.equal(meta.title, 'TMW v2');

const files = [...texts]
  .filter(([name]) => isMetaBankName(name))
  .map(([name, text]) => ({ name, text }))
  .sort((a, b) => {
    const aNum = Number(a.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    const bNum = Number(b.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    return aNum - bNum;
  });

assert.equal(files.length, 25, 'expected 25 meta banks');

const index = buildFrequencyIndex(files);
console.log(
  `Dictionary: ${index.termCount.toLocaleString()} terms, ${index.entryCount.toLocaleString()} entries, ${index.readingCount.toLocaleString()} readings`,
);

// One archive entry has an empty headword; the index skips it.
assert.equal(index.termCount, 231414);
assert.equal(index.entryCount, 243795);

const miningText = fs.readFileSync(miningPath, 'utf8');
const parsed = parseAnkiFile(miningText);
assert.equal(parsed.rows.length, 9109);
assert.equal(parsed.hasHeader, false);
assert.equal(parsed.termCol, 0);
assert.equal(parsed.readingCol, 1);
assert.equal(parsed.separator, '\t');

const rows = parsed.rows.map((row, rowIndex) => ({
  index: rowIndex,
  term: cleanCell(row[parsed.termCol] ?? '', parsed.html),
  reading: cleanCell(row[parsed.readingCol] ?? '', parsed.html),
}));

const results = checkRows(index, rows, { matchReading: false });
assert.equal(results.length, 9109);
assert.equal(results.filter((row) => row.covered).length, 6350);

const unique = new Set(rows.map((row) => normalizeText(row.term)));
const coveredUnique = new Set(
  results.filter((row) => row.covered).map((row) => normalizeText(row.term)),
);
assert.equal(unique.size, 8853);
assert.equal(coveredUnique.size, 6112);

const kinto = results.find((row) => row.term === '均等');
assert.ok(kinto?.covered);
assert.equal(kinto.rank, 19147);
assert.equal(kinto.tier, 'Prima');
assert.equal(kinto.matchType, 'expression');

// Reading fallback should only fire when opted in.
const readingHitOff = checkRows(index, [{ term: 'not-a-real-headword', reading: 'きんとう' }], {
  matchReading: false,
})[0];
const readingHitOn = checkRows(index, [{ term: 'not-a-real-headword', reading: 'きんとう' }], {
  matchReading: true,
})[0];
assert.equal(readingHitOff.covered, false);
assert.equal(readingHitOn.covered, true);
assert.equal(readingHitOn.matchType, 'reading');
assert.equal(readingHitOn.matchedTerm, '均等');

// Annotated terms such as 猫[ねこ] fall back to the headword.
const annotated = checkRows(index, [{ term: '猫[ねこ]', reading: '' }], { matchReading: false })[0];
assert.equal(annotated.covered, true);
assert.equal(annotated.matchType, 'annotation');

/* ------------------------------------------------- packed index (tmw-index) */

const binPath = path.join(siteDir, 'tmw-index.bin.gz');
const packedParsed = parsePackedIndex(gunzipSync(fs.readFileSync(binPath)));
const packed = buildPackedIndex(packedParsed);

assert.equal(packed.meta.title, 'TMW v2');
assert.equal(packed.meta.revision, '3.0');
assert.equal(packed.termCount, index.termCount);
assert.equal(packed.entryCount, index.entryCount);
assert.equal(packed.readingCount, index.readingCount);
assert.equal(packed.duplicateCount, index.duplicateCount);
assert.equal(packed.minRank, index.minRank);
assert.equal(packed.maxRank, index.maxRank);

// Every headword and reading from the zip must resolve to the same best rank.
for (const [key, entry] of index.termMap) {
  const offset = packed.termMap.get(key);
  if (offset === undefined || packed.ranks[offset] !== entry.rank) {
    assert.fail(`Packed index term mismatch: ${key}`);
  }
}
for (const [key, entry] of index.readingMap) {
  const offset = packed.readingMap.get(key);
  if (offset === undefined || packed.ranks[offset] !== entry.rank) {
    assert.fail(`Packed index reading mismatch: ${key}`);
  }
}

function primaryTierCounts(idx) {
  const counts = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0]));
  for (const value of idx.termMap.values()) {
    const entry = resolveEntry(idx, value);
    if (entry.tier in counts) counts[entry.tier] += 1;
  }
  return counts;
}

const rawTierCounts = primaryTierCounts(index);
const packedTierCounts = primaryTierCounts(packed);
assert.deepEqual(packedTierCounts, rawTierCounts);
assert.equal(rawTierCounts.Immortal, 5145);
assert.equal(rawTierCounts.Mythic, 194191);

// TMW lists multi-rank labels in tier order (lowest first).
const tierPosition = new Map(TIER_ORDER.map((tier, index) => [tier, index]));
for (const entry of index.termMap.values()) {
  let previous = -1;
  for (const label of entry.tiers) {
    const position = tierPosition.get(label);
    if (position === undefined || position <= previous) {
      assert.fail(`Unexpected tier order for ${entry.term}: ${entry.displayValue}`);
    }
    previous = position;
  }
}

// TMW uses rank 99,999 for both Immortal and Mythic; the display labels split them.
assert.deepEqual(TIER_ORDER.slice(-3), ['Eternal', 'Immortal', 'Mythic']);
assert.equal(index.termMap.get('お釈迦').tier, 'Immortal');
assert.equal(index.termMap.get('蹉跌').tier, 'Immortal');
assert.equal(index.termMap.get('錚錚').tier, 'Mythic');
assert.deepEqual(index.termMap.get('俺').tiers, ['Student', 'Immortal']);
assert.equal(index.termMap.get('俺').tier, 'Student');

const packedResults = checkRows(packed, rows, { matchReading: false });
assert.equal(packedResults.length, results.length);
for (let i = 0; i < results.length; i += 1) {
  const expected = results[i];
  const actual = packedResults[i];
  assert.equal(actual.covered, expected.covered);
  assert.equal(actual.rank, expected.rank);
  assert.equal(actual.tier, expected.tier);
  assert.equal(actual.matchType, expected.matchType);
  assert.deepEqual(actual.tiers, expected.tiers);
  assert.equal(actual.displayValue, expected.displayValue);
  assert.equal(actual.matchedReading, expected.matchedReading);
  assert.equal(normalizeText(actual.matchedTerm), normalizeText(expected.matchedTerm));
}

const packedKinto = checkRows(packed, [{ term: '均等', reading: '' }])[0];
assert.equal(packedKinto.covered, true);
assert.equal(packedKinto.rank, 19147);
assert.equal(packedKinto.tier, 'Prima');

const packedReading = checkRows(packed, [{ term: 'not-a-real-headword', reading: 'きんとう' }], {
  matchReading: true,
})[0];
assert.equal(packedReading.covered, true);
assert.equal(packedReading.matchType, 'reading');

// Header detection + comma-separated quoted input.
const csv = [
  '#separator:comma',
  '#html:true',
  'Expression,Reading,Meaning',
  '"猫","ねこ","<b>cat</b>"',
  '"犬, 子","いぬ","dog"',
].join('\n');
const csvParsed = parseAnkiFile(csv);
assert.equal(csvParsed.hasHeader, true);
assert.equal(csvParsed.rows.length, 2);
assert.equal(csvParsed.termCol, 0);
assert.equal(csvParsed.readingCol, 1);
assert.equal(csvParsed.html, true);
assert.equal(cleanCell(csvParsed.rows[1][0], true), '犬, 子');

// HTML stripping and bracket variants.
assert.equal(cleanCell('<b>猫</b>&nbsp;です', true), '猫 です');
assert.deepEqual(getTermVariants('猫[ねこ]'), ['猫[ねこ]', '猫']);
assert.deepEqual(getTermVariants(' 猫 '), ['猫']);

// Tier boundaries for the TMW v2 ranks.
assert.equal(tierForRank(19), 'Student');
assert.equal(tierForRank(620), 'Student');
assert.equal(tierForRank(621), 'Trainee');
assert.equal(tierForRank(1619), 'Trainee');
assert.equal(tierForRank(1621), 'Debut');
assert.equal(tierForRank(7936), 'Debut');
assert.equal(tierForRank(7939), 'Major');
assert.equal(tierForRank(16849), 'Major');
assert.equal(tierForRank(16850), 'Prima');
assert.equal(tierForRank(27025), 'Prima');
assert.equal(tierForRank(27027), 'Divine');
assert.equal(tierForRank(38548), 'Divine');
assert.equal(tierForRank(38549), 'Eternal');
assert.equal(tierForRank(51263), 'Eternal');
assert.equal(tierForRank(51264), 'Mythic');
assert.equal(tierForRank(99999), 'Mythic');

// Immortal/Mythic share rank 99,999, so their display labels decide the tier.
assert.equal(tierForEntry(99999, 'Immortal'), 'Immortal');
assert.equal(tierForEntry(99999, 'Immortal, Mythic'), 'Immortal');
assert.equal(tierForEntry(99999, 'Mythic'), 'Mythic');
assert.equal(tierForEntry(30193, 'Divine, Immortal'), 'Divine');
assert.equal(tierForEntry(42, 'Student, Immortal'), 'Student');
assert.equal(tierForEntry(99999, ''), 'Mythic');

// Theme: three-state toggle with an early no-flash init and a dark override.
const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(siteDir, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(siteDir, 'app.js'), 'utf8');
assert.match(html, /id="themeToggle"/);
assert.match(html, /localStorage\.getItem\('twm-theme'\)/);
assert.ok(
  html.indexOf("localStorage.getItem('twm-theme')") < html.indexOf('href="./styles.css"'),
  'Theme init must run before the stylesheet loads',
);
assert.match(css, /:root\[data-theme="dark"\]/);
assert.match(css, /--line: #efe9dc/);
assert.match(app, /prefers-color-scheme: dark/);
assert.match(app, /THEME_MODES = \['auto', 'light', 'dark'\]/);
assert.match(app, /localStorage\.setItem\(THEME_KEY, currentTheme\)/);

console.log('\nAll checks passed:');
console.log(`  zip entries read: 26 (25 banks + index.json)`);
console.log(`  packed index verified: ${packed.termCount.toLocaleString()} terms / ${packed.readingCount.toLocaleString()} readings`);
console.log(`  immortal / mythic terms: ${rawTierCounts.Immortal.toLocaleString()} / ${rawTierCounts.Mythic.toLocaleString()}`);
console.log(`  mining.txt rows: ${parsed.rows.length.toLocaleString()}`);
console.log(`  unique expressions: ${unique.size.toLocaleString()}`);
console.log(`  covered unique expressions: ${coveredUnique.size.toLocaleString()}`);
console.log(`  coverage: ${((coveredUnique.size / unique.size) * 100).toFixed(2)}%`);
