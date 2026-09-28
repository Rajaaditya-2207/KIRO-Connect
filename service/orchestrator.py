"""
KIRO-Connect — Mixture-of-Agents (MoA) Orchestrator
Fans prompts out to connected LAN worker nodes, aggregates responses,
computes semantic + logprob confidence, and flags divergent nodes.
"""

import math
import time
import logging
import asyncio
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
import httpx

logger = logging.getLogger("kiro.orchestrator")


@dataclass
class SwarmNode:
    id: str
    name: str
    endpoint: str
    api_key: str
    model: str
    hardware: str = "GPU/CPU"
    status: str = "idle"  # "idle", "busy", "flagged"
    divergence_count: int = 0
    total_prompts: int = 0
    total_tokens: int = 0
    total_generation_time: float = 0.0
    last_latency_ms: float = 0.0
    last_tokens_per_sec: float = 0.0
    is_host_local: bool = False

    @property
    def avg_tokens_per_sec(self) -> float:
        if self.total_generation_time > 0 and self.total_tokens > 0:
            return round(self.total_tokens / self.total_generation_time, 1)
        return self.last_tokens_per_sec


def compute_text_similarity(text1: str, text2: str) -> float:
    """
    Computes lexical / n-gram token overlap cosine similarity between two answers.
    Fast, deterministic, and works without heavy external models.
    """
    if not text1 or not text2:
        return 0.0
    if text1.strip().lower() == text2.strip().lower():
        return 1.0

    words1 = text1.lower().split()
    words2 = text2.lower().split()

    if not words1 or not words2:
        return 0.0

    # Build word frequency vectors
    freq1: Dict[str, int] = {}
    for w in words1:
        freq1[w] = freq1.get(w, 0) + 1

    freq2: Dict[str, int] = {}
    for w in words2:
        freq2[w] = freq2.get(w, 0) + 1

    all_words = set(freq1.keys()).union(set(freq2.keys()))
    dot_product = sum(freq1.get(w, 0) * freq2.get(w, 0) for w in all_words)
    mag1 = math.sqrt(sum(v * v for v in freq1.values()))
    mag2 = math.sqrt(sum(v * v for v in freq2.values()))

    if mag1 == 0 or mag2 == 0:
        return 0.0

    return dot_product / (mag1 * mag2)


class MoAOrchestrator:
    """Manages swarm node pool, concurrent inference fan-out, and MoA aggregation."""

    def __init__(self):
        self.nodes: Dict[str, SwarmNode] = {}
        self.total_gateway_requests: int = 0
        self.total_gateway_tokens: int = 0
        self.divergence_threshold: float = 0.45  # Divergence threshold
        self.divergence_flag_limit: int = 3      # Consecutive divergences to flag

    def register_node(self, node: SwarmNode):
        self.nodes[node.id] = node
        logger.info(f"Registered swarm node: {node.name} ({node.id}) at {node.endpoint}")

    def unregister_node(self, node_id: str):
        if node_id in self.nodes:
            logger.info(f"Unregistering swarm node: {self.nodes[node_id].name}")
            del self.nodes[node_id]

    def get_healthy_nodes(self) -> List[SwarmNode]:
        """Returns non-flagged nodes available for inference."""
        return [n for n in self.nodes.values() if n.status != "flagged"]

    def reset_node_flag(self, node_id: str) -> bool:
        """Restores a flagged node back into the active pool."""
        node = self.nodes.get(node_id)
        if node:
            node.status = "idle"
            node.divergence_count = 0
            logger.info(f"Node '{node.name}' ({node_id}) has been unflagged and restored to active pool.")
            return True
        return False

    async def _query_single_node(
        self,
        node: SwarmNode,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024
    ) -> Optional[Dict[str, Any]]:
        """Sends an OpenAI-compatible completion request to a node's llama.cpp instance."""
        node.status = "busy"
        url = f"{node.endpoint.rstrip('/')}/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {node.api_key}" if node.api_key else ""
        }
        payload = {
            "model": node.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "logprobs": True,
            "top_logprobs": 1
        }

        start_time = time.time()
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                elapsed = time.time() - start_time

                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        node.status = "idle"
                        return None

                    content = choices[0].get("message", {}).get("content", "")
                    usage = data.get("usage", {})
                    completion_tokens = usage.get("completion_tokens", max(1, len(content.split())))
                    prompt_tokens = usage.get("prompt_tokens", 0)

                    # Extract average logprob confidence if provided by llama-server
                    logprobs_info = choices[0].get("logprobs", {})
                    token_certainty = 0.8  # Default reasonable confidence
                    if logprobs_info and "content" in logprobs_info:
                        content_lps = logprobs_info["content"]
                        lps = [tok.get("logprob") for tok in content_lps if tok.get("logprob") is not None]
                        if lps:
                            avg_logprob = sum(lps) / len(lps)
                            token_certainty = max(0.1, min(1.0, math.exp(avg_logprob)))

                    # Update node stats
                    node.total_prompts += 1
                    node.total_tokens += completion_tokens
                    node.total_generation_time += elapsed
                    node.last_latency_ms = round(elapsed * 1000, 1)
                    tps = round(completion_tokens / elapsed, 1) if elapsed > 0 else 0.0
                    node.last_tokens_per_sec = tps
                    node.status = "idle"

                    return {
                        "node_id": node.id,
                        "node_name": node.name,
                        "content": content,
                        "tokens": completion_tokens,
                        "prompt_tokens": prompt_tokens,
                        "latency_ms": node.last_latency_ms,
                        "tokens_per_sec": tps,
                        "token_certainty": token_certainty
                    }
                else:
                    logger.warning(f"Node {node.name} returned HTTP {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            logger.error(f"Error communicating with node {node.name}: {e}")
        finally:
            if node.status == "busy":
                node.status = "idle"

        return None

    def _evaluate_consensus_and_flag(
        self,
        candidate_results: List[Dict[str, Any]]
    ) -> Tuple[float, List[str], Dict[str, float]]:
        """
        Calculates pairwise cross-agreement, overall semantic confidence score,
        and identifies divergent nodes.
        """
        n = len(candidate_results)
        if n == 0:
            return 0.0, [], {}
        if n == 1:
            # Single node: confidence is purely its token certainty
            cert = candidate_results[0].get("token_certainty", 0.8)
            return round(cert, 3), [], {candidate_results[0]["node_id"]: 1.0}

        # Compute pairwise similarity matrix
        sim_scores: Dict[str, float] = {}
        pairwise_sum = 0.0
        pair_count = 0

        for i in range(n):
            node_id_i = candidate_results[i]["node_id"]
            text_i = candidate_results[i]["content"]
            agreements = []
            for j in range(n):
                if i != j:
                    text_j = candidate_results[j]["content"]
                    sim = compute_text_similarity(text_i, text_j)
                    agreements.append(sim)
                    if i < j:
                        pairwise_sum += sim
                        pair_count += 1
            avg_agreement = sum(agreements) / len(agreements) if agreements else 1.0
            sim_scores[node_id_i] = avg_agreement

        overall_semantic = (pairwise_sum / pair_count) if pair_count > 0 else 1.0

        # Mean token certainty across all nodes
        mean_token_cert = sum(c.get("token_certainty", 0.8) for c in candidate_results) / n

        # Combined hybrid confidence (PRD 5.4 requirement: cross-node agreement + logprobs)
        final_confidence = round(0.6 * overall_semantic + 0.4 * mean_token_cert, 3)

        # Trust checking: flag nodes that diverge significantly from peer consensus
        flagged_nodes = []
        for i, cand in enumerate(candidate_results):
            node_id = cand["node_id"]
            agreement = sim_scores.get(node_id, 1.0)
            node_obj = self.nodes.get(node_id)
            if not node_obj:
                continue

            is_divergent = False
            if n >= 3:
                # Calculate consensus among all peer nodes excluding this candidate
                other_indices = [idx for idx in range(n) if idx != i]
                peer_sims = []
                for p1 in range(len(other_indices)):
                    for p2 in range(p1 + 1, len(other_indices)):
                        idx1 = other_indices[p1]
                        idx2 = other_indices[p2]
                        peer_sims.append(compute_text_similarity(
                            candidate_results[idx1]["content"],
                            candidate_results[idx2]["content"]
                        ))
                peer_consensus = (sum(peer_sims) / len(peer_sims)) if peer_sims else 1.0

                # Outlier rule: peers agree among themselves (>= 0.45) but this candidate diverges (< threshold)
                if peer_consensus >= 0.45 and agreement < self.divergence_threshold:
                    is_divergent = True
            elif n == 2:
                # Two nodes: if they diverge severely (< 0.25)
                if agreement < 0.25:
                    other_cand = candidate_results[1 - i]
                    if cand.get("token_certainty", 0.8) < other_cand.get("token_certainty", 0.8) - 0.2:
                        is_divergent = True

            if is_divergent:
                node_obj.divergence_count += 1
                logger.warning(
                    f"Node '{node_obj.name}' diverged (agreement: {round(agreement, 2)}). "
                    f"Divergence count: {node_obj.divergence_count}/{self.divergence_flag_limit}"
                )
                if node_obj.divergence_count >= self.divergence_flag_limit:
                    node_obj.status = "flagged"
                    logger.error(f"Node '{node_obj.name}' has been FLAGGED due to repeated divergence.")
                    flagged_nodes.append(node_obj.name)
            else:
                # Healthy response: slowly decay divergence penalty if not flagged
                if node_obj.status != "flagged" and node_obj.divergence_count > 0:
                    node_obj.divergence_count -= 1

        return final_confidence, flagged_nodes, sim_scores

    async def execute_moa_pipeline(
        self,
        messages: List[Dict[str, str]],
        correction_context: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024
    ) -> Dict[str, Any]:
        """
        Executes full Mixture-of-Agents pipeline:
        1. Inject past correction memory into prompt context if available.
        2. Propose: fan out concurrently to all active nodes.
        3. Collect & Evaluate: compute consensus agreement, logprob certainty, flag divergent nodes.
        4. Synthesize: synthesize or select best consensus response.
        5. Return structured OpenAI response with extra metadata.
        """
        self.total_gateway_requests += 1
        active_nodes = self.get_healthy_nodes()

        if not active_nodes:
            raise RuntimeError("No active swarm nodes available. Please launch host llama-server or connect workers.")

        # Inject correction memory into system context if relevant past mistake was recalled
        augmented_messages = list(messages)
        if correction_context:
            augmented_messages.insert(0, {
                "role": "system",
                "content": f"[KIRO-Connect Swarm Memory — Past Correction Notice]\n{correction_context}"
            })

        # Phase 1: Fan-out concurrent queries
        tasks = [
            self._query_single_node(node, augmented_messages, temperature, max_tokens)
            for node in active_nodes
        ]
        results = await asyncio.gather(*tasks)
        valid_results = [r for r in results if r is not None and r.get("content")]

        if not valid_results:
            raise RuntimeError("All swarm nodes failed to produce an answer.")

        # Phase 2: Compute cross-agreement and detect divergence
        confidence, newly_flagged, agreement_map = self._evaluate_consensus_and_flag(valid_results)

        # Contributing nodes list
        contributing_nodes = [r["node_name"] for r in valid_results]

        # Extract divergent candidate proposals (WRONG THINGS to map against RIGHT THING)
        divergent_candidates = [
            r for r in valid_results
            if agreement_map.get(r["node_id"], 1.0) < 0.65 or r["node_name"] in newly_flagged
        ]

        # Phase 3: Synthesis / Aggregation (Reference: togethercomputer/MoA)
        # Find candidate with highest agreement to consensus
        best_candidate = max(valid_results, key=lambda x: agreement_map.get(x["node_id"], 0.0))
        final_text = best_candidate["content"]

        # If we have multiple nodes with diverse outputs, perform synthesis pass if host node is active
        host_node = next((n for n in active_nodes if n.is_host_local), None)
        if len(valid_results) >= 2 and host_node and confidence < 0.90:
            candidates_formatted = "\n\n".join(
                f"[Candidate from {r['node_name']}]:\n{r['content']}" for r in valid_results
            )
            orig_prompt = messages[-1].get("content", "")
            synthesis_messages = [
                {
                    "role": "system",
                    "content": (
                        "You are the Mixture-of-Agents (MoA) Synthesizer for KIRO-Connect. "
                        "You have been provided with candidate answers from multiple peer LLMs on the LAN. "
                        "Synthesize these responses into a single, cohesive, accurate, and high-quality final answer."
                    )
                },
                {
                    "role": "user",
                    "content": f"Original Request:\n{orig_prompt}\n\nCandidate Answers:\n{candidates_formatted}\n\nFinal Synthesized Answer:"
                }
            ]
            synth_res = await self._query_single_node(host_node, synthesis_messages, temperature=0.5, max_tokens=max_tokens)
            if synth_res and synth_res.get("content"):
                final_text = synth_res["content"]

        total_tokens_used = sum(r.get("tokens", 0) for r in valid_results)
        self.total_gateway_tokens += total_tokens_used

        # Build OpenAI chat completion response dictionary
        response_id = f"chatcmpl-kiro-{int(time.time() * 1000)}"
        return {
            "id": response_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "kiro-connect-moa",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": final_text
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": valid_results[0].get("prompt_tokens", 0),
                "completion_tokens": len(final_text.split()),
                "total_tokens": valid_results[0].get("prompt_tokens", 0) + len(final_text.split())
            },
            # Non-breaking extra metadata (PRD Section 5.4a)
            "kiro_confidence": confidence,
            "contributing_nodes": contributing_nodes,
            "flagged_nodes": newly_flagged,
            "swarm_tokens_computed": total_tokens_used,
            "_divergent_candidates": [
                {
                    "node_id": c["node_id"],
                    "node_name": c["node_name"],
                    "content": c["content"],
                    "divergence_score": round(1.0 - agreement_map.get(c["node_id"], 0.0), 3)
                }
                for c in divergent_candidates
            ],
            "_final_text": final_text
        }
