import { describe, expect, it, vi } from "vitest";
import {
  createItem,
  createJob,
  deleteJob,
  extractDocument,
  extractDocuments,
  getDocument,
  getDocumentImageUrl,
  getDocuments,
  getHealth,
  getJob,
  getJobItems,
  getJobs,
  bulkUpdateItems,
  matchJob,
  registerItemProduct,
  searchProducts,
  setItemMatch,
  clearItemMatch,
  exportJob,
  getJobResultUrl,
  getReviewSummary,
  resolveProductPrice,
  updateItem,
  uploadDocuments,
  uploadJobExcel,
} from "../src/api/client";

describe("API client", () => {
  it("상태 확인 응답을 반환한다", async () => {
    await expect(getHealth()).resolves.toEqual({ status: "ok", database: "ok" });
    expect(fetch).toHaveBeenCalledWith("/api/health", {
      headers: { Accept: "application/json" },
    });
  });

  it("실패 응답에 상태 코드를 포함한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: "필수 열이 없습니다." }) } as Response);
    await expect(getHealth()).rejects.toMatchObject({ name: "ApiError", status: 422, message: "필수 열이 없습니다." });
  });

  it("작업 API와 Excel multipart 계약을 사용한다", async () => {
    const file = new File(["xlsx"], "상품리스트.xlsx");
    await createJob();
    await getJobs();
    await getJob("job/1");
    await deleteJob("job/1");
    await uploadJobExcel("job-1", file);

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/jobs", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/jobs", expect.objectContaining({ headers: { Accept: "application/json" } }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/jobs/job%2F1", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(4, "/api/jobs/job%2F1", expect.objectContaining({ method: "DELETE" }));
    expect(fetch).toHaveBeenNthCalledWith(5, "/api/jobs/job-1/excel", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const request = vi.mocked(fetch).mock.calls[4][1];
    expect((request?.body as FormData).get("file")).toBe(file);
  });

  it("문서 업로드·추출·검수 API 계약을 사용한다", async () => {
    const first = new File(["1"], "첫번째.jpg", { type: "image/jpeg" });
    const second = new File(["2"], "두번째.png", { type: "image/png" });
    await uploadDocuments("job/1", [first, second]);
    await getDocuments("job-1");
    await getDocument("document/1");
    await extractDocuments("job-1");
    await extractDocument("document-1");
    await createItem("document-1", { product_name: "수기 품목", stock_increment: 2 });
    await updateItem("item/1", { quantity: 3, apply_inventory: false });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/jobs/job%2F1/documents", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const uploadBody = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(uploadBody.getAll("files")).toEqual([first, second]);
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/jobs/job-1/documents", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/documents/document%2F1", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(4, "/api/jobs/job-1/extract", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(5, "/api/documents/document-1/extract", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(6, "/api/documents/document-1/items", expect.objectContaining({ method: "POST", body: JSON.stringify({ product_name: "수기 품목", stock_increment: 2 }) }));
    expect(fetch).toHaveBeenNthCalledWith(7, "/api/items/item%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ quantity: 3, apply_inventory: false }) }));
    expect(getDocumentImageUrl("document/1", "corrected")).toBe("/api/documents/document%2F1/image?variant=corrected");
  });

  it("자동·검색·수동 매칭 API 계약을 사용한다", async () => {
    await matchJob("job/1");
    await searchProducts("job-1", "마운자로 5mg", 5);
    await setItemMatch("item/1", "P/1");
    await setItemMatch("item/1", "P/1", true);
    await clearItemMatch("item/1");
    await registerItemProduct("item/1", {
      product_code: "NEW/1",
      product_name: "신규 상품",
      specification: null,
      current_stock: 0,
      purchase_price: 1000,
      supplier_code: null,
      supplier: null,
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/jobs/job%2F1/match", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/jobs/job-1/products/search?query=%EB%A7%88%EC%9A%B4%EC%9E%90%EB%A1%9C+5mg&limit=5", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/items/item%2F1/match", expect.objectContaining({ method: "PUT", body: JSON.stringify({ product_code: "P/1" }) }));
    expect(fetch).toHaveBeenNthCalledWith(4, "/api/items/item%2F1/match", expect.objectContaining({ method: "PUT", body: JSON.stringify({ product_code: "P/1", approve: true }) }));
    expect(fetch).toHaveBeenNthCalledWith(5, "/api/items/item%2F1/match", expect.objectContaining({ method: "DELETE" }));
    expect(fetch).toHaveBeenNthCalledWith(6, "/api/items/item%2F1/register-product", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ product_code: "NEW/1", product_name: "신규 상품", specification: null, current_stock: 0, purchase_price: 1000, supplier_code: null, supplier: null }),
    }));
  });

  it("전체 품목 조회와 평면 일괄 변경 API 계약을 사용한다", async () => {
    await getJobItems("job/1");
    await bulkUpdateItems("job-1", { target_review_status: "approved", apply_inventory: true });
    await bulkUpdateItems("job-1", { item_ids: ["item-1"], review_status: "pending" });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/jobs/job%2F1/items", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/jobs/job-1/items/bulk", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ target_review_status: "approved", apply_inventory: true }) }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/jobs/job-1/items/bulk", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ item_ids: ["item-1"], review_status: "pending" }) }));
  });

  it("집계·단가 해결·내보내기·결과 다운로드 API 계약을 사용한다", async () => {
    await getReviewSummary("job/1");
    await resolveProductPrice("job/1", "P/1", "item-1");
    await exportJob("job/1", " 홍길동 ");

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/jobs/job%2F1/review-summary", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/jobs/job%2F1/price-resolutions/P%2F1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ selected_item_id: "item-1" }) }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/jobs/job%2F1/export", expect.objectContaining({ method: "POST", body: JSON.stringify({ approved_by: "홍길동" }) }));
    expect(getJobResultUrl("job/1")).toBe("/api/jobs/job%2F1/result");
  });
});
