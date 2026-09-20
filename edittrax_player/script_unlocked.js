
const creator = new URLSearchParams(window.location.search).get('creator')
const viewer = new URLSearchParams(window.location.search).get('viewer')
const owner = new URLSearchParams(window.location.search).get("owner");
const objkt = new URLSearchParams(window.location.search).get('objkt')
var isOwned = false;
let playToggle = document.querySelector("#play-toggle");
let downloadButton = document.querySelector("#download");
let purchaseElement = document.querySelector("#purchase");
let playElement = document.querySelector("#play-toggle");

let status = document.querySelector("#status");
let slider_cont = document.querySelector("#slider_cont");

let previewLoop = document.querySelector(".preview");

let presetElements = [];
let elements = [];

purchaseElement.addEventListener('click', function(){
    
    gsap.fromTo("#master_controls", {backgroundColor:"#d68d8d", ease: "Power1.easeOut"}, {backgroundColor:"transparent"});
    
});

downloadButton.addEventListener('click', function(){

   gsap.fromTo("#master_controls", {backgroundColor:"#4F5B53", ease: "Power1.easeOut"}, {backgroundColor:"#776388"});
   gsap.set("#play-toggle, #download, #purchase, #trackRepeat, .repeat-text, .loopinteract", {display:"none"})
   gsap.set("#status", {color:"#e3d9cd", fontSize:"19px", marginLeft:8, width:"auto"});

});

document.addEventListener("DOMContentLoaded", () => {


    presetElements = document.querySelectorAll(".preset");
    elements = document.querySelectorAll(".loopinteraction");

 

    for (var i = 0, presetElement; presetElement = presetElements[i]; i++) {
        presetElement.addEventListener('click', function() {
            for(var i = 0; i < presetElements.length; i++){
                presetElements[i].classList.remove('active');
            }
            this.classList.add('active');

            Tone.Transport.stop();
            loadPreset(this.dataset['value']);
            updatePlayClass();

            setTogglePlayGlowAndPartsActive();
        });
    }

    for (var i = 0, element; element = elements[i]; i++) {
        element.addEventListener("click", function (event) {
            Tone.Transport.stop();
            updateDurations();
            schedulePlayers();
            updatePlayClass();

            setTogglePlayGlowAndPartsActive();
        })
    }

    document.getElementById('masterUp').addEventListener("click", loopMasterUp);
    document.getElementById('masterDown').addEventListener("click", loopMasterDown);
    // console.log("init script");
});


function setTogglePlayGlowAndPartsActive() {
    var elem = document.querySelector("#play-toggle");

    if (Tone.Transport.state == "started" || player.state == "started") {
        if( document.querySelector('#glow-hover-play')) {
            document.querySelector('#glow-hover-play').id = "glow-hover-stop";
            elem.classList.remove("play")
            elem.classList.add("stop")
            slider_cont.classList.remove("play")
            slider_cont.classList.add("stop")
            boxes_cont.classList.add("pointer-events-none")
            boxes_cont.classList.add("isactiveBoxCont");


            for(var i = 0; i < parts.length; i++){
                parts[i].ref_box.classList.add("isnotactive");
            }
        }
    } else {
        if(document.querySelector('#glow-hover-stop')){
            document.querySelector('#glow-hover-stop').id = "glow-hover-play";
            elem.classList.remove("stop")
            elem.classList.add("play")
            slider_cont.classList.remove("stop")
            slider_cont.classList.add("play")
            boxes_cont.classList.remove("pointer-events-none")
            boxes_cont.classList.add("isactiveBoxCont");

            for(var i = 0; i < parts.length; i++){
                parts[i].isactive = false;
                parts[i].ref_box.classList.remove("isactive");
                parts[i].ref_box.classList.remove("isnotactive");
            }
        }
    }
}

function enableElements() {
    for (var i = 0, element; element = elements[i]; i++) {
        element.disabled = false
    }
}

let trackRepeatElement = document.getElementById("trackRepeat");
var trackRepeat = Number.parseInt(trackRepeatElement.innerHTML);

function loopMasterUp() {
    if(trackRepeat < 9){
        trackRepeat++;
        trackRepeatElement.innerHTML = trackRepeat;
        changeMasterLoop();
    }
}
function loopMasterDown() {
    if(trackRepeat > 0){
        trackRepeat--;
        trackRepeatElement.innerHTML = trackRepeat;
        changeMasterLoop();
    }
}

function changeMasterLoop(){
    Tone.Transport.stop();
    updateDurations();
    schedulePlayers();
    updatePlayClass();

    setTogglePlayGlowAndPartsActive();
}

const player = new Tone.Player().toDestination();
player.loop = true;
const buffers = parts.map(part => new Tone.Buffer({ url: trackDir + part.file }));
var activeBufferIndex = -1;
var renderedBufferIndex = 99;

Tone.loaded().then(function () {

    gsap.set("#statusTitle, #statusInfo, #statusInformation, #statusItems", {autoAlpha:0});
    document.getElementById('statusGif').style.display = 'block';
    document.getElementById('loaderGif').style.display = 'none';
   
    

    status.innerHTML = "MASTER EDIT"
    playToggle.disabled = false;
    enableElements();
    loadPreset(0);

    gsap.set("#flipMe", {backgroundColor:"transparent", border:"none"});
    gsap.to("#flipMe", {delay:.5, duration:0.25, autoAlpha:0, onComplete: () => {
        setSliderVisibility();
        initialSliderPositionAndBounds();
        mainTimline();
    }});

    gsap.to("#cont_slider_boxes", {duration:1, autoAlpha:1, ease:"Power4.easeInOut"},0);
    gsap.set("#secondaryControls", {autoAlpha:0});

    var tlStageBlock
    function mainTimline() {
    tlStageBlock = gsap.timeline({delay:0});
    tlStageBlock.timeScale( 2 );
    tlStageBlock.to("#flipMe", {duration:0.25, autoAlpha:0},0);
    tlStageBlock.set("#stageBlock", {zIndex:1},0);
    tlStageBlock.to("#stageBlock", {duration:1, autoAlpha:0.6},0);
    tlStageBlock.from("#wrapper_cont", {duration:1,opacity:0},"-=2");
    tlStageBlock.from("#wrapper", {duration:1, autoAlpha:0});
    tlStageBlock.to("#header, #presets, #pre2,#boxes_cont, #master_controls, #secondaryControls, #progress_cont, #footer", {duration:1, stagger:0.3, autoAlpha:1, delay:0, ease:"Power4.easeInOut"},"-=1");
    tlStageBlock.to("#wrapper", {duration:0.25, height:"100%", width:"100%", ease:"Power1.easeOut"},0);
    tlStageBlock.to('.loader, #wrapper_bg p', {duration:1,opacity: 0},0);

    document.getElementById('wrapper_bg').style.display = "none";
    nudge = null;
    tlStageBlock.addLabel("myLabel", ">");
    }

    function readyCheck(){
        gsap.set("#statusGifLoader", {display:"none"});  
        mainTimline();
    }

});

function loadPreset(index) {
    const preset = presets[index];
    for (var i = 0; i < parts.length ; i++) {
        parts[i].loop = preset[i] ?? 0;
        parts[i].refelem.innerHTML = parts[i].loop;
    }
    presetLoaded();
}

async function presetLoaded() {

    updateDurations();
    schedulePlayers();
}

function render() {
    console.log("Download")
    status.innerHTML = "RENDERING EDIT..."
    const renderingPromise = Tone.Offline(({ transport }) => {
        transport.bpm.value = bpm;

        var playhead = 0;

        for (var i=0; i<trackRepeat; i++) {
            buffers.forEach((buffer, i) => {
                if (parts[i].loop == 0) { return }

                var partPlayer = new Tone.Player(buffer)
                partPlayer.loop = parts[i].loop > 1;
                var loopLength = parts[i].length * parts[i].loop;
                partPlayer.toDestination().sync().start(playhead + "m").stop(playhead + loopLength + "m");
                playhead += loopLength
            });
        }

        transport.start();
    }, Tone.Time(totalLength()))

    renderingPromise.then(buffer => {
        status.innerHTML = "MASTER EDIT"
        makeDownload(buffer.get())
        gsap.fromTo("#master_controls", {backgroundColor:"#776388", ease: "Power1.easeOut"}, {backgroundColor:"#DED8CB"});
        gsap.set("#play-toggle, #download, #trackRepeat, .repeat-text, .loopinteract", {display:"block"})
        gsap.set("#status", {color:"#576B68", fontSize:"10px", marginLeft:0, width:"98px"});
    });

    renderingPromise.then(() => {
        var downloadLink = document.getElementById("download-link");
        downloadLink.click();
    });
}

Tone.Transport.bpm.value = bpm;

var players = buffers.map((buffer, i) => {
    var partPlayer = new Tone.Player(buffer)
    partPlayer.loop = parts[i].loop > 1;
    partPlayer.toDestination().sync()
    return partPlayer;
});

function schedulePlayers() {
    players.forEach((partPlayer) => {partPlayer.unsync(); partPlayer.sync()});
    var playhead = 0;
    for (var i=0; i<trackRepeat; i++) {
        players.forEach((partPlayer, i) => {
            if (parts[i].loop == 0) { 
                return;
            }

            partPlayer.loop = parts[i].loop > 1;
            var loopLength = parts[i].length * parts[i].loop;
            partPlayer.start(playhead + "m").stop(playhead + loopLength + "m");
            playhead += loopLength
        }); 
    }   
}

var playerStartTime = 0;
var previewProgressElement;

function previewPart(index, element) {
    if (Tone.Transport.state == "started") {
        Tone.Transport.stop();
    }

    if (activeBufferIndex != index) {
        player.stop();
        activeBufferIndex = index;
        player.buffer = buffers[index];
    }
    
    if (player.state == "started") {
        playerStartTime = 0;
        player.stop()
    } else {
        playerStartTime = Tone.now();
        previewProgressElement = element;
        player.start();
    }

    resetPreviewProgress();
    updatePlayClass();
}

function resetPreviewProgress(index) {
    var durationElements = document.querySelectorAll(".previewProgress");
    
    for (var i = 0, element; element = durationElements[i]; i++) {
        element.value = 0;
    }
}

function previewProgress() {
    if (playerStartTime == 0 || player.state == "stopped") {
        return 0;
    }
    return (Tone.now() - playerStartTime) % player.buffer.duration / player.buffer.duration;
}

playToggle.onclick = function () {
   
    Tone.start();

    if (activeBufferIndex != renderedBufferIndex) {
        activeBufferIndex = renderedBufferIndex;
        playerStartTime = 0;
        player.stop();
        resetPreviewProgress();
    }

    if (Tone.Transport.state == "started") {
        Tone.Transport.stop();
    } else {
        Tone.Transport.start()
        Tone.Transport.scheduleOnce(autoStop, '+' + totalLength());
    }
    updatePlayClass();
    goToFirst();
}

autoStop = function() {
    Tone.Transport.stop();
    updatePlayClass();
    goToFirst();
}

function scrollToPart(idx){
    seamless.elementScrollIntoView(parts[idx].ref_box, {
        behavior: "smooth",
        block: "start",
        inline: "start",
    });
}

function goToFirst() {
    lastIndex = 0;
    setTogglePlayGlowAndPartsActive();
}

playToggle.dataset.index = renderedBufferIndex;

function updatePlayClass() {
    const isPlaying = Tone.Transport.state == "started" || player.state == "started";

    var previewElements = document.querySelectorAll(".preview");
    
    for (var i = 0, element; element = previewElements[i]; i++) {
        if (element.dataset.index == activeBufferIndex && isPlaying) {
            element.classList.remove("play")
            element.classList.add("stop")
        } else {
            element.classList.remove("stop")
            element.classList.add("play")
        }
    }
}

function updateDurations() {
    var durationElements = document.querySelectorAll(".previewDuration");
    
    for (var i = 0, element; element = durationElements[i]; i++) {
        let index = element.dataset.index;
        let duration = previewDuration(index);
        element.innerHTML = formatDuration(duration);
    }

    let totalDurationElement = document.querySelector("#totalDuration");
    let totalDuration = trackDuration();
    totalDurationElement.innerHTML = formatDuration(totalDuration);

    let progress_total = document.querySelector("#progress_total");
    progress_total.innerHTML = formatDuration(totalDuration);

}

function previewDuration(index) {
    let duration = buffers[index].duration * parseInt(parts[index].loop);
    return duration
}
function mainLoopDuration() {
    return parts.reduce((sum, { loop }, index) => sum + buffers[index].duration * loop, 0);
}
function trackDuration() {
    return mainLoopDuration() * trackRepeat;
}

function trackLoopLength() {
    return parts.reduce((sum, { length, loop }) => sum + length * loop, 0) + 'm';
}

function totalLength() {
    return parts.reduce((sum, { length, loop }) => sum + length * loop, 0) * trackRepeat + 'm';
}

function formatDuration(duration) {
    let minutes = Math.floor(duration / 60);
    if(minutes < 10) minutes = "0" + minutes;
    let seconds = Math.floor(duration - (minutes * 60));
    if (seconds < 10) { seconds = "0" + seconds; }
    return minutes + ":" + seconds;
}

function pointerEventsOn(){
    gsap.set("#flipMe, #flipMe_return_direx", {pointerEvents:"auto"});
}

function pointerEventsOff(){
    gsap.set("#flipMe, #flipMe_return_direx", {pointerEvents:"none"});
}

function preview() {
    pointerEventsOff()
}

function stopPreview() {
    pointerEventsOff()
}


let testBoolEdit = true;
let showDaw = false;

function expand() {

    var delay = 0.25;

    if ((testBoolEdit == true) && (showDaw == false)) {


      let expandButtonText = document.getElementById("master_controls_expand");

      expandButtonText.innerHTML = "COLLAPSE EDITOR";
      
      
      gsap.to("#cont_slider_boxes", {duration:0.25, height:"28vh", ease: "Power3.easeOut"}); 


      function moveSlider(){
        gsap.to("#slider, #slider_cont", {duration:0.1, autoAlpha:1, y:0});
      }
    
     function showSlider(){
        gsap.to("#slider_cont",{duration:0.25, delay:0, onComplete: () => {
        setSliderVisibility();
        initialSliderPositionAndBounds();
        moveSlider();
    }});


}
  
gsap.to("#wrapper_cont", {duration:0.25, height:"auto", ease: "Power3.easeOut", onComplete:showSlider()}); 
showDaw = true;
console.log(showDaw);

} 
    else if ((testBoolEdit == true) && (showDaw == true)) {

        let expandButtonText = document.getElementById("master_controls_expand");

        expandButtonText.innerHTML = "EDIT THIS TRACK";

        gsap.to("#slider_cont", {duration:0.25, autoAlpha:0, delay:0});     
        
        gsap.to("#cont_slider_boxes", {duration:0.25, height:"0vh", ease: "Power3.easeOut"}); 
        gsap.to("#wrapper_cont", {duration:0.25, width:420, height:420,  ease:"Power3.easeOut"}); 
        showDaw = false;
        console.log(showDaw);

    } 
    else { 

    }
}

document.getElementById("preview").addEventListener("mouseover", preview);
document.getElementById("preview").addEventListener("mouseout", stopPreview);

var tlFlipCard = gsap.timeline({paused: true});

tlFlipCard.to("#wrapper_cont", {duration:0.75, scale:0, opacity:0, ease:"Back.easeOut", opacity:0},0)
tlFlipCard.to("#stageBlock", {duration:2, ease:"Back.easeOut", opacity:0},0.2)

let testBool = true;
let showDirections = false;

function toggle() {

gsap.set("#statusGif, #flipMe", {display:"none"});

var delay = 0.25;

if ((testBool == true) && (showDirections == false)) {

    var albumExpand = document.getElementById("albumExpand");
    albumExpand.innerHTML = "VIEW PLAYER";

    pointerEventsOff();

    gsap.set("#flipMe", {pointerEvents:"none", autoAlpha:0, visibility:"hidden"});

    tlFlipCard.play();
    gsap.set("#content_back_img", {autoAlpha:0});  
    gsap.set("#content_back_img_direx", {autoAlpha:1});  
    gsap.to("#flipMe_return_direx", {duration:0.5, opacity:1, delay:.5,visibility:"visible", onComplete:pointerEventsOn});

    } 
    else if ((testBool == true) && (showDirections == true)) {
    } 
    else {

    var albumExpand = document.getElementById("albumExpand");
    albumExpand.innerHTML = "VIEW ALBUM ART";


    gsap.set("#flipMe_return_direx", {pointerEvents:"none", autoAlpha:0, visibility:"hidden"});

    gsap.set("#flipMe", {visibility:"visible"});
    pointerEventsOff();
    // gsap.set(".flipMePointer", {pointerEvents:"auto"});

    gsap.to("#flipMe", {duration:0.5, opacity:1, delay:.5,visibility:"visible", onComplete:pointerEventsOn});
    let speed = 2; // Set the speed value to 2x
    tlFlipCard.timeScale(speed); 
    tlFlipCard.reverse(1, {
    ease: Power4.easeOut,
    easeParams: [1.5]
    });

}
    
    testBool = !testBool;
}


downloadButton.onclick = function () {
    render();
}

function makeDownload(buffer) {
    var newFile = URL.createObjectURL(bufferToWave(buffer, 0, buffer.length));

    var downloadLink = document.getElementById("download-link");
    downloadLink.href = newFile;
    downloadLink.download = downloadName;
}

// TEMPLATE NOTE: the on-chain tzkt token-gate has been removed from this generic player.
// This template ships UNLOCKED — the download is always shown (see unlockDownload below).
// To add wallet/token gating, re-introduce a tzkt big-map lookup here and switch the call
// at the bottom of this file to gate downloadButton/purchaseElement on ownership.

const progressElem_curr = document.getElementById('progress_current');
const progressElem = document.getElementById("progress");
let lastIndex = 0;

setInterval(() => {
    const progress = Tone.Transport.ticks / Tone.Time(totalLength()).toTicks();
    const width = Math.floor(progress * 100);

    let seconds = trackDuration() * progress;

    if(Number.isFinite(width)){
        progressElem_curr.innerHTML = formatDuration(seconds);
        progressElem.value = width;

        let loopDuration = mainLoopDuration();
        var current = 0;
        let currentMainLoop = 1;
        while(seconds > (loopDuration * currentMainLoop))
        {
            current += loopDuration;
            currentMainLoop++;
        }

        if(seconds > 0){



            for(var i = 0; i < parts.length; i++){
                current += previewDuration(i);
                if(seconds < current){
                    if(!parts[i].isactive){
                        scrollToPart(i);
                        // var loopPlay = parts[lastIndex].ref_box.querySelector(".preview");

                        parts[lastIndex].isactive = false;

                        parts[lastIndex].ref_box.classList.remove("isactive");
                        parts[lastIndex].ref_box.classList.add("isnotactive");
                        // loopPlay.style.display = 'none';


                        // parts[lastIndex].ref_box.querySelector(".preview").style.display = 'none';

                        // console.log(parts[lastIndex].ref_box.querySelector(".preview"))


                        // loopPlay.classList.add("isactiveButton")
                        // loopPlay.style.add("isactiveButton")
                        
                        // loopPlay.classList.add("isnotactiveButton")ß

                        parts[i].ref_box.classList.remove("isnotactive");
                        parts[i].ref_box.classList.add("isactive");

                        parts[i].isactive = true;
                        lastIndex = i;
                    }
                    break;
                }
            }
        }
    }

    if (playerStartTime > 0) {
        const previewWidth = Math.floor(previewProgress() * 100);
        previewProgressElement.value = previewWidth;
    }

}, 200);

// Generic EditTrax player template: always unlocked. Shows the download, hides the purchase CTA.
// Swap this for a gated implementation if you need wallet/token ownership checks.
function unlockDownload(){
    console.log("EDITTRAX PLAYER TEMPLATE — unlocked build. Download enabled.");

    downloadButton.style.display = 'block';
    purchaseElement.style.display = 'none';

    downloadButton.onclick = function () {
        render();
    }
}

unlockDownload()
