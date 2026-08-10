from __future__ import annotations

import html
import math
import re
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

TIMING_RE = re.compile(
    r"^\s*(?P<start>(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*"
    r"(?P<end>(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})"
)
INLINE_TIMESTAMP_RE = re.compile(r"<(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}>")
TAG_RE = re.compile(r"<[^>]+>")
WORD_RE = re.compile(r"[A-Za-z0-9가-힣']+")
VIDEO_ID_RE = re.compile(r"\[([A-Za-z0-9_-]{6,})\]")


@dataclass(slots=True)
class ParsedCue:
    start: float
    end: float
    raw_text: str
    text: str


@dataclass(slots=True)
class SubtitleQuality:
    name: str
    path: str
    group: str
    score: int
    recommended: bool = False
    size_bytes: int = 0
    cue_count: int = 0
    duration_seconds: float = 0.0
    inline_timestamp_ratio: float = 0.0
    duplicate_ratio: float = 0.0
    short_cue_ratio: float = 0.0
    cues_per_minute: float = 0.0
    size_ratio: float = 1.0
    coverage_ratio: float = 1.0
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        payload = asdict(self)
        for key in (
            "duration_seconds",
            "inline_timestamp_ratio",
            "duplicate_ratio",
            "short_cue_ratio",
            "cues_per_minute",
            "size_ratio",
            "coverage_ratio",
        ):
            payload[key] = round(float(payload[key]), 3)
        return payload


def _timestamp_seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours = "0"
        minutes, seconds = parts
    else:
        raise ValueError(f"Invalid WebVTT timestamp: {value}")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _clean_text(raw_text: str) -> str:
    text = INLINE_TIMESTAMP_RE.sub("", raw_text)
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    return " ".join(text.split())


def parse_vtt_for_quality(text: str) -> list[ParsedCue]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: list[ParsedCue] = []
    index = 0

    while index < len(lines):
        match = TIMING_RE.match(lines[index])
        if not match:
            index += 1
            continue

        start = _timestamp_seconds(match.group("start"))
        end = _timestamp_seconds(match.group("end"))
        index += 1
        body: list[str] = []
        while index < len(lines) and lines[index].strip():
            body.append(lines[index])
            index += 1

        raw_text = "\n".join(body).strip()
        cues.append(
            ParsedCue(
                start=start,
                end=end,
                raw_text=raw_text,
                text=_clean_text(raw_text),
            )
        )
        index += 1

    return cues


def _tokens(text: str) -> list[str]:
    return [token.lower() for token in WORD_RE.findall(text)]


def _token_containment(left: str, right: str) -> float:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if len(left_tokens) < 3 or len(right_tokens) < 3:
        return 0.0

    left_counts = Counter(left_tokens)
    right_counts = Counter(right_tokens)
    common = sum((left_counts & right_counts).values())
    denominator = min(sum(left_counts.values()), sum(right_counts.values()))
    return common / denominator if denominator else 0.0


def _group_key(path: Path) -> str:
    match = VIDEO_ID_RE.search(path.name)
    if match:
        return match.group(1)

    name = path.name
    name = re.sub(r"\.en(?:-[A-Za-z0-9-]+)?\.vtt$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.en-orig\.vtt$", "", name, flags=re.IGNORECASE)
    return name or path.stem


def _base_metrics(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    cues = parse_vtt_for_quality(raw)
    cue_count = len(cues)
    duration = max((cue.end for cue in cues), default=0.0)

    inline_count = sum(bool(INLINE_TIMESTAMP_RE.search(cue.raw_text)) for cue in cues)
    short_count = sum(max(0.0, cue.end - cue.start) <= 0.35 for cue in cues)

    duplicate_count = 0
    duplicate_pairs = 0
    for previous, current in zip(cues, cues[1:]):
        if not previous.text or not current.text:
            continue
        duplicate_pairs += 1
        previous_normalized = " ".join(_tokens(previous.text))
        current_normalized = " ".join(_tokens(current.text))
        contained = (
            len(previous_normalized) >= 12
            and len(current_normalized) >= 12
            and (
                previous_normalized in current_normalized
                or current_normalized in previous_normalized
            )
        )
        if contained or _token_containment(previous.text, current.text) >= 0.82:
            duplicate_count += 1

    return {
        "path": path,
        "size_bytes": path.stat().st_size,
        "cue_count": cue_count,
        "duration_seconds": duration,
        "inline_timestamp_ratio": inline_count / cue_count if cue_count else 0.0,
        "duplicate_ratio": duplicate_count / duplicate_pairs if duplicate_pairs else 0.0,
        "short_cue_ratio": short_count / cue_count if cue_count else 0.0,
        "cues_per_minute": cue_count / (duration / 60.0) if duration > 0 else 0.0,
    }


def _score(metrics: dict, *, size_ratio: float, coverage_ratio: float) -> tuple[int, list[str], list[str]]:
    inline_ratio = metrics["inline_timestamp_ratio"]
    duplicate_ratio = metrics["duplicate_ratio"]
    short_ratio = metrics["short_cue_ratio"]
    density = metrics["cues_per_minute"]

    penalty = 0.0
    penalty += min(30.0, inline_ratio * 30.0)
    penalty += min(40.0, duplicate_ratio * 40.0)
    penalty += min(20.0, short_ratio * 20.0)

    if density > 45.0:
        penalty += min(10.0, ((density - 45.0) / 45.0) * 10.0)

    if size_ratio > 1.5:
        penalty += min(10.0, math.log2(size_ratio / 1.5 + 1.0) * 5.0)

    if coverage_ratio < 0.90:
        penalty += min(30.0, ((0.90 - coverage_ratio) / 0.90) * 30.0)

    score = max(0, min(100, round(100.0 - penalty)))
    reasons: list[str] = []
    warnings: list[str] = []

    if duplicate_ratio < 0.08:
        reasons.append("반복 자막이 적음")
    elif duplicate_ratio >= 0.20:
        warnings.append(f"인접 cue 중복이 많음 ({duplicate_ratio * 100:.0f}%)")

    if inline_ratio < 0.05:
        reasons.append("과도한 단어 단위 타임코드가 없음")
    elif inline_ratio >= 0.20:
        warnings.append(f"인라인 타임코드가 많음 ({inline_ratio * 100:.0f}%)")

    if short_ratio < 0.12:
        reasons.append("지나치게 짧은 cue가 적음")
    elif short_ratio >= 0.20:
        warnings.append(f"매우 짧은 cue가 많음 ({short_ratio * 100:.0f}%)")

    if coverage_ratio >= 0.95:
        reasons.append("자막 길이 커버리지가 정상")
    elif coverage_ratio < 0.90:
        warnings.append(f"다른 트랙보다 자막 길이가 짧음 ({coverage_ratio * 100:.0f}%)")

    if size_ratio <= 1.35:
        reasons.append("동일 영상 영어 자막 중 용량이 작음")
    elif size_ratio >= 2.0:
        warnings.append(f"동일 영상 최소 파일보다 용량이 {size_ratio:.1f}배 큼")

    if density > 70.0:
        warnings.append(f"cue 밀도가 높음 ({density:.0f}개/분)")

    return score, reasons, warnings


def rank_english_vtts(root: Path) -> list[SubtitleQuality]:
    if not root.is_dir():
        return []

    paths = sorted(path for path in root.glob("*.vtt") if path.is_file())
    grouped: dict[str, list[dict]] = defaultdict(list)
    for path in paths:
        try:
            metrics = _base_metrics(path)
        except OSError:
            continue
        metrics["group"] = _group_key(path)
        grouped[metrics["group"]].append(metrics)

    ranked: list[SubtitleQuality] = []
    for group, items in grouped.items():
        positive_sizes = [item["size_bytes"] for item in items if item["size_bytes"] > 0]
        min_size = min(positive_sizes, default=1)
        max_duration = max((item["duration_seconds"] for item in items), default=0.0)

        group_results: list[SubtitleQuality] = []
        for item in items:
            size_ratio = item["size_bytes"] / min_size if min_size else 1.0
            coverage_ratio = (
                item["duration_seconds"] / max_duration if max_duration > 0 else 1.0
            )
            score, reasons, warnings = _score(
                item,
                size_ratio=size_ratio,
                coverage_ratio=coverage_ratio,
            )
            group_results.append(
                SubtitleQuality(
                    name=item["path"].name,
                    path=f"en/{item['path'].name}",
                    group=group,
                    score=score,
                    size_bytes=item["size_bytes"],
                    cue_count=item["cue_count"],
                    duration_seconds=item["duration_seconds"],
                    inline_timestamp_ratio=item["inline_timestamp_ratio"],
                    duplicate_ratio=item["duplicate_ratio"],
                    short_cue_ratio=item["short_cue_ratio"],
                    cues_per_minute=item["cues_per_minute"],
                    size_ratio=size_ratio,
                    coverage_ratio=coverage_ratio,
                    reasons=reasons,
                    warnings=warnings,
                )
            )

        group_results.sort(
            key=lambda item: (-item.score, item.size_bytes, item.cue_count, item.name.lower())
        )
        if group_results:
            group_results[0].recommended = True
        ranked.extend(group_results)

    return sorted(
        ranked,
        key=lambda item: (item.group.lower(), not item.recommended, -item.score, item.name.lower()),
    )
