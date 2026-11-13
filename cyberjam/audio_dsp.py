"""Audio ingress, UDP raw PCM broadcast, PipeWire loopback helper, and DSP worker ("The Ears")."""

from __future__ import annotations

from collections import deque
import logging
import math
import queue
import shutil
import socket
import subprocess
import threading
import time
import typing

try:
    import aubio
except ImportError:
    aubio = None  # type: ignore[assignment]

import numpy as np
import sounddevice as sd

from .config import MusicalState, SessionConfig

logger = logging.getLogger(__name__)

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def hz_to_note_info(freq_hz: float) -> tuple[int, str, str]:
    """Convert frequency in Hz to (midi_note, note_name_with_octave, pitch_class)."""
    if freq_hz <= 0.0:
        return 0, "N/A", "E"
    midi_float = 69.0 + 12.0 * math.log2(freq_hz / 440.0)
    midi_note = max(0, min(127, int(round(midi_float))))
    pitch_class = NOTE_NAMES[midi_note % 12]
    octave = (midi_note // 12) - 1
    return midi_note, f"{pitch_class}{octave}", pitch_class


def _select_audio_device(config: SessionConfig) -> int | str | None:
    """Prefer JACK/PipeWire host API when available so the node appears in qpwgraph."""
    if config.audio_device is not None:
        return config.audio_device

    if config.prefer_jack:
        try:
            hostapis = sd.query_hostapis()
            for idx, api in enumerate(hostapis):
                if "JACK" in api.get("name", "").upper():
                    default_in = api.get("default_input_device", -1)
                    if default_in is not None and default_in >= 0:
                        logger.info("Selected JACK host API (%s), device index %s", api["name"], default_in)
                        return int(default_in)
        except Exception as exc:
            logger.warning("Failed to query JACK host API, falling back to default: %s", exc)

    return None


class PipeWireLoopback:
    """Manages an optional PipeWire Virtual Source via pw-loopback for TouchDesigner/Web Audio."""

    def __init__(self) -> None:
        self._proc: subprocess.Popen[bytes] | None = None

    def start(self) -> None:
        if shutil.which("pw-loopback") is None:
            logger.warning("pw-loopback not found in PATH; skipping PipeWire Virtual Source creation.")
            return

        cmd = [
            "pw-loopback",
            "--capture-props=node.name=CyberJam_VisualIn node.description='CyberJam Visual In'",
            "--playback-props=media.class=Audio/Source node.name=CyberJam_VisualSource node.description='CyberJam Visual Audio'",
        ]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("Started PipeWire Virtual Source (pw-loopback PID %d)", self._proc.pid)
        except Exception as exc:
            logger.warning("Could not start pw-loopback: %s", exc)

    def stop(self) -> None:
        if self._proc is not None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._proc = None
            logger.info("Stopped PipeWire Virtual Source.")


class AudioDSPEngine:
    """Captures live guitar audio, broadcasts raw PCM via UDP, and extracts DSP features."""

    def __init__(self, config: SessionConfig, state: MusicalState) -> None:
        self.config = config
        self.state = state

        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=32)
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._stream: sd.InputStream | None = None

        # Non-blocking UDP socket for raw PCM broadcast to visuals
        self._udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp_sock.setblocking(False)
        self._udp_addr = (config.udp_host, config.udp_port)

        # Aubio DSP analyzers (hop_size == block_size for sub-50ms responsiveness)
        hop = config.block_size
        win = hop * 4  # 2048 samples (~42.6ms at 48kHz)
        self._use_aubio = aubio is not None
        if self._use_aubio:
            self._onset = aubio.onset("default", win, hop, config.sample_rate)
            self._onset.set_threshold(config.onset_threshold)
            self._onset.set_silence(config.silence_db)

            self._tempo = aubio.tempo("default", win, hop, config.sample_rate)
            self._tempo.set_silence(config.silence_db)

            self._aubio_pitch = aubio.pitch("yinfft", win, hop, config.sample_rate)
            self._aubio_pitch.set_unit("Hz")
            self._aubio_pitch.set_silence(config.silence_db)
        else:
            logger.warning("aubio C-extension not available; using NumPy spectral-flux onset & librosa.yin fallback.")
            self._onset = None
            self._tempo = None
            self._aubio_pitch = None

        self._noise_gate_rms = 10.0 ** (config.silence_db / 20.0)
        self._last_active_wall: float = 0.0

        self._prev_mag: np.ndarray | None = None
        self._flux_history: deque[float] = deque(maxlen=32)
        self._onset_times: deque[float] = deque(maxlen=48)
        self._last_onset_wall: float = 0.0
        self._last_bpm_calc_wall: float = 0.0
        self._smoothed_bpm: float | None = None

        self._rolling_buf: deque[float] = deque(maxlen=win)
        self._hann = np.hanning(hop).astype(np.float32)
        self._freqs = np.fft.rfftfreq(hop, d=1.0 / config.sample_rate)

        self._loopback: PipeWireLoopback | None = (
            PipeWireLoopback() if config.enable_pipewire_loopback else None
        )

    def start(self) -> None:
        """Start the PipeWire loopback (if enabled), DSP worker thread, and audio stream."""
        if self._loopback is not None:
            self._loopback.start()

        self._stop_event.clear()
        self._worker_thread = threading.Thread(
            target=self._dsp_worker_loop,
            name="CyberJamDSPWorker",
            daemon=True,
        )
        self._worker_thread.start()

        device = _select_audio_device(self.config)
        self._stream = sd.InputStream(
            samplerate=self.config.sample_rate,
            blocksize=self.config.block_size,
            device=device,
            channels=self.config.channels,
            dtype="float32",
            latency="low",
            callback=self._audio_callback,
        )
        self._stream.start()
        logger.info(
            "Audio ingress started (sr=%d, block=%d, udp=%s:%d, pitch=%s)",
            self.config.sample_rate,
            self.config.block_size,
            self.config.udp_host,
            self.config.udp_port,
            self.config.pitch_backend,
        )

    def stop(self) -> None:
        """Stop the audio stream, DSP worker, UDP socket, and optional loopback."""
        self._stop_event.set()
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None

        if self._worker_thread is not None:
            self._worker_thread.join(timeout=2.0)
            self._worker_thread = None

        try:
            self._udp_sock.close()
        except OSError:
            pass

        if self._loopback is not None:
            self._loopback.stop()

        logger.info("Audio ingress & DSP engine stopped.")

    def _audio_callback(
        self,
        indata: np.ndarray,
        frames: int,
        time_info: typing.Any,
        status: sd.CallbackFlags,
    ) -> None:
        """Real-time audio callback. Must NEVER block or allocate heavily."""
        if status:
            logger.debug("Audio callback status: %s", status)

        mono = np.ascontiguousarray(indata[:, 0], dtype=np.float32)

        # 1. Broadcast raw float32 PCM chunk to Visuals over UDP
        try:
            self._udp_sock.sendto(mono.tobytes(), self._udp_addr)
        except OSError:
            pass

        # 2. Enqueue for DSP worker (drop oldest if queue is full)
        try:
            self._audio_queue.put_nowait(mono.copy())
        except queue.Full:
            try:
                self._audio_queue.get_nowait()
                self._audio_queue.put_nowait(mono.copy())
            except queue.Empty:
                pass

    def _dsp_worker_loop(self) -> None:
        """Dedicated DSP thread for onset, BPM, RMS, spectral centroid, and pitch/key."""
        frame_counter = 0
        while not self._stop_event.is_set():
            try:
                samples = self._audio_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            rms = float(np.sqrt(np.mean(np.square(samples))))
            now = time.monotonic()
            above_gate = rms > self._noise_gate_rms
            mag = np.abs(np.fft.rfft(samples * self._hann)) if len(samples) == len(self._hann) else None
            centroid = self._compute_spectral_centroid_from_mag(mag) if above_gate else 0.0

            self._rolling_buf.extend(samples.tolist())
            pitch_hz: float | None = None
            note_str: str | None = None
            midi_note: int | None = None
            key_str: str | None = None
            is_onset = False
            bpm: float | None = None

            if above_gate:
                self._last_active_wall = now
                is_playing = True

                # Sub-50ms onset & tempo tracking (only while playing)
                if self._use_aubio:
                    is_onset = bool(self._onset(samples))
                    is_beat = bool(self._tempo(samples))
                    bpm = float(self._tempo.get_bpm()) if is_beat else None
                else:
                    is_onset, bpm = self._fallback_onset_and_bpm(mag, rms)

                # Pitch & key estimation
                detected_hz = self._estimate_pitch(samples, frame_counter)
                if 70.0 <= detected_hz <= 1400.0:
                    pitch_hz = detected_hz
                    midi_note, note_str, key_str = hz_to_note_info(detected_hz)
            else:
                # Reset pitch/playing state after silence hangover so UI doesn't freeze on stale notes
                if (now - self._last_active_wall) >= self.config.silence_hold_sec:
                    is_playing = False
                    pitch_hz = 0.0
                    note_str = "N/A"
                    midi_note = 0
                    key_str = "N/A"
                else:
                    is_playing = True

            self.state.update(
                is_playing=is_playing,
                bpm=bpm,
                pitch_hz=pitch_hz,
                note=note_str,
                midi_note=midi_note,
                key=key_str,
                rms=rms,
                spectral_centroid_hz=centroid,
                onset=is_onset,
            )
            frame_counter += 1

    def _compute_spectral_centroid_from_mag(self, mag: np.ndarray | None) -> float:
        if mag is None:
            return 0.0
        mag_sum = float(np.sum(mag))
        if mag_sum <= 1e-9:
            return 0.0
        return float(np.sum(self._freqs * mag) / mag_sum)

    @staticmethod
    def _estimate_bpm_from_onsets(onset_times: list[float], prev_bpm: float | None) -> float | None:
        """Estimate 4/4 BPM over a 2-3 bar onset window using beat-grid periodicity scoring."""
        if len(onset_times) < 8:
            return prev_bpm

        span = onset_times[-1] - onset_times[0]
        if span < 3.8:  # Require ~2 bars of 4/4 musical context before locking BPM
            return prev_bpm

        times = np.asarray(onset_times, dtype=np.float64)
        # Use local intervals (adjacent, skip-1, skip-2) to avoid long-range drift accumulation
        local_dts: list[np.ndarray] = []
        for lag in (1, 2, 3):
            if len(times) > lag:
                local_dts.append(times[lag:] - times[:-lag])
        if not local_dts:
            return prev_bpm

        diffs = np.concatenate(local_dts)
        dt = diffs[(diffs >= 0.28) & (diffs <= 2.1)]
        if len(dt) < 6:
            return prev_bpm

        candidates = np.arange(70.0, 166.0, 1.0, dtype=np.float64)
        periods = 60.0 / candidates[:, None]  # Shape: (N_bpm, 1)
        rem = np.mod(dt[None, :], periods)
        phase_err = np.minimum(rem, periods - rem)
        # Relative tolerance (8% of beat period) prevents high-BPM comb-density bias
        sigma = 0.08 * periods
        scores = np.mean(np.exp(-0.5 * (phase_err / sigma) ** 2), axis=1)

        max_score = float(np.max(scores))
        if max_score < 0.35:
            return prev_bpm

        # Break 2x harmonic ties by choosing the lowest BPM within 96% of peak alignment
        best_idx = int(np.where(scores >= max_score * 0.96)[0][0])
        raw_bpm = float(candidates[best_idx])

        if prev_bpm is None:
            return raw_bpm
        return (0.75 * prev_bpm) + (0.25 * raw_bpm)

    def _fallback_onset_and_bpm(self, mag: np.ndarray | None, rms: float) -> tuple[bool, float | None]:
        """Lightweight spectral-flux onset detector & 2-3 bar 4/4 BPM tracker."""
        if mag is None or rms <= self._noise_gate_rms:
            self._prev_mag = mag
            return False, None

        if self._prev_mag is None:
            self._prev_mag = mag
            return False, None

        flux = float(np.sum(np.maximum(0.0, mag - self._prev_mag)))
        self._prev_mag = mag
        self._flux_history.append(flux)

        if len(self._flux_history) < 8:
            return False, None

        mean_flux = float(np.mean(self._flux_history))
        now = time.monotonic()
        is_onset = flux > (mean_flux * 1.85 + 0.5) and (now - self._last_onset_wall) > 0.12
        bpm: float | None = None
        if is_onset:
            self._last_onset_wall = now
            # Reset beat history after a long pause (> 3.0s)
            if self._onset_times and (now - self._onset_times[-1]) > 3.0:
                self._onset_times.clear()
                self._smoothed_bpm = None
                self._last_bpm_calc_wall = 0.0

            self._onset_times.append(now)
            # Trim to ~3 bars (last 7.5 seconds)
            while self._onset_times and (now - self._onset_times[0]) > 7.5:
                self._onset_times.popleft()

            # Recompute BPM at most once every 2.0s (~1 bar) once 2+ bars are collected
            if (now - self._last_bpm_calc_wall) >= 2.0:
                estimated = self._estimate_bpm_from_onsets(
                    list(self._onset_times),
                    self._smoothed_bpm,
                )
                if estimated is not None:
                    self._last_bpm_calc_wall = now
                    self._smoothed_bpm = estimated
                    bpm = estimated
        return is_onset, bpm

    def _estimate_pitch(self, samples: np.ndarray, frame_counter: int) -> float:
        backend = self.config.pitch_backend.lower()
        if backend == "aubio" and self._use_aubio and self._aubio_pitch is not None:
            hz = float(self._aubio_pitch(samples)[0])
            conf = float(self._aubio_pitch.get_confidence())
            return hz if conf >= 0.65 else 0.0

        # Fallback to librosa when aubio is requested but unavailable
        if backend == "aubio":
            backend = "librosa"

        # Rolling buffer required for librosa.yin or crepe
        if len(self._rolling_buf) < self._rolling_buf.maxlen:
            return 0.0

        # Run heavier backends every 4th block (~42ms) to keep CPU low
        if frame_counter % 4 != 0:
            return 0.0

        buf = np.array(self._rolling_buf, dtype=np.float32)
        if backend == "librosa":
            import librosa  # Lazy import to avoid startup overhead when using aubio

            f0 = librosa.yin(
                buf,
                fmin=75.0,
                fmax=1400.0,
                sr=self.config.sample_rate,
                frame_length=len(buf),
            )
            return float(np.median(f0)) if len(f0) > 0 else 0.0

        if backend == "crepe":
            import crepe  # Optional heavy neural backend

            _, frequency, confidence, _ = crepe.predict(
                buf,
                self.config.sample_rate,
                viterbi=False,
                verbose=0,
                step_size=20,
            )
            if len(confidence) > 0 and float(confidence[-1]) >= 0.65:
                return float(frequency[-1])
            return 0.0

        return 0.0
