from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Item, Job, ReviewStatus
from app.services.job_mutations import lock_job_for_mutation


class ItemRuleError(ValueError):
    pass


def ensure_job_mutable(db: Session, job: Job) -> None:
    if not lock_job_for_mutation(db, job.id):
        raise ItemRuleError(
            "추출·내보내기 중이거나 완료된 작업은 변경할 수 없습니다."
        )


def validate_item_state(
    item: Item, *, explicit_purchase_price: bool = False
) -> None:
    if item.unit_price is None:
        if explicit_purchase_price and item.apply_purchase_price:
            raise ItemRuleError(
                "사진 단가가 없는 품목은 매입단가를 반영할 수 없습니다."
            )
        item.apply_purchase_price = False

    if item.apply_purchase_price and (
        item.matched_product_code is None
        or item.unit_price is None
        or isinstance(item.unit_price, bool)
        or not isinstance(item.unit_price, int)
        or item.unit_price < 0
    ):
        raise ItemRuleError(
            "매칭 상품과 유효한 사진 단가가 있어야 매입단가를 반영할 수 있습니다."
        )

    if item.review_status == ReviewStatus.APPROVED and (
        item.matched_product_code is None
        or item.stock_increment is None
        or isinstance(item.stock_increment, bool)
        or not isinstance(item.stock_increment, int)
        or item.stock_increment < 0
    ):
        raise ItemRuleError(
            "승인하려면 상품 매칭과 0 이상의 입고 수량이 필요합니다."
        )

    if item.review_status == ReviewStatus.EXCLUDED:
        reason = (item.exclusion_reason or "").strip()
        if not reason:
            raise ItemRuleError("제외하려면 제외 사유를 입력해 주세요.")
        item.exclusion_reason = reason
