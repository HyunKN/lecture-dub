@echo off
cd /d "%~dp0"

if exist ".venv\Scripts\pip.exe" (
    .venv\Scripts\pip.exe install -e . --quiet
    .venv\Scripts\python.exe -m lecture_dub.cli serve
) else (
    pip install -e . --quiet
    python -m lecture_dub.cli serve
)

pause
