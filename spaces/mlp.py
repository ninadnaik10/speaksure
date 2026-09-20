"""Dependency-free implementation of the trained confidence classifier.

Weights are exported from the original Keras model by tools/export_mlp.py and
verified to reproduce it exactly. Keeping this in NumPy removes tensorflow,
keras, scikit-learn and joblib from the inference path.
"""

from pathlib import Path

import numpy as np


class NumpyMLP:
    """StandardScaler + dense(relu) x N + dense(softmax), in plain NumPy."""

    def __init__(self, weights_path: Path) -> None:
        data = np.load(weights_path)

        # Contiguous float64 throughout, so the arithmetic is identical across
        # platforms regardless of the dtypes Keras happened to export.
        #
        # On macOS, NumPy 2.x on the Accelerate BLAS emits spurious
        # "divide by zero / overflow / invalid value encountered in matmul"
        # warnings for any matmul of this shape -- reproducible with plain
        # NumPy and no project code. Results are finite and correct; Linux
        # (OpenBLAS) is unaffected.
        def prepare(array: np.ndarray) -> np.ndarray:
            return np.ascontiguousarray(array, dtype=np.float64)

        self.mean = prepare(data["scaler_mean"])
        self.scale = prepare(data["scaler_scale"])

        indices = sorted(int(k[1:]) for k in data.files if k.startswith("w"))
        self.layers = [(prepare(data[f"w{i}"]), prepare(data[f"b{i}"])) for i in indices]

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        x = np.atleast_2d(np.asarray(features, dtype=np.float64))
        x = (x - self.mean) / self.scale

        *hidden, output = self.layers
        for kernel, bias in hidden:
            x = np.maximum(0.0, x @ kernel + bias)

        logits = x @ output[0] + output[1]
        logits = logits - logits.max(axis=-1, keepdims=True)
        exp = np.exp(logits)
        return exp / exp.sum(axis=-1, keepdims=True)

    def predict_class(self, features: np.ndarray) -> int:
        """Confidence class on the 1-5 scale the rest of the app expects."""
        return int(np.argmax(self.predict_proba(features), axis=-1)[0] + 1)
