"""
Create a GitHub Release on Rajaaditya-2207/KIRO-Connect and upload the Windows binary assets.
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
RELEASE_NAME = "KIRO-Connect v0.1.0 — Windows Release (Installer & Standalone EXE)"
RELEASE_BODY = """## 🚀 KIRO-Connect v0.1.0: Windows Release

Official Windows binaries for **KIRO-Connect: A Decentralized Peer-to-Peer Mixture-of-Agents Framework for Secure and Private Local LLM Inference over LAN**.

### 📦 Included Release Assets:
- **`KIRO-Connect-Installer.exe`** (1.92 MB): Full Windows setup wizard with Start Menu shortcuts and Desktop icon.
- **`KIRO-Connect.exe`** (5.01 MB): Standalone portable desktop executable built with Tauri v2.

### ✨ Highlights:
- **Decentralized LAN MoA:** Multi-layer Mixture-of-Agents reasoning across local computers.
- **Dynamic 6-Digit PIN Security:** Private pairing handshake with session token authentication.
- **Zeroconf (mDNS) Discovery:** Zero-configuration swarm discovery on LAN.
- **ChromaDB Correction Memory:** Self-correcting RAG grounded in vector memory triples.
- **llama.cpp Engine:** Native llama-server process lifecycle management.
- **Custom Cyberpunk Theme:** Always-dark UI with real-time hardware telemetry and outlier detection.
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

    # 2. Create release if needed
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

    upload_url_template = release_data["upload_url"] # e.g. https://uploads.github.com/repos/.../assets{?name,label}
    base_upload_url = upload_url_template.split("{")[0]

    # Existing assets
    existing_assets = {a["name"]: a["id"] for a in release_data.get("assets", [])}

    # 3. Upload assets
    assets_to_upload = [
        Path("release/KIRO-Connect-Installer.exe"),
        Path("release/KIRO-Connect.exe")
    ]

    for asset_path in assets_to_upload:
        if not asset_path.exists():
            print(f"Warning: {asset_path} does not exist!")
            continue

        filename = asset_path.name
        if filename in existing_assets:
            print(f"Deleting existing asset {filename} (ID: {existing_assets[filename]})...")
            delete_url = f"https://api.github.com/repos/{REPO}/releases/assets/{existing_assets[filename]}"
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

    print("\nRelease publishing completed successfully!")
    print(f"Release URL: {release_data['html_url']}")

if __name__ == "__main__":
    main()
