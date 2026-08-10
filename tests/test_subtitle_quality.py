from __future__ import annotations

import asyncio
from pathlib import Path

from lecture_dub import server_quality
from lecture_dub.subtitle_quality import parse_vtt_for_quality, rank_english_vtts


def _write_vtt(path: Path, cues: list[tuple[str, str, str]]) -> None:
    lines = ["WEBVTT", ""]
    for start, end, text in cues:
        lines.extend([f"{start} --> {end}", text, ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def test_parse_vtt_keeps_raw_inline_timestamps_for_quality_checks() -> None:
    cues = parse_vtt_for_quality(
        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n"
        "<00:00:00.100><c>Hello</c> world\n"
    )

    assert len(cues) == 1
    assert "<00:00:00.100>" in cues[0].raw_text
    assert cues[0].text == "Hello world"


def test_clean_track_beats_rolling_caption_even_when_orig(tmp_path: Path) -> None:
    clean = tmp_path / "Lecture [ABC123xyz].en-US.vtt"
    rolling = tmp_path / "Lecture [ABC123xyz].en-orig.vtt"

    _write_vtt(
        clean,
        [
            ("00:00:00.000", "00:00:04.000", "Today we will study supervised learning."),
            ("00:00:04.000", "00:00:08.000", "First, we define the training data."),
            ("00:00:08.000", "00:00:12.000", "Then we evaluate the model."),
        ],
    )
    _write_vtt(
        rolling,
        [
            ("00:00:00.000", "00:00:03.000", "<00:00:00.100><c>Today we will study</c>"),
            ("00:00:01.000", "00:00:04.000", "<00:00:01.100><c>Today we will study supervised learning</c>"),
            ("00:00:02.000", "00:00:05.000", "<00:00:02.100><c>we will study supervised learning today</c>"),
            ("00:00:05.000", "00:00:09.000", "<00:00:05.100><c>First we define the training data</c>"),
            ("00:00:09.000", "00:00:12.000", "<00:00:09.100><c>Then we evaluate the model</c>"),
        ],
    )

    ranked = rank_english_vtts(tmp_path)
    by_name = {item.name: item for item in ranked}

    assert by_name[clean.name].score > by_name[rolling.name].score
    assert by_name[clean.name].recommended is True
    assert by_name[rolling.name].recommended is False
    assert by_name[rolling.name].inline_timestamp_ratio > 0.5


def test_filename_itself_does_not_change_quality_score(tmp_path: Path) -> None:
    content = [
        ("00:00:00.000", "00:00:03.000", "A clean sentence with enough words."),
        ("00:00:03.000", "00:00:06.000", "Another clean sentence for translation."),
    ]
    orig = tmp_path / "Lecture [SAME12345].en-orig.vtt"
    regional = tmp_path / "Lecture [SAME12345].en-US.vtt"
    _write_vtt(orig, content)
    _write_vtt(regional, content)

    ranked = rank_english_vtts(tmp_path)
    by_name = {item.name: item for item in ranked}

    assert by_name[orig.name].score == by_name[regional.name].score


def test_incomplete_small_track_is_penalized_by_duration_coverage(tmp_path: Path) -> None:
    full = tmp_path / "Lecture [COVER1234].en.vtt"
    partial = tmp_path / "Lecture [COVER1234].en-US.vtt"

    _write_vtt(
        full,
        [
            ("00:00:00.000", "00:00:05.000", "The first complete subtitle sentence."),
            ("00:00:05.000", "00:00:10.000", "The second complete subtitle sentence."),
            ("00:00:10.000", "00:00:15.000", "The final complete subtitle sentence."),
        ],
    )
    _write_vtt(
        partial,
        [("00:00:00.000", "00:00:03.000", "Only the beginning is present here.")],
    )

    ranked = rank_english_vtts(tmp_path)
    by_name = {item.name: item for item in ranked}

    assert by_name[partial.name].coverage_ratio < 0.5
    assert by_name[full.name].score > by_name[partial.name].score
    assert by_name[full.name].recommended is True


def test_quality_server_injects_ui_and_registers_api_route() -> None:
    paths = [getattr(route, "path", "") for route in server_quality.app.routes]

    assert "/api/subtitle-quality" in paths
    assert paths.index("/api/subtitle-quality") < paths.index("")

    response = asyncio.run(server_quality.index())
    body = response.body.decode("utf-8")
    assert "/web/local-models.js" in body
    assert "/web/subtitle-quality.js" in body


def test_quality_server_returns_only_requested_video(monkeypatch) -> None:
    class FakeQuality:
        def __init__(self, group: str, name: str) -> None:
            self.group = group
            self.name = name

        def to_dict(self) -> dict[str, str]:
            return {"group": self.group, "name": self.name}

    ranked = [
        FakeQuality("LECTURE1", "lecture-1.en-US.vtt"),
        FakeQuality("LECTURE2", "lecture-2.en-US.vtt"),
        FakeQuality("LECTURE2", "lecture-2.en-orig.vtt"),
    ]
    monkeypatch.setattr(server_quality, "rank_english_vtts", lambda _root: ranked)

    without_video = asyncio.run(server_quality.subtitle_quality())
    lecture_two = asyncio.run(server_quality.subtitle_quality("LECTURE2"))

    assert without_video["files"] == []
    assert lecture_two["video_id"] == "LECTURE2"
    assert [item["name"] for item in lecture_two["files"]] == [
        "lecture-2.en-US.vtt",
        "lecture-2.en-orig.vtt",
    ]
    assert lecture_two["policy"]["scope"] == "current-video"
