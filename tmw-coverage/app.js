import {
  TIER_ORDER,
  cleanCell,
  normalizeText,
  parseAnkiFile,
} from './lib/anki.js';

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 50;
const CUTOFFS = [500, 1000, 2000, 5000, 10000, 20000, 30000, 50000];

const els = {
  dictCard: $('dictCard'),
  dictTitle: $('dictTitle'),
  dictMeta: $('dictMeta'),
  dictBadge: $('dictBadge'),
  dictProgressWrap: $('dictProgressWrap'),
  dictProgress: $('dictProgress'),
  dictError: $('dictError'),
  dictErrorText: $('dictErrorText'),
  zipInput: $('zipInput'),

  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  fileCard: $('fileCard'),
  fileName: $('fileName'),
  fileMeta: $('fileMeta'),
  changeFileBtn: $('changeFileBtn'),

  settings: $('settings'),
  termColSelect: $('termColSelect'),
  readingColSelect: $('readingColSelect'),
  delimiterSelect: $('delimiterSelect'),
  matchReading: $('matchReading'),
  recheckBtn: $('recheckBtn'),
  parseNote: $('parseNote'),

  resultsSection: $('resultsSection'),
  resultsSubtitle: $('resultsSubtitle'),

  heroPct: $('heroPct'),
  heroDetail: $('heroDetail'),
  heroProgressWrap: $('heroProgressWrap'),
  heroProgress: $('heroProgress'),
  statCards: $('statCards'),
  statUnique: $('statUnique'),
  statCovered: $('statCovered'),
  statMissing: $('statMissing'),

  cutoffGrid: $('cutoffGrid'),
  tierList: $('tierList'),

  tabAllCount: $('tabAllCount'),
  tabCoveredCount: $('tabCoveredCount'),
  tabMissingCount: $('tabMissingCount'),
  searchInput: $('searchInput'),
  tierFilter: $('tierFilter'),
  sortSelect: $('sortSelect'),
  exportBtn: $('exportBtn'),

  tableBody: $('tableBody'),
  emptyResults: $('emptyResults'),
  pagination: $('pagination'),
  pageInfo: $('pageInfo'),
  rowInfo: $('rowInfo'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),

  toast: $('toast'),

  themeToggle: $('themeToggle'),
  themeIcon: $('themeIcon'),
  themeLabel: $('themeLabel'),
};

const state = {
  dict: {
    status: 'loading',
    meta: null,
    sourceName: 'tmw-freq.zip',
    termCount: 0,
    entryCount: 0,
    readingCount: 0,
  },
  rawText: '',
  sourceName: '',
  sourceSize: 0,
  delimiter: 'auto',
  parsed: null,
  termCol: 0,
  readingCol: -1,
  matchReading: false,
  checking: false,
  results: null,
  stats: null,
  skipped: 0,
  view: {
    tab: 'all',
    query: '',
    tier: 'all',
    sort: 'file',
    page: 0,
  },
  requestId: 0,
  checkTimer: null,
};

const numberFormatter = new Intl.NumberFormat('en-US');

function formatInt(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

function formatPct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<0.01%';
  if (value >= 99.95) return '100%';
  if (value === 0) return '0%';
  return `${value.toFixed(digits)}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortNumber(value) {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

function separatorName(separator) {
  return (
    {
      '\t': 'Tab',
      ',': 'Comma',
      ';': 'Semicolon',
      '|': 'Pipe',
      ' ': 'Space',
    }[separator] ?? 'Tab'
  );
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function tierClass(tier) {
  const key = String(tier ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return `tier-chip--${key || 'mythic'}`;
}

function matchLabel(matchType) {
  return (
    {
      expression: 'EXACT',
      annotation: 'ANNOTATED',
      reading: 'READING',
    }[matchType] ?? '—'
  );
}

/* ------------------------------------------------------------------ toast */

let toastTimer = null;

function showToast(message, duration = 2800) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), duration);
}

/* ------------------------------------------------------- dictionary state */

let worker = null;
let dictionaryLoadSeq = 0;
let dictionaryFallbackStarted = false;

function updateRecheckAvailability() {
  els.recheckBtn.disabled =
    state.dict.status !== 'ready' || !state.parsed || state.checking;
}

function setDictLoading(message) {
  state.dict.status = 'loading';
  els.dictCard.dataset.state = 'loading';
  els.dictBadge.textContent = 'LOADING';
  els.dictBadge.className = 'badge badge--status is-loading';
  els.dictMeta.textContent = message;
  els.dictProgressWrap.hidden = false;
  els.dictError.hidden = true;
  els.dictProgress.style.width = '0%';
  els.dictProgressWrap.setAttribute('aria-valuenow', '0');
  updateRecheckAvailability();
}

function setDictError(message) {
  state.dict.status = 'error';
  els.dictCard.dataset.state = 'error';
  els.dictBadge.textContent = 'ERROR';
  els.dictBadge.className = 'badge badge--status is-error';
  els.dictMeta.textContent = 'Dictionary unavailable';
  els.dictErrorText.textContent = message;
  els.dictError.hidden = false;
  els.dictProgressWrap.hidden = true;
  updateRecheckAvailability();
}

function setDictReady(payload) {
  state.dict.status = 'ready';
  state.dict.meta = payload.meta ?? null;
  state.dict.termCount = payload.termCount;
  state.dict.entryCount = payload.entryCount;
  state.dict.readingCount = payload.readingCount;

  const title = payload.meta?.title ? `${payload.meta.title} frequency list` : 'TMW frequency list';
  const revision = payload.meta?.revision ? `rev ${payload.meta.revision} · ` : '';
  const seconds = Number.isFinite(payload.elapsedMs) ? `${(payload.elapsedMs / 1000).toFixed(1)}s` : 'ready';
  const source = payload.format === 'packed' ? 'packed index' : 'zip';

  els.dictTitle.textContent = title;
  els.dictMeta.textContent = `${formatInt(payload.termCount)} terms · ${formatInt(
    payload.entryCount,
  )} entries · ${revision}loaded from ${source} in ${seconds}`;
  els.dictBadge.textContent = 'READY';
  els.dictBadge.className = 'badge badge--status is-ready';
  els.dictCard.dataset.state = 'ready';
  els.dictProgress.style.width = '100%';
  els.dictProgressWrap.setAttribute('aria-valuenow', '100');
  els.dictError.hidden = true;
  els.dictProgressWrap.hidden = false;
  updateRecheckAvailability();

  showToast(`Dictionary ready — ${formatInt(payload.termCount)} terms indexed.`);

  if (state.parsed) {
    updateParseNote();
    scheduleCheck(40);
  }
}

function onWorkerMessage(event) {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'dict-progress') {
    const done = Number(message.done) || 0;
    const total = Math.max(1, Number(message.total) || 1);
    const pct = Math.min(100, (done / total) * 100);
    els.dictMeta.textContent = `${message.phase}${message.detail ? ` · ${message.detail}` : ''}…`;
    els.dictProgress.style.width = `${pct}%`;
    els.dictProgressWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    return;
  }

  if (message.type === 'dict-ready') {
    setDictReady(message);
    return;
  }

  if (message.type === 'check-done') {
    if (message.requestId !== state.requestId) return;
    state.checking = false;
    updateRecheckAvailability();
    applyResults(message.results ?? []);
    return;
  }

  if (message.type === 'error') {
    if (message.scope === 'load-packed') {
      loadZipDictionary(
        `Packed index failed (${message.message}). Falling back to tmw-freq.zip…`,
      );
    } else if (message.scope === 'load-dict') {
      setDictError(
        `${message.message} If the bundled zip can’t be fetched, choose your own tmw-freq.zip above.`,
      );
    } else {
      state.checking = false;
      updateRecheckAvailability();
      showToast(`Check failed: ${message.message}`, 5000);
    }
  }
}

function startWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', (event) => {
      state.checking = false;
      updateRecheckAvailability();
      setDictError(
        event.message
          ? `Worker error: ${event.message}`
          : 'The dictionary worker crashed. Try reloading the page.',
      );
    });
  } catch (error) {
    setDictError(`Could not start the worker: ${error.message}`);
  }
}

async function loadBundledDictionary() {
  if (!worker) return;
  const seq = ++dictionaryLoadSeq;
  setDictLoading('Fetching tmw-index.bin.gz…');

  try {
    const response = await fetch('./tmw-index.bin.gz', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (seq !== dictionaryLoadSeq) return;
    setDictLoading(`Loading packed index (${formatBytes(buffer.byteLength)})…`);
    worker.postMessage(
      { type: 'load-packed', buffer, sourceName: 'tmw-index.bin.gz' },
      [buffer],
    );
  } catch (error) {
    if (seq !== dictionaryLoadSeq) return;
    loadZipDictionary(
      `Packed index unavailable (${error.message}). Falling back to tmw-freq.zip…`,
    );
  }
}

async function loadZipDictionary(note) {
  if (!worker || dictionaryFallbackStarted) return;
  dictionaryFallbackStarted = true;
  const seq = ++dictionaryLoadSeq;

  if (note) showToast(note, 4500);
  setDictLoading('Fetching tmw-freq.zip…');

  try {
    const response = await fetch('./tmw-freq.zip', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (seq !== dictionaryLoadSeq) return;
    setDictLoading(`Unpacking tmw-freq.zip (${formatBytes(buffer.byteLength)})…`);
    worker.postMessage({ type: 'load-dict', buffer, sourceName: 'tmw-freq.zip' }, [buffer]);
  } catch (error) {
    if (seq !== dictionaryLoadSeq) return;
    setDictError(
      `Could not fetch ./tmw-freq.zip (${error.message}). Serve this folder over HTTP — for example “python3 -m http.server” — or load the zip manually.`,
    );
  }
}

/* ------------------------------------------------------------- file input */

async function handleDeckFile(file) {
  if (!file) return;

  if (file.size > 120 * 1024 * 1024) {
    showToast('That file is over 120 MB. Please split the export.', 5000);
    return;
  }

  showToast(`Reading ${file.name}…`, 1600);

  let text;
  try {
    text = await file.text();
  } catch (error) {
    showToast(`Could not read that file: ${error.message}`, 5000);
    return;
  }

  if (!text.trim()) {
    showToast('That file is empty.', 3500);
    return;
  }

  state.rawText = text;
  state.sourceName = file.name || 'deck.txt';
  state.sourceSize = file.size;
  state.delimiter = 'auto';
  state.results = null;
  state.stats = null;
  state.skipped = 0;
  state.view = { tab: 'all', query: '', tier: 'all', sort: 'file', page: 0 };
  els.delimiterSelect.value = 'auto';
  els.searchInput.value = '';
  els.tierFilter.value = 'all';
  els.sortSelect.value = 'file';
  setTab('all');
  updateTabs();

  try {
    parseCurrentFile({ resetColumns: true });
  } catch (error) {
    showToast(`Could not parse that file: ${error.message}`, 5000);
    return;
  }

  els.dropzone.hidden = true;
  els.fileCard.hidden = false;
  els.settings.hidden = false;
  els.fileName.textContent = state.sourceName;
  updateFileMeta();
  updateParseNote();
  updateColumnOptions();

  els.resultsSection.hidden = true;
  els.resultsSection.classList.remove('is-visible');

  if (state.dict.status === 'ready') {
    scheduleCheck(60);
  } else {
    updateParseNote();
    els.parseNote.textContent += ' · waiting for the dictionary…';
  }
}

function handleZipFile(file) {
  if (!file || !worker) return;
  dictionaryLoadSeq += 1;
  dictionaryFallbackStarted = true;
  setDictLoading(`Reading ${file.name}…`);

  file
    .arrayBuffer()
    .then((buffer) => {
      worker.postMessage({ type: 'load-dict', buffer, sourceName: file.name }, [buffer]);
    })
    .catch((error) => {
      setDictError(`Could not read that zip: ${error.message}`);
    });
}

/* ----------------------------------------------------------- parse + check */

function parseCurrentFile({ resetColumns = false } = {}) {
  const parsed = parseAnkiFile(state.rawText, { delimiter: state.delimiter });
  state.parsed = parsed;

  if (resetColumns) {
    state.termCol = parsed.termCol;
    state.readingCol = parsed.readingCol;
  } else {
    if (state.termCol >= parsed.maxCols) state.termCol = 0;
    if (state.readingCol >= parsed.maxCols) state.readingCol = -1;
  }

  state.matchReading = els.matchReading.checked;
  updateColumnOptions();
  updateParseNote();
}

function updateFileMeta() {
  const parsed = state.parsed;
  if (!parsed) return;

  const parts = [
    formatBytes(state.sourceSize),
    `${formatInt(parsed.rows.length)} cards`,
    `${parsed.maxCols} columns`,
    `${separatorName(parsed.separator)}-separated`,
  ];
  if (parsed.html) parts.push('HTML stripped');
  els.fileMeta.textContent = parts.join(' · ');
}

function updateParseNote() {
  const parsed = state.parsed;
  if (!parsed) return;

  const firstRow = parsed.rows[0];
  const firstTerm = firstRow ? cleanCell(firstRow[state.termCol] ?? '', parsed.html) : '';
  const firstReading =
    firstRow && state.readingCol >= 0
      ? cleanCell(firstRow[state.readingCol] ?? '', parsed.html)
      : '';

  const parts = [
    `${formatInt(parsed.rows.length)} cards`,
    parsed.hasHeader ? 'header row skipped' : 'no header row',
  ];
  if (firstTerm) {
    parts.push(`preview 「${truncate(firstTerm, 18)}」${firstReading ? ` / ${truncate(firstReading, 16)}` : ''}`);
  }
  els.parseNote.textContent = parts.join(' · ');
}

function columnLabel(index) {
  const parsed = state.parsed;
  const header = parsed?.header?.[index] ? cleanCell(parsed.header[index], false) : '';
  let sample = '';
  if (parsed) {
    for (const row of parsed.rows.slice(0, 30)) {
      const value = cleanCell(row[index] ?? '', parsed.html);
      if (value) {
        sample = value;
        break;
      }
    }
  }

  const bits = [`Col ${index + 1}`];
  if (header) bits.push(truncate(header, 18));
  if (sample && sample !== header) bits.push(truncate(sample, 20));
  return bits.join(' · ');
}

function fillColumnSelect(select, includeNone, selected) {
  select.innerHTML = '';
  if (includeNone) select.add(new Option('None', '-1'));

  const maxCols = state.parsed?.maxCols ?? 0;
  for (let index = 0; index < maxCols; index += 1) {
    select.add(new Option(columnLabel(index), String(index)));
  }

  select.value = String(selected);
  if (select.value !== String(selected)) {
    select.value = includeNone ? '-1' : '0';
  }
  select.disabled = maxCols === 0;
}

function updateColumnOptions() {
  if (!state.parsed) return;
  fillColumnSelect(els.termColSelect, false, state.termCol);
  fillColumnSelect(els.readingColSelect, true, state.readingCol);

  if (!els.tierFilter.dataset.populated) {
    for (const tier of TIER_ORDER) {
      els.tierFilter.add(new Option(tier, tier));
    }
    els.tierFilter.dataset.populated = '1';
  }
}

function scheduleCheck(delay = 120) {
  clearTimeout(state.checkTimer);
  state.checkTimer = setTimeout(runCheck, delay);
}

function setChecking(checking) {
  state.checking = checking;
  updateRecheckAvailability();

  if (checking) {
    if (!els.recheckBtn.dataset.original) {
      els.recheckBtn.dataset.original = els.recheckBtn.innerHTML;
    }
    els.recheckBtn.innerHTML = 'CHECKING <span aria-hidden="true">…</span>';
  } else if (els.recheckBtn.dataset.original) {
    els.recheckBtn.innerHTML = els.recheckBtn.dataset.original;
    delete els.recheckBtn.dataset.original;
  }
}

function runCheck() {
  if (!worker || state.dict.status !== 'ready' || !state.parsed) return;

  const { rows, html } = state.parsed;
  const mapped = [];

  for (let index = 0; index < rows.length; index += 1) {
    const term = cleanCell(rows[index][state.termCol] ?? '', html);
    if (!term) continue;
    const reading =
      state.readingCol >= 0 ? cleanCell(rows[index][state.readingCol] ?? '', html) : '';
    mapped.push({ index, term, reading });
  }

  state.skipped = rows.length - mapped.length;
  state.view.page = 0;
  state.requestId += 1;
  setChecking(true);

  worker.postMessage({
    type: 'check',
    requestId: state.requestId,
    rows: mapped,
    options: { matchReading: state.matchReading },
  });
}

/* ------------------------------------------------------------------ stats */

function computeStats(results) {
  const uniqueMap = new Map();
  const matchTypeCounts = { expression: 0, annotation: 0, reading: 0 };
  let checkedRows = 0;
  let coveredRows = 0;

  for (const result of results) {
    const term = normalizeText(result.term);
    if (!term) continue;

    checkedRows += 1;
    if (result.covered) {
      coveredRows += 1;
      if (result.matchType in matchTypeCounts) matchTypeCounts[result.matchType] += 1;
    }

    let unique = uniqueMap.get(term);
    if (!unique) {
      unique = {
        term,
        rows: 0,
        covered: false,
        bestRank: Infinity,
        tier: null,
        labels: new Set(),
      };
      uniqueMap.set(term, unique);
    }

    unique.rows += 1;
    if (!result.covered) continue;

    unique.covered = true;
    for (const label of result.tiers ?? []) unique.labels.add(label);
    if (Number.isFinite(result.rank) && result.rank < unique.bestRank) {
      unique.bestRank = result.rank;
      unique.tier = result.tier;
    }
  }

  const uniqueList = [...uniqueMap.values()];
  const coveredUniqueList = uniqueList.filter((item) => item.covered);
  const coveredUnique = coveredUniqueList.length;
  const uniqueCount = uniqueList.length;
  const missingUnique = uniqueCount - coveredUnique;

  const tierCounts = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0]));
  for (const item of coveredUniqueList) {
    const labels = item.labels.size ? item.labels : item.tier ? [item.tier] : [];
    for (const label of labels) {
      if (label in tierCounts) tierCounts[label] += 1;
    }
  }

  const cutoffs = CUTOFFS.map((threshold) => {
    let count = 0;
    for (const item of coveredUniqueList) {
      if (item.bestRank <= threshold) count += 1;
    }
    return {
      threshold,
      count,
      pctOfUnique: uniqueCount ? (count / uniqueCount) * 100 : 0,
      pctOfCovered: coveredUnique ? (count / coveredUnique) * 100 : 0,
    };
  });

  return {
    uniqueCount,
    coveredUnique,
    missingUnique,
    checkedRows,
    coveredRows,
    missingRows: results.length - coveredRows,
    coveragePct: uniqueCount ? (coveredUnique / uniqueCount) * 100 : 0,
    rowCoveragePct: checkedRows ? (coveredRows / checkedRows) * 100 : 0,
    dictSharePct: state.dict.termCount ? (coveredUnique / state.dict.termCount) * 100 : 0,
    tierCounts,
    cutoffs,
    matchTypeCounts,
  };
}

function applyResults(results) {
  state.results = results;
  state.stats = computeStats(results);

  els.resultsSection.hidden = false;
  els.resultsSection.classList.add('is-visible');
  renderStats();
  renderCutoffs();
  renderTiers();
  renderView();

  showToast(`Checked ${formatInt(state.stats.checkedRows)} cards.`, 2200);
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;

  els.heroPct.textContent = formatPct(stats.coveragePct);
  els.heroDetail.textContent = `${formatInt(stats.coveredUnique)} of ${formatInt(
    stats.uniqueCount,
  )} unique expressions · ${formatInt(stats.coveredRows)} of ${formatInt(
    stats.checkedRows,
  )} cards · ${formatPct(stats.dictSharePct, 2)} of TMW touched`;

  els.heroProgress.style.width = `${Math.min(100, stats.coveragePct)}%`;
  els.heroProgressWrap.setAttribute('aria-valuenow', String(Math.round(stats.coveragePct)));

  els.statCards.textContent = formatInt(state.parsed?.rows.length ?? 0);
  els.statUnique.textContent = formatInt(stats.uniqueCount);
  els.statCovered.textContent = formatInt(stats.coveredUnique);
  els.statMissing.textContent = formatInt(stats.missingUnique);

  const parts = [
    state.sourceName,
    `${formatPct(stats.rowCoveragePct)} of cards`,
    `${formatPct(stats.coveragePct)} of unique expressions`,
  ];
  if (state.skipped) parts.push(`${formatInt(state.skipped)} empty skipped`);
  if (stats.matchTypeCounts.reading) {
    parts.push(`${formatInt(stats.matchTypeCounts.reading)} matched via reading`);
  }
  els.resultsSubtitle.textContent = parts.join(' · ');

  updateTabs();
}

function renderCutoffs() {
  const stats = state.stats;
  if (!stats) return;

  els.cutoffGrid.innerHTML = stats.cutoffs
    .map(
      (cutoff) => `
      <div class="cutoff-tile">
        <p class="cutoff-tile__label">Rank ≤ ${shortNumber(cutoff.threshold)}</p>
        <p class="cutoff-tile__value">${formatInt(cutoff.count)}</p>
        <p class="cutoff-tile__sub">${formatPct(cutoff.pctOfUnique)} of unique expressions</p>
      </div>`,
    )
    .join('');
}

function renderTiers() {
  const stats = state.stats;
  if (!stats) return;

  els.tierList.innerHTML = TIER_ORDER.map((tier) => {
    const count = stats.tierCounts[tier] ?? 0;
    const pct = stats.coveredUnique ? (count / stats.coveredUnique) * 100 : 0;
    return `
      <div class="tier-row tier--${tier.toLowerCase()}">
        <span class="tier-row__name">${tier}</span>
        <div class="tier-row__track" title="${count} words · ${formatPct(pct)} of covered">
          <div class="tier-row__fill" style="width: ${Math.min(100, pct)}%"></div>
        </div>
        <span class="tier-row__count">${formatInt(count)} · ${Math.round(pct)}%</span>
      </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- filtering */

function getFilteredResults() {
  let rows = state.results ?? [];

  if (state.view.tab === 'covered') rows = rows.filter((row) => row.covered);
  else if (state.view.tab === 'missing') rows = rows.filter((row) => !row.covered);

  if (state.view.tier !== 'all') {
    rows = rows.filter(
      (row) =>
        row.covered &&
        (row.tiers?.includes(state.view.tier) || row.tier === state.view.tier),
    );
  }

  const query = state.view.query.toLowerCase();
  if (query) {
    rows = rows.filter((row) => {
      return (
        String(row.term).toLowerCase().includes(query) ||
        String(row.reading).toLowerCase().includes(query) ||
        String(row.matchedTerm).toLowerCase().includes(query)
      );
    });
  }

  if (state.view.sort === 'rank-asc' || state.view.sort === 'rank-desc') {
    const direction = state.view.sort === 'rank-asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (a.covered !== b.covered) return a.covered ? -1 : 1;
      const aRank = Number.isFinite(a.rank) ? a.rank : Infinity;
      const bRank = Number.isFinite(b.rank) ? b.rank : Infinity;
      if (aRank !== bRank) return (aRank - bRank) * direction;
      return (a.index ?? 0) - (b.index ?? 0);
    });
  } else if (state.view.sort === 'term') {
    rows = [...rows].sort((a, b) => {
      const byTerm = String(a.term).localeCompare(String(b.term), 'ja');
      return byTerm || (a.index ?? 0) - (b.index ?? 0);
    });
  } else {
    rows = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  return rows;
}

function updateTabs() {
  const results = state.results ?? [];
  const coveredRows = results.filter((row) => row.covered).length;
  els.tabAllCount.textContent = formatInt(results.length);
  els.tabCoveredCount.textContent = formatInt(coveredRows);
  els.tabMissingCount.textContent = formatInt(results.length - coveredRows);
}

function renderView() {
  if (!state.results) return;

  const rows = getFilteredResults();
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.view.page = Math.min(Math.max(0, state.view.page), pageCount - 1);

  const start = state.view.page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  els.tableBody.innerHTML = pageRows
    .map((row) => {
      const number = (row.index ?? 0) + 1;
      const labels = row.tiers?.length ? row.tiers : row.tier ? [row.tier] : [];
      const tierChips = row.covered
        ? labels.map((label) => `<span class="tier-chip ${tierClass(label)}">${esc(label)}</span>`).join('')
        : '<span class="cell-match">—</span>';
      const status = row.covered
        ? '<span class="status status--covered">IN TMW</span>'
        : '<span class="status status--missing">MISSING</span>';
      const rank =
        row.covered && Number.isFinite(row.rank)
          ? `<span class="rank-num">#${formatInt(row.rank)}</span>`
          : '<span class="rank-num">—</span>';

      return `
        <tr class="${row.covered ? '' : 'is-missing'}">
          <td class="cell-num">${number}</td>
          <td class="cell-term" lang="ja">${esc(row.term)}</td>
          <td class="cell-reading" lang="ja">${esc(row.reading)}</td>
          <td>${status}</td>
          <td class="cell-rank">${rank}</td>
          <td>${tierChips}</td>
          <td class="cell-match">${row.covered ? matchLabel(row.matchType) : '—'}</td>
        </tr>`;
    })
    .join('');

  els.emptyResults.hidden = rows.length !== 0;
  els.pageInfo.textContent = `PAGE ${state.view.page + 1} / ${pageCount}`;
  els.rowInfo.textContent = rows.length
    ? `Showing ${formatInt(start + 1)}–${formatInt(Math.min(start + PAGE_SIZE, rows.length))} of ${formatInt(rows.length)}`
    : '0 rows';

  els.prevBtn.disabled = state.view.page <= 0;
  els.nextBtn.disabled = state.view.page >= pageCount - 1;
}

/* ------------------------------------------------------------------- tabs */

function setTab(tab) {
  state.view.tab = tab;
  state.view.page = 0;
  for (const button of document.querySelectorAll('.tab')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  renderView();
}

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
}

els.searchInput.addEventListener('input', () => {
  state.view.query = els.searchInput.value.trim();
  state.view.page = 0;
  renderView();
});

els.tierFilter.addEventListener('change', () => {
  state.view.tier = els.tierFilter.value;
  state.view.page = 0;
  renderView();
});

els.sortSelect.addEventListener('change', () => {
  state.view.sort = els.sortSelect.value;
  state.view.page = 0;
  renderView();
});

els.prevBtn.addEventListener('click', () => {
  if (state.view.page > 0) {
    state.view.page -= 1;
    renderView();
    els.pagination.scrollIntoView({ block: 'nearest' });
  }
});

els.nextBtn.addEventListener('click', () => {
  state.view.page += 1;
  renderView();
  els.pagination.scrollIntoView({ block: 'nearest' });
});

/* ----------------------------------------------------------------- export */

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!state.results) return;

  const rows = getFilteredResults();
  if (rows.length === 0) {
    showToast('Nothing to export with this filter.', 2600);
    return;
  }

  const header = [
    'Row',
    'Expression',
    'Reading',
    'Covered',
    'Rank',
    'Tier',
    'Match',
    'Matched term',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        (row.index ?? 0) + 1,
        row.term,
        row.reading,
        row.covered ? 'yes' : 'no',
        row.covered && Number.isFinite(row.rank) ? row.rank : '',
        row.tiers?.length ? row.tiers.join(' / ') : '',
        row.covered ? matchLabel(row.matchType).toLowerCase() : '',
        row.matchedTerm ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const base =
    state.sourceName
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'deck';
  const filename = `${base}-tmw-${state.view.tab}.csv`;
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  showToast(`Exported ${formatInt(rows.length)} rows to ${filename}.`, 3200);
}

els.exportBtn.addEventListener('click', exportCsv);

/* ----------------------------------------------------------------- events */

els.dropzone.addEventListener('click', (event) => {
  if (event.target.closest('input')) return;
  els.fileInput.value = '';
  els.fileInput.click();
});

els.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    els.fileInput.value = '';
    els.fileInput.click();
  }
});

for (const eventName of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-dragover');
  });
}

for (const eventName of ['dragleave', 'dragend']) {
  els.dropzone.addEventListener(eventName, () => {
    els.dropzone.classList.remove('is-dragover');
  });
}

els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  els.dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) handleDeckFile(file);
});

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files?.[0];
  if (file) handleDeckFile(file);
  els.fileInput.value = '';
});

els.changeFileBtn.addEventListener('click', () => {
  els.fileInput.value = '';
  els.fileInput.click();
});

els.zipInput.addEventListener('change', () => {
  const file = els.zipInput.files?.[0];
  if (file) handleZipFile(file);
  els.zipInput.value = '';
});

els.termColSelect.addEventListener('change', () => {
  state.termCol = Number(els.termColSelect.value);
  updateParseNote();
  scheduleCheck(60);
});

els.readingColSelect.addEventListener('change', () => {
  state.readingCol = Number(els.readingColSelect.value);
  updateParseNote();
  scheduleCheck(60);
});

els.matchReading.addEventListener('change', () => {
  state.matchReading = els.matchReading.checked;
  scheduleCheck(60);
});

els.delimiterSelect.addEventListener('change', () => {
  state.delimiter = els.delimiterSelect.value;
  if (!state.parsed) return;
  try {
    parseCurrentFile({ resetColumns: true });
    updateFileMeta();
    updateParseNote();
    scheduleCheck(60);
  } catch (error) {
    showToast(`Could not parse with that delimiter: ${error.message}`, 5000);
  }
});

els.recheckBtn.addEventListener('click', () => {
  if (state.dict.status !== 'ready') {
    showToast('The dictionary is still loading.', 2600);
    return;
  }
  scheduleCheck(0);
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'twm-theme';
const THEME_MODES = ['auto', 'light', 'dark'];
const THEME_META = {
  auto: { label: 'AUTO', icon: '◐', title: 'Theme: auto (follows system)', next: 'light' },
  light: { label: 'LIGHT', icon: '☀', title: 'Theme: light', next: 'dark' },
  dark: { label: 'DARK', icon: '☾', title: 'Theme: dark', next: 'auto' },
};
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

let currentTheme = 'auto';

function readThemeMode() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEME_MODES.includes(saved)) return saved;
  } catch (error) {
    /* storage may be blocked; fall back to auto */
  }
  return 'auto';
}

function resolvedTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemTheme.matches ? 'dark' : 'light';
}

function applyTheme(mode) {
  const themeMode = THEME_MODES.includes(mode) ? mode : 'auto';
  const resolved = resolvedTheme(themeMode);
  const meta = THEME_META[themeMode];
  const root = document.documentElement;

  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', themeMode);

  if (els.themeIcon) els.themeIcon.textContent = meta.icon;
  if (els.themeLabel) els.themeLabel.textContent = meta.label;
  if (els.themeToggle) {
    els.themeToggle.title = meta.title;
    els.themeToggle.setAttribute(
      'aria-label',
      `${meta.title}. Activate for ${THEME_META[meta.next].label.toLowerCase()} theme.`,
    );
  }

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', resolved === 'dark' ? '#17171a' : '#ffd93d');
  }
  return themeMode;
}

function setTheme(mode) {
  currentTheme = applyTheme(mode);
  try {
    localStorage.setItem(THEME_KEY, currentTheme);
  } catch (error) {
    /* storage may be blocked; the theme still applies for this visit */
  }
}

function initTheme() {
  currentTheme = applyTheme(readThemeMode());

  els.themeToggle?.addEventListener('click', () => {
    setTheme(THEME_META[currentTheme].next);
  });

  const onSystemChange = () => {
    if (currentTheme === 'auto') applyTheme('auto');
  };
  if (typeof systemTheme.addEventListener === 'function') {
    systemTheme.addEventListener('change', onSystemChange);
  } else if (typeof systemTheme.addListener === 'function') {
    systemTheme.addListener(onSystemChange);
  }
}

/* ------------------------------------------------------------------- boot */

initTheme();
startWorker();
loadBundledDictionary();
