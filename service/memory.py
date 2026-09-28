"""
KIRO-Connect — Correction Memory
Local persistent vector store (ChromaDB) recording (query, wrong_answer, correct_answer)
triples, queried before processing new tasks to inject past corrections into context.
"""

import os
import logging
from typing import List, Dict, Any, Optional
import chromadb

logger = logging.getLogger("kiro.memory")

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "chroma_db")


import hashlib
import math
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings


class LocalFeatureEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    Fast, deterministic, 100% offline embedding function.
    Eliminates reliance on external ONNX weight downloads and network latency.
    """
    def __init__(self, dim: int = 128):
        self.dim = dim

    def __call__(self, input: Documents) -> Embeddings:
        embeddings = []
        for text in input:
            vec = [0.0] * self.dim
            words = text.lower().split()
            tokens = words + [text[i:i+3] for i in range(len(text) - 2)]
            for tok in tokens:
                idx = int(hashlib.md5(tok.encode("utf-8", "ignore")).hexdigest(), 16) % self.dim
                vec[idx] += 1.0
            norm = math.sqrt(sum(x * x for x in vec))
            if norm > 0:
                vec = [x / norm for x in vec]
            embeddings.append(vec)
        return embeddings


class CorrectionMemory:
    """Manages persistent query/wrong-answer/correct-answer vector memory."""

    def __init__(self, persist_dir: Optional[str] = None):
        self.persist_dir = persist_dir or DB_DIR
        os.makedirs(self.persist_dir, exist_ok=True)
        self.embedding_fn = LocalFeatureEmbeddingFunction(dim=128)
        try:
            self.client = chromadb.PersistentClient(path=self.persist_dir)
            self.collection = self.client.get_or_create_collection(
                name="kiro_correction_memory",
                embedding_function=self.embedding_fn,
                metadata={"description": "KIRO-Connect MoA Correction Triples"}
            )
            logger.info(f"CorrectionMemory initialized at {self.persist_dir} (count: {self.collection.count()})")
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB: {e}")
            self.client = None
            self.collection = None

    def store_correction(self, query: str, wrong_answer: str, correct_answer: str) -> bool:
        """Stores a new (query, wrong_answer, correct_answer) correction triple."""
        if not self.collection:
            return False

        try:
            import uuid
            doc_id = str(uuid.uuid4())
            metadata = {
                "wrong_answer": wrong_answer[:2000],
                "correct_answer": correct_answer[:2000],
                "timestamp": str(os.path.getmtime(self.persist_dir))
            }
            self.collection.add(
                ids=[doc_id],
                documents=[query],
                metadatas=[metadata]
            )
            logger.info(f"Saved correction for query: '{query[:50]}...'")
            return True
        except Exception as e:
            logger.error(f"Failed to store correction: {e}")
            return False

    def query_similar_corrections(self, query: str, n_results: int = 2, distance_threshold: float = 0.85) -> List[Dict[str, Any]]:
        """
        Retrieves relevant past corrections for a given query.
        Returns empty list if no close match is found.
        """
        if not self.collection or self.collection.count() == 0:
            return []

        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=min(n_results, self.collection.count())
            )
            corrections = []
            if results and results.get("documents") and results["documents"][0]:
                docs = results["documents"][0]
                metas = results["metadatas"][0] if results.get("metadatas") else []
                distances = results["distances"][0] if results.get("distances") else []

                for i, doc in enumerate(docs):
                    dist = distances[i] if i < len(distances) else 1.0
                    # Chroma default distance is squared L2 or cosine distance; lower means closer
                    if dist <= distance_threshold:
                        meta = metas[i] if i < len(metas) else {}
                        corrections.append({
                            "matched_query": doc,
                            "wrong_answer": meta.get("wrong_answer", ""),
                            "correct_answer": meta.get("correct_answer", ""),
                            "similarity_score": round(max(0.0, 1.0 - dist), 3)
                        })
            return corrections
        except Exception as e:
            logger.error(f"Failed to query corrections: {e}")
            return []

    def get_all_corrections(self) -> List[Dict[str, Any]]:
        """Returns all stored corrections for the host dashboard."""
        if not self.collection or self.collection.count() == 0:
            return []
        try:
            data = self.collection.get()
            out = []
            if data and data.get("ids"):
                for i, doc_id in enumerate(data["ids"]):
                    meta = data["metadatas"][i] if data.get("metadatas") else {}
                    doc = data["documents"][i] if data.get("documents") else ""
                    out.append({
                        "id": doc_id,
                        "query": doc,
                        "wrong_answer": meta.get("wrong_answer", ""),
                        "correct_answer": meta.get("correct_answer", ""),
                    })
            return out
        except Exception as e:
            logger.error(f"Failed to fetch all corrections: {e}")
            return []
