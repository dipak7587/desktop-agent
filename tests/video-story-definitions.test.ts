import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { CustomToolService } from '../src/main/services/tools/custom';
import { validateWorkflow, workflowEdges } from '../src/shared/workflows';
it('loads reusable video workflows with complete upstream context and runs the timing tool', async () => {
  const root = resolve('examples/video-story-studio/definitions');
  const library = new LibraryService(root);
  const agents = await library.list('agents');
  expect(agents).toHaveLength(6);
  expect(await library.list('mcp')).toHaveLength(1);
  for (const id of ['video-discover-stories', 'video-produce-story']) {
    const workflow = validateWorkflow(
      JSON.parse(await readFile(resolve(root, `workflows/${id}.json`), 'utf8')),
    );
    for (const node of workflow.agents)
      expect(agents.some((a) => a.id === node.agentId)).toBe(true);
    if (id === 'video-produce-story')
      expect(
        workflowEdges(workflow)
          .filter((e) => e.to === 'scenes')
          .map((e) => e.from),
      ).toEqual(['story', 'characters', 'style', 'narration']);
  }
  const tools = new CustomToolService(library, { resolve: () => '', redact: (s) => s }, () => 5000);
  const result = JSON.parse(
    await tools.run('video-timing-plan', { duration_seconds: 60, clip_seconds: 10 }),
  );
  expect(result.total_clips).toBe(6);
  expect(result.scenes[5].end_seconds).toBe(60);
});
