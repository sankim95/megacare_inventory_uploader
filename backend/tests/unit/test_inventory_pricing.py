from datetime import date

from app.models import ResolutionMethod, ReviewStatus
from app.services.inventory import sum_inventory_increment
from app.services.pricing import PriceCandidateInput, resolve_price


class StockRow:
    def __init__(self, status, apply_inventory, stock_increment):
        self.review_status = status
        self.apply_inventory = apply_inventory
        self.stock_increment = stock_increment


def test_inventory_only_sums_approved_and_checked_rows() -> None:
    rows = [
        StockRow(ReviewStatus.APPROVED, True, 2),
        StockRow(ReviewStatus.APPROVED, True, 3),
        StockRow(ReviewStatus.APPROVED, False, 4),
        StockRow(ReviewStatus.PENDING, True, 9),
        StockRow(ReviewStatus.EXCLUDED, True, 11),
    ]

    assert sum_inventory_increment(rows) == 5
    assert 10 + sum_inventory_increment(rows) == 15


def test_price_toggle_controls_final_purchase_price() -> None:
    candidate = PriceCandidateInput("item-1", date(2026, 8, 1), 18_000)

    unchecked = resolve_price([])
    checked = resolve_price([candidate])

    assert unchecked.method is None
    assert unchecked.selected_unit_price is None
    assert checked.method == ResolutionMethod.AUTOMATIC
    assert checked.selected_unit_price == 18_000


def test_latest_price_is_automatic_but_latest_same_day_conflict_is_manual() -> None:
    candidates = [
        PriceCandidateInput("old", date(2026, 8, 1), 10_000),
        PriceCandidateInput("latest-a", date(2026, 8, 3), 11_000),
        PriceCandidateInput("latest-b", date(2026, 8, 3), 12_000),
    ]

    unresolved = resolve_price(candidates)
    stale_selection = resolve_price(candidates, manual_selected_item_id="old")
    resolved = resolve_price(candidates, manual_selected_item_id="latest-b")

    assert unresolved.method == ResolutionMethod.UNRESOLVED
    assert unresolved.selected_unit_price is None
    assert stale_selection.method == ResolutionMethod.UNRESOLVED
    assert resolved.method == ResolutionMethod.MANUAL
    assert resolved.selected_item_id == "latest-b"
    assert resolved.selected_unit_price == 12_000


def test_missing_date_conflicts_but_equal_prices_are_automatic() -> None:
    conflict = resolve_price(
        [
            PriceCandidateInput("dated", date(2026, 8, 3), 11_000),
            PriceCandidateInput("undated", None, 12_000),
        ]
    )
    equal = resolve_price(
        [
            PriceCandidateInput("dated", date(2026, 8, 3), 11_000),
            PriceCandidateInput("undated", None, 11_000),
        ]
    )

    assert conflict.method == ResolutionMethod.UNRESOLVED
    assert equal.method == ResolutionMethod.AUTOMATIC
    assert equal.selected_unit_price == 11_000
