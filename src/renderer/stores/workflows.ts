import { create } from 'zustand';
import type { AgentWorkflow, WorkflowRun } from '../../shared/workflows';
export const useWorkflows = create<{
  items: AgentWorkflow[];
  runs: WorkflowRun[];
  load(): Promise<void>;
}>((set) => ({
  items: [],
  runs: [],
  load: async () => {
    const [items, runs] = await Promise.all([
      window.workspace.workflows.list(),
      window.workspace.workflows.runs(),
    ]);
    set({ items, runs });
  },
}));
