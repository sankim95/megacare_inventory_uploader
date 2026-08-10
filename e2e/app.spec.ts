import { expect, test, type Route } from "../frontend/node_modules/@playwright/test/index.js";

const createdAt = "2026-08-07T01:00:00Z";

function job(id: string, status: "draft" | "reviewing" | "exporting" | "completed") {
  return {
    id,
    status,
    original_excel_name: status === "draft" ? null : "상품리스트.xlsx",
    original_excel_sha256: status === "draft" ? null : "a".repeat(64),
    product_count: status === "draft" ? 0 : 1,
    approved_by: status === "completed" ? "홍길동" : null,
    result_path: status === "completed" ? "/results/입고결과.xlsx" : null,
    failure_message: null,
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: status === "completed" ? "2026-08-07T02:00:00Z" : null,
  };
}

const document = {
  id: "document-review",
  job_id: "job-review",
  source_order: 0,
  original_image_name: "명세서.jpg",
  status: "completed",
  image_sha256: "b".repeat(64),
  has_corrected_image: true,
  correction_applied: true,
  correction_warning: null,
  photo_supplier: "메가상사",
  transaction_date: "2026-08-07",
  invoice_number: "INV-1",
  document_total: 6000,
  processing_error: null,
  model_name: "mock-model",
  prompt_version: "v1",
  duplicate_status: "none",
  created_at: createdAt,
  updated_at: createdAt,
};

const item = {
  id: "item-review",
  document_id: document.id,
  source_row_order: 0,
  is_manual: false,
  raw_row_text: "18 펫생각 데일리케어 리얼 루테인(눈) (60정) 120g 2 12900",
  ocr_product_code_or_barcode: "A-01",
  ocr_product_name: "생수",
  ocr_specification: "2L",
  ocr_quantity: 6,
  ocr_unit_price: 1000,
  ocr_amount: 6000,
  ocr_bundle_or_set_text: "6개입",
  ocr_confidence_by_field: { product_name: 0.97 },
  extraction_warnings: ["이미지 품목별 금액 열이 없고 권장소비자판매가를 amount로 변환했습니다."],
  product_code_or_barcode: "A-01",
  product_name: "생수",
  specification: "2L",
  quantity: 6,
  unit_price: 1000,
  amount: 6000,
  bundle_or_set_text: "6개입",
  apply_inventory: true,
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
  review_status: "pending",
  apply_purchase_price: false,
  exclusion_reason: null,
  warnings: [],
  notes: null,
  created_at: createdAt,
  updated_at: createdAt,
};

const pendingSummary = {
  job_id: "job-review",
  ready_to_export: false,
  blockers: [
    {
      code: "PENDING_ITEMS",
      message: "보류 품목이 1개 있습니다.",
      item_ids: [item.id],
      document_ids: [document.id],
    },
  ],
  counts: {
    approved_items: 0,
    excluded_items: 0,
    pending_items: 1,
    inventory_products: 0,
    price_products: 0,
  },
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

const completedSummary = {
  job_id: "job-complete",
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockHealth(route: Route) {
  await json(route, { status: "ok", database: "ok" });
}

test("새 작업은 파일 선택 후 임시저장할 때만 생성한다", async ({ page }) => {
  let createCalls = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/health") return mockHealth(route);
    if (path === "/api/jobs" && request.method() === "GET") return json(route, []);
    if (path === "/api/jobs" && request.method() === "POST") {
      createCalls += 1;
      return json(route, job("job-new", "draft"), 201);
    }
    if (path === "/api/jobs/job-new/documents") return json(route, []);
    throw new Error(`예상하지 못한 API 요청: ${request.method()} ${path}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "입고 반영 작업" })).toBeVisible();
  await expect(page.getByText("아직 작업이 없습니다")).toBeVisible();

  await page.getByRole("link", { name: "새 작업 시작" }).click();

  await expect(page).toHaveURL(/\/jobs\/new\/upload$/);
  await expect(page.getByRole("heading", { level: 1, name: "파일 업로드" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "상품리스트 Excel" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "거래명세서 사진" })).toBeVisible();
  expect(createCalls).toBe(0);

  await page.getByLabel(/사진 파일 선택/).setInputFiles({
    name: "명세서.png",
    mimeType: "image/png",
    buffer: Buffer.from("mock image"),
  });
  await page.getByRole("button", { name: "임시저장" }).click();

  await expect(page).toHaveURL(/\/jobs\/job-new\/upload$/);
  await expect(page.getByText("임시저장이 완료되었습니다.")).toBeVisible();
  expect(createCalls).toBe(1);
});

test("완료 결과를 요약·다운로드하고 복제 작업의 업로드 화면으로 이동한다", async ({ page }) => {
  let cloneCalls = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/health") return mockHealth(route);
    if (path === "/api/jobs/job-complete" && request.method() === "GET") return json(route, job("job-complete", "completed"));
    if (path === "/api/jobs/job-complete/review-summary") return json(route, completedSummary);
    if (path === "/api/jobs/job-complete/result") {
      return route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: { "Content-Disposition": "attachment; filename=inventory-result.xlsx" },
        body: "mock workbook",
      });
    }
    if (path === "/api/jobs/job-complete/clone" && request.method() === "POST") {
      cloneCalls += 1;
      return json(route, job("job-clone", "draft"), 201);
    }
    if (path === "/api/jobs/job-clone" && request.method() === "GET") return json(route, job("job-clone", "draft"));
    if (path === "/api/jobs/job-clone/documents") return json(route, []);
    throw new Error(`예상하지 못한 API 요청: ${request.method()} ${path}`);
  });

  await page.goto("/jobs/job-complete/complete");
  await expect(page.getByRole("heading", { level: 1, name: "입고 반영이 완료되었습니다" })).toBeVisible();
  const changeSummary = page.getByRole("region", { name: "변경 요약" });
  await expect(changeSummary.getByText("승인 품목")).toBeVisible();
  await expect(changeSummary.getByText("3개")).toBeVisible();
  await expect(page.getByRole("region", { name: "처리 정보" }).getByText("홍길동")).toBeVisible();

  const downloadLink = page.getByRole("link", { name: "결과 Excel 다운로드" });
  await expect(downloadLink).toHaveAttribute("href", "/api/jobs/job-complete/result");
  // 네이티브 download 요청은 route를 우회하므로 같은 URL을 탐색해 모의 응답과 파일명을 검증합니다.
  await downloadLink.evaluate((element) => element.removeAttribute("download"));
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("inventory-result.xlsx");

  await page.getByRole("button", { name: "이 작업 복제" }).click();
  await expect(page).toHaveURL(/\/jobs\/job-clone\/upload$/);
  await expect(page.getByRole("heading", { level: 1, name: "파일 업로드" })).toBeVisible();
  expect(cloneCalls).toBe(1);
});

test("검수 제어를 렌더링하고 내보내기 중에는 편집을 잠근다", async ({ page }) => {
  let status: "reviewing" | "exporting" = "reviewing";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/health") return mockHealth(route);
    if (path === "/api/jobs/job-review" && request.method() === "GET") return json(route, job("job-review", status));
    if (path === "/api/jobs/job-review/documents") return json(route, [document]);
    if (path === "/api/jobs/job-review/items") return json(route, [item]);
    if (path === "/api/jobs/job-review/review-summary") return json(route, pendingSummary);
    if (path === "/api/documents/document-review" && request.method() === "GET") {
      return json(route, { ...document, raw_header_text: "메가상사 거래명세서", confidence_by_field: {}, items: [item] });
    }
    if (path === "/api/documents/document-review/image") return route.fulfill({ status: 204 });
    throw new Error(`예상하지 못한 API 요청: ${request.method()} ${path}`);
  });

  await page.goto("/jobs/job-review/review");
  await expect(page.getByRole("heading", { level: 1, name: "사진과 품목 검수" })).toBeVisible();
  await expect(page.getByRole("region", { name: "품목 검수 제어" })).toBeVisible();
  await expect(page.getByRole("button", { name: "자동 매칭 실행" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "누락 행 추가" })).toBeEnabled();
  const pendingOverview = page.getByRole("region", { name: "보류 항목 바로가기" });
  await expect(pendingOverview.getByText("보류 항목 1개")).toBeVisible();
  await expect(page.getByLabel("A-01 검수 상태").getByText("보류 1")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "1번 행 상품명" })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "1번 행 검수 상태" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "명세서 정보" })).toBeVisible();
  await expect(page.getByRole("button", { name: "원본 사진 보기" })).toBeEnabled();
  await page.getByRole("button", { name: "원본 사진 보기" }).click();
  const originalPhoto = page.getByRole("img", { name: "명세서.jpg 원본" });
  await expect(originalPhoto).toHaveAttribute("style", "transform: rotate(0deg);");
  await page.getByRole("button", { name: "원본 사진 시계 방향으로 90도 회전" }).click();
  await expect(originalPhoto).toHaveAttribute("style", "transform: rotate(90deg);");
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByLabel("문서 합계")).toHaveCount(0);

  const reviewLayout = await page.evaluate(() => {
    const toolbar = document.querySelector(".review-toolbar")?.getBoundingClientRect();
    const metadata = document.querySelector(".review-document-metadata")?.getBoundingClientRect();
    const workspace = document.querySelector(".review-workspace")?.getBoundingClientRect();
    const tableScroll = document.querySelector(".review-table-scroll");
    return {
      metadataFollowsToolbar: Boolean(toolbar && metadata && metadata.top >= toolbar.bottom),
      workspaceUsesToolbarWidth: Boolean(toolbar && workspace && Math.abs(toolbar.width - workspace.width) <= 1),
      tableClientWidth: tableScroll?.clientWidth ?? 0,
      tableScrollWidth: tableScroll?.scrollWidth ?? 0,
    };
  });
  expect(reviewLayout.metadataFollowsToolbar).toBe(true);
  expect(reviewLayout.workspaceUsesToolbarWidth).toBe(true);
  expect(reviewLayout.tableScrollWidth).toBeLessThanOrEqual(reviewLayout.tableClientWidth + 1);

  const rowContextStyles = await page.locator(".raw-row-text, .extraction-warning-list li").evaluateAll((elements) => elements.map((element) => {
    const styles = getComputedStyle(element);
    const cell = element.closest("th")?.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return {
      staysInsideCell: Boolean(cell && bounds.right <= cell.right + 1),
      overflow: styles.overflow,
      textOverflow: styles.textOverflow,
      whiteSpace: styles.whiteSpace,
    };
  }));
  expect(rowContextStyles).toHaveLength(2);
  for (const styles of rowContextStyles) {
    expect(styles.staysInsideCell).toBe(true);
    expect(styles.overflow).toBe("hidden");
    expect(styles.textOverflow).toBe("ellipsis");
    expect(styles.whiteSpace).toBe("nowrap");
  }

  const applyFieldMetrics = await page.locator(".item-review-fields .apply-field").evaluateAll((labels) => labels.map((label) => {
    const input = label.querySelector("input");
    const text = label.querySelector("span");
    return {
      inputWidth: input?.getBoundingClientRect().width ?? 0,
      textHeight: text?.getBoundingClientRect().height ?? 0,
    };
  }));
  expect(applyFieldMetrics).toHaveLength(2);
  for (const metric of applyFieldMetrics) {
    expect(metric.inputWidth).toBeLessThanOrEqual(20);
    expect(metric.textHeight).toBeLessThanOrEqual(16);
  }

  await pendingOverview.getByRole("button", { name: "명세서.jpg 1번 행 생수 보류 항목 검수" }).click();
  const splitEditor = page.getByRole("complementary", { name: "선택 상품 바로 수정" });
  await expect(splitEditor).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "명세서.jpg 1번 행 재고 증가" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "명세서.jpg 1번 행 메모" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "추출 품목" })).toHaveCount(0);
  await splitEditor.getByRole("button", { name: "원본 사진 보기" }).click();
  const splitPhotoDialog = page.getByRole("dialog", { name: "원본 사진" });
  await expect(splitPhotoDialog.getByRole("img", { name: "명세서.jpg 원본" })).toBeVisible();
  await splitPhotoDialog.getByRole("button", { name: "닫기" }).click();
  const splitLayout = await page.evaluate(() => {
    const container = document.querySelector(".review-summary-split")?.getBoundingClientRect();
    const list = document.querySelector(".review-summary-split__list")?.getBoundingClientRect();
    const editor = document.querySelector(".selected-product-panel")?.getBoundingClientRect();
    return {
      aligned: Boolean(list && editor && Math.abs(list.top - editor.top) <= 1),
      separated: Boolean(list && editor && list.right <= editor.left + 1),
      insideContainer: Boolean(container && editor && editor.right <= container.right + 1),
    };
  });
  expect(splitLayout.aligned).toBe(true);
  expect(splitLayout.separated).toBe(true);
  expect(splitLayout.insideContainer).toBe(true);
  const reviewControlLayout = await page.evaluate(() => {
    const status = document.querySelector('[aria-label="명세서.jpg 1번 행 검수 상태"]')?.closest("label")?.getBoundingClientRect();
    const inventory = document.querySelector('[aria-label="명세서.jpg 1번 행 재고 반영"]')?.closest("label")?.getBoundingClientRect();
    const price = document.querySelector('[aria-label="명세서.jpg 1번 행 매입단가 반영"]')?.closest("label")?.getBoundingClientRect();
    const exclusion = document.querySelector('[aria-label="명세서.jpg 1번 행 제외 사유"]')?.closest("label")?.getBoundingClientRect();
    return {
      controlsAligned: Boolean(status && inventory && price && Math.max(status.bottom, inventory.bottom, price.bottom) - Math.min(status.bottom, inventory.bottom, price.bottom) <= 1),
      exclusionOnNextRow: Boolean(status && inventory && price && exclusion && exclusion.top >= Math.max(status.bottom, inventory.bottom, price.bottom)),
    };
  });
  expect(reviewControlLayout.controlsAligned).toBe(true);
  expect(reviewControlLayout.exclusionOnNextRow).toBe(true);

  await page.setViewportSize({ width: 760, height: 900 });
  const narrowSplitLayout = await page.evaluate(() => {
    const container = document.querySelector(".review-summary-split")?.getBoundingClientRect();
    const list = document.querySelector(".review-summary-split__list")?.getBoundingClientRect();
    const editor = document.querySelector(".selected-product-panel")?.getBoundingClientRect();
    return {
      stacked: Boolean(list && editor && editor.top >= list.bottom - 1),
      insideContainer: Boolean(container && editor && editor.left >= container.left - 1 && editor.right <= container.right + 1),
    };
  });
  expect(narrowSplitLayout.stacked).toBe(true);
  expect(narrowSplitLayout.insideContainer).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  status = "exporting";
  await page.reload();

  await expect(page.getByText("내보내기 진행 중 · 편집 잠금")).toBeVisible();
  await expect(page.getByText("결과 Excel을 생성하는 동안 편집이 잠겼습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "자동 매칭 실행" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "누락 행 추가" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "사진 공급자" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "1번 행 상품명" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "필터 결과 상태 변경" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "승인자 이름" })).toBeDisabled();
});
