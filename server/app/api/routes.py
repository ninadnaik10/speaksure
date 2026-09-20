import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.core.audio import AudioError, UploadTooLarge, convert_to_wav, save_upload
from app.api.services import (
    DatabaseService,
    FeedbackService,
    InferenceService,
    TranscriptionService,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _ml(request: Request) -> InferenceService:
    return request.app.state.ml_service


def _transcription(request: Request) -> TranscriptionService:
    return request.app.state.transcription_service


def _feedback(request: Request) -> FeedbackService:
    return request.app.state.feedback_service


def _db(request: Request) -> DatabaseService:
    return request.app.state.db_service


@router.get("/health")
async def health(request: Request) -> dict:
    """Liveness plus a cheap database round-trip, for nginx and systemd probes."""
    database_ok = True
    try:
        await asyncio.to_thread(_db(request).ping)
    except Exception:
        logger.warning("Health check could not reach MongoDB", exc_info=True)
        database_ok = False

    return {
        "status": "ok" if database_ok else "degraded",
        "models_loaded": hasattr(request.app.state, "ml_service"),
        "database": "up" if database_ok else "down",
    }


@router.post("/predict")
async def predict(
    request: Request,
    audio: Annotated[UploadFile, File()],
    interview_id: Annotated[str, Form()],
    name: Annotated[str, Form()],
    question: Annotated[str, Form()] = "N/A",
) -> dict:
    settings = request.app.state.settings

    with tempfile.TemporaryDirectory(prefix="speaksure-") as workdir:
        raw_path = Path(workdir) / "upload"
        wav_path = Path(workdir) / "audio.wav"

        try:
            await save_upload(audio, raw_path, settings.max_upload_bytes)
            await convert_to_wav(raw_path, wav_path, settings.sample_rate)
        except UploadTooLarge as exc:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)
            ) from exc
        except AudioError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

        try:
            # Inference is CPU-bound and transcription is a network round-trip,
            # so overlap them; both run off the event loop.
            (prediction_sequence, avg_prediction), transcript_result = await asyncio.gather(
                asyncio.to_thread(_ml(request).predict, wav_path),
                asyncio.to_thread(_transcription(request).transcribe, wav_path),
            )
            transcript, num_words, duration, speech_rate_wpm = transcript_result

            feedback = await asyncio.to_thread(
                _feedback(request).generate,
                question,
                transcript,
                avg_prediction,
                speech_rate_wpm,
            )
        except Exception as exc:
            logger.exception("Prediction failed for interview %s", interview_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
            ) from exc

    response = {
        "question": question,
        "prediction": prediction_sequence,
        "avg_prediction": avg_prediction,
        "transcript": transcript,
        "numofwords": num_words,
        "duration": round(duration, 2),
        "speech_rate_wpm": speech_rate_wpm,
        "feedback": feedback,
    }

    try:
        await asyncio.to_thread(
            _db(request).upload_results, interview_id, name, response
        )
    except Exception as exc:
        logger.exception("Could not persist results for interview %s", interview_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Analysis succeeded but could not be saved: {exc}",
        ) from exc

    return {"message": "OK", **response}


@router.get("/get_results")
async def get_results(request: Request) -> dict:
    results = await asyncio.to_thread(_db(request).get_results)
    return {"results": results}
