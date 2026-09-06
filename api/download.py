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

            # Accept either a YouTube video ID or full URL.
            if len(video_id) == 11:
                youtube_url = (
                    "https://www.youtube.com/watch?v="
                    + video_id
                )
            else:
                youtube_url = video_id

            with tempfile.TemporaryDirectory(
                prefix="aurora-"
            ) as temp_dir:

                output_template = os.path.join(
                    temp_dir,
                    "media.%(ext)s",
                )

                # Try a browser-like YouTube client.
                extractor_args = (
                    "youtube:player_client=web_safari"
                )

                if media_type == "audio":

                    command = [
                        "python3",
                        "-m",
                        "yt_dlp",

                        "--no-playlist",
                        "--no-warnings",
                        "--no-progress",

                        "--extractor-args",
                        extractor_args,

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
                        "python3",
                        "-m",
                        "yt_dlp",

                        "--no-playlist",
                        "--no-warnings",
                        "--no-progress",

                        "--extractor-args",
                        extractor_args,

                        "--format",
                        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",

                        "--merge-output-format",
                        "mp4",

                        "--output",
                        output_template,

                        youtube_url,
                    ]

                    content_type = "video/mp4"

                print(
                    "[aurora] Running yt-dlp:",
                    " ".join(command[:-1]),
                )

                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=240,
                )

                if result.returncode != 0:

                    stderr = (
                        result.stderr.strip()
                        or "Unknown yt-dlp error"
                    )

                    print(
                        "[yt-dlp] stderr:",
                        stderr,
                    )

                    self.send_json(
                        {
                            "error":
                                "yt-dlp download failed",
                            "details":
                                stderr[-4000:],
                        },
                        502,
                    )

                    return

                files = [
                    os.path.join(
                        temp_dir,
                        filename,
                    )
                    for filename in os.listdir(
                        temp_dir
                    )
                    if filename.startswith("media.")
                    and os.path.isfile(
                        os.path.join(
                            temp_dir,
                            filename,
                        )
                    )
                ]

                if not files:

                    self.send_json(
                        {
                            "error":
                                "yt-dlp did not create a media file",
                        },
                        502,
                    )

                    return

                file_path = files[0]

                file_size = os.path.getsize(
                    file_path
                )

                if file_size <= 0:

                    self.send_json(
                        {
                            "error":
                                "Downloaded media file is empty",
                        },
                        502,
                    )

                    return

                if media_type == "audio":
                    filename = "aurora-music.mp3"
                else:
                    filename = "aurora-music.mp4"

                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    content_type,
                )

                self.send_header(
                    "Content-Length",
                    str(file_size),
                )

                self.send_header(
                    "Content-Disposition",
                    f'attachment; filename="{filename}"',
                )

                self.send_header(
                    "Cache-Control",
                    "no-store, no-cache, must-revalidate",
                )

                self.end_headers()

                with open(
                    file_path,
                    "rb",
                ) as file:

                    while True:
                        chunk = file.read(
                            1024 * 1024
                        )

                        if not chunk:
                            break

                        self.wfile.write(chunk)

        except subprocess.TimeoutExpired:

            print(
                "[aurora] yt-dlp timed out"
            )

            self.send_json(
                {
                    "error":
                        "Download timed out. Please try again."
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
                    "error":
                        "Download failed",
                    "details":
                        str(error),
                },
                500,
            )

    def send_json(
        self,
        payload,
        status,
    ):
        data = json.dumps(
            payload
        ).encode("utf-8")

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json",
        )

        self.send_header(
            "Content-Length",
            str(len(data)),
        )

        self.send_header(
            "Cache-Control",
            "no-store",
        )

        self.end_headers()

        self.wfile.write(data)
