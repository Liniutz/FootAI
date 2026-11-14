#!/usr/bin/env python3
"""
CyberJam In-Process Workstation Session.

- Live guitar audio: captured from the Scarlett Solo (ALSA ``hw:2,0``) and passed
  straight through to the output device in the same duplex stream (zero extra copy),
  while every captured block is also fed to the DSP engine for tempo/key detection.
- Cargo (Romanian rock) backing band: warm finger bass + acoustic rock drums with
  arena reverb / chorus.
- The RNN-style sequencer stays silent until BPM **and** key have both been
  determined from the live guitar, then locks in and keeps playing.
- WebSocket telemetry (ws://127.0.0.1:8080) + Nota DAW MCP server (127.0.0.1:3900).
"""

from __future__ import annotations

import asyncio
import logging
import os
import queue
import sys
import threading
import time

import numpy as np
import sounddevice as sd

sys.path.insert(0, '/tmp/claw-daw-src/claw-daw-main')
from cyberjam.audio_dsp import AudioDSPEngine
from cyberjam.config import MusicalState, SessionConfig
from cyberjam.midi_egress import MidiEgress
from cyberjam.ml_brain import MLSequencer, generate_bass_midi, generate_drum_midi
from cyberjam.generative import LiveContext, LiveGrooveGenerator, MidiStepEvent, NOTE_NAMES, infer_key
from cyberjam.rnn_client import RnnClient, to_events
from cyberjam.ws_telemetry import WebSocketTelemetryServer
from nota_mcp_bridge import NotaMcpBridgeServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("inprocess_session")

try:
    import fluidsynth
    HAS_FLUIDSYNTH = True
except ImportError:
    HAS_FLUIDSYNTH = False

# Scarlett Solo 3rd gen exposes capture + playback on ALSA `hw:2,0`.
INPUT_DEVICE = os.environ.get("CYBERJAM_INPUT_DEVICE", "Scarlett")
# Monitor on the system default sink by default. The direct Scarlett ALSA
# device's playback-channel count varies across PortAudio host APIs; add it
# explicitly via CYBERJAM_OUTPUT_DEVICES only when its output is needed.
OUTPUT_DEVICES = [
    d.strip()
    for d in os.environ.get("CYBERJAM_OUTPUT_DEVICES", "default").split(",")
    if d.strip()
]
SAMPLE_RATE = 48000
BLOCK_SIZE = 512

# Mix balance: boost the live guitar, pull the synthesized band back.
GUITAR_GAIN = float(os.environ.get("CYBERJAM_GUITAR_GAIN", "2.0"))
BAND_GAIN = float(os.environ.get("CYBERJAM_BAND_GAIN", "0.9"))
# Stop the band after this many seconds without guitar input.
SILENCE_TIMEOUT = float(os.environ.get("CYBERJAM_SILENCE_TIMEOUT", "6.0"))
# 0.0 = repeat the same motif, 1.0 = mutate constantly.
CREATIVITY = float(os.environ.get("CYBERJAM_CREATIVITY", "0.6"))

# Magenta RNN models (run in the Python 3.9 venv because TF 2.15 needs it).
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Available model sets. "cargo" = the fine-tuned Romanian rock bundles,
# "default" = the stock Magenta pretrained bundles.
MODEL_SETS: dict[str, dict[str, str]] = {
    "cargo": {
        "dir": os.path.join(BASE_DIR, "models/wetransfer_cargo_bass-mag_2026-11-14_1356"),
        "bass": "cargo_bass.mag",
        "drums": "cargo_drums.mag",
        "lead": "cargo_lead.mag",
    },
    "default": {
        "dir": os.path.join(BASE_DIR, "models/pretrained"),
        "bass": "attention_rnn.mag",
        "drums": "drum_kit_rnn.mag",
        "lead": "attention_rnn.mag",
    },
    "groovae": {
        "dir": os.path.join(BASE_DIR, "models/wetransfer_cargo_bass-mag_2026-11-14_1356"),
        "bass": "cargo_bass.mag",
        "drums": "cargo_drums.mag",
        "lead": "",
        "groovae": os.path.join(BASE_DIR, "models/groovae/tap2drum_2bar"),
        "groovae_taps": os.environ.get("CYBERJAM_GROOVAE_TAPS", "cargo"),
    },
}

RNN_ENABLED = os.environ.get("CYBERJAM_RNN", "1") != "0"
RNN_PYTHON = os.environ.get("CYBERJAM_RNN_PYTHON", os.path.join(BASE_DIR, ".venv-magenta/bin/python"))
RNN_WORKER = os.path.join(BASE_DIR, "scripts/rnn_worker.py")
RNN_SET = os.environ.get("CYBERJAM_RNN_SET", "cargo")
RNN_MODELS_DIR = os.environ.get("CYBERJAM_RNN_MODELS", MODEL_SETS.get(RNN_SET, MODEL_SETS["cargo"])["dir"])
RNN_TEMPERATURE = float(os.environ.get("CYBERJAM_RNN_TEMPERATURE", "1.05"))
RNN_PHRASE_BARS = int(os.environ.get("CYBERJAM_RNN_BARS", "4"))
LEAD_ENABLED = os.environ.get("CYBERJAM_LEAD", "0") == "1"

# Demo mode: wait for the player, capture a short window, then lock BPM + key.
DEMO_MODE = os.environ.get("CYBERJAM_DEMO", "0") == "1"
DEMO_BARS = int(os.environ.get("CYBERJAM_DEMO_BARS", "2"))

# Sound selection. GeneralUser GS ships several kits in percussion bank 128;
# "power" is the rock kit used by default.
SOUNDFONT_PATH = os.environ.get("CYBERJAM_SOUNDFONT", "")
DRUM_SOUNDFONT = os.environ.get("CYBERJAM_DRUM_SOUNDFONT", "")
DRUM_KIT = os.environ.get("CYBERJAM_DRUM_KIT", "power")
DRUM_PRESET = int(os.environ.get("CYBERJAM_DRUM_PRESET", "0"))

DRUM_KITS: dict[str, int] = {
    "standard": 0,
    "standard1": 0,
    "standard2": 1,
    "standard3": 2,
    "room": 8,
    "power": 16,
    "electronic": 24,
    "808": 25,
    "tr808": 25,
    "dance": 26,
    "jazz": 32,
    "brush": 40,
    "orchestral": 48,
    "sfx": 56,
}


def resolve_drum_preset(kit: str) -> int:
    """Map a kit name (or numeric preset) to a percussion-bank preset index."""
    value = str(kit).strip().lower()
    if value.isdigit():
        return int(value) % 128
    return DRUM_KITS.get(value, DRUM_KITS["power"])


def _resolve_device(query: str, need_input: bool) -> int | None:
    """Resolve a device name substring (or numeric index) to a PortAudio index.

    PipeWire exposes extra client nodes whose names also contain "Scarlett"
    (e.g. "Scarlett Solo (3rd Gen.) Input 2 Inst/Line"). Those go through the
    PipeWire graph and can deliver silence, so direct ALSA ``(hw:x,y)`` devices
    are strongly preferred and PipeWire/Split nodes are penalised.
    """
    if query.isdigit():
        return int(query)

    best: tuple[int, int] | None = None  # (score, index)
    for idx, dev in enumerate(sd.query_devices()):
        name = dev["name"]
        if query.lower() not in name.lower():
            continue
        if need_input and dev["max_input_channels"] <= 0:
            continue
        if not need_input and dev["max_output_channels"] <= 0:
            continue

        score = 0
        if "(hw:" in name:
            score += 100
        if "pipewire" in name.lower() or "split" in name.lower():
            score -= 50
        if name.lower().startswith(query.lower()):
            score += 10
        if best is None or score > best[0]:
            best = (score, idx)

    return best[1] if best is not None else None


class InProcessCyberJamSession:
    def __init__(self) -> None:
        self.config = SessionConfig()
        self.config.sample_rate = SAMPLE_RATE
        self.config.block_size = BLOCK_SIZE
        self.config.channels = 1

        self.state = MusicalState()
        self.egress = MidiEgress(port_name="CyberJam_Band")

        self.dsp = AudioDSPEngine(self.config, self.state)
        self.ml = MLSequencer(self.config, self.state, self.egress)
        self.telemetry = WebSocketTelemetryServer(self.config, self.state)
        self.mcp_server = NotaMcpBridgeServer(host="127.0.0.1", port=3900)

        self.synth = None
        self._soundfont: str | None = None
        self._drum_kit_name: str = "default"
        self._init_synth()

        self.active_notes_timeline: list[dict] = []
        self._generator = LiveGrooveGenerator(creativity=CREATIVITY)
        self._bar_events: tuple[list, list] = ([], [])
        self._rnn: RnnClient | None = None
        self._lead_events: list[MidiStepEvent] = []
        self._phrase: dict[str, list[list[MidiStepEvent]]] | None = None
        self._phrase_pos = 0
        self._phrase_len = 0
        self._phrase_bars = 2 if MODEL_SETS.get(RNN_SET, {}).get("groovae") else RNN_PHRASE_BARS
        self._taps = [0] * 32
        self._tap_pos = 0
        self._last_onset_count = 0
        self._rnn_bars = 0
        self._fallback_bars = 0

        # Guided capture state: Freestyle (or explicit --demo) waits, captures, then locks.
        self._demo_mode = (
            DEMO_MODE
            or os.environ.get("CYBERJAM_FREESTYLE", "0") == "1"
            or os.environ.get("CYBERJAM_SESSION_MODE", "").lower() == "freestyle"
        )
        self._demo_phase = "wait" if self._demo_mode else ""
        self._demo_capture_start: float | None = None
        self._demo_capture_secs = DEMO_BARS * 4 * 60.0 / max(40.0, self.config.default_bpm)
        self._demo_bpm_samples: list[float] = []
        self._demo_locked = False
        self._locked_bpm = float(self.config.default_bpm)
        self._locked_root_pc = 4
        self._locked_mode = "minor"
        self._synth_thread: threading.Thread | None = None
        self._synth_stop = threading.Event()
        self._in_stream: sd.InputStream | None = None
        self._out_streams: list[tuple[str, sd.OutputStream]] = []
        self._capture_name: str | None = None
        self._monitor_names: list[str] = []
        self._passthrough_q: queue.Queue[np.ndarray] = queue.Queue(maxsize=8)

    # ------------------------------------------------------------------ synth
    def _init_synth(self) -> None:
        if not HAS_FLUIDSYNTH:
            logger.warning("fluidsynth python package missing; backing band will be MIDI-only.")
            return
        try:
            # FluidSynth prints harmless SDL3 / SineWave ROM notices on stderr.
            old_stderr = os.dup(2)
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 2)
            os.close(devnull)
            try:
                self.synth = fluidsynth.Synth()
                self.synth.start(driver="alsa")
                self.synth.set_reverb(0.75, 0.4, 0.8, 0.6)
                self.synth.set_chorus(2, 0.4, 1.0, 2.0, 0)

                sfpath = None
                candidates = []
                if SOUNDFONT_PATH:
                    candidates.append(SOUNDFONT_PATH)
                candidates.extend(
                    (
                        os.path.expanduser("~/.local/share/soundfonts/GeneralUser-GS.sf2"),
                        "/tmp/GeneralUser-GS.sf2",
                        "/tmp/FluidR3_GM.sf2",
                        "/home/boxa/.cache/uv/sdists-v9/pypi/pretty-midi/0.2.9/"
                        "wNM2i0L7bXNhwSxt/src/pretty_midi/TimGM6mb.sf2",
                    )
                )
                for candidate in candidates:
                    if candidate and os.path.exists(candidate):
                        sfpath = candidate
                        break

                if sfpath:
                    sfid = self.synth.sfload(sfpath)
                    self.synth.program_select(1, sfid, 0, 32)   # Acoustic (upright) bass - jazzy, round
                    if LEAD_ENABLED:
                        self.synth.program_select(2, sfid, 0, 27)  # Clean electric guitar
                    self._soundfont = sfpath

                    # Drums: optionally a dedicated kit soundfont, otherwise a
                    # percussion-bank preset from the main soundfont.
                    if DRUM_SOUNDFONT and os.path.exists(DRUM_SOUNDFONT):
                        drum_sfid = self.synth.sfload(DRUM_SOUNDFONT)
                        self.synth.program_select(9, drum_sfid, 128, DRUM_PRESET)
                        self._drum_kit_name = f"{os.path.basename(DRUM_SOUNDFONT)} preset {DRUM_PRESET}"
                        logger.info("Drum kit loaded from %s (bank 128, preset %d).",
                                    DRUM_SOUNDFONT, DRUM_PRESET)
                    else:
                        preset = resolve_drum_preset(DRUM_KIT)
                        self.synth.program_select(9, sfid, 128, preset)
                        try:
                            kit_name = self.synth.sfpreset_name(sfid, 128, preset) or str(preset)
                        except Exception:
                            kit_name = str(preset)
                        self._drum_kit_name = f"{kit_name} (bank 128, preset {preset})"
                        logger.info("Drum kit: %s", self._drum_kit_name)
            finally:
                os.dup2(old_stderr, 2)
                os.close(old_stderr)
            self._set_synth_gain(BAND_GAIN)
            logger.info("Cargo rock synth engine initialized (bass + drums) from %s.", self._soundfont)
        except Exception as exc:  # noqa: BLE001 - never block startup
            logger.error("In-process synth error: %s", exc)

    def _set_synth_gain(self, gain: float) -> None:
        """Set FluidSynth master gain (this pyfluidsynth build has no setter)."""
        try:
            import ctypes

            lib = ctypes.CDLL(fluidsynth.find_libfluidsynth())
            lib.fluid_synth_set_gain.argtypes = [ctypes.c_void_p, ctypes.c_float]
            lib.fluid_synth_set_gain.restype = None
            lib.fluid_synth_set_gain(ctypes.c_void_p(self.synth.synth), float(gain))
            logger.info("Band gain set to %.2f", gain)
        except Exception as exc:  # noqa: BLE001 - gain is a mix nicety, never fatal
            logger.warning("Could not set FluidSynth gain (%s); band stays at default level.", exc)

    # ------------------------------------------------------------- audio path
    def _open_streams(self, input_device: str, output_devices: list[str]) -> None:
        """Open the capture stream plus one output stream per monitor device.

        A duplex ``sd.Stream`` silently produced no output on this PipeWire setup,
        so capture and playback are opened independently and the input callback
        writes each block to every active output stream.
        """
        in_idx = _resolve_device(input_device, need_input=True)
        if in_idx is None:
            raise RuntimeError(f"no input device matching {input_device!r}")

        self._out_streams = []
        for dev in output_devices:
            out_idx = _resolve_device(dev, need_input=False)
            if out_idx is None:
                logger.warning("Monitor output %r not found, skipping.", dev)
                continue
            try:
                stream = sd.OutputStream(
                    device=out_idx,
                    channels=2,
                    samplerate=SAMPLE_RATE,
                    blocksize=BLOCK_SIZE,
                    dtype="float32",
                )
                stream.start()
                self._out_streams.append((sd.query_devices(out_idx)["name"], stream))
                logger.info("Monitor output open: %s", sd.query_devices(out_idx)["name"])
            except Exception as exc:  # noqa: BLE001
                logger.warning("Monitor output %r unavailable: %s", dev, exc)

        if not self._out_streams:
            raise RuntimeError("no output device could be opened")

        self._in_stream = sd.InputStream(
            device=in_idx,
            channels=2,
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            dtype="float32",
            callback=self._input_callback,
        )
        self._in_stream.start()
        self._capture_name = sd.query_devices(in_idx)["name"]
        self._monitor_names = [name for name, _ in self._out_streams]
        logger.info("Capture input open: %s", self._capture_name)

    def _input_callback(self, indata, frames, time_info, status) -> None:
        """Queue guitar audio for passthrough and feed the DSP engine. Never block."""
        if status:
            pass

        # Hand the block to the passthrough writer thread (never block here).
        try:
            self._passthrough_q.put_nowait(indata.copy())
        except queue.Full:
            try:
                self._passthrough_q.get_nowait()
                self._passthrough_q.put_nowait(indata.copy())
            except queue.Empty:
                pass

        # Same block goes to the DSP worker (tempo / key / pitch / RMS).
        # The Scarlett Solo exposes Input 1 (mic) and Input 2 (instrument) as
        # separate channels, so analyse whichever channel is actually hotter.
        if indata.ndim > 1 and indata.shape[1] > 1:
            energies = np.mean(np.square(indata), axis=0)
            mono = indata[:, int(np.argmax(energies))]
        else:
            mono = indata[:, 0] if indata.ndim > 1 else indata
        self.dsp.feed_audio(np.ascontiguousarray(mono, dtype=np.float32))

    def _passthrough_loop(self) -> None:
        """Write queued guitar blocks to every monitor output (off the audio thread)."""
        while not self._synth_stop.is_set():
            try:
                block = self._passthrough_q.get(timeout=0.1)
            except queue.Empty:
                continue
            if GUITAR_GAIN != 1.0:
                block = np.clip(block * GUITAR_GAIN, -1.0, 1.0)
            for _name, stream in self._out_streams:
                if not stream.active:
                    continue
                try:
                    stream.write(block)
                except Exception:
                    pass

    def _play_test_tone(self) -> None:
        """Short beep on every monitor output so the player can confirm routing."""
        if os.environ.get("CYBERJAM_TEST_TONE", "1") == "0":
            return
        t = np.arange(int(SAMPLE_RATE * 0.35), dtype=np.float32) / SAMPLE_RATE
        tone = (0.25 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        stereo = np.column_stack([tone, tone])
        for name, stream in self._out_streams:
            try:
                stream.write(stereo)
                logger.info("Test tone played on %s", name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Test tone failed on %s: %s", name, exc)

    # ------------------------------------------------------------ backing band
    def _stop_band(self, held_bass: list[tuple[int, float]], reason: str) -> None:
        """Silence every band voice and clear the piano-roll timeline."""
        for note, _started in held_bass:
            if self.synth:
                try:
                    self.synth.noteoff(1, note)
                except Exception:
                    pass
            self.egress.note_off(channel=2, note=note)
        held_bass.clear()

        if self.synth:
            for channel in (1, 9):
                try:
                    self.synth.all_notes_off(channel)
                except Exception:
                    pass

        self.active_notes_timeline.clear()
        self._taps = [0] * 32
        self._tap_pos = 0
        if self._demo_mode:
            # Let the guided capture start over: prompt again on the next note.
            self._demo_phase = "wait"
            self._demo_locked = False
        try:
            self.state.update(
                band_active=False,
                notes=[],
                current_step=0,
                demo_phase=self._demo_phase,
                demo_prompt=("Play 2 bars (8 measures) to set the groove." if self._demo_mode else self.state.snapshot().get("demo_prompt", "")),
            )
        except Exception:
            pass
        logger.info("Band stopped: %s", reason)

    def _rnn_phrase(self, result: dict) -> dict[str, list[list[MidiStepEvent]]]:
        """Group a multi-bar RNN response into per-bar event lists."""
        bars = max(1, int(result.get("bars") or 1))
        phrase: dict[str, list[list[MidiStepEvent]]] = {}
        for track, fold in (("bass", True), ("drums", False), ("lead", False)):
            per_bar: list[list[MidiStepEvent]] = [[] for _ in range(bars)]
            for event in to_events(result.get(track) or [], fold_low=fold):
                index = min(bars - 1, event["bar"])
                per_bar[index].append(
                    MidiStepEvent(event["step"], event["note"], event["velocity"])
                )
            phrase[track] = per_bar
        return phrase

    def _synth_audio_loop(self) -> None:
        step = 0
        armed = False
        held_bass: list[tuple[int, float]] = []  # (note, start_time)
        last_active = time.monotonic()
        next_tick = time.monotonic()

        while not self._synth_stop.is_set():
            snapshot = self.state.snapshot()
            now = time.monotonic()

            # ---- Demo mode: prompt, capture, then lock BPM + key -------------
            if self._demo_mode:
                playing = float(snapshot.get("rms") or 0.0) > 0.003 or snapshot.get("is_playing")

                if self._demo_phase == "wait":
                    if playing:
                        self._demo_phase = "capture"
                        self._demo_capture_start = now
                        self._demo_bpm_samples = []
                        current_bpm = float(snapshot.get("bpm") or self.config.default_bpm)
                        self._demo_initial_bpm = current_bpm
                        self._demo_capture_secs = DEMO_BARS * 4 * 60.0 / max(40.0, current_bpm)
                        capture_secs = self._demo_capture_secs
                        msg = (
                            f"Play {DEMO_BARS} bars ({DEMO_BARS * 4} measures) "
                            f"(~{capture_secs:.0f}s) — I'm learning your groove."
                        )
                        logger.info("DEMO: %s", msg)
                        self.state.update(demo_phase="capture", demo_prompt=msg)
                        self._synth_stop.wait(0.05)
                        continue
                    else:
                        self._synth_stop.wait(0.05)
                        continue

                elif self._demo_phase == "capture":
                    current_bpm = float(snapshot.get("bpm") or self.config.default_bpm)
                    detected_bpm = float(snapshot.get("bpm") or 0.0)
                    # Reject implausible octave/subdivision jumps against the
                    # current tracker estimate; the median then resists strum jitter.
                    if snapshot.get("detected_bpm") and 40.0 <= detected_bpm <= 240.0:
                        reference_bpm = (
                            self._demo_bpm_samples[-1]
                            if self._demo_bpm_samples
                            else self._demo_initial_bpm
                        )
                        if abs(detected_bpm - reference_bpm) <= max(12.0, reference_bpm * 0.18):
                            self._demo_bpm_samples.append(detected_bpm)
                    # Capture the originally requested two-bar window; changing
                    # BPM estimates must not move the deadline underneath the player.
                    capture_secs = self._demo_capture_secs
                    elapsed = now - (self._demo_capture_start or now)
                    if elapsed >= capture_secs:
                        pitch_classes = tuple(snapshot.get("pitch_classes") or ())
                        root_pc, mode = infer_key(
                            pitch_classes,
                            fallback_pc=int(snapshot.get("midi_note") or 4) % 12,
                        )
                        if self._demo_bpm_samples:
                            ordered_bpms = sorted(self._demo_bpm_samples)
                            middle = len(ordered_bpms) // 2
                            self._locked_bpm = (
                                ordered_bpms[middle]
                                if len(ordered_bpms) % 2
                                else (ordered_bpms[middle - 1] + ordered_bpms[middle]) / 2
                            )
                        else:
                            self._locked_bpm = float(snapshot.get("bpm") or self.config.default_bpm)
                        self._locked_root_pc = root_pc
                        self._locked_mode = mode
                        self._demo_locked = True
                        self._demo_phase = "locked"
                        step = 0
                        next_tick = time.monotonic()
                        last_active = now
                        armed = True
                        msg = (
                            f"Locked: {self._locked_bpm:.0f} BPM, "
                            f"{NOTE_NAMES[self._locked_root_pc]} {self._locked_mode}. "
                            "Generating the band..."
                        )
                        logger.info("DEMO: %s", msg)
                        try:
                            self.state.update(
                                demo_phase="locked", demo_prompt=msg, band_active=True
                            )
                        except Exception:
                            pass
                    else:
                        remaining = max(0, capture_secs - elapsed)
                        self.state.update(
                            demo_prompt=(
                                f"Listening... {remaining:.0f}s of {DEMO_BARS} bars left. "
                                "Keep it steady."
                            )
                        )
                        self._synth_stop.wait(0.05)
                        continue

            # Any guitar signal above the noise gate keeps the band alive.
            if float(snapshot.get("rms") or 0.0) > 0.01 or snapshot.get("is_playing"):
                last_active = now

            # Silence timeout: stop the models after N seconds without playing.
            if armed and (now - last_active) > SILENCE_TIMEOUT:
                self._stop_band(held_bass, f"no guitar input for {SILENCE_TIMEOUT:.0f}s")
                armed = False
                self._synth_stop.wait(0.05)
                continue

            # Gate: do not play a single note until BPM *and* key are known.
            if not armed:
                if snapshot.get("detected_bpm") and snapshot.get("detected_key"):
                    armed = True
                    step = 0
                    next_tick = time.monotonic()
                    last_active = now
                    try:
                        self.state.update(band_active=True)
                    except Exception:
                        pass
                    logger.info(
                        "Tempo & key locked from live guitar (BPM=%.1f, key=%s) - starting the band.",
                        float(snapshot.get("bpm") or self.config.default_bpm),
                        snapshot.get("key"),
                    )
                else:
                    self._synth_stop.wait(0.05)
                    continue

            if self._demo_locked:
                # Demo: tempo and key stay exactly as captured in the first bars.
                bpm = self._locked_bpm
                root_pc = self._locked_root_pc
                mode = self._locked_mode
                root_key = NOTE_NAMES[root_pc % 12]
            else:
                raw_bpm = snapshot.get("bpm")
                bpm = float(raw_bpm) if raw_bpm else float(self.config.default_bpm)
                if bpm <= 0:
                    bpm = float(self.config.default_bpm)

                key_str = str(snapshot.get("key") or self.config.default_key)
                root_key = key_str.split()[0] if key_str else self.config.default_key
                root_pc, mode = infer_key(
                    tuple(snapshot.get("pitch_classes") or ()),
                    fallback_pc=int(snapshot.get("midi_note") or 4) % 12,
                )

            step_dur = 60.0 / bpm / 4.0

            # Record guitar onsets as "taps" for GrooVAE (2 bars = 32 steps).
            onset_count = int(snapshot.get("onset_count") or 0)
            if onset_count > self._last_onset_count:
                self._taps[self._tap_pos] = 1
            self._last_onset_count = onset_count
            self._tap_pos = (self._tap_pos + 1) % 32

            # Pick the bar to play: continue the current RNN phrase, start a new
            # one, or fall back to the algorithmic engine.
            if step == 0:
                pitch_classes = tuple(snapshot.get("pitch_classes") or ())
                ctx = LiveContext(
                    bpm=bpm,
                    root_pc=root_pc,
                    mode=mode,
                    rms=float(snapshot.get("rms") or 0.0),
                    centroid=float(snapshot.get("spectral_centroid_hz") or 0.0),
                    pitch_classes=pitch_classes,
                    creativity=CREATIVITY,
                )

                used_rnn = False
                if self._phrase is not None and self._phrase_pos < self._phrase_len:
                    index = self._phrase_pos
                    self._bar_events = (
                        self._phrase["bass"][index],
                        self._phrase["drums"][index],
                    )
                    self._lead_events = self._phrase["lead"][index]
                    self._phrase_pos += 1
                    used_rnn = True
                    self._rnn_bars += 1
                else:
                    result = self._rnn.take() if self._rnn and self._rnn.available else None
                    if result and result.get("bass") and result.get("drums"):
                        self._phrase = self._rnn_phrase(result)
                        self._phrase_len = len(self._phrase["bass"])
                        self._phrase_pos = 1
                        self._bar_events = (
                            self._phrase["bass"][0],
                            self._phrase["drums"][0],
                        )
                        self._lead_events = self._phrase["lead"][0]
                        used_rnn = True
                        self._rnn_bars += 1
                    else:
                        self._bar_events = self._generator.next_bar(ctx)
                        self._lead_events = []
                        self._fallback_bars += 1

                # Request the next phrase two bars before this one runs out.
                bars_left = self._phrase_len - self._phrase_pos
                if self._rnn and self._rnn.available and bars_left <= 2:
                    self._rnn.submit(
                        {
                            "bpm": round(bpm, 2),
                            "root_pc": root_pc,
                            "mode": mode,
                            "rms": float(snapshot.get("rms") or 0.0),
                            "temperature": RNN_TEMPERATURE,
                            "bars": self._phrase_bars,
                            "taps": [i for i, hit in enumerate(self._taps) if hit],
                            "seed": self._rnn_bars + self._fallback_bars,
                        }
                    )
                logger.info(
                    "New bar -> %s (%s)",
                    self._generator.describe(ctx),
                    "RNN" if used_rnn else "fallback",
                )

            bass_pat, drum_pat = self._bar_events

            # Release bass notes after ~2.6 steps for a rounder, more legato feel.
            for note, started in list(held_bass):
                if now - started >= step_dur * 2.6:
                    if self.synth:
                        try:
                            self.synth.noteoff(1, note)
                        except Exception:
                            pass
                    self.egress.note_off(channel=2, note=note)
                    held_bass.remove((note, started))

            for ev in bass_pat:
                if ev.step != step:
                    continue
                vel = max(30, min(105, int(ev.velocity * 0.85)))  # softer, less punch
                if self.synth:
                    try:
                        self.synth.noteon(1, ev.note, vel)
                    except Exception:
                        pass
                self.egress.note_on(channel=2, note=ev.note, velocity=vel)
                held_bass.append((ev.note, now))
                self.active_notes_timeline.append(
                    {"time": time.time(), "pitch": ev.note, "duration": 0.35, "track": "bass"}
                )

            for ev in drum_pat:
                if ev.step != step:
                    continue
                note = ev.note
                vel = 127 if note == 36 else (120 if note == 38 else int(ev.velocity * 1.3))
                if self.synth:
                    try:
                        self.synth.noteon(9, note, vel)
                    except Exception:
                        pass
                self.egress.note_on(channel=10, note=note, velocity=vel)
                self.active_notes_timeline.append(
                    {"time": time.time(), "pitch": note + 12, "duration": 0.15, "track": "drums"}
                )

            # Optional lead line (off by default; enable with CYBERJAM_LEAD=1).
            if LEAD_ENABLED:
                for ev in self._lead_events:
                    if ev.step != step:
                        continue
                    if self.synth:
                        try:
                            self.synth.noteon(2, ev.note, ev.velocity)
                        except Exception:
                            pass
                    self.egress.note_on(channel=3, note=ev.note, velocity=ev.velocity)
                    self.active_notes_timeline.append(
                        {"time": time.time(), "pitch": ev.note, "duration": 0.3, "track": "lead"}
                    )

            if len(self.active_notes_timeline) > 150:
                self.active_notes_timeline = self.active_notes_timeline[-100:]

            try:
                self.state.update(
                    current_step=step,
                    active_root=root_key,
                    notes=self.active_notes_timeline,
                )
            except Exception:
                pass

            step = (step + 1) % 16

            # Absolute scheduling: never accumulate drift across steps or bars.
            next_tick += step_dur
            delay = next_tick - time.monotonic()
            if delay > 0:
                self._synth_stop.wait(delay)
            else:
                next_tick = time.monotonic()

    # ------------------------------------------------------------ diagnostics
    def _status_loop(self) -> None:
        """Log live input level / detection so the terminal shows what the DSP hears."""
        while not self._synth_stop.is_set():
            snap = self.state.snapshot()
            rms = float(snap.get("rms") or 0.0)
            logger.info(
                "in rms=%.4f | bpm=%s | key=%s | note=%s | detected bpm=%s key=%s",
                rms,
                f"{float(snap['bpm']):.1f}" if snap.get("bpm") else "-",
                snap.get("key") or "-",
                snap.get("note") or "-",
                snap.get("detected_bpm"),
                snap.get("detected_key"),
            )
            self._synth_stop.wait(2.0)

    # ------------------------------------------------------------------- main
    async def async_main(self) -> None:
        self.egress.open()

        # DSP worker only; audio is captured by our duplex passthrough stream.
        self.dsp.start_processing()

        try:
            self._open_streams(INPUT_DEVICE, OUTPUT_DEVICES)
            logger.info("Guitar streams open: %s -> %s (passthrough + DSP feed)", INPUT_DEVICE, ", ".join(OUTPUT_DEVICES))
        except Exception as exc:  # noqa: BLE001
            allow_fallback = os.environ.get("CYBERJAM_ALLOW_DEFAULT_INPUT", "0") == "1"
            if not allow_fallback:
                logger.error(
                    "Guitar input %r unavailable (%s). Plug the interface in, or set "
                    "CYBERJAM_ALLOW_DEFAULT_INPUT=1 to use the system default input. "
                    "The band stays silent until audio is present.",
                    INPUT_DEVICE,
                    exc,
                )
            else:
                logger.warning("Primary audio streams failed (%s); trying the system default input.", exc)
                try:
                    self._open_streams("default", ["default"])
                    logger.info("Guitar streams open: default -> default (passthrough + DSP feed)")
                except Exception as exc2:  # noqa: BLE001
                    logger.error("Could not open passthrough streams (%s). Falling back to DSP capture.", exc2)
                    self.dsp.start()

        self.ml.start()
        await self.telemetry.start()

        # Start the Magenta RNN worker (separate Python 3.9 venv). Non-fatal.
        if RNN_ENABLED:
            model_set = MODEL_SETS.get(RNN_SET, MODEL_SETS["cargo"])
            worker_args = [
                "--bass", model_set["bass"],
                "--drums", model_set["drums"],
                "--lead", model_set["lead"] if LEAD_ENABLED else "",
            ]
            if model_set.get("groovae"):
                worker_args += ["--groovae-dir", model_set["groovae"]]
                worker_args += ["--groovae-taps", model_set.get("groovae_taps", "cargo")]
            self._rnn = RnnClient(RNN_PYTHON, RNN_WORKER, RNN_MODELS_DIR, worker_args=worker_args)
            if not self._rnn.start():
                logger.warning("RNN models unavailable - using the algorithmic generator.")
                self._rnn = None

        self._synth_stop.clear()
        self._play_test_tone()
        threading.Thread(target=self._passthrough_loop, daemon=True).start()
        self._synth_thread = threading.Thread(target=self._synth_audio_loop, daemon=True)
        self._synth_thread.start()
        threading.Thread(target=self._status_loop, daemon=True).start()

        mcp_thread = threading.Thread(target=lambda: asyncio.run(self.mcp_server.start()), daemon=True)
        mcp_thread.start()

        logger.info("==================================================")
        logger.info(" CyberJam - Cargo Live Stage Mode")
        logger.info(" - Guitar: %s -> %s passthrough + DSP analysis",
                    self._capture_name or "no input",
                    ", ".join(self._monitor_names) or "no output")
        logger.info(" - Band arms itself after first BPM + key detection")
        logger.info(" - Generation: %s", f"Magenta RNN bundles [{RNN_SET}]" if self._rnn else "algorithmic fallback")
        logger.info(" - Drum kit: %s", self._drum_kit_name)
        logger.info(" - Telemetry: ws://127.0.0.1:8080 | MCP: http://127.0.0.1:3900")
        logger.info("==================================================")

        try:
            while True:
                await asyncio.sleep(3600)
        finally:
            self._synth_stop.set()
            if self._in_stream is not None:
                self._in_stream.stop()
                self._in_stream.close()
            for _dev, stream in self._out_streams:
                try:
                    stream.stop()
                    stream.close()
                except Exception:
                    pass
            self._out_streams = []
            if self._rnn is not None:
                self._rnn.stop()
            if self._synth_thread is not None:
                self._synth_thread.join(timeout=1.0)
            self.ml.stop()
            self.dsp.stop()
            await self.telemetry.stop()
            self.egress.close()
            if self.synth is not None:
                try:
                    self.synth.delete()
                except Exception:
                    pass


def _parse_args() -> "argparse.Namespace":
    import argparse

    parser = argparse.ArgumentParser(
        description="CyberJam live session (guitar passthrough + Magenta RNN band)."
    )
    parser.add_argument(
        "--models",
        choices=sorted(MODEL_SETS),
        default=RNN_SET,
        help="RNN model set: 'cargo' (fine-tuned) or 'default' (stock Magenta).",
    )
    parser.add_argument(
        "--rnn-models-dir",
        default=None,
        help="Override the directory that holds the .mag bundles.",
    )
    parser.add_argument("--no-rnn", action="store_true", help="Disable the RNN worker entirely.")
    parser.add_argument("--lead", action="store_true", help="Enable the generated lead line.")
    parser.add_argument("--creativity", type=float, default=None, help="Fallback engine creativity 0..1.")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Guided demo: prompt the player, capture a short window, then lock BPM + key.",
    )
    parser.add_argument(
        "--demo-bars",
        type=int,
        default=DEMO_BARS,
        help="Bars to capture in demo mode (default 2).",
    )
    parser.add_argument(
        "--drum-kit",
        default=DRUM_KIT,
        help="Percussion-bank kit name or preset index: power (rock, default), standard, "
        "standard2, standard3, room, jazz, brush, electronic, 808, dance, orchestral, sfx.",
    )
    parser.add_argument(
        "--drum-soundfont",
        default=DRUM_SOUNDFONT,
        help="Dedicated drum-kit .sf2 assigned to MIDI channel 10.",
    )
    parser.add_argument(
        "--drum-preset",
        type=int,
        default=DRUM_PRESET,
        help="Preset index inside --drum-soundfont (default 0).",
    )
    parser.add_argument("--soundfont", default=SOUNDFONT_PATH, help="Main .sf2 (bass/lead).")
    parser.add_argument(
        "--list-drum-kits",
        action="store_true",
        help="List the kits available in the soundfont and exit.",
    )
    return parser.parse_args()


def _list_drum_kits(soundfont: str) -> None:
    import fluidsynth

    path = soundfont or os.path.expanduser("~/.local/share/soundfonts/GeneralUser-GS.sf2")
    if not os.path.exists(path):
        print(f"SoundFont not found: {path}")
        return
    synth = fluidsynth.Synth()
    sfid = synth.sfload(path)
    print(f"Percussion kits in {path}:")
    for preset in range(128):
        try:
            name = synth.sfpreset_name(sfid, 128, preset)
        except Exception:
            name = ""
        if name:
            print(f"  {preset:3d}  {name}")
    synth.delete()


def main() -> None:
    global RNN_SET, RNN_MODELS_DIR, RNN_ENABLED, LEAD_ENABLED, CREATIVITY, DEMO_MODE, DEMO_BARS
    global SOUNDFONT_PATH, DRUM_SOUNDFONT, DRUM_KIT, DRUM_PRESET

    args = _parse_args()

    if args.list_drum_kits:
        _list_drum_kits(args.soundfont)
        return

    RNN_SET = args.models
    RNN_MODELS_DIR = args.rnn_models_dir or MODEL_SETS[RNN_SET]["dir"]
    if args.no_rnn:
        RNN_ENABLED = False
    if args.lead:
        LEAD_ENABLED = True
    if args.creativity is not None:
        CREATIVITY = max(0.0, min(1.0, args.creativity))
    if args.demo:
        DEMO_MODE = True
    DEMO_BARS = max(1, args.demo_bars)

    SOUNDFONT_PATH = args.soundfont or ""
    DRUM_SOUNDFONT = args.drum_soundfont or ""
    DRUM_KIT = args.drum_kit
    DRUM_PRESET = max(0, min(127, args.drum_preset))

    logger.info("Model set: %s (%s)", RNN_SET, RNN_MODELS_DIR)
    logger.info("Drum kit: %s", DRUM_SOUNDFONT or f"{DRUM_KIT} (bank 128)")
    if DEMO_MODE:
        logger.info("Demo mode: capture %d bars, then lock BPM + key.", DEMO_BARS)

    session = InProcessCyberJamSession()
    try:
        asyncio.run(session.async_main())
    except KeyboardInterrupt:
        logger.info("Shutting down session...")


if __name__ == "__main__":
    main()
