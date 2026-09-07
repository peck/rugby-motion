import {defineConfig} from 'vite';
import motionCanvasModule from '@motion-canvas/vite-plugin';
import ffmpegModule from '@motion-canvas/ffmpeg';

const motionCanvas = (motionCanvasModule as {default?: () => unknown}).default ?? motionCanvasModule;
const ffmpeg = (ffmpegModule as {default?: () => unknown}).default ?? ffmpegModule;

export default defineConfig({
  plugins: [motionCanvas(), ffmpeg()],
});
