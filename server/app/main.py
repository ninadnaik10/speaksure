import logging
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from app.api import router
from app.api.services import DatabaseService, FeedbackService, MLService, TranscriptionService
from app.core.config import Settings, get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = get_settings()
    app.state.settings = settings

    # Bound the default thread pool: every blocked thread here is holding a
    # torch/TF inference, and the box has 4 cores shared between 2 workers.
    anyio.to_thread.current_default_thread_limiter().total_tokens = settings.thread_pool_size

    logger.info("Starting SpeakSure API in %s mode", settings.app_env)
    app.state.ml_service = MLService(settings)
    app.state.transcription_service = TranscriptionService(settings)
    app.state.feedback_service = FeedbackService(settings)
    app.state.db_service = DatabaseService(settings)
    logger.info("Services ready")

    yield

    app.state.db_service.close()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="SpeakSure API",
        version="1.0.0",
        lifespan=lifespan,
        # No interactive docs in production; nothing here is public API.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):
        """Reject oversized uploads on the declared length, before reading them."""
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            if int(content_length) > settings.max_upload_bytes:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": "Request body too large"},
                )
        return await call_next(request)

    @app.exception_handler(PyMongoError)
    async def database_unavailable(request: Request, exc: PyMongoError):
        """Surface a lost database as 503, not an opaque 500."""
        logger.error("Database error on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "Database unavailable"},
        )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["*"],
        )

    app.include_router(router, prefix="/api")
    return app


app = create_app()
