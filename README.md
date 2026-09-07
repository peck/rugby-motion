# Rugby Motion

Rugby play visualizations built with Motion Canvas. Plays are JSON files in `plays/` and are rendered as landscape animations on a full green diagram surface with numbered player tokens, a ball, title text, and a gain line.

## Setup

Install dependencies:

```bash
npm install
```

The devcontainer installs `ffmpeg` and Chromium automatically when it is created.

## Preview

Start the Motion Canvas editor:

```bash
npm run serve -- --host 0.0.0.0 --port 9000
```

Open the forwarded port:

```text
http://localhost:9000/
```

Select a play by filename in the URL:

```text
http://localhost:9000/?play=black-one
http://localhost:9000/?play=black-two
http://localhost:9000/?play=green-one
http://localhost:9000/?play=green-two
```

The `play` value is the JSON filename without `.json`. New JSON files in `plays/` are discovered by Vite; restart the dev server if a newly added file does not appear.

Auto viewports include all player keyframes in the play. If the play would not fit at the configured maximum zoom, the renderer zooms out for that play so every player token remains visible. The rendered green area is the diagram surface rather than an exact touchline-bounded pitch.

## Authoring Plays

Create or edit a JSON file in `plays/`. Player IDs are scoped to that play, so separate play files may reuse IDs such as `p1`, `p2`, and `p9`.

Player positions can be absolute:

```json
{"t": 0, "x": 35, "y": 50}
```

Or relative to another player at the same timestamp:

```json
{
  "t": 0,
  "relative_to": "p9",
  "offset_m": {"behind": 3, "right": 5}
}
```

After a player's initial position is set, later keyframes can move from that player's own previous resolved position:

```json
{
  "t": 5,
  "from_previous": true,
  "offset_m": {"right": 8, "forward": 10}
}
```

For `attacking_direction: "toward_top"`, `forward` moves visually up the screen.

The supported play format is described in [SPEC.md](SPEC.md) and implemented by the types and loader in `src/play/`.

## Checks

Run the motion regression tests:

```bash
npm test
```

Run the TypeScript and production bundle check:

```bash
npm run build
```

## Export

Export every JSON play to a play-specific MP4:

```bash
npm run export
```

The batch exporter discovers every `plays/*.json` file and writes one matching MP4 per play in `out/`:

```text
plays/black-one.json  -> out/black-one.mp4
plays/black-two.json  -> out/black-two.mp4
plays/green-one.json  -> out/green-one.mp4
plays/green-two.json  -> out/green-two.mp4
```

To export one play:

```bash
npm run export -- --play=black-two
```

To check discovery without rendering video:

```bash
npm run export -- --dry-run
```

The exporter uses Motion Canvas's FFmpeg exporter, waits for `output/project.mp4`, validates that the MP4 is readable, and moves it to the play-specific file in `out/`.

## Project Settings

Shared visualization settings are in [src/projectConfig.ts](src/projectConfig.ts), including the canvas, maximum pitch scale, title typography, and title-safe area.

The project is configured for a 1920x1080 landscape output in `src/project.meta`.
