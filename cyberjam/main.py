"""Main orchestrator for CyberJam."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

import sounddevice as sd

from .audio_dsp import AudioDSPEngine
from .config import MusicalState, SessionConfig
from .midi_egress import MidiEgress
from .ml_brain import MLSequencer
from .osc_wekinator import WekinatorOSCServer
from .ws_telemetry import VisualTelemetryServer

logger = logging.getLogger("cyberjam")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="cyberjam",
        description="CyberJam — Low-latency PipeWire/JACK audio, DSP, ML MIDI, OSC, and WebSocket router.",
    )
    parser.add_argument("--list-devices", action="store_true", help="List available audio devices and exit.")
    parser.add_argument("--device", default=None, help="Audio input device index or name substring.")
    parser.add_argument("--sample-rate", type=int, default=48000, help="Audio sample rate in Hz (default: 48000).")
    parser.add_argument("--block-size", type=int, default=512, help="Audio callback block size in frames (default: 512).")
    parser.add_argument(
        "--pitch-backend",
        choices=("aubio", "librosa", "crepe"),
        default="aubio",
        help="Pitch detection backend (default: aubio).",
    )
    parser.add_argument("--no-jack", action="store_true", help="Do not prefer JACK host API; use default system API.")
    parser.add_argument(
        "--pipewire-loopback",
        action="store_true",
        help="Automatically spawn a pw-loopback Virtual Source for TouchDesigner/Web Audio.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging.")
    return parser.parse_args(argv)


async def run_async(config: SessionConfig) -> None:
    """Initialize and run all CyberJam subsystems until interrupted."""
    state = MusicalState(bpm=config.default_bpm, detected_key=config.default_key)
    midi = MidiEgress(port_name=config.midi_port_name)
    audio_dsp = AudioDSPEngine(config=config, state=state)
    ml_seq = MLSequencer(config=config, state=state, midi=midi)
    osc_server = WekinatorOSCServer(config=config, midi=midi)
    ws_server = VisualTelemetryServer(config=config, state=state)

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    midi.open()
    try:
        audio_dsp.start()
        ml_seq.start()
        await osc_server.start()
        await ws_server.start()

        logger.info("CyberJam is LIVE. Press Ctrl+C to stop.")
        await stop_event.wait()
    finally:
        logger.info("Shutting down CyberJam...")
        await ws_server.stop()
        osc_server.stop()
        ml_seq.stop()
        audio_dsp.stop()
        midi.close()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.list_devices:
        print(sd.query_devices())
        return 0

    device: str | int | None = args.device
    if isinstance(device, str) and device.isdigit():
        device = int(device)

    config = SessionConfig(
        sample_rate=args.sample_rate,
        block_size=args.block_size,
        audio_device=device,
        prefer_jack=not args.no_jack,
        pitch_backend=args.pitch_backend,
        enable_pipewire_loopback=args.pipewire_loopback,
    )

    try:
        asyncio.run(run_async(config))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
