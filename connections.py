"""Chat sources (Streamer.bot or Twitch IRC) and the Streamer.bot action runner."""
import asyncio
import base64
import hashlib
import logging
import random
import re
import uuid

import aiohttp

log = logging.getLogger("conn")


# ---------------------------------------------------------------- Twitch (direct, read-only)

PRIVMSG_RE = re.compile(r"^(?:@(?P<tags>\S+) )?:(?P<user>[^!]+)!\S+ PRIVMSG #\S+ :(?P<text>.*)$")


async def twitch_chat(channel, on_chat):
    """Reads Twitch chat anonymously. Calls on_chat(user, text, platform)."""
    channel = channel.lower().lstrip("#")
    while True:
        try:
            reader, writer = await asyncio.open_connection("irc.chat.twitch.tv", 6667)
            nick = f"justinfan{random.randint(10000, 99999)}"
            writer.write(f"CAP REQ :twitch.tv/tags\r\nPASS SCHMOOPIIE\r\nNICK {nick}\r\nJOIN #{channel}\r\n".encode())
            await writer.drain()
            log.info("Reading Twitch chat for #%s", channel)
            while line := await reader.readline():
                line = line.decode("utf-8", "ignore").rstrip("\r\n")
                if line.startswith("PING"):
                    writer.write(b"PONG :tmi.twitch.tv\r\n")
                    await writer.drain()
                    continue
                m = PRIVMSG_RE.match(line)
                if not m:
                    continue
                user = m["user"]
                for tag in (m["tags"] or "").split(";"):
                    if tag.startswith("display-name=") and len(tag) > 13:
                        user = tag[13:]
                await on_chat(user, m["text"], "twitch")
        except Exception as e:
            log.warning("Twitch chat disconnected: %s", e)
        await asyncio.sleep(5)


# ---------------------------------------------------------------- Streamer.bot

CHAT_EVENTS = {"Twitch": ["ChatMessage"], "YouTube": ["Message"], "Kick": ["ChatMessage"], "Trovo": ["ChatMessage"]}
# other events passed to on_event (raids, subs... for features.py), subscribed one at a time
OTHER_EVENTS = {"Twitch": ["Raid", "Sub", "ReSub", "GiftSub", "GiftBomb", "Cheer", "Follow", "RewardRedemption"],
                "Obs": ["SceneChanged"]}


def _who(data):
    """Who a non-chat event is about, for the log line. Streamer.bot puts the name in a few different places."""
    user = data.get("user")
    if isinstance(user, dict):
        for k in ("name", "login", "displayName", "userName"):
            if user.get(k):
                return str(user[k])
    for k in ("displayName", "userName", "user"):
        if isinstance(data.get(k), str) and data[k]:
            return data[k]
    return "?"


def _parse_chat(data):
    """Streamer.bot's payload differs a bit by version and platform, so look in the usual places."""
    msg = data.get("message")
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    text = None
    name = None
    if isinstance(msg, dict):
        text = msg.get("message") or msg.get("text")
        name = msg.get("displayName") or msg.get("username") or msg.get("userName")
    elif isinstance(msg, str):
        text = msg
    text = text or data.get("text") or data.get("messageStripped")
    name = name or user.get("name") or user.get("display") or user.get("login") or data.get("displayName") or data.get("userName") or data.get("user")
    if isinstance(name, dict):
        name = name.get("name")
    return (str(name) if name else None), text


class StreamerBot:
    def __init__(self, cfg, session: aiohttp.ClientSession):
        self.cfg = cfg["streamerbot"]
        self.session = session
        self.ws = None
        self.pending = {}
        self.actions = []
        self.connected = False
        self.on_chat = None
        self.on_status = None
        self.on_event = None
        self._warned = False      # "not connected" warning is logged once per outage, not every 5 s
        self._sub_logged = False  # the first raw Subscribe reply is logged once, so its shape is visible
        self._tasks = set()       # strong refs to our background tasks (asyncio only keeps weak ones)

    async def run(self, on_chat=None, on_status=None):
        self.on_chat, self.on_status = on_chat, on_status
        while True:
            try:
                async with self.session.ws_connect(self.cfg["url"], heartbeat=20) as ws:
                    self.ws = ws
                    self._hello = None
                    self._hello_evt = asyncio.Event()
                    reader = asyncio.create_task(self._reader())
                    await self._setup()
                    self._warned = False   # connected again: the next outage gets its own warning
                    await reader
                    log.info("Streamer.bot connection closed; retrying in 5s")
            except Exception as e:
                if not self._warned:
                    log.warning("Streamer.bot not connected (%s). Retrying every 5s...", e)
                    self._warned = True
            self.connected = False
            self.ws = None
            await self._status()
            await asyncio.sleep(5)

    def _spawn(self, coro):
        """Runs coro as its own task, so one failing handler can't end the reader. The set keeps it alive."""
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    async def _status(self):
        if self.on_status:
            await self.on_status()

    async def _reader(self):
        async for m in self.ws:
            if m.type != aiohttp.WSMsgType.TEXT:
                continue
            data = m.json()
            if data.get("request") == "Hello":
                self._hello = data
                self._hello_evt.set()
                continue
            if data.get("id") in self.pending:
                self.pending.pop(data["id"]).set_result(data)
                continue
            ev = data.get("event")
            if ev and self.on_chat and ev.get("type") in CHAT_EVENTS.get(ev.get("source"), []):
                name, text = _parse_chat(data.get("data") or {})
                if name and text:
                    # as a task: a bug in a chat feature must not drop the socket (and every event with it)
                    self._spawn(self._chat(name, text, ev["source"].lower()))
            elif ev:
                log.info("[sb] %s.%s from %s", ev.get("source"), ev.get("type"), _who(data.get("data") or {}))
                if self.on_event:
                    # as a task, so the handler can make its own requests without blocking this reader
                    self._spawn(self._event(ev.get("source"), ev.get("type"), data.get("data") or {}))

    async def _chat(self, user, text, platform):
        try:
            await self.on_chat(user, text, platform)
        except Exception as e:
            log.warning("Couldn't handle chat from %s: %s", user, e)

    async def _event(self, source, etype, data):
        try:
            await self.on_event(source, etype, data)
        except Exception as e:
            log.warning("Couldn't handle Streamer.bot event %s: %s", etype, e)

    def _check_subscribe(self, platform, names, res):
        """Streamer.bot answers every Subscribe; a refusal says why (wrong event name, not allowed, etc)."""
        if not self._sub_logged:
            self._sub_logged = True
            log.info("First Subscribe reply (%s): %s", platform, res)
        if res.get("status") in (None, "ok"):
            for n in names:
                log.info("Subscribed to %s.%s", platform, n)
        else:
            log.warning("Streamer.bot refused Subscribe to %s %s: %s", platform, ", ".join(names),
                        res.get("error", res))

    async def request(self, req, timeout=10, **fields):
        if not self.ws:
            raise RuntimeError("Streamer.bot is not connected")
        rid = uuid.uuid4().hex
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        await self.ws.send_json({"request": req, "id": rid, **fields})
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(rid, None)

    async def _setup(self):
        # Newer Streamer.bot versions send a Hello first, with an auth challenge if a password is set.
        try:
            await asyncio.wait_for(self._hello_evt.wait(), 3)
        except asyncio.TimeoutError:
            pass
        auth = (self._hello or {}).get("authentication")
        if auth:
            pw = self.cfg.get("password", "")
            if not pw:
                raise RuntimeError("Streamer.bot wants a password: set [streamerbot] password in config.toml")
            secret = base64.b64encode(hashlib.sha256((pw + auth["salt"]).encode()).digest()).decode()
            token = base64.b64encode(hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()
            res = await self.request("Authenticate", authentication=token)
            if res.get("status") != "ok":
                raise RuntimeError(f"Streamer.bot login failed: {res.get('error', res)}")
        if self.on_chat:
            for platform, events in CHAT_EVENTS.items():
                try:  # one at a time so a platform this version doesn't know can't break the others
                    res = await self.request("Subscribe", events={platform: events})
                    self._check_subscribe(platform, events, res)
                except Exception as e:
                    log.warning("Subscribe to %s chat failed: %s", platform, e)
        if self.on_event:
            for platform, events in OTHER_EVENTS.items():
                for e in events:
                    try:
                        res = await self.request("Subscribe", events={platform: [e]})
                        self._check_subscribe(platform, [e], res)
                    except Exception as ex:
                        log.warning("Subscribe to %s.%s failed: %s", platform, e, ex)
        self.connected = True
        await self.refresh_actions()
        log.info("Connected to Streamer.bot. %d sidekick action(s): %s",
                 len(self.actions), ", ".join(a["name"] for a in self.actions) or "none")
        await self._status()

    async def refresh_actions(self):
        if not self.connected:
            return self.actions
        try:
            res = await self.request("GetActions")
            group = self.cfg.get("action_group", "Sidekick").lower()
            self.actions = [
                a for a in res.get("actions", [])
                if a.get("enabled", True) and (a.get("group") or "").lower() == group
            ]
        except Exception as e:
            log.warning("Couldn't load Streamer.bot actions: %s", e)
        return self.actions

    async def do_action(self, name, args=None):
        act = next((a for a in self.actions if a["name"] == name), None)
        if not act:
            raise ValueError(f"'{name}' is not in the {self.cfg.get('action_group')} group")
        res = await self.request("DoAction", action={"id": act["id"], "name": act["name"]}, args=args or {})
        if res.get("status") not in (None, "ok"):
            raise RuntimeError(res.get("error", res))
        return res
