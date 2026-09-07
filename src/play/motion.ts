import {easeRatio} from './easing.ts';
import type {Point, ResolvedPlay, ResolvedPlayer} from './types';

export const pointAt = (player: ResolvedPlayer, time: number): Point => {
  const keyframes = player.keyframes;
  if (time <= keyframes[0].t) return {x: keyframes[0].x!, y: keyframes[0].y!};
  for (let index = 1; index < keyframes.length; index += 1) {
    const next = keyframes[index];
    const previous = keyframes[index - 1];
    if (time <= next.t) {
      const ratio = easeRatio(
        (time - previous.t) / (next.t - previous.t),
        next.ease,
      );
      return {
        x: previous.x! + (next.x! - previous.x!) * ratio,
        y: previous.y! + (next.y! - previous.y!) * ratio,
      };
    }
  }
  const final = keyframes[keyframes.length - 1];
  return {x: final.x!, y: final.y!};
};

const playerById = (play: ResolvedPlay, id: string) => {
  const player = play.players.find(candidate => candidate.id === id);
  if (!player) throw new Error(`Unknown player ${id}`);
  return player;
};

const lerp = (from: Point, to: Point, ratio: number): Point => ({
  x: from.x + (to.x - from.x) * ratio,
  y: from.y + (to.y - from.y) * ratio,
});

// Single source of truth for the gain line's y-position at any instant. It
// never eases or interpolates — it snaps directly to the most recent
// keyframe at or before `time`, since it is always exactly the ball's
// position at that keyframe's timestamp, never an independently animated path.
export const gainLineYAt = (play: ResolvedPlay, time: number): number => {
  const keyframes = play.field.gainLine;
  let current = keyframes[0].y;
  for (const keyframe of keyframes) {
    if (keyframe.t > time) break;
    current = keyframe.y;
  }
  return current;
};

// Single source of truth for the ball's position at any instant. The scene
// renders the ball by calling this directly every frame (no separate tween
// approximates it), so this function's output IS what gets rendered. Passes
// chain: before the first event the ball follows `ball.starts_with`, and
// after each event's arrival it follows that event's `to` until the next
// event (or forever, if it was the last one).
export const ballPositionAt = (play: ResolvedPlay, time: number): Point => {
  const events = play.ball.events;
  let carrierId = play.ball.starts_with;

  for (const event of events) {
    if (time < event.t) break;

    const thrower = playerById(play, event.from);
    const receiver = playerById(play, event.to);
    const arrivalTime = event.t + event.duration;
    if (time <= arrivalTime) {
      const release = pointAt(thrower, event.t);
      const arrival = pointAt(receiver, arrivalTime);
      return lerp(release, arrival, (time - event.t) / event.duration);
    }
    carrierId = event.to;
  }

  return pointAt(playerById(play, carrierId), time);
};
