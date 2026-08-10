import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createJob, deleteDocument, extractDocument, extractDocuments, getDocuments, getJob, uploadDocuments, uploadJobExcel } from "../api/client";
import { AppLink } from "../components/AppLink";
import { PageHeader } from "../components/PageHeader";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { DocumentRead, DocumentStatus, JobStatus } from "../types";

interface UploadPageProps {
  jobId?: string;
}

interface LocalPhoto {
  id: number;
  file: File;
}

type ExcelPhase = "idle" | "uploading" | "success" | "error";
type JobPhase = "loading" | "ready" | "error";
type AsyncPhase = "idle" | "loading" | "success" | "error";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const documentStatusLabels: Record<DocumentStatus, string> = {
  pending: "추출 대기",
  processing: "추출 중",
  completed: "추출 완료",
  failed: "추출 실패",
};

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPage({ jobId }: UploadPageProps) {
  const [currentJobId, setCurrentJobId] = useState(jobId || "");
  const [jobPhase, setJobPhase] = useState<JobPhase>(jobId ? "loading" : "ready");
  const [jobError, setJobError] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [excelAttemptFile, setExcelAttemptFile] = useState<File | null>(null);
  const [confirmedExcelName, setConfirmedExcelName] = useState("");
  const [excelPhase, setExcelPhase] = useState<ExcelPhase>("idle");
  const [excelMessage, setExcelMessage] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [documents, setDocuments] = useState<DocumentRead[]>([]);
  const [documentListError, setDocumentListError] = useState("");
  const [photoUploadPhase, setPhotoUploadPhase] = useState<AsyncPhase>("idle");
  const [photoUploadMessage, setPhotoUploadMessage] = useState("");
  const [extractionPhase, setExtractionPhase] = useState<AsyncPhase>("idle");
  const [extractionMessage, setExtractionMessage] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [documentActionPhase, setDocumentActionPhase] = useState<AsyncPhase>("idle");
  const [documentActionMessage, setDocumentActionMessage] = useState("");
  const [draftSavePhase, setDraftSavePhase] = useState<AsyncPhase>("idle");
  const [draftSaveMessage, setDraftSaveMessage] = useState("");
  const photoId = useRef(0);
  const draftSaveInFlight = useRef(false);
  const completed = jobStatus === "completed";
  const exportLocked = jobStatus === "exporting";
  const mutationLocked = completed || exportLocked;
  const draftSaving = draftSavePhase === "loading";
  const fileMutationLocked = mutationLocked || draftSaving;

  const prepareJob = useCallback(async () => {
    if (!jobId) {
      setJobPhase("ready");
      return;
    }

    setJobPhase("loading");
    setJobError("");

    try {
      const job = await getJob(jobId);
      setCurrentJobId(job.id);
      setJobStatus(job.status);
      setConfirmedExcelName(job.original_excel_name || "");
      setExcelPhase(job.original_excel_name ? "success" : "idle");
      if (job.original_excel_name) setExcelMessage("검증을 통과한 Excel이 저장되어 있습니다.");
      setJobPhase("ready");

      try {
        setDocuments((await getDocuments(job.id)).sort((a, b) => a.source_order - b.source_order));
        setDocumentListError("");
      } catch (reason) {
        setDocumentListError(reason instanceof Error ? reason.message : "업로드된 문서를 불러오지 못했습니다.");
      }
    } catch (reason) {
      setJobError(reason instanceof Error ? reason.message : "작업을 준비하지 못했습니다.");
      setJobPhase("error");
    }
  }, [jobId]);

  useEffect(() => {
    void prepareJob();
  }, [prepareJob]);

  async function selectExcel(file: File | undefined) {
    if (!file || jobPhase !== "ready" || fileMutationLocked) return;

    setExcelAttemptFile(file);
    setExtractionMessage("");
    setDraftSaveMessage("");

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setExcelPhase("error");
      setExcelMessage("상품리스트는 .xlsx 파일만 선택할 수 있습니다.");
      return;
    }

    if (!currentJobId) {
      setExcelPhase("idle");
      setExcelMessage("파일을 선택했습니다. 임시저장 전에는 작업 목록에 등록되지 않습니다.");
      return;
    }

    setExcelPhase("uploading");
    setExcelMessage("Excel 구조와 필수 열을 확인하고 있습니다.");

    try {
      const job = await uploadJobExcel(currentJobId, file);
      if (!job.original_excel_name) throw new Error("서버가 저장된 Excel 정보를 반환하지 않았습니다.");
      setConfirmedExcelName(job.original_excel_name);
      setExcelPhase("success");
      setExcelMessage("Excel 검증이 완료되어 원본을 안전하게 저장했습니다.");
    } catch (reason) {
      setExcelPhase("error");
      const message = reason instanceof Error ? reason.message : "Excel 검증에 실패했습니다.";
      setExcelMessage(confirmedExcelName ? `${message} 기존 확정 Excel은 그대로 유지됩니다.` : message);
    }
  }

  function handleExcelChange(event: ChangeEvent<HTMLInputElement>) {
    void selectExcel(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleExcelDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!fileMutationLocked && excelPhase !== "uploading") void selectExcel(event.dataTransfer.files[0]);
  }

  function addPhotos(files: FileList | File[]) {
    if (fileMutationLocked || jobPhase !== "ready") return;
    const selected = Array.from(files);
    const accepted = selected.filter((file) => imageTypes.has(file.type));
    setPhotoError(accepted.length === selected.length ? "" : "PNG, JPG, JPEG, WEBP 사진만 추가할 수 있습니다.");
    setPhotos((current) => [
      ...current,
      ...accepted.map((file) => ({ id: ++photoId.current, file })),
    ]);
    setExtractionMessage("");
    setDraftSaveMessage("");
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addPhotos(event.target.files);
    event.target.value = "";
  }

  function handlePhotoDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!fileMutationLocked) addPhotos(event.dataTransfer.files);
  }

  function movePhoto(index: number, offset: -1 | 1) {
    if (fileMutationLocked) return;
    setPhotos((current) => {
      const reordered = [...current];
      [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
      return reordered;
    });
  }

  async function uploadSelectedPhotos() {
    if (fileMutationLocked || !currentJobId || photos.length === 0 || photoUploadPhase === "loading") return;
    setPhotoUploadPhase("loading");
    setPhotoUploadMessage(`${photos.length}장 사진을 원본 순서대로 업로드하고 있습니다.`);

    try {
      const uploaded = await uploadDocuments(currentJobId, photos.map((photo) => photo.file));
      setDocuments((current) => {
        const uploadedIds = new Set(uploaded.map((document) => document.id));
        return [...current.filter((document) => !uploadedIds.has(document.id)), ...uploaded].sort((a, b) => a.source_order - b.source_order);
      });
      setPhotos([]);
      setPhotoUploadPhase("success");
      setPhotoUploadMessage(`${uploaded.length}장 사진 업로드가 완료되었습니다.`);
    } catch (reason) {
      setPhotoUploadPhase("error");
      setPhotoUploadMessage(reason instanceof Error ? reason.message : "사진 업로드에 실패했습니다.");
    }
  }

  async function saveDraft() {
    if (currentJobId || draftSaveInFlight.current || jobPhase !== "ready" || (!excelAttemptFile && photos.length === 0)) return;

    draftSaveInFlight.current = true;
    setDraftSavePhase("loading");
    setDraftSaveMessage("선택한 파일을 임시저장하고 있습니다.");
    let createdJobId = "";

    try {
      const created = await createJob();
      createdJobId = created.id;
      setCurrentJobId(created.id);
      setJobStatus(created.status);
      window.history.replaceState({}, "", `/jobs/${created.id}/upload`);

      if (excelAttemptFile) {
        setExcelPhase("uploading");
        setExcelMessage("Excel 구조와 필수 열을 확인하고 있습니다.");
        try {
          const updated = await uploadJobExcel(created.id, excelAttemptFile);
          if (!updated.original_excel_name) throw new Error("서버가 저장된 Excel 정보를 반환하지 않았습니다.");
          setConfirmedExcelName(updated.original_excel_name);
          setExcelPhase("success");
          setExcelMessage("Excel 검증이 완료되어 원본을 안전하게 저장했습니다.");
        } catch (reason) {
          setExcelPhase("error");
          setExcelMessage(reason instanceof Error ? reason.message : "Excel 검증에 실패했습니다.");
          throw reason;
        }
      }

      if (photos.length > 0) {
        setPhotoUploadPhase("loading");
        setPhotoUploadMessage(`${photos.length}장 사진을 원본 순서대로 업로드하고 있습니다.`);
        try {
          const uploaded = await uploadDocuments(created.id, photos.map((photo) => photo.file));
          setDocuments(uploaded.sort((a, b) => a.source_order - b.source_order));
          setPhotos([]);
          setPhotoUploadPhase("success");
          setPhotoUploadMessage(`${uploaded.length}장 사진 업로드가 완료되었습니다.`);
        } catch (reason) {
          setPhotoUploadPhase("error");
          setPhotoUploadMessage(reason instanceof Error ? reason.message : "사진 업로드에 실패했습니다.");
          throw reason;
        }
      }

      setDraftSavePhase("success");
      setDraftSaveMessage("임시저장이 완료되었습니다.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "임시저장에 실패했습니다.";
      setDraftSavePhase("error");
      setDraftSaveMessage(createdJobId ? `작업은 생성되었지만 일부 파일을 저장하지 못했습니다. ${message}` : message);
    } finally {
      draftSaveInFlight.current = false;
    }
  }

  function replaceDocument(updated: DocumentRead) {
    setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document).sort((a, b) => a.source_order - b.source_order));
  }

  async function retryDocument(document: DocumentRead) {
    if (fileMutationLocked) return;
    replaceDocument({ ...document, status: "processing", processing_error: null });
    try {
      replaceDocument(await extractDocument(document.id));
    } catch (reason) {
      replaceDocument({ ...document, status: "failed", processing_error: reason instanceof Error ? reason.message : "재시도에 실패했습니다." });
    }
  }

  async function startExtraction() {
    if (fileMutationLocked || !currentJobId) return;
    setExtractionPhase("loading");
    setExtractionMessage("문서별 이미지 보정과 AI 추출을 진행하고 있습니다.");
    setDocuments((current) => current.map((document) => ({ ...document, status: "processing" })));

    try {
      const extracted = await extractDocuments(currentJobId);
      setDocuments(extracted.sort((a, b) => a.source_order - b.source_order));
      const failedCount = extracted.filter((document) => document.status === "failed").length;
      setExtractionPhase("success");
      setExtractionMessage(failedCount ? `${failedCount}개 문서가 실패했습니다. 해당 문서만 다시 시도해 주세요.` : "모든 문서의 추출이 완료되었습니다. 검토 화면에서 원문과 추출값을 확인해 주세요.");
    } catch (reason) {
      setExtractionPhase("error");
      setExtractionMessage(reason instanceof Error ? reason.message : "문서 추출을 시작하지 못했습니다.");
      try {
        setDocuments((await getDocuments(currentJobId)).sort((a, b) => a.source_order - b.source_order));
      } catch {
        // 기존 화면 상태를 유지하고 시작 오류를 우선 표시합니다.
      }
    }
  }

  async function removeUploadedDocument(document: DocumentRead) {
    if (fileMutationLocked || deletingDocumentId) return;
    setDeletingDocumentId(document.id);
    setDocumentActionPhase("loading");
    setDocumentActionMessage(`${document.original_image_name} 문서를 삭제하고 있습니다.`);
    try {
      await deleteDocument(document.id);
      setDocuments((await getDocuments(currentJobId)).sort((a, b) => a.source_order - b.source_order));
      setDeleteConfirmationId("");
      setExtractionPhase("idle");
      setExtractionMessage("");
      setDocumentActionPhase("success");
      setDocumentActionMessage(`${document.original_image_name} 문서를 삭제했습니다.`);
    } catch (reason) {
      setDocumentActionPhase("error");
      setDocumentActionMessage(reason instanceof Error ? reason.message : "문서를 삭제하지 못했습니다.");
    } finally {
      setDeletingDocumentId("");
    }
  }

  const documentActionsLocked = fileMutationLocked || extractionPhase === "loading" || Boolean(deletingDocumentId);
  const canStartExtraction = !fileMutationLocked && !deletingDocumentId && Boolean(confirmedExcelName) && documents.length > 0 && photoUploadPhase !== "loading" && extractionPhase !== "loading";
  const hasDraftSelection = Boolean(excelAttemptFile) || photos.length > 0;
  const hasInvalidDraftExcel = Boolean(excelAttemptFile && !excelAttemptFile.name.toLowerCase().endsWith(".xlsx"));
  const canSaveDraft = !currentJobId && jobPhase === "ready" && hasDraftSelection && !hasInvalidDraftExcel && !draftSaving;
  const hasCompletedDocument = documents.some((document) => document.status === "completed");

  return (
    <>
      <PageHeader
        eyebrow={currentJobId ? `작업 ${currentJobId}` : "새 작업"}
        title="파일 업로드"
        description="기준 상품리스트 한 개와 거래명세서 사진을 추가해 주세요. 원본은 변경하지 않습니다."
        actions={completed ? <span className="read-only-badge">완료된 작업 · 읽기 전용</span> : exportLocked ? <span className="read-only-badge">내보내기 중 · 편집 잠금</span> : null}
      />
      <WorkflowSteps current={1} />

      {jobPhase === "loading" ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" />작업을 불러오는 중입니다.</div> : null}
      {jobPhase === "error" ? <div className="inline-state inline-state--error" role="alert"><span>{jobError}</span><button className="button button--ghost button--small" type="button" onClick={() => void prepareJob()}>다시 시도</button></div> : null}
      {completed ? <div className="inline-state" role="status">완료된 작업이므로 업로드 및 추출 내용을 변경할 수 없습니다.</div> : null}
      {exportLocked ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" />결과 Excel을 생성하는 동안 업로드·삭제·추출 변경을 사용할 수 없습니다.</div> : null}

      <div className="upload-grid">
        <section className="panel upload-card" aria-labelledby="excel-heading" aria-busy={excelPhase === "uploading" || draftSaving}>
          <div className="number-badge">1</div>
          <div>
            <h2 id="excel-heading">상품리스트 Excel</h2>
            <p>`.xlsx` 파일 1개 · 필수 열 이름을 기준으로 확인합니다.</p>
          </div>
          <label className={`drop-zone ${fileMutationLocked || excelPhase === "uploading" ? "drop-zone--disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleExcelDrop}>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={fileMutationLocked || jobPhase !== "ready" || excelPhase === "uploading"} onChange={handleExcelChange} />
            <strong>{excelPhase === "uploading" ? "Excel 검증 중" : "Excel 파일 선택"}</strong>
            <span>또는 이 영역으로 파일을 끌어오세요</span>
          </label>
          {confirmedExcelName ? <div className="selected-file selected-file--confirmed"><span className="file-icon" aria-hidden="true">X</span><div><span className="file-state-label">확정 Excel</span><strong>{confirmedExcelName}</strong><small>{excelPhase === "success" && excelAttemptFile ? formatFileSize(excelAttemptFile.size) : "서버 검증 완료"}</small></div></div> : null}
          {excelAttemptFile && excelPhase !== "success" ? <div className="selected-file selected-file--attempt"><span className="file-icon file-icon--attempt" aria-hidden="true">?</span><div><span className="file-state-label">{currentJobId ? "이번 검증 시도" : "임시저장 예정"}</span><strong>{excelAttemptFile.name}</strong><small>{formatFileSize(excelAttemptFile.size)}</small></div></div> : null}
          {excelMessage ? <p className={`upload-message upload-message--${excelPhase}`} role={excelPhase === "error" ? "alert" : "status"}>{excelMessage}</p> : null}
          <p className="helper-text">필수 열: 상품코드, 상품명, 규격, 현재고, 매입단가, 공급사코드, 공급사</p>
        </section>

        <section className="panel upload-card" aria-labelledby="photo-heading">
          <div className="number-badge">2</div>
          <div>
            <h2 id="photo-heading">거래명세서 사진</h2>
            <p>PNG, JPG, JPEG, WEBP · 여러 장을 한 번에 선택할 수 있습니다.</p>
          </div>
          <label className={`drop-zone ${fileMutationLocked ? "drop-zone--disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handlePhotoDrop}>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={fileMutationLocked || jobPhase !== "ready"} onChange={handlePhotoChange} />
            <strong>사진 파일 선택</strong>
            <span>문서 한 장이 사진 한 장에 선명하게 보이는 파일을 권장합니다</span>
          </label>
          {photoError ? <p className="upload-message upload-message--error" role="alert">{photoError}</p> : null}
          {photos.length > 0 ? (
            <ol className="photo-list" aria-label="선택한 거래명세서 사진">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  <span className="photo-order">{index + 1}</span>
                  <div><strong>{photo.file.name}</strong><small>{formatFileSize(photo.file.size)}</small></div>
                  <div className="photo-actions">
                    <button type="button" aria-label={`${photo.file.name} 위로 이동`} disabled={fileMutationLocked || index === 0} onClick={() => movePhoto(index, -1)}>↑</button>
                    <button type="button" aria-label={`${photo.file.name} 아래로 이동`} disabled={fileMutationLocked || index === photos.length - 1} onClick={() => movePhoto(index, 1)}>↓</button>
                    <button type="button" aria-label={`${photo.file.name} 제거`} disabled={fileMutationLocked} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}>제거</button>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="helper-text">추가로 선택한 사진이 없습니다.</p>}
          {currentJobId ? <button className="button button--secondary photo-upload-button" type="button" disabled={fileMutationLocked || photos.length === 0 || jobPhase !== "ready" || photoUploadPhase === "loading"} onClick={() => void uploadSelectedPhotos()}>{photoUploadPhase === "loading" ? "사진 업로드 중" : `선택한 사진 ${photos.length}장 업로드`}</button> : <p className="helper-text">선택한 사진은 아래 임시저장 버튼을 누를 때 저장됩니다.</p>}
          {photoUploadMessage ? <p className={`upload-message upload-message--${photoUploadPhase === "loading" ? "uploading" : photoUploadPhase}`} role={photoUploadPhase === "error" ? "alert" : "status"}>{photoUploadMessage}</p> : null}
        </section>
      </div>

      <section className="panel document-panel" aria-labelledby="documents-heading">
        <div className="panel-heading"><div><h2 id="documents-heading">업로드된 문서</h2><p>각 사진은 독립적으로 보정·추출되며 실패한 문서만 다시 시도할 수 있습니다.</p></div><span className="count-badge">{documents.length}장</span></div>
        {documentListError ? <div className="document-list-message" role="alert">{documentListError}</div> : null}
        {documents.length === 0 ? <div className="document-list-message">{currentJobId ? "서버에 업로드된 사진이 없습니다." : "아직 임시저장된 사진이 없습니다."}</div> : (
          <ol className="server-document-list">
            {documents.map((document) => (
              <li key={document.id}>
                <span className="photo-order">{document.source_order + 1}</span>
                <div className="document-name"><strong>{document.original_image_name}</strong><small>{document.correction_applied ? "이미지 보정 적용" : "원본 이미지 사용"}</small></div>
                <div className="document-feedback">
                  <span className={`document-status document-status--${document.status}`}>{documentStatusLabels[document.status]}</span>
                  {document.correction_warning ? <small className="warning-message">보정 주의: {document.correction_warning}</small> : null}
                  {document.processing_error ? <small className="failure-message">{document.processing_error}</small> : null}
                  {document.duplicate_status === "confirmed" ? <small className="warning-message">확정 중복 · 삭제하여 해소</small> : null}
                </div>
                <div className="document-actions">
                  {document.status === "failed" ? <button className="button button--ghost button--small" type="button" aria-label={`${document.original_image_name} 이 문서 재시도`} disabled={documentActionsLocked} onClick={() => void retryDocument(document)}>이 문서 재시도</button> : null}
                  {deleteConfirmationId === document.id ? <div className="delete-confirmation" role="status"><span>이 문서를 삭제할까요?</span><button className="button button--secondary button--small" type="button" aria-label={`${document.original_image_name} 삭제 확인`} disabled={documentActionsLocked} onClick={() => void removeUploadedDocument(document)}>{deletingDocumentId === document.id ? "삭제 중" : "삭제 확인"}</button><button className="button button--ghost button--small" type="button" aria-label={`${document.original_image_name} 삭제 취소`} disabled={Boolean(deletingDocumentId)} onClick={() => setDeleteConfirmationId("")}>취소</button></div> : <button className="button button--ghost button--small" type="button" aria-label={`${document.original_image_name} 삭제`} disabled={documentActionsLocked} onClick={() => { setDeleteConfirmationId(document.id); setDocumentActionMessage(""); }}>삭제</button>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {documentActionMessage ? <p className={`upload-message upload-message--${documentActionPhase === "loading" ? "uploading" : documentActionPhase}`} role={documentActionPhase === "error" ? "alert" : "status"}>{documentActionMessage}</p> : null}
      </section>

      <aside className="notice" aria-label="개인정보 처리 안내">
        <strong>로컬 처리 안내</strong>
        <span>{currentJobId ? "파일과 작업 이력은 이 컴퓨터에 저장됩니다." : "임시저장을 누르면 파일과 작업 이력이 이 컴퓨터에 저장됩니다."} AI 추출 시 선택한 사진 한 장만 전송됩니다.</span>
      </aside>

      {draftSaveMessage ? <p className={`next-step-notice ${draftSavePhase === "error" ? "next-step-notice--error" : ""}`} role={draftSavePhase === "error" && !currentJobId ? "alert" : "status"}>{draftSaveMessage}</p> : null}
      {extractionMessage ? <p className={`next-step-notice ${extractionPhase === "error" ? "next-step-notice--error" : ""}`} role={extractionPhase === "error" ? "alert" : "status"}>{extractionMessage}</p> : null}
      <div className="footer-actions">
        <AppLink className="button button--ghost" to="/">취소</AppLink>
        {!currentJobId || draftSaving ? <button className="button button--secondary" type="button" disabled={!canSaveDraft} onClick={() => void saveDraft()}>{draftSaving ? "임시저장 중" : "임시저장"}</button> : null}
        {hasCompletedDocument ? <AppLink className="button button--secondary" to={`/jobs/${currentJobId}/review`}>검토 화면으로</AppLink> : null}
        <button className="button button--primary" type="button" disabled={!canStartExtraction} onClick={() => void startExtraction()}>{extractionPhase === "loading" ? "OCR 추출 중" : "OCR 추출 시작"}</button>
      </div>
    </>
  );
}
