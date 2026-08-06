from __future__ import annotations

from pathlib import Path

from lecture_dub import cli


def test_extract_main_uses_english_output_directory(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_extract(url: str, output_dir: Path, language: str) -> list[Path]:
        captured.update(url=url, output_dir=output_dir, language=language)
        return [output_dir / "lecture.en.vtt"]

    monkeypatch.setattr(cli, "extract_english_subtitles", fake_extract)

    assert cli.main(["extract", "https://example.test/watch?v=video"]) == 0
    assert captured == {
        "url": "https://example.test/watch?v=video",
        "output_dir": Path("output/en"),
        "language": "en.*",
    }


def test_extract_main_uses_explicit_output_directory(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_extract(url: str, output_dir: Path, language: str) -> list[Path]:
        captured.update(url=url, output_dir=output_dir, language=language)
        return [output_dir / "lecture.en.vtt"]

    monkeypatch.setattr(cli, "extract_english_subtitles", fake_extract)

    assert cli.main(["extract", "https://example.test/watch?v=video", "--output-dir", "custom/en"]) == 0
    assert captured["output_dir"] == Path("custom/en")


def test_synthesize_main_uses_korean_dub_default(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(cli, "load_vtt", lambda _: ["cue"])

    async def fake_synthesize(cues, **kwargs) -> None:
        captured.update(cues=cues, **kwargs)

    monkeypatch.setattr(cli, "synthesize_timeline", fake_synthesize)

    assert cli.main(["synthesize", "output/ko/lecture.ko.vtt"]) == 0
    assert captured == {
        "cues": ["cue"],
        "output": Path("output/ko/korean_dub.wav"),
        "voice": cli.DEFAULT_VOICE,
        "rate": "+5%",
        "keep_segments": False,
    }


def test_synthesize_main_uses_explicit_output(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(cli, "load_vtt", lambda _: ["cue"])

    async def fake_synthesize(cues, **kwargs) -> None:
        captured.update(cues=cues, **kwargs)

    monkeypatch.setattr(cli, "synthesize_timeline", fake_synthesize)

    assert cli.main([
        "synthesize", "output/ko/lecture.ko.vtt", "--output", "custom/lecture.wav",
    ]) == 0
    assert captured["output"] == Path("custom/lecture.wav")
