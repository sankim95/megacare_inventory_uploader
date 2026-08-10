from enum import Enum


class JobStatus(str, Enum):
    DRAFT = "draft"
    EXTRACTING = "extracting"
    REVIEWING = "reviewing"
    EXPORTING = "exporting"
    COMPLETED = "completed"
    FAILED = "failed"


class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class DuplicateStatus(str, Enum):
    NONE = "none"
    SUSPECTED = "suspected"
    CONFIRMED = "confirmed"


class ReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    EXCLUDED = "excluded"


class MatchMethod(str, Enum):
    CODE = "code"
    NORMALIZED_NAME_SPEC = "normalized_name_spec"
    SIMILARITY = "similarity"
    MANUAL = "manual"


class ResolutionMethod(str, Enum):
    UNRESOLVED = "unresolved"
    AUTOMATIC = "automatic"
    MANUAL = "manual"

