#!/usr/bin/env python3
"""Record (or load) guitar audio and show why the tempo tracker picks a BPM.

Record 15 s from the live input while playing to a metronome at a KNOWN tempo:
    .venv/bin/python scripts/tempo_debug.py --device pipewire --seconds 15 --expected 120 --save clip.wav
Analyse an existing mono/stereo 16-bit WAV:
    .venv/bin/python scripts/tempo_debug.py --wav clip.wav --expected 120
"""

from __future__ import annotations

import argparse
import sys
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cyberjam.audio_dsp import AudioDSPEngine  # noqa: E402
from cyberjam.config import SessionConfig  # noqa: E402
from cyberjam.tempo import GuitarTempoTracker, score_candidates  # noqa: E402

SR, HOP = 48000, 512


def record(device: str | int | None, seconds: float) -> np.ndarray:
    import sounddevice as sd

    print(f"Recording {seconds:.0f}s from {device or 'default'} ... play now!")
    y = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32", device=device)
    sd.wait()
    return y[:, 0]


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        if width != 2:
            sys.exit("Only 16-bit PCM WAV is supported")
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    data = data.reshape(-1, ch)[:, 0]
    if sr != SR:
        data = np.interp(np.arange(0, len(data), sr / SR), np.arange(len(data)), data).astype(np.float32)
    return data


def save_wav(path: str, y: np.ndarray) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wav")
    ap.add_argument("--device", default=None)
    ap.add_argument("--seconds", type=float, default=15.0)
    ap.add_argument("--expected", type=float, help="true tempo you played, for ratio hints")
    ap.add_argument("--save", help="save the recording to this WAV path")
    ap.add_argument("--noise-gate-db", type=float, default=-42.0)
    args = ap.parse_args()

    dev = int(args.device) if args.device and args.device.isdigit() else args.device
    y = load_wav(args.wav) if args.wav else record(dev, args.seconds)
    if args.save and not args.wav:
        save_wav(args.save, y)
        print(f"saved {args.save}")

    eng = AudioDSPEngine(SessionConfig(silence_db=args.noise_gate_db), state=__import__("cyberjam.config").config.MusicalState())
    eng._udp_sock.close()
    tracker = GuitarTempoTracker(SR / HOP)
    env: list[float] = []
    onsets = 0
    prev = None
    last_onset_t = -1.0
    onset_times: list[float] = []
    for i in range(0, len(y) - HOP, HOP):
        s = y[i : i + HOP]
        rms = float(np.sqrt(np.mean(s**2)))
        t = i / SR
        if rms <= eng._noise_gate_rms:
            prev = None
            env.append(0.0)
            tracker.push(0.0)
            continue
        mag = np.abs(np.fft.rfft(s * eng._hann))
        flux, prev = eng._compute_superflux(mag[eng._pick_band_mask], prev, rms)
        env.append(flux)
        tracker.push(flux)
        mean_flux = np.mean(env[-32:])
        if flux > mean_flux * 1.65 + 0.15 and t - last_onset_t > 0.10 and len(env) > 8:
            last_onset_t = t
            onsets += 1
            onset_times.append(t)

    fps = SR / HOP
    env_a = np.asarray(env)
    gated = float(np.mean(env_a > 0))
    print(f"\nrms(max)={np.sqrt(np.mean(y**2)):.4f}  frames above gate={gated:.0%}  onsets={onsets}")
    if len(onset_times) > 2:
        iois = np.diff(onset_times)
        print(f"median onset interval = {np.median(iois)*1000:.0f} ms  (=> {60/np.median(iois):.0f} 'onsets per minute')")

    res = score_candidates(env_a[-int(6 * fps):], fps)
    if res is None:
        sys.exit("Not enough rhythmic signal (is the input level above the noise gate?)")
    bpms, raw, weighted = res
    order = []
    for idx in np.argsort(weighted)[::-1]:
        if all(abs(bpms[idx] - bpms[j]) > 4 for j in order):
            order.append(idx)
        if len(order) == 8:
            break
    print("\nTop tempo candidates (last 6 s):")
    print(f"{'BPM':>6} {'raw comb':>9} {'weighted':>9} {'x expected':>11}")
    for j in order:
        ratio = f"{bpms[j]/args.expected:.2f}" if args.expected else "-"
        print(f"{bpms[j]:6.1f} {raw[j]:9.3f} {weighted[j]:9.3f} {ratio:>11}")
    print(f"\nTracker output after full clip: {tracker.bpm if tracker.bpm else 'no lock'}")


if __name__ == "__main__":
    main()
