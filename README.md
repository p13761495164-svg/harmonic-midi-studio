# Harmonic MIDI Track Player

A focused browser-based MIDI player with:

- Local `.mid` / `.midi` file import
- Automatic track separation
- Automatic recovery of UTF-8, GB18030/GBK, Big5 and Shift-JIS track-name mojibake
- Play, pause and seek
- Per-track mute and solo
- Per-track instrument-family synthesis with filters, reverb, and natural ADSR release tails
- Acoustic Grand Piano is rendered with a bright kalimba-style resonator preset whose overtones decay independently
- Orchestral Harp maps to the Transpose Piano-style kalimba preset with 1× / 4.03× partials, 4 ms attack and a 3-second decay
- Sticky transport controls and a continuous playhead across the track lanes
- Pixel-aligned transport scrubber and track playhead
- Per-instrument timbre editor with live audition and browser-persistent presets
- PHP 8 + MySQL timbre library covering all 128 General MIDI programs
- Cloud timbre manager with 1–2–3–4–5–6–7–1 audition, favorites, and admin-key protected saves
- Per-track replacement from the shared favorite-timbre library
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
npm run build:php
```

The GitHub Pages workflow deploys the static export in `out/`.
The PHP command creates a VPS-ready bundle in `php-dist/`; see `PHP_DEPLOY.md`.
