#!/usr/bin/env bash
# Creates a PipeWire Virtual Source for TouchDesigner / React Web Audio API.
# Connect your USB Guitar Interface output to "CyberJam_VisualIn" in qpwgraph,
# then select "CyberJam Visual Audio" as an input device in TouchDesigner or Chrome/Firefox.

set -euo pipefail

exec pw-loopback \
  --capture-props="node.name=CyberJam_VisualIn node.description='CyberJam Visual In'" \
  --playback-props='media.class=Audio/Source node.name=CyberJam_VisualSource node.description="CyberJam Visual Audio"'
