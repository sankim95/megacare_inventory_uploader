import type { BulkItemUpdate, DocumentDetailRead, DocumentMutation, DocumentRead, ExtractedItemRead, HealthResponse, ItemMutation, JobRead, ProductCandidate, RegisteredProductInput, ReviewSummary } from "../types";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiBaseUrl = (configuredBaseUrl || "/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = "서버 요청에 실패했습니다.";

  try {
    const body = await response.json() as { detail?: unknown; message?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.message === "string") return body.message;
  } catch {
    return fallback;
  }

  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });

  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function createJob(): Promise<JobRead> {
  return request<JobRead>("/jobs", { method: "POST" });
}

export function getJobs(): Promise<JobRead[]> {
  return request<JobRead[]>("/jobs");
}

export function getJob(jobId: string): Promise<JobRead> {
  return request<JobRead>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function deleteJob(jobId: string): Promise<void> {
  return request<void>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

export function cloneJob(jobId: string): Promise<JobRead> {
  return request<JobRead>(`/jobs/${encodeURIComponent(jobId)}/clone`, { method: "POST" });
}

export function getJobItems(jobId: string): Promise<ExtractedItemRead[]> {
  return request<ExtractedItemRead[]>(`/jobs/${encodeURIComponent(jobId)}/items`);
}

export function bulkUpdateItems(jobId: string, values: BulkItemUpdate): Promise<ExtractedItemRead[]> {
  return request<ExtractedItemRead[]>(`/jobs/${encodeURIComponent(jobId)}/items/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function uploadJobExcel(jobId: string, file: File): Promise<JobRead> {
  const formData = new FormData();
  formData.append("file", file);
  return request<JobRead>(`/jobs/${encodeURIComponent(jobId)}/excel`, {
    method: "POST",
    body: formData,
  });
}

export function uploadDocuments(jobId: string, files: File[]): Promise<DocumentRead[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return request<DocumentRead[]>(`/jobs/${encodeURIComponent(jobId)}/documents`, {
    method: "POST",
    body: formData,
  });
}

export function getDocuments(jobId: string): Promise<DocumentRead[]> {
  return request<DocumentRead[]>(`/jobs/${encodeURIComponent(jobId)}/documents`);
}

export function getDocument(documentId: string): Promise<DocumentDetailRead> {
  return request<DocumentDetailRead>(`/documents/${encodeURIComponent(documentId)}`);
}

export function updateDocument(documentId: string, values: DocumentMutation): Promise<DocumentRead> {
  return request<DocumentRead>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function deleteDocument(documentId: string): Promise<void> {
  return request<void>(`/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
}

export function getDocumentImageUrl(documentId: string, variant: "original" | "corrected") {
  return `${apiBaseUrl}/documents/${encodeURIComponent(documentId)}/image?variant=${variant}`;
}

export function extractDocuments(jobId: string): Promise<DocumentRead[]> {
  return request<DocumentRead[]>(`/jobs/${encodeURIComponent(jobId)}/extract`, { method: "POST" });
}

export function extractDocument(documentId: string): Promise<DocumentRead> {
  return request<DocumentRead>(`/documents/${encodeURIComponent(documentId)}/extract`, { method: "POST" });
}

export function createItem(documentId: string, values: ItemMutation): Promise<ExtractedItemRead> {
  return request<ExtractedItemRead>(`/documents/${encodeURIComponent(documentId)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function updateItem(itemId: string, values: ItemMutation): Promise<ExtractedItemRead> {
  return request<ExtractedItemRead>(`/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function matchJob(jobId: string): Promise<unknown> {
  return request<unknown>(`/jobs/${encodeURIComponent(jobId)}/match`, { method: "POST" });
}

export function searchProducts(jobId: string, query: string, limit = 5): Promise<ProductCandidate[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return request<ProductCandidate[]>(`/jobs/${encodeURIComponent(jobId)}/products/search?${params.toString()}`);
}

export function setItemMatch(itemId: string, productCode: string, approve = false): Promise<ExtractedItemRead> {
  return request<ExtractedItemRead>(`/items/${encodeURIComponent(itemId)}/match`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(approve ? { product_code: productCode, approve: true } : { product_code: productCode }),
  });
}

export function clearItemMatch(itemId: string): Promise<ExtractedItemRead> {
  return request<ExtractedItemRead>(`/items/${encodeURIComponent(itemId)}/match`, { method: "DELETE" });
}

export function registerItemProduct(itemId: string, values: RegisteredProductInput): Promise<ExtractedItemRead> {
  return request<ExtractedItemRead>(`/items/${encodeURIComponent(itemId)}/register-product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function getReviewSummary(jobId: string): Promise<ReviewSummary> {
  return request<ReviewSummary>(`/jobs/${encodeURIComponent(jobId)}/review-summary`);
}

export function resolveProductPrice(jobId: string, productCode: string, selectedItemId: string): Promise<ReviewSummary> {
  return request<ReviewSummary>(`/jobs/${encodeURIComponent(jobId)}/price-resolutions/${encodeURIComponent(productCode)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_item_id: selectedItemId }),
  });
}

export function exportJob(jobId: string, approvedBy: string): Promise<JobRead> {
  return request<JobRead>(`/jobs/${encodeURIComponent(jobId)}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved_by: approvedBy.trim() }),
  });
}

export function getJobResultUrl(jobId: string) {
  return `${apiBaseUrl}/jobs/${encodeURIComponent(jobId)}/result`;
}
