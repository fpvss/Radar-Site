// Radar Site - SSTV Beacon Transmitter
// This app waas created by aiden mitchell
// remember that this uses ConvertAPI.com to convert the radar gif to a jpg, so it may not work if the API is down or if you exceed the free usage limits.
// The "secret" code is f1fdj3vT4yPzXtaIwumbkMApaOKTsVBZ
// This one works but may need to be updated if the API changes. It also may not work if the radar gif changes, so you may need to update the GIF_URL variable if that happens.

// Updated with a 1-second leading tone for Arduino/Baofeng synchronization

const SECRET = 'f1fdj3vT4yPzXtaIwumbkMApaOKTsVBZ';
const GIF_URL = "https://cdn.tegna-media.com/wfaa/weather/animated-loops/comp/temp_880x495/new_dma.gif";
const BEACON_INTERVAL = 7 * 60 * 1000; // 7 Minutes

let audioCtx;
const SAMPLE_RATE = 44100;

const startBtn = document.getElementById('start-btn');
const status = document.getElementById('status');
const timerDisplay = document.getElementById('timer-display');
const imgElement = document.getElementById('radar-data-source');
const canvas = document.getElementById('scan-monitor');

startBtn.addEventListener('click', async () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    
    startBtn.disabled = true;
    startBtn.innerText = "BEACON ACTIVE";
    runBeaconCycle();
});

async function runBeaconCycle() {
    await fetchAndTransmit();
    
    let timeLeft = BEACON_INTERVAL / 1000;
    const timer = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        timerDisplay.innerText = `NEXT UPDATE: ${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            runBeaconCycle();
        }
    }, 1000);
}

async function fetchAndTransmit() {
    status.innerText = "Fetching radar data...";
    try {
        const response = await fetch(`https://v2.convertapi.com/convert/gif/to/jpg?Secret=${SECRET}&ExtractImage=true&StoreFile=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ "Parameters": [{ "Name": "File", "FileValue": { "Url": GIF_URL } }] })
        });
        
        const data = await response.json();
        imgElement.crossOrigin = "Anonymous"; 
        imgElement.src = data.Files[data.Files.length - 1].Url;

        return new Promise((resolve) => {
            imgElement.onload = () => {
                status.innerText = "Encoding Signal...";
                setTimeout(() => {
                    generateSSTV(imgElement, resolve);
                }, 100);
            };
        });
    } catch (e) {
        status.innerText = "Connection Error. Retrying soon...";
        console.error(e);
    }
}

function generateSSTV(image, onComplete) {
    canvas.width = 320; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    const cropScale = 0.60; // 60% Zoom
    const sWidth = image.naturalWidth * cropScale;  
    const sHeight = image.naturalHeight * cropScale; 
    const sX = (image.naturalWidth - sWidth) * 0.95; // Centered on DFW area
    const sY = 80;

    ctx.drawImage(image, sX, sY, sWidth, sHeight, 0, 0, 320, 256);
    const pixels = ctx.getImageData(0, 0, 320, 256).data;
    
    // Increased duration from 112 to 113 to account for the 1s header
    const duration = 113; 
    const buffer = audioCtx.createBuffer(1, SAMPLE_RATE * duration, SAMPLE_RATE);
    const dataArr = buffer.getChannelData(0);
    
    let pos = 0, phase = 0;

    function addTone(freq, ms) {
        const samples = Math.floor((ms / 1000) * SAMPLE_RATE);
        for (let i = 0; i < samples; i++) {
            if (pos < dataArr.length) {
                dataArr[pos++] = Math.sin(phase) * 0.7; 
                phase += (2 * Math.PI * freq) / SAMPLE_RATE;
            }
        }
    }

    // --- LEADING SYNC TONE ---
    // Increase LEADER_MS to make the initial "wake up" beep longer (e.g., 2000 for 2 seconds)
    // Decrease it to make it shorter.
    const LEADER_MS = 1000; 
    const LEADER_FREQ = 1200; 
    addTone(LEADER_FREQ, LEADER_MS);

    // Scottie 1 Header & VIS
    addTone(1900, 300); addTone(1200, 10); addTone(1900, 300);
    addTone(1200, 30); addTone(1300, 30); addTone(1100, 30);
    addTone(1300, 30); addTone(1100, 30); addTone(1200, 30);

    const pixelTime = 0.4320;
    const lineStarts = [];

    for (let y = 0; y < 256; y++) {
        lineStarts.push(pos);
        addTone(1200, 9.0); addTone(1500, 1.5);
        
        // Color mapping for your specific decoder (Red, Green, Blue)
        [0, 1, 2].forEach(c => {
            for (let x = 0; x < 320; x++) {
                const val = pixels[(y * 320 + x) * 4 + c];
                addTone(1500 + (val / 255) * 800, pixelTime);
            }
            addTone(1500, 1.5);
        });
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    status.innerText = "Transmitting...";

    const startTime = audioCtx.currentTime;
    function updateVisuals() {
        const elapsedSamples = (audioCtx.currentTime - startTime) * SAMPLE_RATE;
        const currentLine = lineStarts.findIndex(p => p > elapsedSamples) - 1;
        if (currentLine >= 0 && currentLine < 256) {
            ctx.drawImage(image, sX, sY, sWidth, sHeight, 0, 0, 320, 256);
            ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, currentLine); ctx.lineTo(320, currentLine); ctx.stroke();
            requestAnimationFrame(updateVisuals);
        }
    }

    source.onended = () => {
        status.innerText = "Signal Complete. Idle.";
        ctx.drawImage(image, sX, sY, sWidth, sHeight, 0, 0, 320, 256);
        onComplete();
    };

    source.start(0);
    requestAnimationFrame(updateVisuals);
}
