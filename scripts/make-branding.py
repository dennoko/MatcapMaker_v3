# Builds the app icon and developer logo assets from branding/*-source.png.
#   python scripts/make-branding.py      (requires Pillow)
#   pnpm tauri icon app-icon.png         (regenerates src-tauri/icons/*)
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'branding'

# --- app icon: 1024 px square RGBA (source for `tauri icon`) + 256 px favicon ---
icon = Image.open(BRAND / 'app-icon-source.png').convert('RGBA')
icon.resize((1024, 1024), Image.LANCZOS).save(ROOT / 'app-icon.png', optimize=True)
icon.resize((256, 256), Image.LANCZOS).save(ROOT / 'public' / 'favicon.png', optimize=True)

# --- developer logo: black on transparent -> inverted to white, trimmed, 160 px tall ---
logo = Image.open(BRAND / 'dennokoworks-logo-source.png').convert('RGBA')
alpha = logo.getchannel('A')
left, top, right, bottom = alpha.getbbox()
pad = (bottom - top) // 16
alpha = alpha.crop((left - pad, top - pad, right + pad, bottom + pad))
white = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
white.putalpha(alpha)
h = 160
white = white.resize((round(white.width * h / white.height), h), Image.LANCZOS)
white.save(ROOT / 'src' / 'assets' / 'dennokoworks-logo.png', optimize=True)
print('wrote app-icon.png, public/favicon.png, src/assets/dennokoworks-logo.png')
