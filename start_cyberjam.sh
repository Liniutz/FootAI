#!/usr/bin/env fish
# Start the CyberJam live session.
#
#   ./start_cyberjam.sh                     # fine-tuned "cargo" models
#   ./start_cyberjam.sh --models default    # stock Magenta models
#   ./start_cyberjam.sh --models groovae    # GrooVAE drums from your rhythm
#   ./start_cyberjam.sh --demo              # guided: sing 2 bars, then lock BPM+key
#   ./start_cyberjam.sh --drum-kit power    # rock kit (default); try jazz/room/808
#   ./start_cyberjam.sh --drum-soundfont /path/rock_kit.sf2   # external kit
#   ./start_cyberjam.sh --list-drum-kits    # show available kits
#   ./start_cyberjam.sh --no-rnn            # algorithmic engine only
#
# Any extra arguments are passed straight through to scripts/run_inprocess_session.py.
set -l ROOT (dirname (status filename))
cd $ROOT
echo "Starting CyberJam In-Process Pro Session & MCP Server..."
PYTHONPATH=. .venv/bin/python scripts/run_inprocess_session.py $argv
