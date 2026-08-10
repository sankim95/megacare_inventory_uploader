from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Optional, Tuple
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 50 * 1024 * 1024
MAX_IMAGE_PIXELS = 50_000_000
ALLOWED_MIME_TYPES = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}
FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


class ImageValidationError(ValueError):
    pass


@dataclass(frozen=True)
class StoredImage:
    path: Path
    sha256: str


@dataclass(frozen=True)
class CorrectionResult:
    path: Optional[Path]
    applied: bool
    warning: Optional[str]
    width: int
    height: int


def store_uploaded_image(
    source: BinaryIO,
    content_type: Optional[str],
    uploads_dir: Path,
) -> StoredImage:
    uploads_dir.mkdir(parents=True, exist_ok=True)
    raw = source.read(MAX_IMAGE_BYTES + 1)
    digest = hashlib.sha256(raw).hexdigest()
    if not raw:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "빈 이미지 파일은 업로드할 수 없습니다.", path, digest
        )
    if len(raw) > MAX_IMAGE_BYTES:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "이미지 파일은 50MB 이하만 업로드할 수 있습니다.", path, digest
        )
    normalized_mime = (content_type or "").split(";", 1)[0].strip().lower()
    expected_format = ALLOWED_MIME_TYPES.get(normalized_mime)

    if expected_format is None:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "JPEG, PNG, WEBP 이미지 파일만 업로드할 수 있습니다.", path, digest
        )

    try:
        with Image.open(_bytes_io(raw)) as image:
            actual_format = image.format
            width, height = image.size
            frame_count = getattr(image, "n_frames", 1)
            image.verify()
    except (
        Image.DecompressionBombError,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "이미지를 해석할 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.",
            path,
            digest,
        ) from exc

    if actual_format != expected_format:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "파일의 실제 이미지 형식과 MIME 형식이 일치하지 않습니다.", path, digest
        )
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "이미지 해상도가 허용 범위를 벗어났습니다.", path, digest
        )
    if frame_count != 1:
        path = uploads_dir / f"{uuid4()}.invalid"
        path.write_bytes(raw)
        raise StoredInvalidImage(
            "움직이는 이미지는 업로드할 수 없습니다.", path, digest
        )

    path = uploads_dir / f"{uuid4()}{FORMAT_EXTENSIONS[actual_format]}"
    path.write_bytes(raw)
    return StoredImage(path=path.resolve(), sha256=digest)


class StoredInvalidImage(ImageValidationError):
    def __init__(self, message: str, path: Path, sha256: str) -> None:
        super().__init__(message)
        self.path = path.resolve()
        self.sha256 = sha256


def correct_document_image(source_path: Path, corrected_dir: Path) -> CorrectionResult:
    corrected_dir.mkdir(parents=True, exist_ok=True)
    output_path = corrected_dir / f"{uuid4()}.jpg"
    try:
        with Image.open(source_path) as opened:
            transposed = ImageOps.exif_transpose(opened).convert("RGB")
            rgb = np.asarray(transposed)

        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        corrected, perspective_applied, warnings = _perspective_correct(bgr)
        corrected, orientation_applied, orientation_warning = _correct_orientation(
            corrected
        )
        if orientation_warning:
            warnings.append(orientation_warning)
        corrected, deskew_applied = _deskew(corrected)

        height, width = corrected.shape[:2]
        if width < 200 or height < 200:
            raise ValueError("보정 결과 해상도가 너무 작습니다.")
        if not cv2.imwrite(
            str(output_path), corrected, [cv2.IMWRITE_JPEG_QUALITY, 95]
        ):
            raise OSError("보정 이미지를 저장하지 못했습니다.")
        return CorrectionResult(
            path=output_path.resolve(),
            applied=perspective_applied or orientation_applied or deskew_applied,
            warning=" ".join(warnings) or None,
            width=width,
            height=height,
        )
    except Exception:
        output_path.unlink(missing_ok=True)
        return CorrectionResult(
            path=None,
            applied=False,
            warning="이미지 자동 보정에 실패하여 원본을 사용합니다.",
            width=0,
            height=0,
        )


def _bytes_io(raw: bytes):
    from io import BytesIO

    return BytesIO(raw)


def _perspective_correct(image: np.ndarray) -> Tuple[np.ndarray, bool, list[str]]:
    height, width = image.shape[:2]
    scale = min(1.0, 1600.0 / max(height, width))
    resized = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 60, 180)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)
    edges = cv2.morphologyEx(
        edges, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8), iterations=1
    )
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    image_area = resized.shape[0] * resized.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        area_ratio = cv2.contourArea(polygon) / image_area
        if len(polygon) != 4 or area_ratio < 0.35:
            continue
        points = polygon.reshape(4, 2).astype("float32") / scale
        if not _covers_document_frame(points, width, height):
            continue
        warped = _warp_four_points(image, points)
        warped_height, warped_width = warped.shape[:2]
        if warped_width < 200 or warped_height < 200:
            continue
        if warped_width * warped_height < width * height * 0.2:
            continue
        return warped, True, []

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        contour_area = cv2.contourArea(contour)
        if contour_area / image_area < 0.2:
            continue
        rectangle = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rectangle).astype("float32")
        box_area = abs(cv2.contourArea(box))
        box_ratio = box_area / image_area
        if not 0.35 <= box_ratio <= 0.95 or contour_area / box_area < 0.45:
            continue
        points = box / scale
        if not _covers_document_frame(points, width, height):
            continue
        warped = _warp_four_points(image, points)
        warped_height, warped_width = warped.shape[:2]
        if warped_width < 200 or warped_height < 200:
            continue
        if warped_width * warped_height < width * height * 0.2:
            continue
        return warped, True, ["문서 외곽을 근사해 원근을 보정했습니다. 결과를 검수해 주세요."]

    return image, False, ["문서 윤곽을 안정적으로 찾지 못해 원본 영역을 사용했습니다."]


def _covers_document_frame(points: np.ndarray, width: int, height: int) -> bool:
    _, _, bounding_width, bounding_height = cv2.boundingRect(points)
    return bounding_width / width >= 0.75 and bounding_height / height >= 0.82


def _warp_four_points(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype="float32")
    point_sums = points.sum(axis=1)
    point_diffs = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(point_sums)]
    ordered[2] = points[np.argmax(point_sums)]
    ordered[1] = points[np.argmin(point_diffs)]
    ordered[3] = points[np.argmax(point_diffs)]
    top_left, top_right, bottom_right, bottom_left = ordered
    target_width = int(
        max(np.linalg.norm(bottom_right - bottom_left), np.linalg.norm(top_right - top_left))
    )
    target_height = int(
        max(np.linalg.norm(top_right - bottom_right), np.linalg.norm(top_left - bottom_left))
    )
    destination = np.array(
        [
            [0, 0],
            [target_width - 1, 0],
            [target_width - 1, target_height - 1],
            [0, target_height - 1],
        ],
        dtype="float32",
    )
    transform = cv2.getPerspectiveTransform(ordered, destination)
    return cv2.warpPerspective(
        image,
        transform,
        (target_width, target_height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )


def _correct_orientation(image: np.ndarray) -> Tuple[np.ndarray, bool, Optional[str]]:
    horizontal, vertical = _axis_line_lengths(image)
    enough_lines = horizontal + vertical >= max(image.shape[:2]) * 2.5
    if enough_lines and vertical > horizontal * 1.35:
        return (
            cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE),
            True,
            "표 선 방향을 기준으로 90도 회전했습니다. 방향을 검수해 주세요.",
        )
    return image, False, None


def _axis_line_lengths(image: np.ndarray) -> Tuple[float, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 70, 180)
    minimum = max(60, min(image.shape[:2]) // 10)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=80,
        minLineLength=minimum,
        maxLineGap=20,
    )
    horizontal = 0.0
    vertical = 0.0
    if lines is None:
        return horizontal, vertical
    for x1, y1, x2, y2 in lines[:, 0]:
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        length = math.hypot(dx, dy)
        if dx > dy * 4:
            horizontal += length
        elif dy > dx * 4:
            vertical += length
    return horizontal, vertical


def _deskew(image: np.ndarray) -> Tuple[np.ndarray, bool]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 70, 180)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=80,
        minLineLength=max(80, min(image.shape[:2]) // 8),
        maxLineGap=20,
    )
    if lines is None:
        return image, False
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        while angle <= -90:
            angle += 180
        while angle > 90:
            angle -= 180
        if abs(angle) <= 12:
            angles.append(angle)
    if not angles:
        return image, False
    angle = float(np.median(angles))
    if abs(angle) < 0.8 or abs(angle) > 10:
        return image, False
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return (
        cv2.warpAffine(
            image,
            matrix,
            (width, height),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255),
        ),
        True,
    )
