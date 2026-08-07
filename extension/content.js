(() => {
  "use strict";

  const ROOT_ID = "lecture-dub-extension-root";
  if (document.getElementById(ROOT_ID)) return;

  const state = {
    video: null,
    audio: new Audio(),
    audioUrl: null,
    audioLoaded: false,
    enabled: false,
    syncEnabled: true,
    muteOriginal: true,
    previousMuted: null,
    offset: 0,
    enCues: [],
    koCues: [],
    videoKey: null,
  };

  state.audio.preload = "metadata";

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <button class="ld-launcher" type="button" aria-expanded="false">Lecture Dub</button>
    <aside class="ld-panel" hidden aria-label="Lecture Dub 더빙 패널">
      <header class="ld-header">
        <div>
          <strong>Lecture Dub</strong>
          <span>YouTube에서 한국어 더빙 듣기</span>
        </div>
        <button class="ld-close" type="button" aria-label="패널 닫기">×</button>
      </header>

      <p class="ld-privacy">선택한 WAV/VTT는 이 탭에서만 읽으며 업로드하지 않습니다.</p>

      <section class="ld-files" aria-label="더빙 파일 선택">
        <label class="ld-file">
          <span><b>한국어 더빙</b><em>필수</em></span>
          <small data-audio-name>WAV 파일을 선택하세요</small>
          <input data-audio-file type="file" accept="audio/wav,audio/*">
        </label>
        <label class="ld-file">
          <span><b>한국어 자막</b><em>선택</em></span>
          <small data-ko-name>VTT 파일을 선택하세요</small>
          <input data-ko-file type="file" accept=".vtt,text/vtt">
        </label>
        <label class="ld-file">
          <span><b>영어 자막</b><em>선택</em></span>
          <small data-en-name>VTT 파일을 선택하세요</small>
          <input data-en-file type="file" accept=".vtt,text/vtt">
        </label>
      </section>

      <section class="ld-actions" aria-label="더빙 제어">
        <button data-dub-toggle class="ld-primary" type="button" disabled>더빙 시작</button>
        <label class="ld-check"><input data-sync type="checkbox" checked> 자동 싱크</label>
        <label class="ld-check"><input data-mute type="checkbox" checked> 원음 음소거</label>
      </section>

      <section class="ld-volume" aria-label="더빙 음량">
        <div><span>더빙 음량</span><output data-volume-value>100%</output></div>
        <input data-volume type="range" min="0" max="100" value="100" step="1">
      </section>

      <section class="ld-offset" aria-label="싱크 보정">
        <div>
          <span>싱크 보정</span>
          <small>음성이 늦게 들리면 +</small>
        </div>
        <div class="ld-stepper">
          <button type="button" data-offset="-0.1">−0.1</button>
          <output data-offset-value>+0.0s</output>
          <button type="button" data-offset="0.1">+0.1</button>
          <button type="button" data-offset-reset>초기화</button>
        </div>
      </section>

      <section class="ld-captions" aria-live="polite">
        <div class="ld-caption ld-ko">
          <span>한국어</span>
          <p data-ko-caption>한국어 자막을 선택하면 현재 문장이 표시됩니다.</p>
        </div>
        <div class="ld-caption ld-en">
          <span>English</span>
          <p data-en-caption>영어 자막을 선택하면 원문이 함께 표시됩니다.</p>
        </div>
      </section>

      <footer class="ld-footer">
        <span data-clock>00:00</span>
        <span data-status>YouTube 영상을 찾는 중입니다.</span>
      </footer>
    </aside>
  `;
  document.documentElement.appendChild(root);

  const $ = (selector) => root.querySelector(selector);
  const ui = {
    launcher: $(".ld-launcher"),
    panel: $(".ld-panel"),
    close: $(".ld-close"),
    audioFile: $("[data-audio-file]"),
    koFile: $("[data-ko-file]"),
    enFile: $("[data-en-file]"),
    audioName: $("[data-audio-name]"),
    koName: $("[data-ko-name]"),
    enName: $("[data-en-name]"),
    dubToggle: $("[data-dub-toggle]"),
    sync: $("[data-sync]"),
    mute: $("[data-mute]"),
    volume: $("[data-volume]"),
    volumeValue: $("[data-volume-value]"),
    offsetValue: $("[data-offset-value]"),
    koCaption: $("[data-ko-caption]"),
    enCaption: $("[data-en-caption]"),
    clock: $("[data-clock]"),
    status: $("[data-status]"),
  };

  function setStatus(message, error = false) {
    ui.status.textContent = message;
    ui.status.classList.toggle("is-error", error);
  }

  function setPanelOpen(open) {
    ui.panel.hidden = !open;
    ui.launcher.setAttribute("aria-expanded", String(open));
  }

  function currentVideoKey() {
    const url = new URL(location.href);
    return url.searchParams.get("v") || `${url.pathname}${url.search}`;
  }

  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function parseTimestamp(value) {
    const parts = value.trim().replace(",", ".").split(":");
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    return [hours, minutes, seconds].every(Number.isFinite)
      ? hours * 3600 + minutes * 60 + seconds
      : NaN;
  }

  function cleanCueText(lines) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = lines
      .join("\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    return decoder.value.trim();
  }

  function parseVtt(content) {
    const cues = [];
    const blocks = content
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/);

    for (const block of blocks) {
      const lines = block.split("\n");
      const first = (lines[0] || "").trim();
      if (!first || first === "WEBVTT" || /^(NOTE|STYLE|REGION)(\s|$)/.test(first)) continue;

      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;

      const [startRaw, endPart] = lines[timingIndex].split("-->");
      const start = parseTimestamp(startRaw);
      const end = parseTimestamp(endPart.trim().split(/\s+/)[0]);
      const text = cleanCueText(lines.slice(timingIndex + 1));

      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) {
        cues.push({ start, end, text });
      }
    }

    return cues.sort((a, b) => a.start - b.start);
  }

  function activeCue(cues, time) {
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const cue = cues[mid];
      if (time < cue.start) high = mid - 1;
      else if (time > cue.end) low = mid + 1;
      else return cue;
    }
    return null;
  }

  function desiredAudioTime() {
    if (!state.video) return 0;
    let target = Math.max(0, state.video.currentTime + state.offset);
    if (Number.isFinite(state.audio.duration)) {
      target = Math.min(target, state.audio.duration);
    }
    return target;
  }

  function syncAudio(force = false) {
    if (!state.enabled || !state.syncEnabled || !state.video || !state.audioLoaded) return;
    const target = desiredAudioTime();
    state.audio.playbackRate = state.video.playbackRate || 1;
    if (force || Math.abs(state.audio.currentTime - target) > 0.25) {
      state.audio.currentTime = target;
    }
  }

  async function startAudioForVideo() {
    if (!state.enabled || !state.video || !state.audioLoaded) return;
    syncAudio(true);
    if (!state.video.paused && !state.video.ended) {
      try {
        await state.audio.play();
      } catch (error) {
        setStatus(`더빙 재생을 시작하지 못했습니다: ${error.message}`, true);
      }
    }
  }

  function applyOriginalAudioPreference() {
    if (!state.video || !state.enabled) return;
    state.video.muted = state.muteOriginal ? true : Boolean(state.previousMuted);
  }

  function restoreOriginalAudio() {
    if (state.video && state.previousMuted !== null) {
      state.video.muted = state.previousMuted;
    }
    state.previousMuted = null;
  }

  function setDubEnabled(enabled) {
    state.enabled = enabled;
    ui.dubToggle.textContent = enabled ? "더빙 끄기" : "더빙 시작";
    ui.dubToggle.classList.toggle("is-active", enabled);

    if (!enabled) {
      state.audio.pause();
      restoreOriginalAudio();
      setStatus("더빙을 껐습니다.");
      return;
    }

    if (!state.video) {
      state.enabled = false;
      ui.dubToggle.textContent = "더빙 시작";
      setStatus("YouTube 영상 플레이어를 찾지 못했습니다.", true);
      return;
    }

    if (state.previousMuted === null) state.previousMuted = state.video.muted;
    applyOriginalAudioPreference();
    syncAudio(true);

    if (state.video.paused) {
      const wasMuted = state.audio.muted;
      state.audio.muted = true;
      state.audio.play()
        .then(() => {
          state.audio.pause();
          state.audio.muted = wasMuted;
          syncAudio(true);
          setStatus("더빙 준비 완료. YouTube에서 재생하면 함께 시작합니다.");
        })
        .catch(() => {
          state.audio.muted = wasMuted;
          setStatus("더빙 준비 완료. YouTube 재생 후 다시 시도해 주세요.");
        });
    } else {
      startAudioForVideo();
      setStatus("한국어 더빙을 YouTube 영상에 맞춰 재생합니다.");
    }
  }

  const videoHandlers = {
    play: () => startAudioForVideo(),
    pause: () => state.audio.pause(),
    seeking: () => syncAudio(true),
    seeked: () => syncAudio(true),
    ratechange: () => {
      if (state.video) state.audio.playbackRate = state.video.playbackRate || 1;
    },
    ended: () => state.audio.pause(),
  };

  function detachVideo() {
    if (!state.video) return;
    for (const [event, handler] of Object.entries(videoHandlers)) {
      state.video.removeEventListener(event, handler);
    }
  }

  function attachVideo(video) {
    if (!video || state.video === video) return;
    detachVideo();
    state.video = video;
    for (const [event, handler] of Object.entries(videoHandlers)) {
      video.addEventListener(event, handler);
    }
    state.audio.playbackRate = video.playbackRate || 1;
    setStatus(state.audioLoaded ? "더빙 파일이 준비됐습니다." : "한국어 더빙 WAV를 선택하세요.");
  }

  function handleNavigation() {
    const nextKey = currentVideoKey();
    const changed = state.videoKey !== null && nextKey !== state.videoKey;
    state.videoKey = nextKey;

    if (changed && state.enabled) {
      setDubEnabled(false);
      setStatus("새 영상으로 이동했습니다. 더빙 파일이 맞는지 확인한 뒤 다시 시작하세요.");
    }

    const nextVideo = findVideo();
    if (nextVideo) attachVideo(nextVideo);
  }

  async function loadVttFile(file, language) {
    if (!file) return;
    try {
      const cues = parseVtt(await file.text());
      if (!cues.length) throw new Error("읽을 수 있는 자막 구간이 없습니다.");
      if (language === "ko") {
        state.koCues = cues;
        ui.koName.textContent = `${file.name} · ${cues.length}개`;
      } else {
        state.enCues = cues;
        ui.enName.textContent = `${file.name} · ${cues.length}개`;
      }
      setStatus(`${file.name}을 불러왔습니다.`);
    } catch (error) {
      setStatus(`${file.name}을 읽지 못했습니다: ${error.message}`, true);
    }
  }

  ui.launcher.addEventListener("click", () => setPanelOpen(ui.panel.hidden));
  ui.close.addEventListener("click", () => setPanelOpen(false));

  ui.audioFile.addEventListener("change", () => {
    const file = ui.audioFile.files?.[0];
    if (!file) return;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audio.pause();
    state.audioLoaded = false;
    state.audioUrl = URL.createObjectURL(file);
    state.audio.src = state.audioUrl;
    state.audio.load();
    ui.audioName.textContent = `${file.name} · 읽는 중`;
    ui.dubToggle.disabled = true;
    setStatus("더빙 파일을 읽는 중입니다.");
  });

  state.audio.addEventListener("loadedmetadata", () => {
    state.audioLoaded = true;
    ui.audioName.textContent = `${ui.audioFile.files?.[0]?.name || "더빙 파일"} · ${formatTime(state.audio.duration)}`;
    ui.dubToggle.disabled = false;
    setStatus("더빙 파일 준비 완료. '더빙 시작'을 누르세요.");
  });

  state.audio.addEventListener("error", () => {
    state.audioLoaded = false;
    ui.dubToggle.disabled = true;
    setStatus("오디오 파일을 읽지 못했습니다. WAV 파일을 확인하세요.", true);
  });

  ui.koFile.addEventListener("change", () => loadVttFile(ui.koFile.files?.[0], "ko"));
  ui.enFile.addEventListener("change", () => loadVttFile(ui.enFile.files?.[0], "en"));

  ui.dubToggle.addEventListener("click", () => setDubEnabled(!state.enabled));
  ui.sync.addEventListener("change", () => {
    state.syncEnabled = ui.sync.checked;
    if (state.syncEnabled) syncAudio(true);
    setStatus(`자동 싱크를 ${state.syncEnabled ? "켰습니다" : "껐습니다"}.`);
  });

  ui.mute.addEventListener("change", () => {
    state.muteOriginal = ui.mute.checked;
    applyOriginalAudioPreference();
    setStatus(`YouTube 원음을 ${state.muteOriginal ? "음소거합니다" : "기존 상태로 둡니다"}.`);
  });

  ui.volume.addEventListener("input", () => {
    const value = Number(ui.volume.value) / 100;
    state.audio.volume = value;
    ui.volumeValue.textContent = `${ui.volume.value}%`;
  });

  root.querySelectorAll("[data-offset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.offset = Math.round((state.offset + Number(button.dataset.offset)) * 10) / 10;
      ui.offsetValue.textContent = `${state.offset >= 0 ? "+" : ""}${state.offset.toFixed(1)}s`;
      syncAudio(true);
    });
  });

  $("[data-offset-reset]").addEventListener("click", () => {
    state.offset = 0;
    ui.offsetValue.textContent = "+0.0s";
    syncAudio(true);
  });

  document.addEventListener("yt-navigate-finish", handleNavigation);
  window.addEventListener("beforeunload", () => {
    state.audio.pause();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    detachVideo();
  });

  const observer = new MutationObserver(() => {
    if (!state.video || !state.video.isConnected) {
      const nextVideo = findVideo();
      if (nextVideo) attachVideo(nextVideo);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    const video = state.video && state.video.isConnected ? state.video : findVideo();
    if (video && state.video !== video) attachVideo(video);
    if (!video) return;

    if (state.enabled && state.syncEnabled) {
      syncAudio(false);
      if (video.paused && !state.audio.paused) state.audio.pause();
    }

    const time = video.currentTime || 0;
    const ko = activeCue(state.koCues, time);
    const en = activeCue(state.enCues, time);
    ui.clock.textContent = formatTime(time);
    ui.koCaption.textContent = ko?.text || (state.koCues.length ? "현재 구간에 한국어 자막이 없습니다." : "한국어 자막을 선택하면 현재 문장이 표시됩니다.");
    ui.enCaption.textContent = en?.text || (state.enCues.length ? "현재 구간에 영어 자막이 없습니다." : "영어 자막을 선택하면 원문이 함께 표시됩니다.");
  }, 200);

  state.videoKey = currentVideoKey();
  handleNavigation();
})();
