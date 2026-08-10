import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { bulkUpdateItems, clearItemMatch, createItem, exportJob, getDocument, getDocumentImageUrl, getDocuments, getJob, getJobItems, getReviewSummary, matchJob, registerItemProduct, resolveProductPrice, searchProducts, setItemMatch, updateDocument, updateItem } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { BulkItemUpdate, DocumentDetailRead, DocumentMutation, DocumentRead, ExtractedItemRead, ItemMutation, JobRead, MatchMethod, ProductCandidate, ReviewBlocker, ReviewProductSummary, ReviewStatus, ReviewSummary, StructuredWarning } from "../types";

interface ReviewPageProps {
  jobId: string;
}

type EditableField = keyof ItemMutation;
type SearchPhase = "idle" | "loading" | "success" | "error";
type StatusFilter = "all" | ReviewStatus;
type MatchFilter = "all" | "matched" | "unmatched";
type WarningFilter = "all" | "with_warnings" | "without_warnings";

const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: "보류",
  approved: "승인",
  excluded: "제외",
};

const matchMethodLabels: Record<MatchMethod, string> = {
  code: "상품코드 일치",
  normalized_name_spec: "상품명·규격 일치",
  similarity: "유사도 추천",
  manual: "수동 선택",
};

function displayOriginal(value: string | number | null) {
  return value === null || value === "" ? "인식 없음" : String(value);
}

function numberFromInput(event: { currentTarget: HTMLInputElement }) {
  return event.currentTarget.value === "" ? null : Number(event.currentTarget.value);
}

function formatNumber(value: number | null) {
  return value === null ? "정보 없음" : value.toLocaleString("ko-KR");
}

function formatCurrency(value: number | null) {
  return value === null ? "정보 없음" : `${value.toLocaleString("ko-KR")}원`;
}

function formatScore(score: number | null) {
  return score === null ? "점수 없음" : `${Math.round(score * 100)}점`;
}

function priceResolutionLabel(method: ReviewProductSummary["price_resolution_method"]) {
  if (method === "unresolved") return "대표 단가 선택 필요";
  if (method === "automatic") return "업무 규칙으로 자동 해결됨";
  if (method === "manual") return "사용자 수동 선택으로 해결됨";
  return "단가 반영 대상 없음";
}

function blockerNextAction(blocker: ReviewBlocker) {
  const actions: Record<string, string> = {
    NO_DOCUMENTS: "거래명세서 이미지를 업로드하고 추출을 완료하세요.",
    NO_REVIEW_ITEMS: "거래명세서에서 검수할 품목을 준비하세요.",
    PENDING_ITEMS: "보류 품목을 승인 또는 제외하세요.",
    UNMATCHED_ITEMS: "미매칭 품목의 상품을 선택하거나 사유를 입력해 제외하세요.",
    INVALID_STOCK: "+재고를 0 이상의 정수로 수정하세요.",
    INVALID_APPROVED_STOCK: "+재고를 0 이상의 정수로 수정하세요.",
    UNRESOLVED_PRICE: "최신 거래일의 대표 단가 후보를 선택하세요.",
    CONFIRMED_DUPLICATE: "확정 중복 문서를 제거한 뒤 다시 확인하세요.",
  };
  return `다음 행동: ${actions[blocker.code] || "해당 품목과 문서를 확인하고 수정해 주세요."}`;
}

interface ReviewSummaryPanelProps {
  summary: ReviewSummary;
  items: ExtractedItemRead[];
  documents: DocumentRead[];
  readOnly: boolean;
  resolvingProductCode: string;
  selectedProductCode: string;
  detailPanel: ReactNode;
  onReviewPending: () => void;
  onSelectPendingItem: (item: ExtractedItemRead) => void;
  onSelectProduct: (product: ReviewProductSummary) => void;
  onResolvePrice: (productCode: string, itemId: string) => void;
}

function ReviewSummaryPanel({ summary, items, documents, readOnly, resolvingProductCode, selectedProductCode, detailPanel, onReviewPending, onSelectPendingItem, onSelectProduct, onResolvePrice }: ReviewSummaryPanelProps) {
  const pendingItems = items.filter((item) => item.review_status === "pending");
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const liveCounts = {
    approved: items.filter((item) => item.review_status === "approved").length,
    pending: pendingItems.length,
    excluded: items.filter((item) => item.review_status === "excluded").length,
  };

  return (
    <section className="panel job-review-summary" aria-label="작업 전체 반영 집계">
      <div className="job-review-summary__heading">
        <div><h2>작업 전체 반영 집계</h2><p>같은 상품코드의 승인 행을 합산한 서버 계산값입니다.</p></div>
        <div className="job-review-counts" role="group" aria-label="검수 집계">
          <div><span>승인</span><strong>{liveCounts.approved}개</strong></div>
          <div className="job-review-counts__pending"><button type="button" disabled={liveCounts.pending === 0} aria-label={`보류 ${liveCounts.pending}개 검수하기`} onClick={onReviewPending}><span>보류</span><strong>{liveCounts.pending}개</strong></button></div>
          <div><span>제외</span><strong>{liveCounts.excluded}개</strong></div>
          <div><span>재고 변경</span><strong>{summary.counts.inventory_products}개 상품</strong></div>
          <div><span>단가 변경</span><strong>{summary.counts.price_products}개 상품</strong></div>
        </div>
      </div>

      {pendingItems.length > 0 ? (
        <div className="pending-item-overview" role="region" aria-label="보류 항목 바로가기">
          <div className="pending-item-overview__heading"><strong>보류 항목 {pendingItems.length}개</strong><span>항목을 누르면 해당 행을 바로 검수할 수 있습니다.</span></div>
          <ul>{pendingItems.map((item) => {
            const document = documentById.get(item.document_id);
            const itemName = item.product_name || item.product_code_or_barcode || "이름 없는 품목";
            return <li key={item.id}><button type="button" onClick={() => onSelectPendingItem(item)} aria-label={`${document?.original_image_name || "문서"} ${item.source_row_order + 1}번 행 ${itemName} 보류 항목 검수`}><span className="review-status-badge review-status-badge--pending">보류</span><strong>{itemName}</strong><small>{document?.original_image_name || "문서 정보 없음"} · {item.source_row_order + 1}번 행 · {item.matched_product_code ? `매칭 ${item.matched_product_code}` : "미매칭"}</small></button></li>;
          })}</ul>
        </div>
      ) : null}

      <div className={`review-summary-split ${detailPanel ? "review-summary-split--open" : ""}`}>
        <div className="review-summary-split__list">
          {summary.products.length > 0 ? (
            <div className="table-scroll product-summary-scroll">
              <table className="product-summary-table">
                <thead><tr><th scope="col">상품</th><th scope="col">검수 상태</th><th scope="col">기준재고</th><th scope="col">증분</th><th scope="col">최종재고</th><th scope="col">기존단가</th><th scope="col">최종단가</th><th scope="col">단가 근거</th></tr></thead>
                <tbody>{summary.products.map((product) => {
                  const selected = selectedProductCode === product.product_code;
                  const productItems = product.item_ids.map((itemId) => itemById.get(itemId)).filter((item): item is ExtractedItemRead => Boolean(item));
                  const productStatusCounts = {
                    approved: productItems.filter((item) => item.review_status === "approved").length,
                    pending: productItems.filter((item) => item.review_status === "pending").length,
                    excluded: productItems.filter((item) => item.review_status === "excluded").length,
                  };
                  return <tr key={product.product_code} className={`${selected ? "product-summary-row--selected" : ""} ${productStatusCounts.pending > 0 ? "product-summary-row--pending" : ""}`.trim()}><th scope="row"><button type="button" className="product-summary-select" aria-label={`${product.product_code} ${product.product_name || "이름 없음"} 바로 수정`} aria-pressed={selected} onClick={() => onSelectProduct(product)}><code>{product.product_code}</code><strong>{product.product_name || "이름 없음"}</strong></button></th><td><div className="product-review-statuses" aria-label={`${product.product_code} 검수 상태`}>{productStatusCounts.pending > 0 ? <span className="review-status-badge review-status-badge--pending">보류 {productStatusCounts.pending}</span> : null}{productStatusCounts.approved > 0 ? <span className="review-status-badge review-status-badge--approved">승인 {productStatusCounts.approved}</span> : null}{productStatusCounts.excluded > 0 ? <span className="review-status-badge review-status-badge--excluded">제외 {productStatusCounts.excluded}</span> : null}</div></td><td>{formatNumber(product.base_stock)}</td><td>+{formatNumber(product.stock_increment)}</td><td><strong>{formatNumber(product.final_stock)}</strong></td><td>{formatCurrency(product.base_purchase_price)}</td><td><strong>{formatCurrency(product.final_purchase_price)}</strong></td><td>{priceResolutionLabel(product.price_resolution_method)}</td></tr>;
                })}</tbody>
              </table>
            </div>
          ) : <p className="summary-empty">집계할 매칭 상품이 없습니다.</p>}
        </div>
        {detailPanel ? <aside className="selected-product-panel" aria-label="선택 상품 바로 수정">{detailPanel}</aside> : null}
      </div>

      <div className="price-resolution-list">
        {summary.products.filter((product) => product.price_candidates.length > 0).map((product) => {
          const hasComparableDates = product.price_candidates.every((candidate) => candidate.transaction_date !== null);
          const hasPriceConflict = new Set(product.price_candidates.map((candidate) => candidate.unit_price)).size > 1;
          const restrictToLatestDate = hasComparableDates && hasPriceConflict;
          const latestDate = hasComparableDates ? product.price_candidates.reduce((latest, candidate) => candidate.transaction_date! > latest ? candidate.transaction_date! : latest, "") : null;
          return (
            <fieldset key={product.product_code} className={`price-resolution-group ${product.price_resolution_method === "unresolved" ? "price-resolution-group--unresolved" : ""}`} disabled={readOnly || resolvingProductCode === product.product_code}>
              <legend>{product.product_code} {product.product_name || "이름 없음"} 단가 후보</legend>
              <p className="resolution-method">{priceResolutionLabel(product.price_resolution_method)}{hasComparableDates ? ` · 최신 거래일 ${latestDate}` : " · 날짜 누락으로 거래일 비교 불가"}</p>
              <div className="price-candidate-grid">
                {product.price_candidates.map((candidate) => {
                  const latestCandidate = !restrictToLatestDate || candidate.transaction_date === latestDate;
                  const label = `${product.product_code} ${candidate.document_name} ${candidate.transaction_date || "날짜 없음"} ${formatCurrency(candidate.unit_price)} 대표 단가`;
                  return (
                    <label key={candidate.item_id} className={`price-candidate ${candidate.selected ? "price-candidate--selected" : ""} ${!latestCandidate ? "price-candidate--past" : ""}`}>
                      <input type="radio" name={`price-${product.product_code}`} aria-label={label} checked={candidate.selected} disabled={readOnly || Boolean(resolvingProductCode) || !latestCandidate} onChange={() => onResolvePrice(product.product_code, candidate.item_id)} />
                      <span><strong>{candidate.document_name}</strong><small>{candidate.transaction_date || "날짜 없음"} · {formatCurrency(candidate.unit_price)} · 수량 {formatNumber(candidate.quantity)}</small>{candidate.selected ? <em>선택됨</em> : null}{!latestCandidate ? <em>최신 거래일 아님</em> : null}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

function WarningList({ warnings }: { warnings: StructuredWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="structured-warning-list" aria-label="검증 경고">
      {warnings.map((warning, index) => (
        <li key={`${warning.code}-${index}`}>
          <div><code>{warning.code}</code><strong>{warning.message}</strong></div>
          {Object.keys(warning.evidence).length > 0 ? <dl>{Object.entries(warning.evidence).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl> : null}
        </li>
      ))}
    </ul>
  );
}

function approvalBlockReason(item: ExtractedItemRead) {
  const missingMatch = !item.matched_product_code;
  const invalidStock = item.stock_increment === null || !Number.isInteger(item.stock_increment) || item.stock_increment < 0;
  if (missingMatch && invalidStock) return "상품 매칭과 유효한 +재고가 필요합니다.";
  if (missingMatch) return "상품 매칭이 필요합니다.";
  if (invalidStock) return "0 이상의 정수 +재고가 필요합니다.";
  return "";
}

function InventoryMaster({ status, items, disabled, busy, onChange }: { status: ReviewStatus; items: ExtractedItemRead[]; disabled: boolean; busy: boolean; onChange: (checked: boolean) => void }) {
  const targets = items.filter((item) => item.review_status === status);
  const checkedCount = targets.filter((item) => item.apply_inventory).length;
  const checked = targets.length > 0 && checkedCount === targets.length;
  const indeterminate = checkedCount > 0 && checkedCount < targets.length;

  return (
    <label className="inventory-master">
      <input ref={(input) => { if (input) input.indeterminate = indeterminate; }} type="checkbox" aria-label={`${reviewStatusLabels[status]} 상태 전체 재고 반영 (작업 전체)`} checked={checked} disabled={disabled || busy || targets.length === 0} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{reviewStatusLabels[status]} {checkedCount}/{targets.length}</span>
    </label>
  );
}

interface MatchPanelProps {
  item: ExtractedItemRead;
  jobId: string;
  readOnly: boolean;
  onReplace: (item: ExtractedItemRead) => void | Promise<void>;
}

function MatchPanel({ item, jobId, readOnly, onReplace }: MatchPanelProps) {
  const rowLabel = `${item.source_row_order + 1}번 행`;
  const itemLabel = item.product_name || item.product_code_or_barcode || "품목";
  const [query, setQuery] = useState(item.product_name || item.product_code_or_barcode || "");
  const [results, setResults] = useState<ProductCandidate[]>([]);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [changingCode, setChangingCode] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationPhase, setRegistrationPhase] = useState<SearchPhase>("idle");
  const [registrationMessage, setRegistrationMessage] = useState("");
  const [registration, setRegistration] = useState({
    productCode: item.product_code_or_barcode || "",
    productName: item.product_name || "",
    specification: item.specification || "",
    currentStock: "0",
    purchasePrice: item.unit_price === null ? "" : String(item.unit_price),
    supplierCode: "",
    supplier: "",
  });

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setSearchPhase("error");
      setSearchMessage("검색어를 입력해 주세요.");
      return;
    }
    setSearchPhase("loading");
    setSearchMessage("상품리스트에서 검색하고 있습니다.");
    try {
      const found = (await searchProducts(jobId, normalizedQuery, 5)).slice(0, 5);
      setResults(found);
      setSearchPhase("success");
      setSearchMessage(found.length === 0 ? "검색 결과가 없습니다. 상품코드나 상품명을 바꿔 다시 검색해 주세요." : `${found.length}개 상품을 찾았습니다.`);
    } catch (reason) {
      setResults([]);
      setSearchPhase("error");
      setSearchMessage(reason instanceof Error ? reason.message : "상품 검색에 실패했습니다.");
    }
  }

  async function choose(candidate: ProductCandidate) {
    if (readOnly) return;
    setChangingCode(candidate.product_code);
    setSearchMessage("");
    try {
      const updated = await setItemMatch(item.id, candidate.product_code, true);
      await onReplace(updated);
      setSearchMessage(updated.review_status === "approved"
        ? `${candidate.product_name || candidate.product_code} 상품을 선택하고 승인했습니다.`
        : `${candidate.product_name || candidate.product_code} 상품을 선택했습니다. 승인하려면 +재고를 0 이상의 정수로 입력해 주세요.`);
    } catch (reason) {
      setSearchPhase("error");
      setSearchMessage(reason instanceof Error ? reason.message : "상품을 선택하지 못했습니다.");
    } finally {
      setChangingCode("");
    }
  }

  async function clear() {
    if (readOnly) return;
    setChangingCode(item.matched_product_code || "clearing");
    setSearchMessage("");
    try {
      await onReplace(await clearItemMatch(item.id));
      setSearchMessage("상품 매칭을 해제했습니다.");
    } catch (reason) {
      setSearchPhase("error");
      setSearchMessage(reason instanceof Error ? reason.message : "상품 매칭을 해제하지 못했습니다.");
    } finally {
      setChangingCode("");
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || item.matched_product_code || registrationPhase === "loading") return;
    setRegistrationPhase("loading");
    setRegistrationMessage("신규 상품을 등록하고 있습니다.");
    try {
      const updated = await registerItemProduct(item.id, {
        product_code: registration.productCode.trim(),
        product_name: registration.productName.trim(),
        specification: registration.specification.trim() || null,
        current_stock: Number(registration.currentStock),
        purchase_price: registration.purchasePrice === "" ? null : Number(registration.purchasePrice),
        supplier_code: registration.supplierCode.trim() || null,
        supplier: registration.supplier.trim() || null,
      });
      await onReplace(updated);
      setRegistrationOpen(false);
      setRegistrationPhase("success");
      setRegistrationMessage(updated.review_status === "approved"
        ? "신규 상품을 등록하고 현재 품목에 반영·승인했습니다."
        : "신규 상품을 등록하고 현재 품목에 반영했습니다. +재고를 확인해 주세요.");
    } catch (reason) {
      setRegistrationPhase("error");
      setRegistrationMessage(reason instanceof Error ? reason.message : "신규 상품을 등록하지 못했습니다.");
    }
  }

  function candidateList(candidates: ProductCandidate[], label: string) {
    if (candidates.length === 0) return null;
    return (
      <div className="match-candidate-group">
        <strong>{label}</strong>
        <ul className="match-candidate-list">
          {candidates.slice(0, 5).map((candidate) => (
            <li key={candidate.product_code}>
              <div className="candidate-title"><code>{candidate.product_code}</code><strong>{candidate.product_name || "이름 없음"}</strong><span>{formatScore(candidate.score)}</span></div>
              <dl>
                <div><dt>규격</dt><dd>{candidate.specification || "없음"}</dd></div>
                <div><dt>공급사</dt><dd>{candidate.supplier || "없음"}{candidate.supplier_code ? ` (${candidate.supplier_code})` : ""}</dd></div>
                <div><dt>기준재고</dt><dd>{formatNumber(candidate.current_stock)}</dd></div>
                <div><dt>기존단가</dt><dd>{formatCurrency(candidate.purchase_price)}</dd></div>
                <div><dt>방법</dt><dd>{matchMethodLabels[candidate.match_method]}</dd></div>
              </dl>
              <button className="button button--ghost button--small" type="button" disabled={readOnly || Boolean(changingCode)} onClick={() => void choose(candidate)} aria-label={`${candidate.product_code} ${candidate.product_name || "이름 없음"} 상품 선택·반영`}>{changingCode === candidate.product_code ? "반영 중" : "이 상품 선택·반영"}</button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="item-match-panel">
      <div className={`current-match ${item.matched_product_code ? "current-match--selected" : "current-match--empty"}`}>
        {item.matched_product_code ? (
          <>
            <div><span>현재 매칭</span><strong>{item.matched_product_name || "이름 없음"}</strong><code>{item.matched_product_code}</code><small>{item.matched_specification || "규격 없음"} · {item.match_method ? matchMethodLabels[item.match_method] : "방법 없음"} · {formatScore(item.match_score)}</small></div>
            <dl><div><dt>최종 공급처 (Excel)</dt><dd>{item.matched_supplier || "정보 없음"}{item.matched_supplier_code ? ` (${item.matched_supplier_code})` : ""}</dd></div><div><dt>기준재고</dt><dd>{formatNumber(item.base_stock)}</dd></div><div><dt>기존단가</dt><dd>{formatCurrency(item.base_purchase_price)}</dd></div><div><dt>Excel 행</dt><dd>{item.matched_excel_row ?? "정보 없음"}</dd></div></dl>
            <button className="button button--ghost button--small" type="button" aria-label={`${rowLabel} ${item.matched_product_name || item.matched_product_code} 매칭 해제`} disabled={readOnly || Boolean(changingCode)} onClick={() => void clear()}>매칭 해제</button>
          </>
        ) : <div><span>현재 매칭</span><strong>미매칭</strong><small>후보를 명시적으로 선택하거나 상품리스트를 검색해 주세요.</small></div>}
      </div>

      {candidateList(item.match_candidates, `자동 후보 ${Math.min(item.match_candidates.length, 5)}개`)}

      <form className="product-search" onSubmit={(event) => void search(event)}>
        <label htmlFor={`product-search-${item.id}`}>상품리스트 검색</label>
        <div><input id={`product-search-${item.id}`} aria-label={`${rowLabel} ${itemLabel} 상품리스트 검색`} value={query} disabled={readOnly} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="상품코드 또는 상품명" /><button className="button button--secondary button--small" type="submit" aria-label={`${rowLabel} 상품리스트 검색 실행`} disabled={readOnly || searchPhase === "loading"}>{searchPhase === "loading" ? "검색 중" : "검색"}</button></div>
      </form>
      {searchMessage ? <p className={`match-message ${searchPhase === "error" ? "match-message--error" : ""}`} role={searchPhase === "error" ? "alert" : "status"}>{searchMessage}</p> : null}
      {candidateList(results, "검색 결과")}
      {!item.matched_product_code ? (
        <section className="product-registration" aria-label={`${rowLabel} 사용자 직접 등록`}>
          <button className="button button--ghost button--small" type="button" disabled={readOnly || registrationPhase === "loading"} onClick={() => { setRegistrationOpen((open) => !open); setRegistrationMessage(""); }}>
            {registrationOpen ? "직접 등록 닫기" : "사용자 직접 등록"}
          </button>
          {registrationOpen ? (
            <form onSubmit={(event) => void register(event)}>
              <p>상품리스트에 없는 신규 상품을 입력하면 현재 품목에 바로 매칭됩니다.</p>
              <div className="product-registration__fields">
                <label>상품코드<input aria-label={`${rowLabel} 신규 상품코드`} required maxLength={255} value={registration.productCode} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, productCode: value }))} /></label>
                <label>상품명<input aria-label={`${rowLabel} 신규 상품명`} required maxLength={500} value={registration.productName} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, productName: value }))} /></label>
                <label>규격<input aria-label={`${rowLabel} 신규 상품 규격`} maxLength={500} value={registration.specification} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, specification: value }))} /></label>
                <label>현재고<input aria-label={`${rowLabel} 신규 상품 현재고`} type="number" min="0" step="1" required value={registration.currentStock} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, currentStock: value }))} /></label>
                <label>매입단가<input aria-label={`${rowLabel} 신규 상품 매입단가`} type="number" min="0" step="1" value={registration.purchasePrice} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, purchasePrice: value }))} /></label>
                <label>공급사코드<input aria-label={`${rowLabel} 신규 상품 공급사코드`} maxLength={255} value={registration.supplierCode} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, supplierCode: value }))} /></label>
                <label>공급사<input aria-label={`${rowLabel} 신규 상품 공급사`} maxLength={500} value={registration.supplier} disabled={readOnly} onChange={({ currentTarget: { value } }) => setRegistration((current) => ({ ...current, supplier: value }))} /></label>
              </div>
              <button className="button button--secondary button--small" type="submit" aria-label={`${rowLabel} 신규 상품 등록·반영`} disabled={readOnly || registrationPhase === "loading"}>{registrationPhase === "loading" ? "등록 중" : "등록·반영"}</button>
            </form>
          ) : null}
          {registrationMessage ? <p className={`match-message ${registrationPhase === "error" ? "match-message--error" : ""}`} role={registrationPhase === "error" ? "alert" : "status"}>{registrationMessage}</p> : null}
        </section>
      ) : null}
      <WarningList warnings={item.warnings} />
    </div>
  );
}

export function ReviewPage({ jobId }: ReviewPageProps) {
  const [job, setJob] = useState<JobRead | null>(null);
  const [documents, setDocuments] = useState<DocumentRead[]>([]);
  const [allJobItems, setAllJobItems] = useState<ExtractedItemRead[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [documentListError, setDocumentListError] = useState("");
  const [detail, setDetail] = useState<DocumentDetailRead | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [photoViewerDocumentId, setPhotoViewerDocumentId] = useState("");
  const [photoRotation, setPhotoRotation] = useState(0);
  const [saveStates, setSaveStates] = useState<Record<string, { phase: "saving" | "saved" | "error"; message: string }>>({});
  const [saveMessage, setSaveMessage] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [matchingPhase, setMatchingPhase] = useState<SearchPhase>("idle");
  const [matchingMessage, setMatchingMessage] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [warningFilter, setWarningFilter] = useState<WarningFilter>("all");
  const [bulkStatus, setBulkStatus] = useState<ReviewStatus>("pending");
  const [bulkExclusionReason, setBulkExclusionReason] = useState("");
  const [bulkPhase, setBulkPhase] = useState<SearchPhase>("idle");
  const [bulkMessage, setBulkMessage] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [summaryPhase, setSummaryPhase] = useState<SearchPhase>("idle");
  const [summaryError, setSummaryError] = useState("");
  const [resolvingProductCode, setResolvingProductCode] = useState("");
  const [selectedSummaryProductCode, setSelectedSummaryProductCode] = useState("");
  const [selectedSummaryItemId, setSelectedSummaryItemId] = useState("");
  const [pendingTargetItemId, setPendingTargetItemId] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [exportPhase, setExportPhase] = useState<SearchPhase>("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [documentSavePhase, setDocumentSavePhase] = useState<SearchPhase>("idle");
  const [documentSaveMessage, setDocumentSaveMessage] = useState("");
  const summaryRequestId = useRef(0);
  const itemsSectionRef = useRef<HTMLElement>(null);
  const itemSaveQueues = useRef(new Map<string, Promise<void>>());
  const itemSaveVersions = useRef(new Map<string, number>());

  const completed = job?.status === "completed";
  const exportLocked = job?.status === "exporting" || exportPhase === "loading";
  const mutationLocked = job?.status === "extracting" || completed || exportLocked;

  const refreshSummary = useCallback(async () => {
    const requestId = ++summaryRequestId.current;
    setSummaryPhase("loading");
    setSummaryError("");
    try {
      const result = await getReviewSummary(jobId);
      if (requestId !== summaryRequestId.current) return;
      setSummary(result);
      setSummaryPhase("success");
    } catch (reason) {
      if (requestId !== summaryRequestId.current) return;
      setSummaryPhase("error");
      setSummaryError(reason instanceof Error ? reason.message : "작업 집계를 불러오지 못했습니다.");
    }
  }, [jobId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDocuments([]);
    setAllJobItems([]);
    setJob(null);
    setSelectedDocumentId("");
    setDetail(null);
    Promise.all([getDocuments(jobId), getJob(jobId), getJobItems(jobId)])
      .then(([result, jobResult, itemResult]) => {
        if (!active) return;
        const sorted = [...result].sort((a, b) => a.source_order - b.source_order);
        setDocuments(sorted);
        setJob(jobResult);
        setAllJobItems(itemResult);
        const firstPendingDocument = sorted.find((document) => itemResult.some((item) => item.document_id === document.id && item.review_status === "pending"));
        setSelectedDocumentId(firstPendingDocument?.id || "");
        setDocumentListError("");
        if (sorted.length === 0) setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setDocumentListError(reason instanceof Error ? reason.message : "문서 목록을 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [jobId]);

  useEffect(() => {
    void refreshSummary();
    return () => { summaryRequestId.current += 1; };
  }, [refreshSummary]);

  useEffect(() => {
    if (!selectedDocumentId) return;
    let active = true;
    setLoading(true);
    setDetail(null);
    setDetailError("");
    setSaveMessage("");
    getDocument(selectedDocumentId)
      .then((result) => {
        if (!active) return;
        setDetail(result);
      })
      .catch((reason: unknown) => {
        if (active) setDetailError(reason instanceof Error ? reason.message : "문서 상세를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [selectedDocumentId]);

  const { pendingCountsByDocument, pendingItemCount, reviewDocuments } = useMemo(() => {
    const counts = new Map<string, number>();
    allJobItems.forEach((item) => {
      if (item.review_status === "pending") counts.set(item.document_id, (counts.get(item.document_id) || 0) + 1);
    });
    return {
      pendingCountsByDocument: counts,
      pendingItemCount: [...counts.values()].reduce((total, count) => total + count, 0),
      reviewDocuments: pendingOnly ? documents.filter((document) => counts.has(document.id)) : documents,
    };
  }, [allJobItems, documents, pendingOnly]);
  const reviewDocumentKey = reviewDocuments.map((document) => document.id).join("|");
  const selectedIndex = reviewDocuments.findIndex((document) => document.id === selectedDocumentId);

  function selectDocument(documentId: string) {
    setPhotoViewerOpen(false);
    setPhotoViewerDocumentId("");
    setPhotoRotation(0);
    setSelectedDocumentId(documentId);
  }

  useEffect(() => {
    if (reviewDocuments.length === 0) {
      if (selectedDocumentId) setSelectedDocumentId("");
      setDetail(null);
      setLoading(false);
      return;
    }
    if (selectedIndex >= 0) return;

    const previousOrder = documents.find((document) => document.id === selectedDocumentId)?.source_order ?? -1;
    const nextDocument = reviewDocuments.find((document) => document.source_order > previousOrder) || reviewDocuments[0];
    setPhotoViewerOpen(false);
    setPhotoRotation(0);
    setSelectedDocumentId(nextDocument.id);
  }, [documents, reviewDocumentKey, reviewDocuments, selectedDocumentId, selectedIndex]);

  function changePendingOnly(checked: boolean) {
    setPendingOnly(checked);
    setStatusFilter(checked ? "pending" : "all");
    setBulkMessage("");
  }

  function changeStatusFilter(filter: StatusFilter) {
    setStatusFilter(filter);
    if (pendingOnly && filter !== "pending") setPendingOnly(false);
    setBulkMessage("");
  }

  function reviewPendingItems() {
    if (pendingItemCount === 0) return;
    const closingSplitView = Boolean(selectedSummaryProductCode);
    setSelectedSummaryProductCode("");
    setSelectedSummaryItemId("");
    setPendingOnly(true);
    setStatusFilter("pending");
    setMatchFilter("all");
    setWarningFilter("all");
    setBulkMessage("");
    const firstPendingDocument = documents.find((document) => pendingCountsByDocument.has(document.id));
    if (firstPendingDocument) selectDocument(firstPendingDocument.id);
    if (closingSplitView) window.setTimeout(() => itemsSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
    else itemsSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function selectSummaryProduct(product: ReviewProductSummary) {
    setSelectedSummaryProductCode(product.product_code);
    setSelectedSummaryItemId((current) => product.item_ids.includes(current)
      ? current
      : product.item_ids.find((itemId) => allJobItems.find((item) => item.id === itemId)?.review_status === "pending") || product.item_ids[0] || "");
  }

  function selectPendingItem(item: ExtractedItemRead) {
    const summaryProduct = summary?.products.find((product) => product.item_ids.includes(item.id));
    setBulkMessage("");
    if (summaryProduct) {
      setSelectedSummaryProductCode(summaryProduct.product_code);
      setSelectedSummaryItemId(item.id);
      return;
    }
    setSelectedSummaryProductCode("");
    setSelectedSummaryItemId("");
    setPendingOnly(true);
    setStatusFilter("pending");
    setMatchFilter("all");
    setWarningFilter("all");
    setPendingTargetItemId(item.id);
    selectDocument(item.document_id);
  }

  useEffect(() => {
    if (!pendingTargetItemId || !detail?.items.some((item) => item.id === pendingTargetItemId)) return;
    const targetId = pendingTargetItemId;
    window.setTimeout(() => window.document.getElementById(`review-item-${targetId}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 0);
    setPendingTargetItemId("");
  }, [detail, pendingTargetItemId]);

  useEffect(() => {
    if (!photoViewerOpen) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPhotoViewerOpen(false);
        setPhotoViewerDocumentId("");
        setPhotoRotation(0);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [photoViewerOpen]);

  function updateLocalItem(itemId: string, field: EditableField, value: string | number | boolean | null) {
    applyLocalItemChanges(itemId, { [field]: value } as ItemMutation);
  }

  function applyLocalItemChanges(itemId: string, changes: ItemMutation) {
    setDetail((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...changes } : item),
    } : current);
    setAllJobItems((current) => current.map((item) => item.id === itemId ? { ...item, ...changes } : item));
    setSaveMessage("");
  }

  function replaceItems(updatedItems: ExtractedItemRead[]) {
    const updatedById = new Map(updatedItems.map((item) => [item.id, item]));
    setDetail((current) => current ? {
      ...current,
      items: current.items.map((item) => updatedById.get(item.id) || item),
    } : current);
    setAllJobItems((current) => current.map((item) => updatedById.get(item.id) || item));
  }

  function replaceItem(updated: ExtractedItemRead) {
    replaceItems([updated]);
  }

  function updateLocalDocument(values: DocumentMutation) {
    setDetail((current) => current ? { ...current, ...values } : current);
    setDocumentSaveMessage("");
  }

  async function saveDocumentMetadata(values: DocumentMutation, label: string) {
    if (mutationLocked || documentSavePhase === "loading" || !detail) return;
    const documentId = detail.id;
    setDocumentSavePhase("loading");
    setDocumentSaveMessage(`${label} 저장 중`);
    try {
      await updateDocument(documentId, values);
      const [latestDetail, latestItems] = await Promise.all([
        getDocument(documentId),
        getJobItems(jobId),
        refreshSummary(),
      ]);
      setDetail((current) => current?.id === documentId ? latestDetail : current);
      setDocuments((current) => current.map((document) => document.id === documentId ? latestDetail : document));
      setAllJobItems(latestItems);
      setDocumentSavePhase("success");
      setDocumentSaveMessage(`${label} 저장됨`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${label}을(를) 저장하지 못했습니다.`;
      try {
        const latestDetail = await getDocument(documentId);
        setDetail((current) => current?.id === documentId ? latestDetail : current);
        setDocuments((current) => current.map((document) => document.id === documentId ? latestDetail : document));
        setDocumentSaveMessage(message);
      } catch {
        setDocumentSaveMessage(`${message} 서버 최신값도 다시 불러오지 못했습니다.`);
      }
      setDocumentSavePhase("error");
    }
  }

  async function restoreLatestItems(itemId: string, message: string) {
    try {
      const latest = await getJobItems(jobId);
      setAllJobItems(latest);
      const latestById = new Map(latest.map((item) => [item.id, item]));
      setDetail((current) => current ? { ...current, items: current.items.map((item) => latestById.get(item.id) || item) } : current);
      setSaveStates((current) => ({ ...current, [itemId]: { phase: "error", message } }));
    } catch {
      setSaveStates((current) => ({ ...current, [itemId]: { phase: "error", message: `${message} 서버 최신값도 다시 불러오지 못했습니다.` } }));
    }
  }

  function saveItemChanges(item: ExtractedItemRead, changes: ItemMutation): Promise<void> {
    if (mutationLocked) return Promise.resolve();
    const rowLabel = `${item.source_row_order + 1}번 행`;
    const version = (itemSaveVersions.current.get(item.id) ?? 0) + 1;
    itemSaveVersions.current.set(item.id, version);
    applyLocalItemChanges(item.id, changes);
    setSaveStates((current) => ({ ...current, [item.id]: { phase: "saving", message: `${rowLabel} 저장 중` } }));
    const previous = itemSaveQueues.current.get(item.id) ?? Promise.resolve();
    const queued = previous.then(async () => {
      try {
        const updated = await updateItem(item.id, changes);
        if (itemSaveVersions.current.get(item.id) !== version) return;
        replaceItem(updated);
        setSaveStates((current) => ({ ...current, [item.id]: { phase: "saved", message: `${rowLabel} 저장됨` } }));
        void refreshSummary();
      } catch (reason) {
        if (itemSaveVersions.current.get(item.id) !== version) return;
        await restoreLatestItems(item.id, reason instanceof Error ? reason.message : "품목을 저장하지 못했습니다.");
      }
    });
    itemSaveQueues.current.set(item.id, queued);
    void queued.finally(() => {
      if (itemSaveQueues.current.get(item.id) === queued) {
        itemSaveQueues.current.delete(item.id);
      }
    });
    return queued;
  }

  async function changeReviewStatus(item: ExtractedItemRead, status: ReviewStatus) {
    if (status === "excluded" && !item.exclusion_reason?.trim()) {
      setSaveStates((current) => ({ ...current, [item.id]: { phase: "error", message: "제외 사유를 먼저 입력해 주세요." } }));
      return;
    }
    await saveItemChanges(item, status === "excluded" ? { review_status: status, exclusion_reason: item.exclusion_reason?.trim() || null } : { review_status: status });
  }

  async function applyBulk(values: BulkItemUpdate, successMessage: string) {
    if (mutationLocked) return;
    setBulkPhase("loading");
    setBulkMessage("일괄 변경을 저장하고 있습니다.");
    try {
      replaceItems(await bulkUpdateItems(jobId, values));
      setBulkPhase("success");
      setBulkMessage(successMessage);
      void refreshSummary();
    } catch (reason) {
      setBulkPhase("error");
      setBulkMessage(reason instanceof Error ? reason.message : "일괄 변경에 실패했습니다.");
    }
  }

  async function addManualItem() {
    if (mutationLocked || !detail || addingItem) return;
    setAddingItem(true);
    setSaveMessage("");
    try {
      const created = await createItem(detail.id, {
        product_code_or_barcode: null,
        product_name: null,
        specification: null,
        quantity: null,
        unit_price: null,
        amount: null,
        bundle_or_set_text: null,
        stock_increment: 0,
        apply_inventory: true,
      });
      setDetail((current) => current ? { ...current, items: [...current.items, created] } : current);
      setAllJobItems((current) => [...current, created]);
      await refreshSummary();
      setSaveMessage("수기 행을 추가했습니다.");
    } catch (reason) {
      setSaveMessage(reason instanceof Error ? reason.message : "수기 행을 추가하지 못했습니다.");
    } finally {
      setAddingItem(false);
    }
  }

  async function runAutoMatching() {
    if (mutationLocked || documents.length === 0 || matchingPhase === "loading") return;
    setMatchingPhase("loading");
    setMatchingMessage("전체 품목의 상품 후보와 검증 경고를 계산하고 있습니다.");
    try {
      await matchJob(jobId);
      const [updatedDocuments, updatedDetail, updatedItems] = await Promise.all([
        getDocuments(jobId),
        selectedDocumentId ? getDocument(selectedDocumentId) : Promise.resolve(null),
        getJobItems(jobId),
      ]);
      setDocuments([...updatedDocuments].sort((a, b) => a.source_order - b.source_order));
      setAllJobItems(updatedItems);
      if (updatedDetail) setDetail(updatedDetail);
      await refreshSummary();
      setMatchingPhase("success");
      setMatchingMessage("자동 매칭이 완료되었습니다. 미매칭 행과 경고 근거를 확인해 주세요.");
    } catch (reason) {
      setMatchingPhase("error");
      setMatchingMessage(reason instanceof Error ? reason.message : "자동 매칭을 완료하지 못했습니다.");
    }
  }

  async function replaceMatchedItem(updated: ExtractedItemRead) {
    replaceItem(updated);
    void refreshSummary();
  }

  async function resolvePrice(productCode: string, itemId: string) {
    if (mutationLocked || resolvingProductCode) return;
    const requestId = ++summaryRequestId.current;
    setResolvingProductCode(productCode);
    setSummaryError("");
    try {
      const result = await resolveProductPrice(jobId, productCode, itemId);
      if (requestId !== summaryRequestId.current) return;
      setSummary(result);
      setSummaryPhase("success");
    } catch (reason) {
      if (requestId !== summaryRequestId.current) return;
      setSummaryPhase("error");
      setSummaryError(reason instanceof Error ? reason.message : "대표 단가를 저장하지 못했습니다.");
    } finally {
      setResolvingProductCode((current) => current === productCode ? "" : current);
    }
  }

  async function createExport() {
    const normalizedApprover = approvedBy.trim();
    if (mutationLocked || !summary?.ready_to_export || !normalizedApprover) return;
    setExportPhase("loading");
    setExportMessage("결과 Excel을 안전하게 생성하고 있습니다.");
    try {
      setJob(await exportJob(jobId, normalizedApprover));
      setExportPhase("success");
      window.history.pushState({}, "", `/jobs/${jobId}/complete`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (reason) {
      setExportPhase("error");
      setExportMessage(reason instanceof Error ? reason.message : "결과 Excel을 생성하지 못했습니다.");
      await refreshSummary();
    }
  }

  const filteredItems = (detail?.items || []).filter((item) => {
    if (pendingOnly && item.review_status !== "pending") return false;
    if (statusFilter !== "all" && item.review_status !== statusFilter) return false;
    if (matchFilter === "matched" && !item.matched_product_code) return false;
    if (matchFilter === "unmatched" && item.matched_product_code) return false;
    if (warningFilter === "with_warnings" && item.warnings.length === 0) return false;
    if (warningFilter === "without_warnings" && item.warnings.length > 0) return false;
    return true;
  });

  function applyFilteredStatus() {
    if (mutationLocked) return;
    if (filteredItems.length === 0) {
      setBulkPhase("error");
      setBulkMessage("현재 필터에 해당하는 품목이 없습니다.");
      return;
    }
    if (bulkStatus === "approved" && filteredItems.some((item) => approvalBlockReason(item))) {
      setBulkPhase("error");
      setBulkMessage("필터 결과에 승인할 수 없는 미매칭 또는 +재고 오류 행이 있습니다.");
      return;
    }
    if (bulkStatus === "excluded" && !bulkExclusionReason.trim()) {
      setBulkPhase("error");
      setBulkMessage("일괄 제외 사유를 입력해 주세요.");
      return;
    }
    const values: BulkItemUpdate = { item_ids: filteredItems.map((item) => item.id), review_status: bulkStatus };
    if (bulkStatus === "excluded") values.exclusion_reason = bulkExclusionReason.trim();
    void applyBulk(values, `${filteredItems.length}개 행의 상태를 ${reviewStatusLabels[bulkStatus]}로 변경했습니다.`);
  }

  const summaryProductByItemId = new Map<string, ReviewProductSummary>();
  summary?.products.forEach((product) => product.item_ids.forEach((itemId) => summaryProductByItemId.set(itemId, product)));
  const selectedSummaryProduct = summary?.products.find((product) => product.product_code === selectedSummaryProductCode) || null;
  const selectedSummaryItems = selectedSummaryProduct
    ? selectedSummaryProduct.item_ids.map((itemId) => allJobItems.find((item) => item.id === itemId)).filter((item): item is ExtractedItemRead => Boolean(item))
    : [];
  const selectedSummaryItem = selectedSummaryItems.find((item) => item.id === selectedSummaryItemId) || selectedSummaryItems[0] || null;
  const selectedSummaryDocument = selectedSummaryItem ? documents.find((document) => document.id === selectedSummaryItem.document_id) || null : null;

  useEffect(() => {
    if (!summary || !selectedSummaryProductCode) return;
    const currentProduct = summary.products.find((product) => product.product_code === selectedSummaryProductCode);
    if (!currentProduct) {
      setSelectedSummaryProductCode("");
      setSelectedSummaryItemId("");
      return;
    }
    if (!currentProduct.item_ids.includes(selectedSummaryItemId)) setSelectedSummaryItemId(currentProduct.item_ids[0] || "");
  }, [selectedSummaryItemId, selectedSummaryProductCode, summary]);

  let selectedProductDetailPanel: ReactNode = null;
  if (selectedSummaryProduct && selectedSummaryItem) {
    const item = selectedSummaryItem;
    const documentName = selectedSummaryDocument?.original_image_name || "문서 정보 없음";
    const rowLabel = `${documentName} ${item.source_row_order + 1}번 행`;
    const blockReason = approvalBlockReason(item);
    const inventoryIncrement = item.review_status === "approved" && item.apply_inventory && !blockReason ? item.stock_increment || 0 : 0;
    const expectedStock = selectedSummaryProduct.final_stock;
    const priceCanApply = Boolean(item.matched_product_code) && item.unit_price !== null && item.unit_price >= 0;
    const expectedPrice = selectedSummaryProduct.final_purchase_price;
    const saveState = saveStates[item.id];
    selectedProductDetailPanel = (
      <>
        <div className="selected-product-panel__header">
          <div><span>선택 상품 상세</span><h3>{selectedSummaryProduct.product_name || "이름 없음"}</h3><code>{selectedSummaryProduct.product_code}</code></div>
          <div className="selected-product-panel__actions">
            <button className="button button--ghost button--small" type="button" disabled={!selectedSummaryDocument} onClick={() => { setPhotoViewerDocumentId(item.document_id); setPhotoRotation(0); setPhotoViewerOpen(true); }}>원본 사진 보기</button>
            <button className="button button--ghost button--small" type="button" onClick={() => { setSelectedSummaryProductCode(""); setSelectedSummaryItemId(""); }}>닫기</button>
          </div>
        </div>
        {selectedSummaryItems.length > 1 ? (
          <div className="selected-product-row-tabs" role="group" aria-label="선택 상품 관련 행">
            {selectedSummaryItems.map((relatedItem) => {
              const relatedDocument = documents.find((document) => document.id === relatedItem.document_id);
              const relatedLabel = `${relatedDocument?.original_image_name || "문서"} ${relatedItem.source_row_order + 1}번 행`;
              return <button key={relatedItem.id} type="button" aria-pressed={relatedItem.id === item.id} onClick={() => setSelectedSummaryItemId(relatedItem.id)}>{relatedLabel}<small>{reviewStatusLabels[relatedItem.review_status]}</small></button>;
            })}
          </div>
        ) : <p className="selected-product-source">{rowLabel}</p>}
        <div className="selected-product-fields">
          <label><span>상품코드/바코드</span><input aria-label={`${rowLabel} 상품코드 또는 바코드`} disabled={mutationLocked} value={item.product_code_or_barcode ?? ""} onChange={(event) => updateLocalItem(item.id, "product_code_or_barcode", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { product_code_or_barcode: item.product_code_or_barcode })} /><small>OCR 원문: {displayOriginal(item.ocr_product_code_or_barcode)}</small></label>
          <label><span>상품명</span><input aria-label={`${rowLabel} 상품명`} disabled={mutationLocked} value={item.product_name ?? ""} onChange={(event) => updateLocalItem(item.id, "product_name", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { product_name: item.product_name })} /><small>OCR 원문: {displayOriginal(item.ocr_product_name)}</small></label>
          <label><span>규격</span><input aria-label={`${rowLabel} 규격`} disabled={mutationLocked} value={item.specification ?? ""} onChange={(event) => updateLocalItem(item.id, "specification", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { specification: item.specification })} /><small>OCR 원문: {displayOriginal(item.ocr_specification)}</small></label>
          <label><span>수량</span><input aria-label={`${rowLabel} 수량`} type="number" min="0" disabled={mutationLocked} value={item.quantity ?? ""} onChange={(event) => updateLocalItem(item.id, "quantity", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { quantity: item.quantity })} /><small>OCR 원문: {displayOriginal(item.ocr_quantity)}</small></label>
          <label><span>단가</span><input aria-label={`${rowLabel} 단가`} type="number" min="0" disabled={mutationLocked} value={item.unit_price ?? ""} onChange={(event) => updateLocalItem(item.id, "unit_price", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { unit_price: item.unit_price })} /><small>OCR 원문: {displayOriginal(item.ocr_unit_price)}</small></label>
          <label><span>금액</span><input aria-label={`${rowLabel} 금액`} type="number" min="0" disabled={mutationLocked} value={item.amount ?? ""} onChange={(event) => updateLocalItem(item.id, "amount", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { amount: item.amount })} /><small>OCR 원문: {displayOriginal(item.ocr_amount)}</small></label>
          <label><span>묶음/세트</span><input aria-label={`${rowLabel} 묶음 또는 세트`} disabled={mutationLocked} value={item.bundle_or_set_text ?? ""} onChange={(event) => updateLocalItem(item.id, "bundle_or_set_text", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { bundle_or_set_text: item.bundle_or_set_text })} /><small>OCR 원문: {displayOriginal(item.ocr_bundle_or_set_text)}</small></label>
          <label><span>재고 증가</span><input aria-label={`${rowLabel} 재고 증가`} type="number" min="0" step="1" disabled={mutationLocked} value={item.stock_increment ?? ""} onChange={(event) => updateLocalItem(item.id, "stock_increment", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { stock_increment: item.stock_increment })} /><small>현재 입력값</small></label>
        </div>
        <div className="selected-product-review-fields">
          <label><span>검수 상태</span><select aria-label={`${rowLabel} 검수 상태`} value={item.review_status} disabled={mutationLocked} onChange={(event) => void changeReviewStatus(item, event.currentTarget.value as ReviewStatus)}><option value="pending">보류</option><option value="approved" disabled={Boolean(blockReason)}>승인</option><option value="excluded">제외</option></select></label>
          <label className="apply-field"><input aria-label={`${rowLabel} 재고 반영`} type="checkbox" checked={item.apply_inventory} disabled={mutationLocked} onChange={(event) => void saveItemChanges(item, { apply_inventory: event.currentTarget.checked })} /><span>재고 반영</span></label>
          <label className="apply-field"><input aria-label={`${rowLabel} 매입단가 반영`} type="checkbox" checked={item.apply_purchase_price} disabled={mutationLocked || !priceCanApply} onChange={(event) => void saveItemChanges(item, { apply_purchase_price: event.currentTarget.checked })} /><span>매입단가 반영</span></label>
          <label className="selected-product-exclusion"><span>제외 사유</span><input aria-label={`${rowLabel} 제외 사유`} disabled={mutationLocked} value={item.exclusion_reason ?? ""} onChange={(event) => updateLocalItem(item.id, "exclusion_reason", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { exclusion_reason: item.exclusion_reason?.trim() || null })} /></label>
        </div>
        {blockReason ? <p className="approval-block-reason">승인 불가: {blockReason}</p> : null}
        <dl className="review-calculation selected-product-calculation" aria-label={`${rowLabel} 반영 예상값`}>
          <div><dt>기준 재고</dt><dd>{formatNumber(item.base_stock)}</dd></div><div><dt>재고 증가</dt><dd>+{formatNumber(inventoryIncrement)}</dd></div><div><dt>예상 재고</dt><dd>{formatNumber(expectedStock)}</dd></div><div><dt>기존 매입단가</dt><dd>{formatCurrency(item.base_purchase_price)}</dd></div><div><dt>사진 단가</dt><dd>{formatCurrency(item.unit_price)}</dd></div><div><dt>예상 매입단가</dt><dd>{formatCurrency(expectedPrice)}</dd></div>
        </dl>
        {saveState ? <p className={`row-save-state ${saveState.phase === "error" ? "row-save-state--error" : ""}`} role={saveState.phase === "error" ? "alert" : "status"}>{saveState.message}</p> : null}
        <MatchPanel item={item} jobId={jobId} readOnly={mutationLocked} onReplace={replaceMatchedItem} />
      </>
    );
  }
  const saveInProgress = Object.values(saveStates).some((state) => state.phase === "saving");
  const mutationInProgress = saveInProgress || addingItem || matchingPhase === "loading" || bulkPhase === "loading" || Boolean(resolvingProductCode) || documentSavePhase === "loading" || exportPhase === "loading";
  const exportDisabled = mutationLocked || !summary?.ready_to_export || !approvedBy.trim() || mutationInProgress || summaryPhase === "loading";
  const photoViewerDocument = documents.find((document) => document.id === photoViewerDocumentId) || (detail?.id === photoViewerDocumentId ? detail : null);

  return (
    <>
      <PageHeader
        eyebrow={`작업 ${jobId}`}
        title="사진과 품목 검수"
        description="사진 원문과 OCR 인식값을 비교하고 실제 반영할 현재 값을 수정해 주세요."
        actions={completed ? <span className="read-only-badge">완료된 작업 · 읽기 전용</span> : exportLocked ? <span className="read-only-badge">내보내기 진행 중 · 편집 잠금</span> : saveMessage ? <span className="save-state" role="status">{saveMessage}</span> : null}
      />
      <WorkflowSteps current={3} />

      {exportLocked ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" /><strong>결과 Excel을 생성하는 동안 편집이 잠겼습니다.</strong><span>완료될 때까지 입력과 일괄 변경을 사용할 수 없습니다.</span></div> : null}

      <div className="review-toolbar" aria-label="검수 문서 선택">
        <a className="button button--ghost button--small" href={`/jobs/${jobId}/upload`}>업로드·문서 관리</a>
        <label className="pending-review-toggle"><input type="checkbox" aria-label="보류 항목만 검수" checked={pendingOnly} onChange={(event) => changePendingOnly(event.currentTarget.checked)} /><span>보류 항목만 검수</span><strong>{pendingItemCount}개</strong></label>
        <div className="document-control">
          <button type="button" aria-label="이전 문서" disabled={selectedIndex <= 0} onClick={() => selectDocument(reviewDocuments[selectedIndex - 1].id)}>‹</button>
          <strong>{reviewDocuments.length ? `${pendingOnly ? "보류 사진" : "문서"} ${selectedIndex + 1} / ${reviewDocuments.length}` : `${pendingOnly ? "보류 사진" : "문서"} 0 / 0`}</strong>
          <button type="button" aria-label="다음 문서" disabled={selectedIndex < 0 || selectedIndex >= reviewDocuments.length - 1} onClick={() => selectDocument(reviewDocuments[selectedIndex + 1].id)}>›</button>
        </div>
        <label>{pendingOnly ? "보류 사진" : "검수 문서"}
          <select aria-label={pendingOnly ? "보류 사진" : "검수 문서"} value={selectedDocumentId} disabled={reviewDocuments.length === 0} onChange={(event) => selectDocument(event.currentTarget.value)}>
            {reviewDocuments.length === 0 ? <option value="">{pendingOnly ? "보류 사진 없음" : "문서 없음"}</option> : reviewDocuments.map((document) => <option key={document.id} value={document.id}>{document.source_order + 1}. {document.original_image_name}{pendingCountsByDocument.has(document.id) ? ` (보류 ${pendingCountsByDocument.get(document.id)}개)` : ""}</option>)}
          </select>
        </label>
        <button className="button button--primary button--small" type="button" disabled={mutationLocked || documents.length === 0 || matchingPhase === "loading"} onClick={() => void runAutoMatching()}>{matchingPhase === "loading" ? "자동 매칭 중" : "자동 매칭 실행"}</button>
        <button className="button button--secondary button--small" type="button" disabled={mutationLocked || !detail || addingItem} onClick={() => void addManualItem()}>{addingItem ? "행 추가 중" : "누락 행 추가"}</button>
      </div>

      {detail ? (
        <section className="review-document-metadata" aria-labelledby="document-metadata-heading">
          <div className="review-document-metadata__heading">
            <h2 id="document-metadata-heading">명세서 정보</h2>
            {documentSaveMessage ? <p className={`row-save-state ${documentSavePhase === "error" ? "row-save-state--error" : ""}`} role={documentSavePhase === "error" ? "alert" : "status"}>{documentSaveMessage}</p> : null}
          </div>
          <label>공급자<input aria-label="사진 공급자" value={detail.photo_supplier ?? ""} disabled={mutationLocked || documentSavePhase === "loading"} onChange={(event) => updateLocalDocument({ photo_supplier: event.currentTarget.value })} onBlur={(event) => void saveDocumentMetadata({ photo_supplier: event.currentTarget.value.trim() || null }, "사진 공급자")} /></label>
          <label>거래일<input aria-label="거래일" type="date" value={detail.transaction_date ?? ""} disabled={mutationLocked || documentSavePhase === "loading"} onChange={(event) => updateLocalDocument({ transaction_date: event.currentTarget.value || null })} onBlur={(event) => void saveDocumentMetadata({ transaction_date: event.currentTarget.value || null }, "거래일")} /></label>
          <label>명세서 번호<input aria-label="명세서 번호" value={detail.invoice_number ?? ""} disabled={mutationLocked || documentSavePhase === "loading"} onChange={(event) => updateLocalDocument({ invoice_number: event.currentTarget.value })} onBlur={(event) => void saveDocumentMetadata({ invoice_number: event.currentTarget.value.trim() || null }, "명세서 번호")} /></label>
          {detail.correction_warning ? <p className="image-warning">보정 주의: {detail.correction_warning}</p> : null}
          {detail.processing_error ? <p className="image-error" role="alert">처리 오류: {detail.processing_error}</p> : null}
        </section>
      ) : null}

      {documentListError ? <div className="inline-state inline-state--error" role="alert">{documentListError}</div> : null}
      {detailError ? <div className="inline-state inline-state--error" role="alert">{detailError}</div> : null}
      {loading ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" />문서와 추출 품목을 불러오는 중입니다.</div> : null}
      {pendingOnly && !loading && pendingItemCount === 0 ? <div className="inline-state pending-review-complete" role="status"><strong>보류 검수가 끝났습니다.</strong><span>전체 항목이 승인 또는 제외 상태입니다. 필요하면 ‘보류 항목만 검수’를 해제해 전체 내용을 확인하세요.</span></div> : null}
      {matchingMessage ? <div className={`inline-state ${matchingPhase === "error" ? "inline-state--error" : ""}`} role={matchingPhase === "error" ? "alert" : "status"}>{matchingPhase === "loading" ? <span className="spinner" aria-hidden="true" /> : null}{matchingMessage}</div> : null}
      {detail?.duplicate_status === "confirmed" ? <div className="duplicate-banner duplicate-banner--confirmed" role="alert"><strong>확정 중복 명세서</strong><span>동일한 명세서로 확인되었습니다. 제거되기 전까지 내보내기가 차단됩니다.</span></div> : null}
      {detail?.duplicate_status === "suspected" ? <div className="duplicate-banner duplicate-banner--suspected" role="status"><strong>중복 의심 명세서</strong><span>유사 문서가 있습니다. 이미지와 문서 정보를 확인해 주세요.</span></div> : null}

      <section className="review-control-panel" aria-label="품목 검수 제어">
        <div className="review-filter-grid">
          <label>검수 상태 필터<select aria-label="검수 상태 필터" value={statusFilter} onChange={(event) => changeStatusFilter(event.currentTarget.value as StatusFilter)}><option value="all">전체</option><option value="pending">보류</option><option value="approved">승인</option><option value="excluded">제외</option></select></label>
          <label>매칭 여부 필터<select aria-label="매칭 여부 필터" value={matchFilter} onChange={(event) => setMatchFilter(event.currentTarget.value as MatchFilter)}><option value="all">전체</option><option value="matched">매칭만</option><option value="unmatched">미매칭만</option></select></label>
          <label>경고 필터<select aria-label="경고 필터" value={warningFilter} onChange={(event) => setWarningFilter(event.currentTarget.value as WarningFilter)}><option value="all">전체</option><option value="with_warnings">경고 있음</option><option value="without_warnings">경고 없음</option></select></label>
          <span className="filter-count">현재 사진 {filteredItems.length}/{detail?.items.length || 0}개 표시{pendingOnly ? " · 보류만" : ""}</span>
        </div>
        <div className="bulk-review-controls">
          <label>필터 결과 상태 변경<select aria-label="필터 결과 상태 변경" value={bulkStatus} disabled={mutationLocked || bulkPhase === "loading"} onChange={(event) => setBulkStatus(event.currentTarget.value as ReviewStatus)}><option value="pending">보류</option><option value="approved">승인</option><option value="excluded">제외</option></select></label>
          {bulkStatus === "excluded" ? <label>공통 제외 사유<input aria-label="공통 제외 사유" value={bulkExclusionReason} disabled={mutationLocked} onChange={(event) => setBulkExclusionReason(event.currentTarget.value)} /></label> : null}
          <button className="button button--secondary button--small" type="button" disabled={mutationLocked || bulkPhase === "loading" || filteredItems.length === 0} onClick={applyFilteredStatus}>필터 결과에 적용</button>
        </div>
        {job ? <fieldset className="inventory-master-group" disabled={mutationLocked}>
          <legend>상태별 재고 반영 마스터</legend>
          <p>현재 필터와 관계없이 작업 전체에서 같은 상태인 행을 변경합니다.</p>
          <div>{(["pending", "approved", "excluded"] as ReviewStatus[]).map((status) => <InventoryMaster key={status} status={status} items={allJobItems} disabled={mutationLocked} busy={bulkPhase === "loading"} onChange={(checked) => void applyBulk({ target_review_status: status, apply_inventory: checked }, `작업 전체 ${reviewStatusLabels[status]} 행의 재고 반영을 변경했습니다.`)} />)}</div>
        </fieldset> : null}
        {bulkMessage ? <p className={`bulk-message ${bulkPhase === "error" ? "bulk-message--error" : ""}`} role={bulkPhase === "error" ? "alert" : "status"}>{bulkMessage}</p> : null}
      </section>

      {summaryPhase === "loading" && !summary ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" />작업 전체 집계를 계산하는 중입니다.</div> : null}
      {summaryError ? <div className="inline-state inline-state--error" role="alert"><strong>작업 집계를 갱신하지 못했습니다.</strong><span>{summaryError} 입력값을 확인한 뒤 다시 시도해 주세요.</span></div> : null}
      {summary ? <ReviewSummaryPanel summary={summary} items={allJobItems} documents={documents} readOnly={mutationLocked} resolvingProductCode={resolvingProductCode} selectedProductCode={selectedSummaryProductCode} detailPanel={selectedProductDetailPanel} onReviewPending={reviewPendingItems} onSelectPendingItem={selectPendingItem} onSelectProduct={selectSummaryProduct} onResolvePrice={(productCode, itemId) => void resolvePrice(productCode, itemId)} /> : null}

      <section className="panel export-panel" aria-labelledby="export-heading">
        <div className="export-panel__heading"><div><h2 id="export-heading">안전한 내보내기</h2><p>서버 사전 검증을 모두 통과한 뒤 승인자와 함께 완료 이력을 확정합니다.</p></div><span className={summary?.ready_to_export ? "export-ready" : "export-blocked"}>{summary?.ready_to_export ? "내보내기 준비됨" : "내보내기 차단됨"}</span></div>
        {summary && summary.blockers.length > 0 ? <ul className="export-blocker-list" role="alert" aria-label="내보내기 차단 사유">{summary.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}><code>{blocker.code}</code><div><strong>{blocker.message}</strong><span>{blockerNextAction(blocker)}</span></div></li>)}</ul> : null}
        <div className="export-controls">
          <label htmlFor="approved-by">승인자 이름</label>
          <input id="approved-by" value={approvedBy} disabled={mutationLocked} onChange={(event) => setApprovedBy(event.currentTarget.value)} placeholder="승인자 이름 입력" />
          <button className="button button--primary" type="button" disabled={exportDisabled} onClick={() => void createExport()}>{exportPhase === "loading" ? "결과 생성 중" : "결과 Excel 생성"}</button>
        </div>
        {exportMessage ? <p className={`export-message ${exportPhase === "error" ? "export-message--error" : ""}`} role={exportPhase === "error" ? "alert" : "status"}>{exportMessage}</p> : null}
      </section>

      {!selectedProductDetailPanel ? <div className="review-workspace review-workspace--items-only">
        <section ref={itemsSectionRef} className="table-pane" aria-labelledby="items-heading">
          <div className="pane-heading">
            <div className="pane-heading__title">
              <h2 id="items-heading">추출 품목</h2>
              <button className="button button--ghost button--small" type="button" disabled={!detail} title="업로드한 원본 명세서 사진을 엽니다." onClick={() => { if (detail) setPhotoViewerDocumentId(detail.id); setPhotoRotation(0); setPhotoViewerOpen(true); }}>원본 사진 보기</button>
            </div>
            <span className="count-badge">{pendingOnly ? filteredItems.length : detail?.items.length || 0}개</span>
          </div>
          <div className="table-scroll review-table-scroll">
            <table className="review-items-table">
              <thead><tr><th scope="col">행</th><th scope="col">상품코드/바코드</th><th scope="col">상품명</th><th scope="col">규격</th><th scope="col">수량</th><th scope="col">단가</th><th scope="col">금액</th><th scope="col">묶음/세트</th><th scope="col">재고 증가</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => {
                  const rowLabel = `${item.source_row_order + 1}번 행`;
                  const blockReason = approvalBlockReason(item);
                  const summaryProduct = summaryProductByItemId.get(item.id);
                  const inventoryIncrement = item.review_status === "approved" && item.apply_inventory && !blockReason ? item.stock_increment || 0 : 0;
                  const expectedStock = summaryProduct ? summaryProduct.final_stock : item.base_stock === null ? null : item.base_stock + inventoryIncrement;
                  const priceCanApply = Boolean(item.matched_product_code) && item.unit_price !== null && item.unit_price >= 0;
                  const expectedPrice = summaryProduct ? summaryProduct.final_purchase_price : item.review_status === "approved" && item.apply_purchase_price && priceCanApply ? item.unit_price : item.base_purchase_price;
                  const saveState = saveStates[item.id];
                  return (
                    <Fragment key={item.id}>
                      <tr id={`review-item-${item.id}`} className={item.review_status === "pending" ? "review-item-row--pending" : ""}>
                        <th scope="row">
                          <span className="row-kind">{item.is_manual ? "수기" : `OCR ${item.source_row_order + 1}`}</span>
                          <span className={`review-status-badge review-status-badge--${item.review_status}`}>{reviewStatusLabels[item.review_status]}</span>
                          {item.raw_row_text ? <small className="raw-row-text" title={item.raw_row_text}>{item.raw_row_text}</small> : null}
                          {item.extraction_warnings.length > 0 ? <ul className="extraction-warning-list" aria-label={`${rowLabel} 추출 경고`}>{item.extraction_warnings.map((warning, index) => <li key={`${warning}-${index}`} title={warning}>{warning}</li>)}</ul> : null}
                        </th>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 상품코드 또는 바코드`} disabled={mutationLocked} value={item.product_code_or_barcode ?? ""} onChange={(event) => updateLocalItem(item.id, "product_code_or_barcode", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { product_code_or_barcode: item.product_code_or_barcode })} /><small>OCR 원문: {displayOriginal(item.ocr_product_code_or_barcode)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 상품명`} disabled={mutationLocked} value={item.product_name ?? ""} onChange={(event) => updateLocalItem(item.id, "product_name", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { product_name: item.product_name })} /><small>OCR 원문: {displayOriginal(item.ocr_product_name)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 규격`} disabled={mutationLocked} value={item.specification ?? ""} onChange={(event) => updateLocalItem(item.id, "specification", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { specification: item.specification })} /><small>OCR 원문: {displayOriginal(item.ocr_specification)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 수량`} type="number" min="0" disabled={mutationLocked} value={item.quantity ?? ""} onChange={(event) => updateLocalItem(item.id, "quantity", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { quantity: item.quantity })} /><small>OCR 원문: {displayOriginal(item.ocr_quantity)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 단가`} type="number" min="0" disabled={mutationLocked} value={item.unit_price ?? ""} onChange={(event) => updateLocalItem(item.id, "unit_price", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { unit_price: item.unit_price })} /><small>OCR 원문: {displayOriginal(item.ocr_unit_price)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 금액`} type="number" min="0" disabled={mutationLocked} value={item.amount ?? ""} onChange={(event) => updateLocalItem(item.id, "amount", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { amount: item.amount })} /><small>OCR 원문: {displayOriginal(item.ocr_amount)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 묶음 또는 세트`} disabled={mutationLocked} value={item.bundle_or_set_text ?? ""} onChange={(event) => updateLocalItem(item.id, "bundle_or_set_text", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { bundle_or_set_text: item.bundle_or_set_text })} /><small>OCR 원문: {displayOriginal(item.ocr_bundle_or_set_text)}</small></label></td>
                        <td><label className="review-field"><input aria-label={`${rowLabel} 재고 증가`} type="number" min="0" step="1" disabled={mutationLocked} value={item.stock_increment ?? ""} onChange={(event) => updateLocalItem(item.id, "stock_increment", numberFromInput(event))} onBlur={() => void saveItemChanges(item, { stock_increment: item.stock_increment })} /><small>현재 입력값</small></label></td>
                      </tr>
                      <tr className="match-detail-row">
                        <td colSpan={9}>
                          <div className="item-review-panel">
                            <div className="item-review-fields">
                              <label>검수 상태
                                <select aria-label={`${rowLabel} 검수 상태`} value={item.review_status} disabled={mutationLocked} onChange={(event) => void changeReviewStatus(item, event.currentTarget.value as ReviewStatus)}>
                                  <option value="pending">보류</option>
                                  <option value="approved" disabled={Boolean(blockReason)}>승인</option>
                                  <option value="excluded">제외</option>
                                </select>
                              </label>
                              <label className="apply-field"><input aria-label={`${rowLabel} 재고 반영`} type="checkbox" checked={item.apply_inventory} disabled={mutationLocked} onChange={(event) => void saveItemChanges(item, { apply_inventory: event.currentTarget.checked })} /><span>재고 반영</span></label>
                              <label className="apply-field"><input aria-label={`${rowLabel} 매입단가 반영`} type="checkbox" checked={item.apply_purchase_price} disabled={mutationLocked || !priceCanApply} onChange={(event) => void saveItemChanges(item, { apply_purchase_price: event.currentTarget.checked })} /><span>매입단가 반영</span></label>
                              <label>제외 사유<input aria-label={`${rowLabel} 제외 사유`} disabled={mutationLocked} value={item.exclusion_reason ?? ""} onChange={(event) => updateLocalItem(item.id, "exclusion_reason", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { exclusion_reason: item.exclusion_reason?.trim() || null })} /></label>
                              <label>메모<textarea aria-label={`${rowLabel} 메모`} disabled={mutationLocked} value={item.notes ?? ""} onChange={(event) => updateLocalItem(item.id, "notes", event.currentTarget.value || null)} onBlur={() => void saveItemChanges(item, { notes: item.notes?.trim() || null })} /></label>
                            </div>
                            {blockReason ? <p className="approval-block-reason">승인 불가: {blockReason}</p> : null}
                            <dl className="review-calculation" aria-label={`${rowLabel} 반영 예상값`}>
                              <div><dt>기준 재고</dt><dd>{formatNumber(item.base_stock)}</dd></div>
                              <div><dt>재고 증가</dt><dd>+{formatNumber(inventoryIncrement)}</dd></div>
                              <div><dt>예상 재고</dt><dd>{formatNumber(expectedStock)}</dd></div>
                              <div><dt>기존 매입단가</dt><dd>{formatCurrency(item.base_purchase_price)}</dd></div>
                              <div><dt>사진 단가</dt><dd>{formatCurrency(item.unit_price)}</dd></div>
                              <div><dt>예상 매입단가</dt><dd>{formatCurrency(expectedPrice)}</dd></div>
                            </dl>
                            {saveState ? <p className={`row-save-state ${saveState.phase === "error" ? "row-save-state--error" : ""}`} role={saveState.phase === "error" ? "alert" : "status"} aria-label={saveState.phase === "error" ? `${rowLabel} 저장 오류` : undefined}>{saveState.message}</p> : null}
                          </div>
                          <MatchPanel item={item} jobId={jobId} readOnly={mutationLocked} onReplace={replaceMatchedItem} />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                {detail && detail.items.length > 0 && filteredItems.length === 0 ? <tr><td colSpan={9}><div className="table-empty"><strong>필터 결과가 없습니다</strong><span>필터 조건을 바꿔 주세요.</span></div></td></tr> : null}
                {detail && detail.items.length === 0 ? <tr><td colSpan={9}><div className="table-empty"><strong>추출된 품목이 없습니다</strong><span>누락 행 추가로 직접 입력할 수 있습니다.</span></div></td></tr> : null}
                {!detail ? <tr><td colSpan={9}><div className="table-empty"><strong>검수할 품목이 없습니다</strong><span>문서를 선택하면 품목별 OCR 원문과 현재 값이 표시됩니다.</span></div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div> : null}

      {photoViewerOpen && photoViewerDocument ? (
        <div className="document-photo-modal" role="dialog" aria-modal="true" aria-labelledby="document-photo-heading" onMouseDown={(event) => {
          if (event.currentTarget === event.target) {
            setPhotoViewerOpen(false);
            setPhotoViewerDocumentId("");
            setPhotoRotation(0);
          }
        }}>
          <div className="document-photo-modal__content">
            <div className="document-photo-modal__header">
              <div><h2 id="document-photo-heading">원본 사진</h2><p>사진을 클릭하면 시계 방향으로 90도 회전합니다. 현재 {photoRotation}도</p></div>
              <button className="button button--ghost button--small" type="button" onClick={() => { setPhotoViewerOpen(false); setPhotoViewerDocumentId(""); setPhotoRotation(0); }}>닫기</button>
            </div>
            <div className="document-photo-modal__viewport">
              <button type="button" aria-label="원본 사진 시계 방향으로 90도 회전" onClick={() => setPhotoRotation((current) => (current + 90) % 360)}>
                <img className="document-photo-modal__image" style={{ transform: `rotate(${photoRotation}deg)` }} src={getDocumentImageUrl(photoViewerDocument.id, "original")} alt={`${photoViewerDocument.original_image_name} 원본`} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
