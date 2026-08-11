/* subtitle-quality.js — compact recommendation UI scoped to the current YouTube video */
(function () {
  "use strict";

  const state = {
    refreshTimer: null,
    lastVideoId: "",
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

  function currentVideoId() {
    const raw = document.getElementById("url-input")?.value?.trim() || "";
    if (!raw) return "";

    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
      if (host.endsWith("youtube.com")) {
        const queryId = url.searchParams.get("v");
        if (queryId) return queryId;
        const parts = url.pathname.split("/").filter(Boolean);
        if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || "";
      }
    } catch {
      return "";
    }
    return "";
  }

  function sourceRow() {
    return document.getElementById("en-files-chips")?.closest(".files-preview-row") || null;
  }

  function ensurePanel() {
    let panel = document.getElementById("subtitle-quality-panel");
    if (panel) return panel;

    const row = sourceRow();
    if (!row) return null;

    panel = document.createElement("section");
    panel.id = "subtitle-quality-panel";
    row.parentElement?.insertBefore(panel, row);
    row.hidden = true;
    return panel;
  }

  function hideLegacyList() {
    const row = sourceRow();
    if (row) row.hidden = true;
  }

  function style() {
    if (document.getElementById("subtitle-quality-style")) return;
    const tag = document.createElement("style");
    tag.id = "subtitle-quality-style";
    tag.textContent = `
      #subtitle-quality-panel { margin:16px 0 18px; }
      .sq-box { padding:14px; border:1px solid var(--border-light,#34363a); border-radius:12px; background:rgba(18,19,21,.58); }
      .sq-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .sq-heading { min-width:0; }
      .sq-heading strong { display:block; font-size:13px; }
      .sq-heading span { display:block; margin-top:3px; color:var(--text-secondary,#9ca3af); font-size:10px; }
      .sq-score { flex:0 0 auto; padding:5px 9px; border:1px solid #27764a; border-radius:999px; color:#8ee2af; font-size:10px; font-weight:800; }
      .sq-file-row { display:flex; align-items:center; gap:9px; }
      .sq-file { flex:1; min-width:0; padding:9px 10px; border:1px solid var(--border-light,#383a3f); border-radius:9px; background:rgba(255,255,255,.03); }
      .sq-file-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:750; }
      .sq-meta { margin-top:4px; color:var(--text-secondary,#92969b); font-size:9px; }
      .sq-download { flex:0 0 auto; display:inline-flex; align-items:center; min-height:38px; padding:0 11px; border:1px solid #357b52; border-radius:9px; background:rgba(42,116,73,.13); color:#9be5b8; text-decoration:none; font-size:10px; font-weight:800; }
      .sq-details { margin-top:9px; padding-top:8px; border-top:1px solid var(--border-light,#303236); }
      .sq-details summary { cursor:pointer; color:var(--text-secondary,#a7abb0); font-size:10px; font-weight:700; }
      .sq-reasons { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
      .sq-reason,.sq-warning { padding:4px 7px; border-radius:999px; font-size:9px; }
      .sq-reason { color:#9fddb6; border:1px solid rgba(78,151,105,.35); background:rgba(42,116,73,.1); }
      .sq-warning { color:#e0bd82; border:1px solid rgba(184,132,55,.34); background:rgba(166,112,35,.1); }
      .sq-alt-list { display:grid; gap:7px; margin-top:8px; }
      .sq-alt { display:flex; align-items:center; gap:8px; padding:7px 8px; border:1px solid var(--border-light,#303236); border-radius:8px; }
      .sq-alt-copy { flex:1; min-width:0; }
      .sq-alt-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; font-weight:700; }
      .sq-alt-meta { margin-top:2px; color:var(--text-secondary,#8e9297); font-size:9px; }
      .sq-alt a { flex:0 0 auto; color:inherit; font-size:9px; font-weight:700; text-decoration:none; }
      .sq-empty { padding:11px 12px; border:1px dashed var(--border-light,#3b3d42); border-radius:10px; color:var(--text-secondary,#a2a5aa); font-size:11px; }
      .sq-error { color:#e3a19a; }
      @media (max-width:760px) { .sq-top,.sq-file-row { align-items:flex-start; flex-direction:column; } .sq-download { width:100%; justify-content:center; } }
    `;
    document.head.appendChild(tag);
  }

  function downloadHref(path) {
    return `/api/files/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
  }

  function recommendationReason(file) {
    if ((file.duplicate_ratio || 0) < 0.08 && (file.inline_timestamp_ratio || 0) < 0.05) {
      return "중복과 불필요한 단어 타임코드가 적어 번역/TTS에 적합합니다.";
    }
    return "같은 영상의 영어 자막 중 품질 점수가 가장 높습니다.";
  }

  function renderWaiting(message) {
    const panel = ensurePanel();
    if (!panel) return;
    hideLegacyList();
    panel.innerHTML = `<div class="sq-empty">${escapeHtml(message)}</div>`;
  }

  function render(payload) {
    const panel = ensurePanel();
    if (!panel) return;
    hideLegacyList();

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) {
      renderWaiting("현재 영상에서 분석할 영어 VTT가 없습니다. 먼저 자막을 추출하세요.");
      return;
    }

    const sorted = [...files].sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score);
    const best = sorted.find(file => file.recommended) || sorted[0];
    const alternatives = sorted.filter(file => file !== best);

    const reasons = (best.reasons || []).map(reason => `<span class="sq-reason">✓ ${escapeHtml(reason)}</span>`).join("");
    const warnings = (best.warnings || []).map(reason => `<span class="sq-warning">! ${escapeHtml(reason)}</span>`).join("");
    const altHtml = alternatives.map(file => `
      <div class="sq-alt">
        <div class="sq-alt-copy">
          <div class="sq-alt-name">${escapeHtml(file.name)}</div>
          <div class="sq-alt-meta">${file.score}점 · ${fileSize(file.size_bytes)} · 중복 ${percent(file.duplicate_ratio)} · inline ${percent(file.inline_timestamp_ratio)}</div>
        </div>
        <a href="${downloadHref(file.path)}" download="${escapeHtml(file.name)}">받기</a>
      </div>`).join("");

    panel.innerHTML = `
      <div class="sq-box">
        <div class="sq-top">
          <div class="sq-heading">
            <strong>번역/TTS용 추천 자막</strong>
            <span>${escapeHtml(recommendationReason(best))}</span>
          </div>
          <span class="sq-score">추천 · ${best.score}점</span>
        </div>
        <div class="sq-file-row">
          <div class="sq-file">
            <div class="sq-file-name">${escapeHtml(best.name)}</div>
            <div class="sq-meta">${fileSize(best.size_bytes)} · ${Number(best.cue_count || 0).toLocaleString()} cues · 중복 ${percent(best.duplicate_ratio)} · inline ${percent(best.inline_timestamp_ratio)}</div>
          </div>
          <a class="sq-download" href="${downloadHref(best.path)}" download="${escapeHtml(best.name)}">추천 자막 받기</a>
        </div>
        ${(reasons || warnings) ? `
          <details class="sq-details">
            <summary>추천 근거 보기</summary>
            <div class="sq-reasons">${reasons}${warnings}</div>
          </details>` : ""}
        ${alternatives.length ? `
          <details class="sq-details">
            <summary>다른 영어 자막 ${alternatives.length}개 보기</summary>
            <div class="sq-alt-list">${altHtml}</div>
          </details>` : ""}
      </div>`;
  }

  async function refresh() {
    const videoId = currentVideoId();
    state.lastVideoId = videoId;

    if (!videoId) {
      renderWaiting("위의 YouTube URL을 입력하고 자막을 추출하면 추천 파일이 표시됩니다.");
      return;
    }

    try {
      const query = new URLSearchParams({ video_id: videoId, t: String(Date.now()) });
      const response = await fetch(`/api/subtitle-quality?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (videoId !== currentVideoId()) return;
      render(data);
    } catch (error) {
      const panel = ensurePanel();
      if (panel) panel.innerHTML = `<div class="sq-empty sq-error">자막 품질 분석 실패: ${escapeHtml(error.message)}</div>`;
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refresh, 180);
  }

  function init() {
    style();
    hideLegacyList();
    refresh();

    const urlInput = document.getElementById("url-input");
    urlInput?.addEventListener("input", scheduleRefresh);
    urlInput?.addEventListener("change", scheduleRefresh);

    const source = document.getElementById("en-files-chips");
    if (source) {
      const observer = new MutationObserver(scheduleRefresh);
      observer.observe(source, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
