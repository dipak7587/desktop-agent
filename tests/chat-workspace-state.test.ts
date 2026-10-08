import { afterEach, expect, it, vi } from 'vitest';
import { useChat, useUI } from '../src/renderer/stores';
import type { CodeWorkspace } from '../src/shared/types';

afterEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  useUI.setState(useUI.getInitialState(), true);
  vi.unstubAllGlobals();
});

it.each(['connectWorkspace', 'reconnectWorkspace', 'relinkWorkspace'] as const)(
  'new chat stays project-free when a pending %s finishes',
  async (action) => {
    const workspace: CodeWorkspace = {
      id: 'project',
      name: 'Project',
      canonicalPath: '/project',
      createdAt: '',
      lastOpenedAt: '',
      permissions: { rules: {} },
      selectedAgentId: null,
    };
    let finish!: (value: CodeWorkspace) => void;
    const pending = new Promise<CodeWorkspace>((resolve) => {
      finish = resolve;
    });
    const connect = vi.fn(() => pending);
    vi.stubGlobal('window', {
      workspace: {
        chat: {
          create: vi.fn(async () => ({ id: 'new-chat', model: 'test-model' })),
          list: vi.fn(async () => []),
        },
        code: { chooseAndConnect: connect, reconnect: connect, chooseAndRelink: connect },
      },
    });
    useChat.setState({ current: 'old-chat', workspace });
    useUI.setState({ draft: '/code Project' });
    const connecting = useChat.getState()[action]('project');
    await useChat.getState().newChat();
    expect(useChat.getState().workspace).toBeNull();
    expect(useUI.getState().draft).toBe('');
    finish(workspace);
    await connecting;
    expect(useChat.getState().current).toBe('new-chat');
    expect(useChat.getState().workspace).toBeNull();
  },
);
