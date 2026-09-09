export type Point = {x: number; y: number};

export type RelativeOffset = {
  forward?: number;
  behind?: number;
  right?: number;
  left?: number;
};

export type Keyframe = {
  t: number;
  x?: number;
  y?: number;
  relative_to?: string;
  from_previous?: boolean;
  offset_m?: RelativeOffset;
  ease?: 'linear' | 'ease_in_out';
};

export type Team = {
  id: string;
  color: string;
};

export type Player = {
  id: string;
  number: number;
  team: string;
  keyframes: Keyframe[];
};

export type PassEvent = {
  type: 'pass';
  from: string;
  to: string;
  t: number;
  duration: number;
  curve?: 'straight';
};

export type Ball = {
  starts_with: string;
  events: PassEvent[];
};

export type Viewport = {
  mode: 'auto' | 'fixed';
  padding_m: number;
  center?: Point;
  size?: Point;
};

// A gain-line keyframe is never an authored coordinate: it always resolves
// to wherever the ball is at time `t` (see loadPlay's resolveGainLine). It
// never eases between keyframes either — it snaps, since it is always
// exactly the ball's position, never an independently animated path.
export type GainLineKeyframe = {
  t: number;
};

export type ResolvedGainLineKeyframe = {
  t: number;
  y: number;
};

export type Play = {
  schema_version: number;
  title: string;
  subtitle?: string;
  duration: number;
  field: {
    width_m: number;
    length_m: number;
    gain_line?: GainLineKeyframe[];
    show_markings?: string[];
  };
  viewport: Viewport;
  teams: Team[];
  players: Player[];
  ball: Ball;
};

export type ResolvedPlayer = Player & {
  keyframes: Array<Keyframe & {x: number; y: number}>;
};

export type ResolvedPlay = Omit<Play, 'players' | 'field'> & {
  players: ResolvedPlayer[];
  field: Play['field'] & {gainLine: ResolvedGainLineKeyframe[]};
};
