import base64
import io
import struct
from typing import Optional

import numpy as np


def decode_pcm16_base64(chunk_b64: str, sample_rate: int = 16000) -> np.ndarray:
    raw = base64.b64decode(chunk_b64)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples


def encode_pcm16_base64(audio: np.ndarray) -> str:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    return base64.b64encode(pcm.tobytes()).decode("ascii")


def wav_bytes_from_float32(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    num_samples = len(pcm)
    byte_rate = sample_rate * 2
    block_align = 2
    data_size = num_samples * 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        byte_rate,
        block_align,
        16,
        b"data",
        data_size,
    )
    return header + pcm.tobytes()


def load_wav_bytes(data: bytes) -> tuple[np.ndarray, int]:
    import soundfile as sf

    audio, sr = sf.read(io.BytesIO(data), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, int(sr)
