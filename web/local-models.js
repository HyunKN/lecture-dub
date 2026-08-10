/* local-models.js — optional local TTS model registry for the unified Web UI */
(function () {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const TTS_SELECTION_KEY = "lecture-dub-tts-selection";

  function loadSavedSelection() {
    try {
      return JSON.parse(localStorage.getItem(TTS_SELECTION_KEY) || "{}");
    } catch { return {}; }
  }

  const savedSelection = loadSavedSelection();
  const state = {
    payload: null,
    engine: savedSelection.engine || "edge",
    modelId: savedSelection.modelId || "",
    voice: savedSelection.voice || "",
  };

  const providerNames = {
    "qwen3-tts": "Qwen3-TTS",
    "supertonic-3": "Supertonic 3",
    "fish-s2-pro": "Fish Audio S2 Pro",
  };

  const edgeVoices = [
    ["ko-KR-SunHiNeural", "SunHi (여성 · 추천)"],
    ["ko-KR-InJoonNeural", "InJoon (남성)"],
    ["ko-KR-HyunsuMultilingualNeural", "Hyunsu (남성 · 다국어)"],
  ];

  function publishSelection() {
    const selection = { engine: state.engine, modelId: state.modelId, voice: state.voice };
    try {
      localStorage.setItem(TTS_SELECTION_KEY, JSON.stringify(selection));
    } catch { /* silent */ }
    window.lectureDubTtsSelection = () => ({ engine: state.engine, modelId: state.modelId });
    window.dispatchEvent(new CustomEvent("lecture-dub-tts-selection-change", { detail: selection }));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function style() {
    const tag = document.createElement("style");
    tag.textContent = `
      .local-model-panel { margin-bottom: 18px; padding: 16px; border: 1px solid var(--border-light, #ddd); border-radius: 12px; background: rgba(247,247,245,.72); }
      .local-model-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px; }
      .local-model-head h3 { margin:0 0 4px; font-size:14px; }
      .local-model-head p { margin:0; color:var(--text-secondary, #6b6d6c); font-size:12px; font-weight: 600; line-height:1.5; }
      .local-model-badge { flex:0 0 auto; padding:5px 9px; border:1px solid var(--border-light, #ddd); border-radius:999px; font-size:11px; font-weight:700; }
      .local-model-controls { display:grid; grid-template-columns:minmax(180px,.65fr) minmax(250px,1.35fr); gap:12px; }
      .local-model-field label { display:block; margin-bottom:7px; font-size:12px; font-weight:700; }
      .local-root-row { display:flex; gap:7px; }
      .local-root-row input, .local-model-field select { width:100%; height:42px; min-width:0; padding:0 12px; border:1px solid var(--border-light,#d8d8d5); border-radius:9px; background:#fff; font:inherit; font-size:12px;   font-weight: 600; }
      .local-root-row button { min-height:42px; padding:0 11px; border:1px solid var(--border-light,#d8d8d5); border-radius:9px; background:#fff; cursor:pointer; white-space:nowrap; font:inherit; font-size:11px; font-weight:750; }
      .local-model-select-row { display:grid; grid-template-columns:.8fr 1.2fr; gap:8px; }
      .local-model-status { margin-top:12px; border-top:1px solid var(--border-light,#ddd); padding-top:11px; }
      .local-model-summary { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; font-weight: 600; color:var(--text-secondary,#666); }
      .local-model-list { display:grid; gap:7px; margin-top:9px; }
      .local-model-item { display:grid; grid-template-columns:8px minmax(0,1fr); gap:9px; align-items:start; padding:9px 10px; border:1px solid var(--border-light,#dededb); border-radius:9px; background:rgba(255,255,255,.72); }
      .local-model-dot { width:8px; height:8px; margin-top:4px; border-radius:50%; background:#9a9d9b; }
      .local-model-item.ready .local-model-dot { background:#168443; }
      .local-model-item.pending .local-model-dot { background:#c17b0c; }
      .local-model-item strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
      .local-model-item span { display:block; margin-top:3px; color:var(--text-secondary,#717371); font-size:10px; font-weight: 600; line-height:1.45; }
      .local-runtime-help { margin-top:4px; font-family:ui-monospace,Consolas,monospace; color:#555 !important; }
      .local-model-error { margin-top:9px; padding:8px 10px; border-radius:8px; background:#fff0ee; color:#8a3026; font-size:11px; }
      .local-gpu-guide { display:grid; gap:4px; margin:0 0 12px; padding:10px 12px; border:1px solid var(--border-light,#dededb); border-radius:9px; background:rgba(255,255,255,.58); }
      .local-gpu-guide.ready { border-color:#168443; }
      .local-gpu-guide strong { font-size:12px; }
      .local-gpu-guide p { margin:0; font-size:11px; line-height:1.45; }
      .local-gpu-guide code { display:block; overflow:auto; margin-top:3px; padding:7px 8px; border-radius:6px; background:rgba(0,0,0,.06); font:10px/1.45 ui-monospace,Consolas,monospace; white-space:pre; }
      .local-gpu-guide[hidden], .local-gpu-guide code[hidden] { display:none !important; }
      #local-model-panel,
      #local-model-panel h3,
      #local-model-panel p,
      #local-model-panel label,
      #local-model-panel strong,
      #local-model-panel span,
      #local-model-panel input,
      #local-model-panel select,
      #local-model-panel button {
        color: #000000ff !important;
      }
      @media (max-width: 800px) { .local-model-controls { grid-template-columns:1fr; } .local-model-select-row { grid-template-columns:1fr; } .local-root-row { flex-wrap:wrap; } }
    `;
    document.head.appendChild(tag);
  }

  function installPanel() {
    const card = document.querySelector("#step-synth .card-body");
    if (!card || document.getElementById("local-model-panel")) return false;

    const panel = document.createElement("section");
    panel.id = "local-model-panel";
    panel.className = "local-model-panel";
    panel.innerHTML = `
      <div class="local-model-head">
        <div>
          <h3>TTS 엔진과 로컬 모델</h3>
          <p>Edge TTS는 그대로 사용할 수 있습니다. 로컬 모델 폴더를 등록하면 지원 모델을 자동으로 찾아 선택 항목에 추가합니다.</p>
        </div>
        <span class="local-model-badge" id="local-model-count">검색 중</span>
      </div>
      <div class="local-model-controls">
        <div class="local-model-field">
          <label for="local-engine-select">TTS 방식</label>
          <div class="local-model-select-row">
            <select id="local-engine-select"><option value="edge">Edge TTS · 온라인</option></select>
            <select id="local-model-select" disabled><option value="">로컬 모델을 선택하세요</option></select>
          </div>
        </div>
        <div class="local-model-field">
          <label for="local-model-root">로컬 모델 상위 폴더</label>
          <div class="local-root-row">
            <input id="local-model-root" type="text" placeholder="예: D:\\AI\\Models" autocomplete="off">
            <button id="local-root-save" type="button">적용</button>
            <button id="local-root-pick" type="button">폴더 선택</button>
            <button id="local-root-scan" type="button">다시 검색</button>
          </div>
        </div>
      </div>
      <div class="local-model-status">
        <div class="local-gpu-guide" id="local-gpu-guide" hidden>
          <strong id="local-gpu-title"></strong>
          <p id="local-gpu-message"></p>
          <code id="local-gpu-install" hidden></code>
        </div>
        <div class="local-model-summary">
          <span id="local-model-summary">모델 폴더를 확인하는 중입니다.</span>
          <span>모델 파일은 Lecture Dub 서버로 복사되지 않습니다.</span>
        </div>
        <div class="local-model-list" id="local-model-list"></div>
        <div class="local-model-error" id="local-model-error" hidden></div>
      </div>
    `;

    const formGrid = card.querySelector(".form-grid");
    card.insertBefore(panel, formGrid || card.firstChild);
    return true;
  }

  const $ = id => document.getElementById(id);

  function showError(message) {
    const box = $("local-model-error");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
  }

  function modelLabel(model) {
    const provider = providerNames[model.provider] || model.provider;
    const variant = model.variant ? ` · ${model.variant.replaceAll("_", " ")}` : "";
    return `${provider} · ${model.name}${variant}`;
  }

  function renderGpuGuide(acceleration) {
    const guide = $("local-gpu-guide");
    const title = $("local-gpu-title");
    const message = $("local-gpu-message");
    const install = $("local-gpu-install");
    if (!guide || !title || !message || !install) return;

    guide.hidden = false;
    guide.classList.toggle("ready", Boolean(acceleration.ready));
    if (!acceleration) {
      title.textContent = "합성 가속 상태 확인 대기 중";
      message.textContent = "서버를 다시 시작하면 GPU 또는 CPU 사용 상태를 확인해 안내합니다.";
      install.hidden = true;
      install.textContent = "";
      return;
    }
    if (acceleration.ready) {
      title.textContent = `GPU 가속 사용 가능 · ${acceleration.name}`;
      message.textContent = `${acceleration.provider}로 Supertonic 3 합성을 GPU에서 실행합니다.`;
      install.hidden = true;
      install.textContent = "";
      return;
    }

    if (acceleration.detected) {
      title.textContent = `CPU 합성 중 · ${acceleration.name}`;
      message.textContent = "GPU는 감지됐지만 가속 Runtime이 준비되지 않았습니다. 설치 후 서버를 다시 시작하면 GPU를 사용합니다.";
      install.hidden = false;
      install.textContent = acceleration.install || 'pip install -e ".[local-supertonic-gpu]"';
      return;
    }

    title.textContent = "CPU 합성 모드";
    message.textContent = "사용 가능한 GPU를 감지하지 못해 Supertonic 3을 CPU로 합성합니다.";
    install.hidden = true;
    install.textContent = "";
  }

  function renderModels(payload) {
    state.payload = payload;
    const rootInput = $("local-model-root");
    const engineSelect = $("local-engine-select");
    const modelSelect = $("local-model-select");
    const list = $("local-model-list");
    if (!rootInput || !engineSelect || !modelSelect || !list) return;

    rootInput.value = payload.root || "";
    renderGpuGuide(payload.acceleration);
    const models = Array.isArray(payload.models) ? payload.models : [];
    const ready = models.filter(model => model.ready);
    $("local-model-count").textContent = `${ready.length}개 사용 가능`;
    $("local-model-summary").textContent = models.length
      ? `${models.length}개 모델 폴더를 감지했고 ${ready.length}개를 바로 사용할 수 있습니다.`
      : "지원되는 로컬 TTS 모델을 아직 찾지 못했습니다. Edge TTS는 계속 사용할 수 있습니다.";

    const oldEngine = state.engine;
    engineSelect.innerHTML = '<option value="edge">Edge TTS · 온라인</option>';
    for (const provider of ["qwen3-tts", "supertonic-3", "fish-s2-pro"]) {
      const providerModels = models.filter(model => model.provider === provider);
      if (!providerModels.length) continue;
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = `${providerNames[provider]} · ${providerModels.filter(model => model.ready).length}/${providerModels.length} 사용 가능`;
      option.disabled = !providerModels.some(model => model.ready);
      engineSelect.appendChild(option);
    }
    engineSelect.value = [...engineSelect.options].some(option => option.value === oldEngine && !option.disabled) ? oldEngine : "edge";
    state.engine = engineSelect.value;

    list.innerHTML = "";
    for (const model of models) {
      const item = document.createElement("div");
      item.className = `local-model-item ${model.ready ? "ready" : "pending"}`;
      const runtime = payload.runtimes?.[model.provider];
      const reason = model.ready ? "모델 파일과 실행 런타임이 준비되었습니다." : (model.reason || "현재 사용할 수 없습니다.");
      item.innerHTML = `
        <span class="local-model-dot"></span>
        <div>
          <strong title="${escapeHtml(model.path)}">${escapeHtml(modelLabel(model))}</strong>
          <span>${escapeHtml(reason)}</span>
          ${!model.ready && runtime?.install ? `<span class="local-runtime-help">${escapeHtml(runtime.install)}</span>` : ""}
        </div>`;
      list.appendChild(item);
    }

    updateModelSelect();
  }

  function updateModelSelect() {
    const engine = $("local-engine-select").value;
    const modelSelect = $("local-model-select");
    state.engine = engine;
    modelSelect.innerHTML = "";

    if (engine === "edge") {
      modelSelect.disabled = true;
      modelSelect.innerHTML = '<option value="">로컬 모델 사용 안 함</option>';
      state.modelId = "";
      setVoiceOptions(null);
      return;
    }

    const models = (state.payload?.models || []).filter(model => model.provider === engine && model.ready);
    modelSelect.disabled = !models.length;
    if (!models.length) {
      modelSelect.innerHTML = '<option value="">사용 가능한 모델 없음</option>';
      state.modelId = "";
      setVoiceOptions(null);
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      modelSelect.appendChild(option);
    }
    if (models.some(model => model.id === state.modelId)) {
      modelSelect.value = state.modelId;
    }
    state.modelId = modelSelect.value;
    setVoiceOptions(models.find(model => model.id === state.modelId));
  }

  function setVoiceOptions(model) {
    const select = document.getElementById("select-voice");
    if (!select) return;
    const previous = state.voice || select.value;
    select.innerHTML = "";

    if (!model || state.engine === "edge") {
      for (const [value, label] of edgeVoices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = edgeVoices.some(([value]) => value === previous) ? previous : edgeVoices[0][0];
      state.voice = select.value;
      publishSelection();
      return;
    }

    const voices = model.voices?.length ? model.voices : ["Default"];
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice;
      if (model.provider === "qwen3-tts" && model.variant === "voice_design") {
        option.textContent = "자동 설계 · 한국어 강의자";
      } else if (model.provider === "fish-s2-pro") {
        option.textContent = "랜덤 음색 · Seed 42";
      } else {
        option.textContent = voice;
      }
      select.appendChild(option);
    }
    select.value = voices.includes(previous) ? previous : voices[0];
    state.voice = select.value;
    publishSelection();
  }

  async function refreshModels() {
    showError("");
    $("local-model-count").textContent = "검색 중";
    try {
      const response = await nativeFetch("/api/models", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      renderModels(data);
    } catch (error) {
      $("local-model-count").textContent = "검색 실패";
      showError(`로컬 모델 검색 실패: ${error.message}`);
    }
  }

  async function saveRoot() {
    showError("");
    const path = $("local-model-root").value.trim();
    try {
      const response = await nativeFetch("/api/models/root", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      renderModels(data);
    } catch (error) {
      showError(error.message);
    }
  }

  async function pickRoot() {
    showError("");
    const button = $("local-root-pick");
    button.disabled = true;
    button.textContent = "선택 중...";
    try {
      const response = await nativeFetch("/api/models/pick-root", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      renderModels(data);
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "폴더 선택";
    }
  }

  function patchFetch() {
    window.fetch = async function (input, init) {
      let url = typeof input === "string" ? input : input?.url || "";

      if (url.startsWith("/api/tts/preview")) {
        const parsed = new URL(url, location.origin);
        parsed.searchParams.set("engine", state.engine);
        if (state.engine !== "edge" && state.modelId) parsed.searchParams.set("model_id", state.modelId);
        url = `${parsed.pathname}${parsed.search}`;
        input = url;
      }

      if (url === "/api/synthesize" && init?.body && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          body.engine = state.engine;
          body.model_id = state.engine === "edge" ? "" : state.modelId;
          init = { ...init, body: JSON.stringify(body) };
        } catch { /* keep original request */ }
      }

      return nativeFetch(input, init);
    };
  }

  function bind() {
    $("local-engine-select").addEventListener("change", () => {
      state.modelId = "";
      updateModelSelect();
    });
    $("local-model-select").addEventListener("change", event => {
      state.modelId = event.target.value;
      const model = (state.payload?.models || []).find(item => item.id === state.modelId);
      setVoiceOptions(model);
    });
    document.getElementById("select-voice").addEventListener("change", event => {
      state.voice = event.target.value;
      publishSelection();
    });
    $("local-root-save").addEventListener("click", saveRoot);
    $("local-root-pick").addEventListener("click", pickRoot);
    $("local-root-scan").addEventListener("click", refreshModels);
    $("local-model-root").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveRoot();
      }
    });
  }

  function init() {
    style();
    if (!installPanel()) return;
    bind();
    patchFetch();
    refreshModels();
  }

  window.addEventListener("lecture-dub-reset", () => {
    try {
      localStorage.removeItem(TTS_SELECTION_KEY);
    } catch { /* silent */ }
    state.engine = "edge";
    state.modelId = "";
    state.voice = "";
    if (state.payload) renderModels(state.payload);
    else publishSelection();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
