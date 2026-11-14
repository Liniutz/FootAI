import asyncio
import json
import time
from collections import deque
import numpy as np
import sounddevice as sd
import websockets
from pedalboard import Pedalboard, Distortion, Reverb, Gain

SAMPLE_RATE = 44100
BLOCK_SIZE = 512
BASE_BPM = 120.0  # Updated dynamically when frontend selects a song

# Live guitar amp chain so the museum visitor hears distorted rock guitar
board = Pedalboard([
    Gain(gain_db=6.0),
    Distortion(drive_db=18.0),
    Reverb(room_size=0.25, wet_level=0.15)
])

state = {
    "live_bpm": BASE_BPM,
    "is_playing": False,
    "energy": 0.0,
    "detected_pitch_class": -1
}

prev_spectrum = np.zeros(BLOCK_SIZE // 2 + 1)
strum_times = deque(maxlen=8)
last_onset_time = 0.0
connected_clients = set()

def detect_pitch_class(mono_block):
    # Fast FFT peak detection -> pitch class (0=C .. 11=B)
    windowed = mono_block * np.hanning(len(mono_block))
    fft = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(mono_block), 1.0 / SAMPLE_RATE)
    valid = (freqs >= 75) & (freqs <= 600)
    if not np.any(valid):
        return -1
    peak_freq = freqs[valid][np.argmax(fft[valid])]
    midi = int(round(69 + 12 * np.log2(peak_freq / 440.0)))
    return midi % 12

def audio_callback(indata, outdata, frames, time_info, status):
    global prev_spectrum, last_onset_time

    mono = indata[:, 0]
    # 1. Process live guitar tone and send straight to speakers/headphones
    processed = board(mono.reshape(1, -1), SAMPLE_RATE, reset=False)
    outdata[:, 0] = processed[0]
    if outdata.shape[1] > 1:
        outdata[:, 1] = processed[0]

    # 2. Measure strum energy (RMS)
    rms = float(np.sqrt(np.mean(mono ** 2)))
    now = time.time()
    state["energy"] = min(1.0, rms * 12.0)

    # 3. Spectral-flux onset detection (catches pick attacks)
    spectrum = np.abs(np.fft.rfft(mono))
    flux = float(np.sum(np.maximum(0, spectrum - prev_spectrum)))
    prev_spectrum = spectrum

    if rms > 0.015 and flux > 1.8 and (now - last_onset_time) > 0.22:
        last_onset_time = now
        strum_times.append(now)
        state["detected_pitch_class"] = detect_pitch_class(mono)

    if len(strum_times) >= 4:
        intervals = np.diff(list(strum_times))
        # Keep intervals within realistic quarter/eighth note range
        valid_iv = intervals[(intervals > 0.25) & (intervals < 1.2)]
        if len(valid_iv) >= 2:
            raw_bpm = 60.0 / float(np.median(valid_iv))
            # Normalize half/double-time strums toward song's base BPM
            while raw_bpm < BASE_BPM * 0.72:
                raw_bpm *= 2
            while raw_bpm > BASE_BPM * 1.38:
                raw_bpm /= 2
            clamped = np.clip(raw_bpm, BASE_BPM * 0.80, BASE_BPM * 1.20)
            state["live_bpm"] = round(0.7 * state["live_bpm"] + 0.3 * float(clamped), 1)

    # Visitor is actively playing if a strum happened within the last 1.2 seconds
    state["is_playing"] = (now - last_onset_time) < 1.2

async def ws_handler(websocket):
    global BASE_BPM
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            data = json.loads(message)
            if "base_bpm" in data:
                BASE_BPM = float(data["base_bpm"])
                state["live_bpm"] = BASE_BPM
    finally:
        connected_clients.remove(websocket)

async def broadcast_loop():
    while True:
        if connected_clients:
            payload = json.dumps(state)
            await asyncio.gather(*(c.send(payload) for c in connected_clients), return_exceptions=True)
        await asyncio.sleep(0.033)  # ~30 FPS updates to AR frontend

async def main():
    # Set device=(input_id, output_id) if your USB interface isn't the OS default
    with sd.Stream(samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE, channels=1, callback=audio_callback):
        async with websockets.serve(ws_handler, "localhost", 8765):
            print("Guitar engine running on ws://localhost:8765")
            await broadcast_loop()

if __name__ == "__main__":
    asyncio.run(main())
