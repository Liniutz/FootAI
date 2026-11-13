# Cybernetic Session — Documentation Hub

Welcome to the central documentation directory for **The Cybernetic Session** (`FootAI`). Every subsystem, interface contract, routing map, and ML integration boundary is documented here.

## Documentation Index

| Document | Scope |
| :--- | :--- |
| [architecture.md](./architecture.md) | End-to-end system architecture, concurrency model (threads + `asyncio`), and module map |
| [setup-cachyos.md](./setup-cachyos.md) | CachyOS / Arch Linux `pacman` dependencies, Python `.venv`, Fish shell commands, and CLI flags |
| [audio-and-routing.md](./audio-and-routing.md) | `sounddevice` ingress, DSP backends (`aubio` / `librosa` / `crepe`), UDP `:13000`, `pw-loopback`, and `qpwgraph` cable map |
| [contracts-and-apis.md](./contracts-and-apis.md) | Visuals WebSocket (`:8080`) JSON schema, Wekinator OSC (`:12000`) addresses, and `CyberneticAI_Band` MIDI channels |
| [ml-integration.md](./ml-integration.md) | ML stub contract (`ml_brain.py`) and `MagentaAgent` (`magenta_agent.py`) TensorFlow/MIDI integration |

---

## Agent & Contributor Documentation Protocol

> [!IMPORTANT]
> **All AI agents and human contributors working in this repository MUST follow these rules:**

1. **Always Work in a Feature Branch:**
   - Never commit directly to `main`. Create a descriptive branch (e.g., `feat/<topic>`, `fix/<topic>`, `docs/<topic>`) before making changes.
2. **Document Every Change Here (`docs/`):**
   - Whenever you add a module, change a port/protocol/JSON schema, or modify audio/MIDI routing, **update the relevant file in `docs/`** in the same branch.
   - If you introduce a new subsystem (e.g., React frontend, TouchDesigner `.toe` project, or trained RNN checkpoint pipeline), create a dedicated `docs/<subsystem>.md` and add it to the index table above.
3. **Include Exact Contracts & Verification:**
   - Document exact ports, sample rates, MIDI channels, OSC addresses, CLI flags, and environment assumptions.
   - Record the exact commands you ran to verify your changes (e.g., `py_compile`, smoke tests, unit tests) in your commit/PR description.
4. **Keep `README.md` & `docs/` Synchronized:**
   - Keep `README.md` as the high-level quickstart and point deep technical details to `docs/`.
