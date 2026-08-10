# inventory_uploader AGENTS.md

> 상태: Active
> 마지막 코드·명령 대조: 2026-08-09
> 단일 컨텍스트 진입점: [`docs/00_PROJECT_CONTEXT.md`](./docs/00_PROJECT_CONTEXT.md)

## 프로젝트 목적

거래명세서 사진에서 품목을 구조화 추출하고 기존 상품리스트와 매칭한 뒤, 확정된 승인 행만 원본을 보존한 새 Excel에 반영하는 단일 사용자용 로컬 웹앱입니다.

## 작업 전 읽을 순서

1. [`docs/00_PROJECT_CONTEXT.md`](./docs/00_PROJECT_CONTEXT.md)
2. 요청과 관련된 권위 문서: `PRD.md`, `docs/02_ARCHITECTURE.md`, `docs/03_DECISIONS.md`, `docs/04_ACCEPTANCE_CRITERIA.md`
3. [`docs/05_CURRENT_STATUS.md`](./docs/05_CURRENT_STATUS.md)와 [`docs/06_BACKLOG.md`](./docs/06_BACKLOG.md)
4. 실제 코드, 테스트, 스크립트

`handoff.md`는 초기 요구와 2026-08-08 수정 전 코드 리뷰를 보존한 역사적 자료입니다. 현재 판정이나 미해결 목록의 권위로 사용하지 않습니다.

## 확인된 기술과 경로

- 백엔드: Python 3.12, FastAPI, SQLAlchemy, Alembic, SQLite — `backend/`
- 프런트엔드: React 19, TypeScript, Vite — `frontend/`
- 검증: pytest, Vitest, Playwright — `backend/tests/`, `frontend/src/**/*.test.*`, `e2e/`
- 사용자 데이터: `data/app.db`, `data/uploads/`, `data/corrected/`, `data/exports/`
- 외부 서비스: OpenAI Responses API. 한 번에 현재 문서 이미지 한 장만 전송하며 상품리스트 전체는 전송하지 않습니다.

## 제품·데이터 불변식

- 원본 Excel을 직접 수정하지 않습니다. 출력은 별도 파일로 만들고 재검증 성공 후에만 완료 처리합니다.
- AI 추출값은 초안입니다. 다만 유일 코드 일치 또는 90점 이상 후보가 정확히 하나이고 `+재고`가 유효한 행은 백엔드 규칙으로 자동 승인하며, 나머지는 사람의 검수 전까지 보류합니다.
- 신규 상품을 자동 생성하지 않습니다. 기존 상품 매칭, 사용자의 명시적 직접 등록, 또는 사유 있는 제외가 필요합니다.
- 최종 계산, 내보내기 차단, 중복 판정의 권위는 백엔드입니다.
- `EXTRACTING`, `EXPORTING`, `COMPLETED` 작업의 충돌하는 mutation은 서버에서 차단합니다.
- 추출과 내보내기의 오래된 실행은 attempt ID가 일치할 때만 결과와 최종 상태를 확정합니다.
- 추출·검수 데이터가 생긴 작업에서는 상품리스트 Excel 교체를 거절합니다. 새 기준 Excel은 새 작업을 사용합니다.
- 완료 작업은 읽기 전용입니다.
- API 시각은 UTC 오프셋이 있는 ISO 8601(`Z`)로 보내고 UI는 `Asia/Seoul`로 표시합니다.
- `OPENAI_API_KEY`와 사용자 데이터는 코드, 테스트 fixture 출력, 문서, 로그에 복사하지 않습니다.

## 실제 명령

| 목적 | 명령 | 출처 |
|---|---|---|
| 설치 | `PYTHON_BIN=/path/to/python3.12 ./scripts/setup.sh` | `scripts/setup.sh` |
| 개발 실행 | `./scripts/dev.sh` | `scripts/dev.sh` |
| 전체 검증 | `./scripts/test.sh` | `scripts/test.sh` |
| 프로덕션 형태 로컬 실행 | `./scripts/start.sh` | `scripts/start.sh` |
| 마이그레이션 검사 | `cd backend && ../.venv/bin/alembic check` | `backend/alembic.ini`, migration 테스트 |

`dev.sh`와 `start.sh`는 시작 전에 `alembic upgrade head`를 실행합니다. 실제 사용자 DB에 실행하기 전에는 앱을 종료하고 `data/` 전체 백업 및 대상 경로를 확인합니다.

## 변경 규칙

- 버그 수정은 가능하면 재현 테스트로 고정한 뒤 최소 구현으로 통과시킵니다.
- 상태 전이, 동시성, 가격·재고 계산, Excel 출력 변경은 백엔드 테스트를 포함합니다.
- React의 저장 요청을 변경하면 빠른 연속 입력과 늦은 응답 순서를 검증합니다.
- DB 모델을 변경하면 Alembic migration, 빈 DB upgrade, 기존 DB upgrade, `alembic check`를 함께 검증합니다.
- 실제 OpenAI 호출은 비용과 외부 의존성이 있으므로 명시적으로 수행 여부를 구분하고, 실행하지 않았다면 완료 보고에 남깁니다.
- 관련 없는 코드 정리나 문서 재서식을 하지 않습니다.

## 완료 보고

공통 워크스페이스 규칙의 항목에 더해 다음을 명시합니다.

- 원본 Excel·사용자 데이터 보존 여부
- 마이그레이션 head와 `alembic check` 결과
- 실제 OpenAI 샘플 호출 수행 여부
- 로컬 검증과 실제 사용자 데이터·외부 통합 검증의 차이
- Git 저장소가 아니라면 그 사실
