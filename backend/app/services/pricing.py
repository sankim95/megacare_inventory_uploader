from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional, Sequence

from app.models import ResolutionMethod


@dataclass(frozen=True)
class PriceCandidateInput:
    item_id: str
    transaction_date: Optional[date]
    unit_price: int


@dataclass(frozen=True)
class PriceDecision:
    method: Optional[ResolutionMethod]
    selected_item_id: Optional[str]
    selected_unit_price: Optional[int]


def resolve_price(
    candidates: Sequence[PriceCandidateInput],
    manual_selected_item_id: Optional[str] = None,
) -> PriceDecision:
    if not candidates:
        return PriceDecision(None, None, None)

    prices = {candidate.unit_price for candidate in candidates}
    if len(prices) == 1:
        selected = candidates[0]
        return PriceDecision(
            ResolutionMethod.AUTOMATIC,
            selected.item_id,
            selected.unit_price,
        )

    automatic_candidate: Optional[PriceCandidateInput] = None
    manual_candidates = list(candidates)
    if all(candidate.transaction_date is not None for candidate in candidates):
        latest_date = max(
            candidate.transaction_date for candidate in candidates
            if candidate.transaction_date is not None
        )
        latest = [
            candidate
            for candidate in candidates
            if candidate.transaction_date == latest_date
        ]
        if len({candidate.unit_price for candidate in latest}) == 1:
            automatic_candidate = latest[0]
        else:
            manual_candidates = latest

    if automatic_candidate is not None:
        return PriceDecision(
            ResolutionMethod.AUTOMATIC,
            automatic_candidate.item_id,
            automatic_candidate.unit_price,
        )

    selected = next(
        (
            candidate
            for candidate in manual_candidates
            if candidate.item_id == manual_selected_item_id
        ),
        None,
    )
    if selected is not None:
        return PriceDecision(
            ResolutionMethod.MANUAL,
            selected.item_id,
            selected.unit_price,
        )
    return PriceDecision(ResolutionMethod.UNRESOLVED, None, None)
