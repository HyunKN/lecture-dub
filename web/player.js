const $=s=>document.querySelector(s),audio=$("#dub-audio"),statusEl=$("#status"),clock=$("#clock");
const el={url:$("#youtube-url"),load:$("#load-video"),wav:$("#wav-file"),enFile:$("#english-vtt"),koFile:$("#korean-vtt"),play:$("#sync-play"),pause:$("#sync-pause"),sync:$("#sync-enabled"),mute:$("#mute-youtube"),offset:$("#audio-offset"),en:$("#english-subtitle"),ko:$("#korean-subtitle")};
let player,ready=false,enCues=[],koCues=[],audioUrl=null,internalSeek=false;
const setStatus=(message,error=false)=>{statusEl.textContent=message;statusEl.classList.toggle("error",error)};

function videoId(value){
  const text=value.trim();
  if(/^[\w-]{11}$/.test(text))return text;
  try{
    const u=new URL(text),parts=u.pathname.split("/").filter(Boolean);
    if(u.hostname==="youtu.be")return parts[0]||null;
    if(u.hostname.endsWith("youtube.com")){
      if(u.pathname==="/watch")return u.searchParams.get("v");
      if(["embed","shorts","live"].includes(parts[0]))return parts[1]||null;
    }
  }catch{return null}
  return null;
}

function timestamp(value){
  const p=value.trim().replace(",",".").split(":"),s=Number(p.pop()),m=Number(p.pop()),h=p.length?Number(p.pop()):0;
  return [h,m,s].every(Number.isFinite)?h*3600+m*60+s:NaN;
}

function cueText(lines){
  const box=document.createElement("textarea");
  box.innerHTML=lines.join("\n").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"");
  return box.value.trim();
}

function parseVtt(text){
  const cues=[];
  for(const block of text.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split(/\n{2,}/)){
    const lines=block.split("\n"),first=(lines[0]||"").trim();
    if(!first||first==="WEBVTT"||/^(NOTE|STYLE|REGION)(\s|$)/.test(first))continue;
    const i=lines.findIndex(line=>line.includes("-->"));
    if(i<0)continue;
    const times=lines[i].split("-->"),start=timestamp(times[0]),end=timestamp(times[1].trim().split(/\s+/)[0]),textValue=cueText(lines.slice(i+1));
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&textValue)cues.push({start,end,text:textValue});
  }
  return cues.sort((a,b)=>a.start-b.start);
}

function activeCue(cues,time){
  let low=0,high=cues.length-1;
  while(low<=high){
    const mid=(low+high)>>1,cue=cues[mid];
    if(time<cue.start)high=mid-1;else if(time>cue.end)low=mid+1;else return cue;
  }
  return null;
}

function format(seconds){
  const n=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;
  return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

const offset=()=>Number(el.offset.value)||0;
const playerTime=()=>ready?(player.getCurrentTime()||0):0;
const playerState=()=>ready?player.getPlayerState():-1;
function syncAudio(force=false){
  if(!ready||!el.sync.checked||!audio.src)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:Infinity,target=Math.min(Math.max(0,playerTime()+offset()),duration);
  if(force||Math.abs(target-audio.currentTime)>.35){internalSeek=true;audio.currentTime=target}
}
function muteOriginal(){if(ready)(el.mute.checked?player.mute():player.unMute())}

async function playTogether(){
  if(!ready)return setStatus("YouTube 플레이어가 아직 준비되지 않았습니다.",true);
  if(!audio.src)return setStatus("먼저 한국어 WAV 파일을 선택하세요.",true);
  syncAudio(true);player.playVideo();
  try{await audio.play();setStatus("영상과 한국어 더빙을 동기화해 재생 중입니다.")}catch(e){setStatus(`오디오 재생이 차단됐습니다: ${e.message}`,true)}
}
function pauseTogether(){if(ready)player.pauseVideo();audio.pause();setStatus("재생을 일시정지했습니다.")}

async function loadVtt(file,language){
  if(!file)return;
  try{
    const cues=parseVtt(await file.text());
    if(!cues.length)throw new Error("읽을 수 있는 자막 구간이 없습니다.");
    if(language==="en"){enCues=cues;el.en.textContent=`${cues.length}개 영어 자막을 불러왔습니다.`}else{koCues=cues;el.ko.textContent=`${cues.length}개 한국어 자막을 불러왔습니다.`}
    setStatus(`${file.name}: 자막 ${cues.length}개를 불러왔습니다.`);
  }catch(e){setStatus(`${file.name}을 읽지 못했습니다: ${e.message}`,true)}
}

function loadAudio(file){
  if(!file)return;
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=URL.createObjectURL(file);audio.src=audioUrl;audio.load();setStatus(`${file.name}: 한국어 WAV를 불러왔습니다.`);
}

function loadVideo(){
  const id=videoId(el.url.value);
  if(!id)return setStatus("올바른 YouTube URL 또는 영상 ID를 입력하세요.",true);
  if(!ready)return setStatus("YouTube 플레이어가 준비되는 중입니다.");
  pauseTogether();player.loadVideoById(id);muteOriginal();setStatus(`YouTube 영상 ${id}을 불러왔습니다.`);
}

function frame(){
  const time=playerTime(),state=playerState(),playing=window.YT&&state===YT.PlayerState.PLAYING;
  if(el.sync.checked&&audio.src){
    if(playing){syncAudio();if(audio.paused)audio.play().catch(()=>setStatus("‘동기화 재생’을 눌러 오디오를 시작하세요.",true))}
    else if(!audio.paused)audio.pause();
  }
  el.en.textContent=activeCue(enCues,time)?.text||"";el.ko.textContent=activeCue(koCues,time)?.text||"";
  clock.textContent=`${format(time)} / ${format(ready?player.getDuration():0)} · ${playing?"재생 중":state===2?"일시정지":"대기 중"}`;
  requestAnimationFrame(frame);
}

window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player("youtube-player",{videoId:"_NLHFoVNlbg",playerVars:{controls:1,rel:0,playsinline:1},events:{
    onReady:()=>{ready=true;muteOriginal();setStatus("플레이어가 준비됐습니다. WAV와 VTT 파일을 선택하세요.")},
    onStateChange:event=>{if(event.data===YT.PlayerState.PLAYING&&audio.src){syncAudio(true);audio.play().catch(()=>setStatus("‘동기화 재생’을 눌러 오디오를 시작하세요.",true))}else if(event.data===YT.PlayerState.PAUSED||event.data===YT.PlayerState.ENDED)audio.pause()}
  }});
};

el.load.onclick=loadVideo;el.url.onkeydown=e=>{if(e.key==="Enter")loadVideo()};el.wav.onchange=e=>loadAudio(e.target.files[0]);el.enFile.onchange=e=>loadVtt(e.target.files[0],"en");el.koFile.onchange=e=>loadVtt(e.target.files[0],"ko");el.play.onclick=playTogether;el.pause.onclick=pauseTogether;el.mute.onchange=muteOriginal;el.offset.onchange=()=>syncAudio(true);
audio.addEventListener("seeked",()=>{if(internalSeek){internalSeek=false;return}if(ready&&el.sync.checked)player.seekTo(Math.max(0,audio.currentTime-offset()),true)});
audio.addEventListener("play",()=>{if(ready&&el.sync.checked&&playerState()!==YT.PlayerState.PLAYING)player.playVideo()});
audio.addEventListener("pause",()=>{if(ready&&el.sync.checked&&playerState()===YT.PlayerState.PLAYING)player.pauseVideo()});
const api=document.createElement("script");api.src="https://www.youtube.com/iframe_api";document.head.appendChild(api);requestAnimationFrame(frame);
