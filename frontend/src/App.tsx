import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { CompletePage } from "./pages/CompletePage";
import { JobsPage } from "./pages/JobsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ReviewPage } from "./pages/ReviewPage";
import { UploadPage } from "./pages/UploadPage";

export function AppRoutes({ path }: { path: string }) {
  let page;
  if (path === "/") page = <JobsPage />;
  else if (path === "/jobs/new/upload") page = <UploadPage />;
  else if (/^\/jobs\/[^/]+\/upload$/.test(path)) page = <UploadPage jobId={path.split("/")[2]} />;
  else if (/^\/jobs\/[^/]+\/review$/.test(path)) page = <ReviewPage jobId={path.split("/")[2]} />;
  else if (/^\/jobs\/[^/]+\/complete$/.test(path)) page = <CompletePage jobId={path.split("/")[2]} />;
  else page = <NotFoundPage />;

  return (
    <AppShell currentPath={path}>
      {page}
    </AppShell>
  );
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  return <AppRoutes path={path} />;
}
