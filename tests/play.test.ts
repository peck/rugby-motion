import assert from 'node:assert/strict';
import rawPlay from '../plays/pods/black-one.json' with {type: 'json'};
import {loadPlay} from '../src/play/loadPlay.ts';
import {ballPositionAt, gainLineYAt, pointAt} from '../src/play/motion.ts';
import {getViewportBounds} from '../src/play/viewport.ts';

const play = loadPlay(rawPlay);
const receiver = play.players.find(player => player.id === 'p1');
if (!receiver) throw new Error('Fixture is missing p1');
const support = play.players.find(player => player.id === 'p2');
if (!support) throw new Error('Fixture is missing p2');

// p2's final keyframe is relative_to p1 and (per the JSON fixture)
// intentionally omits its own `ease`, so it must be inferred from p1's
// keyframe at the same timestamp rather than silently defaulting to linear.
assert.equal(
  support.keyframes[support.keyframes.length - 1].ease,
  receiver.keyframes[receiver.keyframes.length - 1].ease,
  'p2 must inherit p1\'s ease when relative_to omits its own',
);

const startOne = pointAt(receiver, 0);
const endOne = pointAt(receiver, play.duration);
const startTwo = pointAt(support, 0);
const endTwo = pointAt(support, play.duration);
for (const time of [0.5, 1, 2, 3, 4, 4.5]) {
  const one = pointAt(receiver, time);
  const two = pointAt(support, time);
  const oneProgress = (one.y - startOne.y) / (endOne.y - startOne.y);
  const twoProgress = (two.y - startTwo.y) / (endTwo.y - startTwo.y);
  assert.ok(
    Math.abs(oneProgress - twoProgress) < 1e-9,
    `p2 is out of sync with p1 at t=${time}`,
  );
}

const pass = play.ball.events[0];
const thrower = play.players.find(player => player.id === pass.from);
if (!thrower) throw new Error(`Fixture is missing ${pass.from}`);
const arrivalTime = pass.t + pass.duration;

// The scene renders the ball by calling ballPositionAt() every frame (see
// src/scenes/example.tsx), so sampling it densely here is equivalent to
// checking what actually gets drawn. This is what would have caught the bug
// where the ball's rendered tween used different easing than the receiver's
// own keyframe interpolation and drifted apart mid-flight.
const sampleTimes: number[] = [];
for (let t = 0; t <= play.duration + 1e-9; t += 0.05) sampleTimes.push(Number(t.toFixed(2)));

for (const t of sampleTimes) {
  const ball = ballPositionAt(play, t);
  if (t < pass.t) {
    // Before the pass is thrown, the ball must track the thrower.
    assert.deepEqual(ball, pointAt(thrower, t), `ball must track the thrower at t=${t}`);
  } else if (t >= arrivalTime) {
    // Once caught, the ball must be exactly at the receiver's hands, at
    // every sampled frame, not just at keyframe boundaries.
    const receiverPosition = pointAt(receiver, t);
    assert.deepEqual(
      ball,
      receiverPosition,
      `ball must be exactly at the receiver's hands at t=${t} (ball=${JSON.stringify(ball)}, receiver=${JSON.stringify(receiverPosition)})`,
    );
  }
}

// Endpoints of the flight must match the thrower's release point and the
// receiver's position at the resolved arrival time (per SPEC.md §7.1).
const release = ballPositionAt(play, pass.t);
const landing = ballPositionAt(play, arrivalTime);
assert.deepEqual(release, pointAt(thrower, pass.t));
assert.deepEqual(landing, pointAt(receiver, arrivalTime));

// The pass is a backward pass (rugby law): the ball moves toward the bottom
// of the screen (higher y) during flight, then the receiver later attacks
// toward the top (lower y) after catching it.
assert.ok(landing.y > release.y, 'the pass must travel backward to the receiver');
assert.ok(pointAt(receiver, play.duration).y < landing.y, 'the receiver must later attack toward the top');

// The gain line is never authored as a coordinate: it must always start at
// the ball's t=0 position, and any additional authored timestamp must
// resolve to wherever the ball is at that same instant, not a hand-picked y.
// Built from a fixture with gain_line stripped, independent of whatever
// black-one.json itself currently authors.
const {gain_line: _omitted, ...fieldWithoutGainLine} = rawPlay.field as Record<string, unknown>;
const noGainLineFixture = {...rawPlay, field: fieldWithoutGainLine};
const playWithoutGainLine = loadPlay(noGainLineFixture);
assert.deepEqual(
  playWithoutGainLine.field.gainLine.map(keyframe => keyframe.t),
  [0, playWithoutGainLine.duration],
  'a play with no gain_line entries gets implicit start and end keyframes',
);
assert.equal(playWithoutGainLine.field.gainLine[0].t, 0);
assert.deepEqual(playWithoutGainLine.field.gainLine[0].y, ballPositionAt(playWithoutGainLine, 0).y);
assert.deepEqual(
  playWithoutGainLine.field.gainLine[1].y,
  ballPositionAt(playWithoutGainLine, playWithoutGainLine.duration).y,
);

const gainLineFixture = {
  ...rawPlay,
  field: {...rawPlay.field, gain_line: [{t: 1.5}]},
};
const playWithGainLine = loadPlay(gainLineFixture);
assert.deepEqual(
  playWithGainLine.field.gainLine.map(keyframe => keyframe.t),
  [0, 1.5, playWithGainLine.duration],
  'an authored timestamp is added between implicit start and end keyframes',
);
assert.equal(playWithGainLine.field.gainLine[0].y, ballPositionAt(playWithGainLine, 0).y);
assert.equal(playWithGainLine.field.gainLine[1].y, ballPositionAt(playWithGainLine, 1.5).y);
assert.equal(
  playWithGainLine.field.gainLine[2].y,
  ballPositionAt(playWithGainLine, playWithGainLine.duration).y,
);

const basePreviousPositionFixture = {
  schema_version: 1,
  title: 'Previous Position Test',
  duration: 3,
  field: {width_m: 70, length_m: 100},
  viewport: {mode: 'auto', padding_m: 1},
  teams: [{id: 'attack', color: '#e95d4f'}],
  players: [
    {
      id: 'p1',
      number: 1,
      team: 'attack',
      keyframes: [
        {t: 0, x: 20, y: 50},
        {t: 1, from_previous: true, offset_m: {right: 4, forward: 6}},
        {t: 2, from_previous: true, offset_m: {left: 1, behind: 2}},
        {t: 3},
      ],
    },
  ],
  ball: {starts_with: 'p1', events: []},
};
const previousPositionPlay = loadPlay(basePreviousPositionFixture);
const previousPositionPlayer = previousPositionPlay.players[0];
assert.deepEqual(pointAt(previousPositionPlayer, 0), {x: 20, y: 50});
assert.deepEqual(pointAt(previousPositionPlayer, 1), {x: 24, y: 44});
assert.deepEqual(pointAt(previousPositionPlayer, 2), {x: 23, y: 46});
assert.deepEqual(pointAt(previousPositionPlayer, 3), {x: 23, y: 46});

assert.throws(
  () => loadPlay({
    ...basePreviousPositionFixture,
    players: [{
      ...basePreviousPositionFixture.players[0],
      keyframes: [{t: 0, from_previous: true, offset_m: {right: 1}}],
    }],
  }),
  /from_previous/,
);

assert.throws(
  () => loadPlay({
    ...basePreviousPositionFixture,
    players: [{
      ...basePreviousPositionFixture.players[0],
      keyframes: [{t: 0, x: 20, y: 50}, {t: 1, from_previous: true, relative_to: 'p1', offset_m: {right: 1}}],
    }],
  }),
  /from_previous/,
);

assert.throws(
  () => loadPlay({
    ...basePreviousPositionFixture,
    players: [{
      ...basePreviousPositionFixture.players[0],
      keyframes: [{t: 0, x: 20, y: 50}, {t: 1, from_previous: true, x: 21, y: 50, offset_m: {right: 1}}],
    }],
  }),
  /from_previous/,
);

assert.throws(
  () => loadPlay({
    ...basePreviousPositionFixture,
    players: [{
      ...basePreviousPositionFixture.players[0],
      keyframes: [{t: 0, x: 20, y: 50}, {t: 1, from_previous: true}],
    }],
  }),
  /offset_m/,
);

const outOfFieldViewportPlay = loadPlay({
  schema_version: 1,
  title: 'Out Of Field Viewport Test',
  duration: 1,
  field: {width_m: 70, length_m: 100},
  viewport: {mode: 'auto', padding_m: 5},
  teams: [{id: 'attack', color: '#e95d4f'}],
  players: [{
    id: 'p1',
    number: 1,
    team: 'attack',
    keyframes: [{t: 0, x: 35, y: 50}, {t: 1, x: 75, y: 110}],
  }],
  ball: {starts_with: 'p1', events: []},
});
assert.deepEqual(
  getViewportBounds(outOfFieldViewportPlay),
  {left: 30, right: 80, top: 45, bottom: 115},
  'auto viewport should expand beyond field bounds to keep all players visible',
);

const fixedViewportPlay = loadPlay({
  ...basePreviousPositionFixture,
  viewport: {mode: 'fixed', padding_m: 5, center: {x: 40, y: 60}, size: {x: 20, y: 30}},
});
assert.deepEqual(
  getViewportBounds(fixedViewportPlay),
  {left: 30, right: 50, top: 45, bottom: 75},
  'fixed viewport should preserve authored bounds',
);

// loadPlay() validates several top-level fields only after players/teams
// resolve successfully, so every error-case fixture below still needs a
// valid players/teams/ball shape to reach the check under test.
assert.throws(
  () => loadPlay({...basePreviousPositionFixture, schema_version: 2}),
  /Unsupported schema_version/,
);

assert.throws(
  () => loadPlay({...basePreviousPositionFixture, ball: {events: []}}),
  /Play must define ball\.starts_with/,
);

assert.throws(
  () => loadPlay({...basePreviousPositionFixture, viewport: {mode: 'cinematic', padding_m: 1}}),
  /Play must define viewport\.mode as auto or fixed/,
);

const tooManyPlayers = Array.from({length: 31}, (_, index) => ({
  id: `p${index}`,
  number: index,
  team: 'attack',
  keyframes: [{t: 0, x: index, y: 0}],
}));
assert.throws(
  () => loadPlay({
    schema_version: 1,
    title: 'Too Many Players Test',
    duration: 1,
    field: {width_m: 70, length_m: 100},
    viewport: {mode: 'auto', padding_m: 1},
    teams: [{id: 'attack', color: '#e95d4f'}],
    players: tooManyPlayers,
    ball: {starts_with: 'p0', events: []},
  }),
  /A play cannot contain more than 30 players/,
);

// Ball events must chain from the actual current carrier, even though this
// check never looks at whether from/to are real player ids (see the
// unknown-player test below for that separate failure mode).
assert.throws(
  () => loadPlay({
    ...basePreviousPositionFixture,
    ball: {starts_with: 'p1', events: [{type: 'pass', from: 'p2', to: 'p1', t: 0, duration: 0.5}]},
  }),
  /does not match the current carrier/,
);

// A later keyframe with no x/y, relative_to, or from_previous holds the
// previous resolved position, chaining through consecutive held keyframes.
const holdPreviousPlay = loadPlay({
  schema_version: 1,
  title: 'Hold Previous Test',
  duration: 4,
  field: {width_m: 70, length_m: 100},
  viewport: {mode: 'auto', padding_m: 1},
  teams: [{id: 'attack', color: '#e95d4f'}],
  players: [{
    id: 'p1',
    number: 1,
    team: 'attack',
    keyframes: [{t: 0, x: 10, y: 20}, {t: 2}, {t: 4}],
  }],
  ball: {starts_with: 'p1', events: []},
});
const holdPreviousPlayer = holdPreviousPlay.players[0];
assert.deepEqual(pointAt(holdPreviousPlayer, 2), {x: 10, y: 20});
assert.deepEqual(pointAt(holdPreviousPlayer, 4), {x: 10, y: 20});

// A fixed viewport missing center/size has nothing to preserve, so it falls
// back to the same auto-computed bounds as viewport.mode: "auto".
const fixedNoSizePlay = loadPlay({
  schema_version: 1,
  title: 'Fixed Without Size Test',
  duration: 1,
  field: {width_m: 70, length_m: 100},
  viewport: {mode: 'fixed', padding_m: 5},
  teams: [{id: 'attack', color: '#e95d4f'}],
  players: [{id: 'p1', number: 1, team: 'attack', keyframes: [{t: 0, x: 10, y: 20}]}],
  ball: {starts_with: 'p1', events: []},
});
assert.deepEqual(
  getViewportBounds(fixedNoSizePlay),
  {left: 5, right: 15, top: 15, bottom: 25},
);

// A ball event's to/from are only resolved against real players lazily, so
// an unknown id fails once the gain line samples the ball position, not
// during the from/to carrier-chain check above.
assert.throws(
  () => loadPlay({
    schema_version: 1,
    title: 'Unknown Player Ball Test',
    duration: 2,
    field: {width_m: 70, length_m: 100},
    viewport: {mode: 'auto', padding_m: 1},
    teams: [{id: 'attack', color: '#e95d4f'}],
    players: [{id: 'p1', number: 1, team: 'attack', keyframes: [{t: 0, x: 10, y: 20}]}],
    ball: {starts_with: 'p1', events: [{type: 'pass', from: 'p1', to: 'p99', t: 0.5, duration: 0.5}]},
  }),
  /Unknown player p99/,
);

// The gain line snaps to the most recent keyframe at or before the sampled
// time; it never interpolates between two gain-line keyframes.
const fakeGainLinePlay = {field: {gainLine: [{t: 0, y: 10}, {t: 2, y: 20}, {t: 4, y: 30}]}};
assert.equal(gainLineYAt(fakeGainLinePlay, 0), 10);
assert.equal(gainLineYAt(fakeGainLinePlay, 1), 10);
assert.equal(gainLineYAt(fakeGainLinePlay, 2), 20);
assert.equal(gainLineYAt(fakeGainLinePlay, 3.9), 20);
assert.equal(gainLineYAt(fakeGainLinePlay, 4), 30);
assert.equal(gainLineYAt(fakeGainLinePlay, 100), 30);

// Multiple sequential passes must chain: the ball follows each carrier in
// turn rather than sticking with the first receiver forever.
const greenPlay = loadPlay((await import('../plays/pods/green-one.json', {with: {type: 'json'}})).default);
const [firstPass, secondPass] = greenPlay.ball.events;
const p9 = greenPlay.players.find(player => player.id === 'p9')!;
const p10 = greenPlay.players.find(player => player.id === 'p10')!;
const p1 = greenPlay.players.find(player => player.id === 'p1')!;
assert.deepEqual(ballPositionAt(greenPlay, 0), pointAt(p9, 0), 'ball starts with p9');
assert.deepEqual(
  ballPositionAt(greenPlay, firstPass.t + firstPass.duration),
  pointAt(p10, firstPass.t + firstPass.duration),
  'ball lands with p10 after the first pass',
);
assert.deepEqual(
  ballPositionAt(greenPlay, (firstPass.t + firstPass.duration + secondPass.t) / 2),
  pointAt(p10, (firstPass.t + firstPass.duration + secondPass.t) / 2),
  'ball still follows p10 between the two passes',
);
assert.deepEqual(
  ballPositionAt(greenPlay, secondPass.t + secondPass.duration),
  pointAt(p1, secondPass.t + secondPass.duration),
  'ball lands with p1 after the second pass',
);
assert.deepEqual(
  ballPositionAt(greenPlay, greenPlay.duration),
  pointAt(p1, greenPlay.duration),
  'ball stays with p1 for the rest of the play',
);

console.log(`play trajectory checks passed (${sampleTimes.length} sampled frames)`);
