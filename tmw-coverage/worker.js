/**
 * Module worker: loads the compact packed index (tmw-index.bin.gz) or unzips
 * and parses tmw-freq.zip, then answers coverage checks. Keeping the 231k-term
 * index here means the UI thread never blocks on lookups.
 */

import { buildPackedIndex, parsePackedIndex } from './lib/binindex.js';
import { buildFrequencyIndex, checkRows, isMetaBankName } from './lib/dict.js';
import { readZipTexts } from './lib/zip.js';

let index = null;
let dictionaryMeta = null;
let loadToken = 0;

function post(message) {
  self.postMessage(message);
}

/** Progress from a superseded load must not overwrite the current one. */
function reporter(token) {
  return (message) => {
    if (token === loadToken) post(message);
  };
}

async function inflateGzip(buffer) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'Your browser does not support DecompressionStream. Use a current version of Chrome, Edge, Firefox or Safari.',
    );
  }

  try {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('The packed index is not valid gzip data.');
  }
}

function errorText(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text || 'unknown error';
}

async function loadPackedDictionary(buffer, sourceName, token) {
  const started = performance.now();
  const report = reporter(token);
  index = null;
  dictionaryMeta = null;

  report({
    type: 'dict-progress',
    phase: 'Decompressing packed index',
    detail: sourceName,
    done: 0,
    total: 1,
  });

  const raw = await inflateGzip(buffer);
  if (token !== loadToken) return;

  report({
    type: 'dict-progress',
    phase: 'Reading packed index',
    detail: `${(raw.byteLength / 1024 / 1024).toFixed(1)} MB`,
    done: 0,
    total: 1,
  });

  const parsed = parsePackedIndex(raw);
  if (token !== loadToken) return;

  report({
    type: 'dict-progress',
    phase: 'Building frequency index',
    detail: `${parsed.entryCount.toLocaleString('en-US')} entries`,
    done: 0,
    total: Math.max(1, parsed.entryCount),
  });

  index = buildPackedIndex(parsed, (done, total) => {
    report({
      type: 'dict-progress',
      phase: 'Building frequency index',
      detail: `${Math.round((done / Math.max(1, total)) * 100)}%`,
      done,
      total,
    });
  });
  if (token !== loadToken) return;

  dictionaryMeta = parsed.meta;
  post({
    type: 'dict-ready',
    format: 'packed',
    sourceName,
    meta: dictionaryMeta,
    termCount: index.termCount,
    entryCount: index.entryCount,
    readingCount: index.readingCount,
    totalEntries: index.totalEntries,
    duplicateCount: index.duplicateCount,
    minRank: index.minRank,
    maxRank: index.maxRank,
    elapsedMs: Math.round(performance.now() - started),
  });
}

async function loadDictionary(buffer, sourceName, token) {
  const started = performance.now();
  const report = reporter(token);
  index = null;
  dictionaryMeta = null;

  report({
    type: 'dict-progress',
    phase: 'Opening archive',
    detail: sourceName,
    done: 0,
    total: 1,
  });

  const texts = await readZipTexts(
    buffer,
    (name) => name === 'index.json' || isMetaBankName(name),
    (done, total) => {
      report({
        type: 'dict-progress',
        phase: 'Unpacking frequency banks',
        detail: `${done} / ${total} files`,
        done,
        total,
      });
    },
  );
  if (token !== loadToken) return;

  // index.json is optional, but present in the official archive.
  const metadataText = texts.get('index.json');
  if (metadataText) {
    try {
      dictionaryMeta = JSON.parse(metadataText);
    } catch {
      dictionaryMeta = null;
    }
  }

  const files = [];
  for (const [name, text] of texts) {
    if (isMetaBankName(name)) files.push({ name, text });
  }

  if (files.length === 0) {
    throw new Error('No term_meta_bank_*.json files were found in the zip.');
  }

  files.sort((a, b) => {
    const aNum = Number(a.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    const bNum = Number(b.name.match(/(\d+)\.json$/)?.[1] ?? 0);
    return aNum - bNum;
  });

  report({
    type: 'dict-progress',
    phase: 'Building frequency index',
    detail: `${files.length} banks`,
    done: 0,
    total: files.length,
  });

  index = buildFrequencyIndex(files, (done, total) => {
    report({
      type: 'dict-progress',
      phase: 'Building frequency index',
      detail: `${done} / ${total} banks`,
      done,
      total,
    });
  });
  if (token !== loadToken) return;

  post({
    type: 'dict-ready',
    format: 'zip',
    sourceName,
    meta: dictionaryMeta,
    termCount: index.termCount,
    entryCount: index.entryCount,
    readingCount: index.readingCount,
    totalEntries: index.totalEntries,
    duplicateCount: index.duplicateCount,
    minRank: index.minRank,
    maxRank: index.maxRank,
    elapsedMs: Math.round(performance.now() - started),
  });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'load-dict' || message.type === 'load-packed') {
    const token = ++loadToken;
    try {
      if (message.type === 'load-packed') {
        await loadPackedDictionary(
          message.buffer,
          message.sourceName || 'tmw-index.bin.gz',
          token,
        );
      } else {
        await loadDictionary(message.buffer, message.sourceName || 'tmw-freq.zip', token);
      }
    } catch (error) {
      if (token !== loadToken) return;
      index = null;
      post({
        type: 'error',
        scope: message.type,
        message: errorText(error),
      });
    }
    return;
  }

  if (message.type === 'check') {
    try {
      if (!index) throw new Error('The frequency dictionary is not loaded yet.');
      const results = checkRows(index, message.rows ?? [], {
        matchReading: Boolean(message.options?.matchReading),
      });
      post({
        type: 'check-done',
        requestId: message.requestId,
        results,
      });
    } catch (error) {
      post({
        type: 'error',
        scope: 'check',
        requestId: message.requestId,
        message: errorText(error),
      });
    }
  }
};
