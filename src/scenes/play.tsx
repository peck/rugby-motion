import {Circle, Line, Rect, Txt} from '@motion-canvas/2d';
import {makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, linear, useTime, waitFor} from '@motion-canvas/core';

import {projectConfig} from '../projectConfig';
import {ballPositionAt} from '../play/motion';
import {playLibrary} from '../play/library';
import {getViewportBounds} from '../play/viewport';
import type {Point, ResolvedPlayer} from '../play/types';

// Each play file is a fully independent entity (its own ids/players are
// scoped to itself); the library only groups them by filename for selection.
// The active play is chosen at load time via `?play=<fileName>` so this
// single Motion-Canvas scene file (required by the `?scene` loader) can
// render any discovered play without hand-building scene descriptions.
const selectedFileName = new URLSearchParams(window.location.search).get('play');
const selectedEntry =
  playLibrary.find(entry => entry.fileName === selectedFileName) ?? playLibrary[0];
const play = selectedEntry.play;

const playerSize = 72;
const ballSize = {width: 48, height: 32};
const heldBallOffset = {x: 0, y: -(playerSize / 2 + ballSize.height / 2 + 2)};
const heldBallPosition = (position: Point) => ({
  x: position.x + heldBallOffset.x,
  y: position.y + heldBallOffset.y,
});

const viewport = getViewportBounds(play);
const canvas = projectConfig.canvas;
const maxPitchScale = projectConfig.pitchScale;

// The pitch never renders above this y (in canvas space) so the title and
// subtitle, drawn in that reserved strip, can never overlap it.
const contentRect = {
  left: canvas.left,
  top: canvas.top + projectConfig.titleSafeHeight,
  width: canvas.width,
  height: canvas.height - projectConfig.titleSafeHeight,
};

const boundsCenter = {
  x: (viewport.left + viewport.right) / 2,
  y: (viewport.top + viewport.bottom) / 2,
};
const boundsSizeM = {
  width: viewport.right - viewport.left,
  height: viewport.bottom - viewport.top,
};
const fitMargin = playerSize / 2 + Math.max(ballSize.width, ballSize.height) / 2 + 8;
const fitWidth = Math.max(1, contentRect.width - fitMargin * 2);
const fitHeight = Math.max(1, contentRect.height - fitMargin * 2);
const pitchScale = play.viewport.mode === 'auto'
  ? Math.min(
    maxPitchScale,
    boundsSizeM.width > 0 ? fitWidth / boundsSizeM.width : maxPitchScale,
    boundsSizeM.height > 0 ? fitHeight / boundsSizeM.height : maxPitchScale,
  )
  : maxPitchScale;
const boundsSizePx = {
  width: (viewport.right - viewport.left) * pitchScale,
  height: (viewport.bottom - viewport.top) * pitchScale,
};

if (pitchScale < maxPitchScale) {
  console.info(
    `Play "${play.title}" fit scale reduced from ${maxPitchScale.toFixed(1)}px/m to ${pitchScale.toFixed(1)}px/m to keep all players visible.`,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Treat the visible green area as the diagram surface. We fit the play's
// own motion bounds rather than preserving exact touchline/pitch framing.
const desiredCenterPx = {
  x: contentRect.left + contentRect.width / 2,
  y: contentRect.top + contentRect.height / 2,
};
if (boundsSizePx.width > contentRect.width || boundsSizePx.height > contentRect.height) {
  console.warn(
    `Play "${play.title}" bounding box (${boundsSizePx.width.toFixed(0)}x${boundsSizePx.height.toFixed(0)}px) ` +
      `exceeds the title-safe render area (${contentRect.width}x${contentRect.height}px) at the fit scale of ${pitchScale}px/m.`,
  );
}

const screenPosition = (position: Point) => ({
  x: (position.x - boundsCenter.x) * pitchScale + desiredCenterPx.x,
  y: (position.y - boundsCenter.y) * pitchScale + desiredCenterPx.y,
});

function* animatePlayer(player: ResolvedPlayer, ref: ReturnType<typeof createRef<Circle>>) {
  for (let index = 1; index < player.keyframes.length; index += 1) {
    const previous = player.keyframes[index - 1];
    const next = player.keyframes[index];
    yield* ref().position(
      screenPosition(next),
      next.t - previous.t,
      next.ease === 'ease_in_out' ? easeInOutCubic : linear,
    );
  }
  yield* waitFor(Math.max(0, play.duration - player.keyframes[player.keyframes.length - 1].t));
}

// The gain line updates only at its own authored keyframes (always present
// at the ball's start, per loadPlay's resolveGainLine), not every frame like
// the ball. It never eases or tweens between keyframes — it snaps directly
// to the ball's position at each timestamp, since that is always exactly
// where it is, never an independently animated path.
function* animateGainLine(
  lineRef: ReturnType<typeof createRef<Line>>,
  labelRef: ReturnType<typeof createRef<Txt>>,
  labelPosition: (lineY: number) => Point,
) {
  const keyframes = play.field.gainLine;
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    yield* waitFor(next.t - previous.t);
    const lineY = screenPosition({x: 0, y: next.y}).y;
    lineRef().position.y(lineY);
    labelRef().position(labelPosition(lineY));
  }
  yield* waitFor(Math.max(0, play.duration - keyframes[keyframes.length - 1].t));
}

export default makeScene2D(function* (view) {
  const playerRefs = new Map<string, ReturnType<typeof createRef<Circle>>>();
  const ball = createRef<Circle>();
  const gainLine = createRef<Line>();
  const gainLineLabel = createRef<Txt>();
  const teams = new Map(play.teams.map(team => [team.id, team.color]));
  const markings = new Set(play.field.show_markings ?? ['touchline', 'gain_line']);
  const screen = (position: Point) => screenPosition(position);
  const typography = projectConfig.typography;
  const gainLineLabelPosition = (lineY: number) => ({
    x: contentRect.left + 48,
    y: clamp(lineY - 25, contentRect.top + 28, contentRect.top + contentRect.height - 28),
  });
  const initialGainLineY = screenPosition({x: 0, y: play.field.gainLine[0].y}).y;

  view.fill('#10251f');
  view.add(
    <>
      <Rect
        x={contentRect.left + contentRect.width / 2}
        y={contentRect.top + contentRect.height / 2}
        width={contentRect.width}
        height={contentRect.height}
        fill={'#1d6b43'}
      />
      {markings.has('gain_line') && <>
        <Line
          ref={gainLine}
          y={initialGainLineY}
          points={[[contentRect.left, 0], [contentRect.left + contentRect.width, 0]]}
          stroke={'#000000'}
          lineWidth={3}
          lineDash={[pitchScale, pitchScale]}
        />
        <Txt
          ref={gainLineLabel}
          text={'GAIN LINE'}
          {...gainLineLabelPosition(initialGainLineY)}
          offsetX={-1}
          fill={'#d7f1d6'}
          fontSize={22}
          fontFamily={typography.family}
          letterSpacing={2}
        />
      </>}
      <Txt
        text={play.title}
        x={canvas.left + typography.left}
        y={canvas.top + typography.top}
        offsetX={-1}
        offsetY={-1}
        fill={typography.titleColor}
        fontSize={typography.titleSize}
        fontFamily={typography.family}
        fontWeight={700}
      />
    </>,
  );

  for (const player of play.players) {
    const ref = createRef<Circle>();
    playerRefs.set(player.id, ref);
    view.add(
      <Circle
        ref={ref}
        {...screen(player.keyframes[0])}
        width={playerSize}
        height={playerSize}
        fill={teams.get(player.team) ?? '#e95d4f'}
        stroke={'#fff1df'}
        lineWidth={4}
      >
        <Txt text={String(player.number)} fill={'#fff1df'} fontSize={40} fontFamily={typography.family} fontWeight={700} />
      </Circle>,
    );
  }

  const firstCarrier = play.players.find(player => player.id === play.ball.starts_with);
  if (!firstCarrier) throw new Error(`Unknown ball carrier ${play.ball.starts_with}`);
  view.add(
    <Circle
      ref={ball}
      {...heldBallPosition(screen(ballPositionAt(play, 0)))}
      width={ballSize.width}
      height={ballSize.height}
      fill={'#ffffff'}
      stroke={'#17352a'}
      lineWidth={2}
    />,
  );

  yield* all(
    ...(markings.has('gain_line') ? [animateGainLine(gainLine, gainLineLabel, gainLineLabelPosition)] : []),
    ...play.players.map(player => animatePlayer(player, playerRefs.get(player.id)!)),
    (function* () {
      while (useTime() < play.duration) {
        ball().position(heldBallPosition(screen(ballPositionAt(play, useTime()))));
        yield;
      }
      ball().position(heldBallPosition(screen(ballPositionAt(play, play.duration))));
    })(),
  );
  yield* waitFor(1.5);
});
