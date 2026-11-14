import unittest

from cyberjam.ws_telemetry import telemetry_payload


class TestTelemetryWire(unittest.TestCase):
    def test_maps_internal_state_to_visualizer_contract(self):
        payload = telemetry_payload(
            {
                "bpm": 126.0,
                "pitch_hz": 110.0,
                "note": "A2",
                "midi_note": 45,
                "key": "A Minor",
                "rms": 0.12,
                "spectral_centroid_hz": 1320.5,
                "onset": True,
            },
            timestamp=1234.5,
        )
        self.assertEqual(payload["timestamp"], 1234.5)
        self.assertEqual(payload["bpm"], 126.0)
        self.assertEqual(
            payload["detected_pitch"],
            {"hz": 110.0, "note": "A2", "midi": 45, "key": "A"},
        )
        self.assertEqual(payload["rms"], 0.12)
        self.assertEqual(payload["spectral_centroid_hz"], 1320.5)
        self.assertTrue(payload["onset"])
        self.assertEqual(payload["demo_phase"], "")
        self.assertEqual(payload["demo_prompt"], "")
        # Original engine-specific keys remain available to old clients.
        self.assertEqual(payload["pitch_hz"], 110.0)
        self.assertEqual(payload["midi_note"], 45)

    def test_defaults_initial_state_fields(self):
        payload = telemetry_payload({"bpm": 0, "pitch_hz": 0, "rms": 0})
        self.assertEqual(payload["detected_pitch"]["note"], "N/A")
        self.assertEqual(payload["detected_pitch"]["key"], "N/A")
        self.assertEqual(payload["detected_pitch"]["midi"], 0)
        self.assertIsInstance(payload["timestamp"], float)
        self.assertFalse(payload["onset"])

    def test_guided_capture_fields_are_serialized(self):
        payload = telemetry_payload(
            {"demo_phase": "capture", "demo_prompt": "Play 2 bars"}
        )
        self.assertEqual(payload["demo_phase"], "capture")
        self.assertEqual(payload["demo_prompt"], "Play 2 bars")

    def test_centroid_falls_back_to_internal_centroid(self):
        payload = telemetry_payload({"centroid": 900.0})
        self.assertEqual(payload["spectral_centroid_hz"], 900.0)


if __name__ == "__main__":
    unittest.main()
