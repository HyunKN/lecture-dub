# Lecture Dub

영어 YouTube 강의를 **한국어 음성 + 영어·한국어 자막**으로 함께 학습할 수 있는 로컬 도구입니다.

영상은 다시 인코딩하지 않습니다. 영어 자막을 가져오고, 번역한 한국어 자막으로 더빙 음성을 만든 뒤 영상 시간에 맞춰 재생합니다.

## 이 도구를 쓰면 좋은 점


- 긴 영어 강의를 한국어 더빙으로 들을 수 있습니다.
- 영어 원문과 한국어 자막을 같이 확인할 수 있습니다.
- 자막 추출 → 한국어 VTT 등록 → TTS 생성 → 재생을 한 Web UI에서 진행할 수 있습니다.
- 기본 Edge TTS뿐 아니라 **사용자가 직접 받은 로컬 TTS 모델**도 선택해서 사용할 수 있습니다.
- 로컬 모델 가중치는 GitHub에 올리지 않고 PC/외장 SSD의 원하는 폴더에서 관리할 수 있습니다.
- 외부 임베드가 차단된 영상도 **YouTube 실제 시청 페이지에서 확장 프로그램으로 사용할 수 있습니다.**


## 사용 흐름

```mermaid
flowchart TD

    A["YouTube 강의 선택"] --> B["영어 자막 추출·한국어 번역"]
    B --> C["한국어 음성 생성"]
    C --> D["YouTube에서 더빙과 함께 재생"]

    A["YouTube 강의"] --> B["영어 자막 추출"]
    B --> C["한국어 자막 준비"]
    C --> D["TTS 선택 · 더빙 생성"]
    D --> E["영상과 동기화 재생" or "YouTube에서 더빙과 함께 재생"]

```

## 빠른 시작

- Python 3.11 이상
- FFmpeg와 FFprobe
- 인터넷 연결
- 자막이 제공되는 YouTube 강의
- Chrome 또는 Edge (YouTube 확장 프로그램 사용 시)

한국어 번역은 현재 자동 API가 아니라 ChatGPT 같은 번역 도구를 이용해 직접 준비합니다.

## 1. 설치

```powershell
git clone https://github.com/HyunKN/lecture-dub.git
cd lecture-dub

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
```

Windows에서 FFmpeg가 없다면:

```powershell
winget install Gyan.FFmpeg
```

새 PowerShell을 열고 확인합니다.

```powershell
ffmpeg -version
ffprobe -version
```

### 2. Web UI 실행

```powershell
lecture-dub serve
```

브라우저에서:

```text
http://127.0.0.1:8000
```

Web UI에서 다음 순서로 진행합니다.

1. YouTube URL을 넣고 영어 자막 추출
2. 영어 VTT를 한국어로 번역한 뒤 한국어 VTT 등록
3. TTS 엔진·목소리·속도 선택
4. 한국어 WAV 생성
5. 플레이어에서 영상과 함께 재생

한국어 번역은 현재 ChatGPT 같은 번역 도구를 이용해 준비합니다.

## TTS 선택

처음 설치하면 기존 **Edge TTS**가 바로 동작합니다.

```text
TTS 방식
├─ Edge TTS
├─ Qwen3-TTS          ← 로컬 모델이 있으면 자동 표시
├─ Supertonic 3       ← 로컬 모델이 있으면 자동 표시
└─ Fish Audio S2 Pro  ← 로컬 모델 + 실행 환경이 있으면 표시
```

### 로컬 모델은 GitHub에 넣지 않습니다

기본 검색 위치는 저장소의 `models/`지만, 다른 위치를 지정할 수 있습니다.

```text
D:\AI\Models
├─ Qwen3-TTS-12Hz-1.7B-CustomVoice
├─ supertonic-3
└─ s2-pro
```

Web UI의 **Step 3 → TTS 엔진과 로컬 모델**에서 `D:\AI\Models`만 지정하면 하위 폴더를 검색합니다.

Lecture Dub은 각각을 다음처럼 구분해서 보여줍니다.

```text
✓ 모델 파일 있음 + 런타임 있음  → 사용 가능
! 모델 파일 있음 + 런타임 없음  → 모델 발견 · 런타임 설치 필요
  모델 파일 없음                → 선택 목록에 표시하지 않음
```

등록한 모델 폴더는 `~/.lecture-dub/settings.json`에 저장되어 다음 실행에도 유지됩니다.

자세한 모델 폴더 구조와 설치 방법은 [`docs/local-tts-models.md`](docs/local-tts-models.md)를 참고하세요.

### Qwen3-TTS / Supertonic 런타임 설치

Qwen3-TTS:

```powershell
pip install -e ".[local-qwen]"
```

Supertonic 3:

## 5. YouTube에서 바로 듣기 — 권장

외부 플레이어에 영상을 삽입하지 않고 **원래 YouTube 페이지 위에 더빙 기능을 추가**합니다. 영상 소유자가 외부 임베드를 막아둔 강의도 YouTube에서 정상 시청할 수 있다면 이 방식으로 사용할 수 있습니다.

### 확장 프로그램 설치

1. Chrome에서는 `chrome://extensions`, Edge에서는 `edge://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드**를 누릅니다.
4. 이 저장소의 `extension/` 폴더를 선택합니다.

### 사용 순서

1. YouTube에서 강의를 평소처럼 엽니다.
2. 화면 오른쪽 아래의 **Lecture Dub** 버튼을 누릅니다.
3. 생성한 한국어 WAV를 선택합니다.
4. 필요하면 한국어 VTT와 영어 VTT도 선택합니다.
5. **더빙 시작**을 누릅니다.
6. 이후에는 YouTube의 재생·일시정지·탐색·배속을 그대로 사용합니다.

한국어 WAV만 있으면 더빙을 들을 수 있고, 영어·한국어 VTT는 자막 표시를 위한 선택 항목입니다.

확장 프로그램은 다음을 YouTube 영상에 맞춰 동기화합니다.

- 재생 / 일시정지
- 영상 탐색(seek)
- 재생 속도
- 현재 재생 시간
- 0.1초 단위 수동 싱크 보정

기본적으로 YouTube 원음은 음소거하며 패널에서 변경할 수 있습니다. 더빙 음량도 별도로 조절할 수 있습니다.

자세한 설치와 사용법은 [`extension/README.md`](extension/README.md)를 참고하세요.

> 이 확장 프로그램은 YouTube의 접근 제한을 우회하지 않습니다. 사용자가 원래 YouTube에서 볼 수 있는 영상의 재생 시간에 로컬 더빙 파일을 맞춰 재생합니다.

## 6. 별도 웹 플레이어에서 듣기 — 대안

YouTube 임베드가 허용된 영상은 기존 웹 플레이어에서도 사용할 수 있습니다.
```powershell
pip install -e ".[local-supertonic]"
```

둘 다:

```powershell
pip install -e ".[local]"
```

모델 가중치는 위 명령으로 Lecture Dub 저장소에 설치되지 않습니다. 사용자가 별도로 내려받은 모델 폴더를 Web UI에 연결합니다.

### Fish Audio S2 Pro

페이지에서 YouTube 강의 URL, 한국어 WAV, 영어 VTT, 한국어 VTT를 준비한 뒤 `동기화 재생`을 누릅니다.
Fish S2 Pro는 훨씬 무거운 실행 환경을 요구하므로 기본 설치에 포함하지 않습니다. Linux에서 fish-speech 런타임을 별도로 설치하거나, Windows에서는 WSL/Docker의 Fish Speech 서버에 연결하는 방식을 권장합니다.

예:

```powershell
$env:FISH_SPEECH_URL="http://127.0.0.1:8080"
lecture-dub serve
```

### 웹 플레이어와 확장 프로그램의 차이

| 방식 | 장점 | 제한 |
| --- | --- | --- |
| YouTube 확장 프로그램 | 원래 YouTube 페이지에서 바로 사용, 임베드 제한 영향 없음 | Chrome/Edge에 로컬 확장 설치 필요 |
| 별도 웹 플레이어 | 독립된 학습 화면과 자막 UI | 영상 소유자가 외부 임베드를 막으면 재생 불가 |
## 한국어 자막 번역 예시

추출한 영어 VTT를 번역 도구에 올리고 다음처럼 요청할 수 있습니다.

```text
이 영어 강의 VTT를 한국어로 번역해줘.

조건:
- 타임코드 유지
- 코드, 변수명, 수식, 모델명은 원문 유지
- 전문용어를 정확하고 일관되게 번역
- TTS로 읽기 좋게 짧고 자연스럽게 번역
- 결과를 UTF-8 WebVTT 파일로 제공
```

## 파일 위치

```text
output/
├─ en/
│  └─ lecture.en.vtt
└─ ko/
   ├─ lecture.ko.vtt
   └─ lecture.ko.wav

`output/` 아래의 실제 강의 파일은 Git에 포함되지 않습니다.

## 자주 묻는 질문

### 한국어 번역도 자동으로 해주나요?

현재는 아닙니다. 영어 자막 추출과 한국어 음성 생성은 Lecture Dub이 처리하고, 한국어 VTT는 사용자가 번역 도구로 준비합니다.

### 영상도 다운로드하나요?

아닙니다. 자막만 추출하며 영상은 YouTube에서 그대로 재생합니다.
models/
└─ .gitkeep
```

`output/`의 생성 파일과 `models/`의 실제 모델 가중치는 Git에 포함되지 않습니다.

## CLI로 사용하는 기존 방식

확장 프로그램과 기존 정적 웹 플레이어에서 선택한 WAV/VTT는 현재 브라우저에서 로컬 파일로 읽습니다.
영어 자막만 추출:

```powershell
lecture-dub extract "https://www.youtube.com/watch?v=VIDEO_ID"
```

Edge TTS로 WAV 생성:

```powershell
lecture-dub synthesize output\ko\lecture.ko.vtt `
  --output output\ko\lecture.ko.wav `
  --voice ko-KR-SunHiNeural `
  --rate "+8%"
```

`싱크 보정`에서 0.1초씩 앞뒤로 조정할 수 있습니다.

### 웹 플레이어에서 “동영상 소유자가 다른 웹사이트에서 재생할 수 없도록 설정”이라고 나옵니다.

영상 소유자가 YouTube 외부 임베드를 막은 경우입니다. **YouTube 확장 프로그램 방식을 사용하면 별도 iframe에 영상을 넣지 않고 원래 YouTube 페이지에서 더빙을 붙일 수 있습니다.**

## 현재 제한 사항

- 한국어 번역은 자동화되어 있지 않습니다.
- YouTube에 영어 자막이 없으면 자막 추출을 사용할 수 없습니다.
- 확장 프로그램은 현재 Chromium 기반 Chrome/Edge를 대상으로 합니다.
- YouTube 페이지 구조가 크게 바뀌면 확장 프로그램의 플레이어 탐지 로직을 업데이트해야 할 수 있습니다.
- `edge-tts`는 온라인 Microsoft Edge 음성 서비스를 사용하는 비공식 라이브러리이므로 서비스 변경의 영향을 받을 수 있습니다.
- 현재 목표는 개인 학습용 로컬 사용입니다. 생성한 음성이나 자막을 공개 배포하기 전에는 원본 콘텐츠와 사용 서비스의 조건을 확인해야 합니다.
로컬 모델 선택과 자동 검색은 현재 Web UI에서 제공합니다.

## 현재 제한 사항

- 한국어 번역 자체는 자동화되어 있지 않습니다.
- YouTube에 영어 자막이 없으면 자막 추출을 할 수 없습니다.
- Qwen3-TTS Base의 voice cloning은 참조 음성 UI가 필요하므로 현재 자동 모델 선택에서는 비활성 상태로 표시됩니다.
- Fish Audio S2 Pro는 Qwen/Supertonic보다 설치와 하드웨어 요구사항이 큽니다.
- 각 TTS 모델과 런타임에는 Lecture Dub과 별도의 라이선스가 적용됩니다.

## 개발 및 테스트

```powershell
pytest -q
node --check web\player.js
node --check extension\content.js
node --check web\app.js
node --check web\local-models.js
```

확장 프로그램의 `manifest.json`은 Manifest V3 형식을 사용합니다.

## 라이선스

Lecture Dub 자체 코드는 MIT License를 따릅니다. 함께 사용하는 외부 라이브러리, TTS 모델 및 온라인 서비스에는 각각의 별도 라이선스와 이용 조건이 적용됩니다.
