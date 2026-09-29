import { z } from 'zod';

export const defaultSuggestions = [
  {
    icon: 'code' as const,
    title: 'Build something',
    text: 'Help me plan a new application. Ask me about the requirements first.',
  },
  {
    icon: 'book' as const,
    title: 'Explore your knowledge',
    text: 'Summarize the key ideas in the selected knowledge sources.',
  },
  {
    icon: 'terminal' as const,
    title: 'Think it through',
    text: 'Help me reason through a technical decision. Ask me what I am working on.',
  },
];
export const landingSchema = z.object({
  eyebrow: z.string().trim().max(100).default('YOUR LOCAL INTELLIGENCE'),
  title: z.string().trim().min(1).max(160).default('Good ideas start here.'),
  description: z
    .string()
    .max(1000)
    .default(
      'Talk to your models. Bring your knowledge.\nChoose a local model or your connected provider.',
    ),
  logo: z
    .string()
    .max(1_400_000)
    .refine(
      (value) =>
        value === '' || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
      'Choose a PNG, JPEG, or WebP logo up to 1 MB.',
    )
    .default(''),
  suggestions: z
    .array(
      z.object({
        icon: z.enum(['code', 'book', 'terminal']),
        title: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(1000),
      }),
    )
    .length(3)
    .default(() => defaultSuggestions.map((item) => ({ ...item }))),
});
export type LandingSettings = z.infer<typeof landingSchema>;
export const defaultLanding = landingSchema.parse({});
