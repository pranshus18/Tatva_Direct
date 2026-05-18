import logging
from typing import Optional

import numpy as np

from config import get_settings

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    global _model
    if _model is not None:
        return _model
    settings = get_settings()
    try:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type="int8",
        )
        logger.info("Whisper loaded: %s", settings.whisper_model)
    except Exception as exc:
        logger.warning("Whisper unavailable: %s", exc)
        _model = False
    return _model


def transcribe_audio(audio: np.ndarray, sample_rate: int = 16000) -> tuple[str, str]:
    """Batch transcription for end-of-utterance."""
    if audio is None or len(audio) < 400:
        return "", ""

    model = _get_model()
    if not model:
        return "", ""

    try:
        segments, _info = model.transcribe(
            audio,
            language="en",
            vad_filter=True,
            beam_size=1,
            best_of=1,
            temperature=0,
        )
        parts = [seg.text.strip() for seg in segments if seg.text.strip()]
        text = " ".join(parts).strip()
        return text, text
    except Exception as exc:
        logger.exception("STT failed: %s", exc)
        return "", ""


def transcribe_streaming(audio: np.ndarray, sample_rate: int = 16000) -> tuple[str, str]:
    """Partial hint for streaming chunks — fast, lower accuracy OK."""
    if audio is None or len(audio) < 1600:
        return "", ""

    model = _get_model()
    if not model:
        return "", ""

    try:
        segments, _ = model.transcribe(
            audio,
            language="en",
            vad_filter=False,
            beam_size=1,
            without_timestamps=True,
        )
        parts = [seg.text.strip() for seg in segments if seg.text.strip()]
        partial = " ".join(parts).strip()
        return partial, partial
    except Exception:
        return "", ""
