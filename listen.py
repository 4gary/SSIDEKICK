"""Optional: hear the streamer through the mic and turn speech into text, all locally.

Needs:  pip install faster-whisper sounddevice
"""
import asyncio
import logging
import queue
import threading

import numpy as np

log = logging.getLogger("listen")
logging.getLogger("faster_whisper").setLevel(logging.WARNING)  # hide per-chunk "VAD filter removed" noise

RATE = 16000
BLOCK = 480            # 30 ms
SILENCE_END = 0.8      # seconds of quiet that ends a sentence
MIN_SPEECH = 0.4       # ignore blips shorter than this
MAX_SPEECH = 20        # force-cut very long talking


class Listener:
    def __init__(self, cfg, on_text, is_muted):
        self.cfg = cfg["listen"]
        self.name = cfg["bot"]["name"]
        self.on_text = on_text      # async fn(text)
        self.is_muted = is_muted    # fn() -> True while the bot is talking
        self.chunks = queue.Queue()

    def start(self, loop):
        threading.Thread(target=self._guarded, args=(loop,), daemon=True).start()

    def _guarded(self, loop):
        # a bad device or model must end the mic only, not print a bare traceback and leave no trace in the log
        try:
            self._run(loop)
        except Exception:
            log.exception("Mic listening stopped; Gary keeps running without the mic")

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
        model = WhisperModel(self.cfg["whisper_model"], device="cpu", compute_type="int8")
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
            while True:
                block = self.chunks.get()
                if self.is_muted():
                    speech, quiet = [], 0.0
                    continue
                loud = float(np.sqrt(np.mean(block ** 2))) > threshold
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
                    segments, _ = model.transcribe(audio, language="en", vad_filter=True, beam_size=1,
                                                    initial_prompt=f"{self.name}, talking to {self.name} on stream.")
                    text = " ".join(s.text.strip() for s in segments).strip()
                    if text:
                        asyncio.run_coroutine_threadsafe(self.on_text(text), loop).add_done_callback(self._log_failure)
