from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

from .subtitles import Cue

SAMPLE_RATE = 24_000
CHANNELS = 1
SAMPLE_WIDTH = 2


def require_ffmpeg() -> None:
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing:
        raise RuntimeError(
            "FFmpeg is required but not available on PATH: " + ", ".join(missing)
        )


def probe_duration(path: Path) -> float:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    return float(payload["format"]["duration"])


def atempo_chain(speed: float) -> str:
    """Build a legal FFmpeg atempo chain for any positive speed."""
    if speed <= 0:
        raise ValueError("speed must be positive")

    factors: list[float] = []
    while speed > 2.0:
        factors.append(2.0)
        speed /= 2.0
    while speed < 0.5:
        factors.append(0.5)
        speed /= 0.5
    factors.append(speed)
    return ",".join(f"atempo={factor:.6f}" for factor in factors)


def format_progress(stage: str, current: int, total: int, width: int = 30) -> str:
    """Return a single-line progress bar suitable for a terminal."""
    if total <= 0:
        raise ValueError("total must be positive")
    if width <= 0:
        raise ValueError("width must be positive")

    safe_current = min(max(current, 0), total)
    ratio = safe_current / total
    filled = int(width * ratio)
    bar = "■" * filled + "-" * (width - filled)
    return f"{stage} [{bar}] {safe_current}/{total} ({ratio * 100:.1f}%)"


def report_progress(stage: str, current: int, total: int) -> None:
    """Update one terminal line, then finish it when the stage reaches 100%."""
    end = "\n" if current >= total else "\r"
    print(f"\r{format_progress(stage, current, total)}", end=end, flush=True)


async def generate_tts(text: str, output: Path, voice: str, rate: str) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    await communicate.save(str(output))


def convert_to_timeline_wav(source: Path, output: Path, max_duration: float) -> float:
    duration = probe_duration(source)
    filters: list[str] = []
    if max_duration > 0 and duration > max_duration:
        filters.append(atempo_chain(duration / max_duration))

    command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source)]
    if filters:
        command.extend(["-filter:a", ",".join(filters)])
    command.extend(
        [
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            str(CHANNELS),
            "-c:a",
            "pcm_s16le",
            str(output),
        ]
    )
    subprocess.run(command, check=True)
    return probe_duration(output)


def write_silence(target: wave.Wave_write, seconds: float) -> None:
    frame_count = max(0, round(seconds * SAMPLE_RATE))
    chunk_frames = SAMPLE_RATE
    zero_chunk = b"\x00" * (chunk_frames * SAMPLE_WIDTH * CHANNELS)
    while frame_count:
        count = min(frame_count, chunk_frames)
        target.writeframesraw(zero_chunk[: count * SAMPLE_WIDTH * CHANNELS])
        frame_count -= count


def append_wav(target: wave.Wave_write, source_path: Path) -> float:
    with wave.open(str(source_path), "rb") as source:
        expected = (CHANNELS, SAMPLE_WIDTH, SAMPLE_RATE)
        actual = (source.getnchannels(), source.getsampwidth(), source.getframerate())
        if actual != expected:
            raise ValueError(f"Unexpected WAV format {actual}; expected {expected}")
        frames = source.readframes(source.getnframes())
        target.writeframesraw(frames)
        return source.getnframes() / SAMPLE_RATE


async def synthesize_timeline(
    cues: list[Cue],
    output: Path,
    voice: str,
    rate: str,
    keep_segments: bool = False,
) -> None:
    require_ffmpeg()
    if not cues:
        raise ValueError("At least one subtitle cue is required")

    output.parent.mkdir(parents=True, exist_ok=True)

    temporary_parent = output.parent if keep_segments else None
    with tempfile.TemporaryDirectory(prefix="lecture-dub-", dir=temporary_parent) as temp_name:
        temp_dir = Path(temp_name)
        prepared: list[tuple[Cue, Path, float]] = []
        total = len(cues)

        report_progress("TTS 생성", 0, total)
        for index, cue in enumerate(cues):
            next_start = cues[index + 1].start if index + 1 < total else cue.end
            slot = max(0.15, next_start - cue.start)
            mp3_path = temp_dir / f"{index:05d}.mp3"
            wav_path = temp_dir / f"{index:05d}.wav"
            await generate_tts(cue.text, mp3_path, voice=voice, rate=rate)
            duration = convert_to_timeline_wav(mp3_path, wav_path, max_duration=slot)
            prepared.append((cue, wav_path, duration))
            report_progress("TTS 생성", index + 1, total)

        with wave.open(str(output), "wb") as target:
            target.setnchannels(CHANNELS)
            target.setsampwidth(SAMPLE_WIDTH)
            target.setframerate(SAMPLE_RATE)

            cursor = 0.0
            report_progress("WAV 조립", 0, total)
            for index, (cue, wav_path, _duration) in enumerate(prepared):
                if cue.start > cursor:
                    write_silence(target, cue.start - cursor)
                    cursor = cue.start
                written = append_wav(target, wav_path)
                cursor += written
                report_progress("WAV 조립", index + 1, total)

            target.writeframes(b"")

        if keep_segments:
            segment_dir = output.with_suffix("").with_name(output.stem + "-segments")
            if segment_dir.exists():
                shutil.rmtree(segment_dir)
            shutil.copytree(temp_dir, segment_dir)
