from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.database import Base, build_engine, build_session_factory
from app.models import Document, Item, Job, ReviewStatus


def test_approved_item_requires_match_and_stock(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'constraints.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)

    with session_factory() as session:
        job = Job()
        document = Document(
            job=job,
            source_order=0,
            original_image_path="uploads/image.png",
            original_image_name="image.png",
            image_sha256="a" * 64,
        )
        document.items.append(
            Item(
                source_row_order=0,
                review_status=ReviewStatus.APPROVED,
                stock_increment=1,
            )
        )
        session.add(job)

        with pytest.raises(IntegrityError):
            session.commit()

    engine.dispose()


def test_existing_base_stock_may_be_negative(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'negative-stock.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)

    with session_factory() as session:
        job = Job()
        document = Document(
            job=job,
            source_order=0,
            original_image_path="uploads/image.png",
            original_image_name="image.png",
            image_sha256="b" * 64,
        )
        document.items.append(
            Item(
                source_row_order=0,
                matched_product_code="2900000001039",
                stock_increment=2,
                base_stock=-17,
                review_status=ReviewStatus.APPROVED,
            )
        )
        session.add(job)
        session.commit()

        assert document.items[0].base_stock == -17

    engine.dispose()
