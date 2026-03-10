import { useRef, useState } from "react";
import { useMatrix } from "../../app/providers/useMatrix";

export function LoginPage() {
  const { login, status, error } = useMatrix();
  const [localError, setLocalError] = useState<string | null>(null);
  const userIdRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const onLogin = async () => {
    setLocalError(null);

    const userId = userIdRef.current?.value.trim() ?? "";
    const password = passwordRef.current?.value ?? "";

    if (!userId || !password.trim()) {
      setLocalError("Login va parolni kiriting.");
      return;
    }

    try {
      await login(userId, password);
    } catch {
      // error state is already handled in MatrixProvider
    }
  };

  return (
    <div className="login">
      <div className="card">
        <h2>Login</h2>
        <input
          ref={userIdRef}
          className="input"
          defaultValue="@abduvohiddotnet:uchar.uz"
          autoComplete="username"
        />
        <input
          ref={passwordRef}
          className="input"
          type="password"
          autoComplete="current-password"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onLogin();
            }
          }}
        />
        <button
          className="btn"
          type="button"
          disabled={status === "connecting"}
          onClick={() => void onLogin()}
        >
          {status === "connecting" ? "Connecting..." : "Login"}
        </button>
        <div className="subtitle">After successful login you will enter chat page.</div>
        {localError && <div className="error">{localError}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
