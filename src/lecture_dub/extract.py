from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def extract_english_subtitles(url: str, output_dir: Path, language: str = "en.*") -> list[Path]:
    """Download human or automatic English subtitles without downloading the video."""
    output_dir.mkdir(parents=True, exist_ok=True)
    template = str(output_dir / "%(title).120B [%(id)s].%(ext)s")
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        language,
        "--sub-format",
        "vtt",
        "--output",
        template,
        url,
    ]
    subprocess.run(command, check=True)
    return sorted(output_dir.glob("*.vtt"), key=lambda path: path.stat().st_mtime, reverse=True)
