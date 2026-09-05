from http.server import BaseHTTPRequestHandler
import json
import os
import tempfile
import subprocess
import urllib.parse


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)

            video_id = params.get("id", [None])[0]
            media_type = params.get("type", ["audio"])[0]

            if not video_id:
                self.send_json(
                    {"error": "Missing YouTube video ID"},
                    400,
                )
                return

            if media_type not in ("audio", "video"):
                media_type = "audio"

            # Accept either an ID or a full YouTube URL.
            if len(video_id) == 11:
                youtube_url = (
                    "https://www.youtube.com/watch?v="
                    + video_id
                )
            else:
                youtube_url = video_id

            with tempfile.TemporaryDirectory() as temp_dir:

                output_template = os.path.join(
                    temp_dir,
                    "media.%(ext)s",
                )

                if media_type == "audio":
                    command = [
                        "python",
                        "-m",
                        "yt_dlp",
                        "--no-playlist",
                        "--no-warnings",
                        "--extract-audio",
                        "--audio-format",
                        "mp3",
                        "--audio-quality",
                        "5",
                        "--output",
                        output_template,
                        youtube_url,
                    ]

                    content_type = "audio/mpeg"

                else:
                    command = [
                        "python",
                        "-m",
                        "yt_dlp",
                        "--no-playlist",
                        "--no-warnings",
                        "--format",
                        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                        "--merge-output-format",
                        "mp4",
                        "--output",
                        output_template,
                        youtube_url,
                    ]

                    content_type = "video/mp4"

                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=240,
                )

                if result.returncode != 0:
                    print(
                        "[yt-dlp] stderr:",
                        result.stderr,
                    )

                    self.send_json(
                        {
                            "error": "yt-dlp download failed",
                            "details": result.stderr[-2000:],
                        },
                        502,
                    )
                    return

                files = [
                    os.path.join(temp_dir, filename)
                    for filename in os.listdir(temp_dir)
                    if filename.startswith("media.")
                ]

                if not files:
                    self.send_json(
                        {
                            "error": "yt-dlp did not create a media file"
                        },
                        502,
                    )
                    return

                file_path = files[0]

                with open(file_path, "rb") as file:
                    data = file.read()

                filename = (
                    "aurora-music.mp3"
                    if media_type == "audio"
                    else "aurora-music.mp4"
                )

                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    content_type,
                )

                self.send_header(
                    "Content-Length",
                    str(len(data)),
                )

                self.send_header(
                    "Content-Disposition",
                    f'attachment; filename="{filename}"',
                )

                self.send_header(
                    "Cache-Control",
                    "no-store",
                )

                self.end_headers()

                self.wfile.write(data)

        except subprocess.TimeoutExpired:
            self.send_json(
                {
                    "error": "Download timed out. Please try again."
                },
                504,
            )

        except Exception as error:
            print(
                "[download] Error:",
                repr(error),
            )

            self.send_json(
                {
                    "error": "Download failed",
                    "details": str(error),
                },
                500,
            )

    def send_json(self, payload, status):
        data = json.dumps(payload).encode("utf-8")

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json",
        )

        self.send_header(
            "Content-Length",
            str(len(data)),
        )

        self.end_headers()

        self.wfile.write(data)
