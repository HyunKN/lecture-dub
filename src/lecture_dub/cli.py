from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
from pathlib import Path

from . import __version__
from .audio import missing_ffmpeg_tools, synthesize_timeline
from .extract import extract_english_subtitles
from .subtitles import load_vtt

DEFAULT_VOICE = "ko-KR-SunHiNeural"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lecture-dub",
        description="Create timestamp-aligned Korean lecture audio from WebVTT subtitles.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser(
        "extract", help="Download English subtitles only (no video)."
    )
    extract_parser.add_argument("url")
    extract_parser.add_argument("--output-dir", type=Path, default=Path("output/en"))
    extract_parser.add_argument("--language", default="en.*")

    synth_parser = subparsers.add_parser(
        "synthesize", help="Create a Korean WAV from a translated VTT file."
    )
    synth_parser.add_argument("vtt", type=Path)
    synth_parser.add_argument("--output", type=Path, default=Path("output/ko/korean_dub.wav"))
    synth_parser.add_argument("--voice", default=DEFAULT_VOICE)
    synth_parser.add_argument("--rate", default="+5%")
    synth_parser.add_argument("--keep-segments", action="store_true")

    serve_parser = subparsers.add_parser(
        "serve", help="Launch the web UI (replaces python -m http.server)."
    )
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "extract":
            paths = extract_english_subtitles(args.url, args.output_dir, args.language)
            if not paths:
                print("No subtitle file was created.", file=sys.stderr)
                return 2
            print("Created subtitle files:")
            for path in paths:
                print(f"- {path}")
            return 0

        if args.command == "synthesize":
            cues = load_vtt(args.vtt)
            print(f"Loaded {len(cues)} subtitle cues.")
            asyncio.run(
                synthesize_timeline(
                    cues,
                    output=args.output,
                    voice=args.voice,
                    rate=args.rate,
                    keep_segments=args.keep_segments,
                )
            )
            print(f"Created: {args.output}")
            return 0

        if args.command == "serve":
            import uvicorn

            missing = missing_ffmpeg_tools()
            if missing:
                print(
                    "경고: FFmpeg 도구를 찾을 수 없습니다 ("
                    + ", ".join(missing)
                    + "). Windows에서는 winget install --id Gyan.FFmpeg -e "
                    "실행 후 새 터미널에서 서버를 재시작하세요.",
                    file=sys.stderr,
                )
            print(f"Lecture Dub 웹 앱을 시작합니다: http://{args.host}:{args.port}")
            uvicorn.run(
                "lecture_dub.server_quality:app",
                host=args.host,
                port=args.port,
                log_level="info",
            )
            return 0

    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
