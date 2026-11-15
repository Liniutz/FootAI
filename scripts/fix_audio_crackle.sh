#!/usr/bin/env bash
# fix_audio_crackle.sh — stabilize system-wide audio on CachyOS/Arch + PipeWire.
#
# Fixes the two most common causes of laptop crackling/pops:
#   1. snd_hda_intel codec power saving (e.g. Realtek ALC294) suspending when
#      idle, which pops/crackles when audio resumes.
#   2. PipeWire running the *whole* graph at a tiny quantum (64 frames) because
#      one client asks for it. In this repo FluidSynth opens ALSA at 44.1 kHz
#      with 64-frame periods, which drags every app down to 1.3 ms buffers.
#
# Usage:
#   ./scripts/fix_audio_crackle.sh              # apply fixes
#   ./scripts/fix_audio_crackle.sh --check      # report current state only
#   ./scripts/fix_audio_crackle.sh --dry-run    # print commands, change nothing
#   ./scripts/fix_audio_crackle.sh --revert     # undo the changes
#
# Options:
#   --min-quantum N   PipeWire minimum quantum (default: 128)
#   --quantum N       PipeWire default quantum (default: 1024)
#   --keep-session    do not stop a running CyberJam session
#   --no-restart      write config but do not restart PipeWire
#   --yes             do not ask for confirmation
#
# Run as your normal user (not root). The script uses sudo only for the
# /etc/modprobe.d file and the sysfs power_save toggle.

set -euo pipefail

MIN_QUANTUM=128
QUANTUM=1024
MAX_QUANTUM=2048
KEEP_SESSION=0
RESTART=1
DRY_RUN=0
REVERT=0
CHECK_ONLY=0
ASSUME_YES=0

PS_PATH=/sys/module/snd_hda_intel/parameters/power_save
MODPROBE_FILE=/etc/modprobe.d/audio-power-save.conf
PW_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pipewire/pipewire.conf.d"
PW_FILE="$PW_DIR/10-min-quantum.conf"

if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
    C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
    C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serr %s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)        CHECK_ONLY=1 ;;
        --dry-run)      DRY_RUN=1 ;;
        --revert)       REVERT=1 ;;
        --keep-session) KEEP_SESSION=1 ;;
        --no-restart)   RESTART=0 ;;
        --yes|-y)       ASSUME_YES=1 ;;
        --min-quantum)  MIN_QUANTUM="${2:?--min-quantum needs a value}"; shift ;;
        --quantum)      QUANTUM="${2:?--quantum needs a value}"; shift ;;
        -h|--help)      usage ;;
        *)              die "unknown option: $1 (try --help)" ;;
    esac
    shift
done

[[ $EUID -eq 0 ]] && die "run as your normal user, not root (the script calls sudo itself)"
command -v pw-metadata >/dev/null || die "pw-metadata not found; is PipeWire installed?"
command -v systemctl  >/dev/null || die "systemctl not found"

run() {
    if (( DRY_RUN )); then
        printf '[dry-run] %s\n' "$*"
    else
        "$@"
    fi
}

sudo_run() {
    if (( DRY_RUN )); then
        printf '[dry-run] sudo %s\n' "$*"
    else
        sudo "$@"
    fi
}

confirm() {
    (( ASSUME_YES )) && return 0
    [[ -t 0 ]] || return 0
    local reply
    read -r -p "$1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

# ---------------------------------------------------------------- check mode
show_state() {
    log "HDA codec power saving"
    if [[ -r $PS_PATH ]]; then
        printf '    power_save            = %s\n' "$(cat "$PS_PATH")"
        printf '    power_save_controller = %s\n' \
            "$(cat /sys/module/snd_hda_intel/parameters/power_save_controller 2>/dev/null || echo n/a)"
        [[ "$(cat "$PS_PATH")" == "0" ]] && ok "codec stays powered" \
            || warn "codec suspends when idle (a common crackle source)"
    else
        warn "snd_hda_intel not loaded; skipping"
    fi

    log "PipeWire clock settings"
    pw-metadata -n settings 2>/dev/null | grep -E "clock\.(quantum|min-quantum|max-quantum|rate|allowed-rates)" \
        | sed 's/^/    /' || true

    log "Active graph (QUANT / ERR)"
    timeout 3 pw-top -b -n 1 2>/dev/null \
        | grep -E "QUANT|analog-stereo|python|pw-play" | sed 's/^/    /' || true

    log "CyberJam processes"
    pgrep -af "run_inprocess_session|pw-loopback.*CyberJam" | sed 's/^/    /' || echo "    none"

    log "Config files"
    [[ -f $PW_FILE ]]       && printf '    present: %s\n' "$PW_FILE"       || printf '    absent:  %s\n' "$PW_FILE"
    [[ -f $MODPROBE_FILE ]] && printf '    present: %s\n' "$MODPROBE_FILE" || printf '    absent:  %s\n' "$MODPROBE_FILE"
}

# ------------------------------------------------------------------- revert
do_revert() {
    log "Reverting audio crackle fixes"
    if [[ -f $PW_FILE ]]; then
        run rm -f "$PW_FILE"
        (( DRY_RUN )) || ok "removed $PW_FILE"
    fi
    if [[ -f $MODPROBE_FILE ]]; then
        sudo_run rm -f "$MODPROBE_FILE"
        (( DRY_RUN )) || ok "removed $MODPROBE_FILE"
    fi
    if [[ -w $PS_PATH || -e $PS_PATH ]]; then
        sudo_run sh -c "echo 1 > '$PS_PATH'"
        (( DRY_RUN )) || ok "restored power_save=1"
    fi
    if (( RESTART )); then
        log "Restarting PipeWire"
        run systemctl --user restart pipewire pipewire-pulse wireplumber
        (( DRY_RUN )) || ok "restarted"
    fi
    log "Done. Reboot to fully restore the codec default."
}

# -------------------------------------------------------------------- apply
do_apply() {
    log "Applying audio crackle fixes"

    # 1. Stop a running CyberJam session so it cannot pin the graph at 64 frames.
    if (( ! KEEP_SESSION )); then
        if pgrep -f "run_inprocess_session" >/dev/null 2>&1; then
            if confirm "Stop the running CyberJam session?"; then
                run pkill -f "run_inprocess_session" || true
                run pkill -f "pw-loopback.*CyberJam" || true
                (( DRY_RUN )) || ok "stopped CyberJam session"
            else
                warn "leaving session running; it may keep the graph at 64 frames"
            fi
        fi
    fi

    # 2. Disable HDA codec power saving (live + persistent).
    if [[ -e $PS_PATH ]]; then
        sudo_run sh -c "echo 0 > '$PS_PATH'"
        (( DRY_RUN )) || ok "power_save=0 (live)"
        if [[ -f $MODPROBE_FILE ]] && grep -q "power_save=0" "$MODPROBE_FILE"; then
            ok "$MODPROBE_FILE already present"
        else
            if (( DRY_RUN )); then
                printf '[dry-run] write %s\n' "$MODPROBE_FILE"
            else
                printf '%s\n' \
                    '# Disable HDA codec power saving to stop idle pops/crackles.' \
                    'options snd_hda_intel power_save=0 power_save_controller=N' \
                    | sudo tee "$MODPROBE_FILE" >/dev/null
                ok "wrote $MODPROBE_FILE"
            fi
        fi
    else
        warn "snd_hda_intel not loaded; skipping power_save"
    fi

    # 3. Clamp the PipeWire graph so no client can force 64-frame buffers.
    if (( DRY_RUN )); then
        printf '[dry-run] write %s\n' "$PW_FILE"
    else
        mkdir -p "$PW_DIR"
        cat > "$PW_FILE" <<EOF
# Keep the whole PipeWire graph out of 64-frame territory.
# A single low-latency client (e.g. FluidSynth at 44.1 kHz / 64-frame periods)
# otherwise drags every application down to ~1.3 ms buffers and causes xruns.
context.properties = {
    default.clock.quantum     = $QUANTUM
    default.clock.min-quantum = $MIN_QUANTUM
    default.clock.max-quantum = $MAX_QUANTUM
}
EOF
        ok "wrote $PW_FILE"
    fi

    # 4. Restart PipeWire so the new clock settings take effect.
    if (( RESTART )); then
        log "Restarting PipeWire"
        run systemctl --user restart pipewire pipewire-pulse wireplumber
        (( DRY_RUN )) || sleep 1
        (( DRY_RUN )) || ok "restarted"
    else
        warn "not restarting; run: systemctl --user restart pipewire pipewire-pulse wireplumber"
    fi

    log "Verifying"
    show_state

    cat <<'EOF'

Next steps:
  * Play something and check for crackle.
  * If it persists, reboot so the modprobe setting is applied at module load.
  * The repo still starts FluidSynth at 44.1 kHz / 64-frame periods; the
    min-quantum clamp protects the rest of the system, but patching
    scripts/run_inprocess_session.py to use 48 kHz / 256-frame periods is the
    proper fix.
EOF
}

if (( CHECK_ONLY )); then
    show_state
elif (( REVERT )); then
    do_revert
else
    do_apply
fi
