@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if errorlevel 1 goto setup_failed

set "VENV_PY=.venv\Scripts\python.exe"

rem Reuse an existing virtual environment; never erase installed model runtimes.
if exist "%VENV_PY%" goto use_venv
if exist ".venv" goto broken_venv

rem Optional override: set LECTURE_DUB_PYTHON_VERSION=3.11
if defined LECTURE_DUB_PYTHON_VERSION goto override_python

echo [INFO] Looking for an installed Python (3.11 or newer)...
rem Prefer versions used by local TTS runtimes, not the newest interpreter.
for %%V in (3.13 3.12 3.11 3.14 3.15) do (
    py -%%V -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
    if not errorlevel 1 (
        set "PY_VERSION=%%V"
        goto create_with_launcher
    )
)

rem The Python launcher may be absent even when python.exe is installed.
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 goto create_with_python
goto missing_python

:override_python
py -%LECTURE_DUB_PYTHON_VERSION% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 goto invalid_override
set "PY_VERSION=%LECTURE_DUB_PYTHON_VERSION%"

:create_with_launcher
echo [INFO] Creating .venv with Python %PY_VERSION%...
py -%PY_VERSION% -m venv ".venv"
if errorlevel 1 goto setup_failed
goto use_venv

:create_with_python
echo [INFO] Creating .venv with the available python.exe...
python -m venv ".venv"
if errorlevel 1 goto setup_failed
goto use_venv

:use_venv
"%VENV_PY%" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 goto broken_venv
echo [INFO] Using the project's virtual environment:
"%VENV_PY%" --version
echo [INFO] Checking Lecture Dub packages...
"%VENV_PY%" -m pip install -e . --quiet
if errorlevel 1 goto install_failed

rem Only for setup validation in CI; normal users double-click as usual.
if /I "%~1"=="--setup-only" exit /b 0

"%VENV_PY%" -m lecture_dub.cli serve
if errorlevel 1 goto run_failed
exit /b 0

:missing_python
echo [ERROR] Python 3.11 or newer was not found.
echo Install Python (recommended: 3.13) from https://www.python.org/downloads/windows/
echo Then reopen the terminal and run this file again.
goto failed

:invalid_override
echo [ERROR] Python %LECTURE_DUB_PYTHON_VERSION% could not be started by 'py'.
echo Check installed versions with: py -0p
goto failed

:broken_venv
echo [ERROR] The existing .venv is missing a working Python 3.11+ interpreter.
echo To recreate it, close the server and rename .venv to .venv-backup first.
echo Then run this file again. Existing local model dependencies must be reinstalled.
goto failed

:install_failed
echo [ERROR] Installing Lecture Dub packages failed.
echo Check the output above and the selected Python version.
goto failed

:setup_failed
echo [ERROR] Creating the Python virtual environment failed.
goto failed

:run_failed
echo [ERROR] Lecture Dub did not start successfully.
goto failed

:failed
if /I not "%~1"=="--setup-only" pause
exit /b 1
