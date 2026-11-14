#!/usr/bin/env fish
# Stop a stray CyberJam session: engine, Magenta worker and the visual loopback.
#
#   fish scripts/stop_cyberjam.sh              # audio processes only
#   fish scripts/stop_cyberjam.sh --controller # also stop session_control.py
#
# Safe to run when nothing is up - it just reports "clean". Only processes whose
# executable actually is python / pw-loopback are killed, so wrappers such as
# `timeout ... run_inprocess_session.py` or a shell one-liner are never hit.

function _pids_for --argument-names pattern comm_prefix
    set -l skip $fish_pid $PPID
    for pid in (pgrep -f "$pattern")
        if contains -- $pid $skip
            continue
        end
        set -l comm (cat /proc/$pid/comm 2>/dev/null)
        if string match -q "$comm_prefix*" -- "$comm"
            echo $pid
        end
    end
end

set -l stopped 0

# 1. Ask the engine to shut down gracefully (closes streams, flushes MIDI).
for pid in (_pids_for "scripts/run_inprocess_session.py" python)
    echo "SIGINT engine $pid"
    kill -INT $pid 2>/dev/null
    set stopped 1
end
sleep 2

# 2. Anything still alive gets SIGTERM.
set -l entries "scripts/run_inprocess_session.py python" \
               "scripts/rnn_worker.py python" \
               "pw-loopback.*CyberJam_VisualSource pw-loopback"
# The visualizer's control service is only stopped on request (--controller),
# so `npm run dev` keeps working after cleaning up a stray session.
if contains -- --controller $argv
    set -a entries "scripts/session_control.py python"
end
for entry in $entries
    set -l parts (string split " " -- $entry)
    for pid in (_pids_for $parts[1] $parts[2])
        echo "SIGTERM $pid ($parts[1])"
        kill -TERM $pid 2>/dev/null
        set stopped 1
    end
end

sleep 1

# 3. Report what is left (should be nothing).
set -l remaining (pgrep -af "run_inprocess_session|rnn_worker|session_control|pw-loopback.*CyberJam_VisualSource" | grep -v stop_cyberjam)

if test (count $remaining) -gt 0
    echo "Still running:"
    for line in $remaining
        echo "  $line"
    end
    echo "If a process ignores SIGTERM: kill -9 <pid>"
    exit 1
end

if test $stopped = 1
    echo "CyberJam session stopped; audio devices released."
else
    echo "Nothing to stop (no CyberJam session running)."
end
