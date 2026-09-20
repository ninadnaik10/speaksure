---
title: SpeakSure Inference
emoji: 🎤
colorFrom: yellow
colorTo: red
sdk: gradio
app_file: app.py
pinned: false
---

# SpeakSure Inference

Wav2Vec2 feature extraction plus the trained confidence classifier, split out
of the main SpeakSure app so the API server can run on a 1 GB instance.

## Deploying

1. Create a new Space, SDK **Gradio**.
2. Settings → Hardware → **ZeroGPU**. Free personal accounts may host 2, and
   require a verified email and an account older than 30 days.
3. Push `app.py`, `mlp.py`, `mlp.npz` and `requirements.txt` to the Space repo.

`gradio` and `spaces` are provided by the Space runtime and are deliberately
absent from `requirements.txt`.

## Calling it

```python
from gradio_client import Client, handle_file

client = Client("<user>/speaksure-inference", hf_token="hf_...")
client.predict(handle_file("answer.wav"), api_name="/predict")
# {"prediction": [4, 3, 4], "avg_prediction": 3.67}
```

Authenticate: unauthenticated callers share a 2 min/day GPU quota, a free
account gets 5 min/day.

## Notes

- The classifier is NumPy, not TensorFlow -- ZeroGPU is PyTorch-only, and a
  second framework fighting for the device causes problems. Weights come from
  `tools/export_mlp.py` in the main repo and reproduce the original Keras model
  exactly.
- Free Spaces sleep when idle. A periodic HTTP request keeps one warm; only
  `@spaces.GPU` calls consume quota.
