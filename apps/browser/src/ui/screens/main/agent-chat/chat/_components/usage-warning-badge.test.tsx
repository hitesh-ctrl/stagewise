import { describe, expect, it, beforeAll } from 'vitest';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { render, act } from '@testing-library/react';
import { produceWithPatches, enablePatches } from 'immer';

enablePatches();

// `@stagewise/karton/client` doesn't publicly export its wire-message
// type — this mirrors its shape closely enough for the fake transport.
type KartonMessage = { type: string; data: unknown };

/**
 * Proves the fix for the re-render bug: `UsageWarningBadge` used to
 * subscribe to the raw `s.agents.instances` map. Karton's client applies
 * incoming patches with structural sharing (shallow-copy along the patch
 * path), so *any* agent's state changing anywhere in the app produces a
 * new `agents.instances` reference — even though the derived "highest
 * usage warning" value the component actually cares about hasn't moved.
 *
 * This drives the app's real, unmocked `useKartonState`/KartonProvider
 * singleton (`@ui/hooks/use-karton`) through a fake `MessagePortProxy` —
 * the same seam the real Electron preload bridge uses — and counts
 * commits with React's own Profiler. `window.electron.karton.portProxy`
 * must exist before `@ui/hooks/use-karton` is first imported (it builds
 * its client at module scope), so everything under test is loaded via
 * dynamic import from inside `beforeAll`, after the fake port is wired up.
 */

type FakeState = {
  agents: {
    instances: Record<
      string,
      { state: { usageWarning?: { usedPercent: number; windowType: string } } }
    >;
  };
};

function installFakePortProxy() {
  let onMessage: ((message: KartonMessage) => void) | null = null;
  (globalThis.window as any).electron = {
    ...(globalThis.window as any).electron,
    karton: {
      portProxy: {
        setOnMessage: (handler: (message: KartonMessage) => void) => {
          onMessage = handler;
        },
        postMessage: () => {},
      },
    },
  };
  return {
    emit: (message: KartonMessage) => onMessage?.(message),
  };
}

async function settle() {
  // Karton's client double-buffers notifications (microtask, then a
  // 12ms cooldown window) — wait past that so each patch below gets its
  // own notification cycle instead of being coalesced together.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('UsageWarningBadge re-render behavior (real karton client, no mocks)', () => {
  let KartonProvider: React.FC<{ children?: React.ReactNode }>;
  let UsageWarningBadge: () => React.ReactElement | null;
  let emit: (message: KartonMessage) => void;

  beforeAll(async () => {
    emit = installFakePortProxy().emit;
    ({ KartonProvider } = await import('@ui/hooks/use-karton'));
    ({ UsageWarningBadge } = await import('./usage-warning-badge'));
  });

  function makeHarness(initialState: FakeState) {
    emit({ type: 'state_sync', data: { state: initialState } } as any);
    let currentState = initialState;
    const applyPatch = (recipe: (draft: FakeState) => void) => {
      const [nextState, patches] = produceWithPatches(currentState, recipe);
      currentState = nextState as FakeState;
      emit({ type: 'state_patch', data: { patch: patches } } as any);
    };
    return { applyPatch };
  }

  it('does not re-render when an unrelated agent mutates unrelated state', async () => {
    const initialState: FakeState = {
      agents: {
        instances: {
          'agent-with-warning': {
            state: { usageWarning: { usedPercent: 85, windowType: 'daily' } },
          },
          'other-agent': { state: {} },
        },
      },
    };
    const { applyPatch } = makeHarness(initialState);

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    render(
      <KartonProvider>
        <Profiler id="badge" onRender={onRender}>
          <UsageWarningBadge />
        </Profiler>
      </KartonProvider>,
    );
    await settle();
    const rendersAfterMount = renderCount;

    // Simulate 20 "streaming ticks" on a completely unrelated agent —
    // exactly what happens continuously while any agent is working.
    for (let i = 0; i < 20; i++) {
      applyPatch((draft) => {
        draft.agents.instances['other-agent']!.state = {
          usageWarning: undefined,
        };
      });
      await settle();
    }

    const extraRenders = renderCount - rendersAfterMount;
    expect(extraRenders).toBe(0);
  });

  it('still re-renders when the highest usage warning actually changes', async () => {
    const initialState: FakeState = {
      agents: {
        instances: {
          a1: {
            state: { usageWarning: { usedPercent: 80, windowType: 'daily' } },
          },
        },
      },
    };
    const { applyPatch } = makeHarness(initialState);

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    const { findByText } = render(
      <KartonProvider>
        <Profiler id="badge" onRender={onRender}>
          <UsageWarningBadge />
        </Profiler>
      </KartonProvider>,
    );
    await settle();
    const rendersAfterMount = renderCount;

    applyPatch((draft) => {
      draft.agents.instances.a1!.state.usageWarning = {
        usedPercent: 92,
        windowType: 'daily',
      };
    });
    await settle();

    expect(renderCount).toBeGreaterThan(rendersAfterMount);
    await findByText(/92%/);
  });
});
