"""Optional: hear the streamer through the mic and turn speech into text, all locally.

Needs:  pip install faster-whisper sounddevice
"""
import asyncio
import collections
import logging
import os
import queue
import sys
import threading
import time

import numpy as np

log = logging.getLogger("listen")
logging.getLogger("faster_whisper").setLevel(logging.WARNING)  # hide per-chunk "VAD filter removed" noise

RATE = 16000
BLOCK = 480            # 30 ms
SILENCE_END = 0.8      # seconds of quiet that ends a sentence
MIN_SPEECH = 0.4       # ignore blips shorter than this
MAX_SPEECH = 20        # force-cut very long talking
NOISE_WINDOW = 166     # ~5 s of 30 ms blocks: the quietest of these tell us how loud the room is
NOISE_RATIO = 2.0      # talking has to be this many times louder than the room's background noise


def add_cuda_dlls():
    """Whisper on the graphics card needs NVIDIA's cuBLAS DLLs. pip's nvidia-cublas-cu12 puts them in
    site-packages\\nvidia\\*\\bin, which Windows doesn't search on its own."""
    if os.name != "nt":
        return
    dirs = []
    for sp in sys.path:
        base = os.path.join(sp, "nvidia")
        if os.path.isdir(base):
            dirs += [os.path.join(base, d, "bin") for d in os.listdir(base) if os.path.isdir(os.path.join(base, d, "bin"))]
    if os.environ.get("CUDA_PATH"):
        dirs.append(os.path.join(os.environ["CUDA_PATH"], "bin"))
    for d in dirs:
        try:
            os.add_dll_directory(d)
        except OSError:
            pass
    os.environ["PATH"] = os.pathsep.join(dirs + [os.environ.get("PATH", "")])


class Listener:
    def __init__(self, cfg, on_text, is_muted, is_deaf=None):
        self.cfg = cfg["listen"]
        self.name = cfg["bot"]["name"]
        self.on_text = on_text      # async fn(text)
        self.is_muted = is_muted    # fn() -> True while the bot is talking (or deafened)
        self.is_deaf = is_deaf or (lambda: False)   # fn() -> True while dum has Gary deafened
        self.chunks = queue.Queue()
        self.timed = 0              # how many lines got a "Whisper took Xs" log line so far

    def start(self, loop):
        threading.Thread(target=self._guarded, args=(loop,), daemon=True).start()

    def _guarded(self, loop):
        # a bad device or model must end the mic only, not print a bare traceback and leave no trace in the log
        try:
            self._run(loop)
        except Exception:
            log.exception("Mic listening stopped; Gary keeps running without the mic")

    def _load_model(self, WhisperModel):
        """Graphics card first (much faster, and the CPU is busy with the LLM), the CPU if that doesn't work."""
        name = self.cfg["whisper_model"]
        want = str(self.cfg.get("whisper_device", "auto")).lower()
        if want in ("auto", "cuda", "gpu"):
            add_cuda_dlls()
            try:
                model = WhisperModel(name, device="cuda", compute_type="float16")
                # the GPU libraries only load on the first transcribe: test now, not on dum's first line
                list(model.transcribe(np.zeros(RATE, dtype=np.float32), language="en")[0])
                log.info("Whisper is running on the graphics card")
                return model, "GPU"
            except Exception as e:
                log.warning("Whisper couldn't use the graphics card, using the CPU instead (%s)", str(e)[:200])
        return WhisperModel(name, device="cpu", compute_type="int8"), "CPU"

    def _log_failure(self, fut):
        # on_text runs on the bot's loop; without this its errors would vanish silently
        if not fut.cancelled() and fut.exception():
            log.warning("Couldn't handle what the mic heard: %s", fut.exception())

    def _run(self, loop):
        try:
            import sounddevice as sd
            from faster_whisper import WhisperModel
        except ImportError:
            log.error("Mic listening needs:  pip install faster-whisper sounddevice")
            return
        log.info("loading whisper model (first run can take a minute): %s", self.cfg["whisper_model"])
        model, where = self._load_model(WhisperModel)
        threshold = float(self.cfg.get("energy_threshold", 0.015))
        dev = self.cfg.get("device") or None
        if isinstance(dev, str) and dev.isdigit():
            dev = int(dev)

        info = sd.query_devices(dev, "input")
        channels = max(1, min(2, int(info["max_input_channels"])))

        def callback(indata, frames, t, status):
            # interfaces like a Focusrite put the mic on input 1 OR 2, so use whichever channel is louder
            loudest = int(np.argmax(np.abs(indata).max(axis=0))) if channels > 1 else 0
            self.chunks.put(indata[:, loudest].copy())

        with sd.InputStream(samplerate=RATE, blocksize=BLOCK, channels=channels, dtype="float32", device=dev, callback=callback):
            log.info("Listening on the mic: %s", info["name"])
            speech, quiet = [], 0.0
            levels = collections.deque(maxlen=NOISE_WINDOW)
            gate = threshold
            while True:
                block = self.chunks.get()
                if self.is_muted():
                    speech, quiet = [], 0.0
                    continue
                # 2026-10-27 dum: "it is detecting wind or interference as sound and not closing". A fixed
                # threshold below the room's hum never hears the pause after a sentence, so every line ran to
                # the 20 s cap. The bar now sits above the background noise (the quiet end of the last 5 s)
                rms = float(np.sqrt(np.mean(block ** 2)))
                levels.append(rms)
                if len(levels) >= 30:
                    gate = max(threshold, float(np.percentile(levels, 20)) * NOISE_RATIO)
                loud = rms > gate and len(levels) >= 30   # first second: still learning the room
                if loud:
                    speech.append(block)
                    quiet = 0.0
                elif speech:
                    speech.append(block)
                    quiet += BLOCK / RATE
                length = len(speech) * BLOCK / RATE
                if speech and (quiet >= SILENCE_END or length >= MAX_SPEECH):
                    audio = np.concatenate(speech)
                    speech, quiet = [], 0.0
                    if length - SILENCE_END < MIN_SPEECH:
                        continue
                    t0 = time.monotonic()
                    segments, _ = model.transcribe(audio, language="en", vad_filter=True, beam_size=1,
                                                    initial_prompt=f"{self.name}, talking to {self.name} on stream.")
                    text = " ".join(s.text.strip() for s in segments).strip()
                    took = time.monotonic() - t0
                    self.timed += 1
                    # 2026-10-27 dum: "a lot of lag from when i speak and when it shows up". The first few lines
                    # and any slow one get timed, so the log shows whether Whisper is the hold-up
                    if self.timed <= 10 or took > 1.0 or length >= MAX_SPEECH:
                        log.info("Whisper: %.1fs of talk took %.2fs to transcribe (%s, mic bar %.3f)%s", length, took,
                                 where, gate, " - cut at the max length, the mic never went quiet" if length >= MAX_SPEECH else "")
                    if text and self.is_deaf():
                        continue    # deafened while this was being transcribed: it never happened
                    if text:
                        asyncio.run_coroutine_threadsafe(self.on_text(text), loop).add_done_callback(self._log_failure)
