import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote


# =========================================================
# ENVIRONMENT
# =========================================================

API_KEY = os.environ.get("DOWNLOAD_API_KEY", "")
YOUTUBE_COOKIES_B64 = os.environ.get("YOUTUBE_COOKIES_B64", "")
PORT = int(os.environ.get("PORT", "8080"))


# =========================================================
# JSON RESPONSE
# =========================================================

def send_json(handler, status, data):
    body = json.dumps(
        data,
        ensure_ascii=False
    ).encode("utf-8")

    handler.send_response(status)

    handler.send_header(
        "Content-Type",
        "application/json; charset=utf-8"
    )

    handler.send_header(
        "Content-Length",
        str(len(body))
    )

    handler.send_header(
        "Cache-Control",
        "no-store"
    )

    handler.end_headers()

    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        pass


# =========================================================
# FILENAME HELPERS
# =========================================================

def safe_filename(filename, extension):
    """
    Create a safe filename for filesystem/header use.
    """

    filename = os.path.basename(filename)

    filename = re.sub(
        r"[\r\n\t]",
        " ",
        filename
    )

    filename = re.sub(
        r'[<>:"/\\|?*\x00-\x1f]',
        "_",
        filename
    )

    filename = filename.strip(" .")

    if not filename:
        filename = "aurora-download"

    if not filename.lower().endswith(extension.lower()):
        filename += extension

    return filename


def ascii_filename(filename, extension):
    """
    Create an ASCII-only fallback filename.
    """

    name_without_extension = os.path.splitext(filename)[0]

    ascii_name = (
        name_without_extension
        .encode("ascii", "ignore")
        .decode("ascii")
    )

    ascii_name = re.sub(
        r"[^A-Za-z0-9._ -]",
        "_",
        ascii_name
    )

    ascii_name = re.sub(
        r"\s+",
        " ",
        ascii_name
    ).strip(" .")

    if not ascii_name:
        ascii_name = "aurora-download"

    return ascii_name + extension


# =========================================================
# VIDEO ID
# =========================================================

def extract_path_video_id(path):
    """
    Supports:

        /api/download/<video_id>
        /api/download/<video_id>/
    """

    prefix = "/api/download/"

    if not path.startswith(prefix):
        return ""

    video_id = path[len(prefix):].strip("/").strip()

    if not video_id:
        return ""

    return urllib.parse.unquote(video_id).strip()


# =========================================================
# COOKIE FILE
# =========================================================

def create_cookie_file(temp_dir):
    """
    Decode YOUTUBE_COOKIES_B64 into a temporary
    Netscape cookies.txt file.
    """

    if not YOUTUBE_COOKIES_B64:
        return None

    cookies_file = os.path.join(
        temp_dir,
        "cookies.txt"
    )

    try:
        cookie_bytes = base64.b64decode(
            YOUTUBE_COOKIES_B64,
            validate=True
        )

        if not cookie_bytes:
            raise ValueError("Cookie data is empty")

        with open(
            cookies_file,
            "wb"
        ) as cookie_handle:
            cookie_handle.write(cookie_bytes)

        return cookies_file

    except Exception as exc:
        print(
            "Failed to prepare YouTube cookies:",
            repr(exc),
            flush=True
        )

        return None


# =========================================================
# DOWNLOADER
# =========================================================

class DownloadHandler(BaseHTTPRequestHandler):

    server_version = "AuroraDownloader/1.0"

    def log_message(self, format, *args):
        print(
            format % args,
            flush=True
        )

    def do_GET(self):

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # =====================================================
        # HEALTH CHECK
        # =====================================================

        if path == "/health":

            send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": "aurora-download",
                    "yt_dlp": shutil.which("yt-dlp") is not None,
                    "ffmpeg": shutil.which("ffmpeg") is not None,
                    "deno": shutil.which("deno") is not None,
                    "cookies_configured": bool(
                        YOUTUBE_COOKIES_B64
                    )
                }
            )

            return

        # =====================================================
        # DOWNLOAD ROUTES
        # =====================================================

        valid_download_path = (
            path == "/download"
            or path == "/download/"
            or path.startswith("/api/download/")
        )

        if not valid_download_path:

            send_json(
                self,
                404,
                {
                    "error": "Not found"
                }
            )

            return

        # =====================================================
        # API KEY
        # =====================================================

        if API_KEY:

            supplied_key = self.headers.get(
                "x-api-key",
                ""
            )

            if supplied_key != API_KEY:

                send_json(
                    self,
                    401,
                    {
                        "error": "Unauthorized"
                    }
                )

                return

        # =====================================================
        # QUERY PARAMETERS
        # =====================================================

        query = urllib.parse.parse_qs(
            parsed.query
        )

        video_id = query.get(
            "id",
            [""]
        )[0].strip()

        youtube_url = query.get(
            "url",
            [""]
        )[0].strip()

        media_type = query.get(
            "type",
            ["audio"]
        )[0].lower().strip()

        # =====================================================
        # PATH VIDEO ID
        # =====================================================

        if not video_id and not youtube_url:

            path_video_id = extract_path_video_id(
                path
            )

            if path_video_id:
                video_id = path_video_id

        # =====================================================
        # VALIDATION
        # =====================================================

        if not video_id and not youtube_url:

            send_json(
                self,
                400,
                {
                    "error": "Missing video id or URL"
                }
            )

            return

        if media_type not in (
            "audio",
            "video"
        ):

            send_json(
                self,
                400,
                {
                    "error": "type must be audio or video"
                }
            )

            return

        # =====================================================
        # BUILD YOUTUBE URL
        # =====================================================

        if video_id:

            youtube_url = (
                "https://www.youtube.com/watch?v="
                + urllib.parse.quote(
                    video_id,
                    safe=""
                )
            )

        # =====================================================
        # TEMP DIRECTORY
        # =====================================================

        temp_dir = tempfile.mkdtemp(
            prefix="aurora-"
        )

        try:

            # =================================================
            # PREPARE COOKIES
            # =================================================

            cookies_file = create_cookie_file(
                temp_dir
            )

            # =================================================
            # OUTPUT TEMPLATE
            # =================================================

            output_template = os.path.join(
                temp_dir,
                "%(title).120s.%(ext)s"
            )

            # =================================================
            # COMMON YOUTUBE OPTIONS
            # =================================================

            youtube_options = [
                "--no-playlist",

                # Explicitly enable Deno.
                "--js-runtimes",
                "deno",

                # Avoid the problematic logged-in
                # tv_downgraded client.
                "--extractor-args",
                "youtube:player_client=default,-tv_downgraded,web_embedded",

                # Use the cookies only when configured.
            ]

            # =================================================
            # AUDIO
            # =================================================

            if media_type == "audio":

                command = [
                    "yt-dlp",

                    *youtube_options,

                    "--no-warnings",

                    "--no-progress",

                    "--extract-audio",

                    "--audio-format",
                    "mp3",

                    "--audio-quality",
                    "5",

                    "--output",
                    output_template,
                ]

                if cookies_file:

                    command.extend(
                        [
                            "--cookies",
                            cookies_file,
                        ]
                    )

                command.append(
                    youtube_url
                )

                expected_extension = ".mp3"
                content_type = "audio/mpeg"

            # =================================================
            # VIDEO
            # =================================================

            else:

                command = [
                    "yt-dlp",

                    *youtube_options,

                    "--no-warnings",

                    "--no-progress",

                    "--merge-output-format",
                    "mp4",

                    "--output",
                    output_template,
                ]

                if cookies_file:

                    command.extend(
                        [
                            "--cookies",
                            cookies_file,
                        ]
                    )

                command.append(
                    youtube_url
                )

                expected_extension = ".mp4"
                content_type = "video/mp4"

            # =================================================
            # LOG
            # =================================================

            print(
                "Starting yt-dlp for:",
                youtube_url,
                flush=True
            )

            print(
                "YouTube cookies:",
                "enabled" if cookies_file else "disabled",
                flush=True
            )

            print(
                "Deno:",
                shutil.which("deno") or "NOT FOUND",
                flush=True
            )

            print(
                "yt-dlp command:",
                " ".join(command).replace(
                    cookies_file or "__NO_COOKIE__",
                    "<cookies>"
                ),
                flush=True
            )

            # =================================================
            # RUN YT-DLP
            # =================================================

            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=1500
            )

            # =================================================
            # LOG YT-DLP OUTPUT
            # =================================================

            if result.stdout.strip():

                print(
                    "yt-dlp stdout:",
                    result.stdout[-6000:],
                    flush=True
                )

            if result.stderr.strip():

                print(
                    "yt-dlp stderr:",
                    result.stderr[-6000:],
                    flush=True
                )

            # =================================================
            # ERROR
            # =================================================

            if result.returncode != 0:

                details = (
                    result.stderr.strip()
                    or result.stdout.strip()
                    or "Unknown yt-dlp error"
                )

                print(
                    "yt-dlp failed:",
                    details,
                    flush=True
                )

                send_json(
                    self,
                    502,
                    {
                        "error": "yt-dlp download failed",
                        "details": details[-4000:]
                    }
                )

                return

            # =================================================
            # FIND OUTPUT
            # =================================================

            files = []

            for filename in os.listdir(
                temp_dir
            ):

                file_path = os.path.join(
                    temp_dir,
                    filename
                )

                if os.path.isfile(
                    file_path
                ):

                    files.append(
                        file_path
                    )

            if not files:

                send_json(
                    self,
                    502,
                    {
                        "error": (
                            "yt-dlp completed "
                            "but produced no file"
                        )
                    }
                )

                return

            # =================================================
            # SELECT OUTPUT
            # =================================================

            matching_files = [
                file_path
                for file_path in files
                if file_path.lower().endswith(
                    expected_extension.lower()
                )
            ]

            if matching_files:

                file_path = matching_files[0]

            else:

                file_path = files[0]

            # =================================================
            # FILE INFORMATION
            # =================================================

            original_filename = os.path.basename(
                file_path
            )

            filename = safe_filename(
                original_filename,
                expected_extension
            )

            fallback_filename = ascii_filename(
                filename,
                expected_extension
            )

            encoded_filename = quote(
                filename,
                safe=""
            )

            file_size = os.path.getsize(
                file_path
            )

            if file_size <= 0:

                send_json(
                    self,
                    502,
                    {
                        "error": "Downloaded file is empty"
                    }
                )

                return

            # =================================================
            # SEND RESPONSE
            # =================================================

            self.send_response(200)

            self.send_header(
                "Content-Type",
                content_type
            )

            self.send_header(
                "Content-Disposition",
                (
                    "attachment; "
                    f'filename="{fallback_filename}"; '
                    f"filename*=UTF-8''{encoded_filename}"
                )
            )

            self.send_header(
                "Content-Length",
                str(file_size)
            )

            self.send_header(
                "Cache-Control",
                "no-store"
            )

            self.send_header(
                "X-Aurora-Downloader",
                "1"
            )

            self.end_headers()

            # =================================================
            # STREAM FILE
            # =================================================

            with open(
                file_path,
                "rb"
            ) as file:

                while True:

                    chunk = file.read(
                        1024 * 1024
                    )

                    if not chunk:
                        break

                    try:

                        self.wfile.write(
                            chunk
                        )

                    except BrokenPipeError:

                        print(
                            "Client disconnected "
                            "during download",
                            flush=True
                        )

                        break

            print(
                f"Download completed: {filename}",
                flush=True
            )

        # =====================================================
        # TIMEOUT
        # =====================================================

        except subprocess.TimeoutExpired:

            print(
                "yt-dlp timed out",
                flush=True
            )

            send_json(
                self,
                504,
                {
                    "error": "Download timed out"
                }
            )

        # =====================================================
        # CLIENT DISCONNECT
        # =====================================================

        except BrokenPipeError:

            print(
                "Client disconnected during download",
                flush=True
            )

        # =====================================================
        # GENERAL ERROR
        # =====================================================

        except Exception as exc:

            print(
                "Download server error:",
                repr(exc),
                flush=True
            )

            try:

                send_json(
                    self,
                    500,
                    {
                        "error": "Internal download error",
                        "details": str(exc)
                    }
                )

            except Exception:
                pass

        # =====================================================
        # CLEANUP
        # =====================================================

        finally:

            shutil.rmtree(
                temp_dir,
                ignore_errors=True
            )


# =========================================================
# SERVER
# =========================================================

def main():

    server = ThreadingHTTPServer(
        ("0.0.0.0", PORT),
        DownloadHandler
    )

    print(
        f"Aurora downloader listening on "
        f"0.0.0.0:{PORT}",
        flush=True
    )

    print(
        "yt-dlp:",
        shutil.which("yt-dlp") or "NOT FOUND",
        flush=True
    )

    print(
        "ffmpeg:",
        shutil.which("ffmpeg") or "NOT FOUND",
        flush=True
    )

    print(
        "deno:",
        shutil.which("deno") or "NOT FOUND",
        flush=True
    )

    print(
        "cookies:",
        "configured" if YOUTUBE_COOKIES_B64 else "NOT CONFIGURED",
        flush=True
    )

    server.serve_forever()


if __name__ == "__main__":
    main()
