# KIRO-Connect Remediation, Build & Release Plan

## Goal
Resolve all runtime, security, concurrency, process lifecycle, consensus calculation, and UI/UX issues across KIRO-Connect. Rebuild the frontend, compile the native Windows release binaries (Installer & Standalone EXE), and push the release to GitHub.

---

## Action Checklist

### Phase 1: Core Runtime Blockers & Concurrency Safety
- [x] **Task 1.1:** Fix Windows `0.0.0.0` healthcheck crash in `service/llama_manager.py` (connect to `127.0.0.1` locally when checking `/health`).
- [x] **Task 1.2:** Update `requirements.txt` with `pywebview>=5.0.0` and `Pillow>=10.0.0`.
- [x] **Task 1.3:** Implement `threading.Lock()` in `service/memory.py` to serialize SQLite ChromaDB writes.
- [x] **Task 1.4:** Fix `get_all_corrections()` in `service/memory.py` to return real records from ChromaDB instead of mock data.

### Phase 2: Process Management & Windows System Hygiene
- [x] **Task 2.1:** Update `src-tauri/src/lib.rs` to terminate the spawned Python child process when the Tauri window is closed or destroyed.
- [x] **Task 2.2:** Update `launch.ps1` to detect MSVC Build Tools via `vswhere.exe` and invoke `vcvars64.bat` if `link.exe` is not in `$env:PATH`.
- [x] **Task 2.3:** Add depth and count limits to `scan_custom_directory()` in `service/llama_manager.py` to prevent full-drive freezing.
- [x] **Task 2.4:** Standardize `service/discovery.py` to cancel `ServiceBrowser` before closing Zeroconf, and ensure `get_local_ip()` prioritizes the verified active route.

### Phase 3: Consensus Math, Security & API Hardening
- [x] **Task 3.1:** Enhance `compute_text_similarity` in `service/orchestrator.py` with punctuation stripping and negation mismatch penalties.
- [x] **Task 3.2:** Fix 2-node divergence handling and decay logic in `service/orchestrator.py`.
- [x] **Task 3.3:** Add streaming SSE (`stream: True`) support and non-empty message validation to `/v1/chat/completions` in `service/gateway.py`.
- [x] **Task 3.4:** Add session token verification to `POST /api/swarm/heartbeat`.
- [x] **Task 3.5:** Wrap candidate inputs in XML tags in `service/orchestrator.py` to guard against prompt injection.

### Phase 4: Frontend UI/UX & MoA Playground
- [x] **Task 4.1:** Restore and polish the interactive "MoA Swarm Playground" tab in `src/App.tsx`.
- [x] **Task 4.2:** Implement safe clipboard copying fallback (`copyTextToClipboard`) for insecure LAN HTTP contexts.
- [x] **Task 4.3:** Update `src/App.css` `.grid-cards-4` to an auto-fit responsive grid (`repeat(auto-fit, minmax(210px, 1fr))`) to symmetrically display the 5 stat cards.
- [x] **Task 4.4:** Replace blocking `alert()` popups with inline notification toasts in `src/App.tsx`.
- [x] **Task 4.5:** Modernize `API_BASE` resolution to work on any custom port.

### Phase 5: Verification, Build & GitHub Release
- [x] **Task 5.1:** Rebuild frontend via `npm run build`.
- [x] **Task 5.2:** Run integration test suite (`scratch/test_integration.py` & `scratch/test_shared_memory.py`).
- [x] **Task 5.3:** Build native Windows release binary (`release/KIRO-Connect.exe`) and NSIS installer (`release/KIRO-Connect-Installer.exe`) via `npm run tauri build`.
- [x] **Task 5.4:** Commit all fixes to git and push to `origin/main`.
- [x] **Task 5.5:** Publish updated GitHub release v0.1.0 and upload release artifacts via `scripts/create_github_release.py`.
