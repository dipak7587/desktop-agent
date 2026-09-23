import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executeCustomTool } from '../src/main/services/crewai/custom';
import { newCrewCustomTool } from '../src/shared/crewai';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'crew-custom-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const run = (code: string, timeoutSeconds = 30, signal = new AbortController().signal) =>
  executeCustomTool(
    'python3',
    resolve('workers/crewai/custom_runner.py'),
    root,
    { ...newCrewCustomTool(), code, timeoutSeconds },
    { text: 'hello' },
    signal,
  );
it('returns structured results and bounded stdout without inheriting host secrets', async () => {
  process.env.CREW_TEST_SECRET = 'must-not-inherit';
  try {
    const output = JSON.parse(
      await run(
        'import os\ndef run(input):\n    print("x" * 25000)\n    return {"secret": os.getenv("CREW_TEST_SECRET"), "value": input["text"]}',
      ),
    );
    expect(output.result).toEqual({ secret: null, value: 'hello' });
    expect(output.stdout).toHaveLength(20000);
  } finally {
    delete process.env.CREW_TEST_SECRET;
  }
});
it('reports invalid Python, missing handlers and oversized results', async () => {
  await expect(run('invalid python syntax!')).rejects.toThrow('SyntaxError');
  await expect(run('x=1')).rejects.toThrow('run(input)');
  await expect(run('def run(input):\n    return "x" * 200001')).rejects.toThrow('exceeds');
});
it('rejects input before evaluating user code', async () => {
  const marker = join(root, 'not-created');
  await expect(
    executeCustomTool(
      'python3',
      resolve('workers/crewai/custom_runner.py'),
      root,
      { ...newCrewCustomTool(), code: `open(${JSON.stringify(marker)}, "w").write("bad")` },
      { text: 2 },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  await expect(readFile(marker)).rejects.toThrow();
});
it('terminates on timeout and cancellation', async () => {
  await expect(run('import time\ndef run(input):\n    time.sleep(20)', 1)).rejects.toThrow(
    'exceeded',
  );
  const controller = new AbortController();
  const pending = run('import time\ndef run(input):\n    time.sleep(20)', 30, controller.signal);
  setTimeout(() => controller.abort(new Error('User cancelled')), 100);
  await expect(pending).rejects.toThrow('User cancelled');
});
it('standalone runtime uses the same tool definition and validator', async () => {
  const script =
    'import json\nfrom custom_runtime import run_custom_tool\ntool=json.loads(__import__("sys").argv[1])\nprint(run_custom_tool(tool,{"text":"one two"}))';
  const result = await promisify(execFile)(
    'python3',
    ['-c', script, JSON.stringify(newCrewCustomTool())],
    { cwd: resolve('workers/crewai') },
  );
  expect(JSON.parse(result.stdout)).toMatchObject({ result: { words: 2 } });
});
