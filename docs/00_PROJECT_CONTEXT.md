# inventory_uploader Project Context Index

| 항목 | 값 |
|---|---|
| 프로젝트 | 약국 거래명세서 입고 반영 도우미 |
| 한 문장 설명 | 거래명세서 사진의 품목을 추출·매칭하고 자동 또는 수동으로 확정된 승인 변경만 원본을 보존한 새 상품리스트 Excel에 반영하는 로컬 웹앱 |
| 문서 상태 | Active |
| 마지막 사실 확인 | 2026-08-09 |
| 현재 코드와 대조 | 예 — `backend/app`, `backend/alembic`, `backend/tests`, `frontend/src`, `e2e`, `scripts` |
| 대조하지 않은 환경 | 실제 OpenAI 호출 결과, 배포 환경, 운영 사용 데이터 |
| 저장소 상태 | 현재 디렉터리는 Git 저장소가 아님 |

## 권위 문서

| 역할 | 권위 문서 | 설명 |
|---|---|---|
| 단일 컨텍스트 진입점 | 이 문서 | 문서 권위, 우선순위, 최신성, 중복 안내 |
| 제품 목적·요구사항 | [`../PRD.md`](../PRD.md) | MVP 범위, 제품 규칙, FR, 핵심 AC 정의 |
| 현재 구현 아키텍처 | [`02_ARCHITECTURE.md`](./02_ARCHITECTURE.md) | 구성 요소, 데이터·상태 흐름, 외부 경계 |
| 확정·보류 결정 | [`03_DECISIONS.md`](./03_DECISIONS.md) | PRD 보완 결정과 2026-08-08 수정 정책 |
| 수용 기준과 증거 | [`04_ACCEPTANCE_CRITERIA.md`](./04_ACCEPTANCE_CRITERIA.md) | PRD AC의 검증 상태와 회귀 기준 |
| 현재 상태 | [`05_CURRENT_STATUS.md`](./05_CURRENT_STATUS.md) | 구현·자동 검증·외부 통합·배포 분리 |
| 남은 작업 | [`06_BACKLOG.md`](./06_BACKLOG.md) | 미검증, 정책 결정, 운영 준비 |
| 설치·사용·백업 | [`../README.md`](../README.md) | 사용자가 실행하는 절차 |
| 프로젝트 작업 규칙 | [`../AGENTS.md`](../AGENTS.md) | 실제 명령, 불변식, 검증 규칙 |

## 최근 작업 기록

- [`work/2026-08-08_HANDOFF_REMEDIATION_AND_SCAFFOLDING.md`](./work/2026-08-08_HANDOFF_REMEDIATION_AND_SCAFFOLDING.md) — 이번 코드 리뷰 결함 수정과 운영 문서 Scaffolding의 작업 계약·변경 목록·검증·제한

## 문서 우선순위

1. 사용자의 최신 명시 결정이 [`03_DECISIONS.md`](./03_DECISIONS.md)에 기록된 Accepted 결정
2. Accepted 결정에 의해 보완된 [`../PRD.md`](../PRD.md)의 확정 제품 규칙과 기능 요구사항
3. [`04_ACCEPTANCE_CRITERIA.md`](./04_ACCEPTANCE_CRITERIA.md)의 판정 기준과 증거 요구
4. 현재 구현을 설명하는 [`02_ARCHITECTURE.md`](./02_ARCHITECTURE.md)와 [`05_CURRENT_STATUS.md`](./05_CURRENT_STATUS.md)
5. 사용 절차를 설명하는 [`../README.md`](../README.md)
6. 역사적 배경인 [`../handoff.md`](../handoff.md)

코드가 상위 문서와 다르면 코드가 자동으로 새 정책이 되지 않습니다. 불일치를 현재 상태와 백로그에 기록하고 제품 결정을 받은 뒤 수정합니다.

## 실행과 검증 명령

| 목적 | 명령 | 출처 | 마지막 결과 |
|---|---|---|---|
| 설치 | `PYTHON_BIN=/path/to/python3.12 ./scripts/setup.sh` | `scripts/setup.sh` | 이번 작업에서 미실행 |
| 개발 실행 | `./scripts/dev.sh` | `scripts/dev.sh` | 이번 작업에서 미실행 |
| 전체 검증 | `./scripts/test.sh` | `scripts/test.sh` | 2026-08-09 통과: backend 93, frontend 67, build, E2E 3 |
| DB 스키마 검사 | `cd backend && ../.venv/bin/alembic check` | `backend/alembic.ini` | 2026-08-09 임시 빈 DB upgrade 후 통과, 기존 DB upgrade 회귀 테스트 통과 |

## 역할별 권위 분할

- PRD §8의 `AC-01`~`AC-13` 문장은 제품 수용 시나리오의 정의입니다.
- `docs/04_ACCEPTANCE_CRITERIA.md`는 그 시나리오와 2026-08-08 회귀 기준의 현재 증거·미검증 상태에 대한 권위입니다.
- PRD §6의 초기 파일 트리는 기획 시점 구조입니다. 현재 구현 구조의 권위는 `docs/02_ARCHITECTURE.md`입니다.

## 중복·폐기·참고 문서

| 문서 | 상태 | 현재 권위와의 관계 |
|---|---|---|
| [`../handoff.md`](../handoff.md) | Historical | 초기 요구와 수정 전 리뷰 재현을 보존합니다. §10의 출시 보류 판정과 미해결 목록은 2026-08-08 수정 후 현재 상태가 아닙니다. |
| [`../PRD.md`](../PRD.md) 안의 §6 초기 Scaffolding | 참고 | 현재 코드 구조는 `02_ARCHITECTURE.md`, 문서 구조는 이 진입점이 우선합니다. |
| 대화 기록 | 비권위 | 결정은 `03_DECISIONS.md`, 작업 결과는 `05_CURRENT_STATUS.md`로 옮긴 뒤 사용합니다. |

현재 프로젝트에는 `00_PROJECT_CONTEXT.md` 외 동등한 진입점이 없으므로 새 파일을 만들었습니다. 루트 PRD와 README는 복제하지 않았습니다.

## 현재 핵심 상태

- 보류 항목이 있는 사진만 묶어 검수하는 기본 화면과 유일한 90점 이상 후보의 자동 승인이 구현되었습니다.
- 사용자가 확정한 OCR 매칭을 다음 작업에서 재사용하고, 미매칭 신규 상품을 직접 등록해 결과 Excel 새 행으로 내보낼 수 있습니다.
- 작업 목록에서 확인 후 작업을 삭제하고 연관 DB 데이터와 앱 소유 파일을 함께 정리할 수 있습니다.
- 새 작업 화면 진입과 파일 선택은 서버 작업을 만들지 않으며, `임시저장`을 누를 때만 작업과 선택 파일을 저장합니다.
- 2026-08-08 코드 리뷰의 P1 3건, P2 4건, P3 1건은 구현 및 자동 회귀 검증이 완료되었습니다.
- 전체 로컬 검증은 통과했습니다.
- 실제 OpenAI API로 제공 샘플 사진 3장을 추출하는 검증은 수행하지 않았습니다.
- 소수점 기존 매입단가의 제품 정책은 아직 결정되지 않았습니다.

자세한 내용과 다음 작업은 [`05_CURRENT_STATUS.md`](./05_CURRENT_STATUS.md), [`06_BACKLOG.md`](./06_BACKLOG.md)를 따릅니다.
