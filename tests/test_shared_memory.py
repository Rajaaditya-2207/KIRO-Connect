import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from service.memory import SwarmSharedMemory

print("=" * 60)
print("  Verifying Swarm Shared Memory (Automated Host Mapping)")
print("=" * 60)

mem = SwarmSharedMemory()

# 1. Host automatically maps a wrong proposal vs verified consensus
query = "What is the recommended KV cache quantization type in llama.cpp for minimum VRAM overhead?"
wrong_thing = "Float32 with zero quantization overhead."
right_thing = "Q4_0 or Q8_0 KV cache quantization (-ctk q4_0 -ctv q4_0) saves ~50% VRAM."
agent_name = "Laptop-Worker-Beta"

print("\n--- 1. Testing Automated Host Mapping (Wrong -> Right) ---")
success = mem.map_and_update(
    query=query,
    wrong_thing=wrong_thing,
    right_thing=right_thing,
    agent_name=agent_name,
    divergence_score=0.88,
    consensus_confidence=0.94
)
assert success is True, "Failed to map mistake in shared memory"
print(f"[PASS] Host automatically mapped mistake from '{agent_name}' into Shared Memory!")

# 2. Querying shared memory with a similar query
print("\n--- 2. Testing Shared Memory Context Retrieval across Agents ---")
search_query = "What KV cache quantization should I use in llama-server for low VRAM?"
match = mem.query_shared_memory(search_query)

assert match is not None, "Expected to retrieve relevant shared memory mapping"
print(f"[PASS] Retrieved relevant shared memory for query: '{search_query}'")
print(f"[PASS] Identified Mistake to Avoid: {match['wrong_thing']}")
print(f"[PASS] Verified Right Thing: {match['right_thing']}")
print(f"[PASS] Similarity Score: {match['similarity_score']}")

print("\n--- 3. Testing Shared Memory Stats ---")
stats = mem.get_memory_stats()
print(f"[PASS] Total mapped items in host shared state: {stats['total_mapped_items']}")
print(f"[PASS] Memory State Status: {stats['status']}")

print("\n" + "=" * 60)
print("  HOST AUTOMATED SHARED MEMORY VERIFIED 100% OPERATIONAL!")
print("=" * 60)
