"""
KIRO-Connect — Shared Swarm Memory State
Maintained automatically by the Host LLM Orchestrator.

Architecture:
- The Host LLM Orchestrator monitors all agent outputs during inference sessions.
- Erroneous, hallucinated, or divergent proposals are automatically identified ("WRONG THINGS")
  and mapped against the verified synthesized consensus ("RIGHT THINGS").
- This mapping updates the Shared Memory State (stored in ChromaDB vector store)
  which is shared across all swarm agents.
- Future inference passes retrieve these mappings and inject them into the shared context,
  preventing agents across the LAN from repeating past mistakes.
- Zero manual input: 100% automated by the Host LLM Orchestrator within hosted state.
"""

import os
import time
import uuid
import hashlib
import math
import logging
import threading
from typing import List, Dict, Any, Optional, Tuple

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

logger = logging.getLogger("kiro.memory")

def get_default_db_dir() -> str:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        p = os.path.join(local_app_data, "KIRO-Connect", "chroma_db")
        try:
            os.makedirs(p, exist_ok=True)
            return p
        except Exception:
            pass
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "chroma_db")

DB_DIR = get_default_db_dir()


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


class SwarmSharedMemory:
    """
    Shared Swarm Memory State managed automatically by the Host LLM Orchestrator.
    Maps wrong outputs to right outputs across all active LAN agents.
    """

    def __init__(self, persist_dir: Optional[str] = None):
        self.persist_dir = persist_dir or DB_DIR
        os.makedirs(self.persist_dir, exist_ok=True)
        self.embedding_fn = LocalFeatureEmbeddingFunction(dim=128)
        self.total_mappings_recorded = 0
        self.last_update_time: Optional[float] = None
        self._lock = threading.Lock()

        try:
            self.client = chromadb.PersistentClient(path=self.persist_dir)
            self.collection = self.client.get_or_create_collection(
                name="kiro_shared_swarm_memory",
                embedding_function=self.embedding_fn,
                metadata={"description": "KIRO-Connect Swarm Shared Memory Mappings (Wrong -> Right)"}
            )
            self.total_mappings_recorded = self.collection.count()
            logger.info(f"SwarmSharedMemory initialized at {self.persist_dir} (total mappings: {self.total_mappings_recorded})")
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB for SwarmSharedMemory: {e}")
            self.client = None
            self.collection = None

    def map_and_update(
        self,
        query: str,
        wrong_thing: str,
        right_thing: str,
        agent_name: str = "Unknown Node",
        divergence_score: float = 0.0,
        consensus_confidence: float = 1.0
    ) -> bool:
        """
        Invoked automatically by the Host Orchestrator:
        Maps an identified mistake/divergence (WRONG THING) against the verified consensus (RIGHT THING),
        and updates the shared memory state accessible to all agents.
        """
        if not self.collection or not query.strip() or not right_thing.strip():
            return False

        with self._lock:
            try:
                mapping_id = f"map-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
                metadata = {
                    "wrong_thing": (wrong_thing or "Divergent reasoning")[:2000],
                    "right_thing": right_thing[:2000],
                    "agent_name": agent_name[:100],
                    "divergence_score": float(divergence_score),
                    "consensus_confidence": float(consensus_confidence),
                    "timestamp": str(time.time())
                }

                self.collection.add(
                    ids=[mapping_id],
                    documents=[query],
                    metadatas=[metadata]
                )
                self.total_mappings_recorded += 1
                self.last_update_time = time.time()

                logger.info(
                    f"[Shared Memory Updated] Host mapped mistake from agent '{agent_name}' "
                    f"for query: '{query[:40]}...' -> stored in shared memory state."
                )
                return True
            except Exception as e:
                logger.error(f"Failed to update shared memory mapping: {e}")
                return False

    def record_session_consensus(self, query: str, consensus_answer: str, confidence: float = 1.0) -> bool:
        """
        Records verified session consensus into the shared memory state
        even when all agents agreed, reinforcing correct reasoning patterns.
        """
        if not self.collection or not query.strip() or not consensus_answer.strip():
            return False

        with self._lock:
            try:
                doc_id = f"cons-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
                metadata = {
                    "wrong_thing": "",  # Unanimous agreement
                    "right_thing": consensus_answer[:2000],
                    "agent_name": "Swarm Consensus",
                    "divergence_score": 0.0,
                    "consensus_confidence": float(confidence),
                    "timestamp": str(time.time())
                }
                self.collection.add(
                    ids=[doc_id],
                    documents=[query],
                    metadatas=[metadata]
                )
                self.total_mappings_recorded += 1
                self.last_update_time = time.time()
                return True
            except Exception as e:
                logger.error(f"Failed to record session consensus in shared memory: {e}")
                return False

    def query_shared_memory(
        self,
        query: str,
        n_results: int = 1,
        distance_threshold: float = 0.85
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves mapped shared memory (wrong thing vs right thing) relevant to an incoming prompt.
        Shared with all agents in the swarm to guide inference and prevent repeated errors.
        """
        if not self.collection or self.collection.count() == 0 or not query.strip():
            return None

        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=min(n_results, self.collection.count())
            )
            if results and results.get("documents") and results["documents"][0]:
                doc = results["documents"][0][0]
                dist = results["distances"][0][0] if results.get("distances") and results["distances"][0] else 1.0
                meta = results["metadatas"][0][0] if results.get("metadatas") and results["metadatas"][0] else {}

                if dist <= distance_threshold:
                    wrong = meta.get("wrong_thing", "").strip()
                    right = meta.get("right_thing", "").strip()
                    agent = meta.get("agent_name", "")

                    formatted_context = ""
                    if wrong:
                        formatted_context = (
                            f"[Swarm Shared Memory — Host Mistake-Correction Mapping]\n"
                            f"• Related Query: {doc}\n"
                            f"• Identified Mistake to Avoid (from {agent}): {wrong}\n"
                            f"• Verified Correct Truth: {right}"
                        )
                    else:
                        formatted_context = (
                            f"[Swarm Shared Memory — Verified Swarm Consensus]\n"
                            f"• Related Query: {doc}\n"
                            f"• Verified Truth: {right}"
                        )

                    return {
                        "matched_query": doc,
                        "wrong_thing": wrong,
                        "right_thing": right,
                        "agent_name": agent,
                        "formatted_context": formatted_context,
                        "similarity_score": round(max(0.0, 1.0 - dist), 3)
                    }
            return None
        except Exception as e:
            logger.error(f"Failed to query shared memory: {e}")
            return None

    def get_memory_stats(self) -> Dict[str, Any]:
        """Returns shared memory status maintained in host state."""
        count = self.collection.count() if self.collection else 0
        return {
            "status": "active_shared",
            "total_mapped_items": count,
            "last_update_time": self.last_update_time,
            "storage": "ChromaDB (Shared LAN Swarm Vector Store)"
        }

    # Backward compatibility wrappers
    def get_session_count(self) -> int:
        return self.collection.count() if self.collection else 0

    def get_relevant_context(self, query: str, n_results: int = 1) -> Optional[str]:
        res = self.query_shared_memory(query, n_results=n_results)
        return res["formatted_context"] if res else None

    def record_session(self, query: str, final_answer: str, confidence: float = 1.0, divergent_answers: List[str] = None, contributing_nodes: List[str] = None) -> bool:
        if divergent_answers:
            for d in divergent_answers:
                self.map_and_update(query=query, wrong_thing=d, right_thing=final_answer, consensus_confidence=confidence)
            return True
        return self.record_session_consensus(query=query, consensus_answer=final_answer, confidence=confidence)

    def store_correction(self, query: str, wrong_answer: str, correct_answer: str) -> bool:
        return self.map_and_update(query=query, wrong_thing=wrong_answer, right_thing=correct_answer)

    def get_all_corrections(self) -> List[Dict[str, Any]]:
        """Returns actual list of stored corrections from ChromaDB."""
        if not self.collection:
            return []
        try:
            with self._lock:
                data = self.collection.get(include=["documents", "metadatas"])
            items = []
            ids = data.get("ids", [])
            docs = data.get("documents", [])
            metas = data.get("metadatas", [])
            for i in range(len(ids)):
                meta = metas[i] if i < len(metas) and metas[i] else {}
                items.append({
                    "id": ids[i],
                    "query": docs[i] if i < len(docs) else "",
                    "wrong_thing": meta.get("wrong_thing", ""),
                    "right_thing": meta.get("right_thing", ""),
                    "agent_name": meta.get("agent_name", "Unknown Node"),
                    "divergence_score": meta.get("divergence_score", 0.0),
                    "consensus_confidence": meta.get("consensus_confidence", 1.0),
                    "timestamp": meta.get("timestamp", "")
                })
            return items
        except Exception as e:
            logger.error(f"Error fetching corrections from ChromaDB: {e}")
            return []

    def clear_session_memory(self) -> bool:
        """Clears all session mappings in ChromaDB so storage does not accumulate."""
        if not self.client:
            return False
        with self._lock:
            try:
                try:
                    self.client.delete_collection("kiro_shared_swarm_memory")
                except Exception:
                    pass
                self.collection = self.client.get_or_create_collection(
                    name="kiro_shared_swarm_memory",
                    embedding_function=self.embedding_fn,
                    metadata={"description": "KIRO-Connect Swarm Shared Memory Mappings (Wrong -> Right)"}
                )
                self.total_mappings_recorded = 0
                self.last_update_time = time.time()
                logger.info("Cleared all shared memory mappings in ChromaDB for current session.")
                return True
            except Exception as e:
                logger.error(f"Error clearing ChromaDB session memory: {e}")
                return False


# Aliases for backward compatibility
HostSessionMemory = SwarmSharedMemory
CorrectionMemory = SwarmSharedMemory
