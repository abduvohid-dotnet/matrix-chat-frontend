export type PresenceUi = {
  label: string;
  online: boolean;
};

const ONLINE_FRESH_MS = 2 * 60 * 1000;

export function formatPresenceStatus(
  userPresence: string | undefined,
  lastPresenceTs: number | undefined,
): PresenceUi {
  const now = Date.now();
  const age =
    typeof lastPresenceTs === "number" && lastPresenceTs > 0 ? Math.max(0, now - lastPresenceTs) : null;

  if (userPresence === "online" && (age === null || age <= ONLINE_FRESH_MS)) {
    return { label: "online", online: true };
  }

  if (typeof lastPresenceTs === "number" && lastPresenceTs > 0) {
    const text = new Date(lastPresenceTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { label: `last seen ${text}`, online: false };
  }

  return { label: "offline", online: false };
}

export function formatTypingSummary(
  names: string[],
  options?: { compact?: boolean },
): string {
  if (names.length === 0) return "";

  if (options?.compact) {
    if (names.length === 1) {
      return `${names[0]} typing...`;
    }

    return `${names.length} people typing...`;
  }

  if (names.length === 1) {
    return `${names[0]} typing...`;
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]} typing...`;
  }

  const shown = names.slice(0, 2).join(", ");
  return `${shown} and ${names.length - 2} others typing...`;
}
