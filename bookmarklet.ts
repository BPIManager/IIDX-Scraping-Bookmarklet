/**
 * @file bookmarklet.ts
 * @description IIDX score & tower importer bookmarklet for BPIM2
 *
 * Scrapes score data or tower data from the KONAMI e-AMUSEMENT GATE and
 * exports a CSV compatible with IIDX official CSV format.
 *
 * @usage
 * Compile with `tsc --target ES2020 --lib ES2020,DOM bookmarklet.ts`, then
 * minify and paste as a `javascript:` bookmarklet URL.
 */

(async (): Promise<void> => {
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
  ] as const;

  /** Union type of all supported difficulty names. */
  type Difficulty = (typeof DIFFICULTIES)[number];

  /**
   * Maps the numeric clear-flag value embedded in KONAMI's `clflg*.gif` image
   * filenames to the human-readable clear-type label used in the CSV.
   */
  const LAMP_MAP: Record<string, string> = {
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
  const LEVEL_LABELS: string[] = [
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
   * CSV header row for Score data.
   */
  const HEADERS: string[] = [
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
  // Types
  // ---------------------------------------------------------------------------

  interface ChartScore {
    title: string;
    difficulty: string;
    level: string;
    score: string;
    pgreat: string;
    great: string;
    lamp: string;
    djLevel: string;
  }

  type SongEntry = Partial<Record<Difficulty, ChartScore>>;
  type SongMap = Record<string, SongEntry>;

  /** Scraping mode selected by the user in the UI. */
  type ScrapeMode = "all" | "1112" | "tower" | "random_lane";

  // ---------------------------------------------------------------------------
  // Helpers — URL / versioning
  // ---------------------------------------------------------------------------

  const detectVersion = (): string => {
    const match = location.href.match(/\/game\/2dx\/(\d+)\//);
    return match ? match[1] : "33";
  };

  const ver = detectVersion();

  const SCORE_POST_URL = `https://p.eagate.573.jp/game/2dx/${ver}/djdata/music/difficulty.html`;
  const TOWER_URL = `https://p.eagate.573.jp/game/2dx/${ver}/djdata/tower.html`;
  const RANDOM_LANE_URL = `https://p.eagate.573.jp/game/2dx/${ver}/djdata/random_lane/index.html`;

  // ---------------------------------------------------------------------------
  // Helpers — CSV encoding
  // ---------------------------------------------------------------------------

  const escapeCsv = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  // ---------------------------------------------------------------------------
  // Helpers — HTML parsing (Scores)
  // ---------------------------------------------------------------------------

  const parseScoreTable = (html: string): ChartScore[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = doc.querySelectorAll(".series-difficulty table tr");
    const results: ChartScore[] = [];

    rows.forEach((row) => {
      const tds = row.querySelectorAll("td");
      if (tds.length < 4) return;

      const titleEl = tds[0].querySelector("a");
      if (!titleEl) return;

      const title = titleEl.textContent?.trim() ?? "";
      const difficulty = tds[1].textContent?.trim() ?? "";

      const scoreMatch = (tds[3]?.textContent?.trim() ?? "").match(
        /(\d+)\s*\((\d+)\/(\d+)\)/,
      );

      const lampImg = tds[4]?.querySelector("img");
      const lampSrc = lampImg?.getAttribute("src") ?? "";
      const lampNum = lampSrc.match(/clflg(\d+)\.gif/)?.[1] ?? "0";

      const djImg = tds[2]?.querySelector("img");
      const djSrc = djImg?.getAttribute("src") ?? "";
      const djLevel = djSrc.match(/\/([^/]+)\.gif/)?.[1].toUpperCase() ?? "---";

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

  const fetchScorePage = async (
    difficult: number,
    offset: number,
  ): Promise<string> => {
    const body = new URLSearchParams({
      difficult: String(difficult),
      style: "0",
      disp: "1",
    });
    if (offset > 0) body.append("offset", String(offset));

    const resp = await fetch(SCORE_POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "include",
    });

    if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
    return resp.text();
  };

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  const injectStyles = (): void => {
    if (document.getElementById("__iidx_style")) return;
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

  const buildOverlay = (): HTMLDivElement => {
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
            <span style="font-size:12px; color:#ddd6fe; opacity:0.9;">Data Importer</span>
          </div>
          <button id="__iidx_btn_x" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>
        </div>

        <div style="padding:24px;">
          <div id="__iidx_step_select_mode">
            <p style="margin:0 0 10px; font-weight:700;">取得するデータを選択してください</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <button id="__iidx_btn_mode_score" class="__iidx_btn" style="padding:16px; border-radius:12px; background:#faf5ff; border:2px solid #7c3aed; text-align:left;">
                <div style="font-weight:700; color:#1a1a1a;">スコアデータ</div>
                <div style="font-size:12px; color:#7c3aed;">各難易度のスコア・クリアランプ等を抽出</div>
              </button>
              <button id="__iidx_btn_mode_tower" class="__iidx_btn" style="padding:16px; border-radius:12px; background:#faf5ff; border:2px solid #7c3aed; text-align:left;">
                <div style="font-weight:700; color:#1a1a1a;">IIDXタワーデータ</div>
                <div style="font-size:12px; color:#7c3aed;">日別の鍵盤・スクラッチ打鍵数を抽出</div>
              </button>
              <button id="__iidx_btn_mode_random_lane" class="__iidx_btn" style="padding:16px; border-radius:12px; background:#faf5ff; border:2px solid #7c3aed; text-align:left;">
                <div style="font-weight:700; color:#1a1a1a;">ランダムレーンチケット</div>
                <div style="font-size:12px; color:#7c3aed;">所持チケットの配置番号と有効期限を抽出</div>
              </button>
            </div>
          </div>

          <div id="__iidx_step_select_score" style="display:none;">
            <div style="display:flex; align-items:center; margin-bottom:10px; gap:8px;">
              <button id="__iidx_btn_back" style="background:none; border:none; color:#6b7280; cursor:pointer; font-size:14px; padding:0;">◀ 戻る</button>
              <p style="margin:0; font-weight:700;">スコアの取得範囲を選択してください</p>
            </div>
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
              <span id="__iidx_item_count" style="font-size:32px; font-weight:800; color:#5b21b6;">0</span>
              <span id="__iidx_count_unit" style="font-size:13px; color:#6b7280;">曲</span>
            </div>
          </div>

          <div id="__iidx_step_result" style="display:none;">
            <div id="__iidx_result_banner" style="border-radius:12px; padding:14px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
              <span id="__iidx_result_icon" style="font-size:24px;"></span>
              <div>
                <div id="__iidx_result_title" style="font-weight:700;"></div>
                <div id="__iidx_result_summary" style="font-size:12px;"></div>
              </div>
            </div>
            <textarea id="__iidx_output" style="width:100%; height:140px; border:1px solid #e5e7eb; border-radius:8px; font-family:monospace; font-size:11px; padding:10px; resize:none; background:#f9fafb;" readonly></textarea>
            <div style="display:flex; gap:10px; margin-top:16px;">
              <button id="__iidx_btn_copy" class="__iidx_btn" style="display:none; flex:1; background:#7c3aed; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:700; padding:12px; cursor:pointer;">コピー</button>
              <a id="__iidx_link_bpim" href="https://bpi2.poyashi.me/import" target="_blank" style="flex:2; background:#059669; color:#fff; text-decoration:none; padding:12px; border-radius:8px; text-align:center; font-weight:700; font-size:14px;">BPIM2を開く</a>
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
        <p style="margin:0; padding:0 24px 16px; font-size:12px; color:#6b7280; text-align:center;">問題が発生した場合は <a href="https://github.com/BPIManager/IIDX-Scraping-Bookmarklet" target="_blank" style="color:#7c3aed;">GitHub</a> からIssueを報告してください</p>
      </div>
    `;

    return overlay;
  };

  const showStep = (
    name: "select_mode" | "select_score" | "progress" | "result" | "error",
  ): void => {
    (
      ["select_mode", "select_score", "progress", "result", "error"] as const
    ).forEach((s) => {
      const el = document.getElementById(`__iidx_step_${s}`);
      if (el) el.style.display = s === name ? "block" : "none";
    });
  };

  // ---------------------------------------------------------------------------
  // Core scraping logic (Scores)
  // ---------------------------------------------------------------------------

  const scrapeLevel = async (
    songMap: SongMap,
    difficult: number,
    label: string,
    pageCounter: { value: number },
  ): Promise<void> => {
    let offset = 0;
    let pageNum = 1;

    while (true) {
      const statusLevel = document.getElementById("__iidx_status_level");
      const statusPage = document.getElementById("__iidx_status_page");
      const itemCountEl = document.getElementById("__iidx_item_count");

      if (statusLevel) statusLevel.textContent = `${label} を取得中...`;
      if (statusPage) statusPage.textContent = `${pageNum} ページ目`;

      const html = await fetchScorePage(difficult, offset);
      const rows = parseScoreTable(html);

      if (rows.length === 0) break;

      rows.forEach((r) => {
        if (!songMap[r.title]) songMap[r.title] = {};
        if ((DIFFICULTIES as ReadonlyArray<string>).includes(r.difficulty)) {
          songMap[r.title][r.difficulty as Difficulty] = { ...r };
        }
      });

      if (itemCountEl) {
        itemCountEl.textContent = String(Object.keys(songMap).length);
      }

      pageCounter.value += 1;
      offset += 50;
      pageNum += 1;

      // Brief pause to avoid hammering the server.
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
  };

  const buildScoreCsv = (songMap: SongMap): string => {
    const csvRows: string[] = [HEADERS.join(",")];

    Object.keys(songMap)
      .sort()
      .forEach((title) => {
        const data = songMap[title];
        const row: string[] = ["-", escapeCsv(title), "-", "-", "-"];

        DIFFICULTIES.forEach((diff) => {
          const d = data[diff];
          if (d) {
            row.push(
              d.level,
              d.score,
              d.pgreat,
              d.great,
              "-",
              d.lamp,
              d.djLevel,
            );
          } else {
            row.push("-", "0", "0", "0", "-", "NO PLAY", "---");
          }
        });

        row.push("-"); // 最終プレー日時
        csvRows.push(row.join(","));
      });

    return csvRows.join("\n");
  };

  // ---------------------------------------------------------------------------
  // Core scraping logic (Random Lane Tickets)
  // ---------------------------------------------------------------------------

  const scrapeRandomLane = async (): Promise<string> => {
    const statusLevel = document.getElementById("__iidx_status_level");
    const statusPage = document.getElementById("__iidx_status_page");
    const itemCountEl = document.getElementById("__iidx_item_count");

    const csvRows = ["チケット番号,有効期限"];
    let page = 0;

    while (true) {
      if (statusLevel)
        statusLevel.textContent = "ランダムレーンチケットを取得中...";
      if (statusPage) statusPage.textContent = `${page + 1} ページ目`;

      const resp = await fetch(`${RANDOM_LANE_URL}?page=${page}`, {
        method: "GET",
        credentials: "include",
      });

      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const html = await resp.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const ticketList = doc.getElementById("ticket-list");
      const rows = ticketList
        ? Array.from(ticketList.querySelectorAll("ul:not(.head)"))
        : [];

      if (rows.length === 0) break;

      rows.forEach((ul) => {
        const lis = ul.querySelectorAll("li");
        if (lis.length < 2) return;
        const ticketNo = lis[0].textContent?.trim() ?? "";
        const expiry = lis[1].textContent?.trim() ?? "";
        if (ticketNo) {
          csvRows.push(`${ticketNo},${expiry}`);
          if (itemCountEl) itemCountEl.textContent = String(csvRows.length - 1);
        }
      });

      page++;
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }

    if (csvRows.length <= 1) {
      throw new Error("ランダムレーンチケットが見つかりませんでした。");
    }

    return csvRows.join("\n");
  };

  // ---------------------------------------------------------------------------
  // Core scraping logic (Tower)
  // ---------------------------------------------------------------------------

  const scrapeTower = async (): Promise<string> => {
    const statusLevel = document.getElementById("__iidx_status_level");
    const statusPage = document.getElementById("__iidx_status_page");
    const itemCountEl = document.getElementById("__iidx_item_count");

    if (statusLevel) statusLevel.textContent = `タワーデータを取得中...`;
    if (statusPage) statusPage.textContent = ``;

    const resp = await fetch(TOWER_URL, {
      method: "GET",
      credentials: "include",
    });

    if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
    const html = await resp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rows = doc.querySelectorAll("table.activity tr");

    const csvRows = ["プレー日,鍵盤,スクラッチ"];
    let count = 0;

    rows.forEach((row) => {
      const tds = row.querySelectorAll("td");
      if (tds.length < 3) return;

      const date = tds[0].textContent?.trim() ?? "";
      const key = tds[1].textContent?.replace(/回/g, "").trim() ?? "0";
      const scr = tds[2].textContent?.replace(/回/g, "").trim() ?? "0";

      csvRows.push(`${date},${key},${scr}`);
      count++;
      if (itemCountEl) itemCountEl.textContent = String(count);
    });

    if (count === 0) {
      throw new Error("タワーデータが見つかりませんでした。");
    }

    return csvRows.join("\n");
  };

  // ---------------------------------------------------------------------------
  // Main run loop
  // ---------------------------------------------------------------------------

  const run = async (
    overlay: HTMLDivElement,
    mode: ScrapeMode,
  ): Promise<void> => {
    showStep("progress");

    const unitEl = document.getElementById("__iidx_count_unit");
    if (unitEl)
      unitEl.textContent =
        mode === "tower" ? "日分" : mode === "random_lane" ? "枚" : "曲";

    try {
      let finalCsv = "";
      let itemCount = 0;
      let pageCount = 0;

      if (mode === "random_lane") {
        finalCsv = await scrapeRandomLane();
        itemCount = finalCsv.split("\n").length - 1;
        pageCount = 1;
      } else if (mode === "tower") {
        finalCsv = await scrapeTower();
        itemCount = finalCsv.split("\n").length - 1; // ヘッダー分を引く
        pageCount = 1;
      } else {
        const levelIndices: number[] =
          mode === "all" ? [...Array(12).keys()] : [10, 11];
        const songMap: SongMap = {};
        const pageCounter = { value: 0 };

        for (const lv of levelIndices) {
          await scrapeLevel(songMap, lv, LEVEL_LABELS[lv], pageCounter);
        }

        finalCsv = buildScoreCsv(songMap);
        itemCount = Object.keys(songMap).length;
        pageCount = pageCounter.value;
      }

      const outputEl = document.getElementById(
        "__iidx_output",
      ) as HTMLTextAreaElement | null;
      const summaryEl = document.getElementById("__iidx_result_summary");
      const bpimLink = document.getElementById(
        "__iidx_link_bpim",
      ) as HTMLAnchorElement | null;

      if (outputEl) outputEl.value = finalCsv;
      if (bpimLink) {
        bpimLink.href =
          mode === "tower"
            ? "https://bpi2.poyashi.me/import?tab=tower"
            : mode === "random_lane"
              ? "https://bpi2.poyashi.me/import?tab=random_lane"
              : "https://bpi2.poyashi.me/import";
      }

      let autoCopied = false;
      try {
        await navigator.clipboard.writeText(finalCsv);
        autoCopied = true;
      } catch (err) {
        console.warn("Auto-copy failed:", err);
      }

      const bannerEl = document.getElementById("__iidx_result_banner");
      const iconEl = document.getElementById("__iidx_result_icon");
      const titleEl = document.getElementById("__iidx_result_title");
      const copyBtnEl = document.getElementById(
        "__iidx_btn_copy",
      ) as HTMLButtonElement | null;

      const unitStr =
        mode === "tower"
          ? "日分のデータ"
          : mode === "random_lane"
            ? "枚のチケット"
            : "曲";
      const pageStr = mode === "tower" ? "" : `（${pageCount}ページ）`;

      if (autoCopied) {
        if (bannerEl)
          Object.assign(bannerEl.style, {
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
          });
        if (iconEl) iconEl.textContent = "✅";
        if (titleEl)
          Object.assign(titleEl, {
            textContent: "コピー完了",
            style: "font-weight:700; color:#166534;",
          });
        if (summaryEl)
          Object.assign(summaryEl, {
            textContent: `${itemCount}${unitStr}${pageStr}をクリップボードにコピーしました`,
            style: "font-size:12px; color:#15803d;",
          });
      } else {
        if (bannerEl)
          Object.assign(bannerEl.style, {
            background: "#fffbeb",
            border: "1px solid #fde68a",
          });
        if (iconEl) iconEl.textContent = "⚠️";
        if (titleEl)
          Object.assign(titleEl, {
            textContent: "取得完了",
            style: "font-weight:700; color:#92400e;",
          });
        if (summaryEl)
          Object.assign(summaryEl, {
            textContent: `${itemCount}${unitStr}${pageStr}を取得しました。下のボタンでコピーしてください`,
            style: "font-size:12px; color:#b45309;",
          });
        if (copyBtnEl) {
          copyBtnEl.style.display = "block";
          copyBtnEl.onclick = async () => {
            await navigator.clipboard.writeText(finalCsv);
            copyBtnEl.textContent = "コピー済み ✓";
            copyBtnEl.style.background = "#059669";
          };
        }
      }

      showStep("result");
    } catch (e: unknown) {
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

  // Initial state
  showStep("select_mode");

  const closeModal = (): void => {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  };

  // Step 1: Mode Select
  (
    document.getElementById("__iidx_btn_mode_score") as HTMLButtonElement
  ).onclick = () => showStep("select_score");
  (
    document.getElementById("__iidx_btn_mode_tower") as HTMLButtonElement
  ).onclick = () => run(overlay, "tower");
  (
    document.getElementById("__iidx_btn_mode_random_lane") as HTMLButtonElement
  ).onclick = () => run(overlay, "random_lane");

  // Step 2: Score Select
  (document.getElementById("__iidx_btn_back") as HTMLButtonElement).onclick =
    () => showStep("select_mode");
  (document.getElementById("__iidx_btn_all") as HTMLButtonElement).onclick =
    () => run(overlay, "all");
  (document.getElementById("__iidx_btn_1112") as HTMLButtonElement).onclick =
    () => run(overlay, "1112");

  // Global Actions
  (document.getElementById("__iidx_btn_x") as HTMLButtonElement).onclick =
    closeModal;
  (document.getElementById("__iidx_btn_close2") as HTMLButtonElement).onclick =
    closeModal;
  (document.getElementById("__iidx_btn_retry") as HTMLButtonElement).onclick =
    () => showStep("select_mode");

  // Close on backdrop click.
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay) closeModal();
  });
})();
