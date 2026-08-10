const $ = selector => document.querySelector(selector);
const audio = $("#dub-audio");
const statusEl = $("#status");
const alertEl = $("#alert");
const el = {
  url: $("#youtube-url"), load: $("#load-video"), wav: $("#wav-file"), enFile: $("#english-vtt"), koFile: $("#korean-vtt"),
  cta: $("#sync-play"), play: $("#play-toggle"), sync: $("#sync-enabled"), mute: $("#mute-youtube"),
  offsetValue: $("#offset-value"), en: $("#english-subtitle"), ko: $("#korean-subtitle"), time: $("#cue-time"),
  cueCount: $("#cue-count"), clock: $("#clock"), progress: $("#progress"), progressFill: $("#progress span"),
  summary: $("#readiness-summary"), warning: $("#setup-warning"), videoState: $("#video-state"), wavState: $("#wav-state"),
  enState: $("#en-state"), koState: $("#ko-state"), wavName: $("#wav-name"), enName: $("#en-name"), koName: $("#ko-name"),
  wavMeta: $("#wav-meta"), enMeta: $("#en-meta"), koMeta: $("#ko-meta")
};

let player, playerReady = false, enCues = [], koCues = [], audioUrl = null, internalSeek = false, audioOffset = 0;
const assets = { video: false, wav: false, en: false, ko: false };
const yt = () => window.YT;
const state = () => playerReady ? player.getPlayerState() : -1;
const videoTime = () => playerReady ? (player.getCurrentTime() || 0) : 0;
const offset = () => audioOffset;
const setStatus = message => { statusEl.textContent = message; setAlert(""); };
const setAlert = message => { alertEl.hidden = !message; alertEl.textContent = message || ""; };
const setButtonLabel = (button, text) => {
  const content = button.querySelector(":scope > .liquid-glass-content");
  (content || button).textContent = text;
};


function setAssetState(name, text, kind = "") {
  const target = el[`${name}State`];
  target.textContent = text;
  target.className = `state ${kind}`.trim();
}

function updateReadiness() {
  const count = Object.values(assets).filter(Boolean).length;
  const canPlay = assets.video && assets.wav;
  el.summary.classList.toggle("complete", count === 4);
  el.summary.innerHTML = `<span></span>${count === 4 ? "재생 준비 완료" : "준비 자산"} ${count} / 4`;
  el.cta.disabled = !canPlay;
  setButtonLabel(el.cta, canPlay ? "동기화 재생" : "Video와 WAV 필요");
  const missing = [];
  if (!assets.en) missing.push("English VTT");
  if (!assets.ko) missing.push("Korean VTT");
  setAlert(canPlay && missing.length ? `${missing.join(" · ")}가 없습니다. 자막 없이 재생되며, 나중에 추가할 수 있습니다.` : "");
}

function videoId(value) {
  const text = value.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text), parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "youtu.be") return parts[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || null;
    }
  } catch { return null; }
  return null;
}

function timestamp(value) {
  const parts = value.trim().replace(",", ".").split(":"), seconds = Number(parts.pop()), minutes = Number(parts.pop()), hours = parts.length ? Number(parts.pop()) : 0;
  return [hours, minutes, seconds].every(Number.isFinite) ? hours * 3600 + minutes * 60 + seconds : NaN;
}

function cueText(lines) {
  const box = document.createElement("textarea");
  box.innerHTML = lines.join("\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return box.value.trim();
}

function parseVtt(text) {
  const cues = [];
  for (const block of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n"), first = (lines[0] || "").trim();
    if (!first || first === "WEBVTT" || /^(NOTE|STYLE|REGION)(\s|$)/.test(first)) continue;
    const index = lines.findIndex(line => line.includes("-->"));
    if (index < 0) continue;
    const times = lines[index].split("-->"), start = timestamp(times[0]), end = timestamp(times[1].trim().split(/\s+/)[0]), textValue = cueText(lines.slice(index + 1));
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && textValue) cues.push({ start, end, text: textValue });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function activeCue(cues, time) {
  let low = 0, high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1, cue = cues[mid];
    if (time < cue.start) high = mid - 1;
    else if (time > cue.end) low = mid + 1;
    else return { cue, index: mid };
  }
  return null;
}

function format(seconds) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), secs = value % 60;
  return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function renderOffset() {
  const normalized = Math.abs(audioOffset) < .01 ? 0 : audioOffset;
  audioOffset = normalized;
  el.offsetValue.textContent = `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}s`;
}

function muteOriginal() { if (playerReady) el.mute.getAttribute("aria-pressed") === "true" ? player.mute() : player.unMute(); }

function syncAudio(force = false) {
  if (!playerReady || el.sync.getAttribute("aria-pressed") !== "true" || !audio.src) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
  const target = Math.min(Math.max(0, videoTime() + offset()), duration);
  if (force || Math.abs(target - audio.currentTime) > .35) { internalSeek = true; audio.currentTime = target; }
}

function setPlaying(playing) {
  setButtonLabel(el.play, playing ? "Ⅱ" : "▶");
  el.play.setAttribute("aria-label", playing ? "일시정지" : "재생");
  el.play.setAttribute("aria-pressed", String(playing));
}

function setCueText(target, text) {
  if (target.textContent !== text) target.textContent = text;
}

function frame() {
  const current = videoTime(), yState = state(), playing = Boolean(yt()?.PlayerState && yState === yt().PlayerState.PLAYING);
  if (el.sync.getAttribute("aria-pressed") === "true" && audio.src) {
    if (playing) { syncAudio(); if (audio.paused) audio.play().catch(() => {}); }
    else if (!audio.paused) audio.pause();
  }
  const ko = activeCue(koCues, current), en = activeCue(enCues, current), duration = playerReady ? player.getDuration() : 0;
  setCueText(el.ko, ko?.cue.text || (assets.ko ? "현재 구간에 한국어 자막이 없습니다." : "한국어 VTT 파일을 선택하세요."));
  setCueText(el.en, en?.cue.text || (assets.en ? "현재 구간에 영어 자막이 없습니다." : "영어 VTT 파일을 선택하세요."));
  el.time.textContent = ko ? `${format(ko.cue.start)} — ${format(ko.cue.end)}` : "";
  el.cueCount.textContent = ko ? `CUE ${ko.index + 1} / ${koCues.length}` : (en ? `CUE ${en.index + 1} / ${enCues.length}` : "CUE —");
  el.clock.textContent = `${format(current)} / ${format(duration)} · ${playing ? "재생 중" : yState === 2 ? "일시정지" : "대기 중"}`;
  const percent = duration ? Math.min(100, current / duration * 100) : 0;
  el.progress.setAttribute("aria-valuenow", String(Math.round(percent)));
  el.progress.setAttribute("aria-label", `재생 진행률 ${Math.round(percent)}%`);
  el.progressFill.style.width = `${percent}%`;
  setPlaying(playing);
  requestAnimationFrame(frame);
}

let lastSubtitleDoubleClick = { target: null, text: "", time: 0 };

function selectRange(selection, node, start = 0, end = node.textContent.length) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectWordAtPoint(cue, selection, x, y) {
  const caret = document.caretPositionFromPoint?.(x, y);
  const legacyCaret = caret ? null : document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || legacyCaret?.startContainer;
  let offset = caret?.offset ?? legacyCaret?.startOffset;
  if (!node || node.nodeType !== Node.TEXT_NODE || !cue.contains(node)) return "";

  const text = node.textContent;
  const isWordCharacter = character => /[\p{L}\p{N}_'-]/u.test(character || "");
  if (!isWordCharacter(text[offset]) && offset > 0 && isWordCharacter(text[offset - 1])) offset -= 1;
  if (!isWordCharacter(text[offset])) return "";

  let start = offset, end = offset + 1;
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isWordCharacter(text[end])) end += 1;
  selectRange(selection, node, start, end);
  return text.slice(start, end);
}

document.querySelectorAll(".cue-block p").forEach(cue => {
  cue.addEventListener("dblclick", event => {
    const selection = window.getSelection();
    if (!selection) return;
    let selectedText = selection.toString().trim();
    if (!selectedText || !cue.contains(selection.anchorNode) || !cue.contains(selection.focusNode)) {
      selectedText = selectWordAtPoint(cue, selection, event.clientX, event.clientY);
    }
    const now = performance.now();
    const shouldExpand = lastSubtitleDoubleClick.target === cue
      && lastSubtitleDoubleClick.text === selectedText
      && now - lastSubtitleDoubleClick.time < 2500;

    if (shouldExpand) {
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(cue);
      selection.removeAllRanges();
      selection.addRange(range);
      lastSubtitleDoubleClick = { target: null, text: "", time: 0 };
      return;
    }

    lastSubtitleDoubleClick = { target: cue, text: selectedText, time: now };
  });
});

async function playTogether() {
  if (!assets.video || !assets.wav) return setAlert("Video와 Korean WAV를 먼저 준비해 주세요.");
  if (!playerReady) return setStatus("YouTube 플레이어가 준비되는 중입니다.");
  syncAudio(true); player.playVideo();
  try { await audio.play(); setStatus("YouTube 기준으로 한국어 더빙을 동기화해 재생 중입니다."); }
  catch (error) { setAlert(`오디오 재생을 시작하지 못했습니다: ${error.message}`); }
}

function pauseTogether() { if (playerReady) player.pauseVideo(); audio.pause(); setStatus("재생을 일시정지했습니다."); }

function loadAudio(file) {
  if (!file) return;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  assets.wav = false; setAssetState("wav", "읽는 중", "loading"); el.wavName.textContent = file.name; el.wavMeta.textContent = "로컬 파일 · duration 읽는 중"; updateReadiness();
  audioUrl = URL.createObjectURL(file); audio.src = audioUrl; audio.load();
}

async function loadVtt(file, language) {
  if (!file) return;
  const key = language === "en" ? "en" : "ko";
  try {
    assets[key] = false; setAssetState(key, "읽는 중", "loading"); updateReadiness();
    const cues = parseVtt(await file.text());
    if (!cues.length) throw new Error("읽을 수 있는 자막 구간이 없습니다.");
    if (key === "en") { enCues = cues; el.enName.textContent = file.name; el.enMeta.textContent = `${cues.length} cues · reference`; }
    else { koCues = cues; el.koName.textContent = file.name; el.koMeta.textContent = `${cues.length} cues · primary`; }
    assets[key] = true; setAssetState(key, "준비됨", "ready"); updateReadiness(); setStatus(`${file.name}의 자막 ${cues.length}개를 불러왔습니다.`);
  } catch (error) { assets[key] = false; setAssetState(key, "읽기 실패", "error"); updateReadiness(); setAlert(`${file.name}을 읽지 못했습니다: ${error.message}`); }
}

function clearYoutubePlayer() {
  if (player) {
    try { if (player.destroy) player.destroy(); } catch { /* silent */ }
    player = null;
  }
  playerReady = false;
  assets.video = false;
  setAssetState("video", "확인 필요", "");

  const container = document.getElementById("youtube-player");
  if (container) {
    container.innerHTML = `
      <div class="empty-video-placeholder">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>
        <p>YouTube URL을 입력한 뒤 <strong>[확인]</strong>을 눌러주세요.</p>
      </div>
    `;
  }
  updateReadiness();
}

function initYoutubePlayer(id) {
  const container = document.getElementById("youtube-player");
  if (!container) return;

  if (player) {
    try { if (player.destroy) player.destroy(); } catch { /* silent */ }
    player = null;
  }
  playerReady = false;
  container.innerHTML = '<div id="yt-player-target"></div>';

  player = new YT.Player("yt-player-target", {
    videoId: id,
    playerVars: { controls: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        assets.video = true;
        setAssetState("video", "준비됨", "ready");
        muteOriginal();
        updateReadiness();
        setStatus("YouTube 영상이 준비됐습니다.");
      },
      onStateChange: event => {
        if (event.data === YT.PlayerState.PLAYING && audio.src) {
          syncAudio(true);
          audio.play().catch(() => {});
        } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
          audio.pause();
        }
      },
      onError: () => {
        assets.video = false;
        setAssetState("video", "재생 불가", "error");
        updateReadiness();
        setAlert("YouTube 영상을 재생할 수 없습니다. URL을 확인해 주세요.");
      }
    }
  });
}

function loadVideo() {
  const url = el.url.value.trim();
  const id = videoId(url);
  if (!id) {
    setAlert("올바른 YouTube URL 또는 11자리 영상 ID를 입력해 주세요.");
    clearYoutubePlayer();
    return;
  }
  pauseTogether();
  if (playerReady && player && player.loadVideoById) {
    player.loadVideoById(id);
    assets.video = true;
    setAssetState("video", "준비됨", "ready");
    muteOriginal();
    updateReadiness();
    setStatus("YouTube 영상을 확인했습니다.");
  } else {
    initYoutubePlayer(id);
  }
}

window.onYouTubeIframeAPIReady = () => {
  const id = videoId(el.url.value);
  if (id) {
    initYoutubePlayer(id);
  } else {
    clearYoutubePlayer();
  }
};

const PLAYER_SETTINGS_KEY = "lecture-dub-player-settings";

function savePlayerState(key, value) {
  try {
    const s = JSON.parse(localStorage.getItem(PLAYER_SETTINGS_KEY) || "{}");
    s[key] = value;
    localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(s));
  } catch { /* silent */ }
}

function loadPlayerState() {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_SETTINGS_KEY) || "{}");
  } catch { return {}; }
}

function updateToggleStatuses() {
  const syncOn = el.sync.getAttribute("aria-pressed") === "true";
  const muteOn = el.mute.getAttribute("aria-pressed") === "true";
  const syncBadge = $("#sync-status-badge");
  const muteBadge = $("#mute-status-badge");

  const zapIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const pauseIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const muteIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
  const volIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;

  if (syncBadge) {
    syncBadge.innerHTML = syncOn ? `${zapIcon}<span>켬 (자동 Sync)</span>` : `${pauseIcon}<span>끔 (Sync 해제)</span>`;
    syncBadge.className = `badge-value ${syncOn ? "active" : "disabled"}`;
  }
  if (muteBadge) {
    muteBadge.innerHTML = muteOn ? `${muteIcon}<span>음소거 중</span>` : `${volIcon}<span>원음 재생 중</span>`;
    muteBadge.className = `badge-value ${muteOn ? "active" : "disabled"}`;
  }
}

el.load.addEventListener("click", () => { savePlayerState("ytUrl", el.url.value.trim()); loadVideo(); });
el.url.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); savePlayerState("ytUrl", el.url.value.trim()); loadVideo(); } });
el.url.addEventListener("change", () => savePlayerState("ytUrl", el.url.value.trim()));
el.wav.addEventListener("change", event => loadAudio(event.target.files[0]));
el.enFile.addEventListener("change", event => loadVtt(event.target.files[0], "en"));
el.koFile.addEventListener("change", event => loadVtt(event.target.files[0], "ko"));
el.cta.addEventListener("click", playTogether);
el.play.addEventListener("click", () => state() === (yt()?.PlayerState.PLAYING) ? pauseTogether() : playTogether());
el.sync.addEventListener("click", () => {
  const pressed = el.sync.getAttribute("aria-pressed") !== "true";
  el.sync.setAttribute("aria-pressed", String(pressed));
  setButtonLabel(el.sync, `자동 sync ${pressed ? "켬" : "끔"}`);
  if (pressed) syncAudio(true);
  updateToggleStatuses();
  setStatus(`자동 sync를 ${pressed ? "켰습니다" : "껐습니다"}.`);
  savePlayerState("syncEnabled", pressed);
});
el.mute.addEventListener("click", () => {
  const pressed = el.mute.getAttribute("aria-pressed") !== "true";
  el.mute.setAttribute("aria-pressed", String(pressed));
  setButtonLabel(el.mute, `원음 ${pressed ? "음소거" : "재생"}`);
  muteOriginal();
  updateToggleStatuses();
  setStatus(`YouTube 원음을 ${pressed ? "음소거했습니다" : "재생합니다"}.`);
  savePlayerState("muteYoutube", pressed);
});
document.querySelectorAll("[data-offset]").forEach(button => button.addEventListener("click", () => {
  audioOffset = Math.round((audioOffset + Number(button.dataset.offset)) * 10) / 10;
  renderOffset(); syncAudio(true); setStatus(`더빙 타이밍을 ${el.offsetValue.textContent}로 조정했습니다.`);
  savePlayerState("audioOffset", audioOffset);
}));
$("#reset-offset").addEventListener("click", () => {
  audioOffset = 0; renderOffset(); syncAudio(true); setStatus("더빙 타이밍을 초기화했습니다.");
  savePlayerState("audioOffset", 0);
});
audio.addEventListener("loadedmetadata", () => { assets.wav = true; setAssetState("wav", "준비됨", "ready"); el.wavMeta.textContent = `${format(audio.duration)} · 로컬 파일`; updateReadiness(); setStatus("Korean WAV를 준비했습니다."); });
audio.addEventListener("error", () => { assets.wav = false; setAssetState("wav", "읽기 실패", "error"); updateReadiness(); setAlert("Korean WAV를 읽지 못했습니다. 지원되는 오디오 파일인지 확인해 주세요."); });
audio.addEventListener("seeked", () => { if (internalSeek) { internalSeek = false; return; } if (playerReady && el.sync.getAttribute("aria-pressed") === "true") player.seekTo(Math.max(0, audio.currentTime - offset()), true); });
audio.addEventListener("play", () => { if (playerReady && el.sync.getAttribute("aria-pressed") === "true" && state() !== yt()?.PlayerState.PLAYING) player.playVideo(); });
audio.addEventListener("pause", () => { if (playerReady && el.sync.getAttribute("aria-pressed") === "true" && state() === yt()?.PlayerState.PLAYING) player.pauseVideo(); });

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-open-folder]");
  if (btn && typeof openExplorer === "undefined") {
    e.preventDefault();
    fetch("/api/files/open-explorer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: btn.dataset.openFolder }),
    }).catch(() => {});
  }
});

// Drag & Drop support for player cards
["asset-wav", "asset-en", "asset-ko"].forEach(id => {
  const card = document.getElementById(id);
  if (!card) return;
  card.addEventListener("dragover", e => { e.preventDefault(); card.classList.add("drag-over"); });
  card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
  card.addEventListener("drop", e => {
    e.preventDefault();
    card.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (id === "asset-wav") loadAudio(file);
    else if (id === "asset-en") loadVtt(file, "en");
    else if (id === "asset-ko") loadVtt(file, "ko");
  });
});

// Dubbing volume slider control
const volSlider = $("#dub-volume");
const volReadout = $("#volume-readout");
if (volSlider) {
  volSlider.addEventListener("input", e => {
    const val = Number(e.target.value);
    audio.volume = val / 100;
    if (volReadout) volReadout.textContent = `${val}%`;
    savePlayerState("dubVolume", val);
  });
}

// Restore Player Settings on Init
(function restoreInitState() {
  const s = loadPlayerState();
  if (s.ytUrl && el.url && !el.url.value) {
    el.url.value = s.ytUrl;
  }
  if (typeof s.syncEnabled === "boolean") {
    el.sync.setAttribute("aria-pressed", String(s.syncEnabled));
    setButtonLabel(el.sync, `자동 sync ${s.syncEnabled ? "켬" : "끔"}`);
  }
  if (typeof s.muteYoutube === "boolean") {
    el.mute.setAttribute("aria-pressed", String(s.muteYoutube));
    setButtonLabel(el.mute, `원음 ${s.muteYoutube ? "음소거" : "재생"}`);
  }
  if (typeof s.audioOffset === "number") {
    audioOffset = s.audioOffset;
  }
  if (typeof s.dubVolume === "number") {
    if (volSlider) volSlider.value = s.dubVolume;
    audio.volume = s.dubVolume / 100;
    if (volReadout) volReadout.textContent = `${s.dubVolume}%`;
  }
})();

// Reset All Player States
function resetAllPlayerStates() {
  try {
    localStorage.removeItem(PLAYER_SETTINGS_KEY);
  } catch { /* silent */ }

  if (el.url) el.url.value = "";
  clearYoutubePlayer();

  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  assets.wav = false;
  setAssetState("wav", "선택 필요", "");
  if (el.wavName) el.wavName.textContent = "한국어 더빙 파일";
  if (el.wavMeta) el.wavMeta.textContent = "로컬 WAV · 아직 선택되지 않음";
  if (el.wav) el.wav.value = "";

  enCues = [];
  koCues = [];
  assets.en = false;
  assets.ko = false;
  setAssetState("en", "선택 필요", "");
  setAssetState("ko", "선택 필요", "");
  if (el.enName) el.enName.textContent = "원문 자막 파일";
  if (el.koName) el.koName.textContent = "번역 자막 파일";
  if (el.enMeta) el.enMeta.textContent = "reference · 아직 선택되지 않음";
  if (el.koMeta) el.koMeta.textContent = "primary · 아직 선택되지 않음";
  if (el.en) el.en.textContent = "영어 VTT 파일을 선택하세요.";
  if (el.ko) el.ko.textContent = "한국어 VTT 파일을 선택하세요.";
  if (el.enFile) el.enFile.value = "";
  if (el.koFile) el.koFile.value = "";
  if (el.time) el.time.textContent = "";
  if (el.cueCount) el.cueCount.textContent = "CUE —";

  el.sync.setAttribute("aria-pressed", "true");
  setButtonLabel(el.sync, "자동 sync 켬");
  el.mute.setAttribute("aria-pressed", "true");
  setButtonLabel(el.mute, "원음 음소거");
  audioOffset = 0;
  renderOffset();

  if (volSlider) volSlider.value = 100;
  audio.volume = 1.0;
  if (volReadout) volReadout.textContent = "100%";

  updateReadiness();
  updateToggleStatuses();
  setStatus("웹 플레이어의 선택 상태가 초기화되었습니다. (실제 PC 디스크 파일은 삭제되지 않습니다)");
}

window.addEventListener("lecture-dub-reset", resetAllPlayerStates);

const btnReset = $("#btn-reset-player");
if (btnReset) {
  btnReset.addEventListener("click", () => {
    if (confirm("웹 플레이어의 모든 입력값과 선택 상태를 해제하고 초기화하시겠습니까?\n(※ 실제 PC 디스크의 파일은 절대 삭제되지 않습니다)")) {
      window.dispatchEvent(new Event("lecture-dub-reset"));
    }
  });
}

renderOffset(); updateReadiness(); updateToggleStatuses();
const api = document.createElement("script"); api.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(api); requestAnimationFrame(frame);
