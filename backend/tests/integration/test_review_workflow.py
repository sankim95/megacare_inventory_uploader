from pathlib import Path
from typing import Optional

from fastapi.testclient import TestClient

from app.models import Job, JobStatus
from tests.integration.test_documents import (
    build_test_client,
    create_job,
    image_bytes,
    upload_excel,
)


def add_item(
    client: TestClient,
    document_id: str,
    *,
    matched: bool = True,
    stock_increment: Optional[int] = 1,
    unit_price: Optional[int] = 1300,
) -> dict:
    payload = {
        "product_name": "상품" if matched else "일치하지 않는 이름",
        "quantity": 1,
        "unit_price": unit_price,
        "amount": unit_price,
        "stock_increment": stock_increment,
    }
    if matched:
        payload["product_code_or_barcode"] = "0001"
    return client.post(
        f"/api/documents/{document_id}/items", json=payload
    ).json()


def prepare_document(client: TestClient, job_id: str) -> str:
    upload_excel(client, job_id)
    return client.post(
        f"/api/jobs/{job_id}/documents",
        files=[("files", ("invoice.png", image_bytes(), "image/png"))],
    ).json()[0]["id"]


def test_list_items_is_in_document_and_row_order(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        upload_excel(client, job_id)
        documents = client.post(
            f"/api/jobs/{job_id}/documents",
            files=[
                ("files", ("first.png", image_bytes(), "image/png")),
                ("files", ("second.jpg", image_bytes("JPEG"), "image/jpeg")),
            ],
        ).json()
        second_item = add_item(client, documents[1]["id"])
        first_item_a = add_item(client, documents[0]["id"])
        first_item_b = add_item(client, documents[0]["id"])
        response = client.get(f"/api/jobs/{job_id}/items")

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [
        first_item_a["id"],
        first_item_b["id"],
        second_item["id"],
    ]
    assert "exclusion_reason" in response.json()[0]
    engine.dispose()


def test_status_and_checkboxes_are_independent_and_persist(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        item = add_item(client, document_id, stock_increment=0)

        unchecked = client.patch(
            f"/api/items/{item['id']}",
            json={"apply_inventory": False, "apply_purchase_price": False},
        )
        approved = client.patch(
            f"/api/items/{item['id']}",
            json={"review_status": "approved", "notes": "확인 완료"},
        )
        pending = client.patch(
            f"/api/items/{item['id']}", json={"review_status": "pending"}
        )

    assert unchecked.status_code == approved.status_code == pending.status_code == 200
    assert approved.json()["stock_increment"] == 0
    assert pending.json()["apply_inventory"] is False
    assert pending.json()["apply_purchase_price"] is False
    assert pending.json()["notes"] == "확인 완료"
    engine.dispose()


def test_approval_exclusion_and_purchase_price_rules_return_409(
    tmp_path: Path,
) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        unmatched = add_item(client, document_id, matched=False)
        matched = add_item(client, document_id, matched=True)

        unmatched_approval = client.patch(
            f"/api/items/{unmatched['id']}", json={"review_status": "approved"}
        )
        missing_reason = client.patch(
            f"/api/items/{unmatched['id']}", json={"review_status": "excluded"}
        )
        blank_reason = client.patch(
            f"/api/items/{unmatched['id']}",
            json={"review_status": "excluded", "exclusion_reason": "   "},
        )
        excluded = client.patch(
            f"/api/items/{unmatched['id']}",
            json={"review_status": "excluded", "exclusion_reason": "상품 없음"},
        )
        invalid_price_apply = client.patch(
            f"/api/items/{unmatched['id']}", json={"apply_purchase_price": True}
        )
        cleared_price = client.patch(
            f"/api/items/{matched['id']}", json={"unit_price": None}
        )

    assert unmatched_approval.status_code == 409
    assert missing_reason.status_code == 409
    assert blank_reason.status_code == 409
    assert excluded.status_code == 200
    assert excluded.json()["exclusion_reason"] == "상품 없음"
    assert invalid_price_apply.status_code == 409
    assert cleared_price.status_code == 200
    assert cleared_price.json()["apply_purchase_price"] is False
    engine.dispose()


def test_manual_purchase_price_choice_survives_unrelated_edits(tmp_path: Path) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        item = add_item(client, document_id)
        assert item["apply_purchase_price"] is True

        unchecked = client.patch(
            f"/api/items/{item['id']}", json={"apply_purchase_price": False}
        )
        noted = client.patch(
            f"/api/items/{item['id']}", json={"notes": "단가 미반영"}
        )
        approved = client.patch(
            f"/api/items/{item['id']}", json={"review_status": "approved"}
        )

    assert unchecked.json()["apply_purchase_price"] is False
    assert noted.json()["apply_purchase_price"] is False
    assert approved.json()["apply_purchase_price"] is False
    engine.dispose()


def test_unit_price_edit_recomputes_default_unless_checkbox_is_explicit(
    tmp_path: Path,
) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        item = add_item(client, document_id, unit_price=1000)
        higher = client.patch(
            f"/api/items/{item['id']}", json={"unit_price": 1200}
        )
        equal = client.patch(
            f"/api/items/{item['id']}", json={"unit_price": 1000}
        )
        explicit = client.patch(
            f"/api/items/{item['id']}",
            json={"unit_price": 1200, "apply_purchase_price": False},
        )

    assert item["apply_purchase_price"] is False
    assert higher.status_code == equal.status_code == explicit.status_code == 200
    assert higher.json()["apply_purchase_price"] is True
    assert equal.json()["apply_purchase_price"] is False
    assert explicit.json()["apply_purchase_price"] is False
    engine.dispose()


def test_approved_item_breaking_edit_rolls_back_without_status_change(
    tmp_path: Path,
) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        item = add_item(client, document_id)
        approved = client.patch(
            f"/api/items/{item['id']}", json={"review_status": "approved"}
        )
        broken = client.patch(
            f"/api/items/{item['id']}",
            json={
                "product_code_or_barcode": None,
                "product_name": "매칭 불가능",
                "specification": None,
            },
        )
        cleared = client.delete(f"/api/items/{item['id']}/match")
        persisted = client.get(f"/api/jobs/{job_id}/items").json()[0]

    assert approved.status_code == 200
    assert broken.status_code == 409
    assert cleared.status_code == 409
    assert persisted["review_status"] == "approved"
    assert persisted["matched_product_code"] == "0001"
    assert persisted["product_name"] == "상품"
    engine.dispose()


def test_bulk_target_status_and_item_ids_are_job_wide_and_atomic(
    tmp_path: Path,
) -> None:
    client, _, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        first = add_item(client, document_id)
        second = add_item(client, document_id)
        excluded = add_item(client, document_id, matched=False)
        unmatched = add_item(client, document_id, matched=False)
        for item_id in (first["id"], second["id"]):
            client.patch(
                f"/api/items/{item_id}", json={"review_status": "approved"}
            )
        client.patch(
            f"/api/items/{excluded['id']}",
            json={"review_status": "excluded", "exclusion_reason": "제외"},
        )

        target_bulk = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "target_review_status": "approved",
                "apply_inventory": False,
            },
        )
        one_checked = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "item_ids": [first["id"]],
                "apply_inventory": True,
            },
        )
        atomic_failure = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "item_ids": [second["id"], unmatched["id"]],
                "review_status": "approved",
            },
        )
        all_items = client.get(f"/api/jobs/{job_id}/items").json()

    assert target_bulk.status_code == 200
    assert {row["id"] for row in target_bulk.json()} == {first["id"], second["id"]}
    assert all(row["apply_inventory"] is False for row in target_bulk.json())
    assert one_checked.status_code == 200
    assert atomic_failure.status_code == 409
    by_id = {row["id"]: row for row in all_items}
    assert by_id[first["id"]]["apply_inventory"] is True
    assert by_id[second["id"]]["apply_inventory"] is False
    assert by_id[second["id"]]["review_status"] == "approved"
    assert by_id[unmatched["id"]]["review_status"] == "pending"
    assert by_id[excluded["id"]]["apply_inventory"] is True
    engine.dispose()


def test_bulk_selector_validation_wrong_job_and_completed_mutations(
    tmp_path: Path,
) -> None:
    client, session_factory, engine = build_test_client(tmp_path)
    with client:
        job_id = create_job(client)
        document_id = prepare_document(client, job_id)
        item = add_item(client, document_id)
        other_job_id = create_job(client)
        other_document_id = prepare_document(client, other_job_id)
        other = add_item(client, other_document_id)

        both_selectors = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "item_ids": [item["id"]],
                "target_review_status": "pending",
                "apply_inventory": False,
            },
        )
        wrong_job = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "item_ids": [item["id"], other["id"]],
                "apply_inventory": False,
            },
        )
        with session_factory() as session:
            session.get(Job, job_id).status = JobStatus.COMPLETED
            session.commit()
        single_completed = client.patch(
            f"/api/items/{item['id']}", json={"notes": "변경 시도"}
        )
        bulk_completed = client.patch(
            f"/api/jobs/{job_id}/items/bulk",
            json={
                "target_review_status": "pending",
                "apply_inventory": False,
            },
        )

    assert both_selectors.status_code == 422
    assert wrong_job.status_code == 409
    assert single_completed.status_code == 409
    assert bulk_completed.status_code == 409
    engine.dispose()


def test_review_values_survive_app_and_session_recreation(tmp_path: Path) -> None:
    first_client, _, first_engine = build_test_client(tmp_path)
    with first_client:
        job_id = create_job(first_client)
        document_id = prepare_document(first_client, job_id)
        item = add_item(first_client, document_id)
        saved = first_client.patch(
            f"/api/items/{item['id']}",
            json={
                "review_status": "approved",
                "apply_inventory": False,
                "apply_purchase_price": False,
                "notes": "재시작 후 유지",
            },
        )
        assert saved.status_code == 200
    first_engine.dispose()

    second_client, _, second_engine = build_test_client(tmp_path)
    with second_client:
        restored = second_client.get(f"/api/jobs/{job_id}/items").json()[0]

    assert restored["review_status"] == "approved"
    assert restored["apply_inventory"] is False
    assert restored["apply_purchase_price"] is False
    assert restored["notes"] == "재시작 후 유지"
    second_engine.dispose()
