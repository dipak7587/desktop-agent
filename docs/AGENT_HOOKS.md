# Agent Hooks

Hooks are reusable JavaScript or TypeScript scripts in the **Hooks** sidebar. Attach one or more
hooks to an agent in its definition; each hook has one lifecycle type:

Hook files are valid `.ts` source. Local Hook metadata is stored in a TypeScript comment at the
top of the file, so the source remains valid TypeScript and can be exported or edited directly.
Plain `.ts` files imported as Hooks use the filename as their name and default to the `pre` type.

- **pre** runs before the agent starts its work. A failure stops the run.
- **success** runs when the agent produces a completed result.
- **error** runs after a failed or max-iteration run and receives an `error` string.
- **post** runs after the other applicable phase for every outcome and receives `status`, and
  optionally `result` or `error`.

Each hook must export a default async function:

```ts
export default async function hook(context: {
  agent: { id: string; name: string };
  task: string;
  project: string;
  run: { id: string; status: string; iterationsUsed: number };
  result?: string;
  error?: string;
  status?: string;
}) {
  console.log(`Agent ${context.agent.name} finished with ${context.status}`);
}
```

Hooks receive the agent, task, project path, and run metadata. Success and post hooks can inspect
the result; error and post hooks can inspect the error. JavaScript and TypeScript are transpiled to
Node.js and run as trusted local code in a child process, with the configured command timeout and
output/context size limits. This is process isolation, not an operating-system security sandbox.
Hook code can use Node.js modules available from the project working directory.
