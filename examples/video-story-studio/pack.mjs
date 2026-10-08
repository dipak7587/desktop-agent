import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { planVideoTiming } from './timing.mjs';
export function validatePack(pack) {
  const plan = planVideoTiming(pack);
  if (!Array.isArray(pack.scenes) || pack.scenes.length !== plan.total_clips)
    throw new Error(`Expected ${plan.total_clips} scenes.`);
  for (const key of [
    'title',
    'source_url',
    'rights_note',
    'story',
    'characters',
    'visual_style',
    'narrator',
  ])
    if (typeof pack[key] !== 'string' || !pack[key].trim()) throw new Error(`Missing ${key}.`);
  if (!/^https:\/\/en\.wikisource\.org\/wiki\//.test(pack.source_url))
    throw new Error('Use the verified Wikisource source URL.');
  pack.scenes.forEach((scene, i) => {
    if (!scene.flow_prompt?.trim() || typeof scene.narration !== 'string')
      throw new Error(`Scene ${i + 1} needs a prompt and narration string.`);
    const words = scene.narration.trim() ? scene.narration.trim().split(/\s+/u).length : 0;
    if (words > plan.scenes[i].narration_word_budget)
      throw new Error(
        `Scene ${i + 1}: ${words} narration words exceed budget ${plan.scenes[i].narration_word_budget}. Shorten narration.`,
      );
  });
  return {
    ...pack,
    timing: plan,
    scenes: pack.scenes.map((s, i) => ({ ...s, ...plan.scenes[i] })),
  };
}
export async function savePack(root, input) {
  const pack = validatePack(input);
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  const sections = [
    `# ${pack.title}`,
    `Source: ${pack.source_url}`,
    `Rights/edition: ${pack.rights_note}`,
    `## Story\n${pack.story}`,
    `## Characters and reference images\n${pack.characters}`,
    `## Visual direction\n${pack.visual_style}`,
    `## Narrator\n${pack.narrator}`,
    `## Timing\n${pack.duration_seconds}s total; ${pack.clip_seconds}s generated clips. ${pack.timing.note}`,
  ];
  for (const scene of pack.scenes)
    sections.push(
      `## Scene ${scene.scene} · ${scene.start_seconds}–${scene.end_seconds}s\nGenerate ${scene.generate_seconds}s; trim ${scene.trim_seconds}s.\n\nNarration: ${scene.narration}\n\nGoogle Flow prompt:\n${scene.flow_prompt}\n\nContinuity: ${scene.continuity || ''}`,
    );
  sections.push(
    '## Production checklist\nGenerate consistent character reference images first. Reuse the same references, costume, voice and visual style across clips. Generate each clip in Flow, record or generate narration, verify actual speech timing, trim as specified, assemble, add captions, and review. This pack contains prompts and a script, not rendered video or audio.',
  );
  await writeFile(join(directory, 'video-pack.md'), sections.join('\n\n') + '\n', { flag: 'wx' });
  await writeFile(join(directory, 'video-pack.json'), JSON.stringify(pack, null, 2) + '\n', {
    flag: 'wx',
  });
  return {
    id,
    markdown_path: join(directory, 'video-pack.md'),
    json_path: join(directory, 'video-pack.json'),
    scenes: pack.scenes.length,
  };
}
export async function listPacks(root) {
  let names;
  try {
    names = await readdir(root);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const results = [];
  for (const name of names.sort().reverse().slice(0, 50)) {
    try {
      const pack = JSON.parse(await readFile(join(root, name, 'video-pack.json'), 'utf8'));
      results.push({ id: name, title: pack.title, source_url: pack.source_url });
    } catch {
      /* Ignore incomplete exports. */
    }
  }
  return results;
}
