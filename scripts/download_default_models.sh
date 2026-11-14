#!/usr/bin/env fish
# Download the stock (pretrained) Magenta bundles used by `--models default`.
#
#   attention_rnn.mag  -> Melody RNN (bass / lead)
#   drum_kit_rnn.mag   -> Drums RNN  (drums)
#
# Usage: fish scripts/download_default_models.sh

set -l ROOT (dirname (dirname (status filename)))
set -l DEST $ROOT/models/pretrained
set -l BASE https://storage.googleapis.com/download.magenta.tensorflow.org/models

mkdir -p $DEST
cd $DEST

for f in attention_rnn.mag drum_kit_rnn.mag
    if test -s $f
        echo "already present: $f"
        continue
    end
    echo "downloading $f"
    curl -sSL -o $f "$BASE/$f"
    if not test -s $f
        echo "failed to download $f" >&2
        exit 1
    end
end

ls -lh $DEST
echo "Done. Run: ./start_cyberjam.sh --models default"
