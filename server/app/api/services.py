import logging
from pathlib import Path
from typing import Any

import assemblyai as aai
import joblib
import librosa
import numpy as np
import soundfile as sf
import tensorflow as tf
import torch
from google import genai
from pymongo import MongoClient
from transformers import Wav2Vec2Model, Wav2Vec2Processor

from app.core.config import Settings

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 10


class MLService:
    """Wav2Vec2 feature extraction plus the trained MLP confidence classifier."""

    def __init__(self, settings: Settings) -> None:
        torch.set_num_threads(settings.torch_num_threads)
        self.sample_rate = settings.sample_rate

        logger.info("Loading %s", settings.transformer_model_name)
        self.processor = Wav2Vec2Processor.from_pretrained(settings.transformer_model_name)
        self.wav2vec2 = Wav2Vec2Model.from_pretrained(settings.transformer_model_name)
        self.wav2vec2.eval()

        logger.info("Loading MLP classifier and scaler")
        self.classifier = tf.keras.models.load_model(str(settings.keras_model_path))
        self.scaler = joblib.load(settings.scaler_path)

    def _extract_features(self, audio_chunk: np.ndarray) -> np.ndarray:
        inputs = self.processor(
            audio_chunk,
            sampling_rate=self.sample_rate,
            return_tensors="pt",
            padding=True,
        )
        with torch.no_grad():
            outputs = self.wav2vec2(**inputs)
        return outputs.last_hidden_state.mean(dim=1).squeeze().numpy()

    def predict(self, audio_path: Path) -> tuple[list[int], float]:
        """Return a per-10s-chunk confidence sequence (1-5) and its average."""
        audio, sample_rate = librosa.load(str(audio_path), sr=self.sample_rate)

        chunk_size = CHUNK_SECONDS * sample_rate
        num_chunks = int(np.ceil(len(audio) / chunk_size))
        prediction_sequence: list[int] = []

        for index in range(num_chunks):
            start = index * chunk_size
            end = min((index + 1) * chunk_size, len(audio))
            chunk = audio[start:end]
            if len(chunk) == 0:
                continue

            features = self._extract_features(chunk).reshape(1, -1)
            predictions = self.classifier.predict(self.scaler.transform(features), verbose=0)
            prediction_sequence.append(int(np.argmax(predictions) + 1))

        if not prediction_sequence:
            return [], 0.0
        average = round(sum(prediction_sequence) / len(prediction_sequence), 2)
        return prediction_sequence, average


class TranscriptionService:
    """AssemblyAI transcription plus the speech-rate metrics derived from it."""

    def __init__(self, settings: Settings) -> None:
        aai.settings.api_key = settings.assemblyai_api_key
        self.sample_rate = settings.sample_rate

    def transcribe(self, audio_path: Path) -> tuple[str, int, float, float]:
        # soundfile reads the wav header only, so this costs nothing next to
        # decoding the whole file just to measure it.
        duration = sf.info(str(audio_path)).duration

        transcript = aai.Transcriber().transcribe(str(audio_path))
        if transcript.error:
            raise RuntimeError(f"Transcription failed: {transcript.error}")

        text = transcript.text or ""
        num_words = len(text.split())
        speech_rate_wpm = round((num_words / duration) * 60, 2) if duration > 0 else 0.0
        return text, num_words, duration, speech_rate_wpm


class FeedbackService:
    """Gemini-generated hiring-manager feedback."""

    def __init__(self, settings: Settings) -> None:
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_model

    def generate(
        self,
        question: str,
        transcript: str,
        avg_prediction: float,
        speech_rate_wpm: float,
    ) -> str:
        prompt = f"""
        You are an assistant to a hiring manager who is conducting a behavioral interview. You are given a question, a transcript of the answer, an average confidence prediction (range 1-5 where 1 is not confident and 5 is very confident), and a speech rate in words per minute.
        You need to analyze the question, relevancy of the answer to the question, other parameters provided to you.
        You need to provide helpful feedback to the hiring manager who is tasked to make the decision to hire the candidate.
        The feedback should be critical, short, and to the point.
        The feedback should be in the bullet points and can be 2-4 points.
        The feedback will only contain bullet points and no other text like headings or paragraphs or conclusions.
        Do not mention the question, answer, average prediction, or speech rate in the feedback. Just write your insights in the feedback.
        The feedback should not contain tips or suggestions for the candidate.
        The question is: {question}
        The transcript of the answer is: {transcript}
        The average prediction is: {avg_prediction}
        The speech rate is: {speech_rate_wpm}
        """

        response = self._client.models.generate_content(model=self._model, contents=prompt)
        return response.text or ""


class DatabaseService:
    def __init__(self, settings: Settings) -> None:
        # connect=False defers DNS/SRV resolution to the first operation. Without
        # it an unreachable cluster raises here, the app fails to boot, and
        # systemd restart-loops -- reloading ~640 MB of models every few seconds.
        # Instead we start, and /api/health reports the database as down.
        self.client = MongoClient(
            settings.mongo_uri, serverSelectionTimeoutMS=5000, connect=False
        )
        self.db = self.client[settings.database_name]

    def ping(self) -> None:
        self.client.admin.command("ping")

    def close(self) -> None:
        self.client.close()

    def upload_results(self, interview_id: str, name: str, response: dict[str, Any]) -> None:
        existing = self.db.results.find_one({"interview_id": interview_id})
        if existing:
            self.db.results.update_one(
                {"interview_id": interview_id},
                {"$push": {"responses": response}},
            )
        else:
            self.db.results.insert_one(
                {"interview_id": interview_id, "name": name, "responses": [response]}
            )

    def get_results(self) -> list[dict[str, Any]]:
        return list(self.db.results.find({}, {"_id": 0}))

    def find_results_by_interview_id(self, interview_id: str) -> dict[str, Any] | None:
        return self.db.results.find_one({"interview_id": interview_id}, {"_id": 0})
