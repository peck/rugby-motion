import {loadPlay} from './loadPlay';
import type {Play, ResolvedPlay} from './types';

type JsonModule = {default: unknown};

export type LibraryPlay = {
  fileName: string;
  play: ResolvedPlay;
};

const modules = import.meta.glob('../../plays/*.json', {
  eager: true,
}) as Record<string, JsonModule>;

export const playLibrary: LibraryPlay[] = Object.entries(modules)
  .map(([path, module]) => ({
    fileName: path.split('/').pop()!.replace(/\.json$/, ''),
    play: loadPlay(module.default as Play),
  }))
  .sort((first, second) => first.play.title.localeCompare(second.play.title));

if (playLibrary.length === 0) {
  throw new Error('No play files found in plays/*.json');
}

// Each play is a fully independent file; its own `id`/player ids are scoped
// to that play only, not a cross-play namespace, so filenames (which the
// filesystem already keeps unique) are the sole library-level identity.
