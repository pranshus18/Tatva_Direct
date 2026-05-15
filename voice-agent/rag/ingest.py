"""
Ingest FAQ/policy markdown into Chroma. Run from voice-agent directory:
  python -m rag.ingest
"""

import logging
from pathlib import Path

from config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    settings = get_settings()
    if not settings.gemini_api_key:
        raise SystemExit("GEMINI_API_KEY required for embeddings")

    from langchain_community.document_loaders import DirectoryLoader, TextLoader
    from langchain_community.vectorstores import Chroma
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    docs_path = Path(__file__).resolve().parent / "documents"
    if not docs_path.exists():
        raise SystemExit(f"Documents folder missing: {docs_path}")

    loader = DirectoryLoader(
        str(docs_path),
        glob="**/*.md",
        loader_cls=TextLoader,
        loader_kwargs={"encoding": "utf-8"},
    )
    documents = loader.load()
    if not documents:
        logger.warning("No documents found in %s", docs_path)
        return

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120)
    chunks = splitter.split_documents(documents)

    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/embedding-001",
        google_api_key=settings.gemini_api_key,
    )
    persist = Path(settings.chroma_persist_dir)
    persist.mkdir(parents=True, exist_ok=True)

    Chroma.from_documents(
        chunks,
        embedding=embeddings,
        persist_directory=str(persist),
        collection_name="tatva_support",
    )
    logger.info("Ingested %s chunks into %s", len(chunks), persist)


if __name__ == "__main__":
    main()
