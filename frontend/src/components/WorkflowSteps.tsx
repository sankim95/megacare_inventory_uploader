const steps = ["파일 업로드", "AI 추출", "검수·승인", "Excel 생성"];

export function WorkflowSteps({ current }: { current: number }) {
  return (
    <ol className="workflow-steps" aria-label="작업 진행 단계">
      {steps.map((step, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "current" : "upcoming";
        return (
          <li key={step} className={`workflow-step workflow-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span>{state === "done" ? "✓" : number}</span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}
