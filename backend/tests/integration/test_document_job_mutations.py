from datetime import date
from pathlib import Path

from sqlalchemy import func, select

from app.models import Document, Item, Job, ProductIndex
from tests.integration.test_documents import (
    build_test_client,
    create_job,
    image_bytes,
    upload_excel,
)
from tests.integration.test_exports import (
    add_completed_document,
    complete_document,
)
from tests.integration.test_jobs import workbook_bytes as replacement_workbook_bytes
from tests.integration.test_review_workflow import add_item


def test_delete_document_cascades_files_and_recalculates_same_job_duplicate(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    content = image_bytes()
    with client:
        job_id = create_job(client)
        uploaded = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[
                ("files", ("original.png", content, "image/png")),
                ("files", ("duplicate.png", content, "image/png")),
            ],
        )
        first, duplicate = uploaded.json()
        item = client.post(
            f"/api/documents/{first['id']}/items",
            json={"product_name": "삭제될 품목", "quantity": 1},
        )
        with session_factory() as session:
            first_row = session.get(Document, first["id"])
            duplicate_row = session.get(Document, duplicate["id"])
            original_path = Path(first_row.original_image_path)
            corrected_path = (
                Path(first_row.corrected_image_path)
                if first_row.corrected_image_path
                else None
            )
            duplicate_path = Path(duplicate_row.original_image_path)

        deleted = client.delete(f"/api/documents/{first['id']}")
        remaining = client.get(f"/api/jobs/{job_id}/documents")

    assert uploaded.status_code == 200
    assert duplicate["duplicate_status"] == "confirmed"
    assert item.status_code == 201
    assert original_path.is_file() is False
    if corrected_path is not None:
        assert corrected_path.is_file() is False
    assert duplicate_path.is_file() is True
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert len(remaining.json()) == 1
    assert remaining.json()[0]["id"] == duplicate["id"]
    assert remaining.json()[0]["duplicate_status"] == "none"
    with session_factory() as session:
        assert session.get(Document, first["id"]) is None
        assert session.get(Item, item.json()["id"]) is None
    engine.dispose()


def test_document_date_update_recalculates_price_and_duplicate_status(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        first_document_id = add_completed_document(
            session_factory, tmp_path, job_id, 0, date(2026, 8, 1)
        )
        second_document_id = add_completed_document(
            session_factory, tmp_path, job_id, 1, date(2026, 8, 3)
        )
        metadata = client.patch(
            f"/api/documents/{second_document_id}",
            json={"invoice_number": "INV-0", "document_total": 5000},
        )
        first_item = add_item(
            client, first_document_id, stock_increment=1, unit_price=1100
        )
        second_item = add_item(
            client, second_document_id, stock_increment=1, unit_price=1200
        )
        for item in (first_item, second_item):
            approved = client.patch(
                f"/api/items/{item['id']}",
                json={"review_status": "approved"},
            )
            assert approved.status_code == 200

        explicit_null = client.patch(
            f"/api/documents/{second_document_id}",
            json={"invoice_number": None},
        )
        warnings_before = client.get(f"/api/jobs/{job_id}/items")
        first_metadata = client.patch(
            f"/api/documents/{first_document_id}",
            json={"photo_supplier": "공급사", "document_total": 1100},
        )
        before = client.get(f"/api/jobs/{job_id}/review-summary")
        updated = client.patch(
            f"/api/documents/{second_document_id}",
            json={
                "photo_supplier": "공급사",
                "transaction_date": "2026-08-01",
                "invoice_number": "INV-0",
                "document_total": 1200,
            },
        )
        warnings_after = client.get(f"/api/jobs/{job_id}/items")
        after = client.get(f"/api/jobs/{job_id}/review-summary")

    assert metadata.status_code == 200
    assert metadata.json()["document_total"] == 5000
    assert before.status_code == 200
    assert before.json()["ready_to_export"] is True
    assert before.json()["products"][0]["price_resolution_method"] == "automatic"
    assert before.json()["products"][0]["final_purchase_price"] == 1200

    assert explicit_null.status_code == 200
    assert explicit_null.json()["invoice_number"] is None
    assert first_metadata.status_code == 200
    before_item = next(
        row for row in warnings_before.json() if row["id"] == second_item["id"]
    )
    before_warning_codes = {
        warning["code"] for warning in before_item["warnings"]
    }
    assert {
        "missing_document_info",
        "supplier_mismatch",
        "document_total_mismatch",
    } <= before_warning_codes
    assert updated.status_code == 200
    assert updated.json()["transaction_date"] == "2026-08-01"
    assert updated.json()["document_total"] == 1200
    assert updated.json()["duplicate_status"] == "confirmed"
    after_item = next(
        row for row in warnings_after.json() if row["id"] == second_item["id"]
    )
    after_warning_codes = {
        warning["code"] for warning in after_item["warnings"]
    }
    assert not {
        "missing_document_info",
        "supplier_mismatch",
        "document_total_mismatch",
    }.intersection(after_warning_codes)
    blocker_codes = {blocker["code"] for blocker in after.json()["blockers"]}
    assert {"CONFIRMED_DUPLICATE", "UNRESOLVED_PRICE"} <= blocker_codes
    assert after.json()["products"][0]["price_resolution_method"] == "unresolved"
    assert after.json()["products"][0]["final_purchase_price"] is None
    engine.dispose()


def test_completed_job_clone_is_independent_and_preserves_source(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        source_job_id = create_job(client)
        upload_excel(client, source_job_id)
        document = client.post(
            f"/api/jobs/{source_job_id}/documents",
            files=[("files", ("invoice.png", image_bytes(), "image/png"))],
        ).json()[0]
        complete_document(session_factory, document["id"], date(2026, 8, 3))
        item = add_item(
            client, document["id"], stock_increment=2, unit_price=1200
        )
        approved = client.patch(
            f"/api/items/{item['id']}",
            json={"review_status": "approved"},
        )
        exported = client.post(
            f"/api/jobs/{source_job_id}/export",
            json={"approved_by": "원본 승인자"},
        )
        with session_factory() as session:
            source_job = session.get(Job, source_job_id)
            source_excel_path = Path(source_job.original_excel_path)
            source_excel_bytes = source_excel_path.read_bytes()
            source_result_path = Path(source_job.result_path)
            source_product_ids = set(
                session.scalars(
                    select(ProductIndex.id).where(
                        ProductIndex.job_id == source_job_id
                    )
                ).all()
            )

        cloned = client.post(f"/api/jobs/{source_job_id}/clone")
        clone_job_id = cloned.json()["id"]
        clone_documents = client.get(f"/api/jobs/{clone_job_id}/documents")
        clone_items = client.get(f"/api/jobs/{clone_job_id}/items")
        blocked_update = client.patch(
            f"/api/documents/{document['id']}",
            json={"invoice_number": "수정 시도"},
        )
        blocked_delete = client.delete(f"/api/documents/{document['id']}")
        replaced_clone = client.post(
            f"/api/jobs/{clone_job_id}/excel",
            files={
                "file": (
                    "clone-products.xlsx",
                    replacement_workbook_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        source_after = client.get(f"/api/jobs/{source_job_id}")
        source_result = client.get(f"/api/jobs/{source_job_id}/result")

    assert approved.status_code == 200
    assert exported.status_code == 200
    assert cloned.status_code == 201
    assert cloned.json()["status"] == "draft"
    assert cloned.json()["product_count"] == 1
    assert cloned.json()["approved_by"] is None
    assert cloned.json()["result_path"] is None
    assert cloned.json()["completed_at"] is None
    assert clone_documents.json() == []
    assert clone_items.json() == []
    assert blocked_update.status_code == 409
    assert blocked_delete.status_code == 409
    assert replaced_clone.status_code == 200
    assert replaced_clone.json()["product_count"] == 2
    assert source_after.json()["status"] == "completed"
    assert source_after.json()["product_count"] == 1
    assert source_after.json()["approved_by"] == "원본 승인자"
    assert source_result.status_code == 200

    with session_factory() as session:
        source_job = session.get(Job, source_job_id)
        clone_job = session.get(Job, clone_job_id)
        clone_product_ids = set(
            session.scalars(
                select(ProductIndex.id).where(
                    ProductIndex.job_id == clone_job_id
                )
            ).all()
        )
        assert Path(source_job.original_excel_path) == source_excel_path
        assert source_excel_path.read_bytes() == source_excel_bytes
        assert Path(source_job.result_path) == source_result_path
        assert source_result_path.is_file()
        assert clone_job.original_excel_path != source_job.original_excel_path
        assert clone_product_ids.isdisjoint(source_product_ids)
        assert session.scalar(
            select(func.count(Document.id)).where(Document.job_id == clone_job_id)
        ) == 0
    engine.dispose()


def test_clone_rejects_missing_and_changed_original_excel(tmp_path: Path) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        no_excel_job_id = create_job(client)
        no_excel = client.post(f"/api/jobs/{no_excel_job_id}/clone")

        missing_job_id = create_job(client)
        upload_excel(client, missing_job_id)
        changed_job_id = create_job(client)
        upload_excel(client, changed_job_id)
        with session_factory() as session:
            missing_path = Path(session.get(Job, missing_job_id).original_excel_path)
            changed_path = Path(session.get(Job, changed_job_id).original_excel_path)
        missing_path.unlink()
        changed_path.write_bytes(changed_path.read_bytes() + b"changed")

        missing = client.post(f"/api/jobs/{missing_job_id}/clone")
        changed = client.post(f"/api/jobs/{changed_job_id}/clone")

    assert no_excel.status_code == 409
    assert "원본 Excel 정보" in no_excel.json()["detail"]
    assert missing.status_code == 409
    assert "찾을 수 없습니다" in missing.json()["detail"]
    assert changed.status_code == 409
    assert "변경" in changed.json()["detail"]
    with session_factory() as session:
        assert session.scalar(select(func.count(Job.id))) == 3
    engine.dispose()
