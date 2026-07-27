# Harmonic MIDI Track Player

A focused browser-based MIDI player with:

- Local `.mid` / `.midi` file import
- Automatic track separation
- Play, pause and seek
- Per-track mute and solo
- Per-track instrument-family synthesis with filters and reverb
- Acoustic Grand Piano is rendered with a bright kalimba-style resonator preset
- Current key and tempo display
- Add tempo and key-signature events at the playhead
- Delete tracks and remove all sustain-pedal (CC64) events
- Export the edited project as a new MIDI file
- Browser-native Web Audio playback
- Responsive desktop and mobile layouts

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm run build:github
```

The GitHub Pages workflow deploys the static export in `out/`.
