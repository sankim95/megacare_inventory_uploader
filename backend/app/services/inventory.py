from __future__ import annotations

from typing import Iterable, Protocol

from app.models import ReviewStatus


class InventoryRow(Protocol):
    review_status: ReviewStatus
    apply_inventory: bool
    stock_increment: int | None


def sum_inventory_increment(items: Iterable[InventoryRow]) -> int:
    return sum(
        item.stock_increment
        for item in items
        if item.review_status == ReviewStatus.APPROVED
        and item.apply_inventory
        and isinstance(item.stock_increment, int)
        and not isinstance(item.stock_increment, bool)
        and item.stock_increment >= 0
    )
