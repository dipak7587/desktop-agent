import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execPath, env } from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { planVideoTiming } from './timing.mjs';
import { validatePack } from './pack.mjs';
const sample = {
  title: 'Test pack',
  source_url: 'https://en.wikisource.org/wiki/Test',
  rights_note: 'Synthetic test fixture, not a sourced production story.',
  duration_seconds: 23,
  clip_seconds: 10,
  words_per_minute: 120,
  story: 'Test story',
  characters: 'Test character',
  visual_style: 'Watercolor',
  narrator: 'Warm voice',
  scenes: [
    { narration: 'A beginning.', flow_prompt: 'A meadow.' },
    { narration: 'A conflict.', flow_prompt: 'A storm.' },
    { narration: 'Peace returns.', flow_prompt: 'Sunshine.' },
  ],
};
test('timing covers requested duration exactly and exposes final clip trim', () => {
  const plan = planVideoTiming(sample);
  assert.equal(plan.total_clips, 3);
  assert.deepEqual(
    plan.scenes.map((s) => s.edit_seconds),
    [10, 10, 3],
  );
  assert.equal(plan.scenes[2].trim_seconds, 7);
  assert.equal(plan.scenes[2].end_seconds, 23);
  assert.throws(() => planVideoTiming({ ...sample, clip_seconds: 9 }));
  assert.throws(() => planVideoTiming({ ...sample, duration_seconds: 0 }));
  assert.throws(() => validatePack({ ...sample, scenes: sample.scenes.slice(0, 2) }));
  assert.throws(() =>
    validatePack({
      ...sample,
      scenes: sample.scenes.map((s) => ({ ...s, narration: 'word '.repeat(50) })),
    }),
  );
});
test('MCP discovery, validated exports, persistence and repeat detection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-story-test-'));
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: execPath,
        args: [resolve('examples/video-story-studio/server.mjs'), root],
      }),
    );
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, r.content[0].text);
      return JSON.parse(r.content[0].text);
    };
    const a = await call('save_video_pack', sample);
    const b = await call('save_video_pack', sample);
    assert.notEqual(a.id, b.id);
    assert.match(await readFile(a.markdown_path, 'utf8'), /Scene 3 · 20–23s/);
    assert.equal((await call('list_video_projects', {})).length, 2);
    const denied = await client.callTool({
      name: 'read_story',
      arguments: { source_url: 'http://localhost/private' },
    });
    assert.equal(denied.isError, true);
    if (env.VIDEO_LIVE_TEST === '1') {
      const search = await call('search_stories', { query: '"The North Wind and the Sun"' });
      assert.ok(search.results.length > 0);
      const story = await call('read_story', { source_url: search.results[0].url });
      assert.equal(story.truncated, false);
      assert.ok(story.text.includes('Traveller'));
      assert.ok(story.edition_evidence);
    }
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
