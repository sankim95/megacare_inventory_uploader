from pathlib import Path

from fastapi.testclient import TestClient
from app.models import CompletedDocument, Document, Job, JobStatus, ProductIndex
from sqlalchemy import select
from tests.integration.test_documents import (
    build_test_client,
    create_job,
    image_bytes,
    upload_excel,
)


def prepare_item(client: TestClient, job_id: str) -> tuple[str, str]:
    upload_excel(client, job_id)
    uploaded = client.post(
        f"/api/jobs/{job_id}/documents",
        files=[("files", ("invoice.png", image_bytes(), "image/png"))],
    ).json()[0]
    item = client.post(
        f"/api/documents/{uploaded['id']}/items",
        json={
            "product_name": "찾지 못한 상품",
            "quantity": 1,
            "unit_price": 1300,
            "amount": 1300,
        },
    ).json()
    return uploaded["id"], item["id"]


def test_search_manual_clear_and_batch_rematch_api(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        _, item_id = prepare_item(client, job_id)

        search = client.get(
            f"/api/jobs/{job_id}/products/search",
            params={"query": "상품", "limit": 5},
        )
        manual = client.put(
            f"/api/items/{item_id}/match", json={"product_code": "0001"}
        )
        cleared = client.delete(f"/api/items/{item_id}/match")
        patched = client.patch(
            f"/api/items/{item_id}", json={"product_code_or_barcode": "0001"}
        )
        batch = client.post(f"/api/jobs/{job_id}/match")

    assert search.status_code == 200
    assert len(search.json()) <= 5
    assert search.json()[0]["product_code"] == "0001"
    assert manual.status_code == 200
    assert manual.json()["match_method"] == "manual"
    assert manual.json()["matched_supplier"] == "공급사"
    assert manual.json()["base_stock"] == 0
    assert manual.json()["base_purchase_price"] == 1000
    assert manual.json()["apply_purchase_price"] is True
    assert manual.json()["review_status"] == "pending"
    assert cleared.json()["matched_product_code"] is None
    assert cleared.json()["apply_purchase_price"] is False
    assert patched.json()["matched_product_code"] == "0001"
    assert patched.json()["match_method"] == "code"
    assert batch.status_code == 200
    assert batch.json()[0]["matched_product_code"] == "0001"
    assert isinstance(batch.json()[0]["match_candidates"], list)
    engine.dispose()


def test_manual_match_can_approve_without_changing_inventory_choice(
    tmp_path: Path,
) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        _, item_id = prepare_item(client, job_id)
        invalid_stock = client.patch(
            f"/api/items/{item_id}", json={"stock_increment": None}
        )
        pending_match = client.put(
            f"/api/items/{item_id}/match",
            json={"product_code": "0001", "approve": True},
        )
        prepared = client.patch(
            f"/api/items/{item_id}",
            json={"stock_increment": 1, "apply_inventory": False},
        )
        matched = client.put(
            f"/api/items/{item_id}/match",
            json={"product_code": "0001", "approve": True},
        )

    assert invalid_stock.status_code == 200
    assert pending_match.status_code == 200
    assert pending_match.json()["matched_product_code"] == "0001"
    assert pending_match.json()["review_status"] == "pending"
    assert prepared.status_code == 200
    assert matched.status_code == 200
    assert matched.json()["matched_product_code"] == "0001"
    assert matched.json()["match_method"] == "manual"
    assert matched.json()["review_status"] == "approved"
    assert matched.json()["apply_inventory"] is False
    engine.dispose()


def test_unmatched_item_can_register_and_match_new_product(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        _, item_id = prepare_item(client, job_id)
        registered = client.post(
            f"/api/items/{item_id}/register-product",
            json={
                "product_code": "NEW-001",
                "product_name": "신규 입고 상품",
                "specification": "30정",
                "current_stock": 4,
                "purchase_price": 1300,
                "supplier_code": "SUP-N",
                "supplier": "신규 공급사",
            },
        )

    assert registered.status_code == 200
    assert registered.json()["matched_product_code"] == "NEW-001"
    assert registered.json()["matched_product_name"] == "신규 입고 상품"
    assert registered.json()["base_stock"] == 4
    assert registered.json()["review_status"] == "approved"
    with session_factory() as session:
        product = session.scalar(
            select(ProductIndex).where(
                ProductIndex.job_id == job_id,
                ProductIndex.product_code == "NEW-001",
            )
        )
        assert product is not None
        assert product.is_user_created is True
        assert product.excel_row == 3
    engine.dispose()


def test_register_product_rejects_existing_product_code(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        _, item_id = prepare_item(client, job_id)
        response = client.post(
            f"/api/items/{item_id}/register-product",
            json={
                "product_code": "0001",
                "product_name": "중복 상품",
                "current_stock": 0,
            },
        )

    assert response.status_code == 409
    assert "이미 상품리스트에 있습니다" in response.json()["detail"]
    engine.dispose()


def test_completed_job_match_mutations_return_conflict(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        _, item_id = prepare_item(client, job_id)
        with session_factory() as session:
            session.get(Job, job_id).status = JobStatus.COMPLETED
            session.commit()

        batch = client.post(f"/api/jobs/{job_id}/match")
        manual = client.put(
            f"/api/items/{item_id}/match", json={"product_code": "0001"}
        )
        cleared = client.delete(f"/api/items/{item_id}/match")
        edited = client.patch(f"/api/items/{item_id}", json={"quantity": 2})

    assert batch.status_code == 409
    assert manual.status_code == 409
    assert cleared.status_code == 409
    assert edited.status_code == 409
    engine.dispose()


def test_current_and_completed_image_hash_duplicates_are_blocked(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    content = image_bytes()
    with client:
        current_job_id = create_job(client)
        current = client.post(
            f"/api/jobs/{current_job_id}/documents",
            files=[
                ("files", ("first.png", content, "image/png")),
                ("files", ("renamed-current.png", content, "image/png")),
            ],
        ).json()

        source_job_id = create_job(client)
        source = client.post(
            f"/api/jobs/{source_job_id}/documents",
            files=[("files", ("source.png", image_bytes("JPEG"), "image/jpeg"))],
        ).json()[0]
        with session_factory() as session:
            source_document = session.get(Document, source["id"])
            session.add(
                CompletedDocument(
                    job_id=source_job_id,
                    source_document_id=source_document.id,
                    image_sha256=source_document.image_sha256,
                )
            )
            session.commit()

        reupload_job_id = create_job(client)
        completed_reupload = client.post(
            f"/api/jobs/{reupload_job_id}/documents",
            files=[
                (
                    "files",
                    ("completely-different-name.jpg", image_bytes("JPEG"), "image/jpeg"),
                )
            ],
        ).json()[0]

    assert current[0]["status"] == "pending"
    assert current[0]["duplicate_status"] == "none"
    assert current[1]["status"] == "failed"
    assert current[1]["duplicate_status"] == "confirmed"
    assert "동일 이미지" in current[1]["processing_error"]
    assert completed_reupload["status"] == "failed"
    assert completed_reupload["duplicate_status"] == "confirmed"
    engine.dispose()
