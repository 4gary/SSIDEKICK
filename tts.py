"""Local text-to-speech. Every engine returns WAV bytes, which the overlay plays inside OBS."""
import asyncio
import io
import logging
import os
import struct
import tempfile
import time
import wave
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("tts")

ELEVEN_API = "https://api.elevenlabs.io"
ELEVEN_RATE = 22050  # raw 16-bit mono PCM at this rate, wrapped into a WAV for the overlay
ELEVEN_WAIT = 6      # seconds to wait for ElevenLabs before this line uses the Windows voice instead
VOICE_RETRY = 300    # a failed voice lookup is not repeated for this many seconds


def wav_seconds(data):
    try:
        with wave.open(io.BytesIO(data)) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 5.0


class TTS:
    def __init__(self, cfg, base_dir):
        self.cfg = cfg["tts"]
        self.base_dir = base_dir
        self.engine = self.cfg.get("engine", "windows")
        self._pool = ThreadPoolExecutor(max_workers=1)  # the SAPI voice must stay on one thread
        self._sapi = None
        self._eleven_voice_id = None
        self._voice_err, self._voice_retry_at = None, 0.0

    async def synth(self, text):
        if self.engine == "elevenlabs":
            try:
                return await asyncio.wait_for(self._elevenlabs(text), ELEVEN_WAIT)
            except Exception as e:
                log.warning("ElevenLabs failed (%s), using the Windows voice for this line", e or type(e).__name__)
                return await asyncio.get_running_loop().run_in_executor(self._pool, self._windows, text)
        if self.engine == "piper":
            return await self._piper(text)
        if self.engine == "silent":
            return self._silent(text)
        return await asyncio.get_running_loop().run_in_executor(self._pool, self._windows, text)

    # -- Windows built-in voices, straight through SAPI5. (pyttsx3's runAndWait loop
    #    sometimes silently writes nothing on the 2nd+ call, so we don't use it.)
    def _windows(self, text):
        import comtypes
        import comtypes.client
        if self._sapi is None:
            comtypes.CoInitialize()  # this worker thread owns the voice
            self._sapi = comtypes.client.CreateObject("SAPI.SpVoice")
            want = self.cfg.get("windows_voice", "").lower()
            if want:
                voices = self._sapi.GetVoices()
                for i in range(voices.Count):
                    if want in voices.Item(i).GetDescription().lower():
                        self._sapi.Voice = voices.Item(i)
                        break
            # SAPI rate is -10..10 where 0 is about 180 words per minute
            self._sapi.Rate = max(-10, min(10, round((self.cfg.get("windows_rate", 185) - 180) / 20)))
        for attempt in range(2):
            fd, path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            try:
                stream = comtypes.client.CreateObject("SAPI.SpFileStream")
                stream.Open(path, 3)  # 3 = create for write
                self._sapi.AudioOutputStream = stream
                self._sapi.Speak(text)
                stream.Close()
                with open(path, "rb") as f:
                    data = f.read()
                if len(data) > 4000 and wav_seconds(data) > 0.2:
                    return data
                log.warning("Windows voice produced no audio, retrying")
            finally:
                os.remove(path)
        raise RuntimeError("Windows voice produced no audio twice")

    # -- ElevenLabs (cloud). Key comes from ELEVENLABS_API_KEY or elevenlabs_key.txt, never config.toml.
    def _eleven_key(self):
        key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
        if key:
            return key
        path = os.path.join(self.base_dir, "elevenlabs_key.txt")
        if os.path.exists(path):
            with open(path, encoding="utf-8-sig") as f:
                key = f.read().strip()
            if key:
                return key
        raise RuntimeError("no API key (set ELEVENLABS_API_KEY or create elevenlabs_key.txt)")

    async def _find_voice(self, s):
        want = self.cfg.get("elevenlabs_voice", "").strip()
        async with s.get(f"{ELEVEN_API}/v2/voices", params={"page_size": "100"}) as r:
            if r.status != 200:
                raise RuntimeError(f"voice list HTTP {r.status}: {(await r.text())[:200]}")
            voices = (await r.json()).get("voices", [])
        match = next((v for v in voices if want and want in (v["voice_id"], v["name"])), None) \
            or next((v for v in voices if want and v["name"].lower().startswith(want.lower())), None)
        if not match:
            names = ", ".join(v["name"] for v in voices[:30])
            raise RuntimeError(f"voice '{want}' not found. Available: {names}")
        self._eleven_voice_id = match["voice_id"]
        log.info("ElevenLabs voice: %s", match["name"])

    async def _elevenlabs(self, text):
        import aiohttp
        headers = {"xi-api-key": self._eleven_key()}
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(headers=headers, timeout=timeout) as s:
            if self._eleven_voice_id is None:
                if time.monotonic() < self._voice_retry_at:
                    raise RuntimeError(self._voice_err)   # looked up recently and failed: don't refetch the list per line
                try:
                    await self._find_voice(s)
                except RuntimeError as e:
                    self._voice_err, self._voice_retry_at = str(e), time.monotonic() + VOICE_RETRY
                    raise
            body = {
                "text": text,
                "model_id": self.cfg.get("elevenlabs_model", "eleven_flash_v2_5"),
                "voice_settings": {
                    "stability": self.cfg.get("elevenlabs_stability", 0.4),
                    "similarity_boost": self.cfg.get("elevenlabs_similarity", 0.8),
                    "style": self.cfg.get("elevenlabs_style", 0.3),
                },
            }
            url = f"{ELEVEN_API}/v1/text-to-speech/{self._eleven_voice_id}"
            async with s.post(url, params={"output_format": f"pcm_{ELEVEN_RATE}"}, json=body) as r:
                if r.status != 200:
                    raise RuntimeError(f"HTTP {r.status}: {(await r.text())[:200]}")
                pcm = await r.read()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(ELEVEN_RATE)
            w.writeframes(pcm)
        return buf.getvalue()

    # -- Piper (https://github.com/rhasspy/piper), much more natural sounding
    async def _piper(self, text):
        model = self.cfg["piper_model"]
        if not os.path.isabs(model):
            model = os.path.join(self.base_dir, model)
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            proc = await asyncio.create_subprocess_exec(
                self.cfg.get("piper_exe", "piper"), "-m", model, "-f", path,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate(text.encode("utf-8"))
            if proc.returncode != 0:
                raise RuntimeError(f"piper failed: {err.decode(errors='ignore')[-300:]}")
            with open(path, "rb") as f:
                return f.read()
        finally:
            os.remove(path)

    # -- Silence of roughly the right length, for testing without a voice installed.
    def _silent(self, text):
        rate, secs = 16000, max(1.0, len(text) / 15)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(struct.pack("<h", 0) * int(rate * secs))
        return buf.getvalue()
