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

1. YouTube URL을 입력하고 `영상 불러오기`를 누릅니다.
2. 생성한 한국어 더빙 WAV를 선택합니다.
3. 원본 영어 VTT와 번역된 한국어 VTT를 선택합니다.
4. `동기화 재생`을 누릅니다.

기본적으로 YouTube 원본 음성은 음소거되고 한국어 WAV가 재생됩니다. 영상이나 WAV의 재생·일시정지·탐색을 조작하면 반대쪽도 따라갑니다.

미세하게 어긋날 경우 `오디오 보정` 값을 0.1초 단위로 조절합니다. 양수는 한국어 WAV를 더 앞선 시점으로 이동합니다.

## CS230 예시 파일

```text
output/cs230-lecture01.ko.wav
output/cs230-lecture01.en-US.vtt
output/cs230-lecture01.ko.vtt
```

WAV와 VTT는 브라우저에서만 로컬로 읽으며 서버나 GitHub에 업로드하지 않습니다.
