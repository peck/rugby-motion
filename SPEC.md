# rugby-motion — Project Spec (v0.1 draft)

## 1. Summary

A tool for authoring and rendering simple 2D top-down animations of rugby
union plays — similar in spirit to RugbySlate/AnimationSlate. A play is
described declaratively (data, not imperative code), then rendered to
one or more output formats. Primary target output is a landscape video
that can preserve wider horizontal movement in a single view.

## 2. Goals

- Describe a play as data: up to 30 players (shapes with jersey numbers)
  + 1 ball, each moving along a timed path over a rugby union pitch.
- Support an arbitrary number of independent plays, stored as separate
  files in a library/repo.
- Render each play to: video (mp4/webm, primary) and GIF (secondary,
  derived from the same source). Animated SVG is not a goal for v1
  (see §4 for rationale).
- Support a title on the visualization. Subtitles may remain in play data
  as metadata, but are not rendered in the current visual layout.
- Primary format uses landscape orientation, auto-cropped to the area of
  the pitch the play actually uses.
- Simple, readable visuals: plain shapes + numbers, no realistic art.

## 3. Non-goals (for v1)

- No 3D, no photorealistic players, no crowd/stadium rendering.
- No physics engine — motion is authored (keyframed), not simulated.
- No live/interactive editing UI in v1 (data files are hand-authored).
- No sport other than rugby union.

## 4. Tech stack (decision — revised)

- **Engine: [Motion Canvas](https://github.com/motion-canvas/motion-canvas)
  (TypeScript/Node).** It already provides the timeline/tweening
  engine, easing, generator-based sequencing (`waitFor`, `all()`,
  `sequence()`), a 2D scene graph (shapes, text), a live-preview editor
  for scrubbing while authoring, and a built-in ffmpeg export pipeline.
  This replaces building a custom renderer/animation engine in Python.
- **Play files stay declarative data: YAML/JSON**, matching the schema
  in §7. A generic Motion Canvas scene reads a play file at run time
  and instantiates player-token nodes + tweens/paths from it — play
  authors still never write TypeScript, they only edit data files.
  Schema validation happens with a TS schema library (e.g. Zod) as the
  play file is loaded.
- Play library identity is derived from the file path under `plays/`, not
  from an authored JSON `id`. For example, `plays/pods/black-two-tips.json`
  is selected as `?play=pods/black-two-tips` and exported to
  `out/pods/black-two-tips.mp4`.
- **Rendering model tradeoff (decision):** Motion Canvas renders via
  an HTML `<canvas>` (raster), not SVG DOM, so it cannot natively
  output an animated SVG file. Given the choice between (a) keeping
  SVG as a hard primary-format requirement and staying on a custom
  Python renderer, vs. (b) adopting Motion Canvas's mature
  timeline/editor/export tooling and dropping SVG — **we chose (b)**.
  Animated SVG is no longer a v1 goal; it could be revisited later via
  a separate, purpose-built exporter if still wanted.
- **Primary output — MP4/WebM:** rendered directly by Motion Canvas's
  built-in exporter (headless browser + ffmpeg, already part of the
  tool — no custom pipeline to build).
- **Secondary output — GIF:** derived from the same rendered frames,
  palette-optimized via ffmpeg.

## 5. Coordinate system & pitch model

- Units: meters. Origin `(0,0)` at the corner of one in-goal/touchline
  intersection.
- `x` = width axis, across the pitch from one touchline to the other.
- `y` = length axis, along the pitch between the try lines.
- Standard markings are represented in play data for authoring intent,
  but the current renderer uses a full green diagram surface rather than
  an exact touchline-bounded pitch. The gain line remains the primary
  rendered field reference; exact World Rugby Law 1 pitch markings can be
  reintroduced later as a separate rendering mode.
- Attacking direction is defined per play in this canonical landscape
  coordinate space. Rendering is a camera/viewport transform on top of
  this, not a change to the data.

## 6. Viewport / camera

- Output orientation: **landscape**, auto-cropped to a bounding box
  around all player + ball positions used in the play, padded (e.g.
  +5m each side), and centered in the landscape canvas.
- In `viewport.mode: auto`, the renderer may expand beyond pitch bounds
  and reduce the configured maximum zoom as needed so every defined player
  token remains visible for the whole play.
- If a play's motion spans more of the pitch than fits a single
  landscape crop well, allow an optional **explicit viewport override**
  in the play file, and/or a **multi-scene/camera-cut** list (time
  ranges → viewport), so long plays can "cut" between zoomed views
  instead of zooming out to fit everything.

## 7. Play data schema (draft)

```yaml
schema_version: 1
title: "Midfield Scissors"
subtitle: "Attacking phase off 9"
tags: [attack, backs]
attacking_direction: left_to_right   # canonical pitch space
duration: 6.0                        # seconds; or derive from max keyframe time

field:
  show_markings: [touchline, try_line, twenty_two, halfway, five_m]

viewport:
  mode: auto        # auto | fixed | scenes
  padding_m: 5

teams:
  - id: attack
    color: "#1f6feb"
  - id: defense
    color: "#d1242f"

players:
  - id: p9
    number: 9
    team: attack
    keyframes:
      - {t: 0.0, x: 45, y: 30}
      - {t: 2.0, x: 48, y: 32, ease: linear}
      - {t: 4.5, x: 52, y: 35}

ball:
  starts_with: p9    # ball position is implied: player p9's position(t), not authored

  events:
    - type: pass
      from: p9
      to: p12
      t: 2.1            # release time
      duration: 0.5       # flight time (or use `speed_mps` instead, see below)
      curve: straight     # straight | arc | lob
    - type: kick
      from: p10
      t: 5.0
      target: {x: 60, y: 45}   # kicks may target a pitch point, not just a player
      duration: 2.2
      curve: arc

annotations:
  - type: text
    text: "Scrum half draws defender"
    t_start: 0.0
    t_end: 2.0
    anchor: screen_top   # or pitch coords

title_card:
  show: true
  t_start: 0.0
  t_end: 1.5
```

- Keyframe times are seconds from play start, monotonically increasing
  per entity. Interpolation between keyframes is linear by default,
  with an optional `ease` (e.g. `ease_in_out`) per segment.
- After a player's initial position is resolved, later keyframes may use
  `from_previous: true` with `offset_m` to move independently from that
  same player's previous resolved keyframe. For example,
  `{t: 5, from_previous: true, offset_m: {right: 8, forward: 10}}`
  moves 8m right and 10m forward from that player's previous position.
  The first keyframe cannot use `from_previous`, because no previous
  position exists yet.
- **Each player's keyframes are independent of every other player's.**
  There is no shared/global keyframe timeline that all players must
  populate in lockstep. Players are only synchronized by the common
  clock `t` (seconds from play start) that all their keyframe times
  are measured against — one player might have keyframes at
  `t: 0, 4.5` (stationary the whole time, or moving once late), while
  another has keyframes at `t: 0, 0.5, 1.0, 1.8, 2.4` (constantly
  adjusting). A player with no keyframes after their last one simply
  holds their final position for the rest of the play; a player with
  only one keyframe never moves at all.

### 7.1 Ball position is always resolved, never hand-authored

This is the core problem this tool is meant to solve vs. authoring in
Keynote/PowerPoint: you should never have to drag the ball shape until
it visually lines up with a moving player at the right frame.

- **While carried**: the ball has no keyframes of its own. Its
  position at time `t` is simply `player[carrier].position(t)` — a
  live query against that player's own motion track, computed by the
  engine every frame.
- **During a pass/kick to a player** (`to: p12`): the engine computes
  the ball's flight path by sampling the **thrower's** position at the
  release time `t` and the **receiver's** position at the resolved
  arrival time `t + duration`, then interpolates between those two
  *derived* points using the chosen `curve`. The author supplies *who*
  and *when* (release time + duration); the engine supplies *where*.
  If `p12`'s route is edited later, the pass automatically re-targets
  to wherever `p12` now is at that same relative time — nothing to
  manually re-sync.
  - After the event ends, `carrier` automatically becomes `to` — passes
    always complete cleanly (this tool visualizes the intended
    playbook, not game outcomes like drops/intercepts, so no "missed
    pass" case is needed).
- **Kick to a spot** (`target: {x, y}`): no receiving player to query,
  so the target is an explicit pitch coordinate — this is the one case
  where a literal coordinate is legitimate, since it's not standing in
  for "wherever some player happens to be."
- **Choosing `duration` vs. computed timing**: v1 requires an explicit
  `duration` per pass/kick (simplest to implement and reason about).
  A possible v2 refinement: a `speed_mps` field instead of `duration`,
  where the engine solves for arrival time iteratively (distance to the
  receiver's position depends on arrival time, which depends on
  distance — a couple of fixed-point iterations converge fine for
  realistic pass speeds vs. player speeds). Not required for v1 since
  `duration` alone already removes the manual-coordinate-matching
  problem.

### 7.2 Not yet solved: starting positions and reuse across plays (open)

The ball-resolution fix in §7.1 removes manual coordinate-matching for
passes. Two closely related problems are **not yet solved** and are
arguably just as important to the "not Keynote" value proposition:

- **Absolute starting coordinates**: every player still needs a hand
  authored `{x, y}` at their first keyframe. For 15+ players per team
  this is the same "guess the number" friction, just moved earlier in
  the timeline. A likely fix: allow a keyframe to be defined **relative
  to another player or a pitch reference** instead of absolute, e.g.
  `{t: 0, relative_to: p12, offset_m: {along: -5, across: 2}}`
  ("5m behind and 2m outside p12"), which matches how plays are
  actually described verbally/on a whiteboard.
- **No reuse across plays**: common rugby structures (a defensive
  line, a lineout, a kickoff receipt, a scrum engagement, a standard
  backline alignment) currently have to be fully re-authored, position
  by position, in every play file that uses them. A likely fix:
  **named, parameterized starting formations** (and possibly reusable
  motion "shapes" like a switch/scissors/loop) defined once and
  referenced from many plays, e.g. `formation: standard_backline_15m`
  with per-play overrides for the handful of players who actually move
  differently in that phase.
- Neither of these is designed yet — flagging as the next thing to
  design after the core schema/rendering pipeline works for one
  hand-authored play, since getting the *shape* of reuse/relativity
  right early avoids a painful schema migration later.

#### Human-readable relative positions

The first implementation should allow authors to describe a player's
starting position relative to another player using rugby language rather
than screen coordinates. In a topward attack, `forward` means toward the
top of the rendered screen, `behind` means toward the bottom, and `right`
means the viewer's right. For example:

```yaml
players:
  - id: p9
    number: 9
    start: {x: 35, y: 35}
  - id: p1
    number: 1
    start: {relative_to: p9, behind_m: 3, right_m: 5}
  - id: p2
    number: 2
    start: {relative_to: p1, forward_m: 1, right_m: 1}
```

This describes a pod without requiring the author to calculate
screen-space coordinates. Motion routes should use the same vocabulary,
for example `forward_m: 23` for 1's run and a shorter `forward_m: 19`
for 2's support line.

## 8. Visual style

- Players: filled circle per team color, jersey number centered in a
  legible font sized to stay readable at phone-screen scale even with
  up to 30 players on screen.
- Ball carrier: subtle ring/outline highlight on the carrying player.
- Ball: small distinct shape (e.g. ellipse) following its own keyframe
  path.
- Team differentiation: color **plus** a secondary cue (fill vs.
  outline, or shape) for colorblind accessibility.

## 9. Output formats

| Format | Use case | Generation |
|---|---|---|
| MP4/WebM | Primary, phone-first sharing | Motion Canvas built-in export (headless browser + ffmpeg) |
| GIF | Quick share, no player needed | Same rendered frames → ffmpeg palette-optimized GIF |
| SVG | Not planned for v1 | Would require a separate custom exporter (dropped, see §4) |

## 10. Project structure (proposed)

```
rugby-motion/
  src/
    scenes/
      play.ts          # generic Motion Canvas scene: loads a play file, drives it
    pitch/
      geometry.ts        # pitch dimensions + markings constants
      draw.ts            # pitch line rendering as Motion Canvas nodes
    play/
      schema.ts          # Zod schema + types for the play file format
      loadPlay.ts         # parse/validate a play file
      viewport.ts         # auto-crop / scene camera logic
    project.ts          # Motion Canvas project entry point
  plays/                 # example/library play files (yaml/json)
  tests/
    golden/              # golden-file frame comparisons
SPEC.md
```

## 11. Open questions to resolve before/while building

These weren't settled yet and materially affect the design:

1. **Long plays vs. portrait crop**: when a play covers more pitch
   length than a single portrait view fits well, do we auto-zoom out
   (players get small) or require authors to define camera "scenes"?
2. **Passes/kicks visualization**: ball position is auto-resolved
   (§7.1) — but is a moving ball dot enough visually, or do we also
   draw a transient arrow/dashed line for the pass, and how do we cue
   a kick's height/hang time in a top-down view (e.g. scale/shadow)?
2a. **Overlapping events**: what happens if a player is targeted by a
   pass while they also have their own independent keyframes moving
   them elsewhere at that exact moment — does the pass event simply
   read whatever position their keyframe track already produces at
   arrival time (yes, by design in §7.1), meaning the play author is
   responsible for keeping the receiver's own route sensible, not the
   engine?
3. **Field markings**: which are on by default vs. optional per play
   (full marking set can visually clutter a small phone screen)?
4. **Numbering/legibility**: real squad numbers (1–15/23) vs. simple
   sequence — and minimum shape size for number legibility on phone
   screens with many players clustered (e.g. rucks/mauls).
5. **Stoppages**: do plays support a "hold"/pause (e.g. at a ruck) or
   is motion always continuous?
6. **Looping**: should rendered animations loop automatically, and is
   there a hold on the last frame before looping?
7. **Validation rules**: max 30 players enforced where; must ball have
   exactly one or zero carriers at any time; keyframe time monotonicity;
   position bounds (allow slightly outside pitch, e.g. touch throws-in?).
8. **Schema evolution**: `schema_version` is present — what's the
   policy for breaking vs. additive changes as the format evolves?
9. **Authoring ergonomics**: hand-written YAML now — should the schema
   anticipate a future visual/drag-based editor (e.g., separating
   "path shape" from "timing" so a UI could manipulate them
   independently)? Motion Canvas's own editor could potentially be
   leaned on for this later, worth exploring once the data-driven
   scene exists.
10. **Distribution**: personal tool/CLI, or an installable package
    others might use? Affects packaging, docs, and naming (avoid
    reusing "RugbySlate"/"AnimationSlate" branding/assets).
11. **GIF size constraints**: GIFs from many colored shapes can get
    large — is there a target max file size / resolution / fps for
    the GIF output given it's meant for phone sharing?
12. **Testing strategy**: golden-file frame diffs are proposed — is
    visual/frame-level regression testing (e.g. pixel diff on a few
    captured frames) wanted for the video/GIF path?
13. **Batch/headless rendering**: Motion Canvas is editor-centric by
    default — need to confirm/establish a headless CLI render path
    (e.g. its `@motion-canvas/render` / CLI export) that can batch
    render an arbitrary number of play files without the editor UI
    open, since "support an arbitrary number of plays" implies
    scriptable/CI-friendly rendering, not just manual editor exports.
14. **Concrete resolution/aspect ratio/fps target**: "portrait,
    phone-first" isn't yet a number. Pick an explicit target (e.g.
    1080×1920 @ 30fps, 9:16) — this blocks the viewport/crop math in
    §6 and the GIF size budget in #11.
15. **Run-trail visualization**: rugby coaching diagrams conventionally
    show the *path* a player will take (an arrow or curved line), not
    just a moving dot. Do we render each player's upcoming/just-taken
    path as a fading trail or arrow, in addition to the animated token?
    This is currently entirely unaddressed in §8.
16. **Playback speed**: is a global or per-segment slow-motion /
    speed-up control needed (common in coaching tools for emphasizing
    a key phase), or is everything always real-time?
17. **Set-piece formations**: scrums, lineouts, rucks, and mauls
    involve tightly clustered players. Do these need a distinct visual
    representation (e.g. a single grouped shape/icon) instead of
    overlapping individual numbered dots, which would be illegible at
    phone scale exactly where rugby diagrams most need clarity?
18. **Library/index management**: "arbitrary number of plays" implies
    a growing collection — what's the naming/tagging convention, and
    is a generated index (with thumbnails) needed to browse them, or
    is a flat folder of files sufficient for now?
19. **Render determinism**: golden-file frame testing (§12/#12) needs
    byte-for-byte or pixel-stable output across runs — needs
    confirming Motion Canvas's headless export is actually
    deterministic (fixed seed/timing) before relying on it for tests.

## 12. Suggested next step

Pick answers for the open questions that block the data schema (1, 3,
4, 7 especially), then scaffold a Motion Canvas project and implement
`pitch/geometry.ts` + `pitch/draw.ts` + `play/schema.ts` +
`scenes/play.ts` for a single hard-coded example play file end-to-end
(render one play to MP4 headlessly) before building out GIF export and
the full plays library.
