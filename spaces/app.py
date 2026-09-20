"""SpeakSure inference Space: Wav2Vec2 embeddings + confidence classifier.

Runs on ZeroGPU, which is PyTorch-only -- the classifier is plain NumPy
(see mlp.py) precisely so no second framework is needed here.

Called from the SpeakSure API via gradio_client:

    from gradio_client import Client, handle_file
    Client("<user>/speaksure-inference").predict(
        handle_file("answer.wav"), api_name="/predict"
    )
"""

from pathlib import Path

import gradio as gr
import librosa
import numpy as np
import spaces
import torch
from transformers import Wav2Vec2Model, Wav2Vec2Processor

MODEL_NAME = "facebook/wav2vec2-base-960h"
SAMPLE_RATE = 16000
CHUNK_SECONDS = 10

from mlp import NumpyMLP  # noqa: E402

# ZeroGPU requires models to be placed on cuda at module level; a CUDA
# emulation layer makes this work before a real GPU is attached.
processor = Wav2Vec2Processor.from_pretrained(MODEL_NAME)
wav2vec2 = Wav2Vec2Model.from_pretrained(MODEL_NAME).to("cuda").eval()
classifier = NumpyMLP(Path(__file__).parent / "mlp.npz")


@spaces.GPU(duration=60)
def analyze(audio_path: str) -> dict:
    """Score each 10-second chunk of an answer on the 1-5 confidence scale."""
    if not audio_path:
        return {"error": "No audio provided"}

    audio, _ = librosa.load(audio_path, sr=SAMPLE_RATE)
    chunk_size = CHUNK_SECONDS * SAMPLE_RATE
    num_chunks = int(np.ceil(len(audio) / chunk_size))

    predictions: list[int] = []
    for index in range(num_chunks):
        chunk = audio[index * chunk_size : (index + 1) * chunk_size]
        if len(chunk) == 0:
            continue

        inputs = processor(
            chunk, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True
        ).to("cuda")
        with torch.no_grad():
            outputs = wav2vec2(**inputs)
        features = outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy()

        predictions.append(classifier.predict_class(features))

    if not predictions:
        return {"prediction": [], "avg_prediction": 0.0}

    return {
        "prediction": predictions,
        "avg_prediction": round(sum(predictions) / len(predictions), 2),
    }


with gr.Blocks(title="SpeakSure Inference") as demo:
    gr.Markdown(
        "# SpeakSure Inference\n"
        "Wav2Vec2 acoustic embeddings scored by a trained MLP. "
        "Returns a per-10s-chunk confidence sequence (1 = not confident, "
        "5 = very confident) and its average."
    )
    with gr.Row():
        audio_input = gr.Audio(type="filepath", label="Answer audio")
        output = gr.JSON(label="Confidence scores")
    gr.Button("Analyze", variant="primary").click(
        analyze, inputs=audio_input, outputs=output, api_name="predict"
    )

if __name__ == "__main__":
    demo.launch()
