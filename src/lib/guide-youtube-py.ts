export const FILE = String.raw`"""
youtube.py — Nex Music API helper for your Telegram music bot.

Get a key from the bot with /key  (format: Nex-xxxxxxxx...)
Docs: {ORIGIN}/developers

Install:  pip install aiohttp py-yt

Usage inside your bot:

    from youtube import NexAPI, download_song, download_video, search

    results = await search("pawan singh")
    path    = await download_song(results[0]["id"])     # -> downloads/<id>.mp3
    path    = await download_video("https://youtu.be/xxxxxxxxxxx")  # -> .mp4

Then just send it:

    await message.reply_audio(path, title=results[0]["title"])
"""

import os
import aiohttp

API_BASE = os.environ.get("NEX_API_URL", "{ORIGIN}/api/public/v2")
API_KEY = os.environ.get("NEX_API_KEY", "Nex-PUT_YOUR_KEY_HERE")

DOWNLOAD_DIR = "downloads"


class NexAPIError(Exception):
    pass


class NexAPI:
    """Thin async client for the Nex Music API."""

    def __init__(self, api_key: str = API_KEY, base: str = API_BASE):
        self.api_key = api_key
        self.base = base.rstrip("/")

    async def _json(self, path: str, params: dict):
        params = {**params, "api_key": self.api_key}
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base}{path}", params=params, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                data = await resp.json(content_type=None)
                if resp.status != 200 or not data.get("ok"):
                    raise NexAPIError(data.get("error") or f"HTTP {resp.status}")
                return data

    async def search(self, query: str, limit: int = 10):
        """Returns a list of {id, title, channel, thumbnail, duration}."""
        data = await self._json("/search", {"q": query})
        return data["results"][:limit]

    async def status(self):
        """Your plan, limits and how much quota is left today / this month."""
        return await self._json("/status", {})

    async def download(self, video: str, media_type: str = "audio", file_path: str = None):
        """
        Downloads audio (mp3) or video (mp4) to disk and returns the path.
        'video' can be a YouTube link or a plain 11-character video id.
        """
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        video_id = extract_id(video)
        ext = "mp4" if media_type == "video" else "mp3"
        file_path = file_path or os.path.join(DOWNLOAD_DIR, f"{video_id}.{ext}")

        if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
            return file_path  # cached

        params = {"url": video_id, "type": media_type, "api_key": self.api_key}
        timeout = aiohttp.ClientTimeout(total=600 if media_type == "video" else 300)
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base}/download", params=params, timeout=timeout) as resp:
                if resp.status == 401:
                    raise NexAPIError("Invalid or revoked API key.")
                if resp.status == 429:
                    raise NexAPIError("Plan limit reached — upgrade with the bot.")
                if resp.status != 200:
                    raise NexAPIError(f"Download failed (HTTP {resp.status}).")
                with open(file_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(131072):
                        f.write(chunk)

        if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
            return file_path
        raise NexAPIError("Empty file returned.")


def extract_id(link: str) -> str:
    """Accepts a full YouTube URL or a bare video id."""
    link = link.strip()
    if len(link) == 11 and "/" not in link:
        return link
    if "v=" in link:
        return link.split("v=")[-1].split("&")[0]
    return link.rstrip("/").split("/")[-1].split("?")[0]


# ---------------------------------------------------------------- shortcuts

_api = NexAPI()


async def search(query: str, limit: int = 10):
    return await _api.search(query, limit)


async def download_song(link: str):
    return await _api.download(link, "audio")


async def download_video(link: str):
    return await _api.download(link, "video")


async def quota():
    return await _api.status()


# ---------------------------------------------------------------- pyrogram example
#
# from pyrogram import Client, filters
# from youtube import search, download_song
#
# @app.on_message(filters.command("play"))
# async def play(client, message):
#     query = message.text.split(None, 1)[1]
#     msg = await message.reply("Searching...")
#     results = await search(query, limit=1)
#     if not results:
#         return await msg.edit("Nothing found.")
#     track = results[0]
#     await msg.edit(f"Downloading {track['title']}...")
#     path = await download_song(track["id"])
#     await message.reply_audio(path, title=track["title"], performer=track["channel"])
#     await msg.delete()
#
# Errors to handle: NexAPIError("Plan limit reached") -> tell the user to upgrade.
`;
