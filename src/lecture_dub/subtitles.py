from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path

_TIMESTAMP_RE = re.compile(
    r"^(?:(?P<hours>\d{1,2}):)?(?P<minutes>\d{2}):(?P<seconds>\d{2})[.,](?P<millis>\d{3})$"
)
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True, slots=True)
class Cue:
    start: float
    end: float
    text: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def parse_timestamp(value: str) -> float:
    """Convert a WebVTT/SRT timestamp to seconds."""
    match = _TIMESTAMP_RE.match(value.strip())
    if not match:
        raise ValueError(f"Unsupported timestamp: {value!r}")

    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes"))
    seconds = int(match.group("seconds"))
    millis = int(match.group("millis"))
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def clean_caption_text(value: str) -> str:
    value = _TAG_RE.sub("", value)
    value = html.unescape(value)
    return " ".join(value.split()).strip()


def parse_vtt_text(content: str) -> list[Cue]:
    """Parse ordinary WebVTT cues while ignoring headers, notes, and styling blocks."""
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: list[Cue] = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line or line == "WEBVTT":
            index += 1
            continue

        if line.startswith(("NOTE", "STYLE", "REGION")):
            index += 1
            while index < len(lines) and lines[index].strip():
                index += 1
            continue

        if "-->" not in line:
            # Cue identifier: the following line may contain the timing.
            if index + 1 < len(lines) and "-->" in lines[index + 1]:
                index += 1
                line = lines[index].strip()
            else:
                index += 1
                continue

        timing = line.split("-->", maxsplit=1)
        start_raw = timing[0].strip()
        end_raw = timing[1].strip().split()[0]
        start = parse_timestamp(start_raw)
        end = parse_timestamp(end_raw)

        index += 1
        text_lines: list[str] = []
        while index < len(lines) and lines[index].strip():
            text_lines.append(lines[index].strip())
            index += 1

        text = clean_caption_text(" ".join(text_lines))
        if text and end > start:
            cues.append(Cue(start=start, end=end, text=text))

    return cues


def load_vtt(path: Path) -> list[Cue]:
    cues = parse_vtt_text(path.read_text(encoding="utf-8-sig"))
    if not cues:
        raise ValueError(f"No usable subtitle cues found in {path}")
    return cues
