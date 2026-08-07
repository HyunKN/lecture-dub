from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import audio as audio_mod
from .model_registry import LocalModel, scan_models
from .subtitles import Cue

ProgressCallback = Callable[[str, int, int], None]


@dataclass(slots=True)
class ProviderSelection:
    engine: str = "edge"
    model_id: str = ""
    voice: str = ""
    rate: str = "+5%"


_QWEN_CACHE: dict[str, Any] = {}
_SUPERTONIC_CACHE: dict[str, Any] = {}
_FISH_SERVERS: dict[str, tuple[subprocess.Popen, str]] = {}


def _rate_multiplier(rate: str) -> float:
    text = str(rate or "+0%").strip().replace("%", "")
    try:
        percent = float(text)
    except ValueError:
        return 1.0
    return max(0.5, min(2.0, 1.0 + percent / 100.0))


def resolve_model(models_root: Path, model_id: str) -> LocalModel:
    for model in scan_models(models_root):
        if model.id == model_id:
            if not model.ready:
                raise RuntimeError(model.reason or "선택한 로컬 모델을 사용할 수 없습니다.")
            return model
    raise RuntimeError("선택한 로컬 TTS 모델을 찾을 수 없습니다. 모델 폴더를 다시 스캔해 주세요.")


async def _edge_generate(text: str, output: Path, voice: str, rate: str) -> None:
    await audio_mod.generate_tts(
        text,
        output,
        voice=voice or "ko-KR-SunHiNeural",
        rate=rate,
    )


def _load_qwen(model: LocalModel):
    cached = _QWEN_CACHE.get(model.path)
    if cached is not None:
        return cached

    try:
        import torch
        from qwen_tts import Qwen3TTSModel
    except ImportError as exc:
        raise RuntimeError("Qwen3-TTS를 사용하려면 `pip install -e \".[local-qwen]\"`가 필요합니다.") from exc

    use_cuda = torch.cuda.is_available()
    kwargs: dict[str, Any] = {
        "device_map": "cuda:0" if use_cuda else "cpu",
        "dtype": torch.bfloat16 if use_cuda else torch.float32,
    }
    qwen = Qwen3TTSModel.from_pretrained(model.path, **kwargs)
    _QWEN_CACHE[model.path] = qwen
    return qwen


def _qwen_generate_sync(model: LocalModel, text: str, output: Path, voice: str) -> None:
    try:
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError("Qwen3-TTS 음성 저장을 위해 soundfile이 필요합니다.") from exc

    qwen = _load_qwen(model)
    if model.variant == "custom_voice":
        wavs, sample_rate = qwen.generate_custom_voice(
            text=text,
            language="Korean",
            speaker=voice or "Sohee",
            instruct="차분하고 명확한 한국어 강의 톤으로 읽어 주세요.",
        )
    elif model.variant == "voice_design":
        wavs, sample_rate = qwen.generate_voice_design(
            text=text,
            language="Korean",
            instruct="차분하고 명확하며 오래 들어도 피곤하지 않은 한국어 강의자의 목소리",
        )
    else:
        raise RuntimeError("현재 Lecture Dub은 Qwen3-TTS CustomVoice/VoiceDesign 로컬 모델을 지원합니다.")
    sf.write(str(output), wavs[0], sample_rate)


async def _qwen_generate(model: LocalModel, text: str, output: Path, voice: str) -> None:
    await asyncio.to_thread(_qwen_generate_sync, model, text, output, voice)


def _load_supertonic(model: LocalModel):
    cached = _SUPERTONIC_CACHE.get(model.path)
    if cached is not None:
        return cached

    try:
        from supertonic import TTS
    except ImportError as exc:
        raise RuntimeError("Supertonic 3를 사용하려면 `pip install -e \".[local-supertonic]\"`가 필요합니다.") from exc

    previous = os.environ.get("SUPERTONIC_CACHE_DIR")
    os.environ["SUPERTONIC_CACHE_DIR"] = model.path
    try:
        tts = TTS(auto_download=False)
    finally:
        if previous is None:
            os.environ.pop("SUPERTONIC_CACHE_DIR", None)
        else:
            os.environ["SUPERTONIC_CACHE_DIR"] = previous
    _SUPERTONIC_CACHE[model.path] = tts
    return tts


def _supertonic_generate_sync(
    model: LocalModel,
    text: str,
    output: Path,
    voice: str,
    speed: float,
) -> None:
    tts = _load_supertonic(model)
    style = tts.get_voice_style(voice_name=voice or "F1")
    wav, _duration = tts.synthesize(
        text,
        voice_style=style,
        lang="ko",
        speed=speed,
        total_steps=8,
        verbose=False,
    )
    tts.save_audio(wav, str(output))


async def _supertonic_generate(
    model: LocalModel,
    text: str,
    output: Path,
    voice: str,
    rate: str,
) -> None:
    await asyncio.to_thread(
        _supertonic_generate_sync,
        model,
        text,
        output,
        voice,
        _rate_multiplier(rate),
    )


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_fish(url: str, process: subprocess.Popen, timeout: float = 300.0) -> None:
    deadline = time.time() + timeout
    health = f"{url}/v1/health"
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Fish Speech 로컬 서버가 모델 로딩 중 종료되었습니다.")
        try:
            with urllib.request.urlopen(health, timeout=2) as response:
                if 200 <= response.status < 300:
                    return
        except (urllib.error.URLError, OSError):
            time.sleep(1)
    raise RuntimeError("Fish Speech 로컬 서버 시작 시간이 초과되었습니다.")


def _fish_server(model: LocalModel) -> str:
    configured_url = os.environ.get("FISH_SPEECH_URL", "").strip().rstrip("/")
    if configured_url:
        return configured_url

    cached = _FISH_SERVERS.get(model.path)
    if cached is not None and cached[0].poll() is None:
        return cached[1]

    runtime_root = Path(model.runtime)
    script = runtime_root / "tools" / "api_server.py"
    if not script.is_file():
        raise RuntimeError(
            "Fish Speech 런타임의 tools/api_server.py를 찾지 못했습니다. "
            "fish-speech를 editable 설치하거나 FISH_SPEECH_ROOT/FISH_SPEECH_URL을 설정해 주세요."
        )

    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"
    command = [
        sys.executable,
        str(script),
        "--llama-checkpoint-path",
        model.path,
        "--decoder-checkpoint-path",
        str(Path(model.path) / "codec.pth"),
        "--listen",
        f"127.0.0.1:{port}",
    ]
    process = subprocess.Popen(
        command,
        cwd=str(runtime_root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _FISH_SERVERS[model.path] = (process, url)
    _wait_for_fish(url, process)
    return url


def _fish_generate_sync(model: LocalModel, text: str, output: Path) -> None:
    url = _fish_server(model)
    payload = json.dumps(
        {
            "text": text,
            "chunk_length": 200,
            "format": "wav",
            "references": [],
            "reference_id": None,
            "seed": 42,
            "use_memory_cache": "on",
            "normalize": True,
            "streaming": False,
            "max_new_tokens": 1024,
            "top_p": 0.7,
            "repetition_penalty": 1.2,
            "temperature": 0.7,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{url}/v1/tts",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "audio/wav"},
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Fish Speech 합성 요청 실패 ({exc.code}): {detail[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Fish Speech 서버에 연결할 수 없습니다: {exc.reason}") from exc
    if not data:
        raise RuntimeError("Fish Speech가 빈 오디오를 반환했습니다.")
    output.write_bytes(data)


async def _fish_generate(model: LocalModel, text: str, output: Path) -> None:
    await asyncio.to_thread(_fish_generate_sync, model, text, output)


def _convert_local_wav(source: Path, output: Path, max_duration: float, base_speed: float) -> float:
    duration = audio_mod.probe_duration(source)
    speed = max(0.01, base_speed)
    if max_duration > 0 and duration / speed > max_duration:
        speed = max(speed, duration / max_duration)

    command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source)]
    if abs(speed - 1.0) > 0.001:
        command.extend(["-filter:a", audio_mod.atempo_chain(speed)])
    command.extend(
        [
            "-ar", str(audio_mod.SAMPLE_RATE),
            "-ac", str(audio_mod.CHANNELS),
            "-c:a", "pcm_s16le",
            str(output),
        ]
    )
    subprocess.run(command, check=True)
    return audio_mod.probe_duration(output)


async def synthesize_timeline_with_provider(
    cues: list[Cue],
    output: Path,
    selection: ProviderSelection,
    models_root: Path,
    keep_segments: bool = False,
    progress: ProgressCallback | None = None,
) -> None:
    audio_mod.require_ffmpeg()
    if not cues:
        raise ValueError("At least one subtitle cue is required")
    report = progress or audio_mod.report_progress

    model = None
    if selection.engine != "edge":
        model = resolve_model(models_root, selection.model_id)
        if model.provider != selection.engine:
            raise RuntimeError("선택한 TTS 엔진과 모델 정보가 일치하지 않습니다.")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_parent = output.parent if keep_segments else None
    with tempfile.TemporaryDirectory(prefix="lecture-dub-", dir=temporary_parent) as temp_name:
        temp_dir = Path(temp_name)
        prepared: list[tuple[Cue, Path, float]] = []
        total = len(cues)
        report("TTS 생성", 0, total)

        for index, cue in enumerate(cues):
            next_start = cues[index + 1].start if index + 1 < total else cue.end
            slot = max(0.15, next_start - cue.start)
            raw_path = temp_dir / f"{index:05d}.{'mp3' if selection.engine == 'edge' else 'raw.wav'}"
            wav_path = temp_dir / f"{index:05d}.wav"

            if selection.engine == "edge":
                await _edge_generate(cue.text, raw_path, selection.voice, selection.rate)
                duration = audio_mod.convert_to_timeline_wav(raw_path, wav_path, max_duration=slot)
            elif selection.engine == "qwen3-tts":
                assert model is not None
                await _qwen_generate(model, cue.text, raw_path, selection.voice)
                duration = _convert_local_wav(raw_path, wav_path, slot, _rate_multiplier(selection.rate))
            elif selection.engine == "supertonic-3":
                assert model is not None
                await _supertonic_generate(model, cue.text, raw_path, selection.voice, selection.rate)
                duration = _convert_local_wav(raw_path, wav_path, slot, 1.0)
            elif selection.engine == "fish-s2-pro":
                assert model is not None
                await _fish_generate(model, cue.text, raw_path)
                duration = _convert_local_wav(raw_path, wav_path, slot, _rate_multiplier(selection.rate))
            else:
                raise RuntimeError(f"지원하지 않는 TTS 엔진입니다: {selection.engine}")

            prepared.append((cue, wav_path, duration))
            report("TTS 생성", index + 1, total)

        with wave.open(str(output), "wb") as target:
            target.setnchannels(audio_mod.CHANNELS)
            target.setsampwidth(audio_mod.SAMPLE_WIDTH)
            target.setframerate(audio_mod.SAMPLE_RATE)
            cursor = 0.0
            report("WAV 조립", 0, total)
            for index, (cue, wav_path, _duration) in enumerate(prepared):
                if cue.start > cursor:
                    audio_mod.write_silence(target, cue.start - cursor)
                    cursor = cue.start
                cursor += audio_mod.append_wav(target, wav_path)
                report("WAV 조립", index + 1, total)
            target.writeframes(b"")

        if keep_segments:
            import shutil

            segment_dir = output.with_suffix("").with_name(output.stem + "-segments")
            if segment_dir.exists():
                shutil.rmtree(segment_dir)
            shutil.copytree(temp_dir, segment_dir)


async def preview_with_provider(
    text: str,
    output: Path,
    selection: ProviderSelection,
    models_root: Path,
) -> None:
    model = None
    if selection.engine != "edge":
        model = resolve_model(models_root, selection.model_id)

    if selection.engine == "edge":
        await _edge_generate(text, output, selection.voice, selection.rate)
    elif selection.engine == "qwen3-tts":
        assert model is not None
        await _qwen_generate(model, text, output, selection.voice)
    elif selection.engine == "supertonic-3":
        assert model is not None
        await _supertonic_generate(model, text, output, selection.voice, selection.rate)
    elif selection.engine == "fish-s2-pro":
        assert model is not None
        await _fish_generate(model, text, output)
    else:
        raise RuntimeError(f"지원하지 않는 TTS 엔진입니다: {selection.engine}")
