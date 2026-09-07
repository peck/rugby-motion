import type {Point, ResolvedPlay} from './types';

export type ViewportBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const allPlayPositions = (play: ResolvedPlay): Point[] =>
  play.players.flatMap(player =>
    player.keyframes.map(keyframe => ({x: keyframe.x!, y: keyframe.y!})),
  );

export const getViewportBounds = (play: ResolvedPlay): ViewportBounds => {
  if (play.viewport.mode === 'fixed' && play.viewport.center && play.viewport.size) {
    return {
      left: play.viewport.center.x - play.viewport.size.x / 2,
      right: play.viewport.center.x + play.viewport.size.x / 2,
      top: play.viewport.center.y - play.viewport.size.y / 2,
      bottom: play.viewport.center.y + play.viewport.size.y / 2,
    };
  }

  const positions = allPlayPositions(play);
  const padding = play.viewport.padding_m;
  const raw = {
    left: Math.min(...positions.map(position => position.x)) - padding,
    right: Math.max(...positions.map(position => position.x)) + padding,
    top: Math.min(...positions.map(position => position.y)) - padding,
    bottom: Math.max(...positions.map(position => position.y)) + padding,
  };
  return raw;
};
