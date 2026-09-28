"""
Generate all required icons from the user's provided KIRO-Connect logo.
"""
import os
from pathlib import Path
from PIL import Image

SRC_IMAGE = Path(r"C:\Users\rajaa\.gemini\antigravity-ide\brain\cf7a0490-0707-479b-8281-6966504d35de\.user_uploaded\media_1790560290308.jpg")
PROJECT_ROOT = Path(__file__).parent.parent
PUBLIC_DIR = PROJECT_ROOT / "public"
ICONS_DIR = PROJECT_ROOT / "src-tauri" / "icons"

def main():
    if not SRC_IMAGE.exists():
        raise FileNotFoundError(f"Source image not found: {SRC_IMAGE}")

    print(f"Loading user logo from: {SRC_IMAGE}")
    img = Image.open(SRC_IMAGE).convert("RGBA")
    w, h = img.size
    print(f"Image size: {w}x{h}")

    PUBLIC_DIR.mkdir(exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Save standard web logos
    web_logo_path = PUBLIC_DIR / "kiro-logo.png"
    img.save(web_logo_path, format="PNG")
    print(f"Saved: {web_logo_path}")

    # 2. Save favicon
    favicon_path = PUBLIC_DIR / "favicon.ico"
    img.resize((32, 32), Image.Resampling.LANCZOS).save(favicon_path, format="ICO")
    print(f"Saved: {favicon_path}")

    # 3. Save standard Tauri icon.png
    tauri_icon_png = ICONS_DIR / "icon.png"
    img.save(tauri_icon_png, format="PNG")
    print(f"Saved: {tauri_icon_png}")

    # 4. Generate multi-resolution Windows ICO
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_path = ICONS_DIR / "icon.ico"
    img.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"Saved: {ico_path}")

    # 5. Generate specific png sizes for Tauri
    sizes = {
        "32x32.png": (32, 32),
        "128x128.png": (128, 128),
        "128x128@2x.png": (256, 256),
        "Square30x30Logo.png": (30, 30),
        "Square44x44Logo.png": (44, 44),
        "Square71x71Logo.png": (71, 71),
        "Square89x89Logo.png": (89, 89),
        "Square107x107Logo.png": (107, 107),
        "Square142x142Logo.png": (142, 142),
        "Square150x150Logo.png": (150, 150),
        "Square284x284Logo.png": (284, 284),
        "Square310x310Logo.png": (310, 310),
        "StoreLogo.png": (50, 50),
    }

    for name, (sw, sh) in sizes.items():
        resized = img.resize((sw, sh), Image.Resampling.LANCZOS)
        target = ICONS_DIR / name
        resized.save(target, format="PNG")
        print(f"Saved: {target}")

    print("\nAll application and executable logos generated successfully!")

if __name__ == "__main__":
    main()
