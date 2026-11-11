import { parseAnkiFile } from './lib/anki.js';
import {
  MATCH_MODE_LABELS,
  collectOccurrences,
  groupDuplicates,
  summarize,
} from './lib/dupes.js';

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 25;
const MAX_ROWS_PER_GROUP = 10;
const FILE_COLORS = ['var(--yellow)', 'var(--cyan)', 'var(--pink)', 'var(--lime)', 'var(--orange)', 'var(--purple)'];
const SEPARATOR_NAMES = {
  '\t': 'tab',
  ',': 'comma',
  ';': 'semicolon',
  '|': 'pipe',
  ' ': 'space',
};

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  fileList: $('fileList'),
  fileEmpty: $('fileEmpty'),
  settings: $('settings'),
  matchMode: $('matchMode'),
  parseNote: $('parseNote'),
  clearBtn: $('clearBtn'),

  resultsSection: $('resultsSection'),
  resultsSubtitle: $('resultsSubtitle'),

  heroFiles: $('heroFiles'),
  heroNotes: $('heroNotes'),
  heroGroups: $('heroGroups'),

  heroRedundant: $('heroRedundant'),
  heroDetail: $('heroDetail'),
  heroProgressWrap: $('heroProgressWrap'),
  heroProgress: $('heroProgress'),
  statFiles: $('statFiles'),
  statNotes: $('statNotes'),
  statUnique: $('statUnique'),
  statAcross: $('statAcross'),

  topList: $('topList'),
  multiplicityGrid: $('multiplicityGrid'),

  tabAllCount: $('tabAllCount'),
  tabAcrossCount: $('tabAcrossCount'),
  tabWithinCount: $('tabWithinCount'),
  searchInput: $('searchInput'),
  sortSelect: $('sortSelect'),
  exportBtn: $('exportBtn'),

  groupList: $('groupList'),
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
  files: [],
  mode: 'term-reading',
  results: null,
  stats: null,
  skipped: 0,
  nextFileId: 0,
  busy: false,
  view: {
    tab: 'all',
    query: '',
    sort: 'count-desc',
    page: 0,
  },
};

const numberFormatter = new Intl.NumberFormat('en-US');

function formatInt(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;

function showToast(message, duration = 3400) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), duration);
}

/* ------------------------------------------------------------------ files */

async function addFiles(fileList) {
  const incoming = [...fileList].filter(Boolean);
  if (!incoming.length) return;
  if (state.busy) {
    showToast('Still reading the previous files — try again in a moment.', 2600);
    return;
  }

  state.busy = true;
  showToast(`Reading ${incoming.length} file${incoming.length === 1 ? '' : 's'}…`, 2000);
  await new Promise((resolve) => setTimeout(resolve, 0));

  let added = 0;
  for (const file of incoming) {
    try {
      const text = await file.text();
      const parsed = parseAnkiFile(text);
      if (!parsed.rows.length) {
        showToast(`${file.name}: no note rows found — is this an Anki text export?`, 5200);
        continue;
      }
      state.nextFileId += 1;
      state.files.push({
        id: `f${state.nextFileId}`,
        name: file.name,
        size: file.size,
        parsed,
      });
      added += 1;
    } catch (error) {
      showToast(`${file.name}: could not read — ${error.message}`, 5200);
    }
  }

  state.busy = false;
  if (added > 0) {
    renderFileList();
    recompute();
    showToast(`${added} file${added === 1 ? '' : 's'} loaded.`, 2400);
  }
}

function removeFile(id) {
  const file = state.files.find((item) => item.id === id);
  state.files = state.files.filter((item) => item.id !== id);
  renderFileList();
  recompute();
  if (file) showToast(`Removed ${file.name}.`, 2200);
}

function clearFiles() {
  if (!state.files.length) return;
  const count = state.files.length;
  state.files = [];
  renderFileList();
  recompute();
  showToast(`Cleared ${count} file${count === 1 ? '' : 's'}.`, 2200);
}

function renderFileList() {
  els.fileList.innerHTML = state.files
    .map((file, index) => {
      const parsed = file.parsed;
      const separator = SEPARATOR_NAMES[parsed.separator] ?? 'custom';
      const reading =
        parsed.readingCol >= 0 ? `reading col ${parsed.readingCol + 1}` : 'no reading column';
      return `
        <div class="file-row">
          <span class="file-row__index" style="--file-color: ${FILE_COLORS[index % FILE_COLORS.length]}">${index + 1}</span>
          <div class="file-row__body">
            <p class="file-row__name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</p>
            <p class="file-row__meta">
              ${formatBytes(file.size)} · ${formatInt(parsed.rows.length)} notes ·
              ${separator} · term col ${parsed.termCol + 1} · ${reading}${
                parsed.hasHeader ? ' · header skipped' : ''
              }
            </p>
          </div>
          <button class="btn btn--small btn--white" type="button" data-remove="${file.id}">
            REMOVE
          </button>
        </div>`;
    })
    .join('');

  els.fileList.hidden = state.files.length === 0;
  els.fileEmpty.hidden = state.files.length > 0;
  els.settings.hidden = state.files.length === 0;
  els.clearBtn.disabled = state.files.length === 0;
}

/* ----------------------------------------------------------- duplicate scan */

function recompute() {
  els.heroFiles.textContent = formatInt(state.files.length);

  if (!state.files.length) {
    state.results = null;
    state.stats = null;
    state.skipped = 0;
    els.heroNotes.textContent = '0';
    els.heroGroups.textContent = '0';
    els.resultsSection.hidden = true;
    return;
  }

  const { occurrences, skipped } = collectOccurrences(state.files, { mode: state.mode });
  const groups = groupDuplicates(occurrences);
  const stats = summarize(occurrences, groups);
  stats.files = state.files.length;

  state.results = { occurrences, groups };
  state.stats = stats;
  state.skipped = skipped;
  state.view.page = 0;

  els.heroNotes.textContent = formatInt(stats.notes);
  els.heroGroups.textContent = formatInt(stats.groupCount);

  renderResults();
}

function renderResults() {
  const { stats, skipped } = state;
  if (!stats) return;

  els.resultsSection.hidden = false;

  els.resultsSubtitle.textContent = `${formatInt(stats.notes)} notes · ${formatInt(
    stats.files,
  )} file${stats.files === 1 ? '' : 's'} · matching ${MATCH_MODE_LABELS[state.mode]}`;

  els.heroRedundant.textContent = formatInt(stats.extraCopies);
  const skippedNote = skipped ? ` · ${formatInt(skipped)} blank row${skipped === 1 ? '' : 's'} skipped` : '';
  const extraLabel = stats.extraCopies === 1 ? 'extra copy' : 'extra copies';
  els.heroDetail.textContent = `${formatInt(stats.groupCount)} duplicate group${
    stats.groupCount === 1 ? '' : 's'
  } · ${formatInt(stats.duplicateNotes)} notes involved · ${formatInt(
    stats.extraCopies,
  )} ${extraLabel} you could remove${skippedNote}.`;

  const pct = stats.notes > 0 ? (stats.duplicateNotes / stats.notes) * 100 : 0;
  els.heroProgress.style.width = `${Math.min(100, pct)}%`;
  els.heroProgressWrap.setAttribute('aria-valuenow', String(Math.round(pct)));

  els.statFiles.textContent = formatInt(stats.files);
  els.statNotes.textContent = formatInt(stats.notes);
  els.statUnique.textContent = formatInt(stats.unique);
  els.statAcross.textContent = formatInt(stats.acrossFiles);

  renderTopRepeats();
  renderMultiplicity();
  renderTabs();
  renderGroups();
}

function renderTopRepeats() {
  const groups = [...state.results.groups].sort((a, b) => b.count - a.count).slice(0, 8);

  if (!groups.length) {
    els.topList.innerHTML = '<p class="settings__note">No repeated notes yet.</p>';
    return;
  }

  const max = groups[0].count;
  const colors = ['var(--pink)', 'var(--cyan)', 'var(--yellow)', 'var(--lime)', 'var(--orange)', 'var(--purple)'];

  els.topList.innerHTML = groups
    .map((group, index) => {
      const width = Math.max(6, (group.count / max) * 100);
      const label = group.term.length > 14 ? `${group.term.slice(0, 13)}…` : group.term;
      const title = `${group.term}${group.readings.length ? ` (${group.readings.join(' / ')})` : ''}`;
      return `
        <div class="tier-row" style="--tier-color: ${colors[index % colors.length]}">
          <span class="tier-row__name" title="${escapeHtml(title)}">${escapeHtml(label)}</span>
          <div class="tier-row__track" title="${escapeHtml(title)} — ${group.count} copies">
            <div class="tier-row__fill" style="width: ${width}%"></div>
          </div>
          <span class="tier-row__count">${formatInt(group.count)}×</span>
        </div>`;
    })
    .join('');
}

function renderMultiplicity() {
  const groups = state.results.groups;
  const buckets = [
    { label: '2 notes', value: 0 },
    { label: '3 notes', value: 0 },
    { label: '4 notes', value: 0 },
    { label: '5+ notes', value: 0 },
  ];

  for (const group of groups) {
    if (group.count >= 5) buckets[3].value += 1;
    else buckets[group.count - 2].value += 1;
  }

  els.multiplicityGrid.innerHTML = buckets
    .map(
      (bucket) => `
        <div class="cutoff-tile">
          <p class="cutoff-tile__label">${bucket.label}</p>
          <p class="cutoff-tile__value">${formatInt(bucket.value)}</p>
          <p class="cutoff-tile__sub">duplicate group${bucket.value === 1 ? '' : 's'}</p>
        </div>`,
    )
    .join('');
}

function renderTabs() {
  const { stats } = state;
  els.tabAllCount.textContent = formatInt(stats.groupCount);
  els.tabAcrossCount.textContent = formatInt(stats.acrossFiles);
  els.tabWithinCount.textContent = formatInt(stats.withinFile);

  document.querySelectorAll('.tab').forEach((button) => {
    const active = button.dataset.tab === state.view.tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

/* ---------------------------------------------------------------- filtering */

function getFilteredGroups() {
  let groups = [...state.results.groups];

  if (state.view.tab === 'across') groups = groups.filter((group) => group.fileCount > 1);
  else if (state.view.tab === 'within') groups = groups.filter((group) => group.fileCount === 1);

  const query = state.view.query.trim().toLowerCase();
  if (query) {
    groups = groups.filter((group) => {
      const haystack = [group.term, ...group.readings, ...group.fileNames]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  switch (state.view.sort) {
    case 'count-desc':
      groups.sort(
        (a, b) =>
          b.count - a.count ||
          b.fileCount - a.fileCount ||
          a.term.localeCompare(b.term, 'ja'),
      );
      break;
    case 'files-desc':
      groups.sort(
        (a, b) =>
          b.fileCount - a.fileCount ||
          b.count - a.count ||
          a.term.localeCompare(b.term, 'ja'),
      );
      break;
    case 'term':
      groups.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
      break;
    case 'file-order':
    default:
      break;
  }

  return groups;
}

function groupHtml(group) {
  const visible = group.occurrences.slice(0, MAX_ROWS_PER_GROUP);
  const hidden = group.count - visible.length;
  const readings = group.readings.length
    ? `<p class="dup-group__reading">${escapeHtml(group.readings.join(' / '))}</p>`
    : '';

  const rows = visible
    .map(
      (occurrence) => `
        <li class="dup-row">
          <span class="dup-row__file" title="${escapeHtml(occurrence.fileName)}">${escapeHtml(
            occurrence.fileName,
          )}</span>
          <span class="dup-row__pos">note ${formatInt(occurrence.note)}</span>
          <span class="dup-row__preview" title="${escapeHtml(occurrence.preview)}">${escapeHtml(
            occurrence.preview,
          )}</span>
        </li>`,
    )
    .join('');

  const more = hidden
    ? `<li class="dup-row dup-row--more">+ ${formatInt(hidden)} more cop${
        hidden === 1 ? 'y' : 'ies'
      } (included in the CSV export)</li>`
    : '';

  return `
    <article class="dup-group">
      <header class="dup-group__head">
        <span class="dup-group__count" aria-label="${group.count} copies">${formatInt(
          group.count,
        )}×</span>
        <div class="dup-group__main">
          <p class="dup-group__term">${escapeHtml(group.term)}</p>
          ${readings}
        </div>
        <span class="badge ${group.fileCount > 1 ? 'badge--pink' : 'badge--yellow'}">${formatInt(
          group.fileCount,
        )} file${group.fileCount === 1 ? '' : 's'}</span>
      </header>
      <ol class="dup-group__rows">${rows}${more}</ol>
    </article>`;
}

function renderGroups() {
  if (!state.results) return;
  const filtered = getFilteredGroups();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.view.page = Math.min(state.view.page, totalPages - 1);

  const start = state.view.page * PAGE_SIZE;
  const pageGroups = filtered.slice(start, start + PAGE_SIZE);

  els.groupList.innerHTML = pageGroups.map(groupHtml).join('');

  const noneAtAll = state.results.groups.length === 0;
  els.emptyResults.hidden = filtered.length > 0;
  els.emptyResults.textContent = noneAtAll
    ? 'No duplicates found — your notes look clean.'
    : 'No duplicate groups match this filter.';

  els.pagination.hidden = filtered.length === 0;
  els.pageInfo.textContent = `PAGE ${state.view.page + 1} / ${totalPages}`;
  els.prevBtn.disabled = state.view.page === 0;
  els.nextBtn.disabled = state.view.page >= totalPages - 1;

  const notesOnPage = pageGroups.reduce((total, group) => total + group.count, 0);
  els.rowInfo.textContent = `${formatInt(filtered.length)} group${
    filtered.length === 1 ? '' : 's'
  } · ${formatInt(notesOnPage)} notes on this page`;
}

/* --------------------------------------------------------------------- CSV */

function csvCell(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formula injection from note text.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  if (!state.results || state.results.groups.length === 0) {
    showToast('No duplicate groups to export.', 2600);
    return;
  }

  const groups = getFilteredGroups();
  if (!groups.length) {
    showToast('No duplicate groups match the current filter.', 3000);
    return;
  }

  const rows = [
    ['group', 'copies', 'term', 'reading', 'files', 'file', 'note', 'preview'],
  ];

  groups.forEach((group, groupIndex) => {
    for (const occurrence of group.occurrences) {
      rows.push([
        groupIndex + 1,
        group.count,
        group.term,
        group.readings.join(' / '),
        group.fileNames.join(' / '),
        occurrence.fileName,
        occurrence.note,
        occurrence.preview,
      ]);
    }
  });

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `anki-duplicates-${stamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  showToast(`Exported ${formatInt(rows.length - 1)} duplicate rows.`, 3000);
}

/* ------------------------------------------------------------------ events */

els.dropzone.addEventListener('click', () => els.fileInput.click());

els.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
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
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
});

els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files?.length) addFiles(els.fileInput.files);
  els.fileInput.value = '';
});

els.fileList.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-remove]');
  if (button) removeFile(button.dataset.remove);
});

els.clearBtn.addEventListener('click', clearFiles);

els.matchMode.addEventListener('change', () => {
  state.mode = els.matchMode.value;
  recompute();
  if (state.stats) {
    showToast(`Matching by ${MATCH_MODE_LABELS[state.mode].toLowerCase()}.`, 2400);
  }
});

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.view.tab = button.dataset.tab;
    state.view.page = 0;
    renderTabs();
    renderGroups();
  });
});

els.searchInput.addEventListener('input', () => {
  state.view.query = els.searchInput.value;
  state.view.page = 0;
  renderGroups();
});

els.sortSelect.addEventListener('change', () => {
  state.view.sort = els.sortSelect.value;
  state.view.page = 0;
  renderGroups();
});

els.prevBtn.addEventListener('click', () => {
  if (state.view.page > 0) {
    state.view.page -= 1;
    renderGroups();
  }
});

els.nextBtn.addEventListener('click', () => {
  state.view.page += 1;
  renderGroups();
});

els.exportBtn.addEventListener('click', exportCsv);

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
renderFileList();
