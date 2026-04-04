// --- 1. 初期設定と変数 ---
const MIN_BPM = 1;
const MAX_BPM = 360;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 64;
analyser.connect(audioCtx.destination);

let isPlaying = false;
let bpm = 120;
let beatNum = 4;   // 拍子(分子)
let beatDen = 4;   // 拍子(分母)
let nTuplet = 1;   // n連符
let soundType = 'sine';

let currentNote = 0;
let nextNoteTime = 0.0;
let timerID = null;
const lookahead = 25.0; 
const scheduleAheadTime = 0.1; 

let startTime = 0;
let timerInterval = null;
let targetTimerSeconds = 0;
let remainingSeconds = 0;
let isCountDown = false;

const elements = {
    bpm: document.getElementById('bpm-display'),
    beat: document.getElementById('beat-display'),
    note: document.getElementById('note-display'),
    timer: document.getElementById('timer-display'),
    status: document.getElementById('status-display'),
    playBtn: document.getElementById('play-btn'),
    dial: document.getElementById('bpm-dial'),
    canvas: document.getElementById('visualizer'),
    overlay: document.getElementById('settings-overlay'),
    panels: document.querySelectorAll('.setting-panel'),
    panelTitle: document.getElementById('panel-title')
};
const canvasCtx = elements.canvas.getContext('2d');

// --- 2. 音声生成エンジン ---
function playClick(time, type, isDownbeat, isSubnote) {
    const osc = audioCtx.createOscillator();
    const envelope = audioCtx.createGain();
    
    switch(type) {
        case 'wood':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(isDownbeat ? 1200 : 800, time);
            if (isSubnote) osc.frequency.setValueAtTime(600, time);
            break;
        case 'beep':
            osc.type = 'square';
            osc.frequency.setValueAtTime(isDownbeat ? 880 : 440, time);
            if (isSubnote) osc.frequency.setValueAtTime(330, time);
            break;
        case 'bell':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(isDownbeat ? 1500 : 1000, time);
            if (isSubnote) osc.frequency.setValueAtTime(750, time);
            break;
        default:
            osc.type = 'sine';
            osc.frequency.setValueAtTime(isDownbeat ? 1000 : 500, time);
            if (isSubnote) osc.frequency.setValueAtTime(400, time);
    }

    const duration = isSubnote ? 0.03 : 0.07;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(1, time + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(envelope);
    envelope.connect(analyser);
    osc.start(time);
    osc.stop(time + duration + 0.01);
}

// --- 3. コアスケジューラ (分母のバグ修正版) ---
function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        const isDownbeat = (currentNote === 0);
        const isBeatHead = (currentNote % nTuplet === 0);
        
        if (isBeatHead || nTuplet > 1) {
            playClick(nextNoteTime, soundType, isDownbeat, !isBeatHead);
        }

        // 【修正点】BPMは「4分音符」を基準とする
        const secondsPerQuarterNote = 60.0 / bpm;
        // 分母(beatDen)に応じて1拍の長さを調整 (分母が16なら4分音符の1/4の長さになる)
        const secondsPerBeat = secondsPerQuarterNote * (4 / beatDen);
        
        // 次の音(連符の1要素)までの時間を足す
        nextNoteTime += secondsPerBeat / nTuplet;

        currentNote++;
        if (currentNote >= beatNum * nTuplet) {
            currentNote = 0;
        }
    }
    timerID = setTimeout(scheduler, lookahead);
}

// --- 4. タイマー管理 ---
function updateTimerDisplay() {
    let displaySec = isCountDown ? remainingSeconds : Math.floor((Date.now() - startTime) / 1000);
    
    if (isCountDown && remainingSeconds <= 0) {
        stopMetronome();
        elements.status.innerText = "TIME UP!";
        return;
    }

    const h = String(Math.floor(displaySec / 3600)).padStart(2, '0');
    const m = String(Math.floor((displaySec % 3600) / 60)).padStart(2, '0');
    const s = String(displaySec % 60).padStart(2, '0');
    elements.timer.innerText = `${h}:${m}:${s}`;
}

// --- 5. 再生コントロールとWake Lock ---
let wakeLock = null;
async function toggleWakeLock(on) {
    if (on && 'wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
    } else if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

function stopMetronome() {
    isPlaying = false;
    clearTimeout(timerID);
    clearInterval(timerInterval);
    elements.status.innerText = "STOPPED";
    elements.playBtn.innerText = "START";
    toggleWakeLock(false);
}

elements.playBtn.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (isPlaying) {
        stopMetronome();
    } else {
        isPlaying = true;
        currentNote = 0;
        nextNoteTime = audioCtx.currentTime + 0.05;
        
        // 【修正点】再生開始時にカウントダウンの残り秒数を毎回リセットする
        if (isCountDown) {
            remainingSeconds = targetTimerSeconds;
        }
        
        scheduler();
        
        startTime = Date.now();
        
        // スタートボタンを押した瞬間に表示を更新してズレを防ぐ
        updateTimerDisplay(); 
        
        timerInterval = setInterval(() => {
            if (isCountDown) remainingSeconds--;
            updateTimerDisplay();
        }, 1000);
        
        elements.status.innerText = "RUNNING";
        elements.playBtn.innerText = "STOP";
        toggleWakeLock(true);
    }
});

// --- 6. ダイヤルとハプティクス ---
let lastAngle = 0;
let isDragging = false;

function getAngle(e) {
    const rect = elements.dial.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return Math.atan2(clientY - center.y, clientX - center.x) * (180 / Math.PI);
}

elements.dial.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastAngle = getAngle(e);
    elements.dial.setPointerCapture(e.pointerId);
});

elements.dial.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const currentAngle = getAngle(e);
    let delta = currentAngle - lastAngle;

    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (Math.abs(delta) > 2) {
        const prevBpm = bpm;
        bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm + Math.round(delta / 2)));
        
        if (prevBpm !== bpm) {
            elements.bpm.innerText = bpm;
            if (navigator.vibrate) navigator.vibrate(10);
            elements.dial.style.transform = `rotate(${currentAngle}deg)`;
        }
        lastAngle = currentAngle;
    }
});
elements.dial.addEventListener('pointerup', () => isDragging = false);

// --- 7. 設定パネルUI制御 ---
document.querySelectorAll('.config-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // すべてのパネルを隠す
        elements.panels.forEach(p => p.classList.add('hidden'));
        
        // 押されたボタンに対応するパネルだけを表示
        const targetId = e.target.dataset.target;
        document.getElementById(targetId).classList.remove('hidden');
        elements.panelTitle.innerText = e.target.innerText + " SETTINGS";
        
        elements.overlay.classList.remove('hidden');
    });
});

document.getElementById('close-settings').addEventListener('click', () => {
    beatNum = parseInt(document.getElementById('beat-num').value) || 4;
    beatDen = parseInt(document.getElementById('beat-den').value) || 4;
    nTuplet = parseInt(document.getElementById('subdivision-input').value) || 1;
    soundType = document.getElementById('sound-select').value;
    
    const m = parseInt(document.getElementById('timer-min').value) || 0;
    const s = parseInt(document.getElementById('timer-sec').value) || 0;
    targetTimerSeconds = (m * 60) + s;
    
    updateSettingsUI();
    elements.overlay.classList.add('hidden');
});

function updateSettingsUI() {
    elements.bpm.innerText = bpm;
    elements.beat.innerText = `${beatNum}/${beatDen} BEAT`;
    elements.note.innerText = nTuplet > 1 ? `${nTuplet}連符` : '1拍単位';
    
    if (targetTimerSeconds > 0) {
        isCountDown = true;
        remainingSeconds = targetTimerSeconds;
    } else {
        isCountDown = false;
        remainingSeconds = 0;
    }
    updateTimerDisplay();
}

// --- 8. ビジュアライザ ---
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    const barWidth = (elements.canvas.width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = `rgba(26, 26, 26, ${barHeight / 100})`;
        canvasCtx.fillRect(x, elements.canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

// 初期化実行
elements.canvas.width = elements.canvas.offsetWidth;
elements.canvas.height = elements.canvas.offsetHeight;
updateSettingsUI();
drawVisualizer();
