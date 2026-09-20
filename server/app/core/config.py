from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = APP_DIR / "models"

DEV_SECRET = "dev-insecure-change-me"


class Settings(BaseSettings):
    """Application settings, read from the environment (and .env in development)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        protected_namespaces=(),
    )

    app_env: Literal["development", "production"] = "production"
    secret_key: str = DEV_SECRET

    mongo_uri: str
    database_name: str = "Speaksure2"

    assemblyai_api_key: str
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"

    transformer_model_name: str = "facebook/wav2vec2-base-960h"
    sample_rate: int = 16000

    # When set, acoustic inference is delegated to a Hugging Face Space and the
    # server needs no torch/transformers at all. Empty runs the models locally
    # (requires requirements-local.txt).
    inference_space_url: str = ""
    hf_token: str = ""

    # Uploads larger than this are rejected before anything is written to disk.
    max_upload_bytes: int = 100 * 1024 * 1024

    # Comma-separated. Leave empty when the API is served same-origin behind nginx.
    cors_origins: str = ""

    # Tuned for a 4 OCPU box shared by 2 workers: keep BLAS/torch from
    # oversubscribing every core and thrashing.
    torch_num_threads: int = 2
    thread_pool_size: int = 8

    @property
    def keras_model_path(self) -> Path:
        return MODELS_DIR / "trained_model.h5"

    @property
    def scaler_path(self) -> Path:
        return MODELS_DIR / "scaler.pkl"

    @property
    def mlp_weights_path(self) -> Path:
        return MODELS_DIR / "mlp.npz"

    @property
    def uses_remote_inference(self) -> bool:
        return bool(self.inference_space_url.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        if not self.is_production:
            return self
        if self.secret_key == DEV_SECRET:
            raise ValueError("SECRET_KEY must be set to a real value when APP_ENV=production")
        if "*" in self.cors_origin_list:
            raise ValueError("CORS_ORIGINS must not be '*' when APP_ENV=production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
