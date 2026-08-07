from __future__ import annotations

import json
from pathlib import Path

from lecture_dub import model_registry


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_models_root_is_persisted(tmp_path: Path, monkeypatch) -> None:
    settings_dir = tmp_path / "settings"
    settings_file = settings_dir / "settings.json"
    models = tmp_path / "models"
    models.mkdir()
    monkeypatch.setattr(model_registry, "SETTINGS_DIR", settings_dir)
    monkeypatch.setattr(model_registry, "SETTINGS_FILE", settings_file)

    resolved = model_registry.set_models_root(models)

    assert resolved == models.resolve()
    assert model_registry.get_models_root(tmp_path / "fallback") == models.resolve()


def test_scan_detects_ready_qwen_custom_voice(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "models"
    model = root / "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    _write_json(model / "config.json", {"model_type": "qwen3_tts", "tts_model_type": "custom_voice"})
    (model / "model-00001-of-00002.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(model_registry, "runtime_available", lambda module: module == "qwen_tts")

    found = model_registry.scan_models(root)

    assert len(found) == 1
    assert found[0].provider == "qwen3-tts"
    assert found[0].variant == "custom_voice"
    assert found[0].voices == ["Sohee"]
    assert found[0].ready is True


def test_scan_marks_qwen_base_as_detected_but_not_ready(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "models"
    model = root / "Qwen3-TTS-12Hz-0.6B-Base"
    _write_json(model / "config.json", {"model_type": "qwen3_tts", "tts_model_type": "base"})
    (model / "model.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(model_registry, "runtime_available", lambda _module: True)

    found = model_registry.scan_models(root)

    assert len(found) == 1
    assert found[0].provider == "qwen3-tts"
    assert found[0].ready is False
    assert "참조 음성" in found[0].reason


def test_scan_detects_supertonic_and_reports_missing_runtime(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "models"
    model = root / "supertonic-3"
    _write_json(model / "config.json", {"model_name": "Supertonic 3"})
    onnx = model / "onnx"
    onnx.mkdir(parents=True)
    for name in (
        "tts.json",
        "unicode_indexer.json",
        "text_encoder.onnx",
        "duration_predictor.onnx",
        "vector_estimator.onnx",
        "vocoder.onnx",
    ):
        (onnx / name).write_bytes(b"x")
    monkeypatch.setattr(model_registry, "runtime_available", lambda _module: False)

    found = model_registry.scan_models(root)

    assert len(found) == 1
    assert found[0].provider == "supertonic-3"
    assert found[0].ready is False
    assert "런타임" in found[0].reason
    assert "F1" in found[0].voices


def test_fish_requires_real_model_weights_not_only_codec(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "models"
    model = root / "s2-pro"
    _write_json(model / "config.json", {"model_type": "fish_qwen3_omni"})
    (model / "codec.pth").write_bytes(b"codec")
    monkeypatch.setattr(model_registry, "find_fish_runtime_root", lambda: tmp_path / "fish-speech")
    monkeypatch.setattr(model_registry, "fish_server_url", lambda: "")

    found = model_registry.scan_models(root)

    assert len(found) == 1
    assert found[0].provider == "fish-s2-pro"
    assert found[0].ready is False
    assert "체크포인트" in found[0].reason


def test_fish_can_use_configured_local_server(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "models"
    model = root / "s2-pro"
    _write_json(model / "config.json", {"model_type": "fish_qwen3_omni"})
    (model / "codec.pth").write_bytes(b"codec")
    (model / "model-00001-of-00002.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(model_registry, "find_fish_runtime_root", lambda: None)
    monkeypatch.setattr(model_registry, "fish_server_url", lambda: "http://127.0.0.1:8080")

    found = model_registry.scan_models(root)

    assert len(found) == 1
    assert found[0].ready is True
    assert found[0].runtime == "http://127.0.0.1:8080"
