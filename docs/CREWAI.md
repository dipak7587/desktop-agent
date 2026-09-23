# CrewAI project builder

Status: Initial implementation, behind an opt-in feature flag.

## User requirement

Create a basic CrewAI application from this desktop app: create CrewAI agents,
define their task workflow, assign supported tools, run the crew, and export a
standalone Python project for further development. Provide a dedicated builder UI
rather than treating a CrewAI agent as a renamed built-in agent.

CrewAI must be unavailable unless the user enables it. Existing agents, Chat,
MCP, and built-in workflows keep their current implementations.

## Available in the first version

A **CrewAI Projects** sidebar entry appears after enabling CrewAI. The builder has
five sections:

| Section | Purpose |
| --- | --- |
| Overview | Project name, description, sequential process, total model-call budget, task sequence |
| Agents | Name, role, goal, backstory, provider/model, per-agent model-call budget |
| Tasks | Ordered tasks, assigned agent, instructions, expected output, explicit earlier-task context |
| Tools | Assign supported CrewAI BaseTools to individual agents |
| Runs | Task results, actual model-call counts, tool approvals/output, failures, cancellation |

**New crew project** starts with an analyst and a writer, with two connected tasks.
Users can add/remove agents and tasks, reorder tasks, duplicate projects, and
export the saved project. An assigned agent cannot be removed until its tasks are
reassigned. Context must reference earlier tasks; invalid dependencies are rejected.
A project can contain up to 20 agents and 50 tasks.

This version creates real CrewAI Agents, Tasks, BaseTools and a sequential Crew
when executed. It does not convert existing built-in agents or alter their runtime.
Crew agents are stored inside their project and are edited in the project's Agents
section. The built-in Workflows editor remains unchanged.

## Enable and set up

1. Open **Settings → General → CrewAI** and check **Enable CrewAI**.
2. Configure the **Python executable** for an isolated Python 3.10–3.13 environment
   containing `crewai==1.15.22`.
3. Save settings, then use **Check CrewAI runtime**.
4. Open **CrewAI Projects**, create a starter project, and select a configured
   provider/model for each agent.
5. Save and use **Run crew**. Enter the run input and select a folder if tools need it.
6. In Runs, approve or deny tool requests and inspect task results.

For development, create a local environment explicitly from the repository:

```sh
uv venv --python 3.13 .venv-crewai
uv pip install --python .venv-crewai/bin/python -r workers/crewai/requirements.txt
```

On Windows the executable is `.venv-crewai\Scripts\python.exe`. On macOS/Linux it
is `.venv-crewai/bin/python`; enter its absolute path in Settings. Python and CrewAI
are not installed automatically, bundled into the app, or checked during normal
startup. The app package includes its worker source templates as extra resources.

Enabling the flag alone does not establish runtime readiness. Missing Python,
incompatible Python/CrewAI versions, unavailable providers, and worker failures
produce errors; no simulated results or fallback to the built-in engine are used.

## Feature flag contract

- `crewAIEnabled` defaults to `false`, including for older settings files.
- `crewAIPython` defaults to `python3` and is used only for an explicit check/run.
- When disabled, the CrewAI sidebar entry is hidden. Normal startup does not load
  the CrewAI service/renderer modules or launch/probe Python.
- Main-process checks reject disabled create/edit/duplicate/export/check/run/approval
  requests, including stale UI and direct IPC calls.
- Disabling through Settings cancels active and queued crews and pending approvals.
- Project definitions and history remain on disk and reappear on re-enable.
  Read/delete history/definitions and stop operations do not require the flag.
- Settings import preserves the local flag and Python path. Imports cannot opt in
  or change the executable implicitly.
- Re-enabling never restarts cancelled runs. No background crew auto-start exists.

## Supported tools and permissions

| Tool | CrewAI name | Behavior |
| --- | --- | --- |
| Read file | `read_project_file` | Read a bounded text file from the selected folder |
| List files | `list_project_files` | List a bounded directory within the selected folder |
| Search text | `search_project_text` | Search project files for literal text |

These are application-owned implementations of CrewAI's `BaseTool` interface,
not the entire upstream `crewai-tools` catalog. The worker requests tools through
a host bridge. The host validates the active task, assigned agent, selected tool,
arguments, and picker-authorized folder before execution. Every call requires
explicit approval, independent of global full-auto settings.

The existing filesystem controls reject paths outside the folder, symbolic links,
protected credential files, and oversized/binary inputs. Tool output is redacted
using the app's known-secret redactor. A denied call returns a denial to the agent;
a stopped run cancels outstanding approvals and model requests.

Native application Tools, MCP, knowledge retrieval, and skills are not inherited by CrewAI in this version. They require separate
permission and runtime integration; they are never silently inherited from other
agents or treated as supported.

## Create your own Python tool

Open **CrewAI Projects → your project → Tools → Create custom tool**. The starter
counts words. Give it a unique Python-style name and description, define typed inputs
(string, number, boolean, object, array), and edit the synchronous implementation:

```python
def run(input):
    return {"words": len(input["text"].split())}
```

Select agents under **Available to**. Choose **Save and test tool** with JSON input,
then review the saved code and arguments in **Runs** and choose **Allow tool** or
**Deny tool**. Tests use no model; results and captured stdout appear in Tool output.
Agent calls use the same approval and validation path. Saving never evaluates Python.
Editing a project does not change code in a pending run: approval uses its saved snapshot.
Unassign a tool from all agents before removing it. History retains past definitions.

The app wraps each definition in a real CrewAI BaseTool with a typed Pydantic input
schema. Custom implementations are stored in `project.json` and exported alongside
`custom_runner.py` and `custom_runtime.py`; the standalone CLI also requests approval.
The code must return a JSON-serializable result. Async handlers are not supported.
Default timeout is 30 seconds, configurable from 1 to 120 seconds; Stop cancels a test.
Printed output is capped at 20,000 characters and results at 200,000 characters.

Custom Python is trusted code with your user permissions, including filesystem,
network, and subprocess access. The selected project folder does **not** sandbox it.
The subprocess receives a reduced environment, without inherited provider keys;
it can still access files your user can read. Do not embed credentials in source or
inputs: these are saved in project files/history and source is included in exports.
Install dependencies yourself in the configured Python environment; there is no
automatic package installation or custom secret configuration in this version.

## Execution and storage

```text
CrewAI project builder
        |
Validated preload / IPC
        |
Main-process CrewAI service ------ saved project JSON / run SQLite
        |
Private JSON-lines protocol
        |
Application-owned Python worker --> real CrewAI sequential Crew
        |
Host model/tool requests
        |
Existing provider router / approved filesystem and custom Python tools
```

The service and renderer are loaded lazily. The worker runs without a shell in a
per-run cache directory with a minimal environment. Provider credentials stay in
the main process. Model calls use each agent's selected app provider/model.
CrewAI telemetry/tracing is disabled for this worker. Python is a process boundary,
not an OS sandbox. Approved custom Python runs in a separate process from the trusted worker.

Protocol messages are versioned, bounded, validated, and correlated to a run, task,
and request ID. Out-of-order tasks, duplicate requests, unsupported tools, incomplete
results, and worker crashes fail the run. Framework diagnostics and private model
reasoning are not presented as progress. Only task results and observable tool
activity are persisted/displayed.

- Definitions: `<userData>/crewai/projects/<id>.json`.
- Run snapshots/history: `<userData>/database/crewai-runs.sqlite`.
- Worker scratch data: per-run directories under `<userData>/cache`, removed after use.
- The whole run has a 15-minute deadline, including waiting for an execution slot.
- Each sequential crew reserves one of the same three execution slots used by
  built-in agents. At most three CrewAI project runs may be queued/active.
- Model-call budgets are 1–500 per agent and 1–500 for the whole crew. Agent counts
  apply across its tasks. The host enforces them independently of CrewAI retries.
- Tool requests are bounded separately. Token/cost figures are not fabricated;
  this initial UI reports actual model calls, not token or monetary estimates.
- Interrupted runs become cancelled when the service next loads their history.

## Export a runnable application

**Export Python project** saves the current definition, asks for a parent folder,
and creates a unique new `crewai-project-*` subdirectory. Existing files are not
replaced. The export contains:

```text
crewai-project-*/
  project.json
  main.py
  crew_builder.py
  tool_factory.py
  requirements.txt
  README.md
  .env.example
  .gitignore
```

The exported CLI builds the same sequential agents/tasks/tools and supports
`--input` and `--folder`. Tools prompt for terminal approval. It uses its own
`CREWAI_MODEL` and provider credentials, described in its README. App provider IDs,
model selections, credentials, and run history are not exported. By default the
standalone CLI uses one configured model for all agents; the source can be extended.

Desktop controls such as history, IPC, UI cancellation, the run deadline, and
cross-run concurrency belong to the host. They are not claimed to be part of the
standalone CLI. Exported code is normal editable Python and is not sandboxed.

## Validation

The test suite covers schema validation, older settings/default-off behavior,
project persistence/export, disabled actions, model-call limits, tool allow/deny,
folder boundaries, cancellation, UI creation, runtime errors, settings-import
behavior, and retained projects after re-enable.

Real-worker checks are opt-in:

```sh
CREWAI_TEST_PYTHON=/absolute/path/to/python pnpm exec vitest run tests/crewai.integration.test.ts
```

Those tests use the actual pinned CrewAI package with clearly identified deterministic
model fixtures for protocol/tool checks. A separate optional live-model test uses
Ollama when `CREWAI_LIVE_MODEL` is set. No fixture responses exist in production.

## Next decisions and future work

| Question | Current implementation / next choice |
| --- | --- |
| Which tools should come next? | Start with read/list/search; decide between web research, MCP, and controlled writes |
| Should tools be shared with built-in agents? | Separate CrewAI catalog now; add a common approval bridge before sharing |
| Should CrewAI agents be reusable across projects? | Embedded in each project now; consider an agent-template library |
| Is manager-led coordination needed? | Sequential now; hierarchical crews need manager identity, permissions and budget accounting |
| Should exported projects support multiple providers? | One environment-selected model now; add per-agent portable provider references |
| Should users import edited Python projects? | Export only now; arbitrary Python import requires a separate trust/runtime design |
| Should the app install Python automatically? | Explicit user-managed environment now; packaging/update policy is a future decision |
| Do we need persistent memory or Flows? | Neither is exposed yet; add only with clear storage and lifecycle semantics |
| Should crews run from Chat? | Dedicated project screen now; a future command can reuse this service |

## Relevant code

- `src/shared/crewai.ts`: project schema, tool catalog, starter definition and run types.
- `src/main/services/crewai/`: persistence, worker lifecycle, provider/tool bridge and limits.
- `src/renderer/features/crewai.tsx`: project builder and run history.
- `workers/crewai/`: worker, shared crew builder, tool wrappers and standalone export templates.

## Sources

- [CrewAI processes](https://docs.crewai.com/en/concepts/processes)
- [Custom LLM implementations](https://docs.crewai.com/en/learn/custom-llm)
- [CrewAI installation](https://docs.crewai.com/en/installation)
- [CrewAI tools](https://docs.crewai.com/en/concepts/tools)

## Change record

- Previous MCP literal-value and 500-iteration changes were committed as `20972af`.
- The original proposal was an optional engine inside Workflows.
- The user clarified the requirement: create CrewAI applications, agents, task
  workflows and tools through a dedicated builder, with a default-off feature flag.
- This document now describes that builder and clearly separates implemented
  behavior from future functionality.
