# inventory_uploader Acceptance Criteria & Verification Ledger

| 항목 | 값 |
|---|---|
| 문서 상태 | Active |
| 권위 역할 | PRD 수용 시나리오와 회귀 기준의 현재 증거·미검증 상태 |
| 마지막 코드·테스트 대조 | 2026-08-09 |
| 제품 시나리오 정의 | `PRD.md` §8 `AC-01`~`AC-15` |

## 판정 규칙

- PRD의 시나리오 문장은 제품 기대 결과의 권위입니다. 이 문서는 그 기준을 복제하지 않고 증거와 상태를 관리합니다.
- 자동 테스트 통과는 실제 OpenAI 품질이나 운영 배포를 증명하지 않습니다.
- `통과`는 표에 적힌 증거 범위에서만 유효합니다.

## PRD 핵심 수용 기준 상태

| ID | 시나리오 요약 | 자동 증거 | 실제 자료·사용자 흐름 | 판정 |
|---|---|---|---|---|
| AC-01 | 사진 3장 품목 추출·수동 추가 | 이미지 보정·추출 실패 격리·수동 품목 테스트 | 제공 사진 3장 실제 OpenAI 호출 미실행 | 부분 검증 |
| AC-02 | 마운자로 매칭 후 Excel 공급사 사용 | 매칭 응답·export 이력 테스트 | 제공 Excel·사진 조합 실제 확인 미실행 | 부분 검증 |
| AC-03 | 바로타민 단가 기본 선택·해제·재선택 | 단가 기본값·명시 체크 테스트 | 제공 샘플 UI 흐름 미실행 | 부분 검증 |
| AC-04 | 상태와 반영 체크 독립 | `test_status_and_checkboxes_are_independent_and_persist` | 자동 통합 검증 | 통과 |
| AC-05 | 3상태 마스터 체크와 전체 적용 | review bulk/UI 테스트 | 브라우저 E2E 핵심 흐름 | 통과 |
| AC-06 | 동일 상품 재고 합산 | inventory unit·review/export 통합 테스트 | 자동 검증 | 통과 |
| AC-07 | 최신 날짜와 최신일 충돌 | pricing unit·resolution 통합 테스트 | 자동 검증 | 통과 |
| AC-08 | 미매칭 승인 차단 | `test_approval_exclusion_and_purchase_price_rules_return_409` | 자동 검증 | 통과 |
| AC-09 | 완료 명세서 재업로드 차단 | 현재 작업·완료 이력 중복 테스트와 병렬 확정 테스트 | 재촬영 유사 이미지 품질은 실제 평가 미실행 | 부분 검증 |
| AC-10 | 원본 보존과 허용 변경만 출력 | Excel copy·export 재검증 테스트 | 제공 8,562행 기준 파일 구조 검토는 과거 Handoff 증거 | 통과(자동), 실제 전체 파일 재검증은 제한 |
| AC-11 | 보류·제외·체크 해제 행 미반영 | review/export 이력 테스트 | 자동 검증 | 통과 |
| AC-12 | 재시작 후 검수 상태 복구 | DB persistence·startup recovery 테스트 | 실제 프로세스 강제 종료 수동 흐름 미실행 | 부분 검증 |
| AC-13 | 유일한 90점 이상 후보 자동 승인과 사진별 보류 검수 | matching unit·추출 통합 테스트, ReviewPage 매칭·미매칭 보류 바로가기·상품별 상태 표시·원본 회전·후보 선택 즉시 승인·상품 분할 편집·반응형 배치·완료 이동 테스트 | 실제 제공 사진의 점수 분포·자동 승인 정확도 미검증 | 부분 검증 |
| AC-14 | 사용자 확정 OCR 매칭의 다음 작업 자동 재사용 | `test_manual_match_is_remembered_and_auto_applied_in_next_job` | 실제 반복 입고 자료의 별칭 품질 미검증 | 통과(자동), 실제 자료 제한 |
| AC-15 | 미매칭 신규 상품 직접 등록과 결과 Excel 새 행 반영 | 등록 API·중복 코드 통합 테스트, export 원본 해시·새 행 재검증, ReviewPage 직접 등록 테스트 | 실제 8,562행 기준 Excel에서 직접 등록 수동 흐름 미실행 | 통과(자동), 실제 파일 제한 |

## 2026-08-08 리뷰 결함 회귀 기준

| ID | Given / When | Then | 증거 | 판정 |
|---|---|---|---|---|
| REG-01 | 작업이 `EXTRACTING`일 때 Excel·사진·문서·품목·매칭·추출 mutation을 요청 | 모두 409이며 데이터·소유권이 유지됨 | `test_extracting_job_rejects_all_mutations_and_duplicate_extraction` | 통과 |
| REG-02 | 오래된 추출이 실행 중 새 attempt가 소유권을 가짐 | 오래된 실행이 품목을 저장하거나 작업을 종료하지 못함 | `test_stale_extraction_cannot_store_or_finish_newer_attempt` | 통과 |
| REG-03 | 앱이 `EXTRACTING/PROCESSING` 중 중단된 DB로 시작 | 문서는 실패, 작업은 `REVIEWING`, attempt는 null로 복구 | `test_startup_recovers_interrupted_extraction` | 통과 |
| REG-04 | 추출·승인 데이터가 있는 작업에 새 Excel 업로드 | 409이며 기존 Excel·인덱스·매칭·승인·내보내기 결과가 유지 | `test_excel_replacement_is_blocked_and_preserves_approved_review_data` | 통과 |
| REG-05 | 같은 상품의 사진 단가만 같음↔다름으로 편집 | 기본 체크가 false↔true로 재계산되고 명시 체크가 우선 | `test_unit_price_edit_recomputes_default_unless_checkbox_is_explicit` | 통과 |
| REG-06 | 메모·상태 등 단가 무관 필드 편집 | 사용자가 정한 단가 반영 체크가 유지 | `test_manual_purchase_price_choice_survives_unrelated_edits` | 통과 |
| REG-07 | Excel만 있거나 문서/검수 품목이 없음 | summary에 blocker가 있고 export는 409 | `test_review_summary_reports_blockers_and_manual_price_resolution` | 통과 |
| REG-08 | Excel 매입단가가 음수 | 업로드가 422이며 매칭 500에 도달하지 않음 | `test_negative_purchase_price_upload_returns_validation_error` | 통과 |
| REG-09 | 작업·문서·완료 API가 datetime 반환 | 문자열이 `Z`로 끝나고 UI가 Asia/Seoul 시각 표시 | `test_job_crud_and_excel_upload_share_job_read_contract`, JobsPage·CompletePage 렌더 테스트 | 통과 |
| REG-10 | 같은 행을 빠르게 두 번 편집하고 첫 응답이 늦음 | 클릭 결과가 즉시 보이고 서버 mutation 순서와 최신 UI 입력이 모두 보존 | ReviewPage `같은 행의 자동저장을 직렬화해 지연 응답이 최신 입력을 덮어쓰지 않는다`, `저장이 지연돼도 클릭한 체크와 상태를 화면에 즉시 반영하고 연속 입력을 허용한다` | 통과 |
| REG-11 | 빈 DB와 기존 revision DB를 head로 upgrade | head `f7b1c2d3e4a5`, 기존 데이터 보존, `alembic check` 무변경 | `test_initial_migration_creates_required_tables`, `test_existing_database_upgrades_to_head_without_schema_drift` | 통과 |
| REG-12 | 목록에서 정지 상태 작업 삭제를 확인하거나 실행 중 작업 삭제를 요청 | 정지 상태는 연관 DB·앱 소유 파일이 정리되고 목록·집계에서 사라지며, 추출·내보내기 중에는 409로 보존됨 | `test_delete_job_removes_related_records_and_owned_files`, `test_delete_job_rejects_processing_status`, JobsPage 삭제 흐름 테스트 | 통과 |
| REG-13 | 새 작업 업로드 화면에 진입하거나 파일만 선택한 뒤 목록으로 돌아감 | 작업 생성 요청이 없고 목록에 빈 초안이 추가되지 않으며, `임시저장`을 누르면 정확히 한 작업과 선택 파일이 저장됨 | UploadPage 임시저장·StrictMode 테스트, Playwright 새 작업 임시저장 흐름 | 통과 |

## 전체 검증 증거

2026-08-09 `./scripts/test.sh` 실제 결과:

- backend pytest: 93 passed
- frontend Vitest: 6 files, 67 tests passed
- frontend production build: passed
- Playwright Chromium E2E: 3 passed
- 경고: Starlette `TestClient`의 httpx 사용 방식 deprecation warning 1건

## 외부·수동 검증 기준

| ID | 필요한 자료·환경 | 절차 | 합격 기준 | 상태 |
|---|---|---|---|---|
| EXT-01 | 제공 사진 3장, `OPENAI_API_KEY`, 현재 모델 | 각 사진 추출 후 원문과 행 수·필드·경고 비교 | 모든 품목이 나타나고 스키마 오류가 없으며 누락·오류를 수동 수정 가능 | 미검증 |
| EXT-02 | 제공 기준 Excel과 EXT-01 결과 | AC-02·03 품목을 실제 매칭·검수 | Excel 공급사와 단가 기본값이 PRD 기대와 일치 | 미검증 |
| EXT-03 | 실제 브라우저와 로컬 프로세스 | 검수 중 강제 종료·재시작 | AC-12 데이터가 모두 복구되고 중단 상태가 고착되지 않음 | 미검증 |

제공 기준 Excel과 사진 파일의 경로 존재는 2026-08-08 확인했지만 실제 OpenAI 요청과 전체 수동 흐름은 실행하지 않았습니다.
