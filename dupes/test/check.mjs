import assert from 'node:assert/strict';

import {
  MATCH_MODES,
  collectOccurrences,
  groupDuplicates,
  keyForRow,
  summarize,
} from '../lib/dupes.js';

function file(id, name, rows, overrides = {}) {
  return {
    id,
    name,
    parsed: {
      html: false,
      termCol: 0,
      readingCol: 1,
      rows,
      ...overrides,
    },
  };
}

const fileA = file('a', 'deck-a.txt', [
  ['食べる', 'たべる', 'to eat'],
  ['飲む', 'のむ', 'to drink'],
  ['食べる', 'たべる', 'to eat'],
  ['', '', 'blank term'],
]);

const fileB = file('b', 'deck-b.txt', [
  ['食べる', 'たべる'],
  ['見る', 'みる'],
  ['食べる[たべる]', 'たべる'],
]);

const { occurrences, skipped } = collectOccurrences([fileA, fileB], {
  mode: 'term-reading',
});
assert.equal(occurrences.length, 6);
assert.equal(skipped, 1);

const groups = groupDuplicates(occurrences);
assert.equal(groups.length, 1);

const eat = groups[0];
assert.equal(eat.term, '食べる');
assert.equal(eat.count, 4);
assert.equal(eat.fileCount, 2);
assert.deepEqual(eat.readings, ['たべる']);
assert.deepEqual(eat.fileNames, ['deck-a.txt', 'deck-b.txt']);
assert.deepEqual(
  eat.occurrences.map((item) => [item.fileName, item.note]),
  [
    ['deck-a.txt', 1],
    ['deck-a.txt', 3],
    ['deck-b.txt', 1],
    ['deck-b.txt', 3],
  ],
);
assert.equal(eat.occurrences[0].preview, 'to eat');
assert.equal(eat.occurrences[2].preview, '食べる · たべる');

const stats = summarize(occurrences, groups);
assert.equal(stats.notes, 6);
assert.equal(stats.unique, 3);
assert.equal(stats.groupCount, 1);
assert.equal(stats.duplicateNotes, 4);
assert.equal(stats.extraCopies, 3);
assert.equal(stats.acrossFiles, 1);
assert.equal(stats.withinFile, 0);
assert.equal(stats.duplicateRate, 4 / 6);

// Expression-only mode groups different readings; +reading keeps them apart.
const sameWord = file('c', 'readings.txt', [
  ['同じ', 'おなじ'],
  ['同じ', 'どうじ'],
]);
assert.equal(groupDuplicates(collectOccurrences([sameWord], { mode: 'term-reading' }).occurrences).length, 0);
assert.equal(groupDuplicates(collectOccurrences([sameWord], { mode: 'term' }).occurrences).length, 1);

// Exact-row mode needs every cell to match.
const exactA = file('d', 'exact-a.txt', [
  ['食べる', 'たべる', 'to eat'],
  ['食べる', 'たべる', 'to eat'],
]);
const exactB = file('e', 'exact-b.txt', [['食べる', 'たべる']]);
assert.equal(groupDuplicates(collectOccurrences([exactA], { mode: 'note' }).occurrences)[0].count, 2);
assert.equal(groupDuplicates(collectOccurrences([exactA, exactB], { mode: 'note' }).occurrences)[0].count, 2);
assert.equal(groupDuplicates(collectOccurrences([exactA, exactB], { mode: 'term' }).occurrences)[0].count, 3);

// NFKC width folding, case folding and [reading] annotations all normalize the key.
assert.equal(
  keyForRow(['ＡＢＣ[えーびーしー]', ''], { html: false, termCol: 0, readingCol: 1 }, 'term'),
  keyForRow(['abc', ''], { html: false, termCol: 0, readingCol: 1 }, 'term'),
);
assert.equal(
  keyForRow(['Test', ''], { html: false, termCol: 0, readingCol: 1 }, 'term'),
  keyForRow(['test', ''], { html: false, termCol: 0, readingCol: 1 }, 'term'),
);

// Blank term rows are unusable in key modes but exact rows can still match on other fields.
assert.equal(keyForRow(['', 'たべる'], { html: false, termCol: 0, readingCol: 1 }, 'term-reading'), '');
assert.equal(keyForRow(['', '', 'x'], { html: false, termCol: 0, readingCol: 1 }, 'note'), '\u0001\u0001x');

// No reading column at all should not crash and should group by expression.
const noReading = file('f', 'noread.txt', [['猫'], ['猫']], { readingCol: -1 });
assert.equal(groupDuplicates(collectOccurrences([noReading], { mode: 'term-reading' }).occurrences)[0].count, 2);

assert.deepEqual(MATCH_MODES, ['term-reading', 'term', 'note']);

console.log('\nAll duplicate-checker checks passed:');
console.log(`  occurrences across 2 files: ${occurrences.length}`);
console.log(`  duplicate groups: ${groups.length}`);
console.log(`  redundant notes: ${stats.extraCopies}`);
console.log(`  cross-file groups: ${stats.acrossFiles}`);
