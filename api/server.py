import json
import os
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
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class DownloadHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(format % args, flush=True)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/health":
            send_json(self, 200, {
                "ok": True,
                "service": "aurora-download",
                "yt_dlp": True,
                "ffmpeg": shutil.which("ffmpeg") is not None,
            })
            return

        if parsed.path != "/download":
            send_json(self, 404, {"error": "Not found"})
            return

        # Optional API-key protection
        if API_KEY:
            supplied_key = self.headers.get("x-api-key", "")

            if supplied_key != API_KEY:
                send_json(self, 401, {"error": "Unauthorized"})
                return

        query = urllib.parse.parse_qs(parsed.query)

        video_id = query.get("id", [""])[0].strip()
        youtube_url = query.get("url", [""])[0].strip()
        media_type = query.get("type", ["audio"])[0].lower()

        if not video_id and not youtube_url:
            send_json(self, 400, {
                "error": "Missing id or url"
            })
            return

        if media_type not in ("audio", "video"):
            send_json(self, 400, {
                "error": "type must be audio or video"
            })
            return

        if video_id:
            youtube_url = f"https://www.youtube.com/watch?v={video_id}"

        temp_dir = tempfile.mkdtemp(prefix="aurora-")

        try:
            if media_type == "audio":
                output_template = os.path.join(
                    temp_dir,
                    "%(title).120s.%(ext)s"
                )

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

            else:
                output_template = os.path.join(
                    temp_dir,
                    "%(title).120s.%(ext)s"
                )

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

            print(
                "Starting yt-dlp:",
                " ".join(command),
                flush=True,
            )

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

                send_json(self, 502, {
                    "error": "yt-dlp download failed",
                    "details": details[-4000:],
                })
                return

            files = []

            for filename in os.listdir(temp_dir):
                path = os.path.join(temp_dir, filename)

                if os.path.isfile(path):
                    files.append(path)

            if not files:
                send_json(self, 502, {
                    "error": "yt-dlp completed but produced no file"
                })
                return

            file_path = files[0]

            if media_type == "audio":
                content_type = "audio/mpeg"
                extension = ".mp3"
            else:
                content_type = "video/mp4"
                extension = ".mp4"

            filename = os.path.basename(file_path)

            if not filename.lower().endswith(extension):
                filename += extension

            file_size = os.path.getsize(file_path)

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{filename}"',
            )
            self.send_header("Content-Length", str(file_size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            with open(file_path, "rb") as file:
                while True:
                    chunk = file.read(1024 * 1024)

                    if not chunk:
                        break

                    self.wfile.write(chunk)

            print(
                f"Download completed: {filename}",
                flush=True,
            )

        except subprocess.TimeoutExpired:
            send_json(self, 504, {
                "error": "Download timed out"
            })

        except BrokenPipeError:
            print(
                "Client disconnected during download",
                flush=True,
            )

        except Exception as exc:
            print(
                "Download server error:",
                repr(exc),
                flush=True,
            )

            try:
                send_json(self, 500, {
                    "error": "Internal download error",
                    "details": str(exc),
                })
            except Exception:
                pass

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


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
