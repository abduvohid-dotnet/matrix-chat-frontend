import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { createAuthedMatrixClient, createTempMatrixClient } from "../services/matrixClient";

type MatrixAuth = {
  accessToken: string;
  userId: string;
  deviceId: string;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Login failed";
}

export function useMatrix() {
  const [auth, setAuth] = useState<MatrixAuth | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<MatrixClient | null>(null);

  const login = useCallback(async (userIdOrLocalPart: string, password: string) => {
    setStatus("connecting");
    setError(null);

    const temp = createTempMatrixClient();

    try {
      const localPart =
        userIdOrLocalPart.startsWith("@")
          ? userIdOrLocalPart.slice(1).split(":")[0]
          : userIdOrLocalPart;
      const loginUser = localPart.trim();

      const res = await temp.login("m.login.password", {
        identifier: {
          type: "m.id.user",
          user: loginUser,
        },
        user: loginUser,
        password,
      });

      const nextAuth: MatrixAuth = {
        accessToken: res.access_token,
        userId: res.user_id,
        deviceId: res.device_id,
      };

      setAuth(nextAuth);
      setStatus("connected");
      return nextAuth;
    } catch (err: unknown) {
      setStatus("disconnected");
      setError(toErrorMessage(err));
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    setStatus("disconnected");
    setAuth(null);

    if (clientRef.current) {
      try {
        await clientRef.current.logout();
      } catch {
        // ignore
      }

      clientRef.current.stopClient();
      clientRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!auth) return;

    const client = createAuthedMatrixClient({
      accessToken: auth.accessToken,
      userId: auth.userId,
      deviceId: auth.deviceId,
    });

    clientRef.current = client;

    client.startClient({initialSyncLimit: 20});

    return () => {
      client.stopClient();
      clientRef.current = null;
    };
  }, [auth]);

  return {
    status,
    error,
    auth,
    login,
    logout,
    clientRef,
  };
}
