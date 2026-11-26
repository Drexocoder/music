"""Vercel Python function fallback for Aurora downloads.

This function is only used when the deployment routes ``/api/download/*`` to
this Python function instead of the container service. It supports both URL
shapes:

    GET /api/download/<video id>?type=audio|video
    GET /api/download?id=<video id>&type=audio|video

``type=audio`` produces MP3 and ``type=video`` produces MP4. ffmpeg is
required for both and is resolved from PATH, ``FFMPEG_LOCATION`` or the
``imageio-ffmpeg`` package (see requirements.txt).
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
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote


# =========================================================
# ENVIRONMENT
# =========================================================

YOUTUBE_COOKIES_B64 = os.environ.get("YOUTUBE_COOKIES_B64", "")
YOUTUBE_COOKIES_TEXT = os.environ.get("YOUTUBE_COOKIES", "")
API_KEY = os.environ.get("DOWNLOAD_API_KEY", "")

DOWNLOAD_TIMEOUT_SECONDS = float(
    os.environ.get("DOWNLOAD_TIMEOUT_SECONDS", "240")
)

MEDIA_TYPES = {
    "audio": {
        "extension": ".mp3",
        "content_type": "audio/mpeg",
    },
    "video": {
        "extension": ".mp4",
        "content_type": "video/mp4",
    },
}

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


# =========================================================
# HELPERS
# =========================================================

def ytdlp_command():
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
    explicit = os.environ.get("YTDLP_JS_RUNTIME", "").strip()

    if explicit:
        return explicit

    for candidate in ("deno", "node", "bun"):
        if shutil.which(candidate):
            return candidate

    return None


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


def create_cookie_file(temp_dir):
    if not YOUTUBE_COOKIES_B64 and not YOUTUBE_COOKIES_TEXT:
        return None

    cookies_file = os.path.join(temp_dir, "cookies.txt")

    try:
        if YOUTUBE_COOKIES_B64:
            encoded = YOUTUBE_COOKIES_B64.strip()

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
                cookie_bytes = base64.urlsafe_b64decode(
                    encoded + "=" * (-len(encoded) % 4)
                )
        else:
            cookie_bytes = YOUTUBE_COOKIES_TEXT.encode("utf-8")

        if not cookie_bytes:
            raise ValueError("Cookie data is empty")

        with open(cookies_file, "wb") as cookie_handle:
            cookie_handle.write(cookie_bytes)

        return cookies_file

    except Exception as exc:
        print("Failed to prepare YouTube cookies:", repr(exc), flush=True)
        return None


def normalize_target(raw):
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
# HANDLER
# =========================================================

class handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(format % args, flush=True)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ("/health", "/api/download/health"):
            self.send_json(
                200,
                {
                    "ok": True,
                    "service": "aurora-download-function",
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

        if not (
            path in ("/download", "/download/")
            or path.startswith("/api/download/")
        ):
            self.send_json(404, {"error": "Not found"})
            return

        if API_KEY:
            supplied_key = self.headers.get("x-api-key", "")

            if supplied_key != API_KEY:
                self.send_json(401, {"error": "Unauthorized"})
                return

        query = urllib.parse.parse_qs(parsed.query)

        video_id = query.get("id", [""])[0].strip()
        youtube_url = query.get("url", [""])[0].strip()
        media_type_name = query.get("type", [""])[0].lower().strip()

        if not media_type_name:
            fmt = query.get("format", [""])[0].lower().strip()
            media_type_name = {
                "mp3": "audio",
                "mp4": "video",
            }.get(fmt, "")

        if not media_type_name:
            media_type_name = "audio"

        if not video_id and not youtube_url:
            video_id = extract_path_video_id(path)

        target = normalize_target(video_id or youtube_url)

        if not target:
            self.send_json(
                400,
                {"error": "Missing or invalid YouTube id/URL"},
            )
            return

        if media_type_name not in MEDIA_TYPES:
            self.send_json(400, {"error": "type must be audio or video"})
            return

        media_type = MEDIA_TYPES[media_type_name]

        if not YTDLP:
            self.send_json(
                503,
                {
                    "error": "yt-dlp is not installed",
                    "details": (
                        'Install it with: python -m pip install "yt-dlp[default]"'
                    ),
                },
            )
            return

        if not FFMPEG:
            self.send_json(
                503,
                {
                    "error": "ffmpeg is not installed",
                    "details": (
                        "MP3 conversion and MP4 merging require ffmpeg. "
                        "Add imageio-ffmpeg to requirements.txt."
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

            profiles = []

            if cookies_file:
                profiles.extend(
                    [
                        {"clients": None, "cookies": True},
                        {"clients": "web_safari", "cookies": True},
                    ]
                )

            profiles.extend(
                [
                    {"clients": None, "cookies": False},
                    {"clients": "tv", "cookies": False},
                    {"clients": "android_vr", "cookies": False},
                    {"clients": "web_embedded", "cookies": False},
                ]
            )

            result = None
            details = ""

            for profile in profiles:
                remaining = DOWNLOAD_TIMEOUT_SECONDS - (time.monotonic() - started)

                if remaining < 10:
                    details = "Download time budget exhausted."
                    break

                for old_filename in os.listdir(temp_dir):
                    old_path = os.path.join(temp_dir, old_filename)

                    if os.path.isfile(old_path):
                        try:
                            os.remove(old_path)
                        except OSError:
                            pass

                command = [
                    *YTDLP,
                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",
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

                if media_type_name == "video":
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

                print(
                    "yt-dlp attempt:",
                    profile["clients"],
                    "cookies:",
                    bool(profile["cookies"] and cookies_file),
                    flush=True,
                )

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

                if result.returncode == 0:
                    break

                details = result.stderr.strip() or result.stdout.strip() or details

            if result is None or result.returncode != 0:
                self.send_json(
                    504 if result is not None and result.returncode == 124 else 502,
                    {
                        "error": "yt-dlp download failed",
                        "details": (details or "Unknown yt-dlp error")[-6000:],
                    },
                )
                return

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
                self.send_json(
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
                self.send_json(502, {"error": "Downloaded file is empty"})
                return

            filename = safe_filename(
                os.path.basename(file_path),
                expected_extension,
            )
            fallback_filename = ascii_filename(filename, expected_extension)
            encoded_filename = quote(filename, safe="")

            self.send_response(200)
            self.send_header("Content-Type", media_type["content_type"])
            self.send_header(
                "Content-Disposition",
                (
                    f'attachment; filename="{fallback_filename}"; '
                    f"filename*=UTF-8''{encoded_filename}"
                ),
            )
            self.send_header("Content-Length", str(file_size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Aurora-Format", expected_extension.lstrip("."))
            self.end_headers()

            with open(file_path, "rb") as file:
                while True:
                    chunk = file.read(1024 * 1024)

                    if not chunk:
                        break

                    try:
                        self.wfile.write(chunk)
                    except BrokenPipeError:
                        break

        except BrokenPipeError:
            pass

        except Exception as exc:
            print("Download function error:", repr(exc), flush=True)

            try:
                self.send_json(
                    500,
                    {"error": "Internal download error", "details": str(exc)},
                )
            except Exception:
                pass

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


# =========================================================
# RUNTIME
# =========================================================

YTDLP = ytdlp_command()
FFMPEG = ffmpeg_location()
JS_RUNTIME = js_runtime()