import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsPage } from "../src/pages/JobsPage";

const baseJob = {
  id: "job-1",
  original_excel_name: "상품리스트.xlsx",
  original_excel_sha256: "a".repeat(64),
  product_count: 1,
  approved_by: null,
  result_path: null,
  failure_message: null,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
  completed_at: null,
};

describe("작업 목록", () => {
  it("빈 작업 목록을 표시한다", async () => {
    render(<JobsPage />);
    expect(screen.getByText("작업 목록을 불러오는 중입니다.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "아직 작업이 없습니다" })).toBeInTheDocument();
  });

  it("서버 상태를 한국어로 표시한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { ...baseJob, id: "draft", status: "draft" },
        { ...baseJob, id: "review", status: "reviewing" },
        { ...baseJob, id: "complete", status: "completed", completed_at: "2026-08-07T02:00:00Z" },
        { ...baseJob, id: "failed", status: "failed", failure_message: "검증 실패" },
      ],
    } as Response);

    render(<JobsPage />);
    const table = await screen.findByRole("table");
    for (const status of ["초안", "검수 중", "완료", "실패"]) {
      expect(within(table).getByText(status)).toBeInTheDocument();
    }
    expect(screen.getByText("검증 실패")).toBeInTheDocument();
    expect(screen.getAllByText("상품리스트.xlsx")).toHaveLength(4);
    expect(screen.getAllByText(/2026.*08.*07.*10:00/)).toHaveLength(4);
  });

  it("목록 오류와 재시도 버튼을 표시한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: "DB 연결 실패" }) } as Response);
    render(<JobsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("DB 연결 실패");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("확인 후 목록에서 작업을 바로 삭제하고 집계를 갱신한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ ...baseJob, status: "draft" }],
    } as Response);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => undefined,
    } as Response);

    render(<JobsPage />);
    const row = (await screen.findByText("작업 ID job-1")).closest("tr");
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole("button", { name: "상품리스트.xlsx 작업 삭제" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row!).getByRole("button", { name: "상품리스트.xlsx 작업 삭제 확인" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/jobs/job-1",
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(await screen.findByRole("heading", { name: "아직 작업이 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("진행 중").closest("article")).toHaveTextContent("0");
  });

  it("삭제 실패 시 작업을 유지하고 서버 오류를 표시한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ ...baseJob, status: "reviewing" }],
    } as Response);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: "현재 작업을 삭제할 수 없습니다." }),
    } as Response);

    render(<JobsPage />);
    const row = (await screen.findByText("작업 ID job-1")).closest("tr");
    fireEvent.click(within(row!).getByRole("button", { name: "상품리스트.xlsx 작업 삭제" }));
    fireEvent.click(within(row!).getByRole("button", { name: "상품리스트.xlsx 작업 삭제 확인" }));

    expect(await within(row!).findByRole("alert")).toHaveTextContent("현재 작업을 삭제할 수 없습니다.");
    expect(screen.getByText("작업 ID job-1")).toBeInTheDocument();
  });

  it("추출·내보내기 중인 작업의 삭제 버튼을 비활성화한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { ...baseJob, id: "extracting", status: "extracting" },
        { ...baseJob, id: "exporting", status: "exporting" },
      ],
    } as Response);

    render(<JobsPage />);
    const table = await screen.findByRole("table");
    for (const id of ["extracting", "exporting"]) {
      const row = within(table).getByText(`작업 ID ${id}`).closest("tr");
      expect(within(row!).getByRole("button", { name: "상품리스트.xlsx 작업 삭제" })).toBeDisabled();
    }
  });
});
