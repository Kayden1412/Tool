# Anki Duplicate Checker

A neo-brutalist, fully client-side site that finds duplicate notes in exported Anki decks.
It reuses the look and feel of the TMW Freq Checker, but needs no dictionary or worker.

Load **one or many** Anki note exports (`.txt`, `.tsv`, `.csv`) and the page shows:

- duplicate groups across all loaded files,
- cross-file duplicates separately from duplicates inside a single file,
- every copy’s file name and note number,
- copy-count buckets and the most repeated terms,
- a filtered CSV export of the full duplicate report.

## Run it

The site needs a local HTTP server because it uses JavaScript modules:

```bash
cd dupes
python3 -m http.server 8001
```

Then open <http://localhost:8001>.

No build step, package manager, dependency, or backend is involved.

## Duplicate modes

| Mode | Key | Use it for |
| --- | --- | --- |
| Expression + reading | normalised expression + reading | Default; keeps different readings apart |
| Expression only | normalised expression | Finds the same word even when readings differ |
| Exact note row | every field in the row | Finds byte-identical rows only |

Keys are NFKC-normalised, case-insensitive, whitespace-collapsed, and a trailing
`word[reading]` annotation is ignored. Rows with an empty expression are skipped in the
first two modes and reported in the scan summary.

## Theme

The hero badge cycles **Auto → Light → Dark**. Auto follows `prefers-color-scheme` and reacts
to system changes; the choice is stored in `localStorage` under `twm-theme` and applied
before the stylesheet paints. The shared design tokens match the TMW Freq Checker, including
the dark-mode palette.

## Test it

```bash
cd dupes
node test/check.mjs
```

The test covers grouping, cross-file counts, all three match modes, blank rows, missing
reading columns, annotation stripping, width/case folding, and the summary numbers.

## Files

```
dupes/
├── index.html
├── styles.css          # shared neo-brutalist design + duplicate report styles
├── app.js              # file loading, report UI, filters, CSV
├── lib/
│   ├── anki.js         # Anki text parser + normalization (shared with the freq checker)
│   └── dupes.js        # pure duplicate-key and grouping logic
└── test/check.mjs
```

## Credits

Anki export format: [Anki](https://apps.ankiweb.net/). Design shared with the TMW Freq
Checker.
