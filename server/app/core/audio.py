import asyncio
from pathlib import Path

from fastapi import UploadFile

CHUNK_SIZE = 1024 * 1024


class AudioError(Exception):
    """Raised when an upload cannot be stored or decoded."""


class UploadTooLarge(AudioError):
    pass


async def save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> None:
    """Stream an upload to disk, aborting as soon as it exceeds max_bytes."""
    written = 0
    with destination.open("wb") as handle:
        while chunk := await upload.read(CHUNK_SIZE):
            written += len(chunk)
            if written > max_bytes:
                raise UploadTooLarge(f"Upload exceeds the {max_bytes} byte limit")
            handle.write(chunk)
    if written == 0:
        raise AudioError("Uploaded file is empty")


async def convert_to_wav(source: Path, destination: Path, sample_rate: int) -> None:
    """Normalise any browser-produced audio to mono PCM wav at sample_rate.

    MediaRecorder emits webm/ogg on Chrome and Firefox but mp4 on Safari, so we
    hand everything to ffmpeg rather than trying to special-case containers.
    """
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-i", str(source),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", str(sample_rate),
        "-ac", "1",
        str(destination),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        detail = stderr.decode(errors="replace").strip()[:500]
        raise AudioError(f"Could not decode the uploaded audio: {detail}")
