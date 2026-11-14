#!/usr/bin/env fish
# Recreate the Magenta RNN environment used by scripts/rnn_worker.py.
#
# TensorFlow 2.15 + Magenta only support Python <= 3.11, while the main CyberJam
# venv runs Python 3.14, so the RNN models live in their own interpreter and are
# driven over stdin/stdout JSON by cyberjam/rnn_client.py.
#
# Usage:  fish scripts/setup_magenta_env.sh

set -l ROOT (dirname (dirname (status filename)))
cd $ROOT

echo "==> Installing Python 3.9 (uv)"
uv python install 3.9

echo "==> Creating .venv-magenta"
uv venv --python 3.9 .venv-magenta

echo "==> Installing TensorFlow / note-seq / Magenta"
uv pip install --python .venv-magenta/bin/python \
    "tensorflow==2.15.1" \
    "numpy==1.26.4" \
    "protobuf==4.25.3" \
    "tensorflow-probability==0.23.0" \
    "note-seq==0.0.5" \
    "dm-sonnet==2.0.0" \
    "tf-slim==1.1.0" \
    "absl-py==1.2.0" \
    "six==1.16.0" \
    "pygtrie==2.5.0" \
    "scipy==1.7.3" \
    "matplotlib==3.5.2" \
    "pretty-midi==0.2.9" \
    "mido==1.2.6" \
    "imageio==2.20.0" \
    "Pillow==9.2.0" \
    "setuptools<70"

# The PyPI magenta 2.1.4 wheel is missing magenta/music and magenta/models/shared,
# so install from source instead. Keep the checkout outside /tmp so it survives
# reboots and tmp cleanups (the editable install points at it).
set -l MAGENTA_SRC $HOME/.local/share/cyberjam/magenta-src
if not test -d $MAGENTA_SRC
    echo "==> Cloning Magenta source to $MAGENTA_SRC"
    mkdir -p (dirname $MAGENTA_SRC)
    git clone --depth 1 https://github.com/magenta/magenta.git $MAGENTA_SRC
end
uv pip install --python .venv-magenta/bin/python --no-deps -e $MAGENTA_SRC

echo "==> Verifying"
.venv-magenta/bin/python -c "import tensorflow, note_seq; from magenta.models.shared import sequence_generator_bundle; print('magenta env OK')"

echo "Done. Run ./start_cyberjam.sh - the session starts the RNN worker automatically."
