import { useMemo, useRef, useState } from "react";
import {
  FileText,
  Images,
  Link2,
  LogOut,
  Mic,
  Settings2,
  UserPlus,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
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

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "#";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

type PermissionKey = "invite" | "redact" | "kick" | "ban";

type GroupMediaStats = {
  photos: number;
  files: number;
  links: number;
  voices: number;
};

export function GroupManagementPanel({
  roomName,
  roomId,
  members,
  myPowerLevel,
  inviteLevel,
  redactLevel,
  kickLevel,
  banLevel,
  stats,
  busy,
  error,
  onClose,
  onLeave,
  onInvite,
  onRemoveMember,
  onChangeRole,
  onChangePermission,
}: {
  roomName: string;
  roomId: string;
  members: GroupMemberSummary[];
  myPowerLevel: number;
  inviteLevel: number;
  redactLevel: number;
  kickLevel: number;
  banLevel: number;
  stats: GroupMediaStats;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onLeave: () => Promise<void>;
  onInvite: (value: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, value: number) => Promise<void>;
  onChangePermission: (key: PermissionKey, value: number) => Promise<void>;
}) {
  const [inviteInput, setInviteInput] = useState("");
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const inviteRef = useRef<HTMLDivElement | null>(null);
  const permissionsRef = useRef<HTMLDivElement | null>(null);
  const membersRef = useRef<HTMLDivElement | null>(null);

  const canManageRoles = myPowerLevel >= 100;
  const canInvite = myPowerLevel >= inviteLevel;
  const permissionRows = useMemo(
    () => [
      { key: "invite" as const, label: "Invite users", value: inviteLevel },
      { key: "redact" as const, label: "Delete messages", value: redactLevel },
      { key: "kick" as const, label: "Remove members", value: kickLevel },
      { key: "ban" as const, label: "Ban members", value: banLevel },
    ],
    [banLevel, inviteLevel, kickLevel, redactLevel],
  );
  const activityRows = useMemo(
    () => [
      { label: "photos", value: stats.photos, icon: Images },
      { label: "files", value: stats.files, icon: FileText },
      { label: "shared links", value: stats.links, icon: Link2 },
      { label: "voice messages", value: stats.voices, icon: Mic },
    ],
    [stats.files, stats.links, stats.photos, stats.voices],
  );

  return (
    <>
      <button type="button" className="group-panel-backdrop" aria-label="Close group panel" onClick={onClose} />
      <aside className="group-panel" onClick={(event) => event.stopPropagation()}>
        <div className="group-panel-top">
          <button type="button" className="group-panel-close" onClick={onClose} aria-label="Close group panel">
            <X size={20} />
          </button>

          <div className="group-panel-hero">
            <div className="group-panel-avatar">{getInitials(roomName)}</div>
            <div className="group-panel-name">{roomName}</div>
            <div className="group-panel-subtitle">
              {members.length} members
              <span className="group-panel-divider" />
              {levelToLabel(myPowerLevel)}
            </div>
          </div>

          <div className="group-action-grid">
            <button
              type="button"
              className="group-action-card"
              disabled={!canInvite || busy}
              onClick={() => inviteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <UserPlus size={18} />
              <span>Invite</span>
            </button>
            <button
              type="button"
              className="group-action-card"
              onClick={() => permissionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Settings2 size={18} />
              <span>Manage</span>
            </button>
            <button
              type="button"
              className="group-action-card"
              onClick={() => membersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Users size={18} />
              <span>Members</span>
            </button>
            <button
              type="button"
              className="group-action-card danger"
              disabled={busy}
              onClick={async () => {
                setLocalBusy("leave");
                try {
                  await onLeave();
                } finally {
                  setLocalBusy(null);
                }
              }}
            >
              <LogOut size={18} />
              <span>{localBusy === "leave" ? "Leaving..." : "Leave"}</span>
            </button>
          </div>
        </div>

        <div className="group-panel-section">
          <div className="group-section-title">Shared media</div>
          <div className="group-media-list">
            {activityRows.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="group-media-row">
                  <div className="group-media-icon">
                    <Icon size={18} />
                  </div>
                  <div className="group-media-copy">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div ref={inviteRef} className="group-panel-section">
          <div className="group-section-title">Invite users</div>
          {canInvite ? (
            <div className="group-invite-box">
              <input
                className="input group-panel-input"
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                placeholder="@user:server, @another:server"
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
              Invite permission requires at least <strong>{levelToLabel(inviteLevel)}</strong>.
            </div>
          )}
        </div>

        <div ref={permissionsRef} className="group-panel-section">
          <div className="group-section-title">Permissions</div>
          <div className="group-permissions-grid">
            {permissionRows.map((permission) => (
              <label key={permission.key} className="group-permission-card">
                <span>{permission.label}</span>
                {canManageRoles ? (
                  <select
                    className="input group-panel-input"
                    value={permission.value}
                    disabled={busy}
                    onChange={async (event) => {
                      const nextValue = Number(event.target.value);
                      setLocalBusy(`perm-${permission.key}`);
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
                ) : (
                  <strong>{levelToLabel(permission.value)}</strong>
                )}
              </label>
            ))}
          </div>
        </div>

        <div ref={membersRef} className="group-panel-section">
          <div className="group-section-title group-section-title-with-count">
            <span>Members</span>
            <span>{members.length}</span>
          </div>
          <div className="group-members-list">
            {members.map((member) => (
              <div key={member.userId} className="group-member-row">
                <div className="group-member-main">
                  {member.avatarUrl ? (
                    <img className="group-member-avatar" src={member.avatarUrl} alt={member.displayName} />
                  ) : (
                    <div className="group-member-avatar fallback">{getInitials(member.displayName)}</div>
                  )}

                  <div className="group-member-copy">
                    <div className="group-member-line">
                      <div className="group-member-name">{member.displayName}</div>
                      <span className={`group-member-role-chip role-${levelToLabel(member.powerLevel).toLowerCase()}`}>
                        {member.isCreator ? "Owner" : levelToLabel(member.powerLevel)}
                      </span>
                      {member.isSelf && <span className="group-member-self">You</span>}
                    </div>
                    <div className={`group-member-status ${member.statusTone}`}>{member.statusText}</div>
                    <div className="group-member-id">{member.userId}</div>
                  </div>
                </div>

                <div className="group-member-actions">
                  {canManageRoles && !member.isCreator ? (
                    <select
                      className="input group-panel-input group-member-select"
                      value={member.powerLevel}
                      disabled={busy}
                      onChange={async (event) => {
                        const nextValue = Number(event.target.value);
                        setLocalBusy(`role-${member.userId}`);
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
                  ) : null}

                  {member.canRemove && (
                    <button
                      type="button"
                      className="group-member-remove"
                      disabled={busy}
                      onClick={async () => {
                        setLocalBusy(`remove-${member.userId}`);
                        try {
                          await onRemoveMember(member.userId);
                        } finally {
                          setLocalBusy(null);
                        }
                      }}
                    >
                      <UserRoundX size={16} />
                      <span>{localBusy === `remove-${member.userId}` ? "Removing..." : "Remove"}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {(error || localBusy) && (
          <div className="chat-selection-error group-panel-error">
            {error || "Updating group..."}
          </div>
        )}

        <div className="group-panel-roomid">{roomId}</div>
      </aside>
    </>
  );
}
