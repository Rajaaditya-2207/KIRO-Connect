"""
KIRO-Connect — CLI & Background Entrypoint
Launches the Swarm Gateway or Worker Node service.
"""

import sys
import os
from pathlib import Path
import argparse
import uvicorn

# Ensure repository root is on sys.path regardless of execution entrypoint
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

def main():
    parser = argparse.ArgumentParser(description="KIRO-Connect Swarm Service")
    parser.add_argument("--mode", choices=["host", "worker"], default="host", help="Run mode")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host bind address")
    args = parser.parse_args()

    print(f"Starting KIRO-Connect in {args.mode.upper()} mode on {args.host}:{args.port}...")
    from service.gateway import app
    uvicorn.run(app, host=args.host, port=args.port, reload=False)

if __name__ == "__main__":
    main()
