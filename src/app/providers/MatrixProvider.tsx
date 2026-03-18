import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ClientEvent,
  type MatrixClient,
} from "matrix-js-sdk";
import { createAuthedMatrixClient, createTempMatrixClient } from "../../services/matrixClient";
import { clearAuth, readAuth, writeAuth, type StoredAuth } from "../../services/storage";
import { MatrixContext, type MatrixContextValue } from "./matrix-context";

function toLocalpart(input: string): string {
  if (input.startsWith("@")) return input.slice(1).split(":")[0];
  return input;
}

function normalizeLoginUser(input: string): string {
  return toLocalpart(input.trim());
}

type MatrixLikeError = {
  message?: string;
  httpStatus?: number;
  data?: {
    errcode?: string;
    error?: string;
  };
};

function toErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as MatrixLikeError;
    const status = typeof e.httpStatus === "number" ? `HTTP ${e.httpStatus}` : "";
    const serverCode = e.data?.errcode ?? "";
    const serverMessage = e.data?.error ?? e.message ?? "";
    const merged = [status, serverCode, serverMessage].filter(Boolean).join(" - ");
    if (merged) return merged;
  }
  if (error instanceof Error) return error.message;
  return "Login failed";
}

async function setClientPresence(client: MatrixClient, presence: "online" | "offline" | "unavailable") {
  try {
    await client.setPresence({ presence });
  } catch {
    // ignore presence failures
  }
}

export function MatrixProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readAuth());
  const [status, setStatus] = useState<MatrixContextValue["status"]>(() => (readAuth() ? "connected" : "disconnected"));
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<MatrixClient | null>(null);

  const clientRef = useRef<MatrixClient | null>(null);

  useEffect(() => {
    if (!auth) {
      setClient(null);
      clientRef.current = null;
      return;
    }

    const nextClient = createAuthedMatrixClient({
      accessToken: auth.accessToken,
      userId: auth.userId,
      deviceId: auth.deviceId,
    });

    setClient(nextClient);
    clientRef.current = nextClient;
    nextClient.startClient({ initialSyncLimit: 20 });
    void setClientPresence(nextClient, "online");

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void setClientPresence(nextClient, "unavailable");
        return;
      }

      void setClientPresence(nextClient, "online");
    };

    const onPageHide = () => {
      void setClientPresence(nextClient, "offline");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      void setClientPresence(nextClient, "offline");
      nextClient.stopClient();
      if (clientRef.current === nextClient) {
        clientRef.current = null;
      }
    };
  }, [auth]);

  useEffect(() => {
    if (!client) return;

    const joinInvites = async () => {
      const invitedRooms = client.getRooms().filter((room) => room.getMyMembership() === "invite");
      for (const room of invitedRooms) {
        try {
          await client.joinRoom(room.roomId);
        } catch {
          // ignore failed auto-joins
        }
      }
    };

    const onRoomUpdate = () => {
      void joinInvites();
    };

    const onSync = (state: string) => {
      if (state === "PREPARED" || state === "SYNCING") {
        void joinInvites();
      }
    };

    void joinInvites();
    client.on(ClientEvent.Room, onRoomUpdate);
    client.on(ClientEvent.Sync, onSync);

    return () => {
      client.off(ClientEvent.Room, onRoomUpdate);
      client.off(ClientEvent.Sync, onSync);
    };
  }, [client]);

  const login = useCallback(async (userIdOrLocalpart: string, password: string) => {
    setStatus("connecting");
    setError(null);

    const temp = createTempMatrixClient();

    try {
      const loginUser = normalizeLoginUser(userIdOrLocalpart);
      const res = await temp.login("m.login.password", {
        identifier: {
          type: "m.id.user",
          user: loginUser,
        },
        user: loginUser,
        password,
      });

      const next: StoredAuth = {
        accessToken: res.access_token,
        userId: res.user_id,
        deviceId: res.device_id,
      };

      writeAuth(next);
      setAuth(next);
      setStatus("connected");
    } catch (e: unknown) {
      setStatus("disconnected");
      setError(toErrorMessage(e));
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    setStatus("disconnected");
    const activeClient = clientRef.current;

    if (activeClient) {
      try {
        await setClientPresence(activeClient, "offline");
        await activeClient.logout();
      } catch {
        // ignore
      }
      activeClient.stopClient();
      if (clientRef.current === activeClient) {
        clientRef.current = null;
      }
    }

    clearAuth();
    setAuth(null);
    setClient(null);
  }, []);

  const value = useMemo<MatrixContextValue>(
    () => ({
      client,
      auth,
      status,
      error,
      login,
      logout,
    }),
    [client, auth, status, error, login, logout],
  );

  return <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>;
}
