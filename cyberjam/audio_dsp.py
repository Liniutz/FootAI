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
from .tempo import GuitarTempoTracker

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
        self._pitch_history: deque[float] = deque(maxlen=5)
        self._pc_history: deque[int] = deque(maxlen=64)
        if self._use_aubio:
            self._onset = aubio.onset("default", win, hop, config.sample_rate)
            self._onset.set_threshold(config.onset_threshold)
            self._onset.set_silence(config.silence_db)

            self._tempo = aubio.tempo("default", win, hop, config.sample_rate)
            self._tempo.set_silence(config.silence_db)

            self._aubio_pitch = aubio.pitch("yin", win, hop, config.sample_rate)
            self._aubio_pitch.set_unit("Hz")
            self._aubio_pitch.set_silence(config.silence_db)
        else:
            logger.warning("aubio C-extension not available; using NumPy SuperFlux onsets & librosa.yin pitch fallback.")
            self._onset = None
            self._tempo = None
            self._aubio_pitch = None

        requested = config.pitch_backend.lower()
        if requested in ("auto", "aubio"):
            self._pitch_backend = "aubio" if self._use_aubio else "librosa"
            if requested == "aubio" and not self._use_aubio:
                logger.warning("pitch backend 'aubio' requested but aubio is missing; using librosa.yin")
        else:
            self._pitch_backend = requested
        logger.info("Active pitch backend: %s (onsets: %s)", self._pitch_backend, "aubio" if self._use_aubio else "SuperFlux")

        self._noise_gate_rms = 10.0 ** (config.silence_db / 20.0)
        self._last_active_wall: float = 0.0

        self._prev_log_mag: np.ndarray | None = None
        self._flux_history: deque[float] = deque(maxlen=32)
        self._fps = config.sample_rate / config.block_size
        self._tempo_tracker = GuitarTempoTracker(fps=self._fps)
        self._last_onset_wall: float = 0.0
        self._smoothed_bpm: float | None = None
        self._latched_key: str | None = None
        self._song_started: bool = False
        self._total_beats: float = 0.0
        self._last_beat_tick_wall: float = 0.0
        self._xrun_count: int = 0  # written by the audio callback, logged by the DSP worker
        self._xrun_logged: int = 0
        self._onset_count: int = 0

        self._rolling_buf: deque[float] = deque(maxlen=win)
        self._hann = np.hanning(hop).astype(np.float32)
        self._freqs = np.fft.rfftfreq(hop, d=1.0 / config.sample_rate)
        self._pick_band_mask = (self._freqs >= 80.0) & (self._freqs <= 5000.0)  # guitar fundamentals + pick attack

        self._loopback: PipeWireLoopback | None = (
            PipeWireLoopback() if config.enable_pipewire_loopback else None
        )

    def start(self) -> None:
        """Start the PipeWire loopback (if enabled), DSP worker thread, and audio stream."""
        self.start_processing()

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
            self._pitch_backend,
        )

    def start_processing(self) -> None:
        """Start only the DSP worker thread (no capture stream).

        Use this when audio is captured externally (e.g. a duplex passthrough stream)
        and pushed in via :meth:`feed_audio`.
        """
        if self._loopback is not None:
            self._loopback.start()

        self._stop_event.clear()
        if self._worker_thread is not None and self._worker_thread.is_alive():
            return
        self._worker_thread = threading.Thread(
            target=self._dsp_worker_loop,
            name="CyberJamDSPWorker",
            daemon=True,
        )
        self._worker_thread.start()
        logger.info("Audio DSP worker started (external audio feed mode).")

    def feed_audio(self, samples: np.ndarray) -> None:
        """Feed an externally captured mono float32 block into the DSP pipeline.

        Mirrors the real-time callback: broadcasts the raw PCM over UDP and enqueues
        the block for the DSP worker. Safe to call from an audio callback thread.
        """
        mono = np.ascontiguousarray(samples, dtype=np.float32)
        if mono.ndim > 1:
            mono = np.ascontiguousarray(mono[:, 0], dtype=np.float32)

        try:
            self._udp_sock.sendto(mono.tobytes(), self._udp_addr)
        except OSError:
            pass

        try:
            self._audio_queue.put_nowait(mono.copy())
        except queue.Full:
            try:
                self._audio_queue.get_nowait()
                self._audio_queue.put_nowait(mono.copy())
            except queue.Empty:
                pass

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
        """Real-time audio callback. Must NEVER block, log, or allocate heavily."""
        if status:
            self._xrun_count += 1  # plain int bump; the DSP worker reports it

        self.feed_audio(indata)

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
            reset_bpm = False

            if above_gate:
                self._last_active_wall = now
                is_playing = True
                if not self._song_started:
                    self._song_started = True
                    self._total_beats = 0.0
                    self._last_beat_tick_wall = now

                # Onset flag + aubio native tempo or guitar tempo tracker
                if self._use_aubio:
                    is_onset = bool(self._onset(samples))
                    if is_onset:
                        self._last_onset_wall = now
                        self._onset_count += 1
                    is_beat = bool(self._tempo(samples))
                    raw_tbpm = float(self._tempo.get_bpm())
                    if is_beat and 40.0 <= raw_tbpm <= 240.0:
                        if self._smoothed_bpm is None:
                            self._smoothed_bpm = raw_tbpm
                        else:
                            self._smoothed_bpm = 0.7 * self._smoothed_bpm + 0.3 * raw_tbpm
                    if self._smoothed_bpm is not None:
                        bpm = self._smoothed_bpm
                else:
                    flux_onset, bpm = self._flux_onset_and_bpm(mag, rms, now)
                    is_onset = flux_onset
                    if is_onset:
                        self._onset_count += 1
                    if bpm is None and self._tempo_tracker.bpm is not None:
                        bpm = self._tempo_tracker.bpm

                # Pitch & key estimation with median smoothing to prevent octave/jitter jumps
                detected_hz = self._estimate_pitch(samples, frame_counter)
                if 70.0 <= detected_hz <= 1400.0:
                    self._pitch_history.append(detected_hz)
                    smoothed_hz = float(np.median(self._pitch_history))
                    pitch_hz = smoothed_hz
                    midi_note, note_str, key_str = hz_to_note_info(smoothed_hz)
                    if key_str:
                        self._latched_key = key_str
                        self._pc_history.append(midi_note % 12)
            else:
                self._prev_log_mag = None
                silent_for = now - self._last_active_wall
                if silent_for > 3.0:
                    # Long silence: new song. Reset beat counter and tempo memory.
                    self._song_started = False
                    self._total_beats = 0.0
                    self._tempo_tracker.reset()
                    self._smoothed_bpm = None
                    self._latched_key = None
                    self._pc_history.clear()
                    self._flux_history.clear()
                    reset_bpm = True
                elif self._tempo_tracker.bpm is not None or self._song_started:
                    # Brief pause: keep real-time spacing in the envelope without creating onsets
                    self._tempo_tracker.push(0.0)

                # Reset pitch/playing state after silence hangover so UI doesn't freeze on stale notes
                if silent_for >= self.config.silence_hold_sec:
                    is_playing = False
                    pitch_hz = 0.0
                    note_str = "N/A"
                    midi_note = 0
                    key_str = "N/A"
                else:
                    is_playing = True

            bar: int | None = None
            beat: int | None = None
            if self._song_started:
                dt = max(0.0, now - self._last_beat_tick_wall)
                self._last_beat_tick_wall = now
                active_bpm = self._smoothed_bpm or self.config.default_bpm
                self._total_beats += dt * (active_bpm / 60.0)
                bar = int(self._total_beats // 4) + 1
                beat = int(self._total_beats % 4) + 1
            else:
                bar = 0
                beat = 0

            self.state.update(
                is_playing=is_playing,
                bpm=bpm,
                reset_bpm=reset_bpm,
                bar=bar,
                beat=beat,
                pitch_hz=pitch_hz,
                note=note_str,
                midi_note=midi_note,
                key=key_str if key_str else self._latched_key,
                rms=rms,
                spectral_centroid_hz=centroid,
                onset=is_onset,
                detected_bpm=(self._smoothed_bpm is not None or self._tempo_tracker.bpm is not None),
                detected_key=(self._latched_key is not None),
                pitch_classes=list(self._pc_history),
                onset_count=self._onset_count,
            )
            frame_counter += 1
            if self._xrun_count != self._xrun_logged:
                logger.debug("Audio callback reported %d xrun/status flags so far", self._xrun_count)
                self._xrun_logged = self._xrun_count

    def _compute_spectral_centroid_from_mag(self, mag: np.ndarray | None) -> float:
        if mag is None:
            return 0.0
        mag_sum = float(np.sum(mag))
        if mag_sum <= 1e-9:
            return 0.0
        return float(np.sum(self._freqs * mag) / mag_sum)

    @staticmethod
    def _compute_superflux(
        mag_band: np.ndarray,
        prev_log_mag: np.ndarray | None,
        rms: float,
    ) -> tuple[float, np.ndarray]:
        """Compute vibrato-suppressed log-compressed SuperFlux weighted by RMS accent."""
        log_mag = np.log1p(10.0 * mag_band)
        if prev_log_mag is None or len(prev_log_mag) != len(log_mag):
            return 0.0, log_mag

        # 3-bin maximum filter on previous frame suppresses vibrato/pitch-bend bin drift
        prev_max = np.maximum(
            prev_log_mag,
            np.maximum(np.roll(prev_log_mag, 1), np.roll(prev_log_mag, -1)),
        )
        prev_max[0] = np.maximum(prev_log_mag[0], prev_log_mag[1])
        prev_max[-1] = np.maximum(prev_log_mag[-1], prev_log_mag[-2])

        raw_flux = float(np.sum(np.maximum(0.0, log_mag - prev_max)))
        # Downbeat accent weighting: emphasize strong strums over soft upstrokes
        accent_weight = 0.5 + min(1.5, rms * 10.0)
        return raw_flux * accent_weight, log_mag

    def _flux_onset_and_bpm(self, mag: np.ndarray | None, rms: float, now: float) -> tuple[bool, float | None]:
        """SuperFlux onset detector feeding the guitar tempo tracker.

        Returns ``(is_onset, bpm)``; ``bpm`` is only set on frames where the tracker produced
        a new estimate. Onsets are debounced to 100 ms (a 16th note at 150 BPM).
        """
        if mag is None or rms <= self._noise_gate_rms:
            self._prev_log_mag = None
            return False, None

        flux, self._prev_log_mag = self._compute_superflux(
            mag[self._pick_band_mask],
            self._prev_log_mag,
            rms,
        )
        self._flux_history.append(flux)
        new_bpm = self._tempo_tracker.push(flux)
        if new_bpm is not None:
            self._smoothed_bpm = new_bpm

        if len(self._flux_history) < 8:
            return False, new_bpm

        mean_flux = float(np.mean(self._flux_history))
        is_onset = flux > (mean_flux * 1.65 + 0.15) and (now - self._last_onset_wall) > 0.10
        if is_onset:
            self._last_onset_wall = now
        return is_onset, new_bpm

    def _estimate_pitch(self, samples: np.ndarray, frame_counter: int) -> float:
        backend = self._pitch_backend
        if backend == "aubio" and self._use_aubio and self._aubio_pitch is not None:
            hz = float(self._aubio_pitch(samples)[0])
            conf = float(self._aubio_pitch.get_confidence())
            return hz if conf >= 0.65 else 0.0

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
