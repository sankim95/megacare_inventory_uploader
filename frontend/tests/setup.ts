import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const job = {
  id: "job-1",
  status: "draft",
  original_excel_name: null,
  original_excel_sha256: null,
  product_count: 0,
  approved_by: null,
  result_path: null,
  failure_message: null,
  created_at: "2026-08-07T01:00:00Z",
  updated_at: "2026-08-07T01:00:00Z",
  completed_at: null,
};

function documentFromFile(file: File, sourceOrder: number) {
  return {
    id: `document-${sourceOrder + 1}`,
    job_id: "job-1",
    source_order: sourceOrder,
    original_image_name: file.name,
    status: "pending",
    image_sha256: `${sourceOrder + 1}`.repeat(64),
    has_corrected_image: false,
    correction_applied: false,
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

beforeEach(() => {
  let storedDocuments: ReturnType<typeof documentFromFile>[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: unknown = { status: "ok", database: "ok" };
    if (url.endsWith("/jobs") && init?.method === "POST") body = job;
    else if (url.endsWith("/jobs")) body = [];
    else if (url.endsWith("/excel")) {
      const file = (init?.body as FormData).get("file") as File;
      body = { ...job, original_excel_name: file.name, original_excel_sha256: "a".repeat(64), product_count: 1 };
    }
    else if (url.endsWith("/documents") && init?.method === "POST") {
      storedDocuments = ((init.body as FormData).getAll("files") as File[]).map((file, index) => documentFromFile(file, storedDocuments.length + index));
      body = storedDocuments;
    }
    else if (url.endsWith("/documents")) body = storedDocuments;
    else if (/\/jobs\/[^/]+\/extract$/.test(url)) {
      storedDocuments = storedDocuments.map((document) => ({ ...document, status: "completed" }));
      body = storedDocuments;
    }
    else if (/\/documents\/[^/]+\/extract$/.test(url)) {
      const documentId = url.split("/").at(-2);
      const updated = storedDocuments.find((document) => document.id === documentId);
      body = updated ? { ...updated, status: "completed", processing_error: null } : {};
    }
    else if (url.includes("/jobs/")) body = job;
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
