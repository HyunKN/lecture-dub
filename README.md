# Lecture Dub

**영어 YouTube 강의를 한국어 더빙과 영어·한국어 자막으로 공부하는 로컬 플레이어**입니다. 영상을 다시 만들지 않고, 원본 영상에 한국어 음성을 맞춰 재생합니다.

## 1. 설치 및 실행 (Windows)

필요한 것: **Python 3.11 이상**, 인터넷, **FFmpeg/FFprobe**, Chrome 또는 Edge(확장 프로그램 사용 시).

**① FFmpeg 설치**

```powershell
winget install --id Gyan.FFmpeg -e
```

설치 후 **PowerShell을 새로 열어** `ffmpeg -version`, `ffprobe -version`으로 확인합니다.

**② Lecture Dub 실행**

```powershell
git clone https://github.com/HyunKN/lecture-dub.git
cd lecture-dub
.\서버_실행.bat
```

처음 실행하면 **설치된 Python을 자동으로 찾아** `.venv`를 생성하고 필요한 패키지를 설치합니다. 다음부터는 같은 `.venv`를 재사용합니다. 브라우저에서 **http://127.0.0.1:8000** 을 엽니다.

### venv는 왜 사용하나요?

가상환경(`venv`)은 Lecture Dub의 Python 패키지를 **다른 프로젝트와 분리**합니다. 특히 로컬 TTS 모델은 패키지 버전 충돌이 생길 수 있어 권장합니다. **필수는 아니지만**, 실행 파일은 실수로 전역 환경에 패키지를 설치하지 않도록 기본적으로 `.venv`를 사용합니다.

**Python 버전은 고정하지 않습니다.** 설치된 3.13 → 3.12 → 3.11 순서로 우선 확인하고, 없으면 3.14·3.15 또는 사용 가능한 `python`(3.11 이상)을 시도합니다. 로컬 모델 호환성은 버전별로 다를 수 있으므로 **3.11~3.13을 권장**합니다. 이미 만든 `.venv`가 있다면 그 버전을 유지하며, 자동으로 삭제하거나 교체하지 않습니다.

다른 버전을 사용하려면 기존 `.venv`를 **백업하거나 이름을 바꾼 후**, 다음처럼 실행할 수 있습니다.

```powershell
$env:LECTURE_DUB_PYTHON_VERSION = "3.11"
.\서버_실행.bat
```

`venv` 없이 직접 실행할 수도 있지만, 이 경우에는 사용자가 직접 패키지를 설치·관리해야 합니다.

---

## 2. 사용 방법

1. **자막 추출:** YouTube 강의 주소를 입력해 영어 VTT를 가져옵니다.
2. **한국어 자막 준비:** ChatGPT 등으로 영어 VTT를 한국어로 번역한 뒤 업로드합니다. (현재 자동 번역 기능은 없습니다.)
3. **음성 합성:** TTS 목소리와 속도를 고르고 한국어 WAV를 생성합니다.
4. **더빙 재생:** 웹 플레이어 또는 YouTube 확장 프로그램으로 영상과 함께 듣습니다.

### 한국어 VTT 번역 요청 예시

> 영어 강의 VTT를 한국어로 번역해 줘. 타임코드는 유지하고, 코드·변수명·수식·모델명은 원문 그대로 둬. 전문용어는 일관되게, TTS로 읽기 좋게 짧고 자연스럽게 번역한 UTF-8 WebVTT 파일로 제공해 줘.

## 3. 어디서 재생하나요?

- **YouTube에서 바로 보기 (권장):** Chrome의 `chrome://extensions` 또는 Edge의 `edge://extensions`에서 개발자 모드를 켠 뒤 **압축해제된 확장 프로그램을 로드** → 저장소의 `extension/` 폴더 선택. YouTube 영상에서 **Lecture Dub** 버튼을 눌러 WAV와 자막을 등록합니다.
- **웹 플레이어:** Lecture Dub 화면에서 WAV와 VTT를 불러와 재생합니다. 단, 영상 소유자가 외부 임베드를 막았다면 YouTube 확장 프로그램을 사용하세요.

자세한 내용: [확장 프로그램 안내](extension/README.md) · [웹 플레이어 안내](web/README.md)

## 4. TTS 선택

| 엔진 | 특징 |
| --- | --- |
| **Edge TTS (기본)** | 온라인 방식. 별도 모델 설치 없이 사용 가능 |
| Qwen3-TTS | 로컬 체크포인트 사용, GPU 권장 |
| Supertonic 3 | 로컬 ONNX 모델, CPU 사용 가능 |
| Fish Audio S2 Pro | 별도의 로컬 API 실행 필요 |

로컬 모델은 Web UI에서 모델 폴더를 지정해 사용합니다. 설치 방법은 [로컬 모델 안내](docs/local-tts-models.md)를 참고하세요. **처음 사용한다면 Edge TTS를 추천합니다.**

## 5. 문제가 생겼나요?

**‘FFmpeg 또는 FFprobe를 찾을 수 없습니다’가 표시되는 경우**

1. 위 `winget` 명령으로 FFmpeg를 설치합니다.
2. **새 PowerShell**에서 `ffmpeg -version`, `ffprobe -version`이 모두 실행되는지 확인합니다.
3. 실행 중인 Lecture Dub 서버를 종료하고 **새 터미널에서 다시 실행**합니다.
4. 웹 화면의 **설치 후 다시 확인** 버튼을 누릅니다.

설치했는데도 인식되지 않는다면 `where.exe ffmpeg`와 `where.exe ffprobe`로 경로를 확인하고, 설치 경로의 `bin` 폴더가 Windows `PATH` 환경변수에 있는지 확인하세요. **가상환경의 pip로 FFmpeg를 다시 설치하는 문제는 아닙니다.**

**음성 싱크가 조금 어긋나는 경우:** 플레이어의 0.1초 단위 보정 기능을 사용하세요.

**영상이 웹 플레이어에서 나오지 않는 경우:** YouTube 영상의 외부 임베드가 차단됐을 수 있습니다. 확장 프로그램으로 재생하세요.

## 라이선스

Lecture Dub 코드는 [MIT License](LICENSE)를 따릅니다. 외부 TTS 모델과 콘텐츠에는 각자의 라이선스가 적용됩니다.
