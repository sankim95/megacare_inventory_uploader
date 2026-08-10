import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../src/App";

function renderRoute(route: string) {
  render(<AppRoutes path={route} />);
}

describe("업무 화면 라우트", () => {
  it.each([
    ["/", "입고 반영 작업"],
    ["/jobs/new/upload", "파일 업로드"],
    ["/jobs/job-1/review", "사진과 품목 검수"],
    ["/jobs/job-1/complete", "결과 파일을 확인하고 있습니다"],
  ])("%s 경로에 해당 화면을 표시한다", (route, heading) => {
    renderRoute(route);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("알 수 없는 경로에는 찾을 수 없음 화면을 표시한다", () => {
    renderRoute("/missing");
    expect(screen.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeInTheDocument();
  });
});
