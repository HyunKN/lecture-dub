from __future__ import annotations

import asyncio
import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.background import BackgroundTask

from .audio import missing_ffmpeg_tools
from .model_registry import (
    get_models_root,
    gpu_acceleration_summary,
    runtime_summary,
    scan_models,
    set_models_root,
)
from .server import app as legacy_app
from .subtitles import load_vtt
from .tts_providers import (
    ProviderSelection,
    preview_with_provider,
    synthesize_timeline_with_provider,
)

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = ROOT / "output"
WEB_DIR = ROOT / "web"
DEFAULT_MODELS_DIR = ROOT / "models"

app = FastAPI(title="Lecture Dub")


@dataclass(slots=True)
class SynthesisJob:
    id: str
    status: str = "running"
    message: str = "TTS 생성 작업 준비 중..."
    stage: str = ""
    current: int = 0
    total: int = 0
    percent: int = 0
    wav: dict[str, str] | None = None
    error: str = ""
    task: asyncio.Task[None] | None = None


_SYNTH_JOBS: dict[str, SynthesisJob] = {}


def _job_payload(job: SynthesisJob) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "message": job.message,
        "stage": job.stage,
        "current": job.current,
        "total": job.total,
        "percent": job.percent,
        "wav": job.wav,
        "error": job.error,
    }


def _models_root() -> Path:
    return get_models_root(DEFAULT_MODELS_DIR)


def _model_payload() -> dict:
    root = _models_root()
    models = scan_models(root)
    return {
        "root": str(root.resolve()) if root.exists() else str(root),
        "exists": root.is_dir(),
        "models": [model.to_dict() for model in models],
        "runtimes": runtime_summary(),
        "acceleration": gpu_acceleration_summary(),
    }


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (WEB_DIR / "app.html").read_text(encoding="utf-8")
    injection = '<script src="/web/local-models.js?v=20260809-3"></script>\n'
    if injection not in html:
        html = html.replace("</body>", f"  {injection}</body>")
    return HTMLResponse(html)


@app.get("/api/system/ffmpeg")
async def ffmpeg_status():
    """Inspect dependencies in the same process that runs synthesis."""
    missing = missing_ffmpeg_tools()
    return {
        "ready": not missing,
        "missing": missing,
        "message": (
            "FFmpeg가 준비되었습니다."
            if not missing
            else "FFmpeg 또는 FFprobe를 찾을 수 없습니다 ("
            + ", ".join(missing)
            + "). 설치 후 새 터미널에서 서버를 재시작하세요."
        ),
        "install_command": "winget install --id Gyan.FFmpeg -e",
    }


@app.get("/api/models")
async def list_local_models():
    return _model_payload()


@app.post("/api/models/root")
async def configure_models_root(request: Request):
    body = await request.json()
    raw_path = str(body.get("path", "")).strip()
    if not raw_path:
        return JSONResponse({"error": "모델 폴더 경로를 입력해 주세요."}, status_code=400)
    try:
        set_models_root(Path(raw_path))
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return _model_payload()


def _pick_directory(initial: Path) -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise RuntimeError("이 Python 환경에는 tkinter가 없어 폴더 선택창을 열 수 없습니다.") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        return filedialog.askdirectory(
            title="Lecture Dub 로컬 TTS 모델 폴더 선택",
            initialdir=str(initial) if initial.is_dir() else str(Path.home()),
            mustexist=True,
        )
    finally:
        root.destroy()


@app.post("/api/models/pick-root")
async def pick_models_root():
    try:
        chosen = await asyncio.to_thread(_pick_directory, _models_root())
        if not chosen:
            return {"cancelled": True, **_model_payload()}
        set_models_root(Path(chosen))
        return {"cancelled": False, **_model_payload()}
    except (RuntimeError, ValueError, OSError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/api/tts/preview")
async def tts_preview(
    engine: str = "edge",
    model_id: str = "",
    voice: str = "ko-KR-SunHiNeural",
    rate: str = "+5%",
):
    suffix = ".mp3" if engine == "edge" else ".wav"
    media_type = "audio/mpeg" if engine == "edge" else "audio/wav"
    handle = tempfile.NamedTemporaryFile(prefix="lecture-dub-preview-", suffix=suffix, delete=False)
    output = Path(handle.name)
    handle.close()
    try:
        await preview_with_provider(
            "안녕하세요. 인공지능 한국어 더빙 목소리 샘플입니다.",
            output,
            ProviderSelection(engine=engine, model_id=model_id, voice=voice, rate=rate),
            _models_root(),
        )
    except Exception as exc:
        output.unlink(missing_ok=True)
        return JSONResponse({"error": f"미리듣기 생성 실패: {exc}"}, status_code=400)
    return FileResponse(
        output,
        media_type=media_type,
        background=BackgroundTask(output.unlink, missing_ok=True),
    )


def _resolve_output(vtt_path: Path, custom_output_name: str) -> Path:
    if custom_output_name:
        if not custom_output_name.lower().endswith(".wav"):
            custom_output_name += ".wav"
        safe_name = re.sub(r'[\\/*?:"<>|]', "_", custom_output_name)
        return OUTPUT_DIR / "ko" / safe_name

    stem = vtt_path.stem
    if stem.endswith(".en"):
        stem = stem[:-3] + ".ko"
    elif not stem.endswith(".ko"):
        stem = f"{stem}.ko"
    return OUTPUT_DIR / "ko" / f"{stem}.wav"


@app.post("/api/synthesize")
async def synthesize(request: Request):
    body = await request.json()
    vtt_path_str = str(body.get("vtt", ""))
    engine = str(body.get("engine", "edge"))
    model_id = str(body.get("model_id", ""))
    voice = str(body.get("voice", "ko-KR-SunHiNeural"))
    rate = str(body.get("rate", "+5%"))
    custom_output_name = str(body.get("output_name", "")).strip()

    vtt_path = (OUTPUT_DIR / vtt_path_str).resolve()
    if not str(vtt_path).startswith(str(OUTPUT_DIR.resolve())) or not vtt_path.is_file():
        return JSONResponse({"error": "VTT 파일을 찾을 수 없습니다."}, status_code=400)
    if engine != "edge" and not model_id:
        return JSONResponse({"error": "로컬 TTS 모델을 선택해 주세요."}, status_code=400)

    missing = missing_ffmpeg_tools()
    if missing:
        return JSONResponse(
            {
                "error": (
                    "FFmpeg 또는 FFprobe를 찾을 수 없습니다 ("
                    + ", ".join(missing)
                    + "). 설치 후 서버를 재시작하세요."
                ),
                "missing": missing,
                "install_command": "winget install --id Gyan.FFmpeg -e",
            },
            status_code=503,
        )

    output_wav = _resolve_output(vtt_path, custom_output_name)

    job = SynthesisJob(id=uuid4().hex)
    _SYNTH_JOBS[job.id] = job

    async def run_synth() -> None:
        try:
            cues = load_vtt(vtt_path)
            job.message = f"{len(cues)}개 자막 구간을 불러왔습니다. {engine} 합성을 시작합니다..."

            def progress(stage: str, current: int, total: int) -> None:
                job.stage = stage
                job.current = current
                job.total = total
                job.percent = int(current / total * 100) if total else 0
                job.message = f"{stage} ({current}/{total})"

            await synthesize_timeline_with_provider(
                cues,
                output=output_wav,
                selection=ProviderSelection(
                    engine=engine,
                    model_id=model_id,
                    voice=voice,
                    rate=rate,
                ),
                models_root=_models_root(),
                keep_segments=False,
                progress=progress,
            )
            job.status = "complete"
            job.percent = 100
            job.message = "한국어 음성 합성이 완료되었습니다."
            job.wav = {"name": output_wav.name, "path": f"ko/{output_wav.name}"}
        except Exception as exc:
            job.status = "error"
            job.error = f"합성 실패: {exc}"
            job.message = job.error

    job.task = asyncio.create_task(run_synth())
    return JSONResponse(_job_payload(job), status_code=202)


@app.get("/api/synthesize/{job_id}")
async def synthesize_status(job_id: str):
    job = _SYNTH_JOBS.get(job_id)
    if job is None:
        return JSONResponse({"error": "합성 작업을 찾을 수 없습니다. 서버가 재시작됐을 수 있습니다."}, status_code=404)
    return _job_payload(job)


# Keep every existing route/static asset unchanged. The local-model routes above are
# registered first, so they override only the endpoints that need provider awareness.
app.mount("/", legacy_app)
