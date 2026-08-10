# inventory_uploader Decision Records

| 항목 | 값 |
|---|---|
| 문서 상태 | Active |
| 권위 역할 | 프로젝트의 확정·보류된 제품·기술 결정 |
| 마지막 갱신 | 2026-08-09 |
| 코드 대조 | 아래 Accepted 결정의 구현·테스트 위치 대조 완료 |

## 상태 정의

- `Accepted`: 현재 코드와 후속 작업이 따라야 합니다.
- `Proposed`: 사용자 또는 제품 결정이 필요하며 현재 권위가 아닙니다.
- `Superseded`: 새 결정으로 대체된 과거 결정입니다.

## ADR-001 문서 역할과 단일 컨텍스트 진입점

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 결정자 | 사용자 요청을 반영한 프로젝트 운영 결정 |

### 맥락

기존에는 `PRD.md`, `README.md`, `handoff.md`가 있었지만 아키텍처, 결정, 현재 상태, 백로그의 단일 권위와 우선순위가 없었습니다. `handoff.md`의 수정 전 리뷰 판정이 수정 후에도 현재 상태처럼 읽힐 위험이 있었습니다.

### 결정

`docs/00_PROJECT_CONTEXT.md`를 단일 진입점으로 사용하고 기존 `PRD.md`와 `README.md`는 재사용합니다. 누락 역할만 `docs/02`~`06`으로 만듭니다. `handoff.md`는 역사적 요구·리뷰 기록으로 보존하되 현재 판정 권위에서 제외합니다.

### 이유와 대안

- 기존 PRD 복제는 충돌하는 두 권위를 만들므로 채택하지 않았습니다.
- 과거 Handoff 삭제는 재현 근거를 잃으므로 채택하지 않았습니다.

### 결과·변경 조건·근거

- 모든 새 결정과 완료 작업은 각각 이 문서와 `05_CURRENT_STATUS.md`에 기록합니다.
- 문서 체계가 과도해지거나 기존 역할이 합쳐지면 파일 수보다 역할별 단일 권위를 유지하는 범위에서 재구성할 수 있습니다.
- 근거: `docs/00_PROJECT_CONTEXT.md`, 사용자 제공 목표 구조.

## ADR-002 AI는 초안, 사람 승인과 백엔드 규칙이 최종 권위

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-07 |
| 상태 | Superseded by ADR-012 |

### 결정

AI는 문서·품목 추출과 후보 제안만 수행합니다. 새 행은 보류로 시작하고, 기존 상품에 매칭된 행을 사람이 승인하며 반영 체크가 켜진 경우에만 백엔드가 재고·단가를 결과 Excel에 반영합니다. 원본 Excel은 수정하지 않습니다.

### 이유와 대안

OCR·유사 상품 매칭 오류가 재고에 자동 반영되는 위험을 피하고 이력을 남기기 위함입니다. AI 자동 승인과 신규 상품 자동 등록은 MVP에서 제외했습니다.

### 근거와 변경 조건

- 근거: `PRD.md` §1~§4, `backend/app/services/summary.py`, `exports.py`.
- 변경 조건: 자동 승인 정확도·책임 정책·대표 평가셋이 별도로 승인될 때 새 ADR이 필요합니다.

## ADR-003 추출은 작업 단위 독점 attempt로 보호

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P1-1 |

### 맥락

수정 전에는 추출 중 문서 삭제·품목 변경·중복 추출이 가능했고 오래된 실행이 최신 작업 상태를 덮어쓸 수 있었습니다.

### 결정

조건부 DB update로 `EXTRACTING`과 `extraction_attempt_id`를 원자적으로 획득합니다. 추출 중 모든 충돌 mutation을 409로 막고, 문서 결과 저장과 최종 `REVIEWING` 전이는 같은 attempt ID 소유자만 수행합니다. 시작 복구는 중단된 실행을 검수 가능한 상태로 수렴시킵니다.

### 검토한 대안

- 프로세스 메모리 lock: 재시작과 다중 프로세스에서 권위가 없어 채택하지 않았습니다.
- UI 버튼만 비활성화: API 직접 호출을 막지 못해 채택하지 않았습니다.

### 결과·위험·근거

- 오래된 실행은 결과를 저장하거나 최신 상태를 종료할 수 없습니다.
- SQLite 조건부 update에 의존하며 추후 분산 실행으로 바꾸면 DB 잠금·queue 설계를 재검토해야 합니다.
- 코드: `backend/app/models/job.py`, `services/extraction.py`, `services/job_mutations.py`, `services/recovery.py`.
- migration: `e53a81f0bd21_add_extraction_attempt_ownership.py`.
- 테스트: `test_extracting_job_rejects_all_mutations_and_duplicate_extraction`, `test_stale_extraction_cannot_store_or_finish_newer_attempt`, `test_startup_recovers_interrupted_extraction`.

## ADR-004 추출·검수 데이터 이후 Excel 교체 거절

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P1-2 |

### 맥락

상품 인덱스만 교체하면 기존 매칭·승인·기준 단가가 새 Excel과 섞여 잘못된 내보내기가 가능했습니다.

### 결정

문서 품목, 완료 추출, 가격 결정 등 추출·검수 데이터가 존재하는 작업에서는 Excel 교체를 409로 거절하고 기존 파일·상품 인덱스·검수 데이터를 보존합니다. 새 기준 Excel은 새 작업을 만들거나 원본만 복제하는 작업 복제를 사용합니다.

### 검토한 대안

전 품목 재매칭·결정 초기화도 가능하지만 MVP에 비해 상태 조합과 사용자 혼동이 커서 채택하지 않았습니다.

### 변경 조건과 근거

사용자가 한 작업 안에서 기준 Excel 갱신을 반드시 요구하면 원자적 재매칭, 승인 초기화, 가격 결정 폐기, 실패 롤백을 갖춘 별도 기능으로 설계합니다.

- 코드: `backend/app/api/jobs.py`, `backend/app/services/jobs.py`.
- 테스트: `test_excel_replacement_is_blocked_and_preserves_approved_review_data`, `test_failed_replacement_preserves_existing_file_and_index`.

## ADR-005 사진 단가 편집 시 기본 반영값 재계산

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P1-3 |

### 결정

- 사진 단가만 바뀌면 현재 사진 단가와 기준 단가를 다시 비교해 `apply_purchase_price` 기본값을 계산합니다.
- 같은 요청에서 체크박스를 명시하면 사용자가 보낸 값이 우선합니다.
- 메모, 상태 등 단가와 무관한 편집은 기존 체크값을 보존합니다.

### 이유와 대안

별도 override 컬럼은 영구적인 사용자 의도를 더 정밀하게 표현하지만 현재 API는 한 요청에서 명시 여부를 알 수 있어 새 migration 없이 요구를 충족합니다. override 상태를 여러 세션에 걸쳐 별도로 추적해야 할 요구가 생기면 재검토합니다.

### 근거

- 코드: `backend/app/services/items.py`, `services/item_rules.py`, `services/matching.py`.
- 테스트: `test_unit_price_edit_recomputes_default_unless_checkbox_is_explicit`, `test_manual_purchase_price_choice_survives_unrelated_edits`.

## ADR-006 내보내기는 실제 검수 대상이 있을 때만 허용

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P2-1 |

### 결정

유효한 Excel만으로는 내보낼 수 없습니다. 완료된 문서가 한 개 이상이고 검수 대상 품목이 한 개 이상이어야 하며, 기존 보류·미매칭·중복·가격 충돌 등 모든 blocker도 해소되어야 합니다.

### 이유·근거

변경·검수 대상이 없는 작업을 완료로 기록하는 거짓 성공을 막습니다.

- 코드: `backend/app/services/summary.py`, `services/exports.py`.
- 테스트: `test_review_summary_reports_blockers_and_manual_price_resolution`.

## ADR-007 숫자 입력 경계

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted, 단 소수점 기존 매입단가는 Proposed로 분리 |

### 결정

1. Excel의 음수 `매입단가`는 업로드 단계에서 422로 거절합니다.
2. 기존 Excel의 음수 `현재고`는 기준 재고로 허용합니다.
3. 사용자가 입력하는 `+재고`와 반영할 사진 단가는 0 이상 정수 규칙을 따릅니다.

### 이유와 대안

음수 매입단가를 인덱스에 넣으면 이후 매칭의 DB 제약에서 500이 날 수 있어 경계에서 거절합니다. 음수 현재고는 실제 기준 파일에 존재하고 기존 정책·테스트가 허용하므로 이번 버그 수정에서 바꾸지 않았습니다.

### 근거와 변경 조건

- 코드: `backend/app/services/excel.py`, `services/matching.py`, schemas와 DB check constraints.
- 테스트: `test_negative_purchase_price_upload_returns_validation_error`, 음수 현재고와 `99.5` 원값 보존을 확인하는 `test_job_crud_and_excel_upload_share_job_read_contract`.
- 음수 현재고 정책 변경은 반품·재고 정정의 제품 의미를 결정하는 별도 ADR이 필요합니다.

## ADR-008 API 시각은 UTC, 화면은 Asia/Seoul

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P2-3 |

### 결정

서버의 모든 공개 datetime은 UTC `Z`가 포함된 ISO 8601 문자열로 직렬화합니다. SQLite에서 읽은 naive datetime도 UTC로 해석합니다. 프런트엔드는 `Asia/Seoul`을 명시해 표시합니다.

### 이유와 대안

오프셋 없는 문자열을 브라우저가 현지 시각으로 오해해 9시간 차이가 생겼습니다. 프런트에서 임의로 9시간을 더하는 방식은 입력 오프셋에 따라 이중 보정될 수 있어 채택하지 않았습니다.

### 근거

- 코드: `backend/app/schemas/common.py`, job/document/export schemas, `JobsPage.tsx`, `CompletePage.tsx`.
- 테스트: API datetime `Z` 계약과 Asia/Seoul 렌더링 테스트.

## ADR-009 품목 자동 저장은 행별 직렬화하고 최신 응답만 반영

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P2-4 |

### 결정

같은 품목 행의 저장 요청은 Promise queue로 순서대로 실행하고 version 번호가 최신인 요청만 전체 행 응답과 저장 상태를 화면에 반영합니다. 실패 시 서버 최신 품목을 다시 불러옵니다. 서로 다른 행은 독립적으로 저장할 수 있습니다.

### 이유와 대안

요청 취소만으로는 이미 서버에 도달한 mutation 순서를 되돌릴 수 없습니다. 전역 queue는 서로 다른 행의 독립 편집까지 불필요하게 지연합니다.

### 근거

- 코드: `frontend/src/pages/ReviewPage.tsx`의 `itemSaveQueues`, `itemSaveVersions`.
- 테스트: 지연된 첫 저장과 빠른 연속 편집을 검증하는 ReviewPage 회귀 테스트.

## ADR-010 ORM과 Alembic head의 스키마 표현 일치

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |
| 관련 리뷰 | `handoff.md` P3-1 |

### 결정

ORM enum check constraints와 완료 문서 unique constraints를 Alembic이 생성한 SQLite schema와 동일한 이름·표현으로 관리합니다. 모델 또는 migration 변경 시 빈 DB와 기존 DB 모두 `upgrade head` 후 `alembic check`가 깨끗해야 합니다.

### 이유와 근거

runtime 동작만 맞아도 metadata drift가 있으면 다음 migration 자동생성에서 잘못된 제약 변경이 생길 수 있습니다.

- 코드: `backend/app/models/*.py`, `backend/alembic/versions/cc93cd4a12ef_add_completed_document_uniqueness.py`, `e53a81f0bd21_add_extraction_attempt_ownership.py`.
- 테스트: `test_initial_migration_creates_required_tables`, `test_existing_database_upgrades_to_head_without_schema_drift`.

## ADR-011 실제 OpenAI 검증은 로컬 결정적 테스트와 별도 판정

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Accepted |

### 결정

Mock/fake extraction으로 형식·상태·실패 격리·보안 경계를 검증하는 자동 테스트와 실제 OpenAI 모델의 샘플 품질 검증을 별도 상태로 기록합니다. 비용과 외부 상태가 있는 실제 호출을 실행하지 않았다면 전체 테스트 통과와 별개로 `미검증`이라고 보고합니다.

### 근거와 변경 조건

현재 자동 테스트는 OpenAI 응답을 대체하며 제공 샘플 3장 실제 호출은 수행하지 않았습니다. 대표 평가셋과 비용 예산이 정해지면 반복 가능한 외부 통합 gate로 승격합니다.

## ADR-012 유일한 고득점 매칭은 자동 승인하고 보류 사진만 기본 검수

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-09 |
| 상태 | Accepted |
| 대체 결정 | ADR-002의 모든 신규 AI 행 수동 승인 정책 |
| 결정자 | 사용자의 2026-08-09 검수 간소화 요청 |

### 결정

- 상품코드가 유일하게 정확 일치하거나 후보 중 90점 이상이 정확히 하나인 AI 추출 행은 자동 매칭합니다.
- 자동 매칭된 행의 `+재고`가 0 이상 정수이면 `승인`으로 자동 전환합니다. 유효하지 않으면 `보류`를 유지합니다.
- 90점 이상 후보가 둘 이상이면 자동 선택하지 않고 `보류`로 둡니다. 수기 추가 행도 자동 승인하지 않습니다.
- 검수 화면은 보류 행이 있는 사진만 원본 업로드 순서로 기본 표시합니다. 한 사진의 마지막 보류 행을 처리하면 다음 보류 사진으로 이동하며, 사용자는 `보류 항목만 검수`를 해제해 전체 사진과 행을 볼 수 있습니다.
- 작업 전체 집계의 보류 수는 첫 보류 사진의 추출 품목으로 이동하는 검수 진입점입니다.
- 작업 전체 집계의 상품명은 스크롤 이동 없이 같은 위치에서 좌측 집계·우측 편집 분할 화면을 엽니다. 같은 상품의 여러 `item_ids`는 우측 행 선택기로 전환하며, 좁은 화면은 세로 배치로 전환합니다.
- 사용자가 후보의 `선택·반영`을 누르면 수동 매칭과 승인 의도를 같은 서버 트랜잭션에서 처리합니다. `+재고`가 유효하면 승인하고, 유효하지 않으면 매칭만 저장한 채 보류를 유지합니다. 두 반영 체크는 이 동작과 독립적으로 보존합니다.
- 검수 사진 창은 보정본 대신 업로드 원본을 표시하며, 사진 클릭은 저장 파일을 바꾸지 않고 화면에서만 시계 방향 90도씩 회전합니다.
- 자동 승인 여부와 관계없이 실제 Excel 반영은 `승인 AND 반영 체크`라는 백엔드 규칙을 따르고, 원본 Excel은 수정하지 않으며 신규 상품을 자동 생성하지 않습니다.

### 이유와 위험 통제

확실한 단일 후보까지 반복 승인하는 부담을 줄이되, 서로 경쟁하는 고득점 후보와 유효하지 않은 재고는 계속 사람에게 남깁니다. 점수 품질 자체는 실제 OpenAI 추출 평가와 별개이며, 잘못된 자동 승인을 발견하면 90점 경계나 자동 승인 범위를 재검토해야 합니다.

### 근거

- 코드: `backend/app/services/matching.py`, `backend/app/services/extraction.py`, `frontend/src/pages/ReviewPage.tsx`.
- 테스트: `test_auto_match_requires_exactly_one_candidate_at_or_above_90`, `test_unique_90_point_candidate_is_auto_approved_only_when_requested`, `test_manual_match_can_approve_without_changing_inventory_choice`, 문서 추출 통합 테스트, ReviewPage의 보류 집계 이동·원본 회전·선택 반영·상품 분할 편집 테스트.

## ADR-013 작업 삭제는 실행 중 상태를 제외하고 전체 정리

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-09 |
| 상태 | Accepted |
| 결정자 | 사용자의 2026-08-09 작업 목록 삭제 요청 |

### 결정

- 작업 목록의 각 행에서 삭제를 시작하고 인라인 확인을 거쳐 확정합니다.
- `EXTRACTING`, `EXPORTING` 작업은 실행 중인 결과와의 경합을 피하기 위해 UI와 서버에서 삭제를 차단합니다.
- 그 밖의 상태는 완료 작업을 포함해 삭제할 수 있으며, 작업에 속한 상품 인덱스·문서·품목·가격 결정·완료 문서 이력과 앱이 소유한 원본 Excel·원본/보정 이미지·결과 Excel을 함께 정리합니다.
- 완료 작업의 완료 문서 이력이 삭제되므로 같은 명세서는 이후 새 작업에서 완료 중복으로 판정되지 않습니다.
- 파일 삭제 대상은 설정된 `uploads`, `corrected`, `exports` 디렉터리 내부 경로로 제한합니다.

### 이유와 근거

불필요한 작업을 목록에서 바로 정리할 수 있게 하되, 백그라운드 실행과 삭제의 동시 변경은 서버가 차단해야 합니다. 삭제는 되돌릴 수 없으므로 한 단계 확인을 유지합니다.

- 코드: `backend/app/api/jobs.py`, `backend/app/services/jobs.py`, `frontend/src/api/client.ts`, `frontend/src/pages/JobsPage.tsx`.
- 테스트: `test_delete_job_removes_related_records_and_owned_files`, `test_delete_job_rejects_processing_status`, JobsPage 삭제 확인·실패·처리 중 비활성화 테스트.

## ADR-014 새 작업은 업로드 화면의 명시적 임시저장으로 생성

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-09 |
| 상태 | Accepted |
| 결정자 | 사용자의 2026-08-09 빈 작업 생성 방지 요청 |

### 결정

- `/jobs/new/upload` 화면에 들어오거나 Excel·사진을 선택하는 것만으로는 서버 작업을 생성하지 않습니다.
- 선택 파일은 브라우저 메모리에만 두고, 한 개 이상의 유효한 파일이 선택된 상태에서 `임시저장`을 누르면 작업을 한 번 생성한 뒤 Excel 검증·저장과 사진 저장을 순서대로 수행합니다.
- 작업이 생성되면 작업 ID가 있는 URL로 바꾸며, 이후 파일 추가·교체와 AI 추출·검수 자동저장은 기존 정책을 유지합니다.
- 작업 생성 후 일부 파일 저장이 실패하면 이미 생성된 작업을 숨기지 않고 해당 작업 화면에서 실패 사유와 재시도 수단을 제공합니다.

### 이유와 근거

단순한 화면 진입이나 파일 탐색 취소가 빈 초안 작업을 누적시키지 않으면서, 사용자가 보존 의사를 밝힌 시점부터는 기존 복구·자동저장 특성을 유지합니다.

- 코드: `frontend/src/pages/UploadPage.tsx`, `frontend/src/pages/JobsPage.tsx`.
- 테스트: UploadPage의 임시저장 전 무요청·선택 파일 일괄 저장·StrictMode 단일 생성 테스트, Playwright 새 작업 임시저장 흐름.

## ADR-015 사용자 확정 매칭은 재사용하고 신규 상품은 명시적 직접 등록만 허용

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-09 |
| 상태 | Accepted |
| 보완 결정 | ADR-002·ADR-012의 신규 상품 자동 생성 금지와 수동 매칭 정책 |
| 결정자 | 사용자의 2026-08-09 실제 재고 편의성 개선 요청 |

### 결정

- 기존 후보를 사용자가 수동 확정하면 OCR 원본과 현재값의 정규화 코드, 상품명+규격 별칭을 실제 상품코드와 전역 저장합니다.
- 다음 작업에서 같은 별칭이 나오더라도 저장된 상품코드가 그 작업의 기준 Excel에 있을 때만 자동 매칭합니다. 상품이 없으면 오래된 연결을 강제하지 않고 기존 후보 검수를 유지합니다.
- 사용자가 수동 매칭을 해제하면 해당 품목의 별칭이 그 상품을 가리키는 학습 기록도 제거합니다.
- 미매칭 화면의 `사용자 직접 등록`은 상품코드·상품명과 선택 입력값을 받아 현재 작업의 상품 인덱스에만 새 상품을 만들고 해당 품목에 즉시 연결합니다.
- 직접 등록 상품은 원본 Excel을 바꾸지 않고 내보낸 복사본의 새 행에 최종 재고·단가와 함께 추가합니다. 같은 코드는 현재 작업에서 중복 등록할 수 없습니다.
- AI 추출만으로 신규 상품을 만들거나 다른 작업의 기준 Excel을 암묵적으로 수정하지 않습니다.

### 이유와 위험 통제

반복되는 OCR 오탈자 확인을 줄이면서도 사용자가 한 번도 확정하지 않은 매칭은 학습하지 않습니다. 직접 등록은 입력 의도가 명시된 현재 작업과 결과 복사본으로 범위를 제한해 원본 보존과 작업별 기준 Excel 일관성을 유지합니다.

### 근거

- 코드: `backend/app/models/learned_match.py`, `backend/app/services/matching.py`, `backend/app/services/excel.py`, `backend/app/services/exports.py`, `frontend/src/pages/ReviewPage.tsx`.
- 테스트: `test_manual_match_is_remembered_and_auto_applied_in_next_job`, `test_register_product_from_unmatched_item_and_reject_duplicate_code`, `test_export_appends_registered_product_without_changing_source`, ReviewPage 직접 등록 흐름 테스트.

## Proposed: ADR-P01 기존 Excel의 소수점 매입단가 정책

| 항목 | 값 |
|---|---|
| 날짜 | 2026-08-08 |
| 상태 | Proposed — 제품 결정 필요 |

### 현재 사실

기준 Excel에는 정수가 아닌 매입단가가 650개 있다는 과거 검토 기록이 있습니다. 현재 코드는 Excel 원값을 `ProductIndex.purchase_price`에 보존하지만 매칭 기준 단가는 `_optional_integer`를 거치므로 소수점 값은 `None`으로 취급합니다. 통합 테스트는 `99.5`의 원값 보존을 확인합니다.

### 선택지

| 선택지 | 영향 |
|---|---|
| 업로드 거절 | 규칙은 명확하지만 기존 기준 파일을 수정하기 전에는 앱을 사용할 수 없음 |
| 반올림 또는 절사 | 자동 사용 가능하지만 금액 변형 규칙과 감사 이력이 필요 |
| 값 없음+경고 | 현재 동작에 가깝고 안전하지만 650개 상품의 자동 단가 비교가 제한됨 |
| 소수 단가 지원 | 원값을 보존하지만 schemas, 계산, Excel 검증, UI 형식을 넓게 수정해야 함 |

사용자 결정 전에는 현재 동작을 유지하며 `docs/06_BACKLOG.md`에서 추적합니다.
