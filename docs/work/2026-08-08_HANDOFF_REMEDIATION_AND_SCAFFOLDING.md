# Work Record & Completion Report: Handoff 결함 수정과 운영 문서 Scaffolding

| 항목 | 값 |
|---|---|
| 상태 | Completed — 아래 증거 범위 |
| 작업일 | 2026-08-08 |
| 프로젝트 | `/Users/kimsangwoo/Desktop/workspace/inventory_uploader` |
| 작업 입력 | `handoff.md` §10, 사용자의 공통·프로젝트 목표 구조 |
| 현재 권위 | 결정은 `../03_DECISIONS.md`, 상태는 `../05_CURRENT_STATUS.md`, 남은 일은 `../06_BACKLOG.md` |
| Git | 이 프로젝트는 Git 저장소가 아니므로 commit·diff 없음 |

이 문서는 이번 작업의 계약, 변경 목록, 검증 결과를 함께 보존하는 완료 기록입니다. 현재 제품 정책이나 상태가 바뀌면 이 기록을 덮어쓰기보다 현재 권위 문서를 갱신합니다.

## 1. 작업 계약

### 목표

1. `handoff.md` §10의 P1 3건, P2 4건, P3 1건을 현재 제품 규칙에 맞게 수정하고 회귀 테스트로 고정합니다.
2. 워크스페이스 공통 운영 체계와 현재 프로젝트의 역할별 단일 권위를 만들고, 결정·증거·현재 상태·남은 작업을 문서화합니다.

### 범위

- 추출 소유권과 mutation 잠금, 중단 복구
- Excel 교체 정합성, 단가 기본값, 내보내기 전제, 숫자 검증
- API 시간 계약, 검수 행 자동 저장 순서
- ORM/Alembic metadata 정합성
- 워크스페이스 공통 규칙·운영 문서·레지스트리·템플릿
- 현재 프로젝트의 컨텍스트, 아키텍처, 결정, 수용 기준, 상태, 백로그

### 비범위와 중단 조건

- 실제 OpenAI API 호출과 비용 발생
- 제공 샘플로 전체 수동 사용자 흐름 실행
- 운영 `data/` 변경, 외부 배포, Git 저장소 초기화
- 다른 프로젝트의 제품 코드나 dirty worktree 변경
- 기존 Excel 소수점 매입단가 정책의 임의 확정

### 완료 기준

- 각 P1/P2/P3 재현이 회귀 테스트를 통과합니다.
- backend, frontend, production build, Chromium E2E가 모두 통과합니다.
- 빈 DB와 기존 DB가 Alembic head로 올라가고 schema drift가 없습니다.
- 문서 역할별 권위, 우선순위, 확인 시점, 코드 대조, 역사적 문서, 미검증·백로그가 연결됩니다.
- 요구된 공통 문서와 템플릿이 존재하고 내부 상대 링크가 유효합니다.

## 2. 적용한 결정

| 검토 항목 | 결정 | 권위 기록 |
|---|---|---|
| 문서 중복 | 기존 `PRD.md`, `README.md`, `handoff.md`를 복제·삭제하지 않고 역할과 역사 상태를 명시 | ADR-001 |
| AI 반영 권한 | AI는 초안만 만들고 사람 승인과 백엔드 규칙이 최종 반영을 결정 | ADR-002 |
| 추출 경쟁 | DB 조건부 update와 attempt ID로 작업 단위 독점 소유권 부여 | ADR-003 |
| Excel 교체 | 추출·검수 데이터가 생긴 작업에서는 거절하고 새 작업 사용 | ADR-004 |
| 단가 편집 | 단가만 바꾸면 기본값 재계산, 명시 체크와 무관 편집은 사용자 값 보존 | ADR-005 |
| 빈 내보내기 | 완료 문서와 검수 품목이 모두 있어야 허용 | ADR-006 |
| 숫자 경계 | 음수 단가 거절, 음수 기존 재고 허용, 입력 증분·단가는 비음수 정수 | ADR-007 |
| 시간 | API는 UTC `Z`, 화면은 Asia/Seoul | ADR-008 |
| 자동 저장 | 같은 행은 queue로 직렬화하고 최신 version 응답만 UI 반영 | ADR-009 |
| DB schema | ORM과 migration 표현을 맞추고 빈·기존 DB drift를 테스트 | ADR-010 |
| 외부 AI 검증 | 결정적 자동 테스트와 실제 모델 품질 판정을 분리 | ADR-011 |
| 소수점 기존 단가 | 현재 동작을 유지하되 제품 결정 전에는 확정 정책으로 승격하지 않음 | ADR-P01 Proposed |

결정의 맥락, 대안, 위험, 변경 조건과 코드·테스트 근거는 [`../03_DECISIONS.md`](../03_DECISIONS.md)에 있습니다.

## 3. 제품 코드 변경 기록

### 추출 소유권·잠금·복구

- migration: `backend/alembic/versions/e53a81f0bd21_add_extraction_attempt_ownership.py`
- 모델·공통 상태: `backend/app/models/job.py`, `backend/app/services/job_mutations.py`, `backend/app/services/recovery.py`
- 추출·문서 흐름: `backend/app/services/extraction.py`, `backend/app/services/documents.py`, `backend/app/api/documents.py`
- 작업·Excel 흐름: `backend/app/services/jobs.py`, `backend/app/api/jobs.py`

### 품목·가격·내보내기 전제

- 품목 수정 규칙: `backend/app/services/items.py`, `backend/app/services/item_rules.py`, `backend/app/services/matching.py`
- Excel 숫자 경계: `backend/app/services/excel.py`
- 완료 문서·검수 품목 blocker: `backend/app/services/summary.py`

### API 시간과 schema·migration 일치

- UTC schema: `backend/app/schemas/common.py`, `backend/app/schemas/documents.py`, `backend/app/schemas/jobs.py`
- ORM constraint 표현: `backend/app/models/completed_document.py`, `backend/app/models/document.py`, `backend/app/models/item.py`, `backend/app/models/price_resolution.py`, `backend/app/models/types.py`

### 프런트엔드

- 완료 시각 표시: `frontend/src/pages/CompletePage.tsx`
- 행별 자동 저장 queue/version: `frontend/src/pages/ReviewPage.tsx`

### 회귀 테스트

- backend: `backend/tests/integration/test_documents.py`, `test_exports.py`, `test_jobs.py`, `test_migration.py`, `test_review_workflow.py`, `backend/tests/unit/test_excel.py`
- frontend: `frontend/tests/CompletePage.test.tsx`, `JobsPage.test.tsx`, `ReviewPage.test.tsx`

## 4. 문서 Scaffolding 변경 기록

### 워크스페이스 공통

- `/Users/kimsangwoo/Desktop/workspace/AGENTS.md`
- `/Users/kimsangwoo/Desktop/workspace/principle/AI_Work_Operating_System.md`
- `/Users/kimsangwoo/Desktop/workspace/principle/Project_Onboarding.md`
- `/Users/kimsangwoo/Desktop/workspace/principle/Project_Registry.md`
- `/Users/kimsangwoo/Desktop/workspace/principle/Skill_Candidates.md`
- `/Users/kimsangwoo/Desktop/workspace/principle/templates/` 아래 요구된 12개 템플릿
- 기존 `/Users/kimsangwoo/Desktop/workspace/principle/Handoff.md`를 역사적 Setup 지시서로 상태 변경

### 현재 프로젝트

- `AGENTS.md`
- `docs/00_PROJECT_CONTEXT.md`
- `docs/02_ARCHITECTURE.md`
- `docs/03_DECISIONS.md`
- `docs/04_ACCEPTANCE_CRITERIA.md`
- `docs/05_CURRENT_STATUS.md`
- `docs/06_BACKLOG.md`
- 기존 `PRD.md`, `README.md`, `handoff.md`의 권위·링크·현재 완료 상태 보강

다른 프로젝트는 공통 레지스트리에서 조사 상태와 worktree 관계만 기록했습니다. 미커밋 변경과 기존 문서 권위를 보존하기 위해 이번 작업에서는 파일을 수정하지 않았습니다.

## 5. 수용 기준 결과

| 기준 | 결과 | 핵심 증거 |
|---|---|---|
| REG-01~03 추출 경쟁·잠금·복구 | 통과 | `test_documents.py`의 mutation, stale attempt, startup recovery 회귀 |
| REG-04 Excel 교체 정합성 | 통과 | `test_excel_replacement_is_blocked_and_preserves_approved_review_data` |
| REG-05~06 단가 편집 의미 | 통과 | 단가 기본 재계산과 사용자 선택 보존 테스트 |
| REG-07 빈 내보내기 차단 | 통과 | `test_review_summary_reports_blockers_and_manual_price_resolution` |
| REG-08 음수 단가 | 통과 | `test_negative_purchase_price_upload_returns_validation_error` |
| REG-09 UTC·서울 시각 | 통과 | backend API 계약과 JobsPage·CompletePage 테스트 |
| REG-10 빠른 연속 저장 | 통과 | ReviewPage 지연 응답 회귀 테스트 |
| REG-11 migration drift | 통과 | 빈 DB·기존 DB upgrade와 `alembic check` 테스트 |
| 문서 파일·역할 | 통과 | 공통 5개 운영 문서, 템플릿 12개, 프로젝트 역할 문서 존재 |
| Markdown 상대 링크 | 통과 | 현재형 공통·프로젝트 문서에서 깨진 링크 0개 |

세부 Given/When/Then과 제한은 [`../04_ACCEPTANCE_CRITERIA.md`](../04_ACCEPTANCE_CRITERIA.md)를 따릅니다.

## 6. 실행한 검증

2026-08-08 09:53(Asia/Seoul) `./scripts/test.sh` 최종 재실행 결과:

- backend pytest: 84 passed
- frontend Vitest: 6 files, 59 tests passed
- frontend production build: passed
- Playwright Chromium E2E: 3 passed
- 경고: Starlette `TestClient`의 httpx 사용 방식 deprecation warning 1건
- 실행 환경 알림: Playwright WebServer에서 `FORCE_COLOR` 때문에 `NO_COLOR`가 무시된다는 Node 경고가 출력되었으나 테스트 판정에는 영향이 없었습니다.

추가로 빈 DB와 기존 revision DB에 `alembic upgrade head`를 실행한 뒤 `alembic check`가 변경 없음임을 확인했습니다. 최종 문서 검사에서는 요구 템플릿 12개가 존재하고 현재형 문서의 로컬 Markdown 링크가 모두 유효함을 확인했습니다.

## 7. 보존·미검증·후속

- 원본 Excel, 샘플 이미지, `data/` 사용자 데이터는 수정·복사하지 않았습니다.
- OpenAI API key를 읽거나 실제 추출 요청을 보내지 않았습니다.
- 외부 배포나 운영 migration은 수행하지 않았습니다.
- 현재 미검증과 정책 결정은 [`../06_BACKLOG.md`](../06_BACKLOG.md)의 BL-001~008에서 추적합니다.
- 가장 우선인 외부 증거는 비용 허용 후 제공 사진 3장으로 수행하는 실제 OpenAI 추출 평가입니다.

## 8. 완료 판정

요청된 코드 결함 수정과 자동 검증, 공통 Scaffolding, 현재 프로젝트의 역할별 권위와 이번 작업 기록까지 완료했습니다. 단, 이 판정은 로컬 자동 검증과 문서 정합성 범위이며 실제 OpenAI 품질, 제공 샘플의 전체 수동 흐름, 배포 완료를 포함하지 않습니다.
