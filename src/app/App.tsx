import { useMatrix } from "./providers/useMatrix";
import { ChatLayout } from "../components/layout/ChatLayout";
import { LoginPage } from "../components/layout/LoginPage";

export function App() {
  const { auth } = useMatrix();
  return auth ? <ChatLayout /> : <LoginPage />;
}
