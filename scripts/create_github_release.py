"""
Create and update GitHub Release on Rajaaditya-2207/KIRO-Connect and upload the Windows binary assets.
"""
import os
import sys
import json
import subprocess
from pathlib import Path
import urllib.request
import urllib.error

REPO = "Rajaaditya-2207/KIRO-Connect"
TAG = "v0.1.0"
RELEASE_NAME = "KIRO-Connect v0.1.0 — Windows Release (All-In-One Standalone EXE & MSI Installer)"
RELEASE_BODY = """## 🚀 KIRO-Connect v0.1.0: Windows Release

Official Windows release packages for **KIRO-Connect: A Decentralized Peer-to-Peer Mixture-of-Agents Framework for Secure and Private Local LLM Inference over LAN**.

### 📦 Windows Distribution Assets:
- **`KIRO-Connect-Setup.msi`** (~72 MB): **Official Windows 64-bit MSI Installer**. Installs KIRO-Connect cleanly to Program Files, provisions Desktop and Start Menu shortcuts, and registers standard Windows Add/Remove Programs support.
- **`KIRO-Connect.exe`** (~72 MB): **All-in-One Integrated Standalone Portable Executable**. Bundles the FastAPI/Uvicorn backend, ChromaDB vector store, and full Cyberpunk React frontend into a single standalone file. No Python, terminal, or installer required—just double-click and run!
- **`KIRO-Connect-v0.1.0-Source.zip`** (~1.5 MB): Clean source code archive containing all frontend React components, FastAPI MoA orchestration services, and build scripts.

### ✨ Highlights:
- **Decentralized LAN MoA:** Multi-layer Mixture-of-Agents reasoning across local machines.
- **Dynamic 6-Digit PIN Security:** Private pairing handshake with session token authentication.
- **Zeroconf (mDNS) Discovery:** Zero-configuration swarm discovery on LAN.
- **Automated Host Shared Memory:** Autonomous orchestrator memory engine that maps agent proposal divergences against verified consensus ("wrong things" vs "right things") into shared ChromaDB state.
- **llama.cpp Engine:** Native llama-server process lifecycle management.
- **Zero Cloud Leakage:** 100% private, local inference without external telemetry or data tracking.
"""

def get_git_token():
    proc = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n",
        capture_output=True,
        text=True,
        check=True
    )
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("Failed to extract GitHub token from git credential manager")

def make_request(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req) as resp:
        return resp.getcode(), json.loads(resp.read().decode("utf-8"))

def main():
    token = get_git_token()
    print("Retrieved GitHub token from credential manager.")

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "KIRO-Connect-Uploader"
    }

    # 1. Check if release already exists
    release_url = f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}"
    release_data = None
    try:
        _, release_data = make_request(release_url, headers=headers)
        print(f"Found existing release for tag {TAG} (ID: {release_data['id']})")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"No existing release for tag {TAG}. Creating a new release...")
        else:
            raise

    # 2. Create release if needed or update metadata
    if not release_data:
        create_url = f"https://api.github.com/repos/{REPO}/releases"
        payload = {
            "tag_name": TAG,
            "target_commitish": "main",
            "name": RELEASE_NAME,
            "body": RELEASE_BODY,
            "draft": False,
            "prerelease": False
        }
        status, release_data = make_request(
            create_url,
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"}
        )
        print(f"Created new release (ID: {release_data['id']})")
    else:
        # Update existing release title and body
        patch_url = f"https://api.github.com/repos/{REPO}/releases/{release_data['id']}"
        payload = {
            "name": RELEASE_NAME,
            "body": RELEASE_BODY
        }
        _, release_data = make_request(
            patch_url,
            method="PATCH",
            data=json.dumps(payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"}
        )
        print("Updated release metadata.")

    upload_url_template = release_data["upload_url"]
    base_upload_url = upload_url_template.split("{")[0]

    # Existing assets
    existing_assets = {a["name"]: a["id"] for a in release_data.get("assets", [])}

    # 3. Assets we want to keep
    target_assets = {
        "KIRO-Connect-Setup.msi": Path("release/KIRO-Connect-Setup.msi"),
        "KIRO-Connect.exe": Path("release/KIRO-Connect.exe"),
        "KIRO-Connect-v0.1.0-Source.zip": Path("release/KIRO-Connect-v0.1.0-Source.zip")
    }

    # Delete any unwanted assets that are NOT in target_assets
    for asset_name, asset_id in existing_assets.items():
        if asset_name not in target_assets:
            print(f"Deleting unwanted old asset {asset_name} (ID: {asset_id})...")
            delete_url = f"https://api.github.com/repos/{REPO}/releases/assets/{asset_id}"
            del_req = urllib.request.Request(delete_url, headers=headers, method="DELETE")
            urllib.request.urlopen(del_req)
            print(f"Successfully deleted {asset_name}.")

    # Re-fetch existing assets after cleanup
    _, updated_rel = make_request(f"https://api.github.com/repos/{REPO}/releases/{release_data['id']}", headers=headers)
    current_assets = {a["name"]: a["id"] for a in updated_rel.get("assets", [])}

    # 4. Upload target assets
    for filename, asset_path in target_assets.items():
        if not asset_path.exists():
            print(f"Error: {asset_path} does not exist!")
            continue

        if filename in current_assets:
            print(f"Deleting existing asset {filename} (ID: {current_assets[filename]}) before re-upload...")
            delete_url = f"https://api.github.com/repos/{REPO}/releases/assets/{current_assets[filename]}"
            del_req = urllib.request.Request(delete_url, headers=headers, method="DELETE")
            urllib.request.urlopen(del_req)
            print(f"Deleted old {filename}.")

        print(f"Uploading {filename} ({asset_path.stat().st_size / (1024*1024):.2f} MB)...")
        upload_target = f"{base_upload_url}?name={filename}"
        with open(asset_path, "rb") as f:
            file_data = f.read()

        up_headers = {
            **headers,
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(file_data))
        }
        up_req = urllib.request.Request(upload_target, data=file_data, headers=up_headers, method="POST")
        with urllib.request.urlopen(up_req) as up_resp:
            resp_json = json.loads(up_resp.read().decode("utf-8"))
            print(f"Successfully uploaded {filename}! Browser download URL: {resp_json['browser_download_url']}")

    print("\nRelease assets synchronized successfully!")
    print(f"Release URL: {release_data['html_url']}")

if __name__ == "__main__":
    main()
