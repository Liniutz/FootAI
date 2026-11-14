#!/usr/bin/env python3
"""Magenta RNN worker for CyberJam.

Runs inside the Python 3.9 Magenta environment (``.venv-magenta``) because
TensorFlow 2.15 + Magenta only support older interpreters. The main CyberJam
session (Python 3.14) talks to this process over stdin/stdout JSON lines.

Protocol
--------
Request (one JSON object per line on stdin)::

    {"bpm": 120.0, "root_pc": 4, "mode": "minor", "rms": 0.2,
     "bars": 1, "temperature": 1.0, "seed": 1234}

Response (one JSON object per line on stdout)::

    {"ok": true, "bass": [{"step": 0, "note": 40, "velocity": 110}, ...],
     "drums": [...], "lead": [...]}

On failure: ``{"ok": false, "error": "..."}``.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import traceback

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
# tensorflow-datasets (imported by magenta's music_vae data module) ships protos
# generated with an older protoc; the pure-Python protobuf implementation avoids
# the "Descriptors cannot be created directly" error.
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

import note_seq  # noqa: E402
from note_seq.protobuf import generator_pb2  # noqa: E402
from magenta.models.shared import sequence_generator_bundle  # noqa: E402
from magenta.models.melody_rnn import melody_rnn_sequence_generator  # noqa: E402
from magenta.models.drums_rnn import drums_rnn_sequence_generator  # noqa: E402

SCALES = {
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "major": (0, 2, 4, 5, 7, 9, 11),
}

STEPS_PER_QUARTER = 4
STEPS_PER_BAR = 16

KICK = 36
SNARE = 38
CLOSED_HAT = 42
OPEN_HAT = 46
CRASH = 49


def simplify_drums(events: list[dict], bars: int) -> list[dict]:
    """Force a plain 4/4 backbeat regardless of what the model generated.

    Kick on beats 1 and 3 only (no double-pedal runs, fewer kicks), snare on
    2 and 4, closed hats on 8ths. Model velocities are kept for the hats so the
    performance still breathes, everything else is fixed.
    """
    simplified: list[dict] = []
    for bar in range(bars):
        bar_events = [e for e in events if int(e.get("bar", 0)) == bar]

        hats = {
            int(e["step"]): int(e["velocity"])
            for e in bar_events
            if int(e.get("note", 0)) in (42, 44, 46)
        }
        for step in range(0, STEPS_PER_BAR, 2):
            velocity = hats.get(step, 84)
            simplified.append(
                {"bar": bar, "step": step, "note": CLOSED_HAT, "velocity": max(40, min(104, velocity))}
            )

        simplified.append({"bar": bar, "step": 0, "note": KICK, "velocity": 112})
        simplified.append({"bar": bar, "step": 8, "note": KICK, "velocity": 102})
        simplified.append({"bar": bar, "step": 4, "note": SNARE, "velocity": 106})
        simplified.append({"bar": bar, "step": 12, "note": SNARE, "velocity": 112})
        if bar == 0:
            simplified.append({"bar": bar, "step": 0, "note": CRASH, "velocity": 92})

    simplified.sort(key=lambda e: (e["bar"], e["step"], e["note"]))
    return simplified


def cargo_drums(events: list[dict], bars: int) -> list[dict]:
    """Shape a generated groove into Cargo's straight-ahead rock feel.

    Cargo's drummer (Romanian rock: "Doi pași", "Aproape de voi") plays a driving
    8th-note hat, kick on 1 and 3 with an occasional push on the "and" of 3, a
    hard backbeat on 2 and 4, a ghost note before the backbeat, a crash on the
    phrase downbeat and an open hat closing the phrase. No double-pedal runs and
    at most three kicks per bar.
    """
    shaped: list[dict] = []
    for bar in range(bars):
        bar_events = [e for e in events if int(e.get("bar", 0)) == bar]

        hats = {
            int(e["step"]): int(e["velocity"])
            for e in bar_events
            if int(e.get("note", 0)) in (42, 44, 46)
        }
        kicks = {int(e["step"]) for e in bar_events if int(e.get("note", 0)) == 36}
        snares = {int(e["step"]) for e in bar_events if int(e.get("note", 0)) == 38}

        # Driving closed hats on every 8th, accents from the model.
        for step in range(0, STEPS_PER_BAR, 2):
            fallback = 94 if step % 4 == 0 else 74
            velocity = max(44, min(106, hats.get(step, fallback)))
            shaped.append(
                {"bar": bar, "step": step, "note": CLOSED_HAT, "velocity": velocity}
            )

        # Kick: 1 and 3, plus the "and of 3" push when the model played it.
        kick_steps = [0, 8]
        if 10 in kicks:
            kick_steps.append(10)
        for step in kick_steps:
            shaped.append(
                {"bar": bar, "step": step, "note": KICK, "velocity": 114 if step == 0 else 100}
            )

        # Hard backbeat.
        shaped.append({"bar": bar, "step": 4, "note": SNARE, "velocity": 108})
        shaped.append({"bar": bar, "step": 12, "note": SNARE, "velocity": 116})

        # Ghost note just before the backbeat (a Cargo signature).
        ghost = 7 if 7 in snares else (15 if 15 in snares else None)
        if ghost is not None:
            shaped.append({"bar": bar, "step": ghost, "note": SNARE, "velocity": 34})

        # Crash on the phrase downbeat, open hat closing the phrase.
        if bar % 4 == 0:
            shaped.append({"bar": bar, "step": 0, "note": CRASH, "velocity": 98})
        if bar % 4 == 3:
            shaped.append({"bar": bar, "step": 14, "note": OPEN_HAT, "velocity": 80})

    shaped.sort(key=lambda e: (e["bar"], e["step"], e["note"]))
    return shaped


def tapify(events: list[dict], bars: int) -> list[int]:
    """Collapse a drum pattern to a 32-step tap grid (any hit = one tap)."""
    taps: set[int] = set()
    for event in events:
        bar = int(event.get("bar", 0))
        if bar >= bars:
            continue
        step = int(event.get("step", 0))
        taps.add(bar * STEPS_PER_BAR + step)
    return sorted(taps)


def _scale_note(root_pc: int, mode: str, degree: int) -> int:
    scale = SCALES.get(mode, SCALES["minor"])
    octave, index = divmod(degree, len(scale))
    return 36 + root_pc + 12 * octave + scale[index]


def _melody_primer(root_pc: int, mode: str, bpm: float) -> note_seq.NoteSequence:
    """One bar of quarter notes on root / fifth / octave / third."""
    seq = note_seq.NoteSequence()
    seq.tempos.add(qpm=bpm)
    seq.time_signatures.add(numerator=4, denominator=4)
    beat = 60.0 / bpm
    degrees = (0, 4, 7, 2)
    for index, degree in enumerate(degrees):
        note = seq.notes.add()
        note.pitch = _scale_note(root_pc, mode, degree)
        note.velocity = 100
        note.start_time = index * beat
        note.end_time = (index + 1) * beat - 0.02
        note.instrument = 0
        note.program = 33
    seq.total_time = 4 * beat
    return seq


def _drum_primer(bpm: float) -> note_seq.NoteSequence:
    """One bar of kick/snare/hats as a rhythmic primer."""
    seq = note_seq.NoteSequence()
    seq.tempos.add(qpm=bpm)
    seq.time_signatures.add(numerator=4, denominator=4)
    beat = 60.0 / bpm
    pattern = ((0.0, 36), (0.5, 42), (1.0, 38), (1.5, 42),
               (2.0, 36), (2.5, 42), (3.0, 38), (3.5, 42))
    for offset, pitch in pattern:
        note = seq.notes.add()
        note.pitch = pitch
        note.velocity = 100
        note.start_time = offset * beat
        note.end_time = offset * beat + 0.05
        note.is_drum = True
    seq.total_time = 4 * beat
    return seq


def _events_from_sequence(
    seq: note_seq.NoteSequence, start_time: float, bpm: float, bars: int
) -> list[dict]:
    """Convert generated notes into ``{bar, step, note, velocity}`` events."""
    step_dur = 60.0 / bpm / 4.0
    bar_dur = step_dur * STEPS_PER_BAR
    events = []
    for note in seq.notes:
        if note.end_time <= start_time + 1e-6:
            continue
        rel = note.start_time - start_time
        if rel < -1e-6:
            continue
        bar = int(rel // bar_dur)
        if bar < 0 or bar >= bars:
            continue
        step = int(round((rel - bar * bar_dur) / step_dur))
        if step < 0 or step >= STEPS_PER_BAR:
            continue
        events.append(
            {
                "bar": bar,
                "step": step,
                "note": int(note.pitch),
                "velocity": int(max(1, min(127, note.velocity))),
            }
        )
    events.sort(key=lambda e: (e["bar"], e["step"], e["note"]))
    return events


class GrooveVae:
    """GrooVAE (tap2drum) loaded from the tfjs weights published by Magenta.

    The public GrooVAE Python checkpoints are gone, but the JS demo weights are
    still online. They are a MusicVAE with the same variable names as magenta's
    ``groovae_2bar_tap_fixed_velocity`` config, so we build that graph and load
    the raw float32 shard into it.
    """

    def __init__(self, model_dir: str) -> None:
        import json as _json

        import numpy as np
        import tensorflow.compat.v1 as tf

        tf.disable_v2_behavior()
        from magenta.models.music_vae import configs

        self.tf = tf
        self.np = np
        self.config = configs.CONFIG_MAP["groovae_2bar_tap_fixed_velocity"]
        self.converter = self.config.data_converter
        self.steps = 32  # 2 bars of 16 steps

        graph = tf.Graph()
        with graph.as_default():
            self.config.model.build(
                self.config.hparams, self.converter.output_depth, is_training=False
            )
            self._z = tf.placeholder(tf.float32, shape=[1, self.config.hparams.z_size])
            self._temperature = tf.placeholder(tf.float32, shape=())
            self._inputs = tf.placeholder(
                tf.float32, shape=[1, None, self.converter.input_depth]
            )
            self._lengths = tf.placeholder(tf.int32, shape=[1])
            self._controls = tf.placeholder(
                tf.float32, shape=[1, None, self.converter.control_depth]
            )
            self._max_length = tf.placeholder(tf.int32, shape=())
            self._outputs, _ = self.config.model.sample(
                1,
                max_length=self._max_length,
                z=self._z,
                c_input=None,
                temperature=self._temperature,
            )
            q_z = self.config.model.encode(self._inputs, self._lengths, self._controls)
            self._mu = q_z.loc
            variables = {
                v.name[:-2]: v for v in tf.global_variables() if v.name != "global_step:0"
            }

        manifest = _json.load(open(os.path.join(model_dir, "weights_manifest.json")))[0]["weights"]
        raw = np.fromfile(os.path.join(model_dir, "group1-shard1of1"), dtype="<f4")
        weights = {}
        offset = 0
        for entry in manifest:
            count = int(np.prod(entry["shape"]))
            weights[entry["name"]] = raw[offset:offset + count].reshape(entry["shape"])
            offset += count

        missing = [name for name in variables if name not in weights]
        if missing:
            raise RuntimeError(f"GrooVAE weights missing for: {missing[:3]}")

        self.session = tf.Session(graph=graph)
        self.session.run([variables[name].assign(weights[name]) for name in variables])

    def generate(self, taps: list[int], bpm: float, temperature: float, seed: int) -> list[dict]:
        np = self.np
        beat = 60.0 / bpm
        step_dur = beat / 4.0

        seq = note_seq.NoteSequence()
        seq.tempos.add(qpm=bpm)
        seq.time_signatures.add(numerator=4, denominator=4)
        for step in sorted({int(t) for t in taps if 0 <= int(t) < self.steps}):
            note = seq.notes.add()
            note.pitch = 46  # open hi-hat: the tapify channel
            note.velocity = 100
            note.is_drum = True
            note.start_time = step * step_dur
            note.end_time = step * step_dur + 0.05
        seq.total_time = self.steps * step_dur

        tensors = self.converter.to_tensors(seq)
        if not tensors.inputs:
            return []
        inputs = np.array(tensors.inputs, dtype=np.float32)
        controls = np.zeros((1, inputs.shape[1], self.converter.control_depth), np.float32)

        mu = self.session.run(
            self._mu,
            {self._inputs: inputs, self._lengths: [inputs.shape[1]], self._controls: controls},
        )
        random.seed(seed)
        outputs = self.session.run(
            self._outputs,
            {self._z: mu, self._temperature: float(temperature), self._max_length: self.steps},
        )
        generated = self.converter.from_tensors(outputs)[0]

        events = []
        for note in generated.notes:
            rel = max(0.0, note.start_time)
            bar = int(rel // (step_dur * STEPS_PER_BAR))
            if bar >= 2:
                continue
            step = int(round((rel - bar * step_dur * STEPS_PER_BAR) / step_dur))
            if step < 0 or step >= STEPS_PER_BAR:
                continue
            events.append(
                {
                    "bar": bar,
                    "step": step,
                    "note": int(note.pitch),
                    "velocity": int(max(1, min(127, note.velocity))),
                }
            )
        events.sort(key=lambda e: (e["bar"], e["step"], e["note"]))
        return events


class RnnBundle:
    def __init__(self, path: str, generator_map) -> None:
        self.path = path
        bundle = sequence_generator_bundle.read_bundle_file(path)
        generator_id = bundle.generator_details.id
        if generator_id not in generator_map:
            raise RuntimeError(f"{path}: unsupported generator id {generator_id!r}")
        self.generator = generator_map[generator_id](bundle=bundle)
        self.generator.initialize()
        self.generator_id = generator_id

    def generate(self, primer, bpm: float, temperature: float, seed: int, bars: int = 4) -> list[dict]:
        bar = 60.0 / bpm * 4.0
        options = generator_pb2.GeneratorOptions()
        options.args["temperature"].float_value = float(temperature)
        options.generate_sections.add(
            start_time=primer.total_time,
            end_time=primer.total_time + bar * bars,
        )
        random.seed(seed)
        generated = self.generator.generate(primer, options)
        return _events_from_sequence(generated, primer.total_time, bpm, bars)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--bass", default="cargo_bass.mag")
    parser.add_argument("--drums", default="cargo_drums.mag")
    parser.add_argument("--lead", default="cargo_lead.mag")
    parser.add_argument("--groovae-dir", default="", help="GrooVAE tfjs model dir (replaces the drum RNN).")
    parser.add_argument(
        "--groovae-taps",
        choices=("cargo", "live"),
        default="cargo",
        help="GrooVAE tap source: 'cargo' (rhythm from the fine-tuned drum RNN) or 'live' (guitar onsets).",
    )
    args = parser.parse_args()

    melody_map = melody_rnn_sequence_generator.get_generator_map()
    drums_map = drums_rnn_sequence_generator.get_generator_map()

    groovae = None
    if args.groovae_dir:
        try:
            groovae = GrooveVae(args.groovae_dir)
            print(json.dumps({"ok": True, "loaded": "groovae", "generator": "tap2drum_2bar"}), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"groovae: {exc}"}), flush=True)

    bundles: dict[str, RnnBundle] = {}
    for name, filename, gmap in (
        ("bass", args.bass, melody_map),
        ("drums", args.drums, drums_map),
        ("lead", args.lead, melody_map),
    ):
        if not filename:
            continue
        path = os.path.join(args.models_dir, filename)
        if not os.path.exists(path):
            print(json.dumps({"ok": False, "error": f"missing bundle {path}"}), flush=True)
            continue
        try:
            bundles[name] = RnnBundle(path, gmap)
            print(json.dumps({"ok": True, "loaded": name, "generator": bundles[name].generator_id}), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"{name}: {exc}"}), flush=True)

    print(json.dumps({"ready": True, "loaded": sorted(bundles) + (["groovae"] if groovae else [])}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"ok": False, "error": f"bad json: {exc}"}), flush=True)
            continue

        if request.get("cmd") == "quit":
            break

        try:
            bpm = float(request.get("bpm") or 120.0)
            root_pc = int(request.get("root_pc", 4)) % 12
            mode = str(request.get("mode", "minor"))
            temperature = float(request.get("temperature", 1.0))
            seed = int(request.get("seed", 0))
            bars = max(1, min(8, int(request.get("bars", 4))))

            response: dict = {"ok": True, "bars": bars}
            if "bass" in bundles:
                response["bass"] = bundles["bass"].generate(
                    _melody_primer(root_pc, mode, bpm), bpm, temperature, seed, bars
                )
            if groovae is not None:
                groove_bars = 2
                source = str(request.get("groovae_taps") or args.groovae_taps)
                taps = [int(t) for t in (request.get("taps") or [])]

                # Style-first pipeline: rhythm from the Cargo drum RNN, feel/humanisation
                # from GrooVAE, then shaped to Cargo's straight-ahead rock template.
                if source == "cargo" and "drums" in bundles:
                    seed_events = bundles["drums"].generate(
                        _drum_primer(bpm), bpm, temperature, seed + 1, groove_bars
                    )
                    taps = tapify(seed_events, groove_bars)

                response["drums"] = cargo_drums(
                    groovae.generate(taps, bpm, temperature, seed + 1), groove_bars
                )
                response["bars"] = groove_bars
            elif "drums" in bundles:
                response["drums"] = simplify_drums(
                    bundles["drums"].generate(_drum_primer(bpm), bpm, temperature, seed + 1, bars),
                    bars,
                )
            if "lead" in bundles:
                response["lead"] = bundles["lead"].generate(
                    _melody_primer(root_pc, mode, bpm), bpm, temperature, seed + 2, bars
                )
            print(json.dumps(response), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc()[-800:]}), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
