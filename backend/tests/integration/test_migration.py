from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings


def test_initial_migration_creates_required_tables(
    tmp_path: Path, monkeypatch
) -> None:
    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    config = Config(str(config_path))
    command.upgrade(config, "head")
    command.check(config)

    engine = create_engine(database_url)
    table_names = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()

    assert {
        "alembic_version",
        "jobs",
        "documents",
        "items",
        "price_resolutions",
        "completed_documents",
        "learned_matches",
    } <= table_names
    assert "product_index" in table_names
    document_columns = {column["name"] for column in inspect(engine).get_columns("documents")}
    item_columns = {column["name"] for column in inspect(engine).get_columns("items")}
    job_columns = {column["name"] for column in inspect(engine).get_columns("jobs")}
    product_columns = {
        column["name"] for column in inspect(engine).get_columns("product_index")
    }
    assert {"correction_applied", "correction_warning"} <= document_columns
    assert "confidence" in item_columns
    assert "export_attempt_id" in job_columns
    assert "extraction_attempt_id" in job_columns
    assert "is_user_created" in product_columns
    completed_uniques = {
        tuple(constraint["column_names"])
        for constraint in inspect(engine).get_unique_constraints(
            "completed_documents"
        )
    }
    assert ("image_sha256",) in completed_uniques
    assert ("document_identity_key",) in completed_uniques
    assert ("item_signature",) in completed_uniques
    assert revision == "f7b1c2d3e4a5"
    engine.dispose()
    get_settings.cache_clear()


def test_existing_database_upgrades_to_head_without_schema_drift(
    tmp_path: Path, monkeypatch
) -> None:
    database_url = f"sqlite:///{tmp_path / 'existing.db'}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    config_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    config = Config(str(config_path))
    command.upgrade(config, "cc93cd4a12ef")

    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO jobs (id, status, created_at, updated_at) "
                "VALUES ('existing-job', 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
    engine.dispose()

    command.upgrade(config, "head")
    command.check(config)
    engine = create_engine(database_url)
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT id, extraction_attempt_id FROM jobs "
                "WHERE id = 'existing-job'"
            )
        ).one()
    assert row == ("existing-job", None)
    assert "learned_matches" in inspect(engine).get_table_names()
    assert "is_user_created" in {
        column["name"] for column in inspect(engine).get_columns("product_index")
    }
    engine.dispose()
    get_settings.cache_clear()
