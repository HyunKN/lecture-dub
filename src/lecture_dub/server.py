from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, UploadFile, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from .extract import extract_english_subtitles
from .subtitles import load_vtt
from .audio import synthesize_timeline

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = ROOT / "output"
WEB_DIR = ROOT / "web"

app = FastAPI(title="Lecture Dub")


# ── Static files & index ──────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return (WEB_DIR / "app.html").read_text(encoding="utf-8")


app.mount("/web", StaticFiles(directory=str(WEB_DIR)), name="web-static")


# ── API: File listing ─────────────────────────────────────────────────

@app.get("/api/files")
async def list_files():
    """Return all VTT and WAV files in output/en and output/ko."""
    result: dict[str, list[dict]] = {"en": [], "ko": []}
    for lang in ("en", "ko"):
        lang_dir = OUTPUT_DIR / lang
        if not lang_dir.is_dir():
            continue
        for f in sorted(lang_dir.iterdir()):
            if f.suffix in (".vtt", ".wav") and f.name != ".gitkeep":
                result[lang].append({
                    "name": f.name,
                    "path": f"{lang}/{f.name}",
                    "size": f.stat().st_size,
                    "type": f.suffix.lstrip("."),
                })
    return result


@app.get("/api/files/{lang}/{filename:path}")
async def serve_file(lang: str, filename: str):
    """Serve a file from output/{lang}/."""
    if lang not in ("en", "ko"):
        return JSONResponse({"error": "Invalid language"}, status_code=400)
    file_path = (OUTPUT_DIR / lang / filename).resolve()
    if not str(file_path).startswith(str(OUTPUT_DIR.resolve())):
        return JSONResponse({"error": "Invalid path"}, status_code=403)
    if not file_path.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)
    media = "audio/wav" if file_path.suffix == ".wav" else "text/vtt"
    return FileResponse(file_path, media_type=media, filename=file_path.name)


@app.delete("/api/files/{lang}/{filename:path}")
async def delete_file(lang: str, filename: str):
    """Delete a file from output/{lang}/."""
    if lang not in ("en", "ko"):
        return JSONResponse({"error": "Invalid language"}, status_code=400)
    file_path = (OUTPUT_DIR / lang / filename).resolve()
    if not str(file_path).startswith(str(OUTPUT_DIR.resolve())):
        return JSONResponse({"error": "Invalid path"}, status_code=403)
    if not file_path.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    file_path.unlink()
    return {"success": True, "message": f"{filename} 삭제 완료"}


@app.post("/api/files/open-explorer")
async def open_explorer(request: Request):
    """Open Windows File Explorer for a file or directory in output/."""
    body = await request.json()
    rel_path = body.get("path", "")
    lang = body.get("lang", "en")

    if rel_path:
        target = (OUTPUT_DIR / rel_path).resolve()
    else:
        target = (OUTPUT_DIR / lang).resolve()

    if not target.is_file():
        target.mkdir(parents=True, exist_ok=True)

    import subprocess
    import sys

    try:
        if sys.platform == "win32":
            target_str = str(target)
            folder_name = target.name if not target.is_file() else target.parent.name
            if target.is_file():
                ps_script = f'''
                $wshell = New-Object -ComObject WScript.Shell
                explorer.exe /select,"{target_str}"
                Start-Sleep -Milliseconds 250
                $wshell.AppActivate("{folder_name}")
                '''
            else:
                ps_script = f'''
                $path = "{target_str}"
                $folder = "{folder_name}"
                $wshell = New-Object -ComObject WScript.Shell
                Invoke-Item $path
                Start-Sleep -Milliseconds 150
                $wshell.AppActivate($folder)
                '''
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script], creationflags=creationflags)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target.parent if target.is_file() else target)])
        else:
            subprocess.Popen(["xdg-open", str(target.parent if target.is_file() else target)])
        return {"success": True}
    except Exception as e:
        return JSONResponse({"error": f"탐색기 열기 실패: {e}"}, status_code=500)


# ── API: Extract subtitles (Step 1) ──────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/api/extract")
async def extract_subtitles(request: Request):
    body = await request.json()
    url = body.get("url", "").strip()
    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    async def stream() -> AsyncGenerator[str, None]:
        yield _sse({"type": "status", "message": "자막 추출을 시작합니다..."})
        try:
            loop = asyncio.get_event_loop()
            paths = await loop.run_in_executor(
                None,
                extract_english_subtitles,
                url,
                OUTPUT_DIR / "en",
                "en.*",
            )
            if not paths:
                yield _sse({"type": "error", "message": "자막 파일을 찾을 수 없습니다."})
                return
            files = [{"name": p.name, "path": f"en/{p.name}"} for p in paths]
            yield _sse({
                "type": "complete",
                "message": f"{len(files)}개의 자막 파일을 추출했습니다.",
                "files": files,
            })
        except Exception as e:
            yield _sse({"type": "error", "message": f"추출 실패: {e}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── API: Upload Korean VTT (Step 2) ──────────────────────────────────

@app.post("/api/upload")
async def upload_vtt(file: UploadFile):
    if not file.filename or not file.filename.endswith(".vtt"):
        return JSONResponse({"error": "VTT 파일만 업로드할 수 있습니다."}, status_code=400)

    ko_dir = OUTPUT_DIR / "ko"
    ko_dir.mkdir(parents=True, exist_ok=True)
    dest = ko_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"name": file.filename, "path": f"ko/{file.filename}", "size": len(content)}


# ── API: TTS Voice Sample Preview ─────────────────────────────────────

@app.get("/api/tts/preview")
async def tts_preview(voice: str = "ko-KR-SunHiNeural"):
    import tempfile, edge_tts
    from fastapi.responses import FileResponse
    sample_text = "안녕하세요. 인공지능 한국어 더빙 목소리 샘플입니다."
    communicate = edge_tts.Communicate(text=sample_text, voice=voice)
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp_path = tmp.name
    tmp.close()
    await communicate.save(tmp_path)
    return FileResponse(tmp_path, media_type="audio/mpeg")


import re

# ── API: Rename File ──────────────────────────────────────────────────

@app.post("/api/files/rename")
async def rename_file(request: Request):
    body = await request.json()
    lang = body.get("lang", "").strip()
    old_name = body.get("old_name", "").strip()
    new_name = body.get("new_name", "").strip()

    if lang not in ("ko", "en") or not old_name or not new_name:
        return JSONResponse({"error": "잘못된 요청 파라미터입니다."}, status_code=400)

    folder = OUTPUT_DIR / lang
    src = (folder / old_name).resolve()
    if not str(src).startswith(str(folder.resolve())) or not src.is_file():
        return JSONResponse({"error": "원본 파일을 찾을 수 없습니다."}, status_code=404)

    old_ext = src.suffix
    if old_ext and not new_name.lower().endswith(old_ext.lower()):
        new_name += old_ext

    safe_new_name = re.sub(r'[\\/*?:"<>|]', "_", new_name)
    dst = (folder / safe_new_name).resolve()

    if dst.exists() and dst != src:
        return JSONResponse({"error": f"이미 동일한 이름의 파일({safe_new_name})이 존재합니다."}, status_code=400)

    try:
        src.rename(dst)
        return {"status": "ok", "old_name": old_name, "new_name": safe_new_name, "new_path": f"{lang}/{safe_new_name}"}
    except Exception as e:
        return JSONResponse({"error": f"이름 변경 실패: {e}"}, status_code=500)


# ── API: Synthesize TTS (Step 3) ─────────────────────────────────────

@app.post("/api/synthesize")
async def synthesize(request: Request):
    body = await request.json()
    vtt_path_str = body.get("vtt", "")
    voice = body.get("voice", "ko-KR-SunHiNeural")
    rate = body.get("rate", "+5%")
    custom_output_name = body.get("output_name", "").strip()

    vtt_path = (OUTPUT_DIR / vtt_path_str).resolve()
    if not str(vtt_path).startswith(str(OUTPUT_DIR.resolve())) or not vtt_path.is_file():
        return JSONResponse({"error": "VTT 파일을 찾을 수 없습니다."}, status_code=400)

    if custom_output_name:
        if not custom_output_name.lower().endswith(".wav"):
            custom_output_name += ".wav"
        safe_name = re.sub(r'[\\/*?:"<>|]', "_", custom_output_name)
        output_wav = OUTPUT_DIR / "ko" / safe_name
    else:
        stem = vtt_path.stem
        if stem.endswith(".en"):
            stem = stem[:-3] + ".ko"
        elif not stem.endswith(".ko"):
            stem = f"{stem}.ko"
        output_wav = OUTPUT_DIR / "ko" / f"{stem}.wav"

    async def stream() -> AsyncGenerator[str, None]:
        yield _sse({"type": "status", "message": "VTT 파일을 읽는 중..."})
        try:
            cues = load_vtt(vtt_path)
            yield _sse({
                "type": "status",
                "message": f"{len(cues)}개 자막 구간을 불러왔습니다. TTS를 시작합니다...",
            })

            # Patch report_progress to send SSE updates
            from . import audio as audio_mod
            original_report = audio_mod.report_progress
            last_sent = {"value": -1}

            def sse_report(stage: str, current: int, total: int) -> None:
                original_report(stage, current, total)
                # Throttle: only send every 5% or on completion
                pct = int(current / total * 100) if total else 0
                if pct - last_sent["value"] >= 5 or current >= total:
                    last_sent["value"] = pct

            audio_mod.report_progress = sse_report

            # We need to yield progress during synthesis. Since synthesize_timeline
            # is async and we want to stream SSE, we run it in a task and poll.
            progress_queue: asyncio.Queue[dict] = asyncio.Queue()
            done_event = asyncio.Event()
            error_holder: list[Exception] = []

            def patched_report(stage: str, current: int, total: int) -> None:
                pct = int(current / total * 100) if total else 0
                if pct - last_sent["value"] >= 3 or current >= total:
                    last_sent["value"] = pct
                    try:
                        progress_queue.put_nowait({
                            "type": "progress",
                            "stage": stage,
                            "current": current,
                            "total": total,
                            "percent": pct,
                        })
                    except asyncio.QueueFull:
                        pass

            audio_mod.report_progress = patched_report

            async def run_synth():
                try:
                    await synthesize_timeline(
                        cues,
                        output=output_wav,
                        voice=voice,
                        rate=rate,
                        keep_segments=False,
                    )
                except Exception as e:
                    error_holder.append(e)
                finally:
                    audio_mod.report_progress = original_report
                    done_event.set()

            task = asyncio.create_task(run_synth())

            while not done_event.is_set():
                try:
                    msg = await asyncio.wait_for(progress_queue.get(), timeout=0.5)
                    yield _sse(msg)
                except asyncio.TimeoutError:
                    pass

            # Drain remaining messages
            while not progress_queue.empty():
                yield _sse(progress_queue.get_nowait())

            await task

            if error_holder:
                yield _sse({"type": "error", "message": f"합성 실패: {error_holder[0]}"})
            else:
                yield _sse({
                    "type": "complete",
                    "message": "한국어 음성 합성이 완료되었습니다.",
                    "wav": {
                        "name": output_wav.name,
                        "path": f"ko/{output_wav.name}",
                    },
                })
        except Exception as e:
            audio_mod.report_progress = original_report
            yield _sse({"type": "error", "message": f"합성 실패: {e}"})

    return StreamingResponse(stream(), media_type="text/event-stream")
