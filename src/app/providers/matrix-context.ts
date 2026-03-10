import { createContext } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { StoredAuth } from "../../services/storage";

export type MatrixContextValue = {
  client: MatrixClient | null;
  auth: StoredAuth | null;
  status: "disconnected" | "connecting" | "connected";
  error: string | null;
  login: (userIdOrLocalpart: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const MatrixContext = createContext<MatrixContextValue | undefined>(undefined);
