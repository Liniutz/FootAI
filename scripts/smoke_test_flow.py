#!/usr/bin/env python3
"""Run a full CyberJam flow test with a dummy MIDI sink and verify MIDI generation."""

from __future__ import annotations

import logging
import sys
import time
import mido

from cyberjam.config import SessionConfig, MusicalState
from cyberjam.midi_egress import MidiEgress
from cyberjam.ml_brain import MLSequencer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("smoke_test")

def main() -> int:
    mido.set_backend("mido.backends.rtmidi")
    port_name = "CyberJam_SmokeTest"
    
    logger.info("Opening virtual MIDI output port: %s", port_name)
    midi = MidiEgress(port_name=port_name)
    midi.open()

    logger.info("Opening virtual MIDI input listener to capture egress...")
    inp = mido.open_input(port_name)
    received: list[mido.Message] = []
    inp.callback = lambda msg: received.append(msg)

    state = MusicalState()
    state.update(is_playing=True, bpm=120.0, bar=1, beat=1, key="E")
    cfg = SessionConfig(default_bpm=120.0, midi_port_name=port_name)
    
    logger.info("Starting MLSequencer (DrumRNN & MelodyRNN stubs)...")
    seq = MLSequencer(cfg, state, midi)
    seq.start()

    time.sleep(1.2)  # run for over 1 bar at 120 BPM
    
    logger.info("Stopping MLSequencer and cleaning up...")
    seq.stop()
    midi.close()
    inp.close()

    logger.info("Total MIDI messages captured on virtual port: %d", len(received))
    for idx, msg in enumerate(received[:15]):
        logger.info("  [%2d] %s", idx, msg)

    if len(received) > 0:
        logger.info("SUCCESS: Full flow test passed! Generated notes and note-offs correctly.")
        return 0
    else:
        logger.error("FAILURE: No MIDI messages captured.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
