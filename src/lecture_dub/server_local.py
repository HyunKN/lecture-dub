from __future__ import annotations

import asyncio
import json
import re
import tempfile
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.background import BackgroundTask
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse

from .model_registry import (
    get_models_root,
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


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


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
    }


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (WEB_DIR / "app.html").read_text(encoding="utf-8")
    injection = '<script src="/web/local-models.js"></script>\n'
    if injection not in html:
        html = html.replace("</body>", f"  {injection}</body>")
    return HTMLResponse(html)


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

    output_wav = _resolve_output(vtt_path, custom_output_name)

    async def stream() -> AsyncGenerator[str, None]:
        yield _sse({"type": "status", "message": "VTT 파일을 읽는 중..."})
        try:
            cues = load_vtt(vtt_path)
            yield _sse({
                "type": "status",
                "message": f"{len(cues)}개 자막 구간을 불러왔습니다. {engine} 합성을 시작합니다...",
            })

            progress_queue: asyncio.Queue[dict] = asyncio.Queue()
            done_event = asyncio.Event()
            error_holder: list[Exception] = []
            last_sent = {"key": ("", -1)}

            def progress(stage: str, current: int, total: int) -> None:
                percent = int(current / total * 100) if total else 0
                key = (stage, percent)
                previous_stage, previous_percent = last_sent["key"]
                if stage != previous_stage or percent - previous_percent >= 3 or current >= total:
                    last_sent["key"] = key
                    try:
                        progress_queue.put_nowait({
                            "type": "progress",
                            "stage": stage,
                            "current": current,
                            "total": total,
                            "percent": percent,
                        })
                    except asyncio.QueueFull:
                        pass

            async def run_synth() -> None:
                try:
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
                except Exception as exc:
                    error_holder.append(exc)
                finally:
                    done_event.set()

            task = asyncio.create_task(run_synth())
            while not done_event.is_set():
                try:
                    yield _sse(await asyncio.wait_for(progress_queue.get(), timeout=0.5))
                except asyncio.TimeoutError:
                    pass

            while not progress_queue.empty():
                yield _sse(progress_queue.get_nowait())
            await task

            if error_holder:
                yield _sse({"type": "error", "message": f"합성 실패: {error_holder[0]}"})
            else:
                yield _sse({
                    "type": "complete",
                    "message": "한국어 음성 합성이 완료되었습니다.",
                    "wav": {"name": output_wav.name, "path": f"ko/{output_wav.name}"},
                })
        except Exception as exc:
            yield _sse({"type": "error", "message": f"합성 실패: {exc}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


# Keep every existing route/static asset unchanged. The local-model routes above are
# registered first, so they override only the endpoints that need provider awareness.
app.mount("/", legacy_app)
