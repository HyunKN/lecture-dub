# Lecture Dub Web Player

YouTube 영상을 기준으로 로컬 한국어 더빙 WAV와 영어·한국어 WebVTT 자막을 동기화해 재생하는 정적 웹 페이지입니다.

## 실행

저장소 루트에서 다음 명령을 실행합니다.

```powershell
python -m http.server 8000
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:8000/web/
```

`index.html` 파일을 직접 여는 것보다 로컬 HTTP 서버 사용을 권장합니다. YouTube IFrame API와 브라우저 미디어 정책이 `file://` 환경에서 다르게 동작할 수 있기 때문입니다.

## 사용 순서

1. YouTube URL을 입력하고 `확인`을 누릅니다.
2. 생성한 한국어 더빙 WAV를 선택합니다.
3. 원본 영어 VTT와 번역된 한국어 VTT를 선택합니다.
4. `동기화 재생`을 누릅니다.

기본적으로 YouTube 원본 음성은 음소거되고 한국어 WAV가 재생됩니다. 영상이나 WAV의 재생·일시정지·탐색을 조작하면 반대쪽도 따라갑니다.

미세하게 어긋날 경우 `오디오 보정` 값을 0.1초 단위로 조절합니다. 양수는 한국어 WAV를 더 앞선 시점으로 이동합니다.

## CS230 예시 파일

```text
output/ko/cs230-lecture01.ko.wav
output/en/cs230-lecture01.en-US.vtt
output/ko/cs230-lecture01.ko.vtt
```

WAV와 VTT는 브라우저에서만 로컬로 읽으며 서버나 GitHub에 업로드하지 않습니다.

## Liquid Glass renderer

페이지의 시각 체계는 Apple/OpenAI에서 가져온 흑백 위계, 넓은 여백, system typography를 유지합니다. Liquid Glass는 별도의 어두운 영역을 만들지 않고 모든 `button`의 interaction material로만 사용합니다.

각 활성 `button`은 전용 WebGL2 canvas layer를 갖습니다. canvas는 button의 DOM label/icon 아래에만 배치되므로 텍스트는 흐려지지 않습니다. 각 layer는 upstream과 같은 `bgPass → vBlurPass → hBlurPass → mainPass` 순서로 실행되며, 화면 좌표에 고정된 중립 texture를 rounded-rectangle SDF와 pointer circle SDF가 smooth-min으로 합쳐진 렌즈를 통해 굴절합니다. main pass에는 RGB dispersion, Fresnel reflection, tint, directional glare와 spring-driven rectangle stretch를 적용합니다.

WebGL2를 지원하지 않는 환경에는 CSS glass fallback을 사용합니다. disabled button은 정적이며, `prefers-reduced-motion`과 coarse pointer 환경에서는 pointer/blob spring을 사용하지 않습니다.

구현은 MIT License로 공개된 [Liquid Glass Studio](https://github.com/iyinchao/liquid-glass-studio)의 multipass rendering과 shader 수식을 이 정적 player의 접근 가능한 DOM control에 맞게 port했습니다. 원본 license 전문은 `web/vendor/liquid-glass-studio-MIT.txt`에 포함합니다.
