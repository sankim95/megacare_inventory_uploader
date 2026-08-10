from __future__ import annotations

from enum import Enum
from typing import Type

from sqlalchemy import Enum as SQLAlchemyEnum


def enum_type(enum_class: Type[Enum], name: str) -> SQLAlchemyEnum:
    return SQLAlchemyEnum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=False,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )
