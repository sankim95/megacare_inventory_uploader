from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "약국 거래명세서 입고 반영 도우미"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: Tuple[str, ...] = ("http://127.0.0.1:5173",)
    timezone_name: str = "Asia/Seoul"

    data_dir: Path = PROJECT_ROOT / "data"
    frontend_dist: Path = PROJECT_ROOT / "frontend" / "dist"
    database_url: Optional[str] = None

    openai_api_key: Optional[SecretStr] = None
    openai_model: str = "gpt-5.6"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'app.db').resolve()}"

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)

    def ensure_data_directories(self) -> None:
        for path in (
            self.data_dir,
            self.data_dir / "uploads",
            self.data_dir / "corrected",
            self.data_dir / "exports",
        ):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
