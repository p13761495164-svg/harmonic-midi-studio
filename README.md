# Harmonic Studio

A focused browser-based MIDI editor prototype with:

- Region move, trim, split, merge, multi-select and delete
- Piano roll note entry, preview and scale-degree labels
- Tempo and key automation events at any playhead position
- Web Audio playback with tempo-aware transport
- Timeline zoom, snap and responsive desktop/mobile layouts

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
