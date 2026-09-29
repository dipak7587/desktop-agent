import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLanding, landingSchema } from '../src/shared/landing';
import { settingsSchema } from '../src/shared/schemas';
import { SettingsService } from '../src/main/services/settings/settings';

it('defaults existing settings and persists customized landing content after restart', async () => {
  expect(settingsSchema.parse({}).landing).toEqual(defaultLanding);
  const root = await mkdtemp(join(tmpdir(), 'landing-settings-'));
  try {
    const settings = new SettingsService(root);
    await settings.init();
    const landing = landingSchema.parse({
      title: 'Video Studio',
      eyebrow: 'MAKE SOMETHING',
      description: 'Pick a story.\nCreate a video.',
      logo: 'data:image/png;base64,aGVsbG8=',
      suggestions: defaultLanding.suggestions.map((item) => ({
        ...item,
        title: 'Write a story',
        text: 'Create a nature story.',
      })),
    });
    await settings.save({ ...settings.get(), landing });
    const restarted = new SettingsService(root);
    await restarted.init();
    expect(restarted.get().landing).toEqual(landing);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('validates landing content and restricts embedded logo formats and size', () => {
  for (const logo of [
    'https://example.com/logo.png',
    'file:///private/logo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,' + 'a'.repeat(1_400_001),
  ])
    expect(() => landingSchema.parse({ logo })).toThrow();
  expect(() => landingSchema.parse({ title: ' ' })).toThrow();
  expect(() => landingSchema.parse({ suggestions: [] })).toThrow();
  expect(() => landingSchema.parse({ description: 'x'.repeat(1001) })).toThrow();
});
