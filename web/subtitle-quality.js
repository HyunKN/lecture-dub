/* subtitle-quality.js — translation/TTS-oriented subtitle recommendation UI */
(function () {
  "use strict";

  const state = {
    payload: null,
    rawVisible: false,
    refreshTimer: null,
    rendering: false,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function fileSize(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function lectureLabel(name) {
    return String(name || "")
      .replace(/\.en-orig\.vtt$/i, "")
      .replace(/\.en(?:-[A-Za-z0-9-]+)?\.vtt$/i, "")
      .replace(/\.vtt$/i, "");
  }

  function stepRoot() {
    const direct = document.getElementById("step-translate");
    if (direct) return direct;
    return [...document.querySelectorAll("section, main, div")].find(element =>
      element.textContent?.includes("한국어 자막 번역") &&
      element.textContent?.includes("추출된 영어 자막 파일")
    ) || null;
  }

  function rawHeading(root) {
    if (!root) return null;
    const candidates = [...root.querySelectorAll("strong, h3, h4, p, div, span")];
    return candidates.find(element => {
      if (element.closest("#subtitle-quality-panel")) return false;
      const text = element.textContent?.trim() || "";
      return text === "추출된 영어 자막 파일:" || text === "추출된 영어 자막 파일";
    }) || null;
  }

  function sourceElements(root, names) {
    if (!root) return [];
    const wanted = new Set(names);
    return [...root.querySelectorAll("a, button")].filter(element => {
      if (element.closest("#subtitle-quality-panel")) return false;
      const text = element.textContent?.trim() || "";
      for (const name of wanted) {
        if (text.includes(name)) return true;
      }
      return false;
    });
  }

  function findSourceElement(name) {
    const root = stepRoot() || document;
    return [...root.querySelectorAll("a, button")].find(element =>
      !element.closest("#subtitle-quality-panel") &&
      (element.textContent?.trim() || "").includes(name)
    ) || null;
  }

  function style() {
    if (document.getElementById("subtitle-quality-style")) return;
    const tag = document.createElement("style");
    tag.id = "subtitle-quality-style";
    tag.textContent = `
      #subtitle-quality-panel { margin: 18px 0; padding: 16px; border: 1px solid var(--border-light, #34363a); border-radius: 14px; background: rgba(22,23,25,.72); }
      .sq-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:14px; }
      .sq-head h3 { margin:0 0 5px; font-size:14px; }
      .sq-head p { margin:0; color:var(--text-secondary,#a5a8ad); font-size:11px; line-height:1.55; }
      .sq-head-actions { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
      .sq-btn { min-height:34px; padding:0 10px; border:1px solid var(--border-light,#3a3c40); border-radius:9px; background:var(--surface,#202124); color:inherit; cursor:pointer; font:inherit; font-size:11px; font-weight:700; }
      .sq-groups { display:grid; gap:12px; }
      .sq-card { padding:13px; border:1px solid var(--border-light,#34363a); border-radius:11px; background:rgba(11,12,13,.48); }
      .sq-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .sq-title { min-width:0; }
      .sq-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
      .sq-title span { display:block; margin-top:4px; color:var(--text-secondary,#999da3); font-size:10px; }
      .sq-score { flex:0 0 auto; padding:5px 9px; border:1px solid #27764a; border-radius:999px; color:#8ee2af; font-size:10px; font-weight:800; }
      .sq-file-row { display:flex; align-items:center; gap:8px; margin-top:11px; }
      .sq-file { flex:1; min-width:0; padding:9px 10px; border:1px solid var(--border-light,#3a3c40); border-radius:9px; background:rgba(255,255,255,.035); }
      .sq-file-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:750; }
      .sq-file-meta { margin-top:4px; color:var(--text-secondary,#92969b); font-size:9px; }
      .sq-use { flex:0 0 auto; min-height:38px; padding:0 11px; border:1px solid #357b52; border-radius:9px; background:rgba(42,116,73,.15); color:#9be5b8; cursor:pointer; font:inherit; font-size:10px; font-weight:800; }
      .sq-reasons { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }
      .sq-reason, .sq-warning { padding:4px 7px; border-radius:999px; font-size:9px; line-height:1.2; }
      .sq-reason { background:rgba(42,116,73,.12); color:#9fddb6; border:1px solid rgba(78,151,105,.35); }
      .sq-warning { background:rgba(166,112,35,.12); color:#e0bd82; border:1px solid rgba(184,132,55,.34); }
      .sq-details { margin-top:10px; border-top:1px solid var(--border-light,#303236); padding-top:9px; }
      .sq-details summary { cursor:pointer; color:var(--text-secondary,#aaaeb3); font-size:10px; font-weight:700; }
      .sq-alt-list { display:grid; gap:7px; margin-top:8px; }
      .sq-alt { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:8px 9px; border:1px solid var(--border-light,#303236); border-radius:8px; }
      .sq-alt-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:700; }
      .sq-alt-meta { margin-top:3px; color:var(--text-secondary,#8e9297); font-size:9px; }
      .sq-alt button { min-height:30px; padding:0 8px; border:1px solid var(--border-light,#3b3d42); border-radius:7px; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:9px; }
      .sq-empty, .sq-error { padding:12px; border:1px dashed var(--border-light,#3b3d42); border-radius:9px; color:var(--text-secondary,#a2a5aa); font-size:11px; }
      .sq-error { color:#e3a19a; }
      @media (max-width: 760px) { .sq-head, .sq-card-head, .sq-file-row { flex-direction:column; } .sq-head-actions, .sq-use { width:100%; } .sq-btn, .sq-use { width:100%; } }
    `;
    document.head.appendChild(tag);
  }

  function ensurePanel() {
    const root = stepRoot();
    if (!root) return null;
    let panel = document.getElementById("subtitle-quality-panel");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "subtitle-quality-panel";
    const heading = rawHeading(root);
    if (heading) {
      const parent = heading.parentElement;
      parent?.parentElement?.insertBefore(panel, parent);
    } else {
      root.appendChild(panel);
    }
    return panel;
  }

  function setRawVisible(visible) {
    state.rawVisible = visible;
    const root = stepRoot();
    const files = state.payload?.files || [];
    const names = files.map(file => file.name);
    const elements = sourceElements(root, names);
    for (const element of elements) element.hidden = !visible;
    const heading = rawHeading(root);
    if (heading) heading.hidden = !visible;

    const button = document.getElementById("sq-toggle-raw");
    if (button) button.textContent = visible ? "기존 전체 목록 숨기기" : `기존 전체 목록 보기 (${elements.length})`;
  }

  function clickOriginal(name) {
    const source = findSourceElement(name);
    if (source) {
      source.click();
      return;
    }
    setRawVisible(true);
  }

  function renderFile(file, recommended) {
    const reasons = (file.reasons || []).map(reason => `<span class="sq-reason">✓ ${escapeHtml(reason)}</span>`).join("");
    const warnings = (file.warnings || []).map(reason => `<span class="sq-warning">! ${escapeHtml(reason)}</span>`).join("");
    return `
      <div class="sq-file-row">
        <div class="sq-file">
          <div class="sq-file-name">${escapeHtml(file.name)}</div>
          <div class="sq-file-meta">${fileSize(file.size_bytes)} · ${Number(file.cue_count || 0).toLocaleString()} cues · 중복 ${percent(file.duplicate_ratio)} · inline timestamp ${percent(file.inline_timestamp_ratio)}</div>
        </div>
        <button class="sq-use" type="button" data-sq-file="${escapeHtml(file.name)}">${recommended ? "추천 자막 받기" : "이 파일 받기"}</button>
      </div>
      <div class="sq-reasons">${reasons}${warnings}</div>
    `;
  }

  function groupOrder(files) {
    const root = stepRoot();
    const source = sourceElements(root, files.map(file => file.name));
    const order = new Map();
    source.forEach((element, index) => {
      const text = element.textContent || "";
      const file = files.find(item => text.includes(item.name));
      if (file && !order.has(file.group)) order.set(file.group, index);
    });
    return order;
  }

  function render(payload) {
    state.rendering = true;
    state.payload = payload;
    const panel = ensurePanel();
    if (!panel) {
      state.rendering = false;
      return;
    }

    const files = Array.isArray(payload.files) ? payload.files : [];
    const grouped = new Map();
    for (const file of files) {
      if (!grouped.has(file.group)) grouped.set(file.group, []);
      grouped.get(file.group).push(file);
    }

    const order = groupOrder(files);
    const groups = [...grouped.entries()].sort((a, b) => {
      const ai = order.has(a[0]) ? order.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b[0]) ? order.get(b[0]) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a[0]).localeCompare(String(b[0]));
    });

    const cards = groups.map(([, groupFiles]) => {
      const sorted = [...groupFiles].sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score);
      const best = sorted.find(file => file.recommended) || sorted[0];
      const alternatives = sorted.filter(file => file !== best);
      const altHtml = alternatives.map(file => `
        <div class="sq-alt">
          <div>
            <div class="sq-alt-name">${escapeHtml(file.name)}</div>
            <div class="sq-alt-meta">${file.score}점 · ${fileSize(file.size_bytes)} · 중복 ${percent(file.duplicate_ratio)} · inline ${percent(file.inline_timestamp_ratio)}</div>
          </div>
          <button type="button" data-sq-file="${escapeHtml(file.name)}">받기</button>
        </div>`).join("");

      return `
        <article class="sq-card">
          <div class="sq-card-head">
            <div class="sq-title">
              <strong>${escapeHtml(lectureLabel(best.name))}</strong>
              <span>파일명이 아니라 실제 VTT 내용을 검사해 번역/TTS 적합도를 계산했습니다.</span>
            </div>
            <span class="sq-score">추천 · ${best.score}점</span>
          </div>
          ${renderFile(best, true)}
          ${alternatives.length ? `
            <details class="sq-details">
              <summary>다른 영어 자막 ${alternatives.length}개 보기</summary>
              <div class="sq-alt-list">${altHtml}</div>
            </details>` : ""}
        </article>`;
    }).join("");

    panel.innerHTML = `
      <div class="sq-head">
        <div>
          <h3>번역/TTS용 영어 자막 추천</h3>
          <p>중복·rolling caption·단어 단위 타임코드·짧은 cue·비정상적인 크기와 길이를 함께 검사합니다. <strong>en-orig, en-US 같은 파일명 자체에는 가산점을 주지 않습니다.</strong></p>
        </div>
        <div class="sq-head-actions">
          <button class="sq-btn" id="sq-refresh" type="button">품질 다시 검사</button>
          <button class="sq-btn" id="sq-toggle-raw" type="button">기존 전체 목록 보기</button>
        </div>
      </div>
      <div class="sq-groups">${cards || '<div class="sq-empty">분석할 영어 VTT가 없습니다. 먼저 영어 자막을 추출하세요.</div>'}</div>
    `;

    panel.querySelector("#sq-refresh")?.addEventListener("click", refresh);
    panel.querySelector("#sq-toggle-raw")?.addEventListener("click", () => setRawVisible(!state.rawVisible));
    panel.querySelectorAll("[data-sq-file]").forEach(button => {
      button.addEventListener("click", () => clickOriginal(button.dataset.sqFile));
    });

    setRawVisible(false);
    state.rendering = false;
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/subtitle-quality?t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      render(data);
    } catch (error) {
      const panel = ensurePanel();
      if (panel) panel.innerHTML = `<div class="sq-error">자막 품질 분석 실패: ${escapeHtml(error.message)}</div>`;
    }
  }

  function scheduleRefresh() {
    if (state.rendering) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refresh, 250);
  }

  function init() {
    style();
    refresh();
    const root = stepRoot();
    if (!root) return;
    const observer = new MutationObserver(mutations => {
      if (state.rendering) return;
      const changedOutsidePanel = mutations.some(mutation =>
        !mutation.target.closest?.("#subtitle-quality-panel")
      );
      if (changedOutsidePanel) scheduleRefresh();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
