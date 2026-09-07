export const projectConfig = {
  canvas: {
    left: -960,
    top: -540,
    width: 1920,
    height: 1080,
  },
  // One constant meters-to-pixels scale shared by every play, so a given
  // real-world distance always renders at the same size regardless of
  // which play is selected (see SPEC.md §6 "fixed zoom" decision).
  pitchScale: 40,
  // Reserved top strip (in pixels) the pitch render area never enters, so
  // the title text can never overlap the pitch.
  titleSafeHeight: 180,
  typography: {
    family: 'Arial',
    titleSize: 52,
    titleColor: '#f3f6df',
    left: 56,
    top: 64,
  },
} as const;
