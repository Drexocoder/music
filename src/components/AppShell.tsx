from pathlib import Path
from PIL import Image

# Source artwork generated for the Aurora logo in the previous step.
source = Path("/mnt/data/a_high_resolution_stylized_anime_themed_logo_artw.png")
app_shell_source = Path("/mnt/data/Pasted text(20260905-124449).txt")

if not source.exists():
    raise FileNotFoundError(f"Logo artwork not found: {source}")
if not app_shell_source.exists():
    raise FileNotFoundError(f"AppShell source not found: {app_shell_source}")

# Create the requested filename: Auroralogo.png
img = Image.open(source).convert("RGB")
# Crop away the large empty black border while preserving the complete emblem.
crop = img.crop((230, 220, 1030, 1030))
logo = crop.resize((512, 512), Image.Resampling.LANCZOS)

aurora_logo = Path("/mnt/data/Auroralogo.png")
logo.save(aurora_logo, optimize=True)

# Create a favicon from the same compact artwork.
favicon = crop.resize((128, 128), Image.Resampling.LANCZOS)
favicon_path = Path("/mnt/data/favicon.ico")
favicon.save(
    favicon_path,
    format="ICO",
    sizes=[(128, 128), (64, 64), (32, 32), (16, 16)]
)

# Build a complete AppShell replacement using /Auroralogo.png.
code = app_shell_source.read_text(encoding="utf-8")

# Remove Music4 only from the lucide import.
code = code.replace("  Music4,\n", "")

desktop_old = """            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
              <Music4 className="size-5" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Aurora</span>"""

desktop_new = """            <div className="size-10 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-black shadow-glow">
              <img
                src="/Auroralogo.png"
                alt="Aurora Music"
                className="size-full object-cover"
              />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Aurora</span>"""

mobile_old = """              <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Music4 className="size-5" />
              </div>
              <span className="font-display text-lg font-bold">Aurora</span>"""

mobile_new = """              <div className="size-10 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-black shadow-glow">
                <img
                  src="/Auroralogo.png"
                  alt="Aurora Music"
                  className="size-full object-cover"
                />
              </div>
              <span className="font-display text-lg font-bold">Aurora</span>"""

if desktop_old not in code:
    raise RuntimeError("Desktop logo block not found.")
if mobile_old not in code:
    raise RuntimeError("Mobile logo block not found.")

code = code.replace(desktop_old, desktop_new)
code = code.replace(mobile_old, mobile_new)

# Keep the rest of AppShell unchanged.
app_shell = Path("/mnt/data/AppShell.tsx")
app_shell.write_text(code, encoding="utf-8")

print("Created the complete Aurora logo fix:")
print(f"- {aurora_logo}")
print(f"- {favicon_path}")
print(f"- {app_shell}")
