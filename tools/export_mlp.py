"""Export the Keras MLP and StandardScaler to a single .npz of raw weights.

The classifier is three dense layers (768->128->64->5); running it needs four
matrix multiplies, not an 800 MB deep-learning framework. This lets both the
API server and the inference Space drop tensorflow, keras, scikit-learn and
joblib entirely.

Usage:  python tools/export_mlp.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app.core.config import MODELS_DIR, get_settings  # noqa: E402

OUTPUT = MODELS_DIR / "mlp.npz"


def main() -> None:
    import joblib
    import tensorflow as tf

    settings = get_settings()
    model = tf.keras.models.load_model(str(settings.keras_model_path))
    scaler = joblib.load(settings.scaler_path)

    arrays = {"scaler_mean": scaler.mean_, "scaler_scale": scaler.scale_}
    for index, layer in enumerate(model.layers):
        weights = layer.get_weights()
        if not weights:
            continue
        kernel, bias = weights
        arrays[f"w{index}"] = kernel
        arrays[f"b{index}"] = bias

    np.savez_compressed(OUTPUT, **arrays)
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size / 1024:.0f} KB)")

    # Verify the exported weights reproduce Keras exactly.
    from app.core.mlp import NumpyMLP

    mlp = NumpyMLP(OUTPUT)
    rng = np.random.default_rng(0)
    probe = rng.normal(size=(500, scaler.n_features_in_)).astype(np.float32) * 3
    expected = model.predict(scaler.transform(probe), verbose=0)
    actual = mlp.predict_proba(probe)

    max_diff = float(np.abs(expected - actual).max())
    agreement = float((expected.argmax(1) == actual.argmax(1)).mean())
    print(f"max probability difference : {max_diff:.2e}")
    print(f"argmax agreement           : {agreement * 100:.1f}%")
    if max_diff > 1e-5 or agreement < 1.0:
        raise SystemExit("export verification FAILED")
    print("verification passed")


if __name__ == "__main__":
    main()
