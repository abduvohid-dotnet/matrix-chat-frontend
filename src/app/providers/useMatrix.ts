import { useContext } from "react";
import { MatrixContext } from "./matrix-context";

export function useMatrix() {
  const ctx = useContext(MatrixContext);
  if (!ctx) throw new Error("useMatrix must be used within MatrixProvider");
  return ctx;
}
