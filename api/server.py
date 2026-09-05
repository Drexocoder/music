import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


API_KEY = os.environ.get("DOWNLOAD_API_KEY", "")
PORT = int(os.environ.get("PORT", "8080"))


def send_json(handler, status, data):
    body = json.dumps(data).encode("utf-8")

    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()

    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        pass


def safe_filename(filename, extension):
    """
    Make a filename safe for Content-Disposition.
    """
    filename = os.path.basename(filename)

    filename = re.sub(r"[\r\n\t]", " ", filename)
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", filename)

    filename = filename.strip(" .")

    if not filename:
        filename = "aurora-download"

    if not filename.lower().endswith(extension.lower()):
        filename += extension

    return filename


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


class DownloadHandler(BaseHTTPRequestHandler):

    server_version = "AuroraDownloader/1.0"

    def log_message(self, format, *args):
        print(format % args, flush=True)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # ---------------------------------------------------------
        # HEALTH CHECK
        # ---------------------------------------------------------

        if path == "/health":
            send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": "aurora-download",
                    "yt_dlp": shutil.which("yt-dlp") is not None,
                    "ffmpeg": shutil.which("ffmpeg") is not None,
                },
            )
            return

        # ---------------------------------------------------------
        # DOWNLOAD ROUTES
        # ---------------------------------------------------------

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
                    "error": "Not found",
                },
            )
            return

        # ---------------------------------------------------------
        # API KEY
        # ---------------------------------------------------------

        if API_KEY:
            supplied_key = self.headers.get("x-api-key", "")

            if supplied_key != API_KEY:
                send_json(
                    self,
                    401,
                    {
                        "error": "Unauthorized",
                    },
                )
                return

        # ---------------------------------------------------------
        # QUERY PARAMETERS
        # ---------------------------------------------------------

        query = urllib.parse.parse_qs(parsed.query)

        video_id = query.get("id", [""])[0].strip()
        youtube_url = query.get("url", [""])[0].strip()
        media_type = query.get("type", ["audio"])[0].lower().strip()

        # ---------------------------------------------------------
        # SUPPORT /api/download/<VIDEO_ID>
        # ---------------------------------------------------------

        if not video_id and not youtube_url:
            path_video_id = extract_path_video_id(path)

            if path_video_id:
                video_id = path_video_id

        # ---------------------------------------------------------
        # VALIDATE INPUT
        # ---------------------------------------------------------

        if not video_id and not youtube_url:
            send_json(
                self,
                400,
                {
                    "error": "Missing video id or URL",
                },
            )
            return

        if media_type not in ("audio", "video"):
            send_json(
                self,
                400,
                {
                    "error": "type must be audio or video",
                },
            )
            return

        # If an ID was provided, construct the YouTube URL.
        if video_id:
            youtube_url = (
                "https://www.youtube.com/watch?v="
                + urllib.parse.quote(video_id, safe="")
            )

        # ---------------------------------------------------------
        # TEMPORARY DOWNLOAD DIRECTORY
        # ---------------------------------------------------------

        temp_dir = tempfile.mkdtemp(prefix="aurora-")

        try:
            output_template = os.path.join(
                temp_dir,
                "%(title).120s.%(ext)s",
            )

            # -----------------------------------------------------
            # AUDIO
            # -----------------------------------------------------

            if media_type == "audio":

                command = [
                    "yt-dlp",
                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",
                    "--extract-audio",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "5",
                    "--output",
                    output_template,
                    youtube_url,
                ]

                expected_extension = ".mp3"
                content_type = "audio/mpeg"

            # -----------------------------------------------------
            # VIDEO
            # -----------------------------------------------------

            else:

                command = [
                    "yt-dlp",
                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",
                    "--merge-output-format",
                    "mp4",
                    "--output",
                    output_template,
                    youtube_url,
                ]

                expected_extension = ".mp4"
                content_type = "video/mp4"

            print(
                "Starting yt-dlp for:",
                youtube_url,
                flush=True,
            )

            # -----------------------------------------------------
            # RUN YT-DLP
            # -----------------------------------------------------

            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=1500,
            )

            if result.returncode != 0:

                details = (
                    result.stderr.strip()
                    or result.stdout.strip()
                    or "Unknown yt-dlp error"
                )

                print(
                    "yt-dlp failed:",
                    details,
                    flush=True,
                )

                send_json(
                    self,
                    502,
                    {
                        "error": "yt-dlp download failed",
                        "details": details[-4000:],
                    },
                )
                return

            # -----------------------------------------------------
            # FIND OUTPUT FILE
            # -----------------------------------------------------

            files = []

            for filename in os.listdir(temp_dir):

                file_path = os.path.join(
                    temp_dir,
                    filename,
                )

                if os.path.isfile(file_path):
                    files.append(file_path)

            if not files:

                send_json(
                    self,
                    502,
                    {
                        "error": "yt-dlp completed but produced no file",
                    },
                )
                return

            # Prefer the requested extension.
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

            # -----------------------------------------------------
            # FILE INFORMATION
            # -----------------------------------------------------

            original_filename = os.path.basename(file_path)

            filename = safe_filename(
                original_filename,
                expected_extension,
            )

            file_size = os.path.getsize(file_path)

            if file_size <= 0:

                send_json(
                    self,
                    502,
                    {
                        "error": "Downloaded file is empty",
                    },
                )
                return

            # -----------------------------------------------------
            # SEND FILE
            # -----------------------------------------------------

            self.send_response(200)

            self.send_header(
                "Content-Type",
                content_type,
            )

            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{filename}"',
            )

            self.send_header(
                "Content-Length",
                str(file_size),
            )

            self.send_header(
                "Cache-Control",
                "no-store",
            )

            self.send_header(
                "X-Aurora-Downloader",
                "1",
            )

            self.end_headers()

            # -----------------------------------------------------
            # STREAM FILE
            # -----------------------------------------------------

            with open(file_path, "rb") as file:

                while True:

                    chunk = file.read(
                        1024 * 1024
                    )

                    if not chunk:
                        break

                    try:
                        self.wfile.write(chunk)
                    except BrokenPipeError:
                        print(
                            "Client disconnected during download",
                            flush=True,
                        )
                        break

            print(
                f"Download completed: {filename}",
                flush=True,
            )

        # ---------------------------------------------------------
        # TIMEOUT
        # ---------------------------------------------------------

        except subprocess.TimeoutExpired:

            print(
                "yt-dlp timed out",
                flush=True,
            )

            send_json(
                self,
                504,
                {
                    "error": "Download timed out",
                },
            )

        # ---------------------------------------------------------
        # CLIENT DISCONNECT
        # ---------------------------------------------------------

        except BrokenPipeError:

            print(
                "Client disconnected during download",
                flush=True,
            )

        # ---------------------------------------------------------
        # GENERAL ERROR
        # ---------------------------------------------------------

        except Exception as exc:

            print(
                "Download server error:",
                repr(exc),
                flush=True,
            )

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

        # ---------------------------------------------------------
        # CLEANUP
        # ---------------------------------------------------------

        finally:

            shutil.rmtree(
                temp_dir,
                ignore_errors=True,
            )


def main():

    server = ThreadingHTTPServer(
        ("0.0.0.0", PORT),
        DownloadHandler,
    )

    print(
        f"Aurora downloader listening on 0.0.0.0:{PORT}",
        flush=True,
    )

    server.serve_forever()


if __name__ == "__main__":
    main()
