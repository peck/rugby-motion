import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

import {loadPlay} from '../src/play/loadPlay.ts';
import type {Play} from '../src/play/types.ts';

const root = resolve(import.meta.dirname, '..');
const playsDirectory = join(root, 'plays');
const outputDirectory = join(root, 'output', 'rugby-motion');
const renderedVideoPath = join(root, 'output', 'project.mp4');
const exportDirectory = join(root, 'out');
const port = 4173;
const fps = 60;
const tailSeconds = 1.5;
const renderProgressInterval = 1000;
const stableVideoWindow = 2000;

type PlayEntry = {
  fileName: string;
  play: ReturnType<typeof loadPlay>;
};

const findPlayFiles = (directory: string): string[] =>
  readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return findPlayFiles(filePath);
    return entry.isFile() && entry.name.endsWith('.json') ? [filePath] : [];
  });

const playPathFromFilePath = (filePath: string) =>
  relative(playsDirectory, filePath).split(sep).join('/').replace(/\.json$/, '');

const readPlayLibrary = (): PlayEntry[] =>
  findPlayFiles(playsDirectory)
    .sort()
    .map(filePath => ({
      fileName: playPathFromFilePath(filePath),
      play: loadPlay(JSON.parse(readFileSync(filePath, 'utf8')) as Play),
    }));

const parseArgs = () => ({
  dryRun: process.argv.includes('--dry-run'),
  requestedPlay: process.argv.find(argument => argument.startsWith('--play='))?.slice(7),
});

const isServerReady = async (url: string) => {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async (url: string) => {
  console.log(`Waiting for Vite at ${url}...`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerReady(url)) {
      console.log(`Vite is ready at ${url}`);
      return;
    }
    await delay(200);
  }
  throw new Error(`Vite did not become ready at ${url}`);
};

const startServer = (): ChildProcess =>
  spawn('node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    detached: true,
  });

const probeDuration = async (filePath: string): Promise<number> => {
  const child = spawn('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], {cwd: root});
  let stdout = '';
  child.stdout.on('data', chunk => (stdout += chunk.toString()));
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`ffprobe failed to read ${filePath}`);
  return Number.parseFloat(stdout.trim());
};

const waitForRenderedVideo = async (entry: PlayEntry) => {
  const expectedDuration = entry.play.duration + tailSeconds;
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastProgressAt = 0;
  let lastSize = -1;
  let lastChangedAt = Date.now();

  while (Date.now() < deadline) {
    const now = Date.now();
    if (existsSync(renderedVideoPath)) {
      const size = statSync(renderedVideoPath).size;
      if (size !== lastSize) lastChangedAt = now;
      if (size !== lastSize && now - lastProgressAt >= renderProgressInterval) {
        console.log(`[${entry.fileName}] Rendered video is ${size} bytes...`);
        lastProgressAt = now;
      }
      lastSize = size;

      try {
        const actualDuration = await probeDuration(renderedVideoPath);
        if (size > 48 && Number.isFinite(actualDuration) && now - lastChangedAt >= stableVideoWindow) {
          if (Math.abs(actualDuration - expectedDuration) > 0.2) {
            console.warn(
              `[${entry.fileName}] Video duration ${actualDuration.toFixed(2)}s differs from expected ~${expectedDuration.toFixed(2)}s`,
            );
          }
          console.log(`[${entry.fileName}] Video render complete: ${actualDuration.toFixed(2)}s`);
          return actualDuration;
        }
      } catch {
        // ffprobe can fail while ffmpeg is still writing the file.
      }
    } else if (now - lastProgressAt >= renderProgressInterval) {
      console.log(`[${entry.fileName}] Waiting for output/project.mp4...`);
      lastProgressAt = now;
    }

    await delay(500);
  }
  throw new Error(`Timed out waiting for ${renderedVideoPath}`);
};

const renderPlay = async (entry: PlayEntry, browser: Awaited<ReturnType<typeof chromium.launch>>) => {
  rmSync(outputDirectory, {recursive: true, force: true});
  rmSync(renderedVideoPath, {force: true});
  mkdirSync(outputDirectory, {recursive: true});

  const expectedFrames = Math.ceil((entry.play.duration + tailSeconds) * fps);
  const page = await browser.newPage();
  page.on('console', message => {
    if (message.type() === 'error') console.error(`[browser] ${message.text()}`);
  });
  page.on('pageerror', error => console.error(`[browser] ${error.message}`));
  try {
    console.log(`[${entry.fileName}] Opening Motion Canvas page...`);
    await page.goto(`http://127.0.0.1:${port}/?play=${encodeURIComponent(entry.fileName)}`, {waitUntil: 'domcontentloaded'});
    const renderButton = page.getByRole('button', {name: 'Render', exact: true});
    console.log(`[${entry.fileName}] Waiting for Render button...`);
    await renderButton.waitFor({state: 'visible', timeout: 30000});
    console.log(`[${entry.fileName}] Starting render for about ${expectedFrames} frames...`);
    await renderButton.click();
    return await waitForRenderedVideo(entry);
  } finally {
    await page.close();
  }
};

const main = async () => {
  const {dryRun, requestedPlay} = parseArgs();
  const allPlays = readPlayLibrary();
  const plays = requestedPlay
    ? allPlays.filter(entry => entry.fileName === requestedPlay)
    : allPlays;
  if (plays.length === 0) throw new Error(`No play found for --play=${requestedPlay}`);

  for (const entry of plays) {
    const expectedFrames = Math.ceil((entry.play.duration + tailSeconds) * fps);
    console.log(`${entry.fileName}: ${entry.play.duration}s play, about ${expectedFrames} frames -> out/${entry.fileName}.mp4`);
  }
  if (dryRun) return;

  mkdirSync(exportDirectory, {recursive: true});
  const serverUrl = `http://127.0.0.1:${port}/`;
  const server = await isServerReady(serverUrl) ? undefined : startServer();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForServer(serverUrl);
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    });
    for (const entry of plays) {
      console.log(`Rendering ${entry.fileName}...`);
      const actualDuration = await renderPlay(entry, browser);
      const outputPath = join(exportDirectory, `${entry.fileName}.mp4`);
      mkdirSync(dirname(outputPath), {recursive: true});
      rmSync(outputPath, {force: true});
      renameSync(renderedVideoPath, outputPath);
      console.log(`Created ${outputPath} (${statSync(outputPath).size} bytes, ${actualDuration.toFixed(2)}s)`);
    }
  } finally {
    await browser?.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        server.kill();
      }
    }
  }
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

