import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

from config import get_settings
from pipeline.audio_utils import load_wav_bytes, wav_bytes_from_float32

logger = logging.getLogger(__name__)


def synthesize_speech(text: str, sample_rate: int = 22050) -> Optional[np.ndarray]:
    """Return float32 mono audio or None if TTS unavailable."""
    clean = (text or "").strip()
    if not clean:
        return None

    settings = get_settings()
    voice_path = settings.piper_voice.strip()
    piper_bin = settings.piper_executable.strip() or shutil.which("piper")

    if piper_bin and voice_path and Path(voice_path).exists():
        return _synthesize_cli(piper_bin, voice_path, clean, sample_rate)

    try:
        return _synthesize_python(clean, voice_path, sample_rate)
    except Exception as exc:
        logger.warning("Piper TTS unavailable: %s", exc)
        return None


def _synthesize_cli(piper_bin: str, voice_path: str, text: str, sample_rate: int) -> Optional[np.ndarray]:
    with tempfile.TemporaryDirectory() as tmp:
        out_wav = Path(tmp) / "out.wav"
        proc = subprocess.run(
            [piper_bin, "--model", voice_path, "--output_file", str(out_wav)],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=60,
        )
        if proc.returncode != 0 or not out_wav.exists():
            logger.warning("piper CLI failed: %s", proc.stderr.decode(errors="ignore")[:200])
            return None
        audio, sr = load_wav_bytes(out_wav.read_bytes())
        if sr != sample_rate and len(audio) > 0:
            duration = len(audio) / sr
            new_len = int(duration * sample_rate)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, new_len),
                np.arange(len(audio)),
                audio,
            ).astype(np.float32)
        return audio


def _synthesize_python(text: str, voice_path: str, sample_rate: int) -> Optional[np.ndarray]:
    from piper import PiperVoice

    if not voice_path or not Path(voice_path).exists():
        logger.warning("PIPER_VOICE not configured; skipping TTS")
        return None
    voice = PiperVoice.load(voice_path)
    chunks = []
    for chunk in voice.synthesize(text):
        if chunk.audio_float_array is not None:
            chunks.append(np.array(chunk.audio_float_array, dtype=np.float32))
    if not chunks:
        return None
    return np.concatenate(chunks)
