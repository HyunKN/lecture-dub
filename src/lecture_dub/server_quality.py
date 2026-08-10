from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from .server_local import app as existing_app
from .server_local import index as existing_index
from .subtitle_quality import rank_english_vtts

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = ROOT / "output"

app = FastAPI(title="Lecture Dub")


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    response = await existing_index()
    html = response.body.decode("utf-8")
    injection = '<script src="/web/subtitle-quality.js"></script>\n'
    if injection not in html:
        html = html.replace("</body>", f"  {injection}</body>")
    return HTMLResponse(html)


@app.get("/api/subtitle-quality")
async def subtitle_quality():
    files = await asyncio.to_thread(rank_english_vtts, OUTPUT_DIR / "en")
    return {
        "files": [item.to_dict() for item in files],
        "policy": {
            "basis": "content-quality",
            "filename_bonus": False,
            "signals": [
                "inline_timestamp_ratio",
                "duplicate_ratio",
                "short_cue_ratio",
                "cues_per_minute",
                "relative_file_size",
                "duration_coverage",
            ],
        },
    }


# Keep the complete existing Lecture Dub app untouched. The quality routes above are
# registered first; every other API/static route falls through to the current app.
app.mount("/", existing_app)
