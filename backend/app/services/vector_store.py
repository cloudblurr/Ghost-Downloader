"""Optional Chroma vector store for semantic search caching."""

from __future__ import annotations

from typing import Optional

from app.config import get_settings
from app.utils.logger import log


class VectorStore:
    """Thin wrapper around ChromaDB. Disabled by default."""

    def __init__(self):
        cfg = get_settings()
        self._collection = None
        if cfg.ENABLE_VECTOR_DB:
            try:
                import chromadb

                client = chromadb.PersistentClient(path=cfg.CHROMA_PATH)
                self._collection = client.get_or_create_collection(
                    name="ghost_search",
                    metadata={"hnsw:space": "cosine"},
                )
                log.info("ChromaDB initialized at %s", cfg.CHROMA_PATH)
            except Exception as exc:
                log.warning("ChromaDB init failed (disabled): %s", exc)

    @property
    def enabled(self) -> bool:
        return self._collection is not None

    def add(self, doc_id: str, text: str, metadata: dict | None = None):
        if not self._collection:
            return
        self._collection.add(
            ids=[doc_id],
            documents=[text],
            metadatas=[metadata or {}],
        )

    def query(self, text: str, n: int = 10) -> list[dict]:
        if not self._collection:
            return []
        results = self._collection.query(query_texts=[text], n_results=n)
        out = []
        for i, doc_id in enumerate(results["ids"][0]):
            out.append({
                "id": doc_id,
                "document": results["documents"][0][i],
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": results["distances"][0][i] if results["distances"] else None,
            })
        return out


_store: Optional[VectorStore] = None


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
