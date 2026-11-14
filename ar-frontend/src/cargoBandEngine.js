import * as Tone from "tone";

const STEMS = ["drums", "bass", "vocals", "guitar", "piano", "other"];

export class CargoBandEngine {
  constructor(onVisualUpdate) {
    this.players = {};
    this.songMap = null;
    this.ws = null;
    this.onVisualUpdate = onVisualUpdate; // Callback for teammate's AR scene
  }

  async loadSong(songSlug) {
    await Tone.start();
    Tone.Transport.stop();
    Object.values(this.players).forEach((p) => p.dispose());
    this.players = {};

    const res = await fetch(`/stems/${songSlug}/song_map.json`);
    this.songMap = await res.json();

    // Load all 6 stems synced to Tone.Transport
    await Promise.all(
      STEMS.map(
        (stem) =>
          new Promise((resolve) => {
            const player = new Tone.GrainPlayer({
              url: `/stems/${songSlug}/${stem}.wav`,
              grainSize: 0.1,
              overlap: 0.05,
              onload: resolve,
            }).toDestination();
            player.sync().start(0);
            this.players[stem] = player;
          })
      )
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ base_bpm: this.songMap.base_bpm }));
    }
  }

  connectToGuitarEngine() {
    this.ws = new WebSocket("ws://localhost:8765");

    this.ws.onmessage = (event) => {
      if (!this.songMap || !this.players.drums) return;
      const data = JSON.parse(event.data); // { live_bpm, is_playing, energy, detected_pitch_class }

      // 1. Time-stretch all 6 Cargo stems to match visitor's strumming speed
      const rate = data.live_bpm / this.songMap.base_bpm;
      STEMS.forEach((stem) => {
        this.players[stem].playbackRate = rate;
      });

      // 2. Smart Guitar Ducking: lower Cargo's guitar when user plays, restore if user stops
      const targetGuitarDb = data.is_playing ? -14 : -1.5;
      this.players.guitar.volume.rampTo(targetGuitarDb, 0.25);

      // 3. Find current & upcoming chord from song_map.json for the AR overlay
      const now = Tone.Transport.seconds;
      const idx = this.songMap.chords.findLastIndex((c) => c.time <= now);
      const currentChord = this.songMap.chords[idx] || { chord: "E5", pitch_class: 4 };
      const nextChord = this.songMap.chords[idx + 1] || currentChord;
      const chordMatch = data.is_playing && data.detected_pitch_class === currentChord.pitch_class;

      // 4. Push live state to your teammate's AR visuals
      this.onVisualUpdate?.({
        ...data,
        currentChord: currentChord.chord,
        nextChord: nextChord.chord,
        chordMatch,
      });
    };
  }

  play() {
    Tone.Transport.start();
  }

  stop() {
    Tone.Transport.stop();
  }
}
