from __future__ import annotations

import importlib.util
import json
import os
import platform
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SETTINGS_DIR = Path.home() / ".lecture-dub"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"


@dataclass(slots=True)
class LocalModel:
    id: str
    provider: str
    name: str
    path: str
    ready: bool
    reason: str = ""
    variant: str = ""
    voices: list[str] = field(default_factory=list)
    runtime: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_settings() -> dict[str, Any]:
    if not SETTINGS_FILE.is_file():
        return {}
    return _read_json(SETTINGS_FILE)


def save_settings(settings: dict[str, Any]) -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(
        json.dumps(settings, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_models_root(default_root: Path) -> Path:
    configured = str(load_settings().get("models_root", "")).strip()
    return Path(configured).expanduser() if configured else default_root


def set_models_root(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError(f"모델 폴더를 찾을 수 없습니다: {resolved}")
    settings = load_settings()
    settings["models_root"] = str(resolved)
    save_settings(settings)
    return resolved


def runtime_available(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, AttributeError, ValueError):
        return False


def fish_server_url() -> str:
    return os.environ.get("FISH_SPEECH_URL", "").strip().rstrip("/")


def find_fish_runtime_root() -> Path | None:
    configured = os.environ.get("FISH_SPEECH_ROOT", "").strip()
    if configured:
        root = Path(configured).expanduser().resolve()
        if (root / "tools" / "api_server.py").is_file():
            return root

    try:
        spec = importlib.util.find_spec("fish_speech")
    except (ImportError, AttributeError, ValueError):
        spec = None
    if spec and spec.submodule_search_locations:
        for location in spec.submodule_search_locations:
            package_dir = Path(location).resolve()
            root = package_dir.parent
            if (root / "tools" / "api_server.py").is_file():
                return root
    return None


def _has_any_weights(path: Path) -> bool:
    patterns = ("*.safetensors", "*.bin", "*.pth", "*.onnx")
    return any(next(path.glob(pattern), None) is not None for pattern in patterns)


def _has_model_weights(path: Path) -> bool:
    if (path / "model.safetensors.index.json").is_file():
        return True
    patterns = ("model*.safetensors", "pytorch_model*.bin", "model*.bin")
    return any(next(path.glob(pattern), None) is not None for pattern in patterns)


def _detect_qwen(path: Path, config: dict[str, Any]) -> LocalModel | None:
    model_type = str(config.get("model_type", "")).lower()
    name_lower = path.name.lower()
    if "qwen3_tts" not in model_type and "qwen3-tts" not in name_lower:
        return None
    if not _has_any_weights(path):
        return None

    variant = str(config.get("tts_model_type", "")).lower()
    if not variant:
        if "customvoice" in name_lower or "custom-voice" in name_lower:
            variant = "custom_voice"
        elif "voicedesign" in name_lower or "voice-design" in name_lower:
            variant = "voice_design"
        elif "base" in name_lower:
            variant = "base"

    runtime = runtime_available("qwen_tts")
    supported = variant in {"custom_voice", "voice_design"}
    ready = runtime and supported
    if not runtime:
        reason = "qwen-tts 런타임이 설치되지 않았습니다."
    elif not supported:
        reason = "Base 모델은 참조 음성 UI가 필요해 현재 자동 합성 대상에서 제외됩니다."
    else:
        reason = ""

    voices = ["Sohee"] if variant == "custom_voice" else ["Korean Lecturer"]
    return LocalModel(
        id=f"qwen:{path.resolve()}",
        provider="qwen3-tts",
        name=path.name,
        path=str(path.resolve()),
        ready=ready,
        reason=reason,
        variant=variant,
        voices=voices,
        runtime="qwen_tts" if runtime else "",
        metadata={"language": "Korean"},
    )


def _detect_supertonic(path: Path, config: dict[str, Any]) -> LocalModel | None:
    model_name = str(config.get("model_name", "")).lower()
    name_lower = path.name.lower()
    if "supertonic 3" not in model_name and "supertonic-3" not in name_lower:
        return None

    onnx_dir = path / "onnx"
    required = {
        "tts.json",
        "unicode_indexer.json",
        "text_encoder.onnx",
        "duration_predictor.onnx",
        "vector_estimator.onnx",
        "vocoder.onnx",
    }
    missing = sorted(name for name in required if not (onnx_dir / name).is_file())
    if missing:
        return LocalModel(
            id=f"supertonic:{path.resolve()}",
            provider="supertonic-3",
            name=path.name,
            path=str(path.resolve()),
            ready=False,
            reason="필수 ONNX 파일이 부족합니다: " + ", ".join(missing),
            variant="onnx",
            voices=["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"],
        )

    runtime = runtime_available("supertonic")
    return LocalModel(
        id=f"supertonic:{path.resolve()}",
        provider="supertonic-3",
        name=path.name,
        path=str(path.resolve()),
        ready=runtime,
        reason="" if runtime else "supertonic 런타임이 설치되지 않았습니다.",
        variant="onnx",
        voices=["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"],
        runtime="supertonic" if runtime else "",
        metadata={"language": "ko", "cpu_friendly": True},
    )


def _detect_fish(path: Path, config: dict[str, Any]) -> LocalModel | None:
    model_type = str(config.get("model_type", "")).lower()
    name_lower = path.name.lower()
    if "fish_qwen3_omni" not in model_type and "s2-pro" not in name_lower:
        return None

    has_codec = (path / "codec.pth").is_file()
    has_model = _has_model_weights(path)
    if not (has_codec and has_model):
        return LocalModel(
            id=f"fish:{path.resolve()}",
            provider="fish-s2-pro",
            name=path.name,
            path=str(path.resolve()),
            ready=False,
            reason="Fish S2 Pro 체크포인트가 완전하지 않습니다. codec.pth와 모델 가중치가 필요합니다.",
            variant="s2-pro",
        )

    server_url = fish_server_url()
    runtime_root = find_fish_runtime_root()
    local_supported = platform.system() == "Linux"
    ready = bool(server_url) or (runtime_root is not None and local_supported)
    if server_url:
        reason = ""
        runtime = server_url
    elif runtime_root is None:
        reason = "fish-speech 런타임을 찾지 못했습니다. editable 설치, FISH_SPEECH_ROOT 또는 FISH_SPEECH_URL이 필요합니다."
        runtime = ""
    elif not local_supported:
        reason = "Windows에서는 Fish Speech를 WSL/Docker에서 실행하고 FISH_SPEECH_URL로 연결하는 방식을 권장합니다."
        runtime = str(runtime_root)
    else:
        reason = ""
        runtime = str(runtime_root)

    return LocalModel(
        id=f"fish:{path.resolve()}",
        provider="fish-s2-pro",
        name=path.name,
        path=str(path.resolve()),
        ready=ready,
        reason=reason,
        variant="s2-pro",
        voices=["Random timbre (Seed 42)"],
        runtime=runtime,
        metadata={"recommended_vram_gb": 24, "language": "Korean"},
    )


def _candidate_dirs(root: Path, max_depth: int = 3) -> list[Path]:
    if not root.is_dir():
        return []
    result = [root]
    frontier = [(root, 0)]
    seen = {root.resolve()}
    while frontier:
        current, depth = frontier.pop(0)
        if depth >= max_depth:
            continue
        try:
            children = [p for p in current.iterdir() if p.is_dir() and not p.name.startswith(".")]
        except OSError:
            continue
        for child in children:
            resolved = child.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            result.append(child)
            frontier.append((child, depth + 1))
    return result


def scan_models(root: Path) -> list[LocalModel]:
    models: list[LocalModel] = []
    claimed: set[Path] = set()
    for path in _candidate_dirs(root):
        resolved = path.resolve()
        if any(parent in claimed for parent in resolved.parents):
            continue
        config = _read_json(path / "config.json")
        model = (
            _detect_qwen(path, config)
            or _detect_supertonic(path, config)
            or _detect_fish(path, config)
        )
        if model:
            models.append(model)
            claimed.add(resolved)
    return sorted(models, key=lambda item: (item.provider, item.name.lower()))


def runtime_summary() -> dict[str, Any]:
    fish_root = find_fish_runtime_root()
    server_url = fish_server_url()
    return {
        "qwen3-tts": {
            "available": runtime_available("qwen_tts"),
            "install": 'pip install -e ".[local-qwen]"',
        },
        "supertonic-3": {
            "available": runtime_available("supertonic"),
            "install": 'pip install -e ".[local-supertonic]"',
        },
        "fish-s2-pro": {
            "available": bool(server_url) or (fish_root is not None and platform.system() == "Linux"),
            "runtime_root": str(fish_root) if fish_root else "",
            "server_url": server_url,
            "install": "fish-speech를 Linux/WSL/Docker에서 실행한 뒤 FISH_SPEECH_URL을 설정하거나 editable 설치",
        },
    }
