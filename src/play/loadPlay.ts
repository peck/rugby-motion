import {easeRatio} from './easing.ts';
import {ballPositionAt} from './motion.ts';
import type {
  GainLineKeyframe,
  Keyframe,
  Play,
  Point,
  RelativeOffset,
  ResolvedGainLineKeyframe,
  ResolvedPlay,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
};

const resolveRelative = (reference: Point, offset: RelativeOffset): Point => ({
  x: reference.x + (offset.right ?? 0) - (offset.left ?? 0),
  y: reference.y + (offset.behind ?? 0) - (offset.forward ?? 0),
});

type WorkingKeyframe = Keyframe & {
  t: number;
  x?: number;
  y?: number;
  holdPrevious?: boolean;
};

type WorkingPlayer = {
  id: string;
  number: number;
  team: string;
  keyframes: WorkingKeyframe[];
};

// Players may be positioned relative to another player's position at the
// *same timestamp* (not just that player's start), so keyframes are
// resolved via fixed-point iteration: any keyframe whose reference position
// becomes available unblocks it, regardless of authoring order.
const positionAtTime = (players: WorkingPlayer[], playerId: string, t: number): Point | undefined => {
  const player = players.find(candidate => candidate.id === playerId);
  if (!player) return undefined;
  const keyframes = player.keyframes;

  const exact = keyframes.find(keyframe => keyframe.t === t);
  if (exact) return exact.x !== undefined && exact.y !== undefined ? {x: exact.x, y: exact.y} : undefined;

  if (t <= keyframes[0].t) {
    const first = keyframes[0];
    return first.x !== undefined && first.y !== undefined ? {x: first.x, y: first.y} : undefined;
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    if (t <= next.t) {
      if (previous.x === undefined || previous.y === undefined || next.x === undefined || next.y === undefined) {
        return undefined;
      }
      const ratio = easeRatio((t - previous.t) / (next.t - previous.t), next.ease);
      return {
        x: previous.x + (next.x - previous.x) * ratio,
        y: previous.y + (next.y - previous.y) * ratio,
      };
    }
  }

  const last = keyframes[keyframes.length - 1];
  return last.x !== undefined && last.y !== undefined ? {x: last.x, y: last.y} : undefined;
};

const resolvePlayerPositions = (players: WorkingPlayer[]): void => {
  let progress = true;
  while (progress) {
    progress = false;
    for (const player of players) {
      player.keyframes.forEach((keyframe, index) => {
        if (keyframe.x !== undefined && keyframe.y !== undefined) return;
        if (keyframe.from_previous) {
          const previous = player.keyframes[index - 1];
          if (previous?.x !== undefined && previous.y !== undefined) {
            const resolved = resolveRelative({x: previous.x, y: previous.y}, keyframe.offset_m ?? {});
            keyframe.x = resolved.x;
            keyframe.y = resolved.y;
            progress = true;
          }
          return;
        }
        if (keyframe.holdPrevious) {
          const previous = player.keyframes[index - 1];
          if (previous?.x !== undefined && previous.y !== undefined) {
            keyframe.x = previous.x;
            keyframe.y = previous.y;
            progress = true;
          }
          return;
        }
        if (keyframe.relative_to) {
          const reference = positionAtTime(players, keyframe.relative_to, keyframe.t);
          if (reference) {
            const resolved = resolveRelative(reference, keyframe.offset_m ?? {});
            keyframe.x = resolved.x;
            keyframe.y = resolved.y;
            progress = true;
          }
        }
      });
    }
  }

  const unresolved = players.flatMap(player =>
    player.keyframes
      .filter(keyframe => keyframe.x === undefined || keyframe.y === undefined)
      .map(keyframe => `${player.id}@t=${keyframe.t}`),
  );
  if (unresolved.length > 0) {
    throw new Error(
      `Could not resolve positions for: ${unresolved.join(', ')} (circular or missing relative_to reference)`,
    );
  }
};

// When a keyframe is positioned relative_to another player and doesn't
// specify its own ease, inherit that player's ease for the same timestamp
// so the two stay visually attached instead of drifting apart (see the
// pod-sync regression test).
const impliedEase = (
  rawPlayers: unknown[],
  referenceId: string,
  t: number,
): Keyframe['ease'] | undefined => {
  const reference = rawPlayers.find(
    candidate => isRecord(candidate) && candidate.id === referenceId,
  ) as Record<string, unknown> | undefined;
  const keyframes = reference?.keyframes as Keyframe[] | undefined;
  return keyframes?.find(keyframe => keyframe.t === t)?.ease;
};

const buildWorkingPlayers = (rawPlayers: unknown[]): WorkingPlayer[] =>
  rawPlayers.map((rawPlayer, index) => {
    if (!isRecord(rawPlayer)) throw new Error(`players[${index}] must be an object`);
    const id = String(rawPlayer.id ?? '');
    const rawKeyframes = rawPlayer.keyframes;
    if (!id || !Array.isArray(rawKeyframes) || rawKeyframes.length === 0) {
      throw new Error(`players[${index}] needs an id and keyframes`);
    }

    let previousTime = -Infinity;
    const keyframes: WorkingKeyframe[] = (rawKeyframes as Keyframe[]).map((keyframe, keyframeIndex) => {
      const t = number(keyframe.t, `${id}.keyframes[${keyframeIndex}].t`);
      if (t < previousTime) throw new Error(`${id} keyframe times must be monotonic`);
      previousTime = t;

      if (keyframe.from_previous) {
        if (keyframeIndex === 0) {
          throw new Error(`${id}.keyframes[${keyframeIndex}] cannot use from_previous without a previous keyframe`);
        }
        if (keyframe.relative_to) {
          throw new Error(`${id}.keyframes[${keyframeIndex}] cannot combine from_previous with relative_to`);
        }
        if (keyframe.x !== undefined || keyframe.y !== undefined) {
          throw new Error(`${id}.keyframes[${keyframeIndex}] cannot combine from_previous with x/y`);
        }
        if (!keyframe.offset_m) {
          throw new Error(`${id}.keyframes[${keyframeIndex}] with from_previous needs offset_m`);
        }
        return {...keyframe, t, x: undefined, y: undefined};
      }
      if (keyframe.relative_to) {
        const ease = keyframe.ease ?? impliedEase(rawPlayers, keyframe.relative_to, t);
        return {...keyframe, ease, t, x: undefined, y: undefined};
      }
      if (keyframe.x !== undefined && keyframe.y !== undefined) {
        return {
          ...keyframe,
          t,
          x: number(keyframe.x, `${id}.keyframes[${keyframeIndex}].x`),
          y: number(keyframe.y, `${id}.keyframes[${keyframeIndex}].y`),
        };
      }
      if (keyframeIndex === 0) {
        throw new Error(`${id}.keyframes[${keyframeIndex}] needs x/y or relative_to`);
      }
      return {...keyframe, t, x: undefined, y: undefined, holdPrevious: true};
    });

    return {
      id,
      number: number(rawPlayer.number, `${id}.number`),
      team: String(rawPlayer.team ?? ''),
      keyframes,
    };
  });

// The gain line is never an authored coordinate: it is always wherever the
// ball is at a given time. It is implicitly present at the ball's starting
// position (t=0) even if the author doesn't list that timestamp, and MAY
// be given additional timestamps at which it updates to the ball's
// position at that instant. It never eases between those timestamps.
const resolveGainLine = (field: Play['field'], playForBallLookup: ResolvedPlay): ResolvedGainLineKeyframe[] => {
  const authored = (field.gain_line ?? []) as GainLineKeyframe[];
  const times = new Set<number>([0, playForBallLookup.duration]);
  authored.forEach((keyframe, index) => {
    const t = number(keyframe.t, `field.gain_line[${index}].t`);
    if (t < 0 || t > playForBallLookup.duration) {
      throw new Error(`field.gain_line[${index}].t must be within the play duration`);
    }
    times.add(t);
  });

  let previousTime = -Infinity;
  return [...times]
    .sort((first, second) => first - second)
    .map(t => {
      if (t < previousTime) throw new Error('field.gain_line times must be monotonic');
      previousTime = t;
      return {t, y: ballPositionAt(playForBallLookup, t).y};
    });
};

// Passes must chain: each event's `from` must be whoever is currently
// carrying the ball (the previous event's `to`, or `ball.starts_with` for
// the first event), and event times must be non-decreasing, so the ball
// never teleports from a player who never actually had it.
const validateBallEvents = (play: Play): void => {
  let carrierId = play.ball.starts_with;
  let previousTime = -Infinity;
  play.ball.events.forEach((event, index) => {
    if (event.t < previousTime) throw new Error(`ball.events[${index}] times must be monotonic`);
    previousTime = event.t;
    if (event.from !== carrierId) {
      throw new Error(
        `ball.events[${index}].from ("${event.from}") does not match the current carrier ("${carrierId}")`,
      );
    }
    carrierId = event.to;
  });
};

export const loadPlay = (value: unknown): ResolvedPlay => {
  if (!isRecord(value)) throw new Error('Play must be an object');
  const players = value.players;
  const teams = value.teams;
  if (!Array.isArray(players) || !Array.isArray(teams)) {
    throw new Error('Play must include teams and players arrays');
  }
  if (players.length > 30) throw new Error('A play cannot contain more than 30 players');

  const workingPlayers = buildWorkingPlayers(players);
  resolvePlayerPositions(workingPlayers);

  const play = value as unknown as Play;
  if (play.schema_version !== 1) throw new Error('Unsupported schema_version');
  if (!play.ball?.starts_with) throw new Error('Play must define ball.starts_with');
  if (!play.viewport || (play.viewport.mode !== 'auto' && play.viewport.mode !== 'fixed')) {
    throw new Error('Play must define viewport.mode as auto or fixed');
  }
  validateBallEvents(play);

  // Gain-line resolution may need the ball's resolved position (follow_ball),
  // so it runs against a fully-formed ResolvedPlay with a placeholder empty
  // gain line first (ballPositionAt never reads field.gainLine).
  const resolvedPlayers = workingPlayers as ResolvedPlay['players'];
  const playWithoutGainLine: ResolvedPlay = {
    ...play,
    players: resolvedPlayers,
    field: {...play.field, gainLine: []},
  };
  const gainLine = resolveGainLine(play.field, playWithoutGainLine);

  return {
    ...play,
    players: resolvedPlayers,
    field: {...play.field, gainLine},
  };
};

