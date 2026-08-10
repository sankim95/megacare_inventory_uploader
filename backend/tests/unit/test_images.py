from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.services import images


def test_perspective_document_is_safely_corrected(tmp_path: Path) -> None:
    source = tmp_path / "perspective.png"
    canvas = np.full((1000, 800, 3), 35, dtype=np.uint8)
    polygon = np.array([[100, 120], [720, 70], [680, 920], [130, 880]])
    cv2.fillConvexPoly(canvas, polygon, (255, 255, 255))
    for y in range(250, 800, 80):
        cv2.line(canvas, (150, y), (660, y - 20), (0, 0, 0), 4)
    cv2.imwrite(str(source), canvas)

    result = images.correct_document_image(source, tmp_path / "corrected")

    assert result.path is not None
    assert result.applied is True
    assert result.width < 800
    assert result.height < 1000


def test_inner_table_contour_does_not_crop_document_header(tmp_path: Path) -> None:
    source = tmp_path / "inner-table.png"
    canvas = np.full((1000, 800, 3), 255, dtype=np.uint8)
    cv2.putText(
        canvas,
        "INVOICE HEADER",
        (110, 140),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 0),
        3,
    )
    cv2.rectangle(canvas, (80, 220), (720, 780), (0, 0, 0), 5)
    for y in range(300, 780, 80):
        cv2.line(canvas, (80, y), (720, y), (0, 0, 0), 4)
    cv2.imwrite(str(source), canvas)

    result = images.correct_document_image(source, tmp_path / "corrected")

    assert result.path is not None
    assert result.width == 800
    assert result.height == 1000
    assert "원본 영역" in result.warning


def test_correction_failure_falls_back_with_warning(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "source.png"
    Image.new("RGB", (300, 300), "white").save(source)
    monkeypatch.setattr(
        images,
        "_perspective_correct",
        lambda _: (_ for _ in ()).throw(RuntimeError("broken")),
    )

    result = images.correct_document_image(source, tmp_path / "corrected")

    assert result.path is None
    assert result.applied is False
    assert "원본을 사용" in result.warning
