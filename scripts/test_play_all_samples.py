#!/usr/bin/env python3
"""
Test script to play a sample note for each configured instrument
from /tmp/FluidR3_GM.sf2 through FluidSynth.
"""

import time
import os

try:
    import fluidsynth
    HAS_FLUID = True
except ImportError:
    HAS_FLUID = False

def main():
    if not HAS_FLUID:
        print("fluidsynth package not found.")
        return

    print("Initializing FluidSynth for sample playback test...")
    fs = fluidsynth.Synth()
    fs.start(driver='alsa')
    
    sfpath = "/tmp/FluidR3_GM.sf2"
    if not os.path.exists(sfpath):
        print(f"SoundFont not found at {sfpath}")
        fs.delete()
        return

    sfid = fs.sfload(sfpath)
    print(f"Loaded SoundFont {sfpath} (sfid={sfid})")

    # 1. Acoustic Nylon Guitar (Program 24 on Channel 0)
    fs.program_select(0, sfid, 0, 24)
    print("-> Playing Acoustic Nylon Guitar (Ch 0, Note 64 - E4)...")
    fs.noteon(0, 64, 110)
    fs.noteon(0, 67, 110) # G4 chord
    fs.noteon(0, 71, 110) # B4 chord
    time.sleep(0.8)
    fs.noteoff(0, 64)
    fs.noteoff(0, 67)
    fs.noteoff(0, 71)

    # 2. Electric Finger Bass (Program 33 on Channel 1)
    fs.program_select(1, sfid, 0, 33)
    print("-> Playing Electric Finger Bass (Ch 1, Note 38 - D2)...")
    fs.noteon(1, 38, 120)
    time.sleep(0.5)
    fs.noteoff(1, 38)

    # 3. Standard Drum Kit (Bank 128, Program 0 on Channel 9 / MIDI Ch 10)
    fs.program_select(9, sfid, 128, 0)
    print("-> Playing Standard Drum Kit (Ch 10: Kick=36, Snare=38, Closed HiHat=42)...")
    fs.noteon(9, 36, 127) # Kick
    time.sleep(0.2)
    fs.noteon(9, 42, 100) # HiHat
    time.sleep(0.2)
    fs.noteon(9, 38, 120) # Snare
    fs.noteon(9, 42, 100) # HiHat
    time.sleep(0.4)

    fs.delete()
    print("Sample playback test completed successfully!")

if __name__ == "__main__":
    main()
