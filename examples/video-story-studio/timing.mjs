export function planVideoTiming(input) {
  const { duration_seconds: duration, clip_seconds: clip } = input;
  const wpm = input.words_per_minute ?? 120;
  if (!Number.isInteger(duration) || duration < 10 || duration > 600)
    throw new Error('Duration must be an integer between 10 and 600 seconds.');
  if (![4, 6, 8, 10].includes(clip))
    throw new Error('Choose 4, 6, 8, or 10 seconds per generated clip.');
  if (!Number.isFinite(wpm) || wpm < 60 || wpm > 180)
    throw new Error('Narration pace must be 60–180 words/minute.');
  const count = Math.ceil(duration / clip);
  const scenes = Array.from({ length: count }, (_, i) => {
    const seconds = Math.min(clip, duration - i * clip);
    return {
      scene: i + 1,
      start_seconds: i * clip,
      end_seconds: i * clip + seconds,
      edit_seconds: seconds,
      generate_seconds: clip,
      narration_word_budget: Math.floor(((seconds * wpm) / 60) * 0.85),
      trim_seconds: clip - seconds,
    };
  });
  return {
    duration_seconds: duration,
    clip_seconds: clip,
    words_per_minute: wpm,
    total_clips: count,
    total_narration_word_budget: scenes.reduce((sum, s) => sum + s.narration_word_budget, 0),
    note: 'Word budgets reserve 15% for pauses; estimates, not measured audio. Record and check voice timing before final edit.',
    scenes,
  };
}
