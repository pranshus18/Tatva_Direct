import logging
from pathlib import Path
from typing import Optional

from config import get_settings

logger = logging.getLogger(__name__)

_vectorstore = None
_fallback_docs: list[tuple[str, str]] = []


def _load_fallback_docs():
    global _fallback_docs
    if _fallback_docs:
        return
    docs_dir = Path(__file__).resolve().parent / "documents"
    for path in docs_dir.glob("*.md"):
        try:
            _fallback_docs.append((path.name, path.read_text(encoding="utf-8")))
        except OSError as exc:
            logger.warning("Could not read %s: %s", path, exc)


def _get_vectorstore():
    global _vectorstore
    if _vectorstore is not None:
        return _vectorstore
    settings = get_settings()
    persist = Path(settings.chroma_persist_dir)
    try:
        from langchain_community.vectorstores import Chroma
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        if not settings.gemini_api_key:
            _vectorstore = False
            return _vectorstore
        embeddings = GoogleGenerativeAIEmbeddings(
            model="models/embedding-001",
            google_api_key=settings.gemini_api_key,
        )
        _vectorstore = Chroma(
            persist_directory=str(persist),
            embedding_function=embeddings,
            collection_name="tatva_support",
        )
        logger.info("Chroma retriever loaded from %s", persist)
    except Exception as exc:
        logger.warning("Chroma unavailable: %s", exc)
        _vectorstore = False
    return _vectorstore


def retrieve_support_context(query: str, k: int = 4) -> list[str]:
    store = _get_vectorstore()
    if store and store is not False:
        try:
            docs = store.similarity_search(query, k=k)
            return [d.page_content for d in docs if d.page_content]
        except Exception as exc:
            logger.warning("Chroma search failed: %s", exc)

    _load_fallback_docs()
    q = (query or "").lower()
    scored = []
    for name, text in _fallback_docs:
        score = sum(1 for word in q.split() if len(word) > 3 and word in text.lower())
        if score > 0:
            scored.append((score, name, text[:800]))
    scored.sort(reverse=True)
    return [f"[{name}] {snippet}" for _, name, snippet in scored[:k]]
