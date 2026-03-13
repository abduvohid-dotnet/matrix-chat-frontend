import { useMemo, useState } from "react";
import type { GroupMemberSummary } from "../../hooks/useMatrixGroups";

const POWER_LEVEL_OPTIONS = [
  { label: "Member", value: 0 },
  { label: "Moderator", value: 50 },
  { label: "Admin", value: 75 },
  { label: "Owner", value: 100 },
] as const;

function levelToLabel(value: number): string {
  if (!Number.isFinite(value) || value >= 100) return "Owner";
  return POWER_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? `Level ${value}`;
}

type PermissionKey = "invite" | "redact" | "kick" | "ban";

export function GroupManagementPanel({
  members,
  myPowerLevel,
  inviteLevel,
  redactLevel,
  kickLevel,
  banLevel,
  busy,
  error,
  onInvite,
  onChangeRole,
  onChangePermission,
}: {
  members: GroupMemberSummary[];
  myPowerLevel: number;
  inviteLevel: number;
  redactLevel: number;
  kickLevel: number;
  banLevel: number;
  busy: boolean;
  error: string | null;
  onInvite: (value: string) => Promise<void>;
  onChangeRole: (userId: string, value: number) => Promise<void>;
  onChangePermission: (key: PermissionKey, value: number) => Promise<void>;
}) {
  const [inviteInput, setInviteInput] = useState("");
  const [localBusy, setLocalBusy] = useState<string | null>(null);

  const canManageRoles = myPowerLevel >= 100;
  const canInvite = myPowerLevel >= inviteLevel;
  const permissionRows = useMemo(
    () => [
      { key: "invite" as const, label: "Invite users", value: inviteLevel },
      { key: "redact" as const, label: "Delete messages", value: redactLevel },
      { key: "kick" as const, label: "Kick members", value: kickLevel },
      { key: "ban" as const, label: "Ban members", value: banLevel },
    ],
    [banLevel, inviteLevel, kickLevel, redactLevel],
  );

  return (
    <div className="group-panel">
      <div className="group-panel-head">
        <div>
          <div className="group-panel-title">Group management</div>
          <div className="group-panel-subtitle">
            Owner manages roles. Admin and moderator actions depend on these thresholds.
          </div>
        </div>
        <div className="group-panel-role">Your level: {levelToLabel(myPowerLevel)}</div>
      </div>

      <div className="group-overview-grid">
        <div className="group-overview-card">
          <div className="group-overview-label">Roles</div>
          <div className="group-overview-value">
            {canManageRoles ? "You can manage all roles" : "Only owner can change roles"}
          </div>
        </div>
        <div className="group-overview-card">
          <div className="group-overview-label">Invites</div>
          <div className="group-overview-value">Requires {levelToLabel(inviteLevel)}</div>
        </div>
        <div className="group-overview-card">
          <div className="group-overview-label">Delete</div>
          <div className="group-overview-value">Requires {levelToLabel(redactLevel)}</div>
        </div>
        <div className="group-overview-card">
          <div className="group-overview-label">Moderation</div>
          <div className="group-overview-value">
            Kick: {levelToLabel(kickLevel)} | Ban: {levelToLabel(banLevel)}
          </div>
        </div>
      </div>

      <div className="group-panel-section">
        <div className="group-panel-label">Invite users</div>
        {canInvite ? (
          <div className="group-panel-row">
            <input
              className="input"
              value={inviteInput}
              onChange={(event) => setInviteInput(event.target.value)}
              placeholder="@user:server yoki bir nechta userni comma bilan yozing"
              disabled={busy}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !inviteInput.trim()}
              onClick={async () => {
                setLocalBusy("invite");
                try {
                  await onInvite(inviteInput);
                  setInviteInput("");
                } finally {
                  setLocalBusy(null);
                }
              }}
            >
              {localBusy === "invite" ? "Inviting..." : "Invite"}
            </button>
          </div>
        ) : (
          <div className="group-panel-note">
            You cannot invite users. This room requires at least {levelToLabel(inviteLevel)}.
          </div>
        )}
      </div>

      <div className="group-panel-section">
        <div className="group-panel-label">Permission thresholds</div>
        {canManageRoles ? (
          <div className="group-permissions-grid">
            {permissionRows.map((permission) => (
              <label key={permission.key} className="group-permission-item">
                <span>{permission.label}</span>
                <select
                  className="input"
                  value={permission.value}
                  disabled={busy}
                  onChange={async (event) => {
                    const nextValue = Number(event.target.value);
                    setLocalBusy(permission.key);
                    try {
                      await onChangePermission(permission.key, nextValue);
                    } finally {
                      setLocalBusy(null);
                    }
                  }}
                >
                  {POWER_LEVEL_OPTIONS.map((option) => (
                    <option key={`${permission.key}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : (
          <div className="group-permissions-readonly">
            {permissionRows.map((permission) => (
              <div key={permission.key} className="group-permission-readonly-item">
                <span>{permission.label}</span>
                <strong>{levelToLabel(permission.value)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="group-panel-section">
        <div className="group-panel-label">Members</div>
        <div className="group-members-list">
          {members.map((member) => (
            <div key={member.userId} className="group-member-row">
              <div>
                <div className="group-member-name">{member.displayName}</div>
                <div className="group-member-meta">
                  {member.userId} / {member.membership} / {levelToLabel(member.powerLevel)}
                </div>
              </div>
              {canManageRoles ? (
                <select
                  className="input group-member-select"
                  value={member.powerLevel}
                  disabled={busy || member.isCreator || member.powerLevel >= 100}
                  onChange={async (event) => {
                    const nextValue = Number(event.target.value);
                    setLocalBusy(member.userId);
                    try {
                      await onChangeRole(member.userId, nextValue);
                    } finally {
                      setLocalBusy(null);
                    }
                  }}
                >
                  {POWER_LEVEL_OPTIONS.map((option) => (
                    <option key={`${member.userId}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="group-member-role-chip">{levelToLabel(member.powerLevel)}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {(error || localBusy) && <div className="chat-selection-error">{error || "Updating group..."}</div>}
    </div>
  );
}
