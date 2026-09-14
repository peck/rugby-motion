import {loadPlay} from './loadPlay';
import {parsePlaySource} from './parsePlaySource.ts';
import type {Play, ResolvedPlay} from './types';

export type LibraryPlay = {
  fileName: string;
  play: ResolvedPlay;
};

// Imported raw so every play goes through the same parser the exporter uses.
const modules = import.meta.glob('../../plays/**/*.{yaml,yml}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const playPathFromModulePath = (path: string) =>
  path.replace(/^\.\.\/\.\.\/plays\//, '').replace(/\.ya?ml$/, '');

export const playLibrary: LibraryPlay[] = Object.entries(modules)
  .map(([modulePath, source]) => ({
    fileName: playPathFromModulePath(modulePath),
    play: loadPlay(parsePlaySource(source, playPathFromModulePath(modulePath)) as Play),
  }))
  .sort((first, second) => first.play.title.localeCompare(second.play.title));

if (playLibrary.length === 0) {
  throw new Error('No play files found in plays/**/*.{yaml,yml}');
}

// Each play is a fully independent file; player ids are scoped to that play
// only, and the relative path under plays/ is the library-level identity.
