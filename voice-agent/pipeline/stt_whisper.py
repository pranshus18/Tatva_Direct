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

        _model = WhisperModel(settings.whisper_model, device=settings.whisper_device, compute_type="int8")
        logger.info("Whisper model loaded: %s", settings.whisper_model)
    except Exception as exc:
        logger.warning("Whisper unavailable: %s", exc)
        _model = False
    return _model


def transcribe_audio(audio: np.ndarray, sample_rate: int = 16000) -> tuple[str, str]:
    """
    Returns (full_text, partial_hint).
    partial_hint may equal full_text for batch chunks.
    """
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
        )
        parts = [seg.text.strip() for seg in segments if seg.text.strip()]
        text = " ".join(parts).strip()
        return text, text
    except Exception as exc:
        logger.exception("STT failed: %s", exc)
        return "", ""
