from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    tatva_api_base_url: str = "http://localhost:8081"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    whisper_model: str = "base.en"
    whisper_device: str = "cpu"
    piper_executable: str = ""
    piper_voice: str = ""
    chroma_persist_dir: str = "./data/chroma"
    redis_url: str = "redis://localhost:6379/0"
    voice_session_ttl_sec: int = 3600
    voice_ws_host: str = "0.0.0.0"
    voice_ws_port: int = 8765
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
