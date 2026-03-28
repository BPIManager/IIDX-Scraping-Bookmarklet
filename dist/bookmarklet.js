"use strict";
/**
 * @file bookmarklet.ts
 * @description IIDX score importer bookmarklet for BPIM2
 *
 * Scrapes score data from the KONAMI e-AMUSEMENT GATE difficulty page and
 * exports a CSV compatible with IIDX official CSV format.
 *
 * @usage
 * Compile with `tsc --target ES2020 --lib ES2020,DOM bookmarklet.ts`, then
 * minify and paste as a `javascript:` bookmarklet URL.
 */
(async () => {
    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------
    /** Difficulty names used both as CSV column prefixes and POST parameters. */
    const DIFFICULTIES = [
        "BEGINNER",
        "NORMAL",
        "HYPER",
        "ANOTHER",
        "LEGGENDARIA",
    ];
    /**
     * Maps the numeric clear-flag value embedded in KONAMI's `clflg*.gif` image
     * filenames to the human-readable clear-type label used in the CSV.
     */
    const LAMP_MAP = {
        "0": "NO PLAY",
        "1": "FAILED",
        "2": "ASSIST CLEAR",
        "3": "EASY CLEAR",
        "4": "CLEAR",
        "5": "HARD CLEAR",
        "6": "EX HARD CLEAR",
        "7": "FULLCOMBO CLEAR",
    };
    /**
     * Display labels for difficulty levels ☆1 through ☆12.
     * Index 0 → "☆1", index 11 → "☆12".
     */
    const LEVEL_LABELS = [
        "☆1",
        "☆2",
        "☆3",
        "☆4",
        "☆5",
        "☆6",
        "☆7",
        "☆8",
        "☆9",
        "☆10",
        "☆11",
        "☆12",
    ];
    /**
     * CSV header row.
     * Fixed columns are followed by five groups of per-difficulty columns.
     */
    const HEADERS = [
        "バージョン",
        "タイトル",
        "ジャンル",
        "アーティスト",
        "プレー回数",
        ...DIFFICULTIES.flatMap((d) => [
            `${d} 難易度`,
            `${d} スコア`,
            `${d} PGreat`,
            `${d} Great`,
            `${d} ミスカウント`,
            `${d} クリアタイプ`,
            `${d} DJ LEVEL`,
        ]),
        "最終プレー日時",
    ];
    // ---------------------------------------------------------------------------
    // Helpers — URL / versioning
    // ---------------------------------------------------------------------------
    /**
     * Extracts the IIDX version number from the current page URL.
     * Falls back to `"33"` (RESIDENT) if no version segment is found.
     *
     * @returns The version string, e.g. `"33"`.
     */
    const detectVersion = () => {
        const match = location.href.match(/\/game\/2dx\/(\d+)\//);
        return match ? match[1] : "33";
    };
    const ver = detectVersion();
    /**
     * Fully-qualified URL of the difficulty data endpoint for the current version.
     * Requests are sent as `application/x-www-form-urlencoded` POST.
     */
    const POST_URL = `https://p.eagate.573.jp/game/2dx/${ver}/djdata/music/difficulty.html`;
    // ---------------------------------------------------------------------------
    // Helpers — CSV encoding
    // ---------------------------------------------------------------------------
    /**
     * Escapes a single value for RFC 4180 CSV output.
     * Wraps the value in double-quotes and doubles any embedded double-quotes
     * when the value contains a comma, double-quote, or newline.
     *
     * @param value - The raw string to escape.
     * @returns The CSV-safe string.
     */
    const escapeCsv = (value) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    // ---------------------------------------------------------------------------
    // Helpers — HTML parsing
    // ---------------------------------------------------------------------------
    /**
     * Parses an HTML fragment returned by the GATE difficulty endpoint and
     * extracts score rows from `.series-difficulty table tr` elements.
     *
     * Each `<tr>` is expected to follow this column layout:
     * | 0: title (anchor) | 1: difficulty | 2: DJ LEVEL img | 3: score | 4: clear lamp img |
     *
     * @param html - Raw HTML text from one paginated response.
     * @returns Array of {@link ChartScore} objects parsed from the table rows.
     */
    const parseTable = (html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const rows = doc.querySelectorAll(".series-difficulty table tr");
        const results = [];
        rows.forEach((row) => {
            const tds = row.querySelectorAll("td");
            if (tds.length < 4)
                return;
            const titleEl = tds[0].querySelector("a");
            if (!titleEl)
                return;
            const title = titleEl.textContent?.trim() ?? "";
            const difficulty = tds[1].textContent?.trim() ?? "";
            // Score cell contains text like "1234 (567/890)"
            const scoreMatch = (tds[3]?.textContent?.trim() ?? "").match(/(\d+)\s*\((\d+)\/(\d+)\)/);
            // Clear lamp: encoded in the filename, e.g. "clflg4.gif" → lamp "4"
            const lampImg = tds[4]?.querySelector("img");
            const lampSrc = lampImg?.getAttribute("src") ?? "";
            const lampNum = lampSrc.match(/clflg(\d+)\.gif/)?.[1] ?? "0";
            // DJ LEVEL: last path segment before ".gif", uppercased
            const djImg = tds[2]?.querySelector("img");
            const djSrc = djImg?.getAttribute("src") ?? "";
            const djLevel = djSrc.match(/\/([^/]+)\.gif/)?.[1].toUpperCase() ?? "---";
            // Level number embedded in the nearest preceding <th>
            const thEl = row.closest("table")?.querySelector("th");
            const levelMatch = thEl?.textContent?.match(/LEVEL\s*(\d+)/i);
            results.push({
                title,
                difficulty,
                level: levelMatch ? levelMatch[1] : "-",
                score: scoreMatch ? scoreMatch[1] : "0",
                pgreat: scoreMatch ? scoreMatch[2] : "0",
                great: scoreMatch ? scoreMatch[3] : "0",
                lamp: LAMP_MAP[lampNum] ?? "NO PLAY",
                djLevel,
            });
        });
        return results;
    };
    // ---------------------------------------------------------------------------
    // Helpers — network
    // ---------------------------------------------------------------------------
    /**
     * Fetches one paginated response from the GATE difficulty endpoint.
     *
     * @param difficult - Level index (0-based, so ☆1 = 0, ☆12 = 11).
     * @param offset    - Pagination offset; 0 for the first page, then increments
     *                    of 50.
     * @returns The raw HTML response body.
     * @throws {Error} When the HTTP response status is not OK.
     */
    const fetchPage = async (difficult, offset) => {
        const body = new URLSearchParams({
            difficult: String(difficult),
            style: "0",
            disp: "1",
        });
        if (offset > 0)
            body.append("offset", String(offset));
        const resp = await fetch(POST_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            credentials: "include",
        });
        if (!resp.ok)
            throw new Error(`HTTP Error: ${resp.status}`);
        return resp.text();
    };
    // ---------------------------------------------------------------------------
    // UI helpers
    // ---------------------------------------------------------------------------
    /**
     * Injects a shared `<style>` tag with keyframe and button styles.
     * Idempotent — does nothing if the tag already exists.
     */
    const injectStyles = () => {
        if (document.getElementById("__iidx_style"))
            return;
        const st = document.createElement("style");
        st.id = "__iidx_style";
        st.textContent = `
      @keyframes __iidx_spin { to { transform: rotate(360deg); } }
      .__iidx_btn { transition: all 0.2s; border: none; cursor: pointer; }
      .__iidx_btn:hover { opacity: 0.8; filter: brightness(1.1); }
      .__iidx_btn:active { transform: scale(0.98); }
    `;
        document.head.appendChild(st);
    };
    /**
     * Builds and returns the modal overlay element with all step sub-panels
     * pre-rendered but hidden (except for the initial "select" step).
     *
     * @returns The root overlay `<div>` element, not yet attached to the DOM.
     */
    const buildOverlay = () => {
        const overlay = document.createElement("div");
        overlay.id = "__iidx_overlay";
        Object.assign(overlay.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            zIndex: "999999",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "sans-serif",
        });
        overlay.innerHTML = `
      <div style="background:#fff; color:#1a1a1a; border-radius:16px; width:480px; max-width:95vw; box-shadow:0 12px 48px rgba(0,0,0,0.25); overflow:hidden;">
        <div style="background:#5b21b6; padding:18px 24px; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:20px; font-weight:800; color:#fff; letter-spacing:0.5px;">BPIM2</span>
            <span style="font-size:12px; color:#ddd6fe; opacity:0.9;">Score Importer</span>
          </div>
          <button id="__iidx_btn_x" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>
        </div>

        <div style="padding:24px;">
          <div id="__iidx_step_select">
            <p style="margin:0 0 10px; font-weight:700;">取得モードを選択してください</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <button id="__iidx_btn_all" class="__iidx_btn" style="padding:16px; border-radius:12px; background:#faf5ff; border:2px solid #7c3aed; text-align:left;">
                <div style="font-weight:700; color:#1a1a1a;">全楽曲を取得する (☆1-12)</div>
                <div style="font-size:12px; color:#7c3aed;">目安: 1〜2分</div>
              </button>
              <button id="__iidx_btn_1112" class="__iidx_btn" style="padding:16px; border-radius:12px; background:#faf5ff; border:2px solid #7c3aed; text-align:left;">
                <div style="font-weight:700; color:#1a1a1a;">☆11・☆12 のみ取得する</div>
                <div style="font-size:12px; color:#7c3aed;">目安: 約30秒</div>
              </button>
            </div>
          </div>

          <div id="__iidx_step_progress" style="display:none; text-align:center; padding:20px 0;">
            <div style="width:48px; height:48px; border:4px solid #f3e8ff; border-top-color:#7c3aed; border-radius:50%; animation:__iidx_spin 1s linear infinite; margin:0 auto 20px;"></div>
            <div id="__iidx_status_level" style="font-weight:700; font-size:16px; margin-bottom:4px;">Ready...</div>
            <div id="__iidx_status_page" style="font-size:13px; color:#6b7280; margin-bottom:24px;"></div>
            <div style="display:inline-flex; align-items:baseline; gap:8px; background:#f5f3ff; border-radius:12px; padding:12px 32px;">
              <span style="font-size:13px; color:#6b7280;">取得件数</span>
              <span id="__iidx_song_count" style="font-size:32px; font-weight:800; color:#5b21b6;">0</span>
              <span style="font-size:13px; color:#6b7280;">曲</span>
            </div>
          </div>

          <div id="__iidx_step_result" style="display:none;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:14px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
              <span style="font-size:24px;">✅</span>
              <div>
                <div style="font-weight:700; color:#166534;">コピー完了</div>
                <div id="__iidx_result_summary" style="font-size:12px; color:#15803d;">クリップボードに保存しました。</div>
              </div>
            </div>
            <textarea id="__iidx_output" style="width:100%; height:140px; border:1px solid #e5e7eb; border-radius:8px; font-family:monospace; font-size:11px; padding:10px; resize:none; background:#f9fafb;" readonly></textarea>
            <div style="display:flex; gap:10px; margin-top:16px;">
              <a href="https://bpi2.poyashi.me/import" target="_blank" style="flex:2; background:#059669; color:#fff; text-decoration:none; padding:12px; border-radius:8px; text-align:center; font-weight:700; font-size:14px;">インポートページを開く</a>
              <button id="__iidx_btn_close2" style="flex:1; background:#fff; border:1px solid #e5e7eb; color:#6b7280; border-radius:8px; font-size:14px;">閉じる</button>
            </div>
          </div>

          <div id="__iidx_step_error" style="display:none;">
            <div style="background:#fef2f2; border:1px solid #fecaca; padding:16px; border-radius:12px;">
              <div style="font-weight:700; color:#991b1b;">Error</div>
              <div id="__iidx_err_msg" style="font-size:13px; color:#b91c1c; margin-top:4px;"></div>
            </div>
            <button id="__iidx_btn_retry" style="margin-top:12px; width:100%; padding:10px; border-radius:8px; border:1px solid #7c3aed; color:#7c3aed; background:none;">最初からやり直す</button>
          </div>
        </div>
      </div>
    `;
        return overlay;
    };
    /**
     * Shows the named wizard step panel and hides all others.
     *
     * @param name - One of `"select"`, `"progress"`, `"result"`, or `"error"`.
     */
    const showStep = (name) => {
        ["select", "progress", "result", "error"].forEach((s) => {
            const el = document.getElementById(`__iidx_step_${s}`);
            if (el)
                el.style.display = s === name ? "block" : "none";
        });
    };
    // ---------------------------------------------------------------------------
    // Core scraping logic
    // ---------------------------------------------------------------------------
    /**
     * Scrapes all pages for a single difficulty level and merges results into
     * the shared {@link SongMap}.
     *
     * Pagination stops when a response returns zero table rows.
     * A 400 ms delay is inserted between requests to reduce server load.
     *
     * @param songMap    - Mutable accumulator that receives scraped data.
     * @param difficult  - 0-based level index (0 = ☆1 … 11 = ☆12).
     * @param label      - Human-readable label shown in the progress UI (e.g. `"☆12"`).
     * @param pageCounter - Mutable object whose `value` is incremented for each
     *                      fetched page; used to report totals in the result step.
     */
    const scrapeLevel = async (songMap, difficult, label, pageCounter) => {
        let offset = 0;
        let pageNum = 1;
        while (true) {
            const statusLevel = document.getElementById("__iidx_status_level");
            const statusPage = document.getElementById("__iidx_status_page");
            const songCountEl = document.getElementById("__iidx_song_count");
            if (statusLevel)
                statusLevel.textContent = `${label} を取得中...`;
            if (statusPage)
                statusPage.textContent = `${pageNum} ページ目`;
            const html = await fetchPage(difficult, offset);
            const rows = parseTable(html);
            if (rows.length === 0)
                break;
            rows.forEach((r) => {
                if (!songMap[r.title])
                    songMap[r.title] = {};
                if (DIFFICULTIES.includes(r.difficulty)) {
                    songMap[r.title][r.difficulty] = { ...r };
                }
            });
            if (songCountEl) {
                songCountEl.textContent = String(Object.keys(songMap).length);
            }
            pageCounter.value += 1;
            offset += 50;
            pageNum += 1;
            // Brief pause to avoid hammering the server.
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
    };
    // ---------------------------------------------------------------------------
    // CSV generation
    // ---------------------------------------------------------------------------
    /**
     * Converts a populated {@link SongMap} to a CSV string.
     *
     * Songs are sorted alphabetically by title. Difficulties with no score data
     * are emitted as zeroed-out placeholder columns.
     *
     * @param songMap - The fully-populated song map after scraping completes.
     * @returns A multi-line CSV string beginning with the {@link HEADERS} row.
     */
    const buildCsv = (songMap) => {
        const csvRows = [HEADERS.join(",")];
        Object.keys(songMap)
            .sort()
            .forEach((title) => {
            const data = songMap[title];
            const row = ["-", escapeCsv(title), "-", "-", "-"];
            DIFFICULTIES.forEach((diff) => {
                const d = data[diff];
                if (d) {
                    row.push(d.level, d.score, d.pgreat, d.great, "-", d.lamp, d.djLevel);
                }
                else {
                    row.push("-", "0", "0", "0", "-", "NO PLAY", "---");
                }
            });
            row.push("-"); // 最終プレー日時
            csvRows.push(row.join(","));
        });
        return csvRows.join("\n");
    };
    // ---------------------------------------------------------------------------
    // Main run loop
    // ---------------------------------------------------------------------------
    /**
     * Orchestrates the full scrape→CSV→clipboard pipeline for the given mode.
     *
     * @param overlay - The modal overlay element (used only to close on fatal error).
     * @param mode    - `"all"` scrapes ☆1–☆12; `"1112"` scrapes only ☆11 and ☆12.
     */
    const run = async (overlay, mode) => {
        const levelIndices = mode === "all" ? [...Array(12).keys()] : [10, 11];
        const songMap = {};
        const pageCounter = { value: 0 };
        showStep("progress");
        try {
            for (const lv of levelIndices) {
                await scrapeLevel(songMap, lv, LEVEL_LABELS[lv], pageCounter);
            }
            const finalCsv = buildCsv(songMap);
            const outputEl = document.getElementById("__iidx_output");
            const summaryEl = document.getElementById("__iidx_result_summary");
            if (outputEl)
                outputEl.value = finalCsv;
            if (summaryEl) {
                summaryEl.textContent = `${Object.keys(songMap).length}曲（${pageCounter.value}ページ）をコピーしました`;
            }
            // Attempt automatic copy to clipboard (may fail without user gesture).
            try {
                await navigator.clipboard.writeText(finalCsv);
            }
            catch (err) {
                console.error("Auto-copy failed:", err);
            }
            showStep("result");
        }
        catch (e) {
            const msgEl = document.getElementById("__iidx_err_msg");
            if (msgEl) {
                msgEl.textContent = e instanceof Error ? e.message : String(e);
            }
            showStep("error");
        }
    };
    // ---------------------------------------------------------------------------
    // Bootstrap — inject UI and wire events
    // ---------------------------------------------------------------------------
    injectStyles();
    const overlay = buildOverlay();
    document.body.appendChild(overlay);
    // Initial state: show only the mode-selection step.
    showStep("select");
    /** Removes the modal overlay from the DOM. */
    const closeModal = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };
    document.getElementById("__iidx_btn_all").onclick =
        () => run(overlay, "all");
    document.getElementById("__iidx_btn_1112").onclick =
        () => run(overlay, "1112");
    document.getElementById("__iidx_btn_x").onclick =
        closeModal;
    document.getElementById("__iidx_btn_close2").onclick =
        closeModal;
    document.getElementById("__iidx_btn_retry").onclick =
        () => showStep("select");
    // Close on backdrop click.
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
            closeModal();
    });
})();
