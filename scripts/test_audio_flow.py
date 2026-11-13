#!/usr/bin/env python3
"""Feed a sample WAV file through the full CyberJam DSP and ML sequencer loop,
and print out any generated MIDI notes.
"""

from __future__ import annotations

import argparse
import logging
import time
import wave
import numpy as np
import mido

from cyberjam.config import SessionConfig, MusicalState
from cyberjam.audio_dsp import AudioDSPEngine
from cyberjam.midi_egress import MidiEgress
from cyberjam.ml_brain import MLSequencer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("audio_flow_test")

def load_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        if width != 2:
            raise ValueError("Only 16-bit PCM WAV supported for test")
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return data.reshape(-1, ch)[:, 0], sr

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True, help="Path to a 16-bit PCM WAV file (e.g. clip.wav)")
    args = ap.parse_args()

    mido.set_backend("mido.backends.rtmidi")
    port_name = "CyberJam_AudioTest"

    logger.info("Opening virtual MIDI output port: %s", port_name)
    midi = MidiEgress(port_name=port_name)
    midi.open()

    inp = mido.open_input(port_name)
    received: list[mido.Message] = []
    inp.callback = lambda msg: received.append(msg)

    state = MusicalState()
    cfg = SessionConfig(midi_port_name=port_name, silence_db=-42.0)
    
    logger.info("Initializing AudioDSPEngine and MLSequencer...")
    audio_dsp = AudioDSPEngine(config=cfg, state=state)
    audio_dsp._use_aubio = False  # use robust NumPy SuperFlux/autocorrelation
    
    ml_seq = MLSequencer(config=cfg, state=state, midi=midi)

    audio_dsp.start()
    ml_seq.start()

    logger.info("Loading WAV file: %s", args.wav)
    audio_data, sr = load_wav(args.wav)
    block_size = cfg.block_size
    
    logger.info("Feeding audio blocks into DSP engine at real-time speed (or accelerated)...")
    t0 = time.time()
    for i in range(0, len(audio_data) - block_size, block_size):
        chunk = audio_data[i : i + block_size]
        # Simulate sounddevice callback ingress
        audio_dsp._audio_callback(chunk[:, np.newaxis], block_size, None, None)
        # Sleep slightly to let DSP worker process blocks smoothly
        time.sleep(block_size / cfg.sample_rate * 0.5)

    time.sleep(1.0)
    logger.info("Shutting down...")
    ml_seq.stop()
    audio_dsp.stop()
    midi.close()
    inp.close()

    logger.info("Total MIDI messages generated from WAV file: %d", len(received))
    for idx, msg in enumerate(received[:20]):
        logger.info("  [%2d] %s", idx, msg)

    snap = state.snapshot()
    logger.info("Final MusicalState snapshot: playing=%s, bpm=%.1f, key=%s, rms=%.4f",
                snap["is_playing"], snap["bpm"], snap["detected_pitch"]["key"], snap["rms"])
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
