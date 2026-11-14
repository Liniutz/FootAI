"""
Pro Audio & High-Quality Instrument Routing Bridge for CyberJam.
Configures FluidSynth cleanly with safe pipe handling and error recovery.
"""

import logging
import os
import subprocess
import time

logger = logging.getLogger("pro_routing")

class ProAudioRoutingBridge:
    def __init__(self, soundfont="/tmp/FluidR3_GM.sf2"):
        self.soundfont = soundfont
        self.synth_process = None
        self.guitarix_process = None

    def start(self):
        logger.info("Starting CyberJam Pro Audio Routing & Pro Instrument Bridge...")
        
        if not os.path.exists(self.soundfont):
            possible_sfs = [
                "/usr/share/sounds/sf2/FluidR3_GM.sf2",
                "/usr/share/soundfonts/FluidR3_GM.sf2",
                "/usr/share/soundfonts/default.sf2"
            ]
            for sf in possible_sfs:
                if os.path.exists(sf):
                    self.soundfont = sf
                    break

        if os.path.exists("/usr/bin/guitarix"):
            try:
                self.guitarix_process = subprocess.Popen(
                    ["guitarix", "-N"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                logger.info("Started Guitarix professional guitar amp simulator.")
            except Exception as e:
                logger.warning(f"Could not start Guitarix: {e}")

        if os.path.exists(self.soundfont):
            try:
                cmd = [
                    "fluidsynth",
                    "-a", "pulseaudio",
                    "-m", "alsa_seq",
                    "-o", "synth.polyphony=128",
                    "-o", "synth.reverb.room-size=0.85",
                    "-o", "synth.chorus.active=1",
                    "-i",
                    self.soundfont
                ]
                self.synth_process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                logger.info(f"Started FluidSynth with SoundFont {self.soundfont}")
                time.sleep(1.0)
                
                try:
                    setup_commands = (
                        f"load {self.soundfont}\n"
                        "select 0 0 0 27\n"
                        "select 1 0 0 33\n"
                        "select 9 0 128 0\n"
                    )
                    if self.synth_process.stdin:
                        self.synth_process.stdin.write(setup_commands.encode('utf-8'))
                        self.synth_process.stdin.flush()
                except Exception as pipe_err:
                    logger.warning(f"FluidSynth setup pipe warning (non-fatal): {pipe_err}")

                try:
                    subprocess.run(["aconnect", "CyberJam_Band", "FLUID Synth"], capture_output=True)
                    logger.info("Connected CyberJam_Band MIDI port to FluidSynth.")
                except Exception:
                    pass
            except Exception as e:
                logger.error(f"Failed to start FluidSynth pro engine: {e}")

    def stop(self):
        if self.synth_process:
            try:
                if self.synth_process.stdin:
                    try:
                        self.synth_process.stdin.write(b"quit\n")
                        self.synth_process.stdin.flush()
                    except Exception:
                        pass
                self.synth_process.terminate()
                self.synth_process.wait(timeout=1.0)
            except Exception:
                pass
            self.synth_process = None

        if self.guitarix_process:
            try:
                self.guitarix_process.terminate()
            except Exception:
                pass
            self.guitarix_process = None
        logger.info("Pro audio routing bridge stopped.")
