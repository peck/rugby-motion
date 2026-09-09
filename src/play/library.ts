import {loadPlay} from './loadPlay';
import type {Play, ResolvedPlay} from './types';

type JsonModule = {default: unknown};

export type LibraryPlay = {
  fileName: string;
  play: ResolvedPlay;
};

const modules = import.meta.glob('../../plays/**/*.json', {
  eager: true,
}) as Record<string, JsonModule>;

const playPathFromModulePath = (path: string) =>
  path.replace(/^\.\.\/\.\.\/plays\//, '').replace(/\.json$/, '');

export const playLibrary: LibraryPlay[] = Object.entries(modules)
  .map(([path, module]) => ({
    fileName: playPathFromModulePath(path),
    play: loadPlay(module.default as Play),
  }))
  .sort((first, second) => first.play.title.localeCompare(second.play.title));

if (playLibrary.length === 0) {
  throw new Error('No play files found in plays/**/*.json');
}

// Each play is a fully independent file; player ids are scoped to that play
// only, and the relative path under plays/ is the library-level identity.
