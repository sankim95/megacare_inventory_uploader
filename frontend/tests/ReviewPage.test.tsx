import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewPage } from "../src/pages/ReviewPage";
import type { DocumentDetailRead, DocumentRead, ExtractedItemRead, JobRead, ProductCandidate, ReviewSummary } from "../src/types";

const document: DocumentRead = {
  id: "document-1",
  job_id: "job-1",
  source_order: 0,
  original_image_name: "명세서.jpg",
  status: "completed",
  image_sha256: "a".repeat(64),
  has_corrected_image: true,
  correction_applied: true,
  correction_warning: null,
  photo_supplier: "메가상사",
  transaction_date: "2026-08-07",
  invoice_number: "INV-1",
  document_total: 12000,
  processing_error: null,
  model_name: "mock-model",
  prompt_version: "v1",
  duplicate_status: "none",
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
};

const item: ExtractedItemRead = {
  id: "item-1",
  document_id: "document-1",
  source_row_order: 0,
  is_manual: false,
  raw_row_text: "A-01 생수 2L 6 1000 6000",
  ocr_product_code_or_barcode: "A-01",
  ocr_product_name: "생수",
  ocr_specification: "2L",
  ocr_quantity: 6,
  ocr_unit_price: 1000,
  ocr_amount: 6000,
  ocr_bundle_or_set_text: "6개입",
  ocr_confidence_by_field: { product_name: 0.97 },
  extraction_warnings: ["수량 칸 일부가 잘렸습니다."],
  product_code_or_barcode: "A-01",
  product_name: "생수",
  specification: "2L",
  quantity: 6,
  unit_price: 1000,
  amount: 6000,
  bundle_or_set_text: "6개입",
  stock_increment: 6,
  matched_product_code: "A-01",
  matched_product_name: "생수 2L",
  matched_specification: "2L 6입",
  matched_supplier_code: "SUP-01",
  matched_supplier: "백제약품",
  matched_excel_row: 12,
  match_method: "code",
  match_score: 1,
  match_candidates: [],
  base_stock: 10,
  base_purchase_price: 1100,
  apply_inventory: true,
  apply_purchase_price: false,
  review_status: "pending",
  exclusion_reason: null,
  warnings: [],
  notes: null,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
};

const detail: DocumentDetailRead = {
  ...document,
  raw_header_text: "메가상사 거래명세서",
  confidence_by_field: { photo_supplier: 0.93 },
  items: [item],
};

const emptySummary: ReviewSummary = {
  job_id: "job-1",
  ready_to_export: false,
  blockers: [],
  counts: {
    approved_items: 0,
    excluded_items: 0,
    pending_items: 1,
    inventory_products: 0,
    price_products: 0,
  },
  products: [],
};

function manualItem(): ExtractedItemRead {
  return {
    ...item,
    id: "item-manual",
    source_row_order: 1,
    is_manual: true,
    raw_row_text: null,
    ocr_product_code_or_barcode: null,
    ocr_product_name: null,
    ocr_specification: null,
    ocr_quantity: null,
    ocr_unit_price: null,
    ocr_amount: null,
    ocr_bundle_or_set_text: null,
    ocr_confidence_by_field: {},
    product_code_or_barcode: null,
    product_name: null,
    specification: null,
    quantity: null,
    unit_price: null,
    amount: null,
    bundle_or_set_text: null,
    stock_increment: 0,
    matched_product_code: null,
    matched_product_name: null,
    matched_specification: null,
    matched_supplier_code: null,
    matched_supplier: null,
    matched_excel_row: null,
    match_method: null,
    match_score: null,
    match_candidates: [],
    base_stock: null,
    base_purchase_price: null,
  };
}

function candidate(index: number): ProductCandidate {
  return {
    product_code: `P-${index}`,
    product_name: `후보 상품 ${index}`,
    specification: `${index}mg`,
    supplier_code: `S-${index}`,
    supplier: index === 1 ? "백제약품" : `공급사 ${index}`,
    current_stock: index,
    purchase_price: 1000 * index,
    excel_row: index + 10,
    match_method: "similarity",
    score: Math.max(0.5, 1 - index * 0.05),
    price_similarity: 0.9,
  };
}

interface MockReviewOptions {
  detailResponse?: DocumentDetailRead;
  documentResponses?: DocumentRead[];
  detailResponses?: Record<string, DocumentDetailRead>;
  allItems?: ExtractedItemRead[];
  jobStatus?: "draft" | "extracting" | "reviewing" | "exporting" | "completed" | "failed";
  searchResults?: ProductCandidate[];
  searchError?: string;
  searchPromise?: Promise<ProductCandidate[]>;
  matchError?: string;
  registerError?: string;
  patchError?: string;
  firstItemPatchGate?: Promise<void>;
  reviewSummary?: ReviewSummary;
  resolvedSummary?: ReviewSummary;
  exportError?: string;
  exportPromise?: Promise<JobRead>;
  documentPatchError?: string;
}

function mockReviewApi(options: MockReviewOptions = {}) {
  const detailResponse = options.detailResponse || detail;
  let currentDetail = { ...detailResponse };
  const detailResponses = options.detailResponses || { [detailResponse.id]: detailResponse };
  const documentResponses = options.documentResponses || [{ ...detailResponse, items: undefined }];
  let serverItems = [...(options.allItems || detailResponse.items)];
  let currentSummary = options.reviewSummary || emptySummary;
  let itemPatchCount = 0;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/jobs/job-1/review-summary")) return { ok: true, status: 200, json: async () => currentSummary } as Response;
    if (url.includes("/jobs/job-1/price-resolutions/") && init?.method === "PUT") {
      const selectedItemId = JSON.parse(String(init.body)).selected_item_id;
      currentSummary = options.resolvedSummary || {
        ...currentSummary,
        ready_to_export: true,
        blockers: [],
        products: currentSummary.products.map((product) => ({
          ...product,
          price_resolution_method: "manual" as const,
          final_purchase_price: product.price_candidates.find((candidate) => candidate.item_id === selectedItemId)?.unit_price ?? product.final_purchase_price,
          price_candidates: product.price_candidates.map((candidate) => ({ ...candidate, selected: candidate.item_id === selectedItemId })),
        })),
      };
      return { ok: true, status: 200, json: async () => currentSummary } as Response;
    }
    if (url.endsWith("/jobs/job-1/export") && init?.method === "POST") {
      if (options.exportError) return { ok: false, status: 409, json: async () => ({ detail: options.exportError }) } as Response;
      if (options.exportPromise) return { ok: true, status: 200, json: async () => options.exportPromise } as Response;
      return { ok: true, status: 200, json: async () => ({ id: "job-1", status: "completed", original_excel_name: "상품리스트.xlsx", original_excel_sha256: "a".repeat(64), product_count: 2, approved_by: JSON.parse(String(init.body)).approved_by, result_path: "/results/입고결과.xlsx", failure_message: null, created_at: "2026-08-07T01:00:00Z", updated_at: "2026-08-07T02:00:00Z", completed_at: "2026-08-07T02:00:00Z" }) } as Response;
    }
    if (url.endsWith("/jobs/job-1")) return { ok: true, status: 200, json: async () => ({ id: "job-1", status: options.jobStatus || "reviewing", original_excel_name: "상품리스트.xlsx", original_excel_sha256: "a".repeat(64), product_count: 2, approved_by: null, result_path: null, failure_message: null, created_at: "2026-08-07T01:00:00Z", updated_at: "2026-08-07T01:00:00Z", completed_at: options.jobStatus === "completed" ? "2026-08-07T02:00:00Z" : null }) } as Response;
    if (url.endsWith("/jobs/job-1/documents")) return { ok: true, status: 200, json: async () => documentResponses } as Response;
    if (url.endsWith("/jobs/job-1/items/bulk") && init?.method === "PATCH") {
      const payload = JSON.parse(String(init.body));
      const selected = serverItems.filter((entry) => payload.item_ids?.includes(entry.id) || payload.target_review_status === entry.review_status);
      const changes = Object.fromEntries(Object.entries(payload).filter(([key]) => !["item_ids", "target_review_status"].includes(key)));
      const updated = selected.map((entry) => ({ ...entry, ...changes }));
      const updatedById = new Map(updated.map((entry) => [entry.id, entry]));
      serverItems = serverItems.map((entry) => updatedById.get(entry.id) || entry);
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.endsWith("/jobs/job-1/items")) return { ok: true, status: 200, json: async () => serverItems } as Response;
    if (url.endsWith("/jobs/job-1/match") && init?.method === "POST") {
      if (options.matchError) return { ok: false, status: 500, json: async () => ({ detail: options.matchError }) } as Response;
      return { ok: true, status: 200, json: async () => [detailResponse] } as Response;
    }
    if (url.includes("/jobs/job-1/products/search?")) {
      if (options.searchError) return { ok: false, status: 500, json: async () => ({ detail: options.searchError }) } as Response;
      if (options.searchPromise) return { ok: true, status: 200, json: async () => options.searchPromise } as Response;
      return { ok: true, status: 200, json: async () => options.searchResults || [] } as Response;
    }
    if (url.endsWith("/items/item-1/match") && init?.method === "PUT") {
      const payload = JSON.parse(String(init.body));
      const productCode = payload.product_code;
      const selected = (options.searchResults || detailResponse.items[0].match_candidates).find((entry) => entry.product_code === productCode) || candidate(1);
      const updated = {
        ...detailResponse.items[0],
        matched_product_code: selected.product_code,
        matched_product_name: selected.product_name,
        matched_specification: selected.specification,
        matched_supplier_code: selected.supplier_code,
        matched_supplier: selected.supplier,
        matched_excel_row: selected.excel_row,
        match_method: "manual" as const,
        match_score: selected.score,
        base_stock: selected.current_stock,
        base_purchase_price: selected.purchase_price,
        review_status: payload.approve && detailResponse.items[0].stock_increment !== null ? "approved" as const : detailResponse.items[0].review_status,
      };
      serverItems = serverItems.map((entry) => entry.id === updated.id ? updated : entry);
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.endsWith("/items/item-1/match") && init?.method === "DELETE") {
      const updated = {
        ...detailResponse.items[0],
        matched_product_code: null,
        matched_product_name: null,
        matched_specification: null,
        matched_supplier_code: null,
        matched_supplier: null,
        matched_excel_row: null,
        match_method: null,
        match_score: null,
        base_stock: null,
        base_purchase_price: null,
      };
      serverItems = serverItems.map((entry) => entry.id === updated.id ? updated : entry);
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.endsWith("/items/item-1/register-product") && init?.method === "POST") {
      if (options.registerError) return { ok: false, status: 409, json: async () => ({ detail: options.registerError }) } as Response;
      const payload = JSON.parse(String(init.body));
      const updated = {
        ...detailResponse.items[0],
        matched_product_code: payload.product_code,
        matched_product_name: payload.product_name,
        matched_specification: payload.specification,
        matched_supplier_code: payload.supplier_code,
        matched_supplier: payload.supplier,
        matched_excel_row: 13,
        match_method: "manual" as const,
        match_score: null,
        base_stock: payload.current_stock,
        base_purchase_price: payload.purchase_price,
        review_status: detailResponse.items[0].stock_increment !== null ? "approved" as const : detailResponse.items[0].review_status,
      };
      serverItems = serverItems.map((entry) => entry.id === updated.id ? updated : entry);
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.endsWith("/items/item-1") && init?.method === "PATCH") {
      if (options.patchError) return { ok: false, status: 409, json: async () => ({ detail: options.patchError }) } as Response;
      const patchIndex = itemPatchCount++;
      if (patchIndex === 0 && options.firstItemPatchGate) {
        await options.firstItemPatchGate;
      }
      const current = serverItems.find((entry) => entry.id === "item-1") || item;
      const updated = { ...current, ...JSON.parse(String(init.body)) };
      serverItems = serverItems.map((entry) => entry.id === updated.id ? updated : entry);
      return { ok: true, status: 200, json: async () => updated } as Response;
    }
    if (url.endsWith("/documents/document-1/items") && init?.method === "POST") {
      return { ok: true, status: 201, json: async () => manualItem() } as Response;
    }
    if (url.endsWith("/documents/document-1") && init?.method === "PATCH") {
      if (options.documentPatchError) return { ok: false, status: 409, json: async () => ({ detail: options.documentPatchError }) } as Response;
      currentDetail = { ...currentDetail, ...JSON.parse(String(init.body)) };
      return { ok: true, status: 200, json: async () => currentDetail } as Response;
    }
    const documentMatch = url.match(/\/documents\/([^/?]+)$/);
    if (documentMatch) {
      const requestedDetail = documentMatch[1] === currentDetail.id ? currentDetail : detailResponses[documentMatch[1]];
      if (requestedDetail) {
        return { ok: true, status: 200, json: async () => ({ ...requestedDetail, items: requestedDetail.items.map((entry) => serverItems.find((serverItem) => serverItem.id === entry.id) || entry) }) } as Response;
      }
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  });
}

describe("사진과 품목 검수", () => {
  it("현재 작업의 업로드·문서 관리 화면으로 돌아갈 수 있다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    await screen.findByRole("heading", { name: "추출 품목" });
    expect(screen.getByRole("link", { name: "업로드·문서 관리" })).toHaveAttribute("href", "/jobs/job-1/upload");
  });

  it("보류 항목이 있는 사진만 사진별 검수 목록에 표시하고 전체 문서 보기로 전환한다", async () => {
    const approvedItem = { ...item, review_status: "approved" as const };
    const secondDocument = { ...document, id: "document-2", source_order: 1, original_image_name: "둘째 명세서.jpg" };
    const pendingItem = { ...item, id: "item-2", document_id: secondDocument.id, product_name: "보류 상품" };
    const firstDetail = { ...detail, items: [approvedItem] };
    const secondDetail = { ...detail, ...secondDocument, items: [pendingItem] };
    mockReviewApi({
      detailResponse: firstDetail,
      documentResponses: [document, secondDocument],
      detailResponses: { [document.id]: firstDetail, [secondDocument.id]: secondDetail },
      allItems: [approvedItem, pendingItem],
    });
    render(<ReviewPage jobId="job-1" />);

    const pendingDocuments = await screen.findByLabelText("보류 사진");
    expect(within(pendingDocuments).getAllByRole("option")).toHaveLength(1);
    expect(within(pendingDocuments).getByRole("option", { name: "2. 둘째 명세서.jpg (보류 1개)" })).toBeInTheDocument();
    expect(await screen.findByLabelText("1번 행 상품명")).toHaveValue("보류 상품");

    fireEvent.click(screen.getByLabelText("보류 항목만 검수"));
    const allDocuments = await screen.findByLabelText("검수 문서");
    expect(within(allDocuments).getAllByRole("option")).toHaveLength(2);
    expect(within(allDocuments).getByRole("option", { name: "1. 명세서.jpg" })).toBeInTheDocument();
    expect(within(allDocuments).getByRole("option", { name: "2. 둘째 명세서.jpg (보류 1개)" })).toBeInTheDocument();

    fireEvent.change(allDocuments, { target: { value: document.id } });
    expect(await screen.findByLabelText("1번 행 상품명")).toHaveValue("생수");
    fireEvent.click(await screen.findByRole("button", { name: "보류 1개 검수하기" }));
    expect(screen.getByLabelText("보류 항목만 검수")).toBeChecked();
    expect(await screen.findByLabelText("1번 행 상품명")).toHaveValue("보류 상품");
  });

  it("추출 품목 헤더에서 원본 사진을 열고 클릭할 때마다 90도 회전한다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    await screen.findByLabelText("사진 공급자");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "원본 사진 보기" }));

    const dialog = screen.getByRole("dialog", { name: "원본 사진" });
    const photo = within(dialog).getByRole("img", { name: "명세서.jpg 원본" });
    expect(photo).toHaveAttribute("src", "/api/documents/document-1/image?variant=original");
    expect(photo).toHaveStyle({ transform: "rotate(0deg)" });
    const rotate = within(dialog).getByRole("button", { name: "원본 사진 시계 방향으로 90도 회전" });
    fireEvent.click(rotate);
    expect(photo).toHaveStyle({ transform: "rotate(90deg)" });
    fireEvent.click(rotate);
    expect(photo).toHaveStyle({ transform: "rotate(180deg)" });
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "원본 사진" })).not.toBeInTheDocument();
  });

  it("OCR 원문과 현재 값을 구분하고 blur 시 수정 필드만 자동 저장한다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    const productName = await screen.findByLabelText("1번 행 상품명");
    expect(productName).toHaveValue("생수");
    expect(screen.getByText("OCR 원문: 생수")).toBeInTheDocument();
    expect(screen.getByText("수량 칸 일부가 잘렸습니다.")).toBeInTheDocument();
    fireEvent.change(productName, { target: { value: "제주 생수" } });
    fireEvent.blur(productName);

    expect(await screen.findByText("1번 행 저장됨")).toBeInTheDocument();
    const patchCall = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ product_name: "제주 생수" });
  });

  it("같은 행의 자동저장을 직렬화해 지연 응답이 최신 입력을 덮어쓰지 않는다", async () => {
    let releaseFirstPatch!: () => void;
    const firstPatchGate = new Promise<void>((resolve) => { releaseFirstPatch = resolve; });
    mockReviewApi({ firstItemPatchGate: firstPatchGate });
    render(<ReviewPage jobId="job-1" />);

    const productName = await screen.findByLabelText("1번 행 상품명");
    const notes = screen.getByLabelText("1번 행 메모");
    fireEvent.change(productName, { target: { value: "제주 생수" } });
    fireEvent.blur(productName);
    fireEvent.change(notes, { target: { value: "동시 메모" } });
    fireEvent.blur(notes);

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH")).toHaveLength(1);
    });
    releaseFirstPatch();
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH")).toHaveLength(2);
    });
    expect(await screen.findByText("1번 행 저장됨")).toBeInTheDocument();

    const patchBodies = vi.mocked(fetch).mock.calls
      .filter(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(patchBodies).toEqual([
      { product_name: "제주 생수" },
      { notes: "동시 메모" },
    ]);
    expect(screen.getByLabelText("1번 행 상품명")).toHaveValue("제주 생수");
    expect(screen.getByLabelText("1번 행 메모")).toHaveValue("동시 메모");
  });

  it("문서 메타데이터를 접근 가능한 입력으로 수정하고 blur 시 집계와 품목을 갱신한다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    const supplier = await screen.findByLabelText("사진 공급자");
    expect(supplier).toHaveValue("메가상사");
    expect(screen.getByLabelText("거래일")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("명세서 번호")).toHaveValue("INV-1");
    expect(screen.queryByLabelText("문서 합계")).not.toBeInTheDocument();

    fireEvent.change(supplier, { target: { value: "새 공급사" } });
    fireEvent.blur(supplier);

    expect(await screen.findByText("사진 공급자 저장됨")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/documents/document-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ photo_supplier: "새 공급사" }) }));
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/jobs/job-1/items"))).toHaveLength(2);
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/jobs/job-1/review-summary"))).toHaveLength(2);
    });
    expect(screen.getByLabelText("사진 공급자")).toHaveValue("새 공급사");
  });

  it("문서 메타데이터 저장에 실패하면 서버 최신값으로 입력을 복구한다", async () => {
    mockReviewApi({ documentPatchError: "다른 사용자가 먼저 수정했습니다." });
    render(<ReviewPage jobId="job-1" />);

    const supplier = await screen.findByLabelText("사진 공급자");
    fireEvent.change(supplier, { target: { value: "저장되지 않은 공급사" } });
    expect(supplier).toHaveValue("저장되지 않은 공급사");
    fireEvent.blur(supplier);

    expect(await screen.findByRole("alert")).toHaveTextContent("다른 사용자가 먼저 수정했습니다.");
    await waitFor(() => expect(screen.getByLabelText("사진 공급자")).toHaveValue("메가상사"));
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/documents/document-1") && !init?.method)).toHaveLength(2);
  });

  it("누락된 품목을 수기 행으로 추가한다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);
    await screen.findByLabelText("1번 행 상품명");

    fireEvent.click(screen.getByRole("button", { name: "누락 행 추가" }));
    expect(await screen.findByText("수기")).toBeInTheDocument();
    expect(screen.getByText("수기 행을 추가했습니다.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/documents/document-1/items", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("region", { name: "보류 항목 바로가기" })).toHaveTextContent("보류 항목 2개");
  });

  it("자동 매칭을 실행한 뒤 서버의 최신 문서와 품목을 다시 불러온다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);
    await screen.findByLabelText("1번 행 상품명");

    fireEvent.click(screen.getByRole("button", { name: "자동 매칭 실행" }));
    expect(await screen.findByText(/자동 매칭이 완료되었습니다/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/match", expect.objectContaining({ method: "POST" }));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/documents/document-1"))).toHaveLength(2);
  });

  it("상태와 두 반영 체크를 각각 즉시 저장하며 서로의 값을 덮어쓰지 않는다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    const inventory = await screen.findByLabelText("1번 행 재고 반영");
    fireEvent.click(inventory);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH" && String(init.body) === JSON.stringify({ apply_inventory: false }))).toBe(true));

    const status = screen.getByLabelText("1번 행 검수 상태");
    fireEvent.change(status, { target: { value: "approved" } });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH" && String(init.body) === JSON.stringify({ review_status: "approved" }))).toBe(true));
    expect(await screen.findByText("보류 검수가 끝났습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("보류 항목만 검수"));
    await screen.findByLabelText("1번 행 재고 반영");
    expect(screen.getByLabelText("1번 행 재고 반영")).not.toBeChecked();

    fireEvent.click(screen.getByLabelText("1번 행 매입단가 반영"));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body) === JSON.stringify({ apply_purchase_price: true }))).toBe(true));
  });

  it("저장이 지연돼도 클릭한 체크와 상태를 화면에 즉시 반영하고 연속 입력을 허용한다", async () => {
    let releaseFirstPatch!: () => void;
    const firstPatchGate = new Promise<void>((resolve) => { releaseFirstPatch = resolve; });
    mockReviewApi({ firstItemPatchGate: firstPatchGate });
    render(<ReviewPage jobId="job-1" />);

    fireEvent.click(await screen.findByLabelText("보류 항목만 검수"));
    const inventory = await screen.findByLabelText("1번 행 재고 반영");
    fireEvent.click(inventory);

    expect(inventory).not.toBeChecked();
    const status = screen.getByLabelText("1번 행 검수 상태");
    expect(status).toBeEnabled();
    fireEvent.change(status, { target: { value: "approved" } });
    expect(status).toHaveValue("approved");
    expect(screen.getByRole("button", { name: "보류 0개 검수하기" })).toBeDisabled();

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH")).toHaveLength(1);
    });
    releaseFirstPatch();
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/items/item-1") && init?.method === "PATCH")).toHaveLength(2);
    });
    expect(await screen.findByText("1번 행 저장됨")).toBeInTheDocument();
  });

  it("전체 집계에서 매칭·미매칭 보류 항목과 상품별 상태를 바로 표시한다", async () => {
    const unmatched = { ...manualItem(), document_id: document.id, product_name: "미매칭 보류약" };
    const summary: ReviewSummary = {
      ...emptySummary,
      counts: { ...emptySummary.counts, pending_items: 2 },
      products: [{
        product_code: "A-01",
        product_name: "생수 2L",
        base_stock: 10,
        stock_increment: 0,
        final_stock: 10,
        base_purchase_price: 1100,
        final_purchase_price: 1100,
        item_ids: [item.id],
        price_resolution_method: null,
        price_candidates: [],
      }],
    };
    mockReviewApi({ detailResponse: { ...detail, items: [item, unmatched] }, allItems: [item, unmatched], reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    const pendingOverview = await screen.findByRole("region", { name: "보류 항목 바로가기" });
    expect(within(pendingOverview).getByRole("button", { name: "명세서.jpg 1번 행 생수 보류 항목 검수" })).toBeInTheDocument();
    expect(within(pendingOverview).getByRole("button", { name: "명세서.jpg 2번 행 미매칭 보류약 보류 항목 검수" })).toHaveTextContent("미매칭");
    expect(within(screen.getByLabelText("A-01 검수 상태")).getByText("보류 1")).toBeInTheDocument();

    fireEvent.click(within(pendingOverview).getByRole("button", { name: "명세서.jpg 1번 행 생수 보류 항목 검수" }));
    expect(await screen.findByRole("complementary", { name: "선택 상품 바로 수정" })).toBeInTheDocument();
  });

  it("미매칭 또는 유효하지 않은 +재고 행의 승인을 비활성화하고 이유를 표시한다", async () => {
    const unmatched = { ...item, matched_product_code: null, stock_increment: null };
    mockReviewApi({ detailResponse: { ...detail, items: [unmatched] }, allItems: [unmatched] });
    render(<ReviewPage jobId="job-1" />);

    const status = await screen.findByLabelText("1번 행 검수 상태");
    expect(within(status).getByRole("option", { name: "승인" })).toBeDisabled();
    expect(screen.getByText(/승인 불가: 상품 매칭과 유효한 \+재고가 필요합니다/)).toBeInTheDocument();
  });

  it("제외 사유를 상태 변경과 함께 저장한다", async () => {
    mockReviewApi();
    render(<ReviewPage jobId="job-1" />);

    const reason = await screen.findByLabelText("1번 행 제외 사유");
    fireEvent.change(reason, { target: { value: "중복 기입" } });
    fireEvent.change(screen.getByLabelText("1번 행 검수 상태"), { target: { value: "excluded" } });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => String(init?.body) === JSON.stringify({ review_status: "excluded", exclusion_reason: "중복 기입" }))).toBe(true));
  });

  it("현재 필터와 무관하게 작업 전체 승인 행의 3상태 마스터를 계산하고 변경한다", async () => {
    const checked = { ...item, review_status: "approved" as const, apply_inventory: true };
    const unchecked = { ...item, id: "item-2", document_id: "document-2", review_status: "approved" as const, apply_inventory: false };
    mockReviewApi({ detailResponse: { ...detail, items: [checked] }, allItems: [checked, unchecked] });
    render(<ReviewPage jobId="job-1" />);

    const master = await screen.findByRole("checkbox", { name: "승인 상태 전체 재고 반영 (작업 전체)" });
    expect(master).not.toBeChecked();
    expect((master as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.change(screen.getByLabelText("검수 상태 필터"), { target: { value: "pending" } });
    expect((master as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(master);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/items/bulk", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ target_review_status: "approved", apply_inventory: true }) })));
  });

  it("현재 문서의 필터 결과 ID만 일괄 상태 변경한다", async () => {
    const warningItem = { ...item, id: "item-2", source_row_order: 1, warnings: [{ code: "check", message: "확인 필요", evidence: {} }] };
    mockReviewApi({ detailResponse: { ...detail, items: [item, warningItem] }, allItems: [item, warningItem] });
    render(<ReviewPage jobId="job-1" />);
    await screen.findByLabelText("1번 행 상품명");

    fireEvent.change(screen.getByLabelText("경고 필터"), { target: { value: "with_warnings" } });
    fireEvent.change(screen.getByLabelText("필터 결과 상태 변경"), { target: { value: "approved" } });
    fireEvent.click(screen.getByRole("button", { name: "필터 결과에 적용" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/items/bulk", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ item_ids: ["item-2"], review_status: "approved" }) })));
  });

  it("자동 저장 오류를 표시하고 서버 최신값으로 복구한다", async () => {
    mockReviewApi({ patchError: "승인된 행은 상품 매칭이 필요합니다." });
    render(<ReviewPage jobId="job-1" />);

    const productName = await screen.findByLabelText("1번 행 상품명");
    fireEvent.change(productName, { target: { value: "잘못된 값" } });
    fireEvent.blur(productName);

    expect(await screen.findByRole("alert", { name: "1번 행 저장 오류" })).toHaveTextContent("승인된 행은 상품 매칭이 필요합니다.");
    await waitFor(() => expect(screen.getByLabelText("1번 행 상품명")).toHaveValue("생수"));
  });

  it("완료 작업은 검수 화면을 읽기 전용으로 표시한다", async () => {
    mockReviewApi({ jobStatus: "completed" });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByText("완료된 작업 · 읽기 전용")).toBeInTheDocument();
    expect(await screen.findByLabelText("1번 행 상품명")).toBeDisabled();
    expect(screen.getByLabelText("1번 행 검수 상태")).toBeDisabled();
    expect(screen.getByLabelText("1번 행 재고 반영")).toBeDisabled();
    expect(screen.getByRole("button", { name: "자동 매칭 실행" })).toBeDisabled();
  });

  it("서버가 내보내기 중이면 모든 변경 입력과 일괄 조작을 잠그고 이유를 표시한다", async () => {
    mockReviewApi({ jobStatus: "exporting" });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByText("내보내기 진행 중 · 편집 잠금")).toBeInTheDocument();
    expect(screen.getByText("결과 Excel을 생성하는 동안 편집이 잠겼습니다.")).toBeInTheDocument();
    expect(await screen.findByLabelText("1번 행 상품명")).toBeDisabled();
    expect(screen.getByLabelText("사진 공급자")).toBeDisabled();
    expect(screen.getByLabelText("거래일")).toBeDisabled();
    expect(screen.getByLabelText("명세서 번호")).toBeDisabled();
    expect(screen.queryByLabelText("문서 합계")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1번 행 재고 반영")).toBeDisabled();
    expect(screen.getByLabelText("1번 행 검수 상태")).toBeDisabled();
    expect(screen.getByLabelText("필터 결과 상태 변경")).toBeDisabled();
    expect(screen.getByRole("button", { name: "필터 결과에 적용" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "보류 상태 전체 재고 반영 (작업 전체)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "자동 매칭 실행" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "누락 행 추가" })).toBeDisabled();
    expect(screen.getByLabelText("승인자 이름")).toBeDisabled();
  });

  it("최대 5개 후보와 구조화 경고·확정 중복 근거를 표시한다", async () => {
    const unmatched = {
      ...item,
      matched_product_code: null,
      matched_product_name: null,
      matched_specification: null,
      matched_supplier_code: null,
      matched_supplier: null,
      matched_excel_row: null,
      match_method: null,
      match_score: null,
      match_candidates: [1, 2, 3, 4, 5, 6].map(candidate),
      base_stock: null,
      base_purchase_price: null,
      warnings: [{ code: "SUPPLIER_MISMATCH", message: "사진 공급자와 Excel 공급사가 다릅니다.", evidence: { photo_supplier: "메가상사", excel_supplier: "백제약품" } }],
    } satisfies ExtractedItemRead;
    mockReviewApi({ detailResponse: { ...detail, duplicate_status: "confirmed", items: [unmatched] } });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByText("확정 중복 명세서")).toBeInTheDocument();
    expect(screen.getByText("미매칭")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /후보 상품 .* 상품 선택·반영/ })).toHaveLength(5);
    expect(screen.getByText("SUPPLIER_MISMATCH")).toBeInTheDocument();
    expect(screen.getByText("사진 공급자와 Excel 공급사가 다릅니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("사진 공급자")).toHaveValue("메가상사");
    expect(screen.getByText("메가상사")).toBeInTheDocument();
  });

  it("중복 의심 문서는 검수를 계속할 수 있는 경고로 표시한다", async () => {
    mockReviewApi({ detailResponse: { ...detail, duplicate_status: "suspected" } });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByText("중복 의심 명세서")).toBeInTheDocument();
    expect(screen.getByText(/이미지와 문서 정보를 확인/)).toBeInTheDocument();
  });

  it("상품 검색의 로딩과 빈 결과를 접근 가능한 상태로 표시한다", async () => {
    let finishSearch!: (results: ProductCandidate[]) => void;
    const searchPromise = new Promise<ProductCandidate[]>((resolve) => { finishSearch = resolve; });
    mockReviewApi({ searchPromise });
    render(<ReviewPage jobId="job-1" />);
    const searchInput = await screen.findByRole("textbox", { name: "1번 행 생수 상품리스트 검색" });
    fireEvent.change(searchInput, { target: { value: "없는 상품" } });
    fireEvent.click(screen.getByRole("button", { name: "1번 행 상품리스트 검색 실행" }));

    expect(screen.getByRole("button", { name: "1번 행 상품리스트 검색 실행" })).toBeDisabled();
    finishSearch([]);
    expect(await screen.findByText(/검색 결과가 없습니다/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/products/search?query=%EC%97%86%EB%8A%94+%EC%83%81%ED%92%88&limit=5", expect.any(Object));
  });

  it("검색 오류를 표시하고 결과를 명시적으로 선택한 뒤 매칭을 해제한다", async () => {
    mockReviewApi({ searchError: "상품 색인을 읽지 못했습니다." });
    const { unmount } = render(<ReviewPage jobId="job-1" />);
    const input = await screen.findByRole("textbox", { name: "1번 행 생수 상품리스트 검색" });
    fireEvent.change(input, { target: { value: "마운자로" } });
    fireEvent.click(screen.getByRole("button", { name: "1번 행 상품리스트 검색 실행" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("상품 색인을 읽지 못했습니다.");
    unmount();

    mockReviewApi({ searchResults: [candidate(1)] });
    render(<ReviewPage jobId="job-1" />);
    fireEvent.click(await screen.findByLabelText("보류 항목만 검수"));
    const successInput = await screen.findByRole("textbox", { name: "1번 행 생수 상품리스트 검색" });
    fireEvent.change(successInput, { target: { value: "마운자로" } });
    fireEvent.click(screen.getByRole("button", { name: "1번 행 상품리스트 검색 실행" }));
    fireEvent.click(await screen.findByRole("button", { name: "P-1 후보 상품 1 상품 선택·반영" }));
    expect(await screen.findByText("최종 공급처 (Excel)")).toBeInTheDocument();
    expect(screen.getAllByText("백제약품 (S-1)")).not.toHaveLength(0);
    expect(screen.getByLabelText("1번 행 검수 상태")).toHaveValue("approved");
    expect(fetch).toHaveBeenCalledWith("/api/items/item-1/match", expect.objectContaining({ method: "PUT", body: JSON.stringify({ product_code: "P-1", approve: true }) }));

    fireEvent.click(screen.getByRole("button", { name: "1번 행 후보 상품 1 매칭 해제" }));
    expect(await screen.findByText("상품 매칭을 해제했습니다.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/items/item-1/match", expect.objectContaining({ method: "DELETE" }));
  });

  it("미매칭 품목을 사용자 직접 등록하고 현재 행에 바로 반영한다", async () => {
    const unmatched = {
      ...item,
      product_code_or_barcode: null,
      matched_product_code: null,
      matched_product_name: null,
      matched_specification: null,
      matched_supplier_code: null,
      matched_supplier: null,
      matched_excel_row: null,
      match_method: null,
      match_score: null,
      base_stock: null,
      base_purchase_price: null,
    } satisfies ExtractedItemRead;
    mockReviewApi({ detailResponse: { ...detail, items: [unmatched] }, allItems: [unmatched] });
    render(<ReviewPage jobId="job-1" />);

    fireEvent.click(await screen.findByLabelText("보류 항목만 검수"));
    fireEvent.click(await screen.findByRole("button", { name: "사용자 직접 등록" }));
    fireEvent.change(screen.getByRole("textbox", { name: "1번 행 신규 상품코드" }), { target: { value: "NEW-001" } });
    fireEvent.change(screen.getByRole("textbox", { name: "1번 행 신규 상품명" }), { target: { value: "신규 입고 상품" } });
    fireEvent.change(screen.getByRole("textbox", { name: "1번 행 신규 상품 규격" }), { target: { value: "30정" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "1번 행 신규 상품 현재고" }), { target: { value: "4" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "1번 행 신규 상품 매입단가" }), { target: { value: "1300" } });
    fireEvent.change(screen.getByRole("textbox", { name: "1번 행 신규 상품 공급사코드" }), { target: { value: "SUP-N" } });
    fireEvent.change(screen.getByRole("textbox", { name: "1번 행 신규 상품 공급사" }), { target: { value: "신규 공급사" } });
    fireEvent.click(screen.getByRole("button", { name: "1번 행 신규 상품 등록·반영" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/items/item-1/register-product", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ product_code: "NEW-001", product_name: "신규 입고 상품", specification: "30정", current_stock: 4, purchase_price: 1300, supplier_code: "SUP-N", supplier: "신규 공급사" }),
    })));
    expect(await screen.findByText("신규 입고 상품")).toBeInTheDocument();
    expect(screen.getByText("NEW-001")).toBeInTheDocument();
    expect(screen.getByLabelText("1번 행 검수 상태")).toHaveValue("approved");
  });

  it("반복 품목의 검색과 매칭 해제 컨트롤을 행별로 구분한다", async () => {
    const second = { ...item, id: "item-2", source_row_order: 1, product_name: "주스", matched_product_name: "주스 1L" };
    mockReviewApi({ detailResponse: { ...detail, items: [item, second] }, allItems: [item, second] });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByRole("textbox", { name: "1번 행 생수 상품리스트 검색" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "2번 행 주스 상품리스트 검색" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1번 행 생수 2L 매칭 해제" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2번 행 주스 1L 매칭 해제" })).toBeInTheDocument();
  });

  it("AC-06 상품 집계의 최종재고를 같은 상품의 모든 관련 행에 표시한다", async () => {
    const second = { ...item, id: "item-2", source_row_order: 1, stock_increment: 3 };
    const summary: ReviewSummary = {
      ...emptySummary,
      counts: { approved_items: 2, excluded_items: 0, pending_items: 0, inventory_products: 1, price_products: 0 },
      products: [{
        product_code: "A-01",
        product_name: "생수 2L",
        base_stock: 10,
        stock_increment: 5,
        final_stock: 15,
        base_purchase_price: 1100,
        final_purchase_price: 1100,
        item_ids: ["item-1", "item-2"],
        price_resolution_method: null,
        price_candidates: [],
      }],
    };
    mockReviewApi({ detailResponse: { ...detail, items: [item, second] }, allItems: [item, second], reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    const aggregate = await screen.findByRole("region", { name: "작업 전체 반영 집계" });
    expect(within(aggregate).getByText("15")).toBeInTheDocument();
    expect(within(await screen.findByLabelText("1번 행 반영 예상값")).getByText("15")).toBeInTheDocument();
    expect(within(await screen.findByLabelText("2번 행 반영 예상값")).getByText("15")).toBeInTheDocument();
  });

  it("집계 상품을 클릭하면 이동 없이 분할 편집 화면을 열고 값을 저장한다", async () => {
    const second = { ...item, id: "item-2", source_row_order: 1, product_name: "생수 묶음" };
    const summary: ReviewSummary = {
      ...emptySummary,
      products: [{
        product_code: "A-01",
        product_name: "생수 2L",
        base_stock: 10,
        stock_increment: 0,
        final_stock: 10,
        base_purchase_price: 1100,
        final_purchase_price: 1100,
        item_ids: ["item-1", "item-2"],
        price_resolution_method: null,
        price_candidates: [],
      }],
    };
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    mockReviewApi({ detailResponse: { ...detail, items: [item, second] }, allItems: [item, second], reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "A-01 생수 2L 바로 수정" }));

    const splitEditor = screen.getByRole("complementary", { name: "선택 상품 바로 수정" });
    expect(within(splitEditor).getByRole("heading", { name: "생수 2L" })).toBeInTheDocument();
    expect(within(splitEditor).queryByRole("textbox", { name: "명세서.jpg 1번 행 메모" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "추출 품목" })).not.toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(within(splitEditor).getByRole("button", { name: /명세서.jpg 2번 행/ }));
    expect(within(splitEditor).getByRole("textbox", { name: "명세서.jpg 2번 행 상품명" })).toHaveValue("생수 묶음");
    fireEvent.click(within(splitEditor).getByRole("button", { name: /명세서.jpg 1번 행/ }));

    const stockInput = within(splitEditor).getByRole("spinbutton", { name: "명세서.jpg 1번 행 재고 증가" });
    fireEvent.change(stockInput, { target: { value: "8" } });
    fireEvent.blur(stockInput);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/items/item-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ stock_increment: 8 }) })));
    expect(await within(splitEditor).findByText("1번 행 저장됨")).toBeInTheDocument();
  });

  it("AC-07 최신 거래일 충돌 후보만 선택하고 수동 해결 결과를 반영한다", async () => {
    const summary: ReviewSummary = {
      ...emptySummary,
      blockers: [{ code: "UNRESOLVED_PRICE", message: "대표 매입단가를 선택해야 합니다.", item_ids: ["item-1", "item-2", "item-3"], document_ids: ["document-1", "document-2", "document-3"] }],
      products: [{
        product_code: "A-01",
        product_name: "생수 2L",
        base_stock: 10,
        stock_increment: 5,
        final_stock: 15,
        base_purchase_price: 9000,
        final_purchase_price: null,
        item_ids: ["item-1", "item-2", "item-3"],
        price_resolution_method: "unresolved",
        price_candidates: [
          { item_id: "item-1", document_id: "document-1", document_name: "8월1일.jpg", transaction_date: "2026-08-01", unit_price: 10000, quantity: 1, selected: false },
          { item_id: "item-2", document_id: "document-2", document_name: "8월3일-a.jpg", transaction_date: "2026-08-03", unit_price: 11000, quantity: 2, selected: false },
          { item_id: "item-3", document_id: "document-3", document_name: "8월3일-b.jpg", transaction_date: "2026-08-03", unit_price: 12000, quantity: 3, selected: false },
        ],
      }],
    };
    mockReviewApi({ reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    const oldCandidate = await screen.findByRole("radio", { name: /A-01 8월1일.jpg 2026-08-01 10,000원 대표 단가/ });
    expect(oldCandidate).toBeDisabled();
    expect(screen.getByText("최신 거래일 아님")).toBeInTheDocument();
    const latestCandidate = screen.getByRole("radio", { name: /A-01 8월3일-b.jpg 2026-08-03 12,000원 대표 단가/ });
    expect(latestCandidate).toBeEnabled();
    fireEvent.click(latestCandidate);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/price-resolutions/A-01", expect.objectContaining({ method: "PUT", body: JSON.stringify({ selected_item_id: "item-3" }) })));
    expect(await screen.findByText("사용자 수동 선택으로 해결됨")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /A-01 8월3일-b.jpg/ })).toBeChecked();
  });

  it("거래일 누락 충돌에서는 비교할 수 없어 모든 후보를 선택 가능하게 한다", async () => {
    const summary: ReviewSummary = {
      ...emptySummary,
      products: [{
        product_code: "A-01",
        product_name: "생수 2L",
        base_stock: 10,
        stock_increment: 0,
        final_stock: 10,
        base_purchase_price: 9000,
        final_purchase_price: null,
        item_ids: ["item-1", "item-2"],
        price_resolution_method: "unresolved",
        price_candidates: [
          { item_id: "item-1", document_id: "document-1", document_name: "날짜없음.jpg", transaction_date: null, unit_price: 10000, quantity: 1, selected: false },
          { item_id: "item-2", document_id: "document-2", document_name: "날짜있음.jpg", transaction_date: "2026-08-03", unit_price: 11000, quantity: 1, selected: false },
        ],
      }],
    };
    mockReviewApi({ reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByRole("radio", { name: /A-01 날짜없음.jpg 날짜 없음/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /A-01 날짜있음.jpg 2026-08-03/ })).toBeEnabled();
  });

  it("자동 단가 해결 근거를 특정 날짜 규칙으로 단정하지 않는다", async () => {
    const summary: ReviewSummary = {
      ...emptySummary,
      products: [{
        product_code: "A-01", product_name: "생수 2L", base_stock: 10, stock_increment: 0, final_stock: 10,
        base_purchase_price: 9000, final_purchase_price: 10000, item_ids: ["item-1"], price_resolution_method: "automatic", price_candidates: [],
      }],
    };
    mockReviewApi({ reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByText("업무 규칙으로 자동 해결됨")).toBeInTheDocument();
    expect(screen.queryByText("최신 거래일 기준 자동 해결됨")).not.toBeInTheDocument();
  });

  it("차단 원인과 다음 행동을 표시하고 승인자 또는 사전검증이 없으면 내보내기를 막는다", async () => {
    mockReviewApi({ reviewSummary: { ...emptySummary, blockers: [
      { code: "PENDING_ITEMS", message: "보류 품목 1개가 남아 있습니다.", item_ids: ["item-1"], document_ids: ["document-1"] },
      { code: "INVALID_APPROVED_STOCK", message: "승인 품목의 재고 증가값이 올바르지 않습니다.", item_ids: ["item-1"], document_ids: ["document-1"] },
    ] } });
    render(<ReviewPage jobId="job-1" />);

    expect(await screen.findByRole("alert", { name: "내보내기 차단 사유" })).toHaveTextContent("보류 품목 1개가 남아 있습니다.");
    expect(screen.getByRole("alert", { name: "내보내기 차단 사유" })).toHaveTextContent("다음 행동: 보류 품목을 승인 또는 제외하세요.");
    expect(screen.getByRole("alert", { name: "내보내기 차단 사유" })).toHaveTextContent("다음 행동: +재고를 0 이상의 정수로 수정하세요.");
    expect(screen.getByRole("button", { name: "결과 Excel 생성" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("승인자 이름"), { target: { value: "홍길동" } });
    expect(screen.getByRole("button", { name: "결과 Excel 생성" })).toBeDisabled();
  });

  it("승인자와 사전검증이 준비되면 내보낸 뒤 완료 화면으로 앱 내 이동한다", async () => {
    mockReviewApi({ reviewSummary: { ...emptySummary, ready_to_export: true, counts: { ...emptySummary.counts, pending_items: 0 } } });
    render(<ReviewPage jobId="job-1" />);
    await screen.findByRole("region", { name: "작업 전체 반영 집계" });

    fireEvent.change(screen.getByLabelText("승인자 이름"), { target: { value: " 홍길동 " } });
    fireEvent.click(screen.getByRole("button", { name: "결과 Excel 생성" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/export", expect.objectContaining({ method: "POST", body: JSON.stringify({ approved_by: "홍길동" }) })));
    await waitFor(() => expect(window.location.pathname).toBe("/jobs/job-1/complete"));
  });

  it("내보내기 요청 중에도 검수 변경을 즉시 잠근다", async () => {
    let finishExport!: (job: JobRead) => void;
    const exportPromise = new Promise<JobRead>((resolve) => { finishExport = resolve; });
    mockReviewApi({ reviewSummary: { ...emptySummary, ready_to_export: true, counts: { ...emptySummary.counts, pending_items: 0 } }, exportPromise });
    render(<ReviewPage jobId="job-1" />);
    await screen.findByRole("region", { name: "작업 전체 반영 집계" });

    fireEvent.change(screen.getByLabelText("승인자 이름"), { target: { value: "홍길동" } });
    fireEvent.click(screen.getByRole("button", { name: "결과 Excel 생성" }));

    expect(await screen.findByText("내보내기 진행 중 · 편집 잠금")).toBeInTheDocument();
    expect(screen.getByLabelText("1번 행 상품명")).toBeDisabled();
    expect(screen.getByLabelText("1번 행 재고 반영")).toBeDisabled();
    expect(screen.getByLabelText("1번 행 검수 상태")).toBeDisabled();
    expect(screen.getByLabelText("필터 결과 상태 변경")).toBeDisabled();
    expect(screen.getByRole("button", { name: "필터 결과에 적용" })).toBeDisabled();

    finishExport({ id: "job-1", status: "completed", original_excel_name: "상품리스트.xlsx", original_excel_sha256: "a".repeat(64), product_count: 2, approved_by: "홍길동", result_path: "/results/입고결과.xlsx", failure_message: null, created_at: "2026-08-07T01:00:00Z", updated_at: "2026-08-07T02:00:00Z", completed_at: "2026-08-07T02:00:00Z" });
    await waitFor(() => expect(window.location.pathname).toBe("/jobs/job-1/complete"));
  });

  it("완료 작업에서는 단가 해결과 신규 내보내기를 읽기 전용으로 둔다", async () => {
    const summary: ReviewSummary = {
      ...emptySummary,
      products: [{
        product_code: "A-01", product_name: "생수 2L", base_stock: 10, stock_increment: 0, final_stock: 10,
        base_purchase_price: 9000, final_purchase_price: null, item_ids: ["item-1"], price_resolution_method: "unresolved",
        price_candidates: [{ item_id: "item-1", document_id: "document-1", document_name: "명세서.jpg", transaction_date: null, unit_price: 10000, quantity: 1, selected: false }],
      }],
    };
    mockReviewApi({ jobStatus: "completed", reviewSummary: summary });
    render(<ReviewPage jobId="job-1" />);

    const candidateRadio = await screen.findByRole("radio", { name: /A-01 명세서.jpg 날짜 없음/ });
    await waitFor(() => expect(candidateRadio).toBeDisabled());
    expect(screen.getByRole("button", { name: "결과 Excel 생성" })).toBeDisabled();
  });
});
