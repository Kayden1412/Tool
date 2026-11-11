/**
 * Build site/tmw-index.bin.gz from tmw-freq.zip.
 *
 * This is a build-time convenience: the browser can load the compact index in
 * a fraction of the time it takes to inflate and JSON.parse 25 bank files.
 * tmw-freq.zip remains the source of truth and is still supported at runtime.
 *
 * Usage: node tools/build-index.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { isMetaBankName } from '../lib/dict.js';
import { normalizeText } from '../lib/anki.js';
import { readZipTexts } from '../lib/zip.js';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.join(siteDir, 'tmw-freq.zip');
const outputPath = path.join(siteDir, 'tmw-index.bin.gz');

const MAGIC = [0x54, 0x4d, 0x57, 0x46]; // "TMWF"
const VERSION = 2;

console.log('Reading', zipPath);
const zip = fs.readFileSync(zipPath);
const texts = await readZipTexts(
  zip,
  (name) => name === 'index.json' || isMetaBankName(name),
);

let metadata = Buffer.alloc(0);
const metadataText = texts.get('index.json');
if (metadataText) {
  try {
    metadata = Buffer.from(JSON.stringify(JSON.parse(metadataText)), 'utf8');
  } catch {
    metadata = Buffer.alloc(0);
  }
}

const displayIds = new Map();
const displayValues = [];

function displayId(displayValue) {
  if (displayIds.has(displayValue)) return displayIds.get(displayValue);
  const id = displayValues.length;
  displayIds.set(displayValue, id);
  displayValues.push(displayValue);
  return id;
}

const entries = [];
const files = [...texts]
  .filter(([name]) => isMetaBankName(name))
  .map(([name, text]) => ({ name, text }))
  .sort((a, b) => {
    const aNum = Number(a.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    const bNum = Number(b.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    return aNum - bNum;
  });

for (const { text } of files) {
  const data = JSON.parse(text);
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
    const reading = normalizeText(String(meta?.reading ?? ''));
    const displayValue = String(frequency.displayValue ?? '').trim();

    if (term.includes('\n') || reading.includes('\n')) {
      throw new Error('Newlines in dictionary terms are not supported by the packed format.');
    }

    entries.push({
      term,
      reading,
      rank,
      display: displayId(displayValue),
    });
  }
}

if (entries.length === 0) throw new Error('No frequency entries found.');

const stringBlock = Buffer.from(
  entries.map((entry) => `${entry.term}\n${entry.reading}`).join('\n'),
  'utf8',
);

const displayTableParts = [];
for (const display of displayValues) {
  const bytes = Buffer.from(display, 'utf8');
  if (bytes.length > 255) throw new Error('Display label too long for packed format.');
  displayTableParts.push(Buffer.from([bytes.length]), bytes);
}
const displayTable = Buffer.concat(displayTableParts);

const headerSize = 20;
const padding = (4 - ((headerSize + metadata.length + displayTable.length) % 4)) % 4;
const ranksOffset = headerSize + metadata.length + displayTable.length + padding;
const idsOffset = ranksOffset + entries.length * 4;
const stringsOffset = idsOffset + entries.length;

const output = Buffer.allocUnsafe(stringsOffset + stringBlock.length);
output.writeUInt8(MAGIC[0], 0);
output.writeUInt8(MAGIC[1], 1);
output.writeUInt8(MAGIC[2], 2);
output.writeUInt8(MAGIC[3], 3);
output.writeUInt8(VERSION, 4);
output.writeUInt8(displayValues.length, 5);
output.writeUInt16LE(0, 6);
output.writeUInt32LE(entries.length, 8);
output.writeUInt32LE(stringBlock.length, 12);
output.writeUInt32LE(metadata.length, 16);

metadata.copy(output, headerSize);
displayTable.copy(output, headerSize + metadata.length);
for (let i = 0; i < entries.length; i += 1) {
  output.writeUInt32LE(entries[i].rank, ranksOffset + i * 4);
  output.writeUInt8(entries[i].display, idsOffset + i);
}
stringBlock.copy(output, stringsOffset);

const compressed = gzipSync(output, { level: 9 });
fs.writeFileSync(outputPath, compressed);

const tsvBytes = entries.reduce(
  (sum, entry) => sum + Buffer.byteLength(entry.term) + Buffer.byteLength(entry.reading) + 2,
  0,
);

console.log(`Entries: ${entries.length.toLocaleString()}`);
console.log(`Display labels: ${displayValues.length}`);
console.log(`Raw packed: ${(output.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`Gzipped:    ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`(uncompressed TSV would be ~${(tsvBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log('Wrote', outputPath);
