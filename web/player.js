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

function loadVideo() {
  const id = videoId(el.url.value);
  if (!id) { assets.video = false; setAssetState("video", "URL 확인 필요", "error"); updateReadiness(); return setAlert("올바른 YouTube URL 또는 11자리 영상 ID를 입력해 주세요."); }
  if (!playerReady) { setAssetState("video", "준비 중", "loading"); return setStatus("YouTube 플레이어가 준비되는 중입니다."); }
  pauseTogether(); player.loadVideoById(id); assets.video = true; setAssetState("video", "준비됨", "ready"); muteOriginal(); updateReadiness(); setStatus("YouTube Video를 확인했습니다. WAV와 자막은 그대로 유지됩니다.");
}

function frame() {
  const current = videoTime(), yState = state(), playing = Boolean(yt()?.PlayerState && yState === yt().PlayerState.PLAYING);
  if (el.sync.getAttribute("aria-pressed") === "true" && audio.src) {
    if (playing) { syncAudio(); if (audio.paused) audio.play().catch(() => {}); }
    else if (!audio.paused) audio.pause();
  }
  const ko = activeCue(koCues, current), en = activeCue(enCues, current), duration = playerReady ? player.getDuration() : 0;
  el.ko.textContent = ko?.cue.text || (assets.ko ? "현재 구간에 한국어 자막이 없습니다." : "한국어 VTT 파일을 선택하세요.");
  el.en.textContent = en?.cue.text || (assets.en ? "현재 구간에 영어 자막이 없습니다." : "영어 VTT 파일을 선택하세요.");
  el.time.textContent = ko ? `${format(ko.cue.start)} — ${format(ko.cue.end)}` : "";
  el.cueCount.textContent = ko ? `CUE ${ko.index + 1} / ${koCues.length}` : (en ? `CUE ${en.index + 1} / ${enCues.length}` : "CUE —");
  el.clock.textContent = `${format(current)} / ${format(duration)} · ${playing ? "재생 중" : yState === 2 ? "일시정지" : "대기 중"}`;
  const percent = duration ? Math.min(100, current / duration * 100) : 0;
  el.progress.setAttribute("aria-valuenow", String(Math.round(percent))); el.progress.setAttribute("aria-label", `재생 진행률 ${Math.round(percent)}%`); el.progressFill.style.width = `${percent}%`;
  setPlaying(playing); requestAnimationFrame(frame);
}

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("youtube-player", { videoId: videoId(el.url.value) || "_NLHFoVNlbg", playerVars: { controls: 1, rel: 0, playsinline: 1 }, events: {
    onReady: () => { playerReady = true; assets.video = Boolean(videoId(el.url.value)); setAssetState("video", assets.video ? "준비됨" : "URL 확인 필요", assets.video ? "ready" : ""); muteOriginal(); updateReadiness(); setStatus("플레이어가 준비됐습니다. Korean WAV를 선택해 주세요."); },
    onStateChange: event => { if (event.data === YT.PlayerState.PLAYING && audio.src) { syncAudio(true); audio.play().catch(() => {}); } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) audio.pause(); },
    onError: () => { assets.video = false; setAssetState("video", "재생 불가", "error"); updateReadiness(); setAlert("YouTube 영상을 재생할 수 없습니다. 공개 상태와 URL을 확인한 뒤 다른 영상을 불러와 주세요."); }
  }});
};

el.load.addEventListener("click", loadVideo);
el.url.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); loadVideo(); } });
el.wav.addEventListener("change", event => loadAudio(event.target.files[0]));
el.enFile.addEventListener("change", event => loadVtt(event.target.files[0], "en"));
el.koFile.addEventListener("change", event => loadVtt(event.target.files[0], "ko"));
el.cta.addEventListener("click", playTogether);
el.play.addEventListener("click", () => state() === (yt()?.PlayerState.PLAYING) ? pauseTogether() : playTogether());
el.sync.addEventListener("click", () => { const pressed = el.sync.getAttribute("aria-pressed") !== "true"; el.sync.setAttribute("aria-pressed", String(pressed)); setButtonLabel(el.sync, `자동 sync ${pressed ? "켬" : "끔"}`); if (pressed) syncAudio(true); setStatus(`자동 sync를 ${pressed ? "켰습니다" : "껐습니다"}.`); });
el.mute.addEventListener("click", () => { const pressed = el.mute.getAttribute("aria-pressed") !== "true"; el.mute.setAttribute("aria-pressed", String(pressed)); setButtonLabel(el.mute, `원음 ${pressed ? "음소거" : "재생"}`); muteOriginal(); setStatus(`YouTube 원음을 ${pressed ? "음소거했습니다" : "재생합니다"}.`); });
document.querySelectorAll("[data-offset]").forEach(button => button.addEventListener("click", () => { audioOffset = Math.round((audioOffset + Number(button.dataset.offset)) * 10) / 10; renderOffset(); syncAudio(true); setStatus(`더빙 타이밍을 ${el.offsetValue.textContent}로 조정했습니다.`); }));
$("#reset-offset").addEventListener("click", () => { audioOffset = 0; renderOffset(); syncAudio(true); setStatus("더빙 타이밍을 초기화했습니다."); });
audio.addEventListener("loadedmetadata", () => { assets.wav = true; setAssetState("wav", "준비됨", "ready"); el.wavMeta.textContent = `${format(audio.duration)} · 로컬 파일`; updateReadiness(); setStatus("Korean WAV를 준비했습니다."); });
audio.addEventListener("error", () => { assets.wav = false; setAssetState("wav", "읽기 실패", "error"); updateReadiness(); setAlert("Korean WAV를 읽지 못했습니다. 지원되는 오디오 파일인지 확인해 주세요."); });
audio.addEventListener("seeked", () => { if (internalSeek) { internalSeek = false; return; } if (playerReady && el.sync.getAttribute("aria-pressed") === "true") player.seekTo(Math.max(0, audio.currentTime - offset()), true); });
audio.addEventListener("play", () => { if (playerReady && el.sync.getAttribute("aria-pressed") === "true" && state() !== yt()?.PlayerState.PLAYING) player.playVideo(); });
audio.addEventListener("pause", () => { if (playerReady && el.sync.getAttribute("aria-pressed") === "true" && state() === yt()?.PlayerState.PLAYING) player.pauseVideo(); });
renderOffset(); updateReadiness();
const api = document.createElement("script"); api.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(api); requestAnimationFrame(frame);
