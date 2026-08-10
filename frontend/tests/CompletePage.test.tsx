import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompletePage } from "../src/pages/CompletePage";
import type { JobRead, ReviewSummary } from "../src/types";

const completedJob: JobRead = {
  id: "job-1",
  status: "completed",
  original_excel_name: "상품리스트.xlsx",
  original_excel_sha256: "a".repeat(64),
  product_count: 4,
  approved_by: "홍길동",
  result_path: "/results/입고결과.xlsx",
  failure_message: null,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T02:00:00Z",
  completed_at: "2026-08-07T02:00:00Z",
};

const summary: ReviewSummary = {
  job_id: "job-1",
  ready_to_export: true,
  blockers: [],
  counts: {
    approved_items: 3,
    excluded_items: 1,
    pending_items: 0,
    inventory_products: 2,
    price_products: 1,
  },
  products: [],
};

function mockCompleteApi(job: JobRead = completedJob, reviewSummary: ReviewSummary = summary) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/jobs/job-1/review-summary")) return { ok: true, status: 200, json: async () => reviewSummary } as Response;
    if (url.endsWith("/jobs/job-1")) return { ok: true, status: 200, json: async () => job } as Response;
    throw new Error(`예상하지 못한 요청: ${url}`);
  });
}

describe("작업 완료", () => {
  it("실제 변경 요약과 감사 정보 및 결과 다운로드를 표시한다", async () => {
    mockCompleteApi();
    render(<CompletePage jobId="job-1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "입고 반영이 완료되었습니다" })).toBeInTheDocument();
    const resultSummary = screen.getByRole("region", { name: "변경 요약" });
    expect(within(resultSummary).getByText("3개")).toBeInTheDocument();
    expect(within(resultSummary).getByText("2개")).toBeInTheDocument();
    expect(within(screen.getByText("단가 변경 상품").closest("article") as HTMLElement).getByText("1개")).toBeInTheDocument();
    const audit = screen.getByRole("region", { name: "처리 정보" });
    expect(within(audit).getByText("홍길동")).toBeInTheDocument();
    expect(within(audit).getByText("상품리스트.xlsx")).toBeInTheDocument();
    expect(within(audit).getByText("입고결과.xlsx")).toBeInTheDocument();
    expect(within(audit).getByText(/2026.*8.*7.*11:00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "결과 Excel 다운로드" })).toHaveAttribute("href", "/api/jobs/job-1/result");
  });

  it("아직 완료되지 않은 작업은 다운로드를 막고 상태를 안내한다", async () => {
    mockCompleteApi({ ...completedJob, status: "reviewing", approved_by: null, result_path: null, completed_at: null });
    render(<CompletePage jobId="job-1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "결과 파일이 아직 준비되지 않았습니다" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "입고 반영이 완료되었습니다" })).not.toBeInTheDocument();
    expect(screen.getByText("이 작업은 아직 완료되지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "결과 Excel 다운로드" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "결과 Excel 다운로드" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이 작업 복제" })).toBeDisabled();
  });

  it("완료 정보를 불러오지 못하면 한국어 오류를 표시한다", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: "완료 정보를 읽지 못했습니다." }) } as Response);
    render(<CompletePage jobId="job-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("완료 정보를 읽지 못했습니다.");
    expect(screen.getByRole("heading", { level: 1, name: "완료 결과를 확인할 수 없습니다" })).toBeInTheDocument();
  });

  it("작업 복제를 한 번만 요청하고 새 작업의 업로드 화면으로 이동한다", async () => {
    let finishClone!: (job: JobRead) => void;
    const clonePromise = new Promise<JobRead>((resolve) => { finishClone = resolve; });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/jobs/job-1/clone") && init?.method === "POST") return { ok: true, status: 201, json: async () => clonePromise } as Response;
      if (url.endsWith("/jobs/job-1/review-summary")) return { ok: true, status: 200, json: async () => summary } as Response;
      if (url.endsWith("/jobs/job-1")) return { ok: true, status: 200, json: async () => completedJob } as Response;
      throw new Error(`예상하지 못한 요청: ${url}`);
    });
    render(<CompletePage jobId="job-1" />);
    await screen.findByRole("heading", { level: 1, name: "입고 반영이 완료되었습니다" });

    const cloneButton = screen.getByRole("button", { name: "이 작업 복제" });
    fireEvent.click(cloneButton);
    fireEvent.click(cloneButton);

    expect(await screen.findByText("새 작업을 복제하고 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "복제 중" })).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/jobs/job-1/clone"))).toHaveLength(1);

    finishClone({ ...completedJob, id: "job-2", status: "draft", approved_by: null, result_path: null, completed_at: null });
    await waitFor(() => expect(window.location.pathname).toBe("/jobs/job-2/upload"));
  });

  it("작업 복제 실패를 표시하고 다시 시도할 수 있게 한다", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/jobs/job-1/clone") && init?.method === "POST") return { ok: false, status: 409, json: async () => ({ detail: "원본 파일을 찾지 못했습니다." }) } as Response;
      if (url.endsWith("/jobs/job-1/review-summary")) return { ok: true, status: 200, json: async () => summary } as Response;
      if (url.endsWith("/jobs/job-1")) return { ok: true, status: 200, json: async () => completedJob } as Response;
      throw new Error(`예상하지 못한 요청: ${url}`);
    });
    render(<CompletePage jobId="job-1" />);
    await screen.findByRole("heading", { level: 1, name: "입고 반영이 완료되었습니다" });

    fireEvent.click(screen.getByRole("button", { name: "이 작업 복제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("원본 파일을 찾지 못했습니다.");
    expect(screen.getByRole("button", { name: "이 작업 복제" })).toBeEnabled();
  });
});
