# TMW Tools

Two neo-brutalist, fully client-side tools for Anki users, plus a landing page that links
to both. Everything runs in the browser: no accounts, no uploads, no backend, no build step.

## Quick start

```bash
cd /root/tmw
python3 -m http.server 8000
```

Open <http://localhost:8000>.

Serve from the repository root — the hub links to the `tmw-coverage/` and `dupes/`
subfolders. Opening `index.html` directly with `file://` will not work because both tools
use JavaScript modules and `fetch`.

## What’s inside

| Page | URL | What it does |
| --- | --- | --- |
| **Hub** (`index.html`) | `/` | Shared landing page linking both tools |
| **TMW Freq Checker** (`tmw-coverage/`) | `/tmw-coverage/` | Checks an exported deck against the TMW v2 frequency dictionary |
| **Duplicate Scanner** (`dupes/`) | `/dupes/` | Finds duplicate notes across one or many exported Anki files |

### TMW Freq Checker

Drop an Anki notes export and see:

- unique-expression coverage against **TMW v2**,
- covered vs. missing cards,
- cumulative coverage at rank cutoffs,
- Student → Immortal → Mythic tier breakdowns,
- a searchable card-by-card report and CSV export.

The page loads the pre-built `tmw-index.bin.gz` first and falls back to parsing
`tmw-freq.zip` in a Web Worker if the packed index is unavailable.

### Duplicate Scanner

Load one or more note exports at once and see:

- duplicate groups grouped by expression/reading/exact row,
- cross-file duplicates separately from single-file duplicates,
- every copy’s file name and note number,
- top repeats, copy-count buckets, search, sorting, pagination and CSV export.

Match modes: **Expression + reading** (default), **Expression only**, and **Exact note row**.
Keys are NFKC-normalized, case-insensitive, and ignore trailing `[reading]` annotations.

## Theme

Both tools and the hub share the same Auto / Light / Dark theme control. Auto follows
`prefers-color-scheme`, manual choices persist in `localStorage` under `twm-theme`, and an
inline head script applies the theme before the stylesheet paints.

## Tests

Both suites are dependency-free and run with Node:

```bash
cd tmw-coverage && node test/check.mjs
cd dupes && node test/check.mjs
```

Current coverage-suite highlights:

```text
231,414 dictionary terms
243,795 entries / 211,273 readings
9,109 Anki rows · 8,853 unique expressions
6,112 covered unique expressions (69.04%)
5,145 Immortal / 194,191 Mythic terms
```

The duplicate suite covers all match modes, cross-file grouping, blank rows, missing
reading columns, annotation stripping, width/case folding, and summary counts.

## Files

```text
tmw/
├── index.html              # hub linking both tools
├── tmw-coverage/           # TMW v2 frequency coverage checker
│   ├── index.html
│   ├── app.js              # UI, parsing, stats, table, CSV
│   ├── worker.js           # loads the packed index or zip
│   ├── lib/                # anki, binindex, dict, zip helpers
│   ├── tools/build-index.mjs
│   ├── test/check.mjs
│   ├── tmw-index.bin.gz    # fast default index (≈2.1 MB)
│   └── tmw-freq.zip        # source dictionary (≈5.3 MB)
├── dupes/                  # Anki duplicate scanner
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── lib/                # anki + duplicate grouping
│   └── test/check.mjs
└── mining.txt              # sample Anki export (gitignored)
```

## About the zips

- `tmw-coverage/tmw-index.bin.gz` — loaded by default; makes startup fast.
- `tmw-coverage/tmw-freq.zip` — **keep it**: runtime fallback, test input, and the source
  for rebuilding the packed index.
- The old root-level `tmw-freq.zip` was a byte-identical duplicate of the coverage copy and
  has been removed.

Rebuild the packed index only if the dictionary archive changes:

```bash
cd tmw-coverage
node tools/build-index.mjs
```

## Privacy

All files are parsed locally with browser APIs. No network request carries your deck or
notes. The only network activity is fetching the bundled dictionary assets.

## Credits

Frequency data: **TMW v2** by Vignes, Claude — attribution: TMW. Design and code: vanilla
HTML, CSS and JavaScript with no dependencies.
