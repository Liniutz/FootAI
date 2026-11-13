#!/usr/bin/env bash
# Creates a PipeWire Virtual Source for TouchDesigner / React Web Audio API.
# Connect your USB Guitar Interface output to "CyberneticSession_VisualIn" in qpwgraph,
# then select "Cybernetic Session Visual Audio" as an input device in TouchDesigner or Chrome/Firefox.

set -euo pipefail

exec pw-loopback \
  --capture-props="node.name=CyberneticSession_VisualIn node.description='Cybernetic Visual In'" \
  --playback-props="media.class=Audio/Source node.name=CyberneticSession_VisualSource node.description='Cybernetic Session Visual Audio'"
