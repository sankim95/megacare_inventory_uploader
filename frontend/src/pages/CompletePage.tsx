import { useEffect, useRef, useState } from "react";
import { cloneJob, getJob, getJobResultUrl, getReviewSummary } from "../api/client";
import { AppLink } from "../components/AppLink";
import { PageHeader } from "../components/PageHeader";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { JobRead, ReviewSummary } from "../types";

interface CompletePageProps {
  jobId: string;
}

function fileName(path: string | null) {
  if (!path) return "정보 없음";
  return path.split(/[\\/]/).pop() || path;
}

function completedAt(value: string | null) {
  if (!value) return "정보 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function CompletePage({ jobId }: CompletePageProps) {
  const [job, setJob] = useState<JobRead | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [phase, setPhase] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [clonePhase, setClonePhase] = useState<"idle" | "loading" | "error">("idle");
  const [cloneMessage, setCloneMessage] = useState("");
  const cloneRequestInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setPhase("loading");
    setMessage("");
    Promise.all([getJob(jobId), getReviewSummary(jobId)])
      .then(([jobResult, summaryResult]) => {
        if (!active) return;
        setJob(jobResult);
        setSummary(summaryResult);
        setPhase("success");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setPhase("error");
        setMessage(reason instanceof Error ? reason.message : "완료 정보를 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, [jobId]);

  const completed = phase === "success" && job?.status === "completed";
  const counts = summary?.counts;
  const headerCopy = completed
    ? {
        eyebrow: "작업 완료",
        title: "입고 반영이 완료되었습니다",
        description: "승인한 항목만 새 Excel에 반영했으며 원본 파일은 그대로 보존했습니다.",
      }
    : phase === "error"
      ? {
          eyebrow: "결과 확인 오류",
          title: "완료 결과를 확인할 수 없습니다",
          description: "작업 상태를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
        }
      : phase === "success"
        ? {
            eyebrow: "결과 준비 전",
            title: "결과 파일이 아직 준비되지 않았습니다",
            description: "현재 작업은 완료 전이며 결과 Excel을 생성한 뒤 다운로드할 수 있습니다.",
          }
        : {
            eyebrow: "결과 확인",
            title: "결과 파일을 확인하고 있습니다",
            description: "작업 완료 여부와 결과 파일 정보를 불러오는 중입니다.",
          };

  async function createClone() {
    if (!completed || cloneRequestInFlight.current) return;
    cloneRequestInFlight.current = true;
    setClonePhase("loading");
    setCloneMessage("새 작업을 복제하고 있습니다.");
    try {
      const clonedJob = await cloneJob(jobId);
      window.history.pushState({}, "", `/jobs/${clonedJob.id}/upload`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (reason) {
      cloneRequestInFlight.current = false;
      setClonePhase("error");
      setCloneMessage(reason instanceof Error ? reason.message : "작업을 복제하지 못했습니다.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={headerCopy.eyebrow}
        title={headerCopy.title}
        description={headerCopy.description}
      />
      <WorkflowSteps current={4} />

      {phase === "loading" ? <div className="inline-state" role="status"><span className="spinner" aria-hidden="true" />완료 정보를 불러오는 중입니다.</div> : null}
      {phase === "error" ? <div className="inline-state inline-state--error" role="alert"><strong>완료 정보를 불러오지 못했습니다.</strong><span>{message} 작업 목록에서 상태를 확인한 뒤 다시 시도해 주세요.</span></div> : null}
      {phase === "success" && !completed ? <div className="inline-state" role="status"><strong>이 작업은 아직 완료되지 않았습니다.</strong><span>검수 화면에서 차단 사유를 해결하고 결과 Excel을 생성해 주세요.</span></div> : null}

      <section className="panel completion-card" aria-labelledby="result-heading">
        <div className={completed ? "success-mark" : "success-mark success-mark--inactive"} aria-hidden="true">{completed ? "✓" : "…"}</div>
        <div className="completion-copy">
          <h2 id="result-heading">{completed ? "결과 파일 준비 완료" : "결과 파일 대기 중"}</h2>
          <p>{completed ? "처리 결과와 변경 이력은 완료 작업에서 다시 확인할 수 있습니다." : "완료 상태가 확인되면 결과 파일을 다운로드할 수 있습니다."}</p>
        </div>
        {completed && job?.result_path ? <a className="button button--primary" href={getJobResultUrl(jobId)} download>결과 Excel 다운로드</a> : <button className="button button--primary" type="button" disabled>결과 Excel 다운로드</button>}
      </section>

      <section className="result-grid" aria-label="변경 요약">
        <article className="panel"><span>승인 품목</span><strong>{counts?.approved_items ?? 0}개</strong><small>재고·단가 반영 검수 완료</small></article>
        <article className="panel"><span>재고 변경 상품</span><strong>{counts?.inventory_products ?? 0}개</strong><small>상품코드별 합산</small></article>
        <article className="panel"><span>단가 변경 상품</span><strong>{counts?.price_products ?? 0}개</strong><small>대표 단가 기준</small></article>
        <article className="panel"><span>제외 품목</span><strong>{counts?.excluded_items ?? 0}개</strong><small>제외 이력 별도 기록</small></article>
      </section>

      <section className="panel audit-info" aria-labelledby="audit-heading">
        <h2 id="audit-heading">처리 정보</h2>
        <dl>
          <div><dt>승인자</dt><dd>{job?.approved_by || "정보 없음"}</dd></div>
          <div><dt>처리 시각</dt><dd>{completedAt(job?.completed_at || null)}</dd></div>
          <div><dt>원본 파일</dt><dd>{job?.original_excel_name || "정보 없음"}</dd></div>
          <div><dt>결과 파일</dt><dd>{fileName(job?.result_path || null)}</dd></div>
        </dl>
      </section>

      {cloneMessage ? <p className={`next-step-notice ${clonePhase === "error" ? "next-step-notice--error" : ""}`} role={clonePhase === "error" ? "alert" : "status"}>{cloneMessage}</p> : null}
      <div className="footer-actions"><AppLink className="button button--ghost" to="/">작업 목록으로</AppLink><button className="button button--secondary" type="button" disabled={!completed || clonePhase === "loading"} onClick={() => void createClone()}>{clonePhase === "loading" ? "복제 중" : "이 작업 복제"}</button></div>
    </>
  );
}
