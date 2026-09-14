import {parseAllDocuments, visit} from 'yaml';

// YAML 1.2 is a JSON superset, so this one strict parser covers both formats
// while plays migrate. Constructs that make a play file ambiguous to read --
// duplicate keys, multiple documents, custom tags, aliases/merges -- are
// rejected rather than silently resolved.
export const parsePlaySource = (source: string, playPath: string): unknown => {
  const fail = (message: string): never => {
    throw new Error(`${playPath}: ${message}`);
  };

  const documents = parseAllDocuments(source, {uniqueKeys: true, merge: false});
  if (documents.length === 0) fail('file is empty');
  if (documents.length > 1) {
    fail(`expected a single document, found ${documents.length}`);
  }

  const [document] = documents;
  if (document.errors.length > 0) fail(document.errors[0].message);
  if (document.warnings.length > 0) fail(document.warnings[0].message);
  if (document.contents === null) fail('file is empty');

  visit(document, {
    Alias: () => fail('YAML aliases and merge keys are not supported'),
  });

  return document.toJS();
};
