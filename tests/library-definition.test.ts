import { expect, it } from 'vitest';
import {
  parseLibraryDefinition,
  stringifyLibraryDefinition,
} from '../src/shared/library-definition';
import { librarySchema } from '../src/shared/schemas';

it('parses JSON and YAML definitions and preserves fields when switching formats', () => {
  const json = parseLibraryDefinition(
    '{"name":"JSON skill","description":"From JSON","content":"Instructions"}',
    'json',
    'skills',
  );
  const yaml = parseLibraryDefinition(
    'name: YAML skill\ndescription: From YAML\ncontent: Instructions\nenabled: false\n',
    'yaml',
    'skills',
  );
  const markdown = parseLibraryDefinition(
    '---\nname: Markdown skill\ndescription: From Markdown\n---\n# Instructions\nUse the Markdown body.\n',
    'md',
    'skills',
  );
  const normalized = librarySchema.parse({ ...json, id: 'skill' });
  const markdownItem = librarySchema.parse({ ...markdown, id: 'markdown-skill' });

  expect(json).toMatchObject({ name: 'JSON skill', content: 'Instructions' });
  expect(yaml).toMatchObject({ name: 'YAML skill', enabled: false });
  expect(markdown).toMatchObject({
    name: 'Markdown skill',
    content: '# Instructions\nUse the Markdown body.',
  });
  expect(
    parseLibraryDefinition(stringifyLibraryDefinition(normalized, 'yaml'), 'yaml', 'skills'),
  ).toMatchObject({ name: 'JSON skill', content: 'Instructions' });
  expect(
    parseLibraryDefinition(stringifyLibraryDefinition(markdownItem, 'md'), 'md', 'skills'),
  ).toMatchObject({ name: 'Markdown skill', content: '# Instructions\nUse the Markdown body.' });
});

it('accepts direct MCP definitions and one-server MCP JSON or YAML wrappers', () => {
  expect(
    parseLibraryDefinition(
      'name: Files\ndescription: Project files\ncommand: node\nargs:\n  - server.js\nenv:\n  MODE: test\n',
      'yaml',
      'mcp',
    ),
  ).toMatchObject({ name: 'Files', command: 'node', args: ['server.js'] });
  expect(
    parseLibraryDefinition(
      JSON.stringify({ mcpServers: { 'Project files': { command: 'node', args: ['server.js'] } } }),
      'json',
      'mcp',
    ),
  ).toMatchObject({ name: 'Project files', command: 'node', args: ['server.js'] });
  expect(() => parseLibraryDefinition('mcpServers: {}', 'yaml', 'mcp')).toThrow(
    'exactly one server',
  );
});

it('rejects malformed text and non-object definitions', () => {
  expect(() => parseLibraryDefinition('{', 'json', 'agents')).toThrow('valid JSON');
  expect(() => parseLibraryDefinition('- one\n- two', 'yaml', 'tools')).toThrow(
    'must be an object',
  );
  expect(() => parseLibraryDefinition('Missing frontmatter', 'md', 'skills')).toThrow(
    'valid YAML frontmatter',
  );
});
