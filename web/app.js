/* app.js — Unified Single-Page App with SVG Icons, Explorer Actions, & WebGL Refresh Fix */
(function () {
  "use strict";

  // ── 1. Collapsible Sidebar ─────────────────────────────────────
  const body = document.body;
  const sidebarToggle = document.getElementById("sidebar-toggle");

  const savedState = localStorage.getItem("lecture-dub-sidebar-collapsed");
  if (savedState === "true") {
    body.classList.add("collapsed");
  }

  sidebarToggle.addEventListener("click", () => {
    body.classList.toggle("collapsed");
    localStorage.setItem("lecture-dub-sidebar-collapsed", body.classList.contains("collapsed"));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
  });

  // ── 2. SPA Page Switcher ───────────────────────────────────────
  const navItems = document.querySelectorAll(".nav-item");
  const pageViews = document.querySelectorAll(".page-view");

  function switchPage(pageId) {
    pageViews.forEach(view => {
      view.classList.toggle("active", view.id === `page-${pageId}`);
    });
    navItems.forEach(item => {
      item.classList.toggle("active", item.dataset.page === pageId);
    });

    if (pageId === "files") {
      loadFiles();
    } else if (pageId === "player") {
      loadServerQuickLoader();
      // Force liquid-glass WebGL renderer to recalculate button bounding boxes now that #page-player is visible!
      setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    }

    try {
      localStorage.setItem("lecture-dub-active-page", pageId);
      if (location.hash !== `#${pageId}`) {
        history.replaceState(null, "", `#${pageId}`);
      }
    } catch { /* silent */ }
  }

  navItems.forEach(item => {
    item.addEventListener("click", () => switchPage(item.dataset.page));
  });

  const validPages = ["pipeline", "player", "files"];
  const hashPage = location.hash.replace("#", "");
  const savedPage = localStorage.getItem("lecture-dub-active-page");
  const initialPage = validPages.includes(hashPage) ? hashPage : (validPages.includes(savedPage) ? savedPage : "pipeline");
  switchPage(initialPage);

  window.addEventListener("hashchange", () => {
    const page = location.hash.replace("#", "");
    if (validPages.includes(page)) {
      switchPage(page);
    }
  });

  // ── 3. Helper Functions ────────────────────────────────────────
  function setPill(id, text, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `status-pill ${kind || ""}`.trim();
  }

  function appendLog(boxId, message, type) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.hidden = false;
    const p = document.createElement("p");
    p.className = `log-line ${type || "info"}`;
    p.textContent = message;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  function clearLog(boxId) {
    const box = document.getElementById(boxId);
    if (box) {
      box.innerHTML = "";
      box.hidden = true;
    }
  }

  const WORKFLOW_SETTINGS_KEY = "lecture-dub-workflow-settings";

  function loadWorkflowSettings() {
    try {
      return JSON.parse(localStorage.getItem(WORKFLOW_SETTINGS_KEY) || "{}");
    } catch { return {}; }
  }

  function saveWorkflowSettings(values) {
    try {
      const settings = { ...loadWorkflowSettings(), ...values };
      localStorage.setItem(WORKFLOW_SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* silent */ }
  }

  // ── 4. Step 1: Extract Subtitles ──────────────────────────────
  const urlInput = document.getElementById("url-input");
  const btnExtract = document.getElementById("btn-extract");

  btnExtract.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert("YouTube URL을 입력해주세요.");
      return;
    }

    btnExtract.disabled = true;
    clearLog("log-extract");
    setPill("badge-extract", "추출 중...", "loading");
    appendLog("log-extract", `YouTube 자막 추출 요청: ${url}`, "info");

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
            appendLog("log-extract", data.message, "info");
          } else if (data.type === "complete") {
            appendLog("log-extract", data.message, "success");
            setPill("badge-extract", "완료", "done");
            setPill("badge-translate", "진행 가능", "done");
            renderExtractedChips(data.files || []);
          } else if (data.type === "error") {
            appendLog("log-extract", data.message, "error");
            setPill("badge-extract", "실패", "error");
          }
        }
      }
    } catch (err) {
      appendLog("log-extract", `네트워크 오류: ${err.message}`, "error");
      setPill("badge-extract", "실패", "error");
    } finally {
      btnExtract.disabled = false;
    }
  });

  function renderExtractedChips(files) {
    const container = document.getElementById("en-files-chips");
    if (!files || !files.length) {
      const empty = document.createElement("span");
      empty.className = "file-chip empty";
      empty.textContent = "아직 추출된 파일이 없습니다.";
      container.replaceChildren(empty);
      return;
    }

    const subtitlePriority = (file) => {
      const name = String(file?.name || "").toLocaleLowerCase();
      if (name.endsWith(".en-orig.vtt")) return { rank: 1, reason: "원래 영어 음성에서 나온 자막" };
      if (name.endsWith(".en.vtt")) return { rank: 2, reason: "일반 English 트랙" };
      // "en-en-US" also ends with "en-US", so it must be checked first.
      if (name.endsWith(".en-en-us.vtt")) return { rank: 4, reason: "번역/변환 계열일 가능성이 있어 우선순위 낮음" };
      if (name.endsWith(".en-us.vtt")) return { rank: 3, reason: "지역 변형/별도 English 트랙" };
      return { rank: 5, reason: "우선순위 파일명 패턴과 일치하지 않음" };
    };

    const orderedFiles = [...files]
      .map(file => ({ file, priority: subtitlePriority(file) }))
      .sort((a, b) => (
        a.priority.rank - b.priority.rank
        || String(a.file?.name || "").localeCompare(String(b.file?.name || ""), undefined, { sensitivity: "base" })
      ));

    const createDownloadLink = (file, className = "file-chip") => {
      const a = document.createElement("a");
      a.className = className;
      const encodedPath = String(file.path || "").split("/").map(encodeURIComponent).join("/");
      a.href = `/api/files/${encodedPath}`;
      a.download = String(file.name || "");

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "14");
      icon.setAttribute("height", "14");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.setAttribute("aria-hidden", "true");
      for (const [name, attributes] of [
        ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
        ["polyline", { points: "7 10 12 15 17 10" }],
        ["line", { x1: "12", x2: "12", y1: "15", y2: "3" }],
      ]) {
        const element = document.createElementNS("http://www.w3.org/2000/svg", name);
        for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
        icon.appendChild(element);
      }
      const name = document.createElement("span");
      name.textContent = String(file.name || "");
      a.append(icon, name);
      return a;
    };

    const recommended = orderedFiles[0];
    const recommendation = document.createElement("section");
    recommendation.className = "subtitle-recommendation";

    const copy = document.createElement("div");
    copy.className = "subtitle-recommendation-copy";
    const eyebrow = document.createElement("span");
    eyebrow.className = "subtitle-recommendation-rank";
    eyebrow.textContent = recommended.priority.rank <= 4
      ? `${recommended.priority.rank}순위 추천`
      : "우선 확인";
    const reason = document.createElement("span");
    reason.className = "subtitle-recommendation-reason";
    reason.textContent = `${recommended.priority.reason} · 이 파일을 번역에 사용하세요.`;
    copy.append(eyebrow, reason);

    const download = createDownloadLink(recommended.file, "file-chip subtitle-recommendation-download");
    download.setAttribute("aria-label", `${recommended.file.name} 다운로드`);
    const downloadLabel = document.createElement("span");
    downloadLabel.className = "subtitle-download-label";
    downloadLabel.textContent = "다운로드";
    download.appendChild(downloadLabel);
    recommendation.append(copy, download);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(recommendation);
    if (orderedFiles.length > 1) {
      const alternatives = document.createElement("details");
      alternatives.className = "subtitle-alternatives";
      const summary = document.createElement("summary");
      summary.textContent = `다른 자막 ${orderedFiles.length - 1}개 보기`;
      const list = document.createElement("div");
      list.className = "subtitle-alternatives-list";
      for (const { file, priority } of orderedFiles.slice(1)) {
        const item = document.createElement("div");
        item.className = "subtitle-alternative";
        const meta = document.createElement("span");
        meta.className = "subtitle-alternative-meta";
        meta.textContent = priority.rank <= 4
          ? `${priority.rank}순위 · ${priority.reason}`
          : priority.reason;
        item.append(meta, createDownloadLink(file));
        list.appendChild(item);
      }
      alternatives.append(summary, list);
      fragment.appendChild(alternatives);
    }
    container.replaceChildren(fragment);
    loadKoVttOptions();
  }

  // Copy prompt button
  const btnCopyPrompt = document.getElementById("btn-copy-prompt");
  const promptText = document.getElementById("prompt-text");
  btnCopyPrompt.addEventListener("click", () => {
    navigator.clipboard.writeText(promptText.textContent);
    btnCopyPrompt.textContent = "복사 완료";
    setTimeout(() => { btnCopyPrompt.textContent = "복사하기"; }, 2000);
  });

  // ── 5. Step 2: Upload Korean VTT ──────────────────────────────
  const dropzone = document.getElementById("dropzone");
  const vttUploadInput = document.getElementById("vtt-upload-input");
  const uploadStatusMsg = document.getElementById("upload-status-msg");

  dropzone.addEventListener("click", () => vttUploadInput.click());
  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });
  vttUploadInput.addEventListener("change", e => {
    if (e.target.files.length) uploadFile(e.target.files[0]);
  });

  async function uploadFile(file) {
    if (!file.name.endsWith(".vtt")) {
      showUploadStatus("VTT (.vtt) 파일만 업로드 가능합니다.", "error");
      return;
    }

    setPill("badge-translate", "업로드 중...", "loading");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        showUploadStatus(`${data.name} 파일 업로드 성공`, "success");
        setPill("badge-translate", "업로드 완료", "done");
        setPill("badge-synth", "진행 가능", "done");
        await loadKoVttOptions();
        const selectKoVtt = document.getElementById("select-ko-vtt");
        selectKoVtt.value = data.path;
      } else {
        showUploadStatus(`업로드 실패: ${data.error}`, "error");
        setPill("badge-translate", "실패", "error");
      }
    } catch (err) {
      showUploadStatus(`네트워크 오류: ${err.message}`, "error");
      setPill("badge-translate", "실패", "error");
    }
  }

  function showUploadStatus(msg, type) {
    uploadStatusMsg.hidden = false;
    uploadStatusMsg.className = `upload-status ${type}`;
    uploadStatusMsg.textContent = msg;
  }

  // ── 6. Step 3: Synthesize TTS ─────────────────────────────────
  const selectKoVtt = document.getElementById("select-ko-vtt");
  const selectVoice = document.getElementById("select-voice");
  const selectRate = document.getElementById("select-rate");
  const btnSynth = document.getElementById("btn-synth");

  const btnPreviewVoice = document.getElementById("btn-preview-voice");
  const previewStatus = document.getElementById("voice-preview-status");
  let previewAudio = null;
  let previewAudioUrl = null;

  function setPreviewStatus(message, kind = "") {
    if (!previewStatus) return;
    previewStatus.hidden = !message;
    previewStatus.className = `voice-preview-status ${kind}`.trim();
    previewStatus.textContent = message || "";
  }

  function releasePreviewAudio() {
    if (previewAudio) previewAudio.pause();
    previewAudio = null;
    if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    previewAudioUrl = null;
  }

  if (btnPreviewVoice && selectVoice) {
    btnPreviewVoice.addEventListener("click", async () => {
      const voice = selectVoice.value;
      if (!voice) return;

      releasePreviewAudio();

      btnPreviewVoice.classList.add("playing");
      const btnSpan = btnPreviewVoice.querySelector("span");
      if (btnSpan) btnSpan.textContent = "생성/재생 중...";
      setPreviewStatus("", "");

      try {
        const selection = typeof window.lectureDubTtsSelection === "function"
          ? window.lectureDubTtsSelection()
          : { engine: "edge", modelId: "" };
        if (selection.engine !== "edge" && !selection.modelId) {
          throw new Error("로컬 TTS 모델을 선택해 주세요.");
        }

        const query = new URLSearchParams({
          voice,
          engine: selection.engine || "edge",
          t: String(Date.now()),
        });
        if (selection.engine !== "edge" && selection.modelId) query.set("model_id", selection.modelId);
        const response = await fetch(`/api/tts/preview?${query}`);
        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
            const data = await response.json();
            message = data.error || message;
          } catch { /* keep HTTP status */ }
          throw new Error(message);
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("미리듣기 오디오를 생성하지 못했습니다.");
        previewAudioUrl = URL.createObjectURL(blob);
        previewAudio = new Audio(previewAudioUrl);

        previewAudio.addEventListener("ended", () => {
          btnPreviewVoice.classList.remove("playing");
          if (btnSpan) btnSpan.textContent = "샘플 미리듣기";
          if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
          previewAudioUrl = null;
        });

        previewAudio.addEventListener("error", () => {
          btnPreviewVoice.classList.remove("playing");
          if (btnSpan) btnSpan.textContent = "샘플 미리듣기";
          setPreviewStatus("미리듣기 오디오를 재생하지 못했습니다.", "error");
        });

        await previewAudio.play();
      } catch (error) {
        releasePreviewAudio();
        btnPreviewVoice.classList.remove("playing");
        if (btnSpan) btnSpan.textContent = "샘플 미리듣기";
        setPreviewStatus(`미리듣기 실패: ${error.message}`, "error");
      }
    });
  }

  const workflowSettings = loadWorkflowSettings();
  if (workflowSettings.pipelineUrl && urlInput) urlInput.value = workflowSettings.pipelineUrl;
  if (workflowSettings.voice && selectVoice.querySelector(`option[value="${CSS.escape(workflowSettings.voice)}"]`)) {
    selectVoice.value = workflowSettings.voice;
  }
  if (workflowSettings.rate && selectRate.querySelector(`option[value="${CSS.escape(workflowSettings.rate)}"]`)) {
    selectRate.value = workflowSettings.rate;
  }
  const outputNameInput = document.getElementById("input-output-name");
  if (workflowSettings.outputName && outputNameInput) outputNameInput.value = workflowSettings.outputName;

  urlInput.addEventListener("input", () => saveWorkflowSettings({ pipelineUrl: urlInput.value }));
  selectVoice.addEventListener("change", () => saveWorkflowSettings({ voice: selectVoice.value }));
  selectRate.addEventListener("change", () => saveWorkflowSettings({ rate: selectRate.value }));
  if (outputNameInput) outputNameInput.addEventListener("input", () => saveWorkflowSettings({ outputName: outputNameInput.value }));
  selectKoVtt.addEventListener("change", () => saveWorkflowSettings({ koVtt: selectKoVtt.value }));

  const synthProgressWrap = document.getElementById("synth-progress-wrap");
  const synthProgressFill = document.getElementById("synth-progress-fill");
  const synthStageText = document.getElementById("synth-stage-text");
  const synthPercentText = document.getElementById("synth-percent-text");
  const synthBanner = document.getElementById("synth-complete-banner");
  const SYNTH_JOB_STORAGE_KEY = "lecture-dub-active-synthesis-job";
  let monitoredSynthJobId = "";
  let lastSynthMessage = "";

  async function loadKoVttOptions() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      selectKoVtt.innerHTML = "";

      const koVtts = (data.ko || []).filter(f => f.type === "vtt");
      if (!koVtts.length) {
        selectKoVtt.innerHTML = '<option value="">선택 가능한 VTT 파일 없음</option>';
        btnSynth.disabled = true;
        return;
      }

      for (const f of koVtts) {
        const opt = document.createElement("option");
        opt.value = f.path;
        opt.textContent = f.name;
        selectKoVtt.appendChild(opt);
      }
      const savedKoVtt = loadWorkflowSettings().koVtt;
      if (savedKoVtt && [...selectKoVtt.options].some(option => option.value === savedKoVtt)) {
        selectKoVtt.value = savedKoVtt;
      }
      btnSynth.disabled = false;
    } catch {
      btnSynth.disabled = true;
    }
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function renderSynthesisJob(job) {
    synthProgressWrap.hidden = false;
    synthProgressFill.style.width = `${job.percent || 0}%`;
    synthStageText.textContent = job.status === "complete" ? "완료" : (job.message || "합성 작업 확인 중...");
    synthPercentText.textContent = `${job.percent || 0}%`;

    if (job.message && job.message !== lastSynthMessage) {
      appendLog("log-synth", job.message, job.status === "error" ? "error" : "info");
      lastSynthMessage = job.message;
    }
  }

  async function monitorSynthesisJob(jobId) {
    if (!jobId || monitoredSynthJobId === jobId) return;
    monitoredSynthJobId = jobId;
    btnSynth.disabled = true;
    synthBanner.hidden = true;
    setPill("badge-synth", "합성 중...", "loading");

    try {
      while (localStorage.getItem(SYNTH_JOB_STORAGE_KEY) === jobId) {
        try {
          const response = await fetch(`/api/synthesize/${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const job = await response.json();
          if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);

          renderSynthesisJob(job);
          if (job.status === "complete") {
            synthProgressFill.style.width = "100%";
            synthPercentText.textContent = "100%";
            appendLog("log-synth", "한국어 음성 합성이 완료되었습니다.", "success");
            setPill("badge-synth", "완료", "done");
            synthBanner.hidden = false;
            window._lastSynthesizedWav = job.wav;
            localStorage.removeItem(SYNTH_JOB_STORAGE_KEY);
            break;
          }
          if (job.status === "error") {
            setPill("badge-synth", "실패", "error");
            localStorage.removeItem(SYNTH_JOB_STORAGE_KEY);
            break;
          }
        } catch (error) {
          appendLog("log-synth", `작업 상태를 다시 연결하는 중입니다: ${error.message}`, "error");
          setPill("badge-synth", "연결 재시도 중", "loading");
        }
        await wait(800);
      }
    } finally {
      monitoredSynthJobId = "";
      btnSynth.disabled = false;
    }
  }

  btnSynth.addEventListener("click", async () => {
    const vtt = selectKoVtt.value;
    if (!vtt) return;

    btnSynth.disabled = true;
    synthProgressWrap.hidden = false;
    synthBanner.hidden = true;
    clearLog("log-synth");
    lastSynthMessage = "";
    synthProgressFill.style.width = "0%";
    synthStageText.textContent = "TTS 생성 작업 준비 중...";
    synthPercentText.textContent = "0%";

    try {
      const response = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vtt,
          voice: selectVoice.value,
          rate: selectRate.value,
          output_name: document.getElementById("input-output-name")?.value.trim() || "",
        }),
      });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
      localStorage.setItem(SYNTH_JOB_STORAGE_KEY, job.id);
      await monitorSynthesisJob(job.id);
    } catch (err) {
      appendLog("log-synth", `합성 시작 실패: ${err.message}`, "error");
      setPill("badge-synth", "실패", "error");
      btnSynth.disabled = false;
    }
  });

  const savedSynthesisJobId = localStorage.getItem(SYNTH_JOB_STORAGE_KEY);
  if (savedSynthesisJobId) {
    clearLog("log-synth");
    appendLog("log-synth", "진행 중인 합성 작업 상태를 다시 연결합니다.", "info");
    monitorSynthesisJob(savedSynthesisJobId);
  }

  // Go to Player button
  document.getElementById("btn-go-player").addEventListener("click", () => {
    switchPage("player");
    // Pre-fill YouTube URL if entered in Step 1
    const pipelineUrl = urlInput.value.trim();
    const ytUrlInput = document.getElementById("youtube-url");
    if (pipelineUrl && ytUrlInput) {
      ytUrlInput.value = pipelineUrl;
      const loadBtn = document.getElementById("load-video");
      if (loadBtn) loadBtn.click();
    }
    // Auto-load last synthesized WAV into player if available
    if (window._lastSynthesizedWav) {
      loadServerWavIntoPlayer(window._lastSynthesizedWav.path);
    }
  });

  // ── 7. Server Quick Loader inside Player Page ─────────────────
  async function loadServerQuickLoader() {
    const container = document.getElementById("server-file-chips");
    if (!container) return;

    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      container.innerHTML = "";

      const wavs = (data.ko || []).filter(f => f.type === "wav");
      const vtts = [...(data.en || []).filter(f => f.type === "vtt"), ...(data.ko || []).filter(f => f.type === "vtt")];

      if (!wavs.length && !vtts.length) {
        container.innerHTML = '<span class="chip-loading">서버에 생성된 파일이 없습니다.</span>';
        return;
      }

      for (const f of wavs) {
        const btn = document.createElement("button");
        btn.className = "chip-btn";
        btn.type = "button";
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg><span>${f.name}</span>`;
        btn.addEventListener("click", () => loadServerWavIntoPlayer(f.path));
        container.appendChild(btn);
      }

      for (const f of vtts) {
        const lang = f.path.startsWith("en/") ? "en" : "ko";
        const btn = document.createElement("button");
        btn.className = "chip-btn";
        btn.type = "button";
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg><span>${f.name}</span>`;
        btn.addEventListener("click", () => loadServerVttIntoPlayer(f.path, lang));
        container.appendChild(btn);
      }
    } catch {
      container.innerHTML = '<span class="chip-loading">서버 파일 목록을 불러오지 못했습니다.</span>';
    }
  }

  async function loadServerWavIntoPlayer(path) {
    try {
      const res = await fetch(`/api/files/${path}`);
      const blob = await res.blob();
      const file = new File([blob], path.split("/").pop(), { type: "audio/wav" });
      const wavInput = document.getElementById("wav-file");
      if (wavInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        wavInput.files = dt.files;
        wavInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      savePlayerSetting("lastWavPath", path);
    } catch { /* silent */ }
  }

  async function loadServerVttIntoPlayer(path, lang) {
    try {
      const res = await fetch(`/api/files/${path}`);
      const blob = await res.blob();
      const file = new File([blob], path.split("/").pop(), { type: "text/vtt" });
      const inputId = lang === "en" ? "english-vtt" : "korean-vtt";
      const input = document.getElementById(inputId);
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      savePlayerSetting(lang === "en" ? "lastEnPath" : "lastKoPath", path);
    } catch { /* silent */ }
  }

  function savePlayerSetting(key, val) {
    try {
      const s = JSON.parse(localStorage.getItem("lecture-dub-player-settings") || "{}");
      s[key] = val;
      localStorage.setItem("lecture-dub-player-settings", JSON.stringify(s));
    } catch { /* silent */ }
  }

  function resetWorkflowInputs() {
    try {
      localStorage.removeItem(WORKFLOW_SETTINGS_KEY);
    } catch { /* silent */ }
    if (urlInput) urlInput.value = "";
    if (selectKoVtt) selectKoVtt.selectedIndex = 0;
    if (selectVoice) selectVoice.value = "ko-KR-SunHiNeural";
    if (selectRate) selectRate.value = "+5%";
    if (outputNameInput) outputNameInput.value = "";
    setPreviewStatus("", "");
  }

  window.addEventListener("lecture-dub-reset", resetWorkflowInputs);
  const floatingReset = document.getElementById("btn-floating-reset");
  if (floatingReset) {
    floatingReset.addEventListener("click", () => {
      window.dispatchEvent(new Event("lecture-dub-reset"));
    });
  }

  // ── 8. Files View & Card Folder Buttons (Explorer & Delete Actions)
  const btnRefreshFiles = document.getElementById("btn-refresh-files");
  if (btnRefreshFiles) btnRefreshFiles.addEventListener("click", loadFiles);

  const btnOpenExplorerAll = document.getElementById("btn-open-explorer-all");
  if (btnOpenExplorerAll) btnOpenExplorerAll.addEventListener("click", () => openExplorer());

  // Bind all elements with [data-open-folder] (both card buttons and section headers)
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-open-folder]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openExplorer("", btn.dataset.openFolder);
    }
  });

  async function openExplorer(path = "", lang = "") {
    try {
      await fetch("/api/files/open-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, lang }),
      });
    } catch {
      alert("탐색기를 열 수 없습니다.");
    }
  }

  async function deleteFile(path) {
    if (!confirm(`정말로 이 파일을 삭제하시겠습니까?\n${path}`)) return;
    try {
      const res = await fetch(`/api/files/${path}`, { method: "DELETE" });
      if (res.ok) {
        loadFiles();
        loadServerQuickLoader();
      } else {
        const data = await res.json();
        alert(`삭제 실패: ${data.error}`);
      }
    } catch (err) {
      alert(`삭제 에러: ${err.message}`);
    }
  }

  async function loadFiles() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();
      renderFileList("list-en-files", data.en || []);
      renderFileList("list-ko-files", data.ko || []);
    } catch {
      /* offline fallback */
    }
  }

  async function renameFile(path, oldName) {
    const parts = path.split("/");
    const lang = parts[0];
    const newName = prompt(`새 파일명을 입력해 주세요 (확장자 유지):`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    try {
      const res = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, old_name: oldName, new_name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        loadFiles();
        loadServerQuickLoader();
        loadKoVttOptions();
      } else {
        alert(`이름 변경 실패: ${data.error}`);
      }
    } catch (err) {
      alert(`이름 변경 에러: ${err.message}`);
    }
  }

  function renderFileList(containerId, files) {
    const container = document.getElementById(containerId);
    if (!files || !files.length) {
      container.innerHTML = '<div class="empty-state">파일이 없습니다.</div>';
      return;
    }
    container.innerHTML = "";
    for (const f of files) {
      const item = document.createElement("div");
      item.className = "file-item";

      const info = document.createElement("div");
      info.className = "file-item-info";
      info.innerHTML = `<span class="file-item-name">${f.name}</span><span class="file-item-size">${formatBytes(f.size)}</span>`;

      const actions = document.createElement("div");
      actions.className = "file-actions";

      // Explorer button (Folder icon)
      const btnExplorer = document.createElement("button");
      btnExplorer.className = "btn-icon";
      btnExplorer.type = "button";
      btnExplorer.title = "탐색기에서 보기";
      btnExplorer.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      btnExplorer.addEventListener("click", () => openExplorer(f.path));

      // Rename button (Pencil icon)
      const btnRename = document.createElement("button");
      btnRename.className = "btn-icon rename";
      btnRename.type = "button";
      btnRename.title = "이름 변경";
      btnRename.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      btnRename.addEventListener("click", () => renameFile(f.path, f.name));

      // Delete button (Trash icon)
      const btnDelete = document.createElement("button");
      btnDelete.className = "btn-icon delete";
      btnDelete.type = "button";
      btnDelete.title = "파일 삭제";
      btnDelete.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      btnDelete.addEventListener("click", () => deleteFile(f.path));

      actions.appendChild(btnExplorer);
      actions.appendChild(btnRename);
      actions.appendChild(btnDelete);

      item.appendChild(info);
      item.appendChild(actions);
      container.appendChild(item);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  // ── Init ───────────────────────────────────────────────────────
  loadKoVttOptions();
})();
