# 로컬 TTS 모델 사용

Lecture Dub은 TTS 모델 가중치를 저장소에 포함하지 않습니다. 사용자가 모델을 원하는 위치에 내려받고, Web UI에서 **상위 모델 폴더 하나만 등록**하면 하위 폴더를 검색해 지원 모델을 자동으로 찾습니다.

## 지원 모델

| 모델 | Lecture Dub 연동 | 실행 환경 |
| --- | --- | --- |
| Qwen3-TTS CustomVoice / VoiceDesign | 직접 Python 추론 | `qwen-tts` 런타임, GPU 권장 |
| Supertonic 3 | 직접 ONNX 추론 | `supertonic` 런타임, CPU 사용 가능 |
| Fish Audio S2 Pro | Fish Speech 로컬 API 연동 | Linux/WSL/Docker + 대용량 GPU 권장 |
| Edge TTS | 기존 방식 유지 | 인터넷 연결 |

Qwen3-TTS `Base` 체크포인트도 감지는 하지만, Base 모델은 참조 음성 입력이 필요하므로 현재 Web UI에서는 `모델 발견 · 아직 사용 불가`로 표시합니다.

## 모델 폴더는 어디에 두나요?

기본 검색 위치는 저장소의 `models/`입니다.

```text
lecture-dub/
└─ models/
   ├─ Qwen3-TTS-12Hz-1.7B-CustomVoice/
   ├─ supertonic-3/
   └─ s2-pro/
```

하지만 저장소 안에 둘 필요는 없습니다. 예를 들어 별도 SSD의 다음 폴더를 사용할 수 있습니다.

```text
D:\AI\Models
├─ Qwen3-TTS-12Hz-1.7B-CustomVoice
├─ supertonic-3
└─ s2-pro
```

Web UI의 **TTS 엔진과 로컬 모델 → 로컬 모델 상위 폴더**에서 `D:\AI\Models`를 지정하면 됩니다. 설정은 사용자 홈의 다음 파일에 저장됩니다.

```text
~/.lecture-dub/settings.json
```

다음 실행부터 같은 폴더를 자동으로 다시 검색합니다.

## 가중치 파일만 있으면 되나요?

아닙니다. 모델은 두 부분이 모두 필요합니다.

```text
모델 폴더
+ 실행 런타임
= Lecture Dub에서 사용 가능
```

Lecture Dub은 두 상태를 따로 확인합니다.

- 모델 폴더가 없으면: 목록에 표시하지 않음
- 모델은 있지만 런타임이 없으면: `모델 발견 · 런타임 미설치`
- 둘 다 있으면: `사용 가능`

모델 폴더는 Hugging Face 체크포인트를 `--local-dir`로 받은 **폴더 전체**를 두는 것이 가장 안전합니다. 단일 `.safetensors` 파일만 복사하는 방식은 tokenizer/config/voice-style 같은 부속 파일이 빠질 수 있습니다.

## Qwen3-TTS

런타임을 설치합니다.

```powershell
pip install -e ".[local-qwen]"
```

또는 Supertonic까지 같이 설치하려면:

```powershell
pip install -e ".[local]"
```

예시 모델 폴더:

```text
D:\AI\Models\Qwen3-TTS-12Hz-1.7B-CustomVoice\
├─ config.json
├─ model-....safetensors
├─ tokenizer / processor 관련 파일
└─ ...
```

현재 CustomVoice의 한국어 기본 화자로 `Sohee`를 사용합니다. VoiceDesign 모델은 한국어 강의자 톤 지시문으로 음색을 생성합니다.

## Supertonic 3

런타임을 설치합니다.

```powershell
pip install -e ".[local-supertonic]"
```

모델 폴더에는 최소한 다음 구조가 있어야 합니다.

```text
D:\AI\Models\supertonic-3\
├─ config.json
├─ onnx\
│  ├─ tts.json
│  ├─ unicode_indexer.json
│  ├─ text_encoder.onnx
│  ├─ duration_predictor.onnx
│  ├─ vector_estimator.onnx
│  └─ vocoder.onnx
└─ voice_styles\
   ├─ F1.json
   ├─ ...
   └─ M5.json
```

Lecture Dub에서는 한국어 `ko` 모드와 기본 제공 음색 `F1~F5`, `M1~M5`를 선택할 수 있습니다.

## Fish Audio S2 Pro

Fish S2 Pro는 Qwen/Supertonic보다 실행 환경이 훨씬 무겁기 때문에 Lecture Dub의 기본 Python 환경에 자동 설치하지 않습니다.

체크포인트 예시:

```text
D:\AI\Models\s2-pro\
├─ config.json
├─ codec.pth
├─ model-00001-of-....safetensors
├─ model.safetensors.index.json
└─ ...
```

### Linux에서 같은 Python 환경으로 실행

fish-speech 저장소를 별도로 준비하고 editable 설치한 뒤, 필요하면 환경 변수로 런타임 위치를 알려줍니다.

```bash
export FISH_SPEECH_ROOT=/path/to/fish-speech
lecture-dub serve
```

Lecture Dub은 처음 Fish 합성을 요청할 때 선택한 S2 Pro 체크포인트로 로컬 Fish API 서버를 시작합니다.

### Windows에서는 WSL/Docker 권장

Fish Speech 서버를 WSL 또는 Docker에서 먼저 실행하고 Windows의 Lecture Dub이 그 서버를 사용하게 합니다.

```powershell
$env:FISH_SPEECH_URL="http://127.0.0.1:8080"
lecture-dub serve
```

이 경우 Web UI의 모델 스캐너는 S2 Pro 체크포인트 존재 여부를 확인하고, `FISH_SPEECH_URL`이 설정되어 있으면 Fish 런타임이 연결된 것으로 판단합니다.

## Web UI 사용 순서

```text
1. lecture-dub serve
2. http://127.0.0.1:8000 열기
3. Step 3 → TTS 엔진과 로컬 모델
4. 모델 상위 폴더 선택
5. 다시 검색
6. TTS 방식 선택
7. 사용할 모델/음색 선택
8. 한국어 음성 합성 시작
```

Edge TTS를 선택하면 기존 동작과 완전히 동일합니다. 로컬 모델이 하나도 없어도 기존 기능은 영향을 받지 않습니다.

## 모델 파일과 Git

저장소의 `models/*`는 `.gitignore` 대상입니다. 모델 가중치는 커밋하거나 GitHub에 올리지 않습니다.

```text
models/.gitkeep   ← Git에 포함
models/Qwen.../   ← Git에 포함되지 않음
models/s2-pro/    ← Git에 포함되지 않음
```

외부 폴더를 지정하면 모델 파일은 애초에 저장소 밖에 있으므로 Git과 완전히 독립적으로 관리할 수 있습니다.

## 라이선스 주의

Lecture Dub 자체 라이선스와 모델/런타임 라이선스는 별개입니다. Qwen3-TTS, Supertonic 모델, Fish Audio S2 Pro를 내려받거나 결과물을 배포할 때는 각 프로젝트의 모델 라이선스와 이용 조건을 따로 확인해야 합니다.
