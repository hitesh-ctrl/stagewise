import { useState } from 'react';
import { useKartonState, useComparingSelector } from '@ui/hooks/use-karton';
import { TriangleAlertIcon } from 'lucide-react';
import { SidebarToast } from '../../../_components/sidebar-toast';

const THRESHOLDS = [80, 90, 100] as const;

/** Highest threshold dismissed this app session. Resets on restart. */
let lastDismissedThreshold = 0;

/** Find the highest crossed threshold that hasn't been dismissed yet. */
function findActiveThreshold(
  usedPercent: number,
  dismissed: number,
): number | null {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    const t = THRESHOLDS[i]!;
    if (usedPercent >= t && t > dismissed) return t;
  }
  return null;
}

type HighestUsageWarning = { usedPercent: number; windowType: string };

function usageWarningsEqual(
  a: HighestUsageWarning | undefined,
  b: HighestUsageWarning | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.usedPercent === b.usedPercent && a.windowType === b.windowType;
}

export function UsageWarningBadge() {
  const [dismissedThreshold, setDismissedThreshold] = useState(
    () => lastDismissedThreshold,
  );

  // Scan all agents — not just the open one — so the warning is global.
  //
  // The derivation lives *inside* the selector (not a downstream useMemo)
  // and is wrapped in useComparingSelector: subscribing to the raw
  // `s.agents.instances` map re-renders on every Karton patch to *any*
  // agent's state, anywhere in the app (structural sharing means that
  // object gets a new reference on every streamed token). A useMemo
  // keyed on that map does nothing, because its only dependency is never
  // stable. useComparingSelector holds onto the previous derived value
  // and returns it verbatim when the highest usage warning hasn't
  // actually changed, so useSyncExternalStore's reference-equality
  // bail-out works the way it's supposed to.
  const stateUsageWarning = useKartonState(
    useComparingSelector((s): HighestUsageWarning | undefined => {
      let highest: HighestUsageWarning | undefined;
      for (const instance of Object.values(s.agents.instances)) {
        const warning = instance.state.usageWarning;
        if (
          warning &&
          (!highest || warning.usedPercent > highest.usedPercent)
        ) {
          highest = {
            usedPercent: warning.usedPercent,
            windowType: warning.windowType,
          };
        }
      }
      return highest;
    }, usageWarningsEqual),
  );

  if (!stateUsageWarning) return null;

  const activeThreshold = findActiveThreshold(
    stateUsageWarning.usedPercent,
    dismissedThreshold,
  );

  if (!activeThreshold) return null;

  const pct = Math.round(stateUsageWarning.usedPercent);
  const window = stateUsageWarning.windowType;

  return (
    <SidebarToast
      dismissLabel="Dismiss usage warning"
      onDismiss={() => {
        lastDismissedThreshold = activeThreshold;
        setDismissedThreshold(activeThreshold);
      }}
      className="flex-row items-start gap-2 pr-7"
    >
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
      <span className="text-foreground text-xs">
        You&apos;ve used {pct}% of your {window} limit. Consider switching to a
        cheaper model.
      </span>
    </SidebarToast>
  );
}
