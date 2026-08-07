/* pipeline.js — SPA navigation + Pipeline API calls */
(function () {
  "use strict";

  // ── SPA page router ────────────────────────────────────────────
  const pages = document.querySelectorAll(".page");
  const navBtns = document.querySelectorAll(".nav-btn");

  function showPage(id) {
    pages.forEach(p => p.classList.toggle("active", p.id === `page-${id}`));
    navBtns.forEach(b => b.classList.toggle("active", b.dataset.page === id));
  }

  navBtns.forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));

  // ── Helpers ────────────────────────────────────────────────────
  function setBadge(id, text, kind) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `step-badge ${kind || ""}`.trim();
  }

  function appendLog(containerId, message, type) {
    const log = document.getElementById(containerId);
    const line = document.createElement("p");
    line.className = `log-line ${type || ""}`;
    line.textContent = message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function clearLog(containerId) {
    document.getElementById(containerId).innerHTML = "";
  }

  // ── Step 1: Extract subtitles ──────────────────────────────────
  const extractBtn = document.getElementById("extract-btn");
  const extractUrl = document.getElementById("extract-url");
  const extractOutput = document.getElementById("extract-output");

  extractBtn.addEventListener("click", async () => {
    const url = extractUrl.value.trim();
    if (!url) return;

    extractBtn.disabled = true;
    extractOutput.hidden = false;
    clearLog("extract-log");
    setBadge("extract-badge", "추출 중...", "loading");
    appendLog("extract-log", `URL: ${url}`, "info");

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "status") {
            appendLog("extract-log", data.message, "info");
          } else if (data.type === "complete") {
            appendLog("extract-log", data.message, "success");
            setBadge("extract-badge", "완료", "done");
            setBadge("translate-badge", "진행 가능", "ready");
            renderExtractedFiles(data.files || []);
          } else if (data.type === "error") {
            appendLog("extract-log", data.message, "error");
            setBadge("extract-badge", "실패", "error");
          }
        }
      }
    } catch (err) {
      appendLog("extract-log", `네트워크 오류: ${err.message}`, "error");
      setBadge("extract-badge", "실패", "error");
    } finally {
      extractBtn.disabled = false;
    }
  });

  function renderExtractedFiles(files) {
    const container = document.getElementById("en-files-list");
    container.innerHTML = "";
    for (const file of files) {
      const chip = document.createElement("a");
      chip.className = "file-chip";
      chip.href = `/api/files/${file.path}`;
      chip.download = file.name;
      chip.textContent = file.name;
      container.appendChild(chip);
    }
    refreshKoVttSelect();
  }

  // ── Step 2: Upload Korean VTT ──────────────────────────────────
  const uploadZone = document.getElementById("upload-zone");
  const uploadInput = document.getElementById("upload-vtt");
  const uploadResult = document.getElementById("upload-result");

  uploadZone.addEventListener("click", () => uploadInput.click());
  uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
  uploadZone.addEventListener("drop", e => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) uploadVtt(e.dataTransfer.files[0]);
  });
  uploadInput.addEventListener("change", e => { if (e.target.files[0]) uploadVtt(e.target.files[0]); });

  async function uploadVtt(file) {
    setBadge("translate-badge", "업로드 중...", "loading");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        uploadResult.hidden = false;
        uploadResult.textContent = `✓ ${data.name} 업로드 완료`;
        uploadResult.className = "upload-success";
        setBadge("translate-badge", "완료", "done");
        setBadge("synth-badge", "진행 가능", "ready");
        refreshKoVttSelect();
      } else {
        uploadResult.hidden = false;
        uploadResult.textContent = `✗ ${data.error}`;
        uploadResult.className = "upload-error";
        setBadge("translate-badge", "실패", "error");
      }
    } catch (err) {
      uploadResult.hidden = false;
      uploadResult.textContent = `✗ 네트워크 오류: ${err.message}`;
      uploadResult.className = "upload-error";
      setBadge("translate-badge", "실패", "error");
    }
  }

  // ── Step 3: Synthesize TTS ─────────────────────────────────────
  const synthBtn = document.getElementById("synth-btn");
  const synthVttSelect = document.getElementById("synth-vtt");
  const synthVoice = document.getElementById("synth-voice");
  const synthRate = document.getElementById("synth-rate");
  const synthProgress = document.getElementById("synth-progress");
  const synthProgressFill = document.getElementById("synth-progress-fill");
  const synthProgressText = document.getElementById("synth-progress-text");
  const synthResult = document.getElementById("synth-result");

  synthBtn.addEventListener("click", async () => {
    const vtt = synthVttSelect.value;
    if (!vtt) return;

    synthBtn.disabled = true;
    synthProgress.hidden = false;
    synthResult.hidden = true;
    clearLog("synth-log");
    setBadge("synth-badge", "합성 중...", "loading");
    synthProgressFill.style.width = "0%";
    synthProgressText.textContent = "0%";

    try {
      const response = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vtt,
          voice: synthVoice.value,
          rate: synthRate.value,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "progress") {
            synthProgressFill.style.width = `${data.percent}%`;
            synthProgressText.textContent = `${data.stage} ${data.current}/${data.total} (${data.percent}%)`;
          } else if (data.type === "status") {
            appendLog("synth-log", data.message, "info");
          } else if (data.type === "complete") {
            synthProgressFill.style.width = "100%";
            synthProgressText.textContent = "100%";
            appendLog("synth-log", data.message, "success");
            setBadge("synth-badge", "완료", "done");
            synthResult.hidden = false;
            window._lastSynthWav = data.wav;
            refreshFiles();
          } else if (data.type === "error") {
            appendLog("synth-log", data.message, "error");
            setBadge("synth-badge", "실패", "error");
          }
        }
      }
    } catch (err) {
      appendLog("synth-log", `네트워크 오류: ${err.message}`, "error");
      setBadge("synth-badge", "실패", "error");
    } finally {
      synthBtn.disabled = false;
    }
  });

  // Go to player button
  document.getElementById("goto-player-btn").addEventListener("click", () => {
    showPage("player");
    // If we have the last synthesized WAV, try to load it
    if (window._lastSynthWav) {
      loadServerWav(window._lastSynthWav.path);
    }
    // Auto-fill YouTube URL if available
    const ytInput = document.getElementById("youtube-url");
    const pipelineUrl = extractUrl.value.trim();
    if (pipelineUrl && !ytInput.value.trim()) {
      ytInput.value = pipelineUrl;
    }
  });

  // ── Refresh VTT file select ────────────────────────────────────
  async function refreshKoVttSelect() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      synthVttSelect.innerHTML = "";

      const koVtts = (data.ko || []).filter(f => f.type === "vtt");
      for (const f of koVtts) {
        const opt = document.createElement("option");
        opt.value = f.path;
        opt.textContent = f.name;
        synthVttSelect.appendChild(opt);
      }
      synthBtn.disabled = koVtts.length === 0;
    } catch {
      synthBtn.disabled = true;
    }
  }

  // ── Files page ─────────────────────────────────────────────────
  async function refreshFiles() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      renderFileList("files-en", data.en || []);
      renderFileList("files-ko", data.ko || []);
      renderServerFilesInPlayer(data);
    } catch { /* offline mode */ }
  }

  function renderFileList(containerId, files) {
    const container = document.getElementById(containerId);
    if (!files.length) {
      container.innerHTML = '<p class="file-empty">파일 없음</p>';
      return;
    }
    container.innerHTML = "";
    for (const f of files) {
      const row = document.createElement("div");
      row.className = "file-row";

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = f.name;

      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatSize(f.size);

      const dl = document.createElement("a");
      dl.className = "file-download";
      dl.href = `/api/files/${f.path}`;
      dl.download = f.name;
      dl.textContent = "다운로드";

      row.append(name, size, dl);
      container.appendChild(row);
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // ── Load server files into player ──────────────────────────────
  function renderServerFilesInPlayer(data) {
    const row = document.getElementById("server-files-row");
    const wavChips = document.getElementById("server-wav-chips");
    const vttChips = document.getElementById("server-vtt-chips");
    wavChips.innerHTML = "";
    vttChips.innerHTML = "";

    const wavs = (data.ko || []).filter(f => f.type === "wav");
    const vtts = [...(data.en || []).filter(f => f.type === "vtt"), ...(data.ko || []).filter(f => f.type === "vtt")];

    if (!wavs.length && !vtts.length) { row.hidden = true; return; }
    row.hidden = false;

    for (const f of wavs) {
      const btn = document.createElement("button");
      btn.className = "file-chip-btn";
      btn.type = "button";
      btn.textContent = `🔊 ${f.name}`;
      btn.addEventListener("click", () => loadServerWav(f.path));
      wavChips.appendChild(btn);
    }

    for (const f of vtts) {
      const lang = f.path.startsWith("en/") ? "en" : "ko";
      const btn = document.createElement("button");
      btn.className = "file-chip-btn";
      btn.type = "button";
      btn.textContent = `📄 ${f.name}`;
      btn.addEventListener("click", () => loadServerVtt(f.path, lang));
      vttChips.appendChild(btn);
    }
  }

  async function loadServerWav(path) {
    try {
      const res = await fetch(`/api/files/${path}`);
      const blob = await res.blob();
      const file = new File([blob], path.split("/").pop(), { type: "audio/wav" });
      // Trigger the existing player's WAV loader
      const wavInput = document.getElementById("wav-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      wavInput.files = dt.files;
      wavInput.dispatchEvent(new Event("change", { bubbles: true }));
    } catch { /* silent */ }
  }

  async function loadServerVtt(path, lang) {
    try {
      const res = await fetch(`/api/files/${path}`);
      const blob = await res.blob();
      const file = new File([blob], path.split("/").pop(), { type: "text/vtt" });
      const inputId = lang === "en" ? "english-vtt" : "korean-vtt";
      const input = document.getElementById(inputId);
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch { /* silent */ }
  }

  document.getElementById("refresh-files").addEventListener("click", refreshFiles);

  // ── Init ───────────────────────────────────────────────────────
  refreshKoVttSelect();
  refreshFiles();
})();
