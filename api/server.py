"""Aurora downloader service.

Long-running yt-dlp sidecar used by Replit/local development and by the
Vercel container service. It always produces real files:

* ``type=audio`` -> MP3 (via ffmpeg)
* ``type=video`` -> MP4 (merged/remuxed via ffmpeg)

Endpoints:
    GET /health
    GET /api/download/health
    GET /download?id=<video id>&type=audio|video
    GET /api/download/<video id>?type=audio|video
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote


# =========================================================
# ENVIRONMENT
# =========================================================

API_KEY = os.environ.get("DOWNLOAD_API_KEY", "")
YOUTUBE_COOKIES_B64 = os.environ.get("YOUTUBE_COOKIES_B64", "")
YOUTUBE_COOKIES_TEXT = os.environ.get("YOUTUBE_COOKIES", "")
PORT = int(os.environ.get("PORT", "8080"))

# Total wall-clock budget for one download request. The container is not
# limited by a serverless timeout, but we still want a bounded request.
DOWNLOAD_TIMEOUT_SECONDS = float(
    os.environ.get("DOWNLOAD_TIMEOUT_SECONDS", "900")
)

MEDIA_TYPES = {
    "audio": {
        "extension": ".mp3",
        "content_type": "audio/mpeg",
        "label": "MP3 audio",
    },
    "video": {
        "extension": ".mp4",
        "content_type": "video/mp4",
        "label": "MP4 video",
    },
}


# =========================================================
# JSON RESPONSE
# =========================================================

def send_json(handler, status, data):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")

    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()

    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        pass


# =========================================================
# FILENAME HELPERS
# =========================================================

def safe_filename(filename, extension):
    filename = os.path.basename(filename)
    filename = re.sub(r"[\r\n\t]", " ", filename)
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", filename)
    filename = filename.strip(" .")

    if not filename:
        filename = "aurora-download"

    if not filename.lower().endswith(extension.lower()):
        filename += extension

    return filename


def ascii_filename(filename, extension):
    name_without_extension = os.path.splitext(filename)[0]
    ascii_name = name_without_extension.encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "_", ascii_name)
    ascii_name = re.sub(r"\s+", " ", ascii_name).strip(" .")

    if not ascii_name:
        ascii_name = "aurora-download"

    return ascii_name + extension


def content_disposition(filename, extension):
    fallback = ascii_filename(filename, extension)
    encoded = quote(filename, safe="")
    return (
        f'attachment; filename="{fallback}"; '
        f"filename*=UTF-8''{encoded}"
    )


# =========================================================
# VIDEO ID
# =========================================================

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def normalize_target(raw):
    """Return a YouTube URL for an id or a validated watch URL."""
    raw = (raw or "").strip()

    if not raw:
        return ""

    if VIDEO_ID_RE.match(raw):
        return "https://www.youtube.com/watch?v=" + raw

    try:
        parsed = urllib.parse.urlparse(raw)

        if parsed.scheme not in ("http", "https"):
            return ""

        host = (parsed.hostname or "").lower()

        if not (
            host.endswith("youtube.com")
            or host.endswith("youtube-nocookie.com")
            or host == "youtu.be"
        ):
            return ""

        return raw
    except Exception:
        return ""


def extract_path_video_id(path):
    for prefix in ("/api/download/", "/download/"):
        if not path.startswith(prefix):
            continue

        video_id = path[len(prefix):].strip("/").strip()

        if video_id and video_id != "health":
            return urllib.parse.unquote(video_id)

    return ""


# =========================================================
# RUNTIME DISCOVERY
# =========================================================

def ytdlp_command():
    """Return the base command used to run yt-dlp, or None."""
    explicit = os.environ.get("YTDLP_PATH", "").strip()

    if explicit:
        return [explicit]

    found = shutil.which("yt-dlp")

    if found:
        return [found]

    try:
        import yt_dlp  # noqa: F401

        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        return None


def ffmpeg_location():
    """Return an ffmpeg binary path understood by --ffmpeg-location."""
    explicit = os.environ.get("FFMPEG_LOCATION", "").strip()

    if explicit and os.path.exists(explicit):
        return explicit

    found = shutil.which("ffmpeg")

    if found:
        return found

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def js_runtime():
    """Pick an installed JavaScript runtime for yt-dlp's EJS challenges."""
    explicit = os.environ.get("YTDLP_JS_RUNTIME", "").strip()

    if explicit:
        return explicit

    for candidate in ("deno", "node", "bun"):
        if shutil.which(candidate):
            return candidate

    return None


# =========================================================
# COOKIE FILE
# =========================================================

def create_cookie_file(temp_dir):
    if not YOUTUBE_COOKIES_B64 and not YOUTUBE_COOKIES_TEXT:
        return None

    cookies_file = os.path.join(temp_dir, "cookies.txt")

    try:
        if YOUTUBE_COOKIES_B64:
            encoded = YOUTUBE_COOKIES_B64.strip()

            # Accept data URLs and base64 wrapped across multiple lines by
            # secret managers or shell copy/paste.
            if "," in encoded and encoded.lower().startswith("data:"):
                encoded = encoded.split(",", 1)[1]

            encoded = re.sub(r"\s+", "", encoded)

            try:
                cookie_bytes = base64.b64decode(
                    encoded,
                    altchars=b"-_",
                    validate=True,
                )
            except Exception:
                # Some exporters omit padding or use URL-safe base64.
                cookie_bytes = base64.urlsafe_b64decode(
                    encoded + "=" * (-len(encoded) % 4)
                )
        else:
            # Useful for local development. Deployments should prefer the
            # base64 secret so the cookie file never lives in the repository.
            cookie_bytes = YOUTUBE_COOKIES_TEXT.encode("utf-8")

        if not cookie_bytes:
            raise ValueError("Cookie data is empty")

        with open(cookies_file, "wb") as cookie_handle:
            cookie_handle.write(cookie_bytes)

        return cookies_file

    except Exception as exc:
        print("Failed to prepare YouTube cookies:", repr(exc), flush=True)
        return None


# =========================================================
# YT-DLP PROFILES
# =========================================================

def download_profiles(has_cookies):
    """Independent extraction profiles.

    YouTube can accept one client while rejecting another from the same IP.
    Cookies are the most reliable way through the data-center bot check, so
    authenticated profiles run first when a cookie file exists.
    """
    profiles = []

    if has_cookies:
        profiles.extend(
            [
                # Let yt-dlp choose its current default clients first; the
                # default selection tracks YouTube changes best.
                {"name": "default_with_cookies", "clients": None, "cookies": True},
                {"name": "web_safari_with_cookies", "clients": "web_safari", "cookies": True},
            ]
        )

    profiles.extend(
        [
            {"name": "default", "clients": None, "cookies": False},
            {"name": "tv", "clients": "tv", "cookies": False},
            {"name": "android_vr", "clients": "android_vr", "cookies": False},
            {"name": "web_embedded", "clients": "web_embedded", "cookies": False},
        ]
    )

    return profiles


def build_command(profile, media_type, target, output_template, cookies_file):
    command = [*YTDLP]

    command.extend(
        [
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            # Data-center networks frequently get IPv6 403s from YouTube.
            "--force-ipv4",
            "--socket-timeout",
            "20",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "--retry-sleep",
            "http:exp=1:20",
            "--output",
            output_template,
        ]
    )

    if profile["clients"]:
        command.extend(
            [
                "--extractor-args",
                f"youtube:player_client={profile['clients']}",
            ]
        )

    if JS_RUNTIME:
        command.extend(["--js-runtimes", JS_RUNTIME])

    if FFMPEG:
        command.extend(["--ffmpeg-location", FFMPEG])

    if profile["cookies"] and cookies_file:
        command.extend(["--cookies", cookies_file])

    if media_type == "video":
        command.extend(
            [
                "--format",
                (
                    "bv*[ext=mp4][vcodec^=avc1][height<=1080]+ba[ext=m4a]"
                    "/bv*[ext=mp4][height<=1080]+ba[ext=m4a]"
                    "/b[ext=mp4][height<=1080]"
                    "/b[ext=mp4]"
                    "/bv*+ba/b"
                ),
                "--merge-output-format",
                "mp4",
            ]
        )
    else:
        command.extend(
            [
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "5",
            ]
        )

    command.append(target)

    return command


# =========================================================
# DOWNLOADER
# =========================================================

class DownloadHandler(BaseHTTPRequestHandler):

    server_version = "AuroraDownloader/3.0"

    def log_message(self, format, *args):
        print(format % args, flush=True)

    # -----------------------------------------------------
    # HELPERS
    # -----------------------------------------------------

    def send_media(self, file_path, media_type, filename):
        file_size = os.path.getsize(file_path)

        self.send_response(200)
        self.send_header("Content-Type", media_type["content_type"])
        self.send_header(
            "Content-Disposition",
            content_disposition(filename, media_type["extension"]),
        )
        self.send_header("Content-Length", str(file_size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Aurora-Format", media_type["extension"].lstrip("."))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(file_path, "rb") as file:
            while True:
                chunk = file.read(1024 * 1024)

                if not chunk:
                    break

                try:
                    self.wfile.write(chunk)
                except BrokenPipeError:
                    print("Client disconnected during download", flush=True)
                    break

    # -----------------------------------------------------
    # GET
    # -----------------------------------------------------

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Health check.
        if path in ("/health", "/api/download/health"):
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": "aurora-download",
                    "yt_dlp": bool(YTDLP),
                    "ffmpeg": bool(FFMPEG),
                    "js_runtime": JS_RUNTIME,
                    "cookies_configured": bool(
                        YOUTUBE_COOKIES_B64 or YOUTUBE_COOKIES_TEXT
                    ),
                    "formats": ["mp3", "mp4"],
                },
            )
            return

        valid_download_path = (
            path in ("/download", "/download/")
            or (
                path.startswith("/api/download/")
                and path != "/api/download/health"
            )
        )

        if not valid_download_path:
            send_json(self, 404, {"error": "Not found"})
            return

        # API key.
        if API_KEY:
            supplied_key = self.headers.get("x-api-key", "")

            if supplied_key != API_KEY:
                send_json(self, 401, {"error": "Unauthorized"})
                return

        # Query parameters.
        query = urllib.parse.parse_qs(parsed.query)

        video_id = query.get("id", [""])[0].strip()
        youtube_url = query.get("url", [""])[0].strip()
        media_type_name = query.get("type", [""])[0].lower().strip()

        # Support ?format=mp3|mp4 as an alias for type.
        if not media_type_name:
            fmt = query.get("format", [""])[0].lower().strip()
            media_type_name = {
                "mp3": "audio",
                "mp4": "video",
            }.get(fmt, "")

        if not media_type_name:
            media_type_name = "audio"

        # Path style: /api/download/<id>
        if not video_id and not youtube_url:
            video_id = extract_path_video_id(path)

        target = normalize_target(video_id or youtube_url)

        if not target:
            send_json(
                self,
                400,
                {
                    "error": (
                        "Missing or invalid YouTube id/URL"
                    )
                },
            )
            return

        if media_type_name not in MEDIA_TYPES:
            send_json(
                self,
                400,
                {"error": "type must be audio or video"},
            )
            return

        media_type = MEDIA_TYPES[media_type_name]

        if not YTDLP:
            send_json(
                self,
                503,
                {
                    "error": "yt-dlp is not installed on the downloader service",
                    "details": (
                        'Install it with: python -m pip install "yt-dlp[default]"'
                    ),
                },
            )
            return

        if not FFMPEG:
            send_json(
                self,
                503,
                {
                    "error": "ffmpeg is not installed on the downloader service",
                    "details": (
                        "MP3 conversion and MP4 merging require ffmpeg. "
                        "Install ffmpeg or the imageio-ffmpeg Python package."
                    ),
                },
            )
            return

        temp_dir = tempfile.mkdtemp(prefix="aurora-")
        started = time.monotonic()

        try:
            cookies_file = create_cookie_file(temp_dir)
            output_template = os.path.join(
                temp_dir,
                "%(title).120s.%(ext)s",
            )

            profiles = download_profiles(bool(cookies_file))
            result = None
            successful_attempt = None
            details = ""

            for attempt_number, profile in enumerate(profiles, start=1):
                remaining = DOWNLOAD_TIMEOUT_SECONDS - (time.monotonic() - started)

                if remaining < 10:
                    details = "Download time budget exhausted."
                    break

                # Remove files produced by a previous failed attempt.
                for old_filename in os.listdir(temp_dir):
                    old_path = os.path.join(temp_dir, old_filename)

                    if os.path.isfile(old_path):
                        try:
                            os.remove(old_path)
                        except OSError:
                            pass

                command = build_command(
                    profile,
                    media_type_name,
                    target,
                    output_template,
                    cookies_file,
                )

                print("========================================", flush=True)
                print(
                    f"Aurora download attempt {attempt_number}/{len(profiles)}",
                    flush=True,
                )
                print("Profile:", profile["name"], flush=True)
                print("URL:", target, flush=True)
                print("Type:", media_type_name, flush=True)
                print("yt-dlp:", YTDLP[0], flush=True)
                print("ffmpeg:", FFMPEG or "NOT FOUND", flush=True)
                print("JS runtime:", JS_RUNTIME or "NOT FOUND", flush=True)
                print(
                    "Cookies:",
                    "enabled"
                    if profile["cookies"] and cookies_file
                    else "disabled",
                    flush=True,
                )

                safe_command = [
                    "<cookies>" if x == cookies_file else str(x)
                    for x in command
                ]
                print("Command:", " ".join(safe_command), flush=True)
                print("========================================", flush=True)

                try:
                    result = subprocess.run(
                        command,
                        capture_output=True,
                        text=True,
                        timeout=min(remaining, DOWNLOAD_TIMEOUT_SECONDS),
                    )
                except subprocess.TimeoutExpired as exc:
                    result = subprocess.CompletedProcess(
                        command,
                        124,
                        "",
                        f"Download attempt timed out: {exc}",
                    )

                if result.stdout.strip():
                    print(
                        f"yt-dlp stdout (attempt {attempt_number}):",
                        result.stdout[-8000:],
                        flush=True,
                    )

                if result.stderr.strip():
                    print(
                        f"yt-dlp stderr (attempt {attempt_number}):",
                        result.stderr[-8000:],
                        flush=True,
                    )

                if result.returncode == 0:
                    successful_attempt = profile["name"]
                    print(
                        "yt-dlp succeeded with profile:",
                        successful_attempt,
                        flush=True,
                    )
                    break

                details = (
                    result.stderr.strip()
                    or result.stdout.strip()
                    or details
                )
                print(
                    "yt-dlp attempt failed:",
                    profile["name"],
                    "return code:",
                    result.returncode,
                    flush=True,
                )

            if result is None or result.returncode != 0:
                send_json(
                    self,
                    504
                    if result is not None and result.returncode == 124
                    else 502,
                    {
                        "error": "yt-dlp download failed",
                        "details": (details or "Unknown yt-dlp error")[-6000:],
                    },
                )
                return

            print("Successful profile:", successful_attempt or "unknown", flush=True)

            # Find the produced file. Only the expected extension is valid:
            # returning an m4a/webm stream labelled as MP3/MP4 would corrupt
            # the file for the user.
            expected_extension = media_type["extension"]
            files = [
                os.path.join(temp_dir, filename)
                for filename in os.listdir(temp_dir)
                if os.path.isfile(os.path.join(temp_dir, filename))
            ]

            matching_files = [
                file_path
                for file_path in files
                if file_path.lower().endswith(expected_extension.lower())
            ]

            if not matching_files:
                send_json(
                    self,
                    502,
                    {
                        "error": (
                            f"yt-dlp did not produce an {expected_extension} file"
                        ),
                        "details": (
                            "Produced files: "
                            + ", ".join(os.path.basename(f) for f in files)
                        )[-6000:],
                    },
                )
                return

            file_path = matching_files[0]
            file_size = os.path.getsize(file_path)

            if file_size <= 0:
                send_json(self, 502, {"error": "Downloaded file is empty"})
                return

            original_filename = os.path.basename(file_path)
            filename = safe_filename(original_filename, expected_extension)

            print(
                "Download completed:",
                filename,
                f"({file_size} bytes)",
                flush=True,
            )

            self.send_media(file_path, media_type, filename)

        except BrokenPipeError:
            print("Client disconnected", flush=True)

        except Exception as exc:
            print("Download server error:", repr(exc), flush=True)

            try:
                send_json(
                    self,
                    500,
                    {
                        "error": "Internal download error",
                        "details": str(exc),
                    },
                )
            except Exception:
                pass

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


# =========================================================
# SERVER
# =========================================================

YTDLP = ytdlp_command()
FFMPEG = ffmpeg_location()
JS_RUNTIME = js_runtime()


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DownloadHandler)

    print("========================================", flush=True)
    print("Aurora downloader starting", flush=True)
    print("Port:", PORT, flush=True)
    print("yt-dlp:", " ".join(YTDLP) if YTDLP else "NOT FOUND", flush=True)
    print("ffmpeg:", FFMPEG or "NOT FOUND", flush=True)
    print("JS runtime:", JS_RUNTIME or "NOT FOUND", flush=True)
    print(
        "cookies:",
        "configured"
        if YOUTUBE_COOKIES_B64 or YOUTUBE_COOKIES_TEXT
        else "NOT CONFIGURED",
        flush=True,
    )
    print("formats: mp3, mp4", flush=True)
    print("========================================", flush=True)

    server.serve_forever()


if __name__ == "__main__":
    main()