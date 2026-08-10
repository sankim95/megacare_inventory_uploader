from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.database import build_engine, build_session_factory, get_db
from app.main import create_app


def test_health_reports_database_connection(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'health.db'}"
    settings = Settings(data_dir=tmp_path / "data", database_url=database_url)
    test_engine = build_engine(database_url)
    test_session = build_session_factory(test_engine)
    app = create_app(settings)

    def override_get_db():
        with test_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        response = client.get("/api/health")
        cors_response = client.options(
            "/api/health",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"status": "정상", "database": "연결됨"}
    assert cors_response.headers["access-control-allow-origin"] == (
        "http://127.0.0.1:5173"
    )
    test_engine.dispose()

