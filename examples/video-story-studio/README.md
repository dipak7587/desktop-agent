# Video Story Studio — reusable desktop workflows

Installed components: **one MCP server**, **one custom timing Tool**, **six agents**,
and **two workflows**. Uses the configured local Ollama model; no search API key.
Story discovery performs new live Wikisource searches on every run. A single research call collects complete short-story candidates and shared edition evidence; repeated edition metadata is cached for five minutes to reduce source-site load. “Top five”
means ranked for your video brief, not a measured internet popularity ranking.

## Run from the UI every time you make a video

1. Open **MCP → Video Story Studio → Start**. Its five tools should appear.
2. Open **Workflows → Video 1 · Discover five stories → Run workflow**.
3. Enter your discovery brief, for example:

   ```text
   Find five short nature-themed moral stories for a family-friendly animated video.
   Narration: Hindi. Duration: 60 seconds. Clip length: 10 seconds.
   Aspect ratio: 9:16. Avoid previously produced stories.
   ```

4. Expand the run and its agent execution history. Approve the research operations.
   Read the Markdown report: a production brief followed by numbered story headings
   (`## 1. Title` through `## 5. Title`), source links, adaptation reasons and edition/rights notes.
5. Choose a story yourself. Open **Video 2 · Produce selected story → Run workflow**.
   Copy the **entire Markdown output** from Video 1 and paste it into the task.
   Add your choice on a separate line above or below it, for example:

   ```text
   Option 2

   [Paste the entire Video 1 Markdown report here]
   ```

   Use one number: `Option 1`, `Option 2`, `Option 3`, `Option 4`, or `Option 5`.
   Video 2 takes the title and source URL from that numbered option and inherits
   the report's narration language, timing, aspect ratio and other settings.
   To change settings, add explicit overrides alongside your choice:

   ```text
   Option 3
   Visual style: warm stylized 3D animation, natural forest setting
   Narration language: Hindi

   [Paste the entire Video 1 Markdown report here]
   ```

   This also works from Chat using `/workflow` to select Video 2. You can still
   provide `Selected story: ...` and `Source URL: ...` directly if preferred.

6. Approve the source-read, timing and local-export operations when requested.
   No project folder is needed. The five production agents run in order; every
   later stage receives all earlier outputs, keeping source, characters and timing together.
7. Open the final saved `video-pack.md`. It contains story, character reference-image
   prompts, style, narrator direction, and one Flow prompt + narration per scene.
   The JSON version contains the same pack and exact timing fields.

This is a deliberate two-workflow handoff: the current app does not have clickable
story cards or a mid-workflow selection form. Choosing a number alone does not carry
another run's context: paste the **entire numbered Markdown report plus your choice**
into production. Missing, ambiguous or unavailable choices are blocked rather than guessed.
If a prerequisite is missing, the agents are instructed to report BLOCKED. The generic
workflow engine may still label such a text response “completed”; inspect its output.

## Agents

| Agent                        | Result                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| Video 1 · Story scout        | Five sourced choices; no automatic selection                         |
| Video 2 · Story writer       | Full adaptation, story beats, source and timing plan                 |
| Video 3 · Characters         | Consistent character designs and reference-image prompts             |
| Video 4 · Visual director    | Animation/live action, environment/nature, palette, lighting, camera |
| Video 5 · Narrator           | Voice direction and scene-by-scene narration                         |
| Video 6 · Flow scene planner | Timed prompts, continuity and versioned export                       |

## Google Flow timing

**60 seconds / 10 seconds = 6 clips.** Each clip has one achievable action, camera
instructions, repeated character descriptions, a start/end frame, ambience, and
separate narration. The calculator reserves 15% of each slot for pauses. Actual
speech timing must be checked after recording/TTS, especially across languages.
For a 65-second edit, generate seven 10-second clips and trim the last to 5 seconds.

As checked on 2026-09-29, Google's documentation lists 4/6/8/10-second clips for
Gemini Omni Flash 1.1, and 4/6/8 seconds for Veo 3.1. Choose the matching clip length
in the task and Flow. [Official Flow model guide](https://support.google.com/flow/answer/16352836?hl=en).

The app creates a production pack. It does **not** automatically generate character
images, synthesize narration, submit paid generations to Flow, or assemble the final
video. Use the saved prompts in Flow, reuse character references, generate clips,
record/generate the narration separately, then trim and assemble in your video editor.

## Persistence and source scope

Each export gets a new timestamp/ID directory. Existing projects are never overwritten.
The scout can consult the latest 50 completed packs to avoid repeating produced sources.
Unselected discovery suggestions are not permanently excluded. The app stores workflow
and agent execution history separately.

On this machine, installed packs are written under:

```text
~/Library/Application Support/local-ai-workspace/video-projects/<timestamp-id>/
  video-pack.md
  video-pack.json
```

Research currently uses **English Wikisource classic fiction/folktales**, with a
configurable narration language. It does not search all news sites or rank trending
news. The reader includes source text and parent-edition evidence, rejects unrelated
URLs, and reports truncated stories. The agents must not invent missing endings or
claim public-domain status solely because a page is publicly accessible.

## Install on another checkout

From the repository root after `pnpm install`:

```sh
node examples/video-story-studio/setup.mjs --install "/path/to/app-data-directory"
```

Find that directory in Settings. Installation uses an existing enabled local Ollama
provider with `qwen3-coder:latest` (or set `OLLAMA_MODEL` to another installed tool-capable
model). It preserves existing definitions with the same IDs. Reload/reopen the app
after installation. `setup.mjs` without `--install` only generates definitions beside
this README; their default export root is `~/LocalAI-Video-Packs`.

## Validation

```sh
node --test examples/video-story-studio/studio.test.mjs
VIDEO_LIVE_TEST=1 node --test examples/video-story-studio/studio.test.mjs
pnpm exec vitest run tests/video-story-definitions.test.ts
```

Tests cover MCP discovery, live search/read (opt-in), source URL restriction, duration
and remainder calculations, narration budget rejection, distinct exports, saved-project
listing, desktop schema compatibility and execution of the custom timing Tool.
