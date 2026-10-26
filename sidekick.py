"""Stream Sidekick: a local AI co-host for OBS.

Chat (Streamer.bot or Twitch) -> Qwen in LM Studio -> local TTS -> talking avatar browser source.
Run:  python sidekick.py
"""
import asyncio
import collections
import copy
import json
import logging
import os
import random
import re
import sys
import time
import tomllib
import uuid
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web

from brain import Brain
from connections import StreamerBot, twitch_chat
from features import Features
from memory import Memory
from tts import TTS, wav_seconds

BASE = os.path.dirname(os.path.abspath(__file__))
OVERLAY = os.path.join(BASE, "overlay")
log = logging.getLogger("sidekick")


def foreign_origin(request):
    """True when a web page from another site is calling us. Browsers say so in the Origin header; Streamer.bot,
    curl and the OBS overlay (which is served by this app) either send no Origin or send localhost."""
    origin = request.headers.get("Origin")
    return bool(origin) and (urlsplit(origin).hostname or "") not in ("localhost", "127.0.0.1")


def deep_merge(dst, src):
    """Copies src into dst. Dicts merge key by key (so home.x doesn't wipe home.z); anything else is replaced."""
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


class Sidekick:
    def __init__(self, cfg):
        self.cfg = cfg
        self.bot = cfg["bot"]
        self.beh = cfg["behavior"]
        self.transcript = collections.deque(maxlen=self.beh.get("history_lines", 30))
        self.jobs = collections.deque(maxlen=6)
        self.alerts = collections.deque(maxlen=8)   # follows, raids, subs... they go first, in the order they happened
        self.want_chat = False
        self.want_interject = None
        self.last_activity = time.monotonic()
        self.last_spoke = 0.0
        self.last_unprompted = 0.0
        self.busy = False
        self.spoke_until = 0.0   # mic lines heard before this are Gary's own voice coming back through the mic
        self.paused = False
        self.overlays, self.controls = set(), set()
        self.audio = collections.OrderedDict()
        self.done = asyncio.Event()
        self.lm_status = "checking..."
        names = [self.bot["name"], *self.bot.get("aliases", [])]
        self.name_re = re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b", re.I)
        self.ignore = {u.lower() for u in cfg["chat"].get("ignore_users", [])}
        self.tts = TTS(cfg, BASE)
        self.memory = Memory(cfg, BASE)
        self.avatar = copy.deepcopy(cfg.get("avatar", {}))   # 3D avatar movement settings, relayed to overlays
        self.sb = None
        self.features = Features(self)   # games, races, voice effects, greetings... (features.py)
        saved = getattr(self.features, "saved_avatar", None)   # avatar settings kept across restarts, if features.py has them
        if isinstance(saved, dict):
            deep_merge(self.avatar, {k: v for k, v in saved.items() if k != "do"})

    # ------------------------------------------------------------ inputs

    def remember(self, who, text, kind="chat"):
        self.transcript.append(f"{who}: {text}")
        self.memory.record(who, text, kind)

    async def on_chat(self, user, text, platform="chat"):
        if await self.features.on_chat(user, text):   # game answers, votes, picks
            return
        if user.lower() in self.ignore:
            return
        is_ask = text.lower().startswith("!ask")
        if text.startswith("!") and not is_ask:
            return
        if is_ask:
            text = text[4:].strip() or "hi"
        log.info("[%s] %s: %s", platform, user, text)
        self.remember(user, text)
        self.last_activity = time.monotonic()
        if is_ask or self.name_re.search(text):
            self.jobs.append(("mention", user, text))
        elif time.monotonic() - self.last_unprompted >= self.beh["chat_cooldown_seconds"] \
                and random.random() < self.beh["reply_chance"]:
            self.want_chat = True

    async def on_streamer(self, text, spoken=False):
        if spoken and (self.busy or time.monotonic() < self.spoke_until) and not self.features.is_hush(text):
            return   # heard while Gary is talking (or just after, while his voice is still in the mic): only "Gary, hold that thought" and the like count
        who = self.bot["streamer_name"]
        log.info("[%s] %s: %s", "mic" if spoken else "you", who, text)
        self.remember(who, text, "streamer")
        self.last_activity = time.monotonic()
        if await self.features.on_streamer(text, spoken):   # clip that, voice effects, polls, trivia, recap...
            return
        wake_only = self.cfg["listen"].get("wake_word_only", True)
        if not spoken or not wake_only or self.name_re.search(text):
            self.jobs.append(("streamer", who, text))
        elif len(text.split()) >= 4 \
                and time.monotonic() - self.last_unprompted >= self.beh.get("interject_cooldown_seconds", 45) \
                and random.random() < self.beh.get("interject_chance", 0.25):
            # not talking to Gary, but a co-host who's listening sometimes chimes in on what was just said
            self.want_interject = text

    async def on_event(self, text):
        log.info("[event] %s", text)
        self.remember("(stream event)", text, "event")
        self.jobs.append(("event", None, text))

    # ------------------------------------------------------------ the director decides when to talk

    async def director(self):
        idle = self.beh.get("idle_seconds", 0)
        while True:
            await asyncio.sleep(0.3)
            if self.paused or self.busy:
                continue
            now = time.monotonic()
            if now - self.last_spoke < self.beh["min_gap_seconds"]:
                continue
            job = None
            if self.alerts:
                job = self.alerts.popleft()
            elif self.jobs:
                job = self.jobs.popleft()
            elif self.want_interject:
                job, self.want_interject = ("interject", self.bot["streamer_name"], self.want_interject), None
            elif self.want_chat:
                job, self.want_chat = ("chat", None, None), False
            elif idle and now - max(self.last_activity, self.last_spoke) >= idle:
                job = ("idle", None, None)
            if not job:
                continue
            self.busy = True
            try:
                await self.handle(*job)
            except Exception as e:
                log.error("Couldn't respond: %s", e)
                await self.send_overlays({"type": "idle"})
            finally:
                self.busy = False
                self.last_spoke = time.monotonic()

    async def handle(self, kind, who, text):
        if not self.features.may_speak(kind, who):
            log.info("[skip] %s job dropped: muted", kind)
            return   # muted ("Gary, stop talking for 15 minutes"): only alerts get through
        hush = self.features.hush_gen
        if kind != "say":
            await self.send_overlays({"type": "thinking"})
        lines = list(self.transcript)
        streamer = self.bot["streamer_name"]
        action = None
        memory = self.memory.context(lines) + self.features.extra_context()
        can_act = kind == "streamer" or (kind == "mention" and self.cfg["streamerbot"].get("chat_can_run_actions"))
        if kind in ("chat", "idle", "interject"):
            self.last_unprompted = time.monotonic()

        if kind == "say":
            speech = text
        elif can_act and self.sb and self.sb.connected and await self.sb.refresh_actions():
            speech, action = await self.brain.command(lines, who, text, self.sb.actions, memory)
        else:
            task = {
                "mention": f'{who} in chat just talked to you: "{text}". Answer them directly and use their name.',
                "streamer": f'{streamer} (the streamer) just said to you: "{text}". Respond to them.',
                "chat": "Jump into what chat is talking about right now: react to the latest messages like you've "
                        "been following along. Use chatters' names. Don't change the subject.",
                "interject": f'{streamer} just said: "{text}" (talking on stream, not directly to you). Chime in '
                             "like a co-host who's been listening: riff on it, react, or make a callback. "
                             "Keep it short.",
                "idle": "It's been quiet for a bit. Make one short comment that builds on the conversation so far "
                        "or a callback to something from earlier. Don't ask a random question.",
                "event": f"This just happened on stream: {text}. React out loud, and thank or hype the person by name.",
                "task": text,
                "alert": text,
            }[kind]
            speech = await self.brain.say(lines, task, memory)

        if action:
            try:
                await self.sb.do_action(action, {"sidekickRequest": text or "", "sidekickUser": who or ""})
                log.info("Ran Streamer.bot action: %s", action)
            except Exception as e:
                log.error("Action '%s' failed: %s", action, e)
        if speech and hush != self.features.hush_gen:
            speech = None   # dum said "hold that thought" while this was being thought up
        if speech:
            self.remember(self.bot["name"], speech, "bot")
            await self.speak(speech)
        else:
            await self.send_overlays({"type": "idle"})

    async def speak(self, text):
        log.info("%s says: %s", self.bot["name"], text)
        url, secs = None, max(2.0, len(text) / 14)
        try:
            wav = await self.tts.synth(text)
            aid = uuid.uuid4().hex
            self.audio[aid] = wav
            while len(self.audio) > 20:
                self.audio.popitem(last=False)
            url, secs = f"/audio/{aid}.wav", wav_seconds(wav)
        except Exception as e:
            log.error("TTS failed (showing text only): %s", e)
        if not self.overlays:
            log.warning("No overlay connected, so nobody hears this. Add the OBS Browser Source: local file "
                        "overlay\\loader.html (see README, OBS section).")
        self.done.clear()
        self.spoke_until = time.monotonic() + secs + 3   # the mic can hear the speakers for a few seconds after
        await self.send_overlays({"type": "say", "text": text, "audio": url, "seconds": secs})
        try:
            await asyncio.wait_for(self.done.wait(), secs + 5)
        except asyncio.TimeoutError:
            pass
        await self.send_overlays({"type": "idle"})

    # ------------------------------------------------------------ web server: overlay + control panel

    async def send_overlays(self, msg):
        await self._send(self.overlays, msg)

    async def send_controls(self, msg):
        await self._send(self.controls, msg)

    async def _send(self, clients, msg):
        for ws in list(clients):
            try:
                await ws.send_json(msg)
            except Exception:
                clients.discard(ws)

    def status(self):
        return {
            "type": "status", "lm": self.lm_status, "paused": self.paused, "overlays": len(self.overlays),
            "streamerbot": None if self.sb is None else self.sb.connected,
            "actions": [a["name"] for a in self.sb.actions] if self.sb else [],
            "avatar": self.avatar, "features": self.features.status(),
        }

    async def push_status(self):
        await self.send_controls(self.status())

    def store_avatar(self, change):
        """Keeps the avatar settings. A "do" is a one-shot reaction: it is relayed by the caller, never stored."""
        deep_merge(self.avatar, {k: v for k, v in change.items() if k != "do"})
        f = getattr(self.features, "on_avatar_set", None)   # features.py saves these across restarts
        if f:
            f(self.avatar)

    async def watch_lm(self):
        """LM Studio is often started after Gary. Until it answers, look again every 30 s and update the panel."""
        while True:
            await asyncio.sleep(30)
            if self.lm_status.startswith("Can't reach"):
                status = await self.brain.check()
                if status != self.lm_status:
                    self.lm_status = status
                    log.info(status)
                    await self.push_status()

    async def supervise(self, name, factory):
        """Runs one background job forever. If it crashes, the error is logged and it starts again after 5 s."""
        while True:
            try:
                await factory()
                log.warning("%s stopped; restarting in 5s", name)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("%s crashed; restarting in 5s", name)
            await asyncio.sleep(5)

    async def ws_handler(self, request):
        if foreign_origin(request):
            return web.Response(status=403, text="forbidden: this page is not from this PC")
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        role = None
        try:
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    continue
                msg = json.loads(m.data)
                t = msg.get("type")
                if t == "hello":
                    role = msg.get("role")
                    if role == "overlay":
                        self.overlays.add(ws)
                        png = all(os.path.exists(os.path.join(OVERLAY, "avatar", f)) for f in ("closed.png", "open.png"))
                        await ws.send_json({"type": "config", "name": self.bot["name"], "png": png})
                        await ws.send_json({"type": "avatar", "set": self.avatar})
                        log.info("Overlay connected")
                    else:
                        self.controls.add(ws)
                        await ws.send_json(self.status())
                        for line in LOG_BUFFER:
                            await ws.send_json({"type": "log", "line": line})
                    await self.push_status()
                elif t == "done":
                    self.done.set()
                elif t == "chat":
                    await self.on_chat(msg.get("user") or "tester", msg.get("text", ""), "test")
                elif t == "streamer":
                    await self.on_streamer(msg.get("text", ""))
                elif t == "say":
                    self.jobs.append(("say", None, msg.get("text", "")))
                elif t == "event":
                    await self.on_event(msg.get("text", ""))
                elif t == "idle_now":
                    self.jobs.append(("idle", None, None))
                elif t == "pause":
                    self.paused = not self.paused
                    log.info("Paused" if self.paused else "Resumed")
                    await self.push_status()
                elif t == "skip":
                    await self.send_overlays({"type": "stop"})
                    self.done.set()
                elif t == "avatar":
                    change = msg.get("set") or {}
                    acts = change.get("acts")
                    if isinstance(acts, dict) and "scene" in acts and "sceneAt" not in acts:
                        acts["sceneAt"] = int(time.time() * 1000)   # when the scene was picked, so an old pick isn't replayed
                    self.store_avatar(change)
                    await self.send_overlays({"type": "avatar", "set": change})
                    await self.push_status()
                elif t == "refresh":
                    if self.sb:
                        await self.sb.refresh_actions()
                    self.lm_status = await self.brain.check()
                    await self.push_status()
        finally:
            self.overlays.discard(ws)
            self.controls.discard(ws)
            if role:
                await self.push_status()
        return ws

    async def api(self, request):
        """GET or POST /api/{event|say|streamer|chat}?text=...  (handy for Streamer.bot 'Fetch URL')."""
        if foreign_origin(request):
            return web.json_response({"ok": False, "error": "forbidden"}, status=403)
        params = dict(request.query)
        if request.method == "POST" and request.can_read_body:
            try:
                params.update(await request.json())
            except Exception:
                params.update(await request.post())
        text = (params.get("text") or "").strip()
        kind = request.match_info["kind"]
        if not text and kind in ("event", "say", "streamer", "chat"):
            return web.json_response({"ok": False, "error": "missing text"}, status=400)
        if kind == "event":
            await self.on_event(text)
        elif kind == "say":
            self.jobs.append(("say", None, text))
        elif kind == "streamer":
            await self.on_streamer(text)
        elif kind == "chat":
            await self.on_chat(params.get("user") or "viewer", text, params.get("platform") or "api")
        elif kind == "idle":
            self.jobs.append(("idle", None, None))
        else:
            res = await self.features.api(kind, params)
            if res is None:
                return web.json_response({"ok": False, "error": "unknown"}, status=404)
            return web.json_response(res)
        return web.json_response({"ok": True})

    async def audio_handler(self, request):
        data = self.audio.get(request.match_info["aid"])
        if data is None:
            raise web.HTTPNotFound()
        return web.Response(body=data, content_type="audio/wav", headers={"Cache-Control": "no-store"})

    # ------------------------------------------------------------ start everything

    async def run(self):
        session = aiohttp.ClientSession()
        self.brain = Brain(self.cfg, session)
        port = self.cfg["server"]["port"]

        app = web.Application()
        app.router.add_get("/", lambda r: web.HTTPFound("/static/byte3d.html"))   # the 3D overlay (index.html is the old 2D one)
        app.router.add_get("/control", lambda r: web.FileResponse(os.path.join(OVERLAY, "control.html")))
        app.router.add_get("/ws", self.ws_handler)
        app.router.add_get("/memory", lambda r: web.json_response(self.memory.data))
        app.router.add_get("/audio/{aid}.wav", self.audio_handler)
        app.router.add_route("*", "/api/{kind}", self.api)
        app.router.add_static("/static", OVERLAY)
        self.features.routes(app)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", port).start()

        self.lm_status = await self.brain.check()
        log.info(self.lm_status)
        log.info("OBS Browser Source:  local file overlay\\loader.html, or http://localhost:%d/static/byte3d.html "
                 "(width 400, height 400)", port)
        log.info("Control panel:       http://localhost:%d/control", port)

        tasks = [self.supervise("Director", self.director),
                 self.supervise("Memory", lambda: self.memory.maintain(
                     self.brain, lambda: not self.busy and not self.jobs and not self.alerts)),
                 self.supervise("Features", self.features.run),
                 self.supervise("LM Studio check", self.watch_lm)]
        src = self.cfg["chat"].get("source", "streamerbot")
        use_sb_actions = bool(self.cfg["streamerbot"].get("url"))
        if src == "streamerbot" or use_sb_actions:
            self.sb = StreamerBot(self.cfg, session)
            self.sb.on_event = self.features.on_sb_event   # raids, subs, cheers, follows, OBS scenes
            tasks.append(self.supervise("Streamer.bot", lambda: self.sb.run(
                on_chat=self.on_chat if src == "streamerbot" else None, on_status=self.push_status)))
        if src == "twitch":
            tasks.append(self.supervise("Twitch chat", lambda: twitch_chat(self.cfg["chat"]["twitch_channel"], self.on_chat)))
        if self.cfg["listen"].get("enabled"):
            from listen import Listener
            Listener(self.cfg, lambda t: self.on_streamer(t, spoken=True),
                     lambda: self.busy and not self.features.cfg["quiet"].get("listen_while_talking", True)).start(
                asyncio.get_running_loop())
        await asyncio.gather(*tasks)   # the jobs are supervised, so this only ends on shutdown


LOG_BUFFER = collections.deque(maxlen=200)


class ControlLogHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.sidekick = None

    def emit(self, record):
        line = self.format(record)
        LOG_BUFFER.append(line)
        if self.sidekick and self.sidekick.controls:
            try:
                asyncio.get_running_loop().create_task(self.sidekick.send_controls({"type": "log", "line": line}))
            except RuntimeError:
                pass


def main():
    cfg_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "config.toml")
    with open(cfg_path, "rb") as f:
        cfg = tomllib.load(f)
    fmt = logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S")
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    panel = ControlLogHandler()
    panel.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[console, panel])
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    sk = None

    async def start():
        nonlocal sk
        sk = Sidekick(cfg)
        panel.sidekick = sk
        await sk.run()

    try:
        asyncio.run(start())
    except KeyboardInterrupt:
        pass
    finally:
        if sk:
            sk.memory.save()
            sk.features.save()


if __name__ == "__main__":
    main()
