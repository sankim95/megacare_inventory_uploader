from __future__ import annotations

from io import BytesIO
from pathlib import Path
from threading import Event, Thread

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from PIL import Image, ImageDraw
from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.core.database import Base, build_engine, build_session_factory, get_db
from app.main import create_app
from app.models import Document, Item, Job, JobStatus
from app.schemas.extraction import InvoiceExtraction
from app.services.extraction import (
    AIExtractionError,
    ExtractionOperationError,
    extract_job_documents,
)


def build_test_client(tmp_path: Path, with_api_key: bool = True):
    database_url = f"sqlite:///{tmp_path / 'documents.db'}"
    settings = Settings(
        data_dir=tmp_path / "data",
        database_url=database_url,
        openai_api_key="test-key" if with_api_key else None,
        openai_model="gpt-test",
    )
    engine = build_engine(database_url)
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    app = create_app(settings)

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app), session_factory, engine


def image_bytes(image_format: str = "PNG") -> bytes:
    stream = BytesIO()
    image = Image.new("RGB", (600, 800), "#333333")
    draw = ImageDraw.Draw(image)
    draw.polygon([(60, 80), (550, 50), (530, 750), (80, 730)], fill="white")
    for y in range(180, 680, 70):
        draw.line([(110, y), (500, y - 15)], fill="black", width=4)
    image.save(stream, format=image_format)
    return stream.getvalue()


def workbook_bytes() -> bytes:
    stream = BytesIO()
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(
        ["상품코드", "상품명", "규격", "현재고", "매입단가", "공급사코드", "공급사"]
    )
    worksheet.append(["0001", "상품", "1정", 0, 1000, "S1", "공급사"])
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def parsed_invoice(name: str = "추출 상품") -> InvoiceExtraction:
    return InvoiceExtraction.model_validate(
        {
            "document": {
                "photo_supplier": "사진 공급사",
                "transaction_date": "2026-08-06",
                "invoice_number": "INV-1",
                "document_total": 2000,
                "raw_header_text": "거래명세서 원문",
                "confidence_by_field": {
                    "photo_supplier": 0.95,
                    "transaction_date": None,
                    "invoice_number": None,
                    "document_total": None,
                    "raw_header_text": None,
                },
            },
            "items": [
                {
                    "source_row_order": 0,
                    "raw_row_text": f"{name} 2 1000",
                    "product_code_or_barcode": "0001",
                    "product_name": name,
                    "specification": "1정",
                    "quantity": 2,
                    "unit_price": 1000,
                    "amount": 2000,
                    "bundle_or_set_text": None,
                    "confidence_by_field": {
                        "raw_row_text": None,
                        "product_code_or_barcode": None,
                        "product_name": 0.9,
                        "specification": None,
                        "quantity": 0.8,
                        "unit_price": None,
                        "amount": None,
                        "bundle_or_set_text": None,
                    },
                    "extraction_warnings": [],
                }
            ],
        }
    )


def create_job(client: TestClient) -> str:
    return client.post("/api/jobs").json()["id"]


def upload_excel(client: TestClient, job_id: str) -> None:
    response = client.post(
        f"/api/jobs/{job_id}/excel",
        files={
            "file": (
                "products.xlsx",
                workbook_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200


def test_upload_preserves_order_and_isolates_invalid_image(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        response = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[
                ("files", ("첫 번째.png", image_bytes(), "image/png")),
                ("files", ("손상.png", b"not-image", "image/png")),
                ("files", ("세 번째.jpg", image_bytes("JPEG"), "image/jpeg")),
            ],
        )
        listing = client.get(f"/api/jobs/{job_id}/documents")

    assert response.status_code == 200
    documents = response.json()
    assert [document["source_order"] for document in documents] == [0, 1, 2]
    assert [document["status"] for document in documents] == [
        "pending",
        "failed",
        "pending",
    ]
    assert "이미지를 해석할 수 없습니다" in documents[1]["processing_error"]
    assert documents[0]["has_corrected_image"] is True
    assert listing.json() == documents

    with session_factory() as session:
        stored = session.scalars(
            select(Document).where(Document.job_id == job_id).order_by(Document.source_order)
        ).all()
        assert Path(stored[0].original_image_path).name != "첫 번째.png"
        assert Path(stored[0].corrected_image_path) != Path(stored[0].original_image_path)
        assert Path(stored[1].original_image_path).suffix == ".invalid"
    engine.dispose()


def test_document_detail_manual_add_edit_and_images(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[("files", ("invoice.png", image_bytes(), "image/png"))],
        ).json()[0]
        document_id = document["id"]
        manual = client.post(
            f"/api/documents/{document_id}/items",
            json={
                "product_code_or_barcode": "0001",
                "product_name": "수기 상품",
                "specification": "1정",
                "quantity": 2,
                "unit_price": 1000,
                "amount": 2000,
                "bundle_or_set_text": None,
                "apply_inventory": True,
            },
        )
        edited = client.patch(
            f"/api/items/{manual.json()['id']}",
            json={"quantity": 3, "stock_increment": 4, "amount": 3000},
        )
        invalid = client.patch(
            f"/api/items/{manual.json()['id']}", json={"unit_price": -1}
        )
        detail = client.get(f"/api/documents/{document_id}")
        original = client.get(f"/api/documents/{document_id}/image?variant=original")
        corrected = client.get(f"/api/documents/{document_id}/image?variant=corrected")

    assert manual.status_code == 201
    assert manual.json()["is_manual"] is True
    assert manual.json()["stock_increment"] == 2
    assert edited.json()["quantity"] == 3
    assert edited.json()["stock_increment"] == 4
    assert invalid.status_code == 422
    assert detail.json()["items"][0]["product_name"] == "수기 상품"
    assert detail.json()["created_at"].endswith("Z")
    assert detail.json()["updated_at"].endswith("Z")
    assert detail.json()["items"][0]["created_at"].endswith("Z")
    assert detail.json()["items"][0]["updated_at"].endswith("Z")
    assert "raw_header_text" in detail.json()
    assert "confidence_by_field" in detail.json()
    assert original.status_code == corrected.status_code == 200
    engine.dispose()


def test_batch_extraction_isolates_failures_and_does_not_reextract_completed(
    tmp_path: Path, monkeypatch
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    calls = []

    def first_pass(**kwargs):
        calls.append(kwargs["image_path"])
        if len(calls) == 2:
            raise AIExtractionError("temporary")
        return parsed_invoice()

    monkeypatch.setattr("app.services.extraction.parse_invoice_image", first_pass)
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        uploaded = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[
                ("files", ("one.png", image_bytes(), "image/png")),
                ("files", ("two.jpg", image_bytes("JPEG"), "image/jpeg")),
            ],
        ).json()
        extracted = client.post(f"/api/jobs/{job_id}/extract")
        first_detail = client.get(f"/api/documents/{uploaded[0]['id']}")
        manual = client.post(
            f"/api/documents/{uploaded[1]['id']}/items",
            json={"product_name": "보존할 수기 품목", "quantity": 1},
        )

        monkeypatch.setattr(
            "app.services.extraction.parse_invoice_image",
            lambda **_: parsed_invoice("재시도 상품"),
        )
        retried = client.post(f"/api/documents/{uploaded[1]['id']}/extract")
        retried_detail = client.get(f"/api/documents/{uploaded[1]['id']}")
        blocked_retry = client.post(f"/api/documents/{uploaded[0]['id']}/extract")

        monkeypatch.setattr(
            "app.services.extraction.parse_invoice_image",
            lambda **_: (_ for _ in ()).throw(AssertionError("재추출됨")),
        )
        repeated_batch = client.post(f"/api/jobs/{job_id}/extract")
        job = client.get(f"/api/jobs/{job_id}")

    assert extracted.status_code == 200
    assert [document["status"] for document in extracted.json()] == [
        "completed",
        "failed",
    ]
    item = first_detail.json()["items"][0]
    assert item["ocr_product_name"] == item["product_name"] == "추출 상품"
    assert item["stock_increment"] == item["quantity"] == 2
    assert item["match_score"] == 1.0
    assert item["review_status"] == "approved"
    assert retried.json()["status"] == "completed"
    assert manual.status_code == 201
    assert [
        (item["product_name"], item["source_row_order"])
        for item in retried_detail.json()["items"]
    ] == [
        ("재시도 상품", 0),
        ("보존할 수기 품목", 1),
    ]
    assert blocked_retry.status_code == 409
    assert [document["status"] for document in repeated_batch.json()] == [
        "completed",
        "completed",
    ]
    assert job.json()["status"] == "reviewing"
    with session_factory() as session:
        assert len(session.scalars(select(Item)).all()) == 3
        persisted_job = session.get(Job, job_id)
        assert persisted_job.status.value == "reviewing"
        assert persisted_job.extraction_attempt_id is None
    engine.dispose()


def test_extracting_job_rejects_all_mutations_and_duplicate_extraction(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        document = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[("files", ("invoice.png", image_bytes(), "image/png"))],
        ).json()[0]
        item = client.post(
            f"/api/documents/{document['id']}/items",
            json={"product_code_or_barcode": "0001", "product_name": "상품", "quantity": 1},
        ).json()
        with session_factory() as session:
            job = session.get(Job, job_id)
            job.status = JobStatus.EXTRACTING
            job.extraction_attempt_id = "active-attempt"
            session.commit()

        responses = [
            client.post(
                f"/api/jobs/{job_id}/excel",
                files={"file": ("replacement.xlsx", workbook_bytes())},
            ),
            client.post(
                f"/api/jobs/{job_id}/documents",
                files=[("files", ("other.png", image_bytes(), "image/png"))],
            ),
            client.patch(
                f"/api/documents/{document['id']}",
                json={"invoice_number": "변경"},
            ),
            client.delete(f"/api/documents/{document['id']}"),
            client.post(
                f"/api/documents/{document['id']}/items",
                json={"product_name": "추가 품목", "quantity": 1},
            ),
            client.patch(f"/api/items/{item['id']}", json={"notes": "변경"}),
            client.patch(
                f"/api/jobs/{job_id}/items/bulk",
                json={"item_ids": [item["id"]], "apply_inventory": False},
            ),
            client.post(f"/api/jobs/{job_id}/match"),
            client.put(
                f"/api/items/{item['id']}/match",
                json={"product_code": "0001"},
            ),
            client.delete(f"/api/items/{item['id']}/match"),
            client.post(f"/api/jobs/{job_id}/extract"),
            client.post(f"/api/documents/{document['id']}/extract"),
        ]

    assert all(response.status_code == 409 for response in responses)
    with session_factory() as session:
        persisted_job = session.get(Job, job_id)
        persisted_item = session.get(Item, item["id"])
        assert persisted_job.status == JobStatus.EXTRACTING
        assert persisted_job.extraction_attempt_id == "active-attempt"
        assert persisted_item.notes is None
        assert session.scalars(
            select(Document).where(Document.job_id == job_id)
        ).all() == [session.get(Document, document["id"])]
    engine.dispose()


def test_stale_extraction_cannot_store_or_finish_newer_attempt(
    tmp_path: Path, monkeypatch
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        document_id = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[("files", ("invoice.png", image_bytes(), "image/png"))],
        ).json()[0]["id"]

    started = Event()
    release = Event()
    outcome: dict[str, object] = {}

    def delayed_parse(**_):
        started.set()
        assert release.wait(timeout=5)
        return parsed_invoice("저장되면 안 되는 품목")

    monkeypatch.setattr("app.services.extraction.parse_invoice_image", delayed_parse)
    settings = Settings(
        data_dir=tmp_path / "data",
        database_url=f"sqlite:///{tmp_path / 'documents.db'}",
        openai_api_key="test-key",
        openai_model="gpt-test",
    )

    def run_old_attempt() -> None:
        with session_factory() as session:
            try:
                extract_job_documents(session, session.get(Job, job_id), settings)
            except Exception as exc:  # 테스트에서 예외 종류를 검증합니다.
                outcome["error"] = exc

    thread = Thread(target=run_old_attempt)
    thread.start()
    assert started.wait(timeout=5)
    with session_factory() as session:
        with pytest.raises(ExtractionOperationError):
            extract_job_documents(session, session.get(Job, job_id), settings)
    with session_factory() as session:
        job = session.get(Job, job_id)
        job.extraction_attempt_id = "newer-attempt"
        session.commit()
    release.set()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert isinstance(outcome.get("error"), ExtractionOperationError)
    with session_factory() as session:
        job = session.get(Job, job_id)
        document = session.get(Document, document_id)
        assert job.status == JobStatus.EXTRACTING
        assert job.extraction_attempt_id == "newer-attempt"
        assert document.status.value == "processing"
        assert session.scalars(
            select(Item).where(Item.document_id == document_id)
        ).all() == []
    engine.dispose()


def test_startup_recovers_interrupted_extraction(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with session_factory() as session:
        job = Job(
            status="extracting",
            original_excel_path="products.xlsx",
            extraction_attempt_id="interrupted-attempt",
        )
        session.add(job)
        session.flush()
        document = Document(
            job_id=job.id,
            source_order=0,
            original_image_path="invoice.png",
            original_image_name="invoice.png",
            image_sha256="a" * 64,
            status="processing",
        )
        session.add(document)
        session.commit()
        job_id = job.id
        document_id = document.id

    with client:
        recovered = client.get(f"/api/documents/{document_id}")

    assert recovered.status_code == 200
    assert recovered.json()["status"] == "failed"
    assert "중단" in recovered.json()["processing_error"]
    with session_factory() as session:
        recovered_job = session.get(Job, job_id)
        assert recovered_job.status.value == "reviewing"
        assert recovered_job.extraction_attempt_id is None
    engine.dispose()


def test_missing_api_key_marks_document_failed_and_continues(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(
        tmp_path, with_api_key=False
    )
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        client.post(
            f"/api/jobs/{job_id}/documents",
                files=[
                    ("files", ("one.png", image_bytes(), "image/png")),
                    ("files", ("two.jpg", image_bytes("JPEG"), "image/jpeg")),
                ],
        )
        extracted = client.post(f"/api/jobs/{job_id}/extract")
        job = client.get(f"/api/jobs/{job_id}")

    assert extracted.status_code == 200
    assert [document["status"] for document in extracted.json()] == [
        "failed",
        "failed",
    ]
    assert all(
        document["processing_error"].startswith("OPENAI_API_KEY")
        for document in extracted.json()
    )
    assert job.json()["status"] == "reviewing"
    with session_factory() as session:
        assert session.get(Job, job_id).extraction_attempt_id is None
    engine.dispose()
