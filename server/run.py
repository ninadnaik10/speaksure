"""Development entrypoint. Production runs gunicorn against app.main:app."""

import os

import uvicorn

from app.core.config import get_settings

# macOS squats on port 5000 with the AirPlay Receiver, so local dev defaults to
# 8000. Production binds 5000 via the gunicorn --bind flag in the systemd unit.
DEFAULT_PORT = 8000

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", DEFAULT_PORT)),
        reload=not settings.is_production,
    )
