# 用「App 型式」睇 Stock Coach（Phase 5 · ⑤）

Stock Coach 係一個 **PWA（Progressive Web App）**：同一個網址，唔使 App Store，就可以「安裝」成桌面／手機 App——有自己嘅圖示、獨立視窗（冇瀏覽器地址欄）、離線都開到。

重點：安裝需要 **HTTPS**（或本機 `localhost`）。用手機真機測試時，要一個 https 網址（例如 Gateway Portal 出嘅 public URL）。純本機 `http://…` 淨係喺同機瀏覽器裝到。

---

## macOS（桌面 App）

**Chrome / Edge**
1. 開 app 網址 → 右上角網址欄右邊會出現「安裝」圖示（⊕／螢幕加箭嘴），或者打開瀏覽器選單 → **Install Stock Coach…**
2. 按 **Install** → 會開一個獨立視窗，Dock 見到 Stock Coach 圖示。

**Safari 17+（macOS Sonoma 或以上）**
1. 開 app 網址 → 選單 **File → Add to Dock…**
2. 確定 → Dock 出現圖示，之後係獨立 App 視窗。

---

## iPhone / iPad（iOS）

**Safari（一定要用 Safari）**
1. 用 Safari 開 app 網址（**https**）。
2. 按底部 **分享** 掣（⬆️ 出格仔）。
3. 揀 **加入主畫面 / Add to Home Screen**。
4. 改名（可保留 Stock Coach）→ **新增**。
5. 主畫面出現圖示；開啟時係全螢幕（`standalone`），狀態欄跟日夜模式變色。

> Chrome/Firefox on iOS 加唔到主畫面（iOS 限制），必須 Safari。

---

## Android

**Chrome**
1. 開 app 網址 → 右上角 ⋮ → **安裝應用程式 / Add to Home screen**。
2. 確定 → 主畫面／App 抽屜出現圖示，獨立視窗開啟。

---

## 離線 / 更新
- 第一次開啟後，service worker 會 cache app 外殼；之後斷網都開到介面（行情數據會用最後一次 cache，或顯示「暫無資料」）。
- 有新版本會自動更新（`registerType: 'autoUpdate'`）。如果見到舊版，**Cmd+Shift+R**（iOS 就關閉再開）強制重載。

---

## 開發者：本機點 serve 嚟安裝
```bash
cd ~/.openclaw/workspace/debug-coder/projects/stock-app
npm run build      # 出 dist/
npm run server     # Express 同時 serve API + dist，預設 http://127.0.0.1:8787
```
- 桌面瀏覽器：`http://127.0.0.1:8787` 可以直接安裝（localhost 當安全來源）。
- iOS 真機：`127.0.0.1` 喺手機指唔到去電腦。用 Gateway **Portal** 開一個 https route，喺手機開嗰個 public URL 再「加入主畫面」。

## 驗證（已自動化）
`npm run evidence:phase5` 會喺真 Chrome 檢查：manifest 有 200、`display: standalone`、有 192/512 icon、有 `start_url`，同埋 service worker 真係註冊到。全部通過。
