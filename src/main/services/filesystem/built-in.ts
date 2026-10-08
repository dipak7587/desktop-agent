import { join } from 'node:path';
import { z } from 'zod';
import { settingsSchema } from '../../../shared/schemas';
import { landingSchema } from '../../../shared/landing';
import { readJSON } from './storage';

// Only presentation and startup preferences belong in the distributable defaults.
const generalSchema = z
  .object({
    appName: settingsSchema.shape.appName,
    appLogo: settingsSchema.shape.appLogo,
    theme: settingsSchema.shape.theme,
    language: settingsSchema.shape.language,
    startAtLogin: settingsSchema.shape.startAtLogin,
    defaultAgent: settingsSchema.shape.defaultAgent,
  })
  .strict();

export async function readBuiltInDefaults(root: string) {
  const [general, landing] = await Promise.all([
    readJSON(join(root, 'general.json'), {}),
    readJSON(join(root, 'landing.json'), {}),
  ]);
  return { ...generalSchema.parse(general), landing: landingSchema.parse(landing) };
}
