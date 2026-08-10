import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { UploadPage } from "../src/pages/UploadPage";
import type { DocumentRead, JobRead } from "../src/types";

function makeJob(originalExcelName: string | null = null, status: JobRead["status"] = "draft"): JobRead {
  return {
    id: "job-1",
    status,
    original_excel_name: originalExcelName,
    original_excel_sha256: originalExcelName ? "a".repeat(64) : null,
    product_count: originalExcelName ? 20 : 0,
    approved_by: null,
    result_path: null,
    failure_message: null,
    created_at: "2026-08-07T01:00:00Z",
    updated_at: "2026-08-07T01:00:00Z",
    completed_at: status === "completed" ? "2026-08-07T02:00:00Z" : null,
  };
}

function makeDocument(id: string, sourceOrder: number, status: DocumentRead["status"] = "pending"): DocumentRead {
  return {
    id,
    job_id: "job-1",
    source_order: sourceOrder,
    original_image_name: `${id}.jpg`,
    status,
    image_sha256: id.padEnd(64, "a"),
    has_corrected_image: status === "completed",
    correction_applied: status === "completed",
    correction_warning: null,
    photo_supplier: null,
    transaction_date: null,
    invoice_number: null,
    document_total: null,
    processing_error: null,
    model_name: null,
    prompt_version: null,
    duplicate_status: "none",
    created_at: "2026-08-07T01:00:00Z",
    updated_at: "2026-08-07T01:00:00Z",
  };
}

describe("파일 업로드", () => {
  it("Excel 검증과 사진 업로드 후 문서 OCR을 시작한다", async () => {
    window.history.replaceState({}, "", "/jobs/new/upload");
    render(<UploadPage />);
    const excelInput = screen.getByLabelText(/Excel 파일 선택/) as HTMLInputElement;
    await waitFor(() => expect(excelInput).toBeEnabled());
    expect(fetch).not.toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ method: "POST" }));

    const excel = new File([new Uint8Array(2048)], "재고.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(excelInput, { target: { files: [excel] } });
    expect(screen.getByText("재고.xlsx")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText(/임시저장 전에는 작업 목록에 등록되지 않습니다/)).toBeInTheDocument();

    const photoInput = screen.getByLabelText(/사진 파일 선택/) as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [new File(["photo"], "명세서.jpg", { type: "image/jpeg" })] } });
    expect(fetch).not.toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));
    expect(await screen.findByText("임시저장이 완료되었습니다.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/excel", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/documents", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(await screen.findByText("추출 대기")).toBeInTheDocument();

    const start = screen.getByRole("button", { name: "OCR 추출 시작" });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(await screen.findByText(/모든 문서의 추출이 완료되었습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "검토 화면으로" })).toHaveAttribute("href", "/jobs/job-1/review");
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/extract", expect.objectContaining({ method: "POST" }));
    expect(window.location.pathname).toBe("/jobs/job-1/upload");
  });

  it("Excel 검증 오류를 한국어로 표시한다", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/excel")) return { ok: false, status: 422, json: async () => ({ detail: "현재고 열이 없습니다." }) } as Response;
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => [] } as Response;
      return { ok: true, status: 200, json: async () => makeJob() } as Response;
    });

    render(<UploadPage />);
    const input = screen.getByLabelText(/Excel 파일 선택/) as HTMLInputElement;
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { files: [new File(["xlsx"], "재고.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("현재고 열이 없습니다.");
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeDisabled();
  });

  it("사진 순서를 변경하고 선택에서 제거한다", async () => {
    render(<UploadPage />);
    const input = screen.getByLabelText(/사진 파일 선택/) as HTMLInputElement;
    await waitFor(() => expect(input).toBeEnabled());
    const first = new File(["1"], "첫번째.png", { type: "image/png" });
    const second = new File(["2"], "두번째.webp", { type: "image/webp" });
    fireEvent.change(input, { target: { files: [first, second] } });

    fireEvent.click(screen.getByRole("button", { name: "두번째.webp 위로 이동" }));
    const list = screen.getByRole("list", { name: "선택한 거래명세서 사진" });
    let rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]).getByText("두번째.webp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "두번째.webp 제거" }));
    rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(screen.queryByText("두번째.webp")).not.toBeInTheDocument();
  });

  it("기존 Excel 교체가 실패해도 확정 파일과 추출 가능 상태를 유지한다", async () => {
    const storedJob = makeJob("기존상품.xlsx");
    let documents: DocumentRead[] = [];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/excel")) return { ok: false, status: 422, json: async () => ({ detail: "상품코드 열이 없습니다." }) } as Response;
      if (url.endsWith("/documents") && init?.method === "POST") documents = [makeDocument("document-1", 0)];
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => documents } as Response;
      return { ok: true, status: 200, json: async () => storedJob } as Response;
    });

    render(<UploadPage jobId="job-1" />);
    expect(await screen.findByText("기존상품.xlsx")).toBeInTheDocument();
    const photoInput = screen.getByLabelText(/사진 파일 선택/) as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [new File(["photo"], "명세서.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "선택한 사진 1장 업로드" }));
    await screen.findByText("추출 대기");
    const start = screen.getByRole("button", { name: "OCR 추출 시작" });
    expect(start).toBeEnabled();

    const excelInput = screen.getByLabelText(/Excel 파일 선택/) as HTMLInputElement;
    fireEvent.change(excelInput, { target: { files: [new File(["bad"], "교체시도.xlsx")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("상품코드 열이 없습니다.");
    expect(screen.getByText("기존상품.xlsx")).toBeInTheDocument();
    expect(screen.getByText("교체시도.xlsx")).toBeInTheDocument();
    expect(screen.getByText("확정 Excel")).toBeInTheDocument();
    expect(screen.getByText("이번 검증 시도")).toBeInTheDocument();
    expect(start).toBeEnabled();
  });

  it("문서가 있어도 확정 Excel이 없으면 OCR 시작을 막는다", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/documents") ? [makeDocument("document-1", 0)] : makeJob();
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    render(<UploadPage jobId="job-1" />);
    expect(await screen.findByText("document-1.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeDisabled();
  });

  it("문서별 상태와 보정 경고를 표시하고 실패한 문서만 재시도한다", async () => {
    const pending = makeDocument("pending-document", 0, "pending");
    const completed = { ...makeDocument("completed-document", 1, "completed"), correction_warning: "모서리 일부를 찾지 못했습니다." };
    const failed = { ...makeDocument("failed-document", 2, "failed"), processing_error: "사진이 흐립니다." };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => [pending, completed, failed] } as Response;
      if (url.endsWith("/documents/failed-document/extract") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ...failed, status: "completed", processing_error: null }) } as Response;
      }
      return { ok: true, status: 200, json: async () => makeJob("상품.xlsx") } as Response;
    });

    render(<UploadPage jobId="job-1" />);
    expect(await screen.findByText("추출 대기")).toBeInTheDocument();
    expect(screen.getByText("추출 실패")).toBeInTheDocument();
    expect(screen.getByText(/보정 주의: 모서리 일부/)).toBeInTheDocument();
    expect(screen.getByText("사진이 흐립니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "failed-document.jpg 이 문서 재시도" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "failed-document.jpg 이 문서 재시도" })).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/documents/failed-document/extract", expect.objectContaining({ method: "POST" }));
  });

  it("확정 중복 문서를 확인 후 삭제하고 서버에서 재계산한 남은 문서 상태를 반영한다", async () => {
    const duplicate = { ...makeDocument("duplicate-document", 0, "completed"), duplicate_status: "confirmed" as const };
    const remaining = { ...makeDocument("remaining-document", 1, "completed"), duplicate_status: "confirmed" as const };
    let documents: DocumentRead[] = [duplicate, remaining];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/documents/duplicate-document") && init?.method === "DELETE") {
        documents = [{ ...remaining, source_order: 0, duplicate_status: "none" as const }];
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => documents } as Response;
      return { ok: true, status: 200, json: async () => makeJob("상품.xlsx") } as Response;
    });

    render(<UploadPage jobId="job-1" />);

    expect(await screen.findAllByText("확정 중복 · 삭제하여 해소")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "duplicate-document.jpg 삭제" }));
    expect(fetch).not.toHaveBeenCalledWith("/api/documents/duplicate-document", expect.objectContaining({ method: "DELETE" }));
    fireEvent.click(screen.getByRole("button", { name: "duplicate-document.jpg 삭제 확인" }));

    expect(await screen.findByText("duplicate-document.jpg 문서를 삭제했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("duplicate-document.jpg")).not.toBeInTheDocument();
    expect(screen.getByText("remaining-document.jpg")).toBeInTheDocument();
    expect(screen.queryByText("확정 중복 · 삭제하여 해소")).not.toBeInTheDocument();
    expect(screen.getByText("1장")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledWith("/api/documents/duplicate-document", expect.objectContaining({ method: "DELETE" }));
  });

  it("완료 작업을 직접 열면 업로드와 추출 변경 컨트롤을 읽기 전용으로 표시한다", async () => {
    const failed = { ...makeDocument("failed-document", 0, "failed"), processing_error: "사진이 흐립니다." };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => [failed] } as Response;
      return { ok: true, status: 200, json: async () => makeJob("상품.xlsx", "completed") } as Response;
    });

    render(<UploadPage jobId="job-1" />);

    expect(await screen.findByText("완료된 작업 · 읽기 전용")).toBeInTheDocument();
    expect(screen.getByLabelText(/Excel 파일 선택/)).toBeDisabled();
    expect(screen.getByLabelText(/사진 파일 선택/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "선택한 사진 0장 업로드" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "failed-document.jpg 이 문서 재시도" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "failed-document.jpg 삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeDisabled();
    expect(screen.getByText(/업로드 및 추출 내용을 변경할 수 없습니다/)).toBeInTheDocument();
  });

  it("내보내기 중인 작업은 업로드·삭제·추출 변경을 잠그고 이유를 표시한다", async () => {
    const failed = { ...makeDocument("failed-document", 0, "failed"), processing_error: "사진이 흐립니다." };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/documents")) return { ok: true, status: 200, json: async () => [failed] } as Response;
      return { ok: true, status: 200, json: async () => makeJob("상품.xlsx", "exporting") } as Response;
    });

    render(<UploadPage jobId="job-1" />);

    expect(await screen.findByText("내보내기 중 · 편집 잠금")).toBeInTheDocument();
    expect(screen.getByText(/결과 Excel을 생성하는 동안 업로드·삭제·추출 변경을 사용할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Excel 파일 선택/)).toBeDisabled();
    expect(screen.getByLabelText(/사진 파일 선택/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "failed-document.jpg 이 문서 재시도" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "failed-document.jpg 삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OCR 추출 시작" })).toBeDisabled();
  });

  it("StrictMode에서도 임시저장 전에는 작업을 만들지 않고 클릭 후 한 번만 생성한다", async () => {
    let createCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/jobs") && init?.method === "POST") createCount += 1;
      const body = url.endsWith("/documents") ? [] : makeJob();
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    render(<StrictMode><UploadPage /></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText(/Excel 파일 선택/)).toBeEnabled());
    expect(createCount).toBe(0);
    fireEvent.change(screen.getByLabelText(/사진 파일 선택/), {
      target: { files: [new File(["photo"], "명세서.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByText("임시저장이 완료되었습니다.");
    expect(createCount).toBe(1);
  });
});
