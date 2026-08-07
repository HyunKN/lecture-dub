from __future__ import annotations

from pathlib import Path

import pytest

from lecture_dub import tts_providers
from lecture_dub.model_registry import LocalModel


def test_rate_multiplier() -> None:
    assert tts_providers._rate_multiplier("+0%") == 1.0
    assert tts_providers._rate_multiplier("+10%") == pytest.approx(1.1)
    assert tts_providers._rate_multiplier("-20%") == pytest.approx(0.8)


def test_resolve_model_returns_ready_match(tmp_path: Path, monkeypatch) -> None:
    model = LocalModel(
        id="qwen:test",
        provider="qwen3-tts",
        name="Qwen",
        path=str(tmp_path / "Qwen"),
        ready=True,
    )
    monkeypatch.setattr(tts_providers, "scan_models", lambda _root: [model])

    assert tts_providers.resolve_model(tmp_path, "qwen:test") is model


def test_resolve_model_rejects_unready_model(tmp_path: Path, monkeypatch) -> None:
    model = LocalModel(
        id="fish:test",
        provider="fish-s2-pro",
        name="Fish",
        path=str(tmp_path / "Fish"),
        ready=False,
        reason="runtime missing",
    )
    monkeypatch.setattr(tts_providers, "scan_models", lambda _root: [model])

    with pytest.raises(RuntimeError, match="runtime missing"):
        tts_providers.resolve_model(tmp_path, "fish:test")
