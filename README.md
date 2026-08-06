# lecture-dub

영어 강의의 WebVTT 자막을 한국어로 번역한 뒤, 무료 TTS로 타임라인에 맞춘 한국어 음성 파일을 만드는 CLI입니다.

## 사용자 사용 흐름

```mermaid
flowchart LR
    A["강의 URL 입력"] --> B["영어 VTT 자막 추출"]
    B --> C["자막 품질 확인"]
    C --> D["번역 도구로 한국어 VTT 생성"]
    D --> E["한국어 TTS 생성"]
    E --> F["자막 시간에 맞게 음성 정렬"]
    F --> G["한국어 더빙 WAV 생성"]
    G --> H["영상과 함께 재생"]
```

현재 MVP는 영상 자체를 다운로드하지 않습니다. 영어 자막 추출과 한국어 음성 생성은 CLI가 처리하고, 번역된 한국어 VTT는 ChatGPT Plus 같은 번역 도구로 준비합니다.

## 비용

- `yt-dlp`: 무료
- `edge-tts`: API 키 없이 사용
- FFmpeg: 무료
- 번역: 현재 구독 중인 ChatGPT Plus에서 VTT 파일을 수동 번역
- 별도의 OpenAI API는 사용하지 않습니다.

> `edge-tts`는 온라인 Microsoft Edge 음성 서비스를 사용하는 비공식 라이브러리이므로 서비스 변경에 따라 동작이 달라질 수 있습니다.

## 요구 사항

- Python 3.11 이상
- FFmpeg와 FFprobe
- 인터넷 연결 (`yt-dlp`, `edge-tts` 사용 시)

### Windows에서 FFmpeg 설치

```powershell
winget install Gyan.FFmpeg
```

새 PowerShell을 열고 확인합니다.

```powershell
ffmpeg -version
ffprobe -version
```

## 설치

```powershell
git clone https://github.com/HyunKN/lecture-dub.git
cd lecture-dub

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
```

## 1. 영어 자막 추출

영상은 받지 않고 사람이 작성한 영어 자막 또는 자동 영어 자막만 가져옵니다.

```powershell
lecture-dub extract "https://www.youtube.com/watch?v=VIDEO_ID"
```

결과는 기본적으로 `output/`에 저장됩니다.

```text
output/
└─ 강의 제목 [VIDEO_ID].en.vtt
```

영상에 자막이 없거나 YouTube 측 요청 제한이 발생하면 추출이 실패할 수 있습니다.

## 2. ChatGPT Plus에서 한국어로 번역

생성된 영어 VTT 파일을 ChatGPT에 올린 뒤 다음처럼 요청합니다.

```text
이 영어 강의 VTT를 한국어로 번역해줘.

조건:
- 모든 타임코드를 그대로 유지
- 코드, 변수명, 수식, 모델명은 원문 유지
- 딥러닝 전문용어를 정확하고 일관되게 번역
- TTS로 읽기 좋게 짧고 자연스럽게 번역
- 결과를 UTF-8 WebVTT 파일로 제공
```

번역 결과를 예를 들어 `output/lecture.ko.vtt`로 저장합니다.

## 3. 한국어 더빙 WAV 생성

```powershell
lecture-dub synthesize output\lecture.ko.vtt
```

기본 결과:

```text
output/korean_dub.wav
```

음성과 속도를 바꿀 수도 있습니다.

```powershell
lecture-dub synthesize output\lecture.ko.vtt `
  --output output\cs231n-lecture01.ko.wav `
  --voice ko-KR-SunHiNeural `
  --rate "+8%"
```

실행 중에는 다음 두 단계의 진행률이 표시됩니다.

```text
TTS 생성 [########----------------------] 120/455 (26.4%)
WAV 조립 [##############################] 455/455 (100.0%)
```

- `TTS 생성`: 각 자막 문장을 음성으로 만들고 FFmpeg로 구간 길이를 맞추는 단계
- `WAV 조립`: 준비된 음성 조각을 원래 자막 타임라인에 배치하는 단계

TTS가 다음 자막 시작 시각보다 길면 FFmpeg가 해당 구간만 빠르게 조정합니다. 원문에 비해 번역문이 지나치게 길면 음성이 부자연스럽게 빨라질 수 있으므로, 번역 단계에서 문장을 짧게 만드는 것이 중요합니다.

## 영상과 같이 듣기

현재 MVP는 YouTube 영상 자체를 다운로드하거나 수정하지 않습니다. 만들어진 WAV를 로컬 영상과 함께 쓰려면 mpv 같은 플레이어에서 외부 오디오로 불러올 수 있습니다.

```powershell
mpv lecture.mp4 --audio-file=output\korean_dub.wav
```

YouTube 웹 플레이어와 직접 동기화하는 브라우저 확장 기능은 후속 단계입니다.

## 개발 및 테스트

```powershell
pytest -q
```

## 주의 사항

- 자막과 영상의 이용 권한 및 YouTube 이용약관을 확인하세요.
- 생성한 더빙 영상이나 음성을 허가 없이 재배포하지 마세요.
- 이 프로젝트는 개인 학습용 로컬 워크플로를 우선 대상으로 합니다.

## 다음 목표

- 번역 VTT 품질 검사
- 중복 자동 자막 정리 및 문장 병합
- TTS 생성 재시도와 캐시
- YouTube 웹 플레이어 동기화 브라우저 확장
