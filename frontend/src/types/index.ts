export type JobStatus =
  | "draft"
  | "extracting"
  | "reviewing"
  | "exporting"
  | "completed"
  | "failed";

export type ReviewStatus = "pending" | "approved" | "excluded";
export type DocumentStatus = "pending" | "processing" | "completed" | "failed";
export type DuplicateStatus = "none" | "suspected" | "confirmed";
export type MatchMethod = "code" | "normalized_name_spec" | "similarity" | "manual";
export type PriceResolutionMethod = "unresolved" | "automatic" | "manual" | null;

export interface StructuredWarning {
  code: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface ProductCandidate {
  product_code: string;
  product_name: string | null;
  specification: string | null;
  supplier_code: string | null;
  supplier: string | null;
  current_stock: number | null;
  purchase_price: number | null;
  excel_row: number;
  match_method: MatchMethod;
  score: number;
  price_similarity: number | null;
}

export interface HealthResponse {
  status: string;
  database: string;
}

export interface JobRead {
  id: string;
  status: JobStatus;
  original_excel_name: string | null;
  original_excel_sha256: string | null;
  product_count: number;
  approved_by: string | null;
  result_path: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DocumentRead {
  id: string;
  job_id: string;
  source_order: number;
  original_image_name: string;
  status: DocumentStatus;
  image_sha256: string;
  has_corrected_image: boolean;
  correction_applied: boolean;
  correction_warning: string | null;
  photo_supplier: string | null;
  transaction_date: string | null;
  invoice_number: string | null;
  document_total: number | null;
  processing_error: string | null;
  model_name: string | null;
  prompt_version: string | null;
  duplicate_status: DuplicateStatus;
  created_at: string;
  updated_at: string;
}

export interface ExtractedItemRead {
  id: string;
  document_id: string;
  source_row_order: number;
  is_manual: boolean;
  raw_row_text: string | null;
  ocr_product_code_or_barcode: string | null;
  ocr_product_name: string | null;
  ocr_specification: string | null;
  ocr_quantity: number | null;
  ocr_unit_price: number | null;
  ocr_amount: number | null;
  ocr_bundle_or_set_text: string | null;
  ocr_confidence_by_field: Record<string, number | null>;
  extraction_warnings: string[];
  product_code_or_barcode: string | null;
  product_name: string | null;
  specification: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  bundle_or_set_text: string | null;
  apply_inventory: boolean;
  stock_increment: number | null;
  matched_product_code: string | null;
  matched_product_name: string | null;
  matched_specification: string | null;
  matched_supplier_code: string | null;
  matched_supplier: string | null;
  matched_excel_row: number | null;
  match_method: MatchMethod | null;
  match_score: number | null;
  match_candidates: ProductCandidate[];
  base_stock: number | null;
  base_purchase_price: number | null;
  review_status: ReviewStatus;
  apply_purchase_price: boolean;
  exclusion_reason: string | null;
  warnings: StructuredWarning[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetailRead extends DocumentRead {
  raw_header_text: string | null;
  confidence_by_field: Record<string, number | null>;
  items: ExtractedItemRead[];
}

export interface DocumentMutation {
  photo_supplier?: string | null;
  transaction_date?: string | null;
  invoice_number?: string | null;
  document_total?: number | null;
}

export interface ItemMutation {
  product_code_or_barcode?: string | null;
  product_name?: string | null;
  specification?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  bundle_or_set_text?: string | null;
  apply_inventory?: boolean;
  apply_purchase_price?: boolean;
  review_status?: ReviewStatus;
  exclusion_reason?: string | null;
  notes?: string | null;
  stock_increment?: number | null;
}

export interface RegisteredProductInput {
  product_code: string;
  product_name: string;
  specification: string | null;
  current_stock: number;
  purchase_price: number | null;
  supplier_code: string | null;
  supplier: string | null;
}

type BulkItemSelector =
  | { item_ids: string[]; target_review_status?: never }
  | { item_ids?: never; target_review_status: ReviewStatus };

export type BulkItemUpdate = BulkItemSelector & {
  review_status?: ReviewStatus;
  apply_inventory?: boolean;
  apply_purchase_price?: boolean;
  exclusion_reason?: string | null;
};

export interface PriceCandidateRead {
  item_id: string;
  document_id: string;
  document_name: string;
  transaction_date: string | null;
  unit_price: number;
  quantity: number | null;
  selected: boolean;
}

export interface ReviewProductSummary {
  product_code: string;
  product_name: string | null;
  base_stock: number | null;
  stock_increment: number;
  final_stock: number | null;
  base_purchase_price: number | null;
  final_purchase_price: number | null;
  item_ids: string[];
  price_resolution_method: PriceResolutionMethod;
  price_candidates: PriceCandidateRead[];
}

export interface ReviewBlocker {
  code: string;
  message: string;
  item_ids: string[];
  document_ids: string[];
}

export interface ReviewSummaryCounts {
  approved_items: number;
  excluded_items: number;
  pending_items: number;
  inventory_products: number;
  price_products: number;
}

export interface ReviewSummary {
  job_id: string;
  ready_to_export: boolean;
  blockers: ReviewBlocker[];
  counts: ReviewSummaryCounts;
  products: ReviewProductSummary[];
}

export interface ReviewItem {
  id: string;
  sourceRowOrder: number;
  productName: string | null;
  specification: string | null;
  quantity: number | null;
  unitPrice: number | null;
  inventoryIncrease: number;
  matchedProductCode: string | null;
  status: ReviewStatus;
  applyInventory: boolean;
  applyUnitPrice: boolean;
  warnings: string[];
}
