#!/usr/bin/env python3
"""
CyberJam Dummy Audio Streamer.
Streams sine/noise audio chunks or a generated test WAV file into CyberJam's
UDP ingress port (:13000) so you can test the entire DSP, ML Brain, and
visualizer telemetry pipeline without needing a physical microphone or guitar.
"""

import socket
import struct
import math
import time
import sys

UDP_IP = "127.0.0.1"
UDP_PORT = 13000

def generate_tone_chunk(sample_rate=48000, duration_sec=0.1, freq=329.63):
    # freq 329.63 Hz is E4 (guitar high E string)
    num_samples = int(sample_rate * duration_sec)
    chunk = bytearray()
    for i in range(num_samples):
        t = i / sample_rate
        # Add a gentle sine wave + slight harmonics
        val = 0.3 * math.sin(2 * math.pi * freq * t) + 0.1 * math.sin(2 * math.pi * (freq * 2) * t)
        chunk.extend(struct.pack('f', val))
    return chunk

def main():
    print(f"Starting CyberJam Dummy Audio Streamer -> {UDP_IP}:{UDP_PORT}")
    print("Press Ctrl+C to stop.")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    # 512 samples per block (matching AudioDSPEngine block size)
    sample_rate = 48000
    block_size = 512
    interval = block_size / sample_rate # ~10.6ms per block
    
    # E4 frequency (329.63 Hz) to trigger key E Minor / E Major
    freq = 329.63
    
    try:
        while True:
            chunk = bytearray()
            for i in range(block_size):
                t = time.time()
                val = 0.4 * math.sin(2 * math.pi * freq * t)
                chunk.extend(struct.pack('f', val))
            
            sock.sendto(chunk, (UDP_IP, UDP_PORT))
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nDummy audio streamer stopped.")
    finally:
        sock.close()

if __name__ == "__main__":
    main()
