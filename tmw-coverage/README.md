# TMW Freq Checker

A neo-brutalist, fully client-side website that checks an exported Anki deck against the
**TMW v2** Japanese frequency dictionary (`tmw-freq.zip`). A pre-built compact index
(`tmw-index.bin.gz`) makes it load in a couple of seconds instead of reparsing 25 JSON banks.

Drop `mining.txt` (or any plain-text Anki notes export) and the site shows:

- what percentage of your **unique expressions** appear in TMW,
- how many cards are covered / missing,
- cumulative coverage inside TMW rank cutoffs,
- a tier breakdown, searchable card-by-card results, and CSV export,
- light/dark themes with an auto mode that follows your OS setting.

## Run it

The site needs a local HTTP server because it fetches the bundled index and uses JavaScript
modules:

```bash
cd site
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

There is no build step, package manager, dependency, or backend needed to run it. The page
first fetches the pre-built `tmw-index.bin.gz`; if that file is missing or corrupt it
automatically falls back to fetching and parsing `tmw-freq.zip` in the worker.

If the bundled files cannot be fetched, the page offers a “Load ZIP manually” button — you can
also use it to swap in a newer TMW frequency archive.

## Theme

The theme badge in the hero cycles **Auto → Light → Dark**:

- **Auto** (default) follows your OS `prefers-color-scheme` setting and reacts to changes live.
- **Light** and **Dark** pin the theme regardless of the system setting.
- The choice is saved in `localStorage` under `twm-theme`, and an inline script applies it
  before the stylesheet paints to avoid a flash of the wrong theme.
- The browser UI color (`<meta name="theme-color">`) updates with the active theme.

## Rebuild the packed index

Run this only if `tmw-freq.zip` changes:

```bash
cd site
node tools/build-index.mjs
```

It reads the zip and rewrites `tmw-index.bin.gz` with NFKC-normalized headwords, ranks, tier
labels and the archive metadata. Build-time only — no npm packages involved.

## Test it

A dependency-free Node test validates the ZIP reader, packed index, Anki parser and coverage
numbers against the real files:

```bash
cd site
node test/check.mjs
```

It also rebuilds the lookup maps from `tmw-index.bin.gz` and asserts every headword/reading and
every `mining.txt` match agrees with the raw zip. Expected highlights: 231,414 dictionary
terms, 9,109 Anki rows, 8,853 unique expressions and 6,112 covered unique expressions (69.04%).

## How matching works

1. It loads `tmw-index.bin.gz` (a compact binary built from the zip) with
   `DecompressionStream`, entirely in a Web Worker. If the packed index can’t be loaded, it
   reads every `term_meta_bank_*.json` from `tmw-freq.zip` instead.
2. It parses the Anki export (tab, comma, semicolon or pipe), detects the expression/reading
   columns, and skips `#separator` / `#html` header lines.
3. Expressions are NFKC-normalized and compared to TMW headwords. `word[reading]` annotations
   and whitespace differences are handled automatically.
4. “Also match by reading” is an optional kana → kanji fallback. It is off by default because
   homophones can create false positives.

TMW ranks are bucketed as: Student ≤ 620, Trainee ≤ 1,619, Debut ≤ 7,936, Major ≤ 16,849,
Prima ≤ 27,025, Divine ≤ 38,548, Eternal ≤ 51,263. Immortal and Mythic both use rank 99,999
in the archive, so they are read from TMW’s own display labels. Multi-rank words such as
`Immortal, Mythic` show both chips and count in both tier totals.

## Files

```
site/
├── index.html
├── styles.css
├── app.js              # UI, parsing, stats, table, CSV
├── worker.js           # loads the packed index or zip, then checks cards
├── lib/
│   ├── anki.js         # text normalization + Anki export parser
│   ├── binindex.js     # compact packed-index parser + lookup builder
│   ├── dict.js         # frequency index + coverage checks
│   └── zip.js          # minimal central-directory ZIP reader
├── tools/
│   └── build-index.mjs # regenerates tmw-index.bin.gz from tmw-freq.zip
├── test/check.mjs
├── tmw-index.bin.gz    # pre-built fast index (2.1 MB)
└── tmw-freq.zip        # source dictionary (5.3 MB)
```

## Credits

Frequency data: **TMW v2** by Vignes, Claude — attribution: TMW.
