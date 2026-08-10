import { useCallback, useEffect, useState } from "react";
import { deleteJob, getJobs } from "../api/client";
import { AppLink } from "../components/AppLink";
import { PageHeader } from "../components/PageHeader";
import type { JobRead, JobStatus } from "../types";

const statusLabels: Record<JobStatus, string> = {
  draft: "초안",
  extracting: "추출 중",
  reviewing: "검수 중",
  exporting: "내보내기 중",
  completed: "완료",
  failed: "실패",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function jobDestination(job: JobRead) {
  if (job.status === "completed") return `/jobs/${job.id}/complete`;
  if (job.status === "reviewing" || job.status === "exporting") return `/jobs/${job.id}/review`;
  return `/jobs/${job.id}/upload`;
}

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRead[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState("");
  const [deletingJobId, setDeletingJobId] = useState("");
  const [deleteError, setDeleteError] = useState<{ jobId: string; message: string } | null>(null);

  const loadJobs = useCallback(() => {
    setState("loading");
    setError("");
    getJobs()
      .then((result) => {
        setJobs(result);
        setState("ready");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "작업 목록을 불러오지 못했습니다.");
        setState("error");
      });
  }, []);

  useEffect(loadJobs, [loadJobs]);

  async function removeJob(job: JobRead) {
    setDeletingJobId(job.id);
    setDeleteError(null);
    try {
      await deleteJob(job.id);
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
      setDeleteConfirmationId("");
    } catch (reason: unknown) {
      setDeleteError({
        jobId: job.id,
        message: reason instanceof Error ? reason.message : "작업을 삭제하지 못했습니다.",
      });
    } finally {
      setDeletingJobId("");
    }
  }

  const activeCount = jobs.filter((job) => job.status !== "completed" && job.status !== "failed").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const completedCount = jobs.filter((job) => job.status === "completed").length;

  return (
    <>
      <PageHeader
        eyebrow="작업 관리"
        title="입고 반영 작업"
        description="미완료 작업을 이어서 검수하거나 완료된 Excel을 다시 내려받습니다."
        actions={<AppLink className="button button--primary" to="/jobs/new/upload">새 작업 시작</AppLink>}
      />

      <section className="summary-grid" aria-label="작업 요약">
        <article><span>진행 중</span><strong>{activeCount}</strong><small>검수가 필요한 작업</small></article>
        <article><span>처리 실패</span><strong>{failedCount}</strong><small>재시도가 필요한 작업</small></article>
        <article><span>완료</span><strong>{completedCount}</strong><small>결과를 내려받을 수 있는 작업</small></article>
      </section>

      <section className="panel jobs-panel" aria-labelledby="jobs-heading" aria-busy={state === "loading"}>
        <div className="panel-heading">
          <div>
            <h2 id="jobs-heading">최근 작업</h2>
            <p>임시저장한 작업 내용은 이후 이 컴퓨터에 자동 저장됩니다.</p>
          </div>
        </div>

        {state === "loading" ? (
          <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />작업 목록을 불러오는 중입니다.</div>
        ) : state === "error" ? (
          <div className="empty-state error-state" role="alert">
            <div className="empty-icon" aria-hidden="true">!</div>
            <h3>작업 목록을 불러오지 못했습니다</h3>
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={loadJobs}>다시 시도</button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">＋</div>
            <h3>아직 작업이 없습니다</h3>
            <p>상품리스트 Excel과 거래명세서 사진을 준비해 첫 작업을 시작하세요.</p>
            <AppLink className="button button--secondary" to="/jobs/new/upload">파일 선택하기</AppLink>
          </div>
        ) : (
          <div className="job-list-wrap">
            <table className="job-list">
              <thead><tr><th scope="col">작업</th><th scope="col">상태</th><th scope="col">최근 수정</th><th scope="col"><span className="sr-only">작업 열기 또는 삭제</span></th></tr></thead>
              <tbody>
                {jobs.map((job) => {
                  const jobName = job.original_excel_name || "Excel 미등록";
                  const deletionLocked = job.status === "extracting" || job.status === "exporting";
                  const confirming = deleteConfirmationId === job.id;
                  const deleting = deletingJobId === job.id;
                  return (
                    <tr key={job.id}>
                      <td><strong>{jobName}</strong><small>작업 ID {job.id}</small></td>
                      <td><span className={`status-chip status-chip--${job.status}`}>{statusLabels[job.status]}</span>{job.failure_message ? <small className="failure-message">{job.failure_message}</small> : null}</td>
                      <td>{formatDate(job.updated_at)}</td>
                      <td>
                        <div className="job-actions">
                          <AppLink className="button button--ghost button--small" to={jobDestination(job)}>{job.status === "completed" ? "결과 보기" : "이어하기"}</AppLink>
                          {confirming ? (
                            <div className="job-delete-confirmation" role="group" aria-label={`${jobName} 작업 삭제 확인`}>
                              <span>정말 삭제할까요?</span>
                              <button className="button button--danger button--small" type="button" aria-label={`${jobName} 작업 삭제 확인`} disabled={deleting} onClick={() => void removeJob(job)}>{deleting ? "삭제 중" : "삭제 확인"}</button>
                              <button className="button button--ghost button--small" type="button" aria-label={`${jobName} 작업 삭제 취소`} disabled={deleting} onClick={() => { setDeleteConfirmationId(""); setDeleteError(null); }}>취소</button>
                            </div>
                          ) : (
                            <button className="button button--danger button--small" type="button" aria-label={`${jobName} 작업 삭제`} title={deletionLocked ? "추출 또는 내보내기가 끝난 뒤 삭제할 수 있습니다." : undefined} disabled={deletionLocked || Boolean(deletingJobId)} onClick={() => { setDeleteConfirmationId(job.id); setDeleteError(null); }}>삭제</button>
                          )}
                        </div>
                        {deleteError?.jobId === job.id ? <small className="job-delete-error" role="alert">{deleteError.message}</small> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
