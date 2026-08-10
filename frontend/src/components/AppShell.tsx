import { useEffect, useState, type PropsWithChildren } from "react";
import { getHealth } from "../api/client";
import { AppLink } from "./AppLink";

type ServerState = "checking" | "online" | "offline";

const serverLabels: Record<ServerState, string> = {
  checking: "서버 확인 중",
  online: "로컬 서버 연결됨",
  offline: "로컬 서버 연결 안 됨",
};

interface AppShellProps extends PropsWithChildren {
  currentPath: string;
}

export function AppShell({ children, currentPath }: AppShellProps) {
  const [serverState, setServerState] = useState<ServerState>("checking");

  useEffect(() => {
    let active = true;

    getHealth()
      .then(() => active && setServerState("online"))
      .catch(() => active && setServerState("offline"));

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">약</span>
          <div>
            <strong>입고 반영 도우미</strong>
            <span>거래명세서 검수 · Excel 반영</span>
          </div>
        </div>
        <div className={`server-state server-state--${serverState}`} role="status">
          <span aria-hidden="true" />
          {serverLabels[serverState]}
        </div>
      </header>

      <nav className="primary-nav" aria-label="주요 메뉴">
        <AppLink to="/" className={currentPath === "/" ? "active" : undefined}>작업 목록</AppLink>
        <AppLink to="/jobs/new/upload" className={currentPath === "/jobs/new/upload" ? "active" : undefined}>새 작업</AppLink>
      </nav>

      <main id="main-content" className="main-content">
        {children}
      </main>
    </div>
  );
}
