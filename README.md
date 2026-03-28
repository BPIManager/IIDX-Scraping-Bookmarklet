# BPIM2 — Score Importer Bookmarklet

A browser bookmarklet that scrapes your beatmania IIDX score data from the
[KONAMI e-AMUSEMENT GATE](https://p.eagate.573.jp/) difficulty page and exports
a CSV file ready to import into [BPIM2](https://bpi2.poyashi.me/) or any other score management tools using IIDX official CSV.

---

## Features

- **Full or partial scrape** — grab all ☆1–☆12 charts (≈1–2 min) or just ☆11
  and ☆12 (≈30 sec).
- **Per-chart detail** — exports EX score, PGreat/Great counts, clear type
  (NO PLAY → FULLCOMBO CLEAR), and DJ LEVEL grade for every difficulty
  (BEGINNER / NORMAL / HYPER / ANOTHER / LEGGENDARIA).
- **Auto-copy** — the finished CSV is automatically written to your clipboard
  and displayed in a preview textarea.
- **One-click import** — a direct link to the BPIM2 import page is
  shown on completion.
- **Version-aware** — reads the IIDX version number from the current URL and
  targets the matching endpoint automatically (falls back to version 33).

---

## Installation

### Option A — Build from source (recommended)

**Prerequisites:** Node.js 18+ and a TypeScript compiler.

```bash
# 1. Clone the repository
git clone https://github.com/BPIManager/IIDX-Scraping-Bookmarklet.git
cd IIDX-Scraping-Bookmarklet

# 2. Install dev dependencies
npm install

# 3. Compile TypeScript → JavaScript
npx tsc --target ES2020 --lib ES2020,DOM --strict bookmarklet.ts --outFile dist/bookmarklet.js

# 4. Minify (optional, reduces bookmarklet URL length)
npx terser dist/bookmarklet.js -o dist/bookmarklet.min.js --compress --mangle
```

Then wrap the minified output as a bookmarklet URL:

```
javascript:(()=>{ /* paste minified content here */ })();
```

### Option B — Use a pre-built release

Just access [https://bpi2.poyashi.me/bookmarklet.js](https://bpi2.poyashi.me/bookmarklet.js).

This endpoint dynamically proxies the latest `bookmarklet.min.js` from the `main` branch of this repository:

```ts
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/javascript");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return { props: {} };
  }

  const script = await fetch(
    "https://raw.githubusercontent.com/BPIManager/IIDX-Scraping-Bookmarklet/refs/heads/main/dist/bookmarklet.min.js",
  );
  const body = await script.text();

  res.write(body);
  res.end();

  return { props: {} };
};
```

> **This means the bookmarklet always executes the latest version from the `main` branch. Behavior may change over time as updates are pushed.**

### Adding to your browser

1. Show your bookmarks bar (usually **Ctrl+Shift+B** / **⌘+Shift+B**).
2. Create a new bookmark.
3. Set the **Name** to anything you like (e.g. `BPIM2`).
4. Paste the full `javascript:(...)` string as the **URL / Location**.
5. Save.

---

## Usage

1. Log in to [e-AMUSEMENT GATE](https://p.eagate.573.jp/) and navigate to any
   page under `/game/2dx/<version>/`.
2. Click the **BPIM2** bookmark.
3. In the modal, choose your scrape mode:
   - **全楽曲を取得する (☆1–12)** — all songs
   - **☆11・☆12 のみ取得する** — level 11 and 12 only
4. Wait for the progress indicator to finish.
5. The CSV is automatically copied to your clipboard. Use the
   **インポートページを開く** button to jump straight to BPIM2's import
   screen and paste.

---

## CSV format

The exported CSV follows the column layout expected by BPIM2.

| Column group       | Columns                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Song metadata      | バージョン, タイトル, ジャンル, アーティスト, プレー回数                                                                           |
| Per difficulty × 5 | `{DIFF} 難易度`, `{DIFF} スコア`, `{DIFF} PGreat`, `{DIFF} Great`, `{DIFF} ミスカウント`, `{DIFF} クリアタイプ`, `{DIFF} DJ LEVEL` |
| Timestamp          | 最終プレー日時                                                                                                                     |

Difficulties: `BEGINNER`, `NORMAL`, `HYPER`, `ANOTHER`, `LEGGENDARIA`.

Fields not available on GATE (version, genre, artist, miss count, last play
time) are exported as `"-"`. Unplayed charts are exported with a score of `0`
and a clear type of `NO PLAY`.

---

## Development

```
IIDX-Scraping-Bookmarklet/
├── bookmarklet.ts          # Main source (TypeScript, single IIFE)
├── dist/
│   ├── bookmarklet.js      # Compiled output
│   └── bookmarklet.min.js  # Minified bookmarklet
├── tsconfig.json
└── package.json
```

### Recommended `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "outFile": "dist/bookmarklet.js"
  },
  "include": ["bookmarklet.ts"]
}
```

---

## Caveats & known limitations

- **Authentication required** — the bookmarklet uses `credentials: "include"`,
  so you must be logged in to e-AMUSEMENT GATE in the same browser session.
- **Rate limiting** — a 400 ms delay is inserted between each paginated
  request. Scraping all levels therefore takes 1–2 minutes; do not navigate
  away during this time.
- **Clipboard API** — the auto-copy step relies on `navigator.clipboard`, which
  requires either `localhost` or an HTTPS origin. On some browsers the
  permission prompt may appear; if denied, the CSV is still shown in the
  textarea for manual copying.
- **DOM selectors** — parsing relies on KONAMI's current HTML structure
  (`.series-difficulty table tr`, `clflg*.gif`, etc.). Changes to the GATE
  front-end may require updates to `parseTable`.

---

## Contributing

Pull requests are welcome. When editing `bookmarklet.ts`, please:

1. Maintain **TSDoc** comments on all exported types and public functions.
2. Run `tsc --noEmit` to verify there are no type errors before committing.
3. Update this README if the CSV schema or UI behaviour changes.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

> **Disclaimer:** This project is an independent fan tool and is not affiliated
> with or endorsed by Konami Digital Entertainment Co., Ltd. Use responsibly
> and in accordance with the e-AMUSEMENT GATE Terms of Service.
