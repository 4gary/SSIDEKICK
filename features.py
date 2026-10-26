"""Gary's co-host features, kept apart from the core app so they're easy to tune and turn off.

- voice effects: runs your Streamer.bot voice-effect actions on request, and now and then on his own
- marble races: hypes the start, calls the race (with vision), names the winner, roasts last place, race stats
- chat games: polls, trivia, predictions, with a points leaderboard and an OBS overlay (/games)
- regulars: greets people the first time they chat each day, with a callback to what he remembers
- raids/subs/gifts/cheers/follows straight from Streamer.bot, with specifics instead of a generic thanks
- "Gary, clip that", end-of-stream recap, green screen roles (News, Weather), glancing at the screen

Settings live in features.toml. Long-term stats live in features_data.json (plain text, safe to edit
while Gary is off).
"""
import asyncio
import copy
import datetime
import json
import logging
import os
import random
import re
import time
import tomllib

import aiohttp
from aiohttp import web

from obs import OBS

log = logging.getLogger("features")
BASE = os.path.dirname(os.path.abspath(__file__))
CHAT_PREFIX = "[Gary] "
LETTERS = "ABCD"

DEFAULTS = {
    "voice_effects": {"enabled": True, "keywords": ["robot", "helium", "deep", "echo", "alien"],
                      "on_his_own": True, "own_min_minutes": 20, "own_chance": 0.04,
                      "effect_seconds": 10},
    "regulars": {"enabled": True, "regular_after_days": 3, "greet_new": True, "welcome_back_days": 14,
                 "greet_gap_seconds": 40, "first_chatter_shoutout": True},
    "events": {"enabled": True, "follows": True, "redeems": True, "shoutout_keyword": "shout"},
    "polls": {"seconds": 90, "trivia_seconds": 30, "trivia_rounds": 3, "predict_seconds": 120, "chat_messages": True},
    "race": {"predictions": True, "pick_seconds": 45, "glance_after_seconds": 25, "start_on_scene": "",
             "winner_chat_pattern": ""},
    "clips": {"keyword": "clip"},
    # OBS scene name (regex, lowercase) -> Gary's stream mode on the overlay. First match wins.
    "scene_modes": {"marble": r"marble", "ending": r"\b(ending|outro|end screen|that'?s the show|goodbye)\b",
                    "starting": r"\b(starting|soon|intro)\b", "brb": r"\b(brb|be right back|break|away)\b",
                    "party": r"\b(party|disco|dance)\b", "chill": r"\b(chill|lofi|cozy)\b",
                    "gaming": r"\b(games?|gaming|gameplay)\b", "chatting": r"\b(chat|chatting|camera|cam|talk)\b"},
    "crowd": {"hype": True, "hype_messages": 6, "hype_people": 4, "rip": True, "rip_messages": 4, "window_seconds": 10,
              "cooldown_seconds": 120},
    "effects": {"enabled": True, "prefix": "FX", "seconds": {"acid": 30, "drunk": 30, "turn off": 30},
                "aliases": {"acid": ["acid", "trip", "tripping", "lsd", "shrooms"], "drunk": ["drunk", "wasted", "hammered"],
                            "turn off": ["signal lost", "fake end", "kill the stream"]}},
    "quiet": {"listen_while_talking": True, "default_minutes": 0, "max_minutes": 60, "say_back": True,
              "alerts_while_muted": True, "away_activities": ["nap", "couch", "dj", "arcade", "phone", "lieback"]},
    "roles": {},
    "vision": {"enabled": True, "model": "", "glance_minutes": 4, "comment_chance": 0.35},
    "obs": {"url": "", "password": ""},
}


def _today():
    return datetime.date.today().isoformat()


def _yesterday():
    return (datetime.date.today() - datetime.timedelta(days=1)).isoformat()


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _first(d, keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def event_user(d, nested=("user", "from", "raider", "message")):
    """Streamer.bot payloads name the user differently per event and version, so look in the usual places."""
    if not isinstance(d, dict):
        return None
    name = _first(d, ("from_broadcaster_user_name", "displayName", "display_name", "user_name", "userName",
                      "username", "name", "login", "user_login", "from_broadcaster_user_login"))
    if name:
        return name
    if isinstance(d.get("user"), str) and d["user"].strip():     # some payloads just say "user": "bob"
        return d["user"].strip()
    for k in nested:
        if isinstance(d.get(k), dict):
            name = event_user(d[k], ())
            if name:
                return name
    return None


def sub_tier(v):
    """Streamer.bot sends subTier as 0 (Prime), 1, 2 or 3; some payloads say 1000/2000/3000 or "prime".
    Returns (tier as "1000"/"2000"/"3000" or "", is_prime)."""
    s = "" if v is None else str(v).strip().lower()
    if s in ("0", "prime"):
        return "", True
    s = {"1": "1000", "2": "2000", "3": "3000"}.get(s, s)
    return (s if s in ("1000", "2000", "3000") else ""), False


def _int(v, default=0):
    """Query values arrive as text, and a placeholder like "%viewers%" can slip through: use the default."""
    if v in (None, ""):
        return default
    try:
        return int(float(v))
    except (TypeError, ValueError, OverflowError):
        log.warning("Ignoring non-number %r, using %s", v, default)
        return default


def event_num(d, keys):
    if not isinstance(d, dict):
        return 0
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
            return int(v)
    for sub in ("message", "event", "data"):
        if isinstance(d.get(sub), dict):
            n = event_num(d[sub], keys)
            if n:
                return n
    return 0


class Features:
    def __init__(self, sk):
        self.sk = sk
        self.cfg = {k: dict(v) for k, v in DEFAULTS.items()}
        path = os.path.join(BASE, "features.toml")
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    for k, v in tomllib.load(f).items():
                        self.cfg.setdefault(k, {}).update(v)
            except Exception as e:
                log.error("features.toml has a mistake (%s); using defaults", e)
        self.data_path = os.path.join(BASE, "features_data.json")
        self.state = {"visits": {}, "greeted": {"date": "", "names": []}, "points": {}, "race": {"wins": {}, "last": {},
                      "count": 0, "champ": ""}, "raids": {}, "trivia_asked": [], "today": {"date": "", "events": []}}
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, encoding="utf-8") as f:
                    self.state.update(json.load(f))
            except Exception as e:
                log.error("Couldn't read features_data.json (%s), starting fresh", e)
        self.dirty = False
        self.poll = self.trivia = self.predict = self.race = None
        self.role = None            # (key, prompt) while a green screen scene is live
        self.arrivals = []          # people waiting for a hello
        self.follows = []
        self.last_greet = 0.0
        self.last_effect = time.monotonic()
        self.last_streamer = 0.0
        self.last_glance = time.monotonic()
        self.recent = {}            # de-duplicates stream events
        self.gift_bombs = {}
        self.vision_ok = True
        self.vision_off_at = 0.0    # when vision was switched off (it is tried again after 10 minutes)
        self.glancing = False       # one screen glance in flight at a time
        self.games_ws = set()
        self.obs = None
        self.scene = ""
        self._warned = set()
        self.hush_gen = 0           # bumps when dum cuts Gary off; lines thought up before that are dropped
        self.mute_until = 0.0       # Gary stays quiet until then (inf = until told)
        self.away = None            # {"mode": mode to go back to, "next": time of next idle activity} while sent away
        self.held = None            # (time, line) Gary got cut off on, for "go ahead"
        # where he was told to stand, and the control page settings: sidekick.py deep-merges saved_avatar on startup
        saved = {k: copy.deepcopy(v) for k, v in (self.state.get("avatar") or {}).items() if k != "do"}
        self.saved_avatar = saved or None
        if saved:
            sk.avatar.update(saved)                   # ("Gary, stay at the bottom" is remembered too)
        pat = self.cfg["race"].get("winner_chat_pattern")
        self.winner_re = re.compile(pat, re.I) if pat else None

    # ------------------------------------------------------------ small helpers

    @property
    def streamer(self):
        return self.sk.bot["streamer_name"]

    def task(self, prompt, unprompted=False, alert=False):
        if alert:
            q = getattr(self.sk, "alerts", None)     # sidekick.py's own FIFO, played before chat
            if q is not None:
                q.append(("alert", None, prompt))
            else:
                self.sk.jobs.appendleft(("alert", None, prompt))   # ahead of chat, so it lands with the 3D reaction
        else:
            self.sk.jobs.append(("task", None, prompt))
        if unprompted:
            self.sk.last_unprompted = time.monotonic()

    HYPE_RE = re.compile(r"(\bpog|\blet'?s ?go+|\bhype\b|\bkekw\b|\blul\b|\bomegalul\b|\bw+\b$|\bgg+s?\b|\bclutch\b|"
                         r"\binsane\b|!{3,}|\b(lmao+|lol+)\b)", re.I)
    RIP_RE = re.compile(r"^\s*(f+|rip|o7|press f|f in (the )?chat|rip bozo|rest in peace)\s*$", re.I)

    async def crowd(self, user, text):
        """Chat spamming hype or F's at once -> Gary celebrates or mourns on the overlay."""
        cc = self.cfg["crowd"]
        now = time.monotonic()
        win = cc.get("window_seconds", 10)
        for kind, regex, need in (("hype", self.HYPE_RE, cc.get("hype_messages", 6)),
                                  ("rip", self.RIP_RE, cc.get("rip_messages", 4))):
            if not cc.get(kind) or not regex.search(text) or (kind == "hype" and len(text) > 60):
                continue
            hits = self.recent.setdefault(f"crowd_{kind}", [])
            hits.append((now, user.lower()))
            hits[:] = [h for h in hits if now - h[0] < win]
            people = len({u for _, u in hits})
            enough = len(hits) >= need and people >= (cc.get("hype_people", 4) if kind == "hype" else min(3, need))
            if enough and now - self.recent.get(f"crowd_{kind}_at", -999) > cc.get("cooldown_seconds", 120):
                self.recent[f"crowd_{kind}_at"] = now
                hits.clear()
                log.info("Chat is going %s", "wild" if kind == "hype" else "F")
                await self.avatar_do(kind, "chat", n=people)

    async def avatar_do(self, name, who="", **info):
        """One-shot animation on the 3D overlay: raid, sub, bits, follow, hype, rip, redeem..."""
        do = {"name": name, "at": int(time.time() * 1000), "who": who or ""}
        do.update({k: v for k, v in info.items() if v not in (None, "", 0)})
        await self.sk.send_overlays({"type": "avatar", "set": {"do": do}})

    ALERT_ANGLES = [
        "act shocked and suspicious, like they clearly made a terrible decision",
        "warn them, half-joking, about what they just signed up for",
        "hype it up like a sports announcer for a second",
        "be weirdly sincere for a moment, then undercut it with a joke",
        "tie it to whatever is happening on stream or in chat right now",
        "roast dum a little for not deserving this",
        "make up a tiny ridiculous detail about them, clearly as a joke",
        "act like this is the biggest moment in DUMSTREAM history",
        "be dry and deadpan about it",
        "give them a fake title or award on the spot",
    ]

    def alert_task(self, prompt):
        angle = random.choice(self.ALERT_ANGLES)
        self.task(prompt + f" This time, {angle}. Make it sound off the cuff, like you just noticed it. Never use stock "
                  "lines like 'thanks for the follow', 'thank you for subscribing' or 'welcome to the stream', and don't "
                  "start the way you started your last alert. Keep it short.", alert=True)

    def say(self, text):
        self.sk.jobs.append(("say", None, text))

    def save(self):
        tmp = self.data_path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.state, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.data_path)
            self.dirty = False
        except OSError as e:
            log.warning("Couldn't save features_data.json (%s)", e)

    def log_event(self, text):
        today = self.state["today"]
        if today.get("date") != _today():
            if today.get("date"):
                self.state["yesterday"] = {"date": today["date"], "events": today.get("events", [])}
            today.update(date=_today(), events=[])
        today["events"].append(f"{datetime.datetime.now():%H:%M} {text}")
        del today["events"][:-80]
        self.dirty = True

    def warn_once(self, key, msg, *args):
        if key not in self._warned:
            self._warned.add(key)
            log.warning(msg, *args)

    def sb_ok(self):
        return self.sk.sb is not None and self.sk.sb.connected

    def actions_with(self, *words):
        if not self.sb_ok():
            return []
        return [a["name"] for a in self.sk.sb.actions if any(w.lower() in a["name"].lower() for w in words)]

    async def run_action(self, name, user=""):
        try:
            await self.sk.sb.do_action(name, {"sidekickRequest": name, "sidekickUser": user or ""})
            log.info("Ran Streamer.bot action: %s", name)
            return True
        except Exception as e:
            log.error("Action '%s' failed: %s", name, e)
            return False

    async def chat(self, text):
        # fire and forget: this can be called from inside Streamer.bot's reader, which must stay free
        if self.cfg["polls"].get("chat_messages") and self.sb_ok():
            asyncio.create_task(self._chat(text))

    async def _chat(self, text):
        try:
            await self.sk.sb.request("SendMessage", platform="twitch", bot=False, internal=True,
                                     message=(CHAT_PREFIX + text)[:480])
        except Exception as e:
            self.warn_once("chat", "Couldn't post in chat through Streamer.bot (%s)", e)

    def person_facts(self, name, n=4):
        p = self.sk.memory.data.get("people", {}).get(name.lower())
        return (p or {}).get("facts", [])[-n:]

    def proper_name(self, name):
        """Voice commands come in lowercase; use the spelling chat knows the person by."""
        name = name.strip().lstrip("@")
        key = name.lower()
        for src in (self.state["visits"].get(key), self.sk.memory.data.get("people", {}).get(key)):
            if src and src.get("name"):
                return src["name"]
        return self.state["race"].get("wins_names", {}).get(key) or (name if name != key else name.capitalize())

    def add_points(self, name, pts):
        e = self.state["points"].setdefault(name.lower(), {"name": name, "points": 0})
        e["points"] += pts
        self.dirty = True

    def leaderboard(self, n=5):
        rows = sorted(self.state["points"].values(), key=lambda e: -e["points"])
        return [(e["name"], e["points"]) for e in rows[:n] if e["points"] > 0]

    async def llm_json(self, system, user, schema, temperature=0.8, max_tokens=600):
        brain = self.sk.brain
        if brain.llm.get("no_think", True):
            system += "\n/no_think"
        raw = await brain._complete(system, user, schema, temperature=temperature, max_tokens=max_tokens)
        m = re.search(r"\{.*\}", re.sub(r"<think>.*?(</think>|$)", "", raw, flags=re.S), re.S)
        return json.loads(m.group(0)) if m else {}

    def recent_lines(self, n=12):
        return "\n".join(list(self.sk.transcript)[-n:]) or "(nothing yet)"

    # ------------------------------------------------------------ hooks called by sidekick.py

    def extra_context(self):
        if not self.role:
            return ""
        return "\n\nRIGHT NOW you're playing a role on stream. " + self.role[1]

    async def on_chat(self, user, text):
        """Return True if the message was a game answer (or Gary's own chat post) and needs nothing else."""
        if text.startswith(CHAT_PREFIX.strip()):
            return True
        if self.winner_re and self.race:
            m = self.winner_re.search(text)
            if m and m.groupdict().get("winner"):
                await self.race_end(m["winner"].strip())
                return True
        if user.lower() in self.sk.ignore:
            return False
        await self.crowd(user, text.strip())
        if self.take_answer(user, text.strip()):
            return True
        self.note_arrival(user, text)
        return False

    def norm_cmd(self, text, keep_case=False):
        """What Gary matches on: the text without his name, without " ,.!?" at the ends, single spaces.
        Lowercase unless keep_case (names and topics keep the spelling dum used)."""
        t = re.sub(r"\s+", " ", self.sk.name_re.sub(" ", text)).strip(" ,.!?")
        return t if keep_case else t.lower()

    async def on_streamer(self, text, spoken=False):
        """Handles clear-cut commands (clip, voice effects, games, recap...). Return True if handled."""
        self.last_streamer = time.monotonic()
        if spoken and not self.sk.name_re.search(text):
            return False
        raw = self.norm_cmd(text, keep_case=True)
        cmd = raw.lower()
        try:
            if await self.quiet_command(cmd):
                return True
            if self.muted() and self.sk.name_re.search(text):
                self.unmute()     # dum called him by name: he's back and answers
            return await self.command(cmd, raw)
        except Exception as e:
            log.error("Feature command failed: %s", e)
            return False

    # ------------------------------------------------------------ hold that thought / quiet for X minutes

    QUIET = (r"\b(stop talking|no talking|shut up|shush|shh+|hush|zip it|pipe down|(be|keep|stay) quiet|quiet (down|please|for)|"
             r"mute yourself|mute for|silence for|not now|take (five|ten)|^(quiet|mute|silence)$)")
    AWAY = r"\b(go away|get lost|scram|beat it|take a hike|go (take a nap|chill))\b"
    HUSH = r"\b(hold (that|the|your|on|up)|hang on|one sec(ond)?|wait|that'?s enough|cut it|^stop( it| now| right there)?$)\b|" + QUIET
    NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                 "ten": 10}
    RACE_NOT_NAME = {"i", "we", "you", "who", "nobody", "it", "he", "she", "they", "that", "this", "what", "which",
                     "game", "there", "one", "someone", "everyone"}

    def is_hush(self, text):
        """True for '<name>, hold that thought' and the like (checked even while Gary is talking)."""
        if not self.sk.name_re.search(text):
            return False
        c = self.norm_cmd(text)
        return bool(re.search(self.HUSH, c) or re.search(r"\b(talk again|come back|unmute|you'?re back)\b", c))

    def muted(self):
        return self.mute_until > time.monotonic()

    def may_speak(self, kind, who=None):
        """Called by sidekick.py before every line. While muted only alerts (and the "going quiet" line) get through."""
        if not self.muted() or who == "quiet":
            return True
        return kind in ("alert", "event") and self.cfg["quiet"].get("alerts_while_muted", True)

    async def cut_off(self):
        """Stop the current line right now and forget anything queued."""
        self.hush_gen += 1
        last = next((l for l in reversed(self.sk.transcript) if l.startswith(self.sk.bot["name"] + ":")), None)
        if self.sk.busy and last:
            self.held = (time.monotonic(), last.split(":", 1)[1].strip())
        self.sk.jobs.clear()
        self.sk.want_chat, self.sk.want_interject = False, None
        self.arrivals.clear()
        await self.sk.send_overlays({"type": "stop"})
        self.sk.done.set()

    async def quiet_command(self, c):
        q = self.cfg["quiet"]
        if re.search(r"\b(you can (talk|speak)( again)?|talk again|come back|unmute|you'?re (back|unmuted)|"
                     r"welcome back|break'?s over)\b", c):
            if self.muted():
                self.unmute(say=True)
                return True
            return False
        if self.held and re.search(r"\b(go ahead|continue|carry on|what were you saying|finish (your|that|the) "
                                   r"(thought|sentence)|you were saying)\b", c):
            when, line = self.held
            self.held = None
            if time.monotonic() - when < 600 and not self.muted():
                self.say("As I was saying: " + line)
                return True
            return False
        if not re.search(self.HUSH, c) and not re.search(self.AWAY, c):
            return False
        away = re.search(self.AWAY, c)
        talk = away or re.search(self.QUIET, c)
        n = r"(\d+|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|half an?|a couple( of)?|a few)"
        m = re.search(rf"\bfor {n} ?(minutes?|mins?|seconds?|secs?|hours?|hrs?)\b", c) if talk else None
        words = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10, "fifteen": 15,
                 "twenty": 20, "thirty": 30, "a couple": 2, "a couple of": 2, "a few": 3}
        if m:
            amount = m[1]
            val = 0.5 if amount.startswith("half") else words.get(amount) or int(amount)
            unit = m[3]
            secs = val * (3600 if unit.startswith("h") else 1 if unit.startswith("s") else 60)
            secs = min(secs, q.get("max_minutes", 60) * 60)
        elif re.search(r"\btake (five|ten)\b", c):
            secs = 300 if "five" in c else 600
        elif talk and not re.search(r"\b(hold|hang on|wait|one sec)\b", c):
            secs = q.get("default_minutes", 0) * 60 or float("inf")
        else:
            # "hold that thought", "hang on", "wait": just stop this line
            await self.cut_off()
            log.info("Cut off by %s", self.streamer)
            return True
        await self.cut_off()
        self.mute_until = time.monotonic() + secs
        span = "until you call me back" if secs == float("inf") else (
            f"for {int(secs // 60)} minute{'s' if secs >= 120 else ''}" if secs >= 60 else f"for {int(secs)} seconds")
        log.info("Muted %s%s", span, " (sent away)" if away else "")
        if away:
            line = random.choice(["Fine, I'll go entertain myself", "Alright, I'll be over here", "Going on break"])
            await self.go_away()
        else:
            line = random.choice(["Zipping it", "Going quiet", "Fine, I'm muting myself", "Say no more"])
        self.sk.jobs.append(("say", "quiet", f"{line}, {span}."))
        await self.sk.push_status()
        return True

    async def go_away(self):
        """Sent away: stays on screen doing idle activities (props need wander/roam, so switch for the break)."""
        if self.away is None:
            self.away = {"mode": None, "set": None}
            if self.sk.avatar.get("mode") in ("stay", "walkon"):
                self.away.update(mode=self.sk.avatar["mode"], set="wander")
                await self.set_avatar({"mode": "wander"})
        self.away["next"] = time.monotonic() + 100
        name = random.choice(self.cfg["quiet"].get("away_activities") or ["phone"])
        await self.sk.send_overlays({"type": "avatar", "set": {"do": {"name": name, "at": int(time.time() * 1000)}}})
        log.info("Away activity: %s", name)

    async def set_avatar(self, change, remember=False):
        self.sk.avatar.update(change)
        await self.sk.send_overlays({"type": "avatar", "set": change})
        if remember:
            self.state["avatar"] = {**(self.state.get("avatar") or {}), **{k: self.sk.avatar[k] for k in ("mode", "home") if k in self.sk.avatar}}
            self.dirty = True

    def on_avatar_set(self, avatar):
        """The control page changed Gary's settings: keep them for the next start. One-shot "do" events are not kept."""
        if not isinstance(avatar, dict):
            return
        keep = copy.deepcopy({k: v for k, v in avatar.items() if k != "do"})
        self.state["avatar"] = {**(self.state.get("avatar") or {}), **keep}
        self.dirty = True

    def unmute(self, say=False):
        self.mute_until = 0.0
        if self.away is not None:
            prev, set_to, self.away = self.away.get("mode"), self.away.get("set"), None
            asyncio.create_task(self.sk.send_overlays({"type": "avatar", "set": {"do": {"name": "stop", "at": int(time.time() * 1000)}}}))
            if prev and self.sk.avatar.get("mode") == set_to:     # only if nothing moved him during the break
                asyncio.create_task(self.set_avatar({"mode": prev}))
        self.sk.jobs.clear()          # anything that piled up is old news now
        self.sk.want_chat, self.sk.want_interject = False, None
        log.info("Unmuted")
        asyncio.create_task(self.sk.push_status())
        if say and self.cfg["quiet"].get("say_back", True):
            self.say(random.choice(["I'm back. Did you miss me?", "And I'm back.", "Okay, I'm back."]))

    async def quiet_tick(self, now):
        if self.mute_until and now >= self.mute_until:
            self.unmute(say=True)           # time's up
        elif self.away and now >= self.away["next"] and not self.sk.busy:
            await self.go_away()            # next idle activity while he's on break

    async def command(self, c, raw=None):
        """c is the lowercase command; raw is the same text with its original case (for names and topics)."""
        raw = c if raw is None else raw
        start = r"\b(start|do|run|make|host|open|let'?s (do|have|play)|time for|new|another|quick)\b"
        if await self.move_command(c):
            return True
        if re.search(r"^(rip|f|o7)$|\b(press f|f in (the )?chat|rest in peace|we died|i died|i'?m dead|pay respects)\b", c):
            await self.avatar_do("rip", self.streamer)
            self.task(f"{self.streamer} just died or failed hard (\"{c}\"). Pay your respects in one short, dramatic, "
                      "funny line.")
            return True
        if re.search(r"\b(hype it up|get hype|celebrate|party time|hype mode)\b|\blet'?s go+$", c):
            await self.avatar_do("hype", self.streamer)
            self.task("Something big just happened and {0} wants hype. Go all out in one short line.".format(self.streamer))
            return True
        if re.search(r"\bclip (that|this|it)\b", c):
            await self.clip()
            return True
        if re.search(r"\bvoices?\b", c) and self.cfg["voice_effects"].get("enabled"):
            if await self.voice_command(c):
                return True
        elif self.cfg["effects"].get("enabled") and await self.fx_command(c):
            return True
        if re.search(r"\bpoll\b", c):
            if re.search(r"\b(end|close|stop|finish)\b", c) and self.poll:
                await self.end_poll()
                return True
            if re.search(start, c) or re.search(r"\bpoll( time|:)", c):
                rest = re.split(r"\bpoll\b[:,]?\s*", raw, maxsplit=1, flags=re.I)[-1]
                await self.start_poll_from_words(re.sub(r"^(about|on|for|asking)\s+", "", rest, flags=re.I).strip())
                return True
        if re.search(r"\btrivia\b", c) and (re.search(r"\b(start|run|host|do|begin|new|another)\b.{0,12}\btrivia\b|"
                                                  r"\btrivia (time|about|questions about)\b|\b(end|stop|cancel|enough)\b", c)):
            if re.search(r"\b(end|stop|cancel|enough)\b", c):
                self.trivia = None
                await self.broadcast()
                self.say("Trivia's over, put your pencils down.")
                return True
            nums = "|".join(self.NUM_WORDS) + r"|\d+"
            rounds = re.search(rf"\b({nums}) (?:rounds?|questions?)\b", c)
            n = (int(rounds[1]) if rounds[1].isdigit() else self.NUM_WORDS[rounds[1]]) if rounds else 0
            body = re.sub(rf",?\s*\b(?:for\s+)?(?:{nums}) (?:rounds?|questions?)\b", "", raw, flags=re.I)
            topic = re.search(r"\btrivia (?:about|on|questions about) (.+)", body, re.I)
            await self.start_trivia(topic[1].strip() if topic else "", n or None)
            return True
        if re.search(r"\bpredictions?\b", c):
            if re.search(r"\bcancel\b", c) and self.predict:
                self.predict = None
                await self.broadcast()
                self.say("Prediction cancelled. Nobody wins, nobody loses, everybody's sad.")
                return True
            if re.search(r"\block\b", c) and self.predict:
                await self.lock_predict()
                return True
            if re.search(start, c) or re.search(r"\bpredictions?( time|:)", c):
                rest = re.split(r"\bpredictions?\b[:,]?\s*", raw, maxsplit=1, flags=re.I)[-1]
                await self.start_predict_from_words(re.sub(r"^(about|on|for)\s+", "", rest, flags=re.I).strip())
                return True
        if self.predict and not self.predict.get("race") and self.predict.get("options") \
                and re.search(r"\b(won|wins|win|winner|answer|result|correct|it was|it's|it is)\b", c):
            opts = self.predict["options"]
            num = re.search(r"\b(?:option|number) (\d)\b", c)
            # the whole answer must be one option: "the answer is yes", "blue won", "option 2 won"
            said = re.search(r"\b(?:answer|winner|result) (?:is|was) (.+)$", c) or \
                re.search(r"^(?:it was |it's |it is )?(.+?) (?:won|wins|is correct|was right)$", c)
            said = re.sub(r"^the ", "", said[1]).strip() if said else ""
            hit = None
            if num and 1 <= int(num[1]) <= len(opts):
                hit = opts[int(num[1]) - 1]
            elif said:
                hit = next((o for o in opts if _norm(o) == _norm(said)), None)
            if hit is not None:
                await self.resolve_predict(hit)
                return True
        if not self.race and (re.search(r"\b(race|marbles?)\b.*\b(starting|begins|beginning|is on|go time|here we go)\b(?! soon)", c)
                              or re.search(r"\bstart(ing)? (the|a) (marble )?race\b(?! soon)", c)):
            await self.race_start()
            return True
        if self.race:
            m = re.search(r"\b(?:winner is|won by) @?([\w\-]+(?: [\w\-]+)?)", c) or \
                re.search(r"@?([\w\-]+) (?:won|wins)\b", c)
            if m and m[1].split()[0] not in self.RACE_NOT_NAME:
                name = raw[m.start(1):m.end(1)] if len(raw) == len(c) else m[1]
                await self.race_end(name)
                return True
            if re.search(r"\brace is (over|done|finished)\b", c):
                await self.race_end(None)
                return True
        if re.search(r"\b(recap|wrap (it|this|things|the stream) up|end of (the )?stream|sum (it )?up)\b", c):
            asyncio.create_task(self.recap())
            return True
        if re.search(r"\b(leaderboard|scoreboard|who'?s (winning|leading|in the lead)|most points)\b", c):
            self.announce_leaderboard()
            return True
        if re.search(r"\b(look at (this|that|the screen|my screen)|what do you see|you seeing this|"
                     r"check (this|that) out|watch this|see this on screen)\b", c):
            return await self.glance_now()
        return False

    async def api(self, kind, p):
        """/api/<kind>?... for Streamer.bot Fetch URL and the games control page. Returns a dict, or None."""
        g = lambda k, d="": str(p.get(k) or d).strip()
        if kind == "race":
            state = g("state", "start").lower()
            if state in ("start", "begin"):
                await self.race_start()
            else:
                await self.race_end(g("winner") or None, g("last") or None)
        elif kind == "poll":
            if g("end"):
                await self.end_poll()
            elif g("options"):
                await self.open_poll(g("question", "Chat decides"), self.split_options(g("options")),
                                     _int(g("seconds")) or None)
            else:
                await self.start_poll_from_words(g("question") or g("topic"))
        elif kind == "trivia":
            if g("stop"):
                self.trivia = None
                await self.broadcast()
            else:
                await self.start_trivia(g("topic"), _int(g("rounds")) or None)
        elif kind == "predict":
            if "resolve" in p:          # a blank resolve does nothing (never starts a new prediction)
                if g("resolve"):
                    await self.resolve_predict(g("resolve"))
            elif g("cancel"):
                self.predict = None
                await self.broadcast()
            elif g("lock"):
                await self.lock_predict()
            else:
                await self.start_predict_from_words(g("question"), self.split_options(g("options")) or None)
        elif kind in ("raid", "sub", "resub", "gift", "giftbomb", "cheer", "follow"):
            await self.stream_event(kind, g("user", "someone"), viewers=_int(g("viewers")),
                                    months=_int(g("months")), count=_int(g("count")),
                                    bits=_int(g("bits")), game=g("game"), tier=g("tier"),
                                    recipient=g("recipient"))
        elif kind == "clip":
            await self.clip()
        elif kind == "recap":
            asyncio.create_task(self.recap())
        elif kind == "glance":
            await self.glance_now()
        elif kind == "scene":
            await self.on_scene(g("name") or g("scene"))
        elif kind == "voice":     # buttons/docks: always a request, so phrase it as one
            await self.voice_command(f"please {g('effect', 'random').lower()} voice")
        elif kind == "do":          # test the overlay's event animations: /api/do?name=raid&who=Bob&n=50
            await self.avatar_do(g("name", "hype"), g("who", "TestUser"), n=_int(g("n")),
                                 months=_int(g("months")), title=g("title"))
        elif kind == "fx":
            if not await self.fx_command(f"please {g('effect').lower()}"):
                return {"ok": False, "reason": f"no effect matches '{g('effect')}'"}
        elif kind == "leaderboard":
            self.announce_leaderboard()
        elif kind == "features":
            return self.status()
        else:
            return None
        return {"ok": True}

    def status(self):
        left = self.mute_until - time.monotonic()
        return {"muted": None if left <= 0 else ("until called" if left == float("inf") else f"{int(left)}s left"),
                "poll": bool(self.poll), "trivia": bool(self.trivia), "predict": bool(self.predict),
                "race": bool(self.race), "role": self.role[0] if self.role else None,
                "obs": bool(self.obs and self.obs.connected), "scene": self.scene,
                "vision": self.cfg["vision"].get("enabled") and self.vision_ready(),
                "voice_effects": self.effect_actions()}

    def routes(self, app):
        page = os.path.join(BASE, "overlay", "games.html")
        app.router.add_get("/games", lambda r: web.FileResponse(page))
        app.router.add_get("/games/control", lambda r: web.FileResponse(page))
        app.router.add_get("/games/ws", self.games_ws_handler)

    # ------------------------------------------------------------ answers from chat

    def take_answer(self, user, text):
        low = text.lower().strip()
        tr = self.trivia
        if tr and tr.get("phase") == "asking":
            q = tr["q"]
            m = re.fullmatch(r"!?\s*(?:answer\s*)?([abcd])\s*[).!]*", low)
            idx = LETTERS.index(m[1].upper()) if m else next(
                (i for i, c in enumerate(q["choices"]) if _norm(c) == _norm(low)), None)
            if idx is not None:
                if user.lower() not in tr["answers"]:
                    tr["answers"][user.lower()] = (user, idx, time.monotonic())
                    asyncio.create_task(self.broadcast())
                return True
        if self.poll and not self.poll.get("closed"):
            opts = self.poll["options"]
            m = re.fullmatch(r"!?\s*(?:vote\s*)?(\d)\s*[!.]*", low)
            idx = int(m[1]) - 1 if m and 1 <= int(m[1]) <= len(opts) else next(
                (i for i, o in enumerate(opts) if _norm(o) == _norm(re.sub(r"^!?vote\s+", "", low))), None)
            if idx is not None:
                self.poll["votes"][user.lower()] = idx
                asyncio.create_task(self.broadcast())
                return True
        pr = self.predict
        if pr and not pr.get("locked"):
            m = re.match(r"!(?:pick|predict|bet)\s+@?(.+)", low)
            val = m[1].strip() if m else None
            opts = pr.get("options")
            if opts:
                if val is None:
                    n = re.fullmatch(r"!?\s*(\d)\s*", low)
                    val = n[1] if n else None
                if val is not None:
                    if val.isdigit() and 1 <= int(val) <= len(opts):
                        val = opts[int(val) - 1]
                    else:
                        val = next((o for o in opts if _norm(o) == _norm(val)), None)
            if val:
                pr["picks"][user.lower()] = (user, val)
                asyncio.create_task(self.broadcast())
                return True
        return False

    # ------------------------------------------------------------ regulars

    def note_arrival(self, user, text):
        rc = self.cfg["regulars"]
        key = user.lower()
        if not rc.get("enabled") or key in (self.streamer.lower(), self.sk.bot["name"].lower()):
            return
        g = self.state["greeted"]
        if g.get("date") != _today():
            g.update(date=_today(), names=[])
        if key in g["names"]:
            return
        g["names"].append(key)
        first = len(g["names"]) == 1
        v = self.state["visits"].get(key)
        p = self.sk.memory.data.get("people", {}).get(key)
        if not v:   # people Gary knew before this feature existed
            if p and p.get("first_seen", _today()) < _today():
                regular = p.get("messages", 0) >= 20
                v = {"days": rc["regular_after_days"] if regular else 1, "last": p.get("last_seen", "")}
            else:
                v = {"days": 0, "last": ""}
        days_before, last = v.get("days", 0), v.get("last", "")
        self.state["visits"][key] = {"name": user, "days": days_before + 1, "last": _today()}
        self.dirty = True
        away = (datetime.date.today() - datetime.date.fromisoformat(last)).days if last else 0
        if days_before == 0:
            kind = "new"
        elif away >= rc.get("welcome_back_days", 14):
            kind = "back"
        elif days_before + 1 >= rc.get("regular_after_days", 3):
            kind = "regular"
        else:
            kind = "returning"
        if self.sk.name_re.search(text) or text.lower().startswith("!ask"):
            return      # they're talking to Gary, so the reply covers the hello
        if kind == "new" and not rc.get("greet_new") and not first:
            return
        self.arrivals.append({"name": user, "kind": kind, "days": days_before + 1, "away": away,
                              "first": first and rc.get("first_chatter_shoutout"), "text": text[:120],
                              "at": time.monotonic()})

    def greet_tick(self, now):
        self.arrivals = [a for a in self.arrivals if now - a["at"] < 180]
        if not self.arrivals or self.sk.jobs or self.sk.busy:
            return
        if now - self.last_greet < self.cfg["regulars"].get("greet_gap_seconds", 40):
            return
        group, self.arrivals = self.arrivals[:3], self.arrivals[3:]
        lines = []
        for a in group:
            desc = {"new": "first time ever in chat",
                    "back": f"back after {a['away']} days away",
                    "regular": f"a regular, chatted on {a['days']} different days",
                    "returning": f"seen before ({a['days']} days)"}[a["kind"]]
            if a["first"]:
                desc += ", and the FIRST chatter of the day"
            facts = self.person_facts(a["name"])
            if facts:
                desc += "; you remember: " + "; ".join(facts)
            lines.append(f'- {a["name"]} ({desc}). They just said: "{a["text"]}"')
        self.task(
            "These people just said their first thing in chat today:\n" + "\n".join(lines) + "\n"
            "Say hi to them by name, all in one or two short sentences total. For a regular or someone you remember, "
            "make a quick specific callback to what you remember instead of a plain hello. First-timers get a quick "
            "warm welcome. Give the first chatter of the day a little shoutout for being first. If what they said "
            "deserves a reaction, react to it. Don't ask generic questions like how their day is going.",
            unprompted=True)
        self.last_greet = now

    # ------------------------------------------------------------ where the 3D Gary goes

    async def move_command(self, c):
        """"Gary, stay at the bottom" / "stay put on the left" / "free roam" / "wander around" / "walk on"."""
        av = self.sk.avatar
        home = dict(av.get("home") or {"x": 0.72, "z": 0})
        change = {}
        if re.search(r"\b(stay (put|still|stationary|in place)|stay (at|on|in) the (bottom|top|left|right|middle|centre|"
                     r"center|back|front)|hold still|don'?t move|"
                     r"stop (moving|walking|roaming|wandering)|park (it|yourself)|sit still|stand still|stationary)\b", c):
            change["mode"] = "stay"
        elif re.search(r"\b(free ?roam|roam( around)?|go (roam|explore)|walk around (the|wherever)|move around freely)\b", c):
            change["mode"] = "roam"
        elif re.search(r"\b(wander( around)?|pace around|walk around)\b", c):
            change["mode"] = "wander"
        elif re.search(r"\b(walk ?on mode|only show up when you talk|hide until you talk)\b", c):
            change["mode"] = "walkon"
        else:
            return False
        if change["mode"] in ("stay", "wander"):
            if re.search(r"\b(bottom|front|down (low|front|here)|close to the camera|up close)\b", c):
                home["z"] = 1
            elif re.search(r"\b(back|far|in the distance|background)\b", c):
                home["z"] = -1
            if re.search(r"\bleft\b", c):
                home["x"] = -0.72
            elif re.search(r"\bright\b", c):
                home["x"] = 0.72
            elif re.search(r"\b(middle|center|centre)\b", c):
                home["x"] = 0
            if home != av.get("home"):
                change["home"] = home
        av.update(change)
        self.state["avatar"] = {**(self.state.get("avatar") or {}), **{k: av[k] for k in ("mode", "home") if k in av}}
        self.dirty = True
        await self.sk.send_overlays({"type": "avatar", "set": change})
        await self.sk.push_status()
        log.info("Avatar: %s", change)
        self.say(random.choice({"stay": ["Staying put.", "Parking it right here.", "Not moving an inch."],
                                "roam": ["Free roam, here I go.", "Time to stretch my legs."],
                                "wander": ["I'll just pace around over here."],
                                "walkon": ["I'll stay hidden until I've got something to say."]}[change["mode"]]))
        return True

    # ------------------------------------------------------------ voice effects

    FX_ASK = (r"\b(make me|put me|give me|gimme|hit me|turn on|switch|activate|try|do (the|a|an|my|some)|set off|"
              r"let'?s (do|hear|try|get|see)|can (i|you|we)|could you|i want|voice me|please|trip me|send me|"
              r"me (a|an|the|some) \w+ voice|\w+ me$)\b")
    FX_SKIP = {"fx", "voice", "dum", "dums", "on", "the", "my", "me", "make", "of", "a", "an", "to", "in", "is", "are",
               "you", "about", "that", "this", "it", "and", "fake", "turn", "off", "watches", "stream", "sure", "jr"}

    def fx_words(self, name):
        """Words in a Streamer.bot FX action's name that call it up, e.g. "FX - DUM ON ACID" -> {"acid"}."""
        words = {w for w in re.findall(r"[a-z]+", name.lower()) if w not in self.FX_SKIP and len(w) >= 3}
        for word, aliases in self.cfg["effects"].get("aliases", {}).items():
            if word.lower() in name.lower():
                words |= {a.lower() for a in aliases}
        return words

    async def fx_command(self, c):
        """Any other Streamer.bot action in the Sidekick group whose name starts with FX: acid trip, drunk..."""
        prefix = self.cfg["effects"].get("prefix", "FX").lower()
        acts = [a for a in self.actions_with(prefix) if a.lower().startswith(prefix) and "voice" not in a.lower()]
        if not acts or not re.search(self.FX_ASK, c):
            return False
        hits = [a for a in acts if any(re.search(rf"\b{re.escape(w)}", c) for w in self.fx_words(a))]
        if not hits:
            return False
        name = hits[0]
        await self.run_action(name, self.streamer)
        self.log_event(f"effect {name} (asked)")
        pretty = re.sub(r"^\s*fx\s*[-:]\s*", "", name, flags=re.I).strip().lower()
        secs = next((v for k, v in self.cfg["effects"].get("seconds", {}).items() if k.lower() in name.lower()), 0)
        span = f" for about {secs} seconds" if secs else ""
        self.sk.remember("(stream event)", f"{self.sk.bot['name']} set off the \"{pretty}\" effect on stream{span}, "
                         f"because {self.streamer} asked.", "event")
        self.task(f'{self.streamer} asked for it and you just set off the "{pretty}" effect on stream{span}. Confirm '
                  "it out loud and name it, with a quick joke about what's happening to them. One or two short sentences.")
        return True

    def effect_actions(self):
        """Voice-effect actions: the keyword is in the name and the name says "voice" ("Robot Dance Clip" is not one)."""
        return [a for a in self.actions_with(*self.cfg["voice_effects"]["keywords"]) if "voice" in a.lower()]

    def effect_on(self, name, whose_idea):
        """Puts the effect in the conversation, so Gary knows it's on the streamer's voice (not his) and for how long."""
        pretty = re.sub(r"^\s*fx\s*[-:]\s*", "", name, flags=re.I).strip().lower()
        secs = self.cfg["voice_effects"].get("effect_seconds", 10)
        self.sk.remember("(stream event)", f"{self.sk.bot['name']} turned on the {pretty} effect on {self.streamer}'s "
                         f"mic ({whose_idea}); it lasts about {secs} seconds. {self.sk.bot['name']}'s own voice is "
                         "unchanged.", "event")
        return pretty, secs

    async def voice_command(self, c):
        acts = self.effect_actions()
        if re.search(r"\b(normal|off|reset|stop|remove|clear|regular)\b", c):
            off = [a for a in self.actions_with("voice") if re.search(r"normal|off|reset|clear", a, re.I)]
            if not off:
                return False
            await self.run_action(off[0])
            self.task(f"{self.streamer} asked to get their normal voice back and you just switched it off. "
                      "One short line.")
            return True
        # only a request turns one on; "you got me on this robot voice" is just talk about it
        if not re.search(self.FX_ASK, c):
            return False
        kw = next((k for k in self.cfg["voice_effects"]["keywords"] if k in c), None)
        if kw:
            pick = [a for a in acts if kw in a.lower()]
        elif re.search(r"\b(random|surprise|any|some|funny|weird)\b", c):
            pick = acts
        else:
            return False
        if not pick:
            self.warn_once("fx", "No voice-effect actions in the Streamer.bot 'Sidekick' group yet. Move your ROBOT/HELIUM/"
                           "DEEP/ECHO/ALIEN VOICE actions there.")
            self.say(f"I'd love to, but nobody's given me the voice buttons yet. {self.streamer}, put them in my "
                     "Sidekick group.")
            return True
        name = random.choice(pick)
        await self.run_action(name, self.streamer)
        self.last_effect = time.monotonic()
        self.log_event(f"voice effect {name} (asked)")
        pretty, secs = self.effect_on(name, f"{self.streamer} asked for it")
        self.task(f"{self.streamer} asked for the {pretty} and you just switched it on for their mic, for about {secs} "
                  f"seconds. Confirm it out loud and name the effect (like \"{pretty} is on, {self.streamer}, you've got "
                  f"{secs} seconds\"), plus a quick joke about how they sound. One or two short sentences.")
        return True

    async def effect_tick(self, now):
        fx = self.cfg["voice_effects"]
        if not (fx.get("enabled") and fx.get("on_his_own")) or self.sk.paused or self.sk.busy or self.sk.jobs:
            return
        if self.muted() or self.away:     # he can't announce a prank while muted or away
            return
        if now - self.last_effect < fx.get("own_min_minutes", 20) * 60 or now - self.last_streamer > 60:
            return     # only when dum is actually talking, so there's someone to hear it on
        if self.trivia or self.poll or self.role or random.random() >= fx.get("own_chance", 0.04):
            return
        acts = self.effect_actions()
        if not acts:
            return
        name = random.choice(acts)
        self.last_effect = now
        if await self.run_action(name, self.streamer):
            self.log_event(f"voice effect {name} (Gary's idea)")
            pretty, secs = self.effect_on(name, "Gary's idea, as a prank")
            self.task(f"You just switched on the {pretty} for {self.streamer}'s mic as a prank, for about {secs} "
                      "seconds. Own it out loud: say you did it and name the effect, with a cheeky reason tied to what "
                      "they were just saying. One short sentence.", unprompted=True)

    # ------------------------------------------------------------ polls

    @staticmethod
    def split_options(s):
        parts = [x.strip(" ?.!") for x in re.split(r"\||,|\bor\b", s or "", flags=re.I) if x.strip(" ?.!")]
        return parts[:6] if len(parts) >= 2 else []

    async def start_poll_from_words(self, words):
        if self.poll and not self.poll.get("closed"):
            self.say("There's already a poll going. Vote first, then we'll talk.")
            return
        opts = self.split_options(words)
        if opts:
            question = words if words.endswith("?") else (words[0].upper() + words[1:] + "?")
            return await self.open_poll(question, opts)
        asyncio.create_task(self._generate_poll(words))

    async def _generate_poll(self, topic):
        await self.sk.send_overlays({"type": "thinking"})
        try:
            obj = await self.llm_json(
                "You write fun, quick chat polls for a livestream co-host.",
                f"Recent stream conversation:\n{self.recent_lines()}\n\nTopic: {topic or 'whatever is happening right now'}"
                "\nWrite one short poll question and 2 to 4 short options (max 5 words each) that fit the moment.",
                {"type": "object", "properties": {"question": {"type": "string"},
                 "options": {"type": "array", "items": {"type": "string"}}},
                 "required": ["question", "options"], "additionalProperties": False})
            opts = [str(o).strip() for o in obj.get("options", []) if str(o).strip()][:4]
            if len(opts) < 2:
                raise ValueError("not enough options")
            await self.open_poll(str(obj.get("question") or "Chat decides").strip(), opts)
        except Exception as e:
            log.error("Couldn't make a poll: %s", e)
            self.say("My poll machine jammed. Try telling me the options.")

    async def open_poll(self, question, options, seconds=None):
        seconds = seconds or self.cfg["polls"]["seconds"]
        self.poll = {"question": question, "options": options, "votes": {}, "seconds": seconds,
                     "ends": time.monotonic() + seconds + 6}
        listing = ", ".join(f"{i}) {o}" for i, o in enumerate(options, 1))
        self.task(f'You are starting a chat poll: "{question}" Options: {listing}. Announce it with energy and read '
                  "out each option with its number. Chat votes by typing the number. Two sentences max.")
        await self.chat(f"POLL: {question} Type the number to vote: {listing} ({seconds}s)")
        self.log_event(f"poll opened: {question}")
        log.info("Poll: %s %s", question, options)
        await self.broadcast()

    async def end_poll(self):
        p = self.poll
        if not p or p.get("closed"):
            return
        p["closed"], p["closed_at"] = True, time.monotonic()
        counts = [0] * len(p["options"])
        for idx in p["votes"].values():
            counts[idx] += 1
        total = sum(counts)
        ranked = sorted(range(len(counts)), key=lambda i: -counts[i])
        res = ", ".join(f"{p['options'][i]}: {counts[i]}" for i in ranked)
        p["counts"] = counts
        if total == 0:
            self.task(f'Your chat poll "{p["question"]}" just closed and NOBODY voted. Roast chat for it, lightly, '
                      "in one sentence.")
        else:
            tie = len(ranked) > 1 and counts[ranked[0]] == counts[ranked[1]]
            self.task(f'Your chat poll "{p["question"]}" just closed. Results: {res} ({total} voters). '
                      f'{"It is a TIE at the top. " if tie else ""}Announce the result in character and react to it, '
                      "two sentences max.")
            await self.chat(f"POLL RESULTS: {p['question']} {res}")
        self.log_event(f"poll '{p['question']}' result: {res or 'no votes'}")
        await self.broadcast()

    # ------------------------------------------------------------ trivia

    async def start_trivia(self, topic="", rounds=None):
        if self.trivia:
            self.say("We're already doing trivia, keep up!")
            return
        rounds = max(1, min(10, rounds or self.cfg["polls"]["trivia_rounds"]))
        self.trivia = {"topic": topic, "rounds": rounds, "n": 0, "questions": [], "phase": "loading",
                       "scores": {}, "next_at": 0}
        about = f" about {topic}" if topic else ""
        self.task(f"You're kicking off trivia{about}: {rounds} multiple choice questions, chat answers with A, B, C "
                  "or D, and points go on the leaderboard. Hype it in one or two sentences. Don't ask a question yet.")
        await self.chat(f"TRIVIA{about.upper()}: {rounds} questions coming up. Answer with A, B, C or D in chat!")
        await self.broadcast()
        asyncio.create_task(self._generate_trivia(topic, rounds))

    async def _generate_trivia(self, topic, rounds):
        tr = self.trivia
        try:
            asked = self.state["trivia_asked"][-60:]
            obj = await self.llm_json(
                "You write multiple choice trivia for a livestream. Every question must be factually correct, with "
                "exactly one correct choice and three plausible wrong ones. Keep questions short and fun, easy to "
                "medium difficulty, and readable out loud.",
                f"Topic: {topic or 'a mix of video games, movies, internet culture, food and weird facts'}\n"
                f"Write {rounds} questions. Give 4 choices each and the letter (A-D) of the correct one.\n"
                "Do not repeat any of these: " + ("; ".join(asked) or "(none)"),
                {"type": "object", "properties": {"questions": {"type": "array", "items": {
                    "type": "object", "properties": {
                        "question": {"type": "string"},
                        "choices": {"type": "array", "items": {"type": "string"}},
                        "answer": {"type": "string", "enum": list(LETTERS)}},
                    "required": ["question", "choices", "answer"], "additionalProperties": False}}},
                 "required": ["questions"], "additionalProperties": False},
                temperature=0.9, max_tokens=250 * rounds + 200)
            qs = []
            for q in obj.get("questions", []):
                ch = [str(c).strip() for c in q.get("choices", [])][:4]
                if len(ch) == 4 and str(q.get("answer", "")).upper()[:1] in LETTERS and q.get("question"):
                    qs.append({"question": str(q["question"]).strip(), "choices": ch,
                               "answer": LETTERS.index(str(q["answer"]).upper()[:1])})
            if not qs:
                raise ValueError("no usable questions")
        except Exception as e:
            log.error("Couldn't make trivia: %s", e)
            if self.trivia is tr:
                self.trivia = None
                self.say("My trivia cards fell behind the couch. We'll try again in a bit.")
                await self.broadcast()
            return
        if self.trivia is tr:
            tr["questions"], tr["rounds"], tr["phase"] = qs, len(qs), "ready"
            tr["next_at"] = time.monotonic() + 3
            self.state["trivia_asked"] = (self.state["trivia_asked"] + [q["question"] for q in qs])[-200:]
            self.dirty = True

    async def trivia_tick(self, now):
        tr = self.trivia
        if not tr:
            return
        if tr["phase"] == "ready" and now >= tr["next_at"] and not self.sk.busy and not self.sk.jobs:
            q = tr["questions"][tr["n"]]
            tr.update(phase="asking", q=q, answers={}, asked_at=now)
            spoken = " ".join(f"{LETTERS[i]}, {c}." for i, c in enumerate(q["choices"]))
            text = f"Question {tr['n'] + 1}. {q['question']} {spoken}"
            tr["ends"] = now + self.cfg["polls"]["trivia_seconds"] + len(text) / 14 + 3
            self.say(text)
            await self.chat(f"Q{tr['n'] + 1}: {q['question']} " +
                            " ".join(f"{LETTERS[i]}) {c}" for i, c in enumerate(q["choices"])))
            await self.broadcast()
        elif tr["phase"] == "asking" and now >= tr["ends"]:
            q = tr["q"]
            right = sorted((t, u) for u, i, t in tr["answers"].values() if i == q["answer"])
            for k, (_, u) in enumerate(right):
                pts = 2 if k == 0 else 1
                tr["scores"][u] = tr["scores"].get(u, 0) + pts
                self.add_points(u, pts)
            correct = f"{LETTERS[q['answer']]}, {q['choices'][q['answer']]}"
            names = ", ".join(u for _, u in right)
            who = (f"{len(right)} got it right: {names}. Fastest was {right[0][1]} (double points)." if right
                   else f"Nobody got it right ({len(tr['answers'])} tried).")
            tr.update(phase="reveal", reveal_at=now, next_at=now + 14)
            self.task(f'Trivia reveal. The question was "{q["question"]}" and the right answer is {correct}. {who} '
                      "Reveal the answer and react, one or two sentences.")
            await self.chat(f"Answer: {correct}. " + (f"Correct: {names}" if right else "Nobody got it!"))
            tr["n"] += 1
            await self.broadcast()
        elif tr["phase"] == "reveal" and now >= tr["next_at"] and not self.sk.busy and not self.sk.jobs:
            if tr["n"] < tr["rounds"]:
                tr["phase"] = "ready"
                return
            board = sorted(tr["scores"].items(), key=lambda kv: -kv[1])
            if board:
                res = ", ".join(f"{u} {s}" for u, s in board[:5])
                self.task(f"Trivia is over. Scores this round: {res}. Crown the winner, {board[0][0]}, in one or two "
                          "sentences.")
                await self.chat(f"TRIVIA DONE! {res}")
                self.log_event(f"trivia{' about ' + tr['topic'] if tr['topic'] else ''} won by {board[0][0]} ({res})")
            else:
                self.task("Trivia is over and nobody in chat scored a single point. Roast chat lightly in one sentence.")
            tr["phase"], tr["done_at"] = "done", now
            await self.broadcast()
        elif tr["phase"] == "done" and now - tr["done_at"] > 25:
            self.trivia = None
            await self.broadcast()

    # ------------------------------------------------------------ predictions

    async def start_predict_from_words(self, words, options=None):
        if self.predict:
            self.say("There's already a prediction running. Settle that one first.")
            return
        opts = options or self.split_options(words) or ["Yes", "No"]
        question = (words or "What happens next").strip()
        question = question[0].upper() + question[1:]
        if not question.endswith("?"):
            question += "?"
        await self.open_predict(question, opts)

    async def open_predict(self, question, options, seconds=None, race=False):
        seconds = seconds or self.cfg["polls"]["predict_seconds"]
        self.predict = {"question": question, "options": options, "picks": {}, "locked": False,
                        "locks_at": time.monotonic() + seconds, "race": race, "seconds": seconds}
        if options:
            listing = ", ".join(f"{i}) {o}" for i, o in enumerate(options, 1))
            if not race:
                self.task(f'You are opening predictions: "{question}" Options: {listing}. Chat locks in by typing the '
                          f"number. Picks lock in {seconds} seconds and right calls earn points. Two sentences max.")
            await self.chat(f"PREDICTION: {question} Type the number: {listing} (locks in {seconds}s)")
        else:
            await self.chat(f"PREDICTION: {question} Type !pick <name> (locks in {seconds}s)")
        self.log_event(f"prediction opened: {question}")
        await self.broadcast()

    async def lock_predict(self):
        pr = self.predict
        if pr and not pr["locked"]:
            pr["locked"] = True
            await self.chat(f"Predictions locked! {len(pr['picks'])} picks are in.")
            await self.broadcast()

    async def resolve_predict(self, outcome, quiet=False):
        pr = self.predict
        if not pr:
            return []
        self.predict = None
        o = _norm(outcome)
        if pr["options"]:
            hit = next((x for x in pr["options"] if _norm(x) == o), None)
            if hit is None and o.isdigit() and 1 <= int(o) <= len(pr["options"]):
                hit = pr["options"][int(o) - 1]
            o = _norm(hit or outcome)
        winners = [u for u, v in pr["picks"].values()
                   if _norm(v) == o or (len(_norm(v)) >= 3 and len(o) >= 3 and (o.startswith(_norm(v)) or _norm(v).startswith(o)))]
        for u in winners:
            self.add_points(u, 2 if pr["race"] else 1)
        self.log_event(f"prediction '{pr['question']}' -> {outcome}; right: {', '.join(winners) or 'nobody'}")
        await self.chat(f"PREDICTION RESULT: {outcome}. Called it: {', '.join(winners) or 'nobody'}")
        if not quiet:
            self.task(f'The prediction "{pr["question"]}" is settled: the answer was {outcome}. '
                      f'{len(pr["picks"])} people picked; ' +
                      (f"these called it right and get points: {', '.join(winners)}. " if winners else "nobody called it. ") +
                      "Announce it in one or two sentences.")
        await self.broadcast()
        return winners

    # ------------------------------------------------------------ marble races

    async def race_start(self):
        if self.race:
            return      # one race at a time
        rc = self.cfg["race"]
        self.race = {"started": time.monotonic(), "glanced": False}
        st = self.state["race"]
        st["count"] += 1
        self.dirty = True
        champ = st.get("champ")
        top = sorted(st["wins"].items(), key=lambda kv: -kv[1])[:3]
        facts = []
        if champ:
            facts.append(f"defending champ is {champ} (won the last race)")
        if top:
            names = st.get("wins_names", {})
            facts.append("all-time wins: " + ", ".join(f"{names.get(k, k)} {n}" for k, n in top))
        if rc.get("predictions") and not self.predict:
            await self.open_predict("Who wins this marble race?", None, rc.get("pick_seconds", 45), race=True)
        self.task(f"A marble race is starting on stream (race number {st['count']}). Hype the start like a "
                  f"sports commentator in one or two sentences. {'; '.join(facts) + '. ' if facts else ''}" +
                  ("Tell chat they can type !pick and a name to call the winner. " if self.predict else ""))
        self.log_event("marble race started")
        await self.broadcast()

    async def race_tick(self, now):
        r = self.race
        if not r:
            return
        if not r["glanced"] and not self.glancing and now - r["started"] >= self.cfg["race"].get("glance_after_seconds", 25):
            r["glanced"] = True
            self.glance_in_background(lambda: self.race_glance(r))
        if now - r["started"] > 900:      # nobody ever said who won
            self.race = None
            if self.predict and self.predict.get("race"):
                self.predict = None
            await self.broadcast()

    async def race_end(self, winner=None, last=None):
        if not self.race:
            return      # no race running, so nothing to end
        self.race = None
        st = self.state["race"]
        lines = []
        if winner:
            winner = self.proper_name(winner)
            key = winner.lower()
            st["wins"][key] = st["wins"].get(key, 0) + 1
            st.setdefault("wins_names", {})[key] = winner
            again = st.get("champ", "").lower() == key
            st["champ"] = winner
            n = st["wins"][key]
            lines.append(f"Winner: {winner}" + (f" (win number {n} all time)" if n > 1 else " (their first win ever)") +
                         (", back to back!" if again else "."))
            facts = self.person_facts(winner, 2)
            if facts:
                lines.append(f"You remember about {winner}: " + "; ".join(facts))
        if last:
            last = self.proper_name(last)
            key = last.lower()
            st["last"][key] = st["last"].get(key, 0) + 1
            n = st["last"][key]
            lines.append(f"Dead last: {last}" + (f" (last place for the {n}th time)" if n > 1 else "") + ". Roast them gently.")
        self.dirty = True
        called = []
        if self.predict and self.predict.get("race"):
            called = await self.resolve_predict(winner, quiet=True) if winner else []
            if not winner:
                self.predict = None
        if called:
            lines.append(f"Chatters who predicted it right: {', '.join(called)}.")
        if winner or last:
            self.task("The marble race just ended. " + " ".join(lines) +
                      " Call it like a sports commentator in two sentences.")
        else:
            self.task("The marble race just ended. React to the finish in one sentence.")
        self.log_event(f"marble race over. winner: {winner or '?'}" + (f", last: {last}" if last else ""))
        await self.chat(f"RACE OVER! Winner: {winner}" if winner else "RACE OVER!")
        await self.broadcast(race_result={"winner": winner, "last": last, "called": called})

    # ------------------------------------------------------------ raids, subs, gifts, cheers, follows

    async def on_sb_event(self, source, etype, data):
        log.info("[sb] %s %s from %s", source, etype, event_user(data) or "?")
        if source == "Obs" and etype == "SceneChanged":
            name = (data.get("scene") or {}).get("sceneName") if isinstance(data.get("scene"), dict) else None
            name = name or data.get("sceneName") or data.get("scene")
            if isinstance(name, str) and not (self.obs and self.obs.connected):
                await self.on_scene(name)
            return
        if source != "Twitch":
            return
        if not self.cfg["events"].get("enabled"):
            self.warn_once("alerts_off", "Alerts are off ([events] enabled = false in features.toml), so raids, subs, "
                           "cheers and follows are ignored")
            return
        user = event_user(data) or "someone"
        if etype == "RewardRedemption":
            reward = data.get("reward") if isinstance(data.get("reward"), dict) else {}
            title = _first(reward, ("title", "name")) or _first(data, ("rewardName", "reward_title", "title")) or "a redeem"
            await self.avatar_do("redeem", user, title=title)
            now = time.monotonic()
            said_key = f"redeem_said_{user.lower()}"
            if self.cfg["events"].get("redeems", True) and now - self.recent.get(said_key, -999) > 30:
                self.recent[said_key] = now
                self.alert_task(f'{user} just redeemed "{title}" with channel points. React to it by name in one sentence.')
            return
        kind = {"Raid": "raid", "Sub": "sub", "ReSub": "resub", "GiftSub": "gift", "GiftBomb": "giftbomb",
                "Cheer": "cheer", "Follow": "follow"}.get(etype)
        if not kind:
            return
        raw_tier = next((data.get(k) for k in ("subTier", "sub_tier", "tier") if data.get(k) not in (None, "")), None) \
            if etype in ("Sub", "ReSub", "GiftSub", "GiftBomb") else None
        recipient = event_user(data.get("recipient")) if isinstance(data.get("recipient"), dict) else \
            _first(data, ("recipientDisplayName", "recipientUserName", "recipient_user_name"))
        await self.stream_event(
            kind, user,
            viewers=event_num(data, ("viewers", "viewerCount", "viewer_count")),
            months=event_num(data, ("cumulativeMonths", "cumulative_months", "duration_months", "months",
                                    "cumulative_total")),
            count=event_num(data, ("gifts", "total", "count", "giftCount")),
            bits=event_num(data, ("bits", "amount")),
            tier="" if raw_tier is None else str(raw_tier),
            prime=bool(data.get("is_prime") or data.get("isPrime")),
            anonymous=bool(data.get("anonymous") or data.get("isAnonymous")),
            recipient=recipient or "")

    async def stream_event(self, kind, user, viewers=0, months=0, count=0, bits=0, game="", tier="", prime=False,
                           anonymous=False, recipient=""):
        now = time.monotonic()
        amount = bits or count or months or viewers     # two cheers of different sizes are both real
        key = (kind, user.lower(), recipient.lower(), amount)
        if now - self.recent.get(key, -999) < 5:
            return      # the same event arrived twice (Streamer.bot and a Fetch URL)
        self.recent[key] = now
        if kind == "gift" and now - self.gift_bombs.get(user.lower(), -999) < 5:
            return      # the gift bomb's own gifts, which were just thanked as one
        if anonymous:
            user = "an anonymous gifter"
        facts = self.person_facts(user, 3)
        known = (" You remember about them: " + "; ".join(facts) + ".") if facts else ""
        visits = self.state["visits"].get(user.lower(), {})
        if visits.get("days", 0) >= 2:
            known += f" They've chatted on {visits['days']} different days."
        tier, sub_prime = sub_tier(tier)
        prime = prime or sub_prime
        tier_txt = " Prime" if prime else {"2000": " tier 2", "3000": " tier 3"}.get(tier, "")
        if kind == "raid":
            n = self.state["raids"].get(user.lower(), 0) + 1
            self.state["raids"][user.lower()] = n
            self.dirty = True
            size = "a huge" if viewers >= 50 else "a solid" if viewers >= 10 else "a cozy little"
            self.alert_task(
                f"{user} just raided the stream with {viewers or 'some'} viewers ({size} raid"
                f"{', their raid number ' + str(n) + ' on this channel' if n > 1 else ', the first time they ever raided'}). "
                + (f"They were just streaming {game}. " if game else "") + known +
                " Thank them by name and welcome the raiders as a group. Be specific, not a generic thanks: mention "
                "what they were streaming or what you remember about them, and tell the raiders what's going on "
                "here right now. Two sentences, energy matched to the raid size.")
            so = self.actions_with(self.cfg["events"].get("shoutout_keyword") or "shout")
            if so:
                asyncio.create_task(self.run_action(so[0], user))
            self.log_event(f"raid from {user} ({viewers} viewers)")
            await self.avatar_do("raid", user, n=viewers)
        elif kind == "giftbomb":
            self.gift_bombs[user.lower()] = now
            self.alert_task(f"{user} just gifted {count or 'a bunch of'}{tier_txt} subs to chat!{known} Lose your mind about it "
                      "for one or two sentences and thank them by name.")
            self.log_event(f"{user} gifted {count} subs")
            await self.avatar_do("sub", user, n=count)
        elif kind == "gift":
            self.alert_task(f"{user} just gifted a{tier_txt} sub to {recipient or 'someone in chat'}.{known} Thank the gifter and "
                      "welcome the recipient, one sentence.")
            self.log_event(f"{user} gifted a sub to {recipient}")
            await self.avatar_do("sub", user, n=1)
        elif kind in ("sub", "resub"):
            span = f"for {months} months" if months > 1 else "for the first time"
            self.alert_task(f"{user} just subscribed{tier_txt} {span}.{known} Say something about it, using their name, in one or two sentences; if "
                      "you remember something about them, work it in. Milestones (6, 12, 24 months) deserve extra hype.")
            self.log_event(f"{user} subscribed{tier_txt} ({months or 1} months)")
            await self.avatar_do("sub", user, months=months or 1)
        elif kind == "cheer":
            self.alert_task(f"{user} just cheered {bits} bits.{known} React by name in one sentence, bigger hype for "
                      "bigger amounts.")
            self.log_event(f"{user} cheered {bits} bits")
            await self.avatar_do("bits", user, n=bits)
        elif kind == "follow":
            if self.cfg["events"].get("follows"):
                self.follows.append(user)
            self.log_event(f"{user} followed")
        await self.broadcast()

    def follow_tick(self, now):
        if self.follows and not self.sk.busy and now - self.recent.get("follow_said", -999) > 20:
            names, self.follows = self.follows[:5], self.follows[5:]
            self.recent["follow_said"] = now
            self.alert_task(f"New follower{'s' if len(names) > 1 else ''}: {', '.join(names)}. Riff on it by name in one "
                      "quick sentence.")
            asyncio.create_task(self.avatar_do("follow", ", ".join(names), n=len(names)))

    # ------------------------------------------------------------ clips and recaps

    async def clip(self):
        kw = self.cfg["clips"].get("keyword", "clip")
        acts = [a for a in self.actions_with(kw) if re.search(rf"\b{re.escape(kw)}\b", a, re.I)]
        ok = await self.run_action(acts[0], self.streamer) if acts else False
        moment = " / ".join(list(self.sk.transcript)[-4:])
        self.log_event(f"CLIP: {moment[:300]}")
        if not acts:
            self.warn_once("clip", "No action with 'clip' in its name in the Streamer.bot 'Sidekick' group, so Gary "
                           "can't make the clip. He still saves the moment for the recap.")
        self.task(f"{self.streamer} just said to clip that. " +
                  ("You hit the clip button. " if ok else "You don't have a clip button yet, but you've saved the "
                   "moment for the recap. ") +
                  "React in one short line to what just happened (the last few lines of the conversation).")

    async def recap(self):
        await self.sk.send_overlays({"type": "thinking"})
        chatters, lines = {}, []
        for day in (_yesterday(), _today()):          # the last two days
            try:
                with open(os.path.join(self.sk.memory.log_dir, day + ".jsonl"), encoding="utf-8") as f:
                    for row in f:
                        try:
                            e = json.loads(row)
                        except json.JSONDecodeError:
                            continue
                        if e.get("kind") == "chat":
                            chatters[e["who"]] = chatters.get(e["who"], 0) + 1
                        lines.append(f"{e.get('who')}: {e.get('text')}")
            except OSError:
                pass
        top = sorted(chatters.items(), key=lambda kv: -kv[1])[:5]
        today = next((s for s in self.sk.memory.data.get("streams", []) if s.get("date") == _today()), None)
        events = [e for d in (self.state.get("yesterday"), self.state["today"])
                  if d and d.get("date") in (_yesterday(), _today()) for e in d.get("events", [])]
        facts = []
        if today:
            facts.append("Notes on today's stream: " + today["summary"])
        if events:
            facts.append("What happened in the last two days: " + "; ".join(e.split(" ", 1)[1] for e in events[-30:]))
        if top:
            facts.append("Most active chatters: " + ", ".join(f"{u} ({n} messages)" for u, n in top))
        board = self.leaderboard(3)
        if board:
            facts.append("Points leaderboard: " + ", ".join(f"{u} {p}" for u, p in board))
        task = ("The stream is wrapping up. Give the end-of-stream recap out loud like a TV host closing the show: "
                "4 to 6 sentences hitting the real highlights, funniest moments and wins, shouting out the top "
                "chatters by name, and a goodbye. Only mention things from the notes below or the conversation.\n" +
                "\n".join(facts))
        try:
            text = await self.sk.brain.say(lines[-40:], task, self.extra_context())
        except Exception as e:
            log.error("Recap failed: %s", e)
            await self.sk.send_overlays({"type": "idle"})
            return
        if text:
            os.makedirs(os.path.join(BASE, "recaps"), exist_ok=True)
            with open(os.path.join(BASE, "recaps", _today() + ".txt"), "a", encoding="utf-8") as f:
                f.write(f"--- {datetime.datetime.now():%H:%M}\n{text}\n\n" + "\n".join(facts) + "\n\n")
            self.sk.jobs.appendleft(("say", None, text))
            log.info("Recap saved to recaps/%s.txt", _today())

    def announce_leaderboard(self):
        board = self.leaderboard(5)
        if board:
            self.task("Read out the points leaderboard (from trivia and predictions): " +
                      ", ".join(f"{u} {p} points" for u, p in board) + ". One or two sentences, hype the leader.")
        else:
            self.say("The leaderboard is empty. Nobody has a single point. Embarrassing for everyone.")
        asyncio.create_task(self.broadcast(show_board=True))

    # ------------------------------------------------------------ green screen roles

    async def on_scene(self, name):
        if not name or name == self.scene:
            return
        self.scene = name
        low = name.lower()
        log.info("Scene: %s", name)
        mode = next((m for m, pat in self.cfg["scene_modes"].items() if re.search(pat, low)), "normal")
        acts = dict(self.sk.avatar.get("acts") or {})
        if acts.get("scene") != mode:
            acts.update(scene=mode, sceneAt=int(time.time() * 1000))
            self.sk.avatar["acts"] = acts    # full dict: the overlay's avatar.update is shallow
            await self.sk.send_overlays({"type": "avatar", "set": {"acts": acts}})
            await self.sk.push_status()
            log.info("Gary's stream mode: %s", mode)
        role = next(((k, v) for k, v in self.cfg.get("roles", {}).items()
                     if re.search(rf"\b{re.escape(k.lower())}\b", low)), None)
        if role and (not self.role or self.role[0] != role[0]):
            self.role = role
            self.log_event(f"Gary did the {role[0]} segment")
            self.task(f"The stream just cut to your segment. {role[1]} Open it in character with one or two "
                      "sentences, riffing on what's been happening on stream.", unprompted=True)
        elif not role:
            self.role = None
        start_on = self.cfg["race"].get("start_on_scene")
        if start_on and start_on.lower() in low and not self.race:
            await self.race_start()

    # ------------------------------------------------------------ vision

    def vision_ready(self):
        """Vision is switched off only by a "can't see images" error from LM Studio, and tried again after 10 minutes."""
        if not self.vision_ok and time.monotonic() - self.vision_off_at > 600:
            self.vision_ok = True
        return self.vision_ok

    async def look(self, prompt):
        """Screenshot of the stream -> one-line description from the vision model. None if unavailable."""
        vc = self.cfg["vision"]
        if not vc.get("enabled") or not self.vision_ready() or not (self.obs and self.obs.connected):
            return None
        brain = self.sk.brain
        for width in (960, 640):        # a payload-size error gets one retry at a smaller width
            try:
                img = await self.obs.screenshot(width)
            except Exception as e:
                self.warn_once("shot", "Couldn't grab a screenshot from OBS: %s", e)
                return None
            body = {"model": vc.get("model") or brain.model or "local-model", "temperature": 0.4, "max_tokens": 120,
                    "stream": False, "messages": [{"role": "user", "content": [
                        {"type": "text", "text": prompt + " No preamble."},
                        {"type": "image_url", "image_url": {"url": img}}]}]}
            if brain.llm.get("no_think", True):
                body["reasoning_effort"] = "none"
            try:
                async with brain.session.post(brain.llm["base_url"] + "/chat/completions", json=body,
                                              timeout=aiohttp.ClientTimeout(total=45)) as r:
                    if r.status >= 400:
                        err = await r.text()
                        if re.search(r"does not support|not a vision|mmproj|multimodal", err, re.I):
                            self.vision_ok, self.vision_off_at = False, time.monotonic()
                            log.warning("The model in LM Studio can't see images, so screen glances are off for 10 "
                                        "minutes. Load a vision model (or set [vision] model in features.toml). (%s)",
                                        err[:150])
                            return None
                        if r.status in (400, 413) and width == 960:
                            log.info("LM Studio rejected the screenshot (%s), trying a smaller one", err[:120])
                            continue
                        raise RuntimeError(f"LM Studio {r.status}: {err[:150]}")
                    data = await r.json()
                text = re.sub(r"<think>.*?(</think>|$)", "", data["choices"][0]["message"].get("content") or "",
                              flags=re.S)
                return re.sub(r"\s+", " ", text).strip() or None
            except Exception as e:
                log.warning("Screen glance failed: %s", e)
                return None
        return None

    async def glance_now(self):
        """"Look at this": he glances and reacts, or says he can't see the screen right now."""
        if not (self.cfg["vision"].get("enabled") and self.vision_ready() and self.obs and self.obs.connected):
            self.task(f"{self.streamer} asked you to look at the screen, but you can't see the screen right now. "
                      "Say so briefly, in one short line, in character.")
            return True
        await self.sk.send_overlays({"type": "thinking"})
        desc = await self.look("You're a co-host glancing at the livestream. In one or two sentences, say what's "
                               "on screen right now: the game or scene and what's happening.")
        if not desc:
            await self.sk.send_overlays({"type": "idle"})
            self.task(f"{self.streamer} asked you to look at the screen, but you couldn't see it this time. Say so "
                      "briefly, in one short line, in character.")
            return True
        self.sk.remember("(stream event)", f"On screen: {desc}", "event")
        self.task(f"{self.streamer} told you to look at the screen. You see: {desc}. React to it like a co-host "
                  "watching along, one or two sentences. Don't describe it like a robot; react.")
        return True

    def glance_in_background(self, job):
        """A glance waits on LM Studio for seconds, so it runs as its own task. One at a time; the loop never waits."""
        if self.glancing:
            return False
        self.glancing = True

        async def run_job():
            try:
                await job()
            except Exception as e:
                log.warning("Screen glance failed: %s", e)
            finally:
                self.glancing = False
        asyncio.create_task(run_job())
        return True

    async def glance_tick(self, now):
        vc = self.cfg["vision"]
        if not vc.get("enabled") or not self.vision_ready() or self.sk.paused or self.sk.busy or self.sk.jobs:
            return
        if now - self.last_glance < vc.get("glance_minutes", 4) * 60 or self.trivia or self.race or self.glancing:
            return
        self.last_glance = now
        self.glance_in_background(self.glance_comment)

    async def glance_comment(self):
        desc = await self.look("You're a co-host glancing at the livestream. In one sentence, say what's on screen "
                               "right now: the game or scene and what's happening.")
        if not desc:
            return
        self.sk.remember("(stream event)", f"On screen: {desc}", "event")
        cool = self.sk.beh.get("interject_cooldown_seconds", 45)
        if time.monotonic() - self.sk.last_unprompted >= cool and random.random() < self.cfg["vision"].get("comment_chance", 0.35):
            self.task(f"You just glanced at the stream and saw: {desc}. React to what's happening in one short "
                      "sentence, like a co-host watching along. Stay on what's on screen; no questions.",
                      unprompted=True)

    async def race_glance(self, r):
        desc = await self.look("This is a marble race game on a livestream. In one short sentence, say what's "
                               "happening in the race right now: who's leading or doing well if names are "
                               "visible, pileups, crashes, close calls.")
        if desc and self.race is r:
            self.task(f"Live marble race call! On screen right now: {desc}. Commentate it in one quick, excited "
                      "sentence like a race announcer.")

    # ------------------------------------------------------------ games overlay

    def games_state(self, **extra):
        now = time.monotonic()
        out = {"type": "games", "board": self.leaderboard(5), **extra}
        if self.poll:
            p = self.poll
            counts = [0] * len(p["options"])
            for i in p["votes"].values():
                counts[i] += 1
            out["poll"] = {"question": p["question"], "options": p["options"], "counts": counts,
                           "left": max(0, round(p["ends"] - now)), "closed": bool(p.get("closed"))}
        if self.trivia:
            tr = self.trivia
            t = {"phase": tr["phase"], "n": tr["n"], "rounds": tr["rounds"], "topic": tr["topic"],
                 "scores": sorted(tr["scores"].items(), key=lambda kv: -kv[1])[:5]}
            if tr.get("q") and tr["phase"] in ("asking", "reveal"):
                t.update(question=tr["q"]["question"], choices=tr["q"]["choices"], answered=len(tr["answers"]),
                         left=max(0, round(tr.get("ends", now) - now)))
                if tr["phase"] == "reveal":
                    t["answer"] = tr["q"]["answer"]
            out["trivia"] = t
        if self.predict:
            pr = self.predict
            picks = [v for _, v in pr["picks"].values()]
            out["predict"] = {"question": pr["question"], "options": pr["options"], "locked": pr["locked"],
                              "count": len(picks), "left": max(0, round(pr["locks_at"] - now)),
                              "counts": [sum(1 for v in picks if v == o) for o in pr["options"]] if pr["options"] else None}
        if self.race:
            out["race"] = {"running": True, "champ": self.state["race"].get("champ", "")}
        out["role"] = self.role[0] if self.role else None
        return out

    async def broadcast(self, **extra):
        msg = self.games_state(**extra)
        for ws in list(self.games_ws):
            try:
                await ws.send_json(msg)
            except Exception:
                self.games_ws.discard(ws)

    async def games_ws_handler(self, request):
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        self.games_ws.add(ws)
        await ws.send_json(self.games_state())
        try:
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    continue
                try:
                    msg = json.loads(m.data)
                    kind = msg.pop("cmd", "")
                    await self.api(kind, msg)
                except Exception as e:
                    log.error("Games page command failed: %s", e)
        finally:
            self.games_ws.discard(ws)
        return ws

    # ------------------------------------------------------------ main loop

    async def run(self):
        if self.cfg["vision"].get("enabled") or self.cfg.get("roles") or self.cfg["race"].get("start_on_scene"):
            self.obs = OBS(self.cfg["obs"], self.sk.brain.session)
            asyncio.create_task(self.obs.run(on_scene=self.on_scene))
        last_effect_check = last_save = last_push = 0.0
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            try:
                if self.poll and not self.poll.get("closed") and now >= self.poll["ends"]:
                    await self.end_poll()
                elif self.poll and self.poll.get("closed") and now - self.poll["closed_at"] > 25:
                    self.poll = None
                    await self.broadcast()
                if self.predict and not self.predict["locked"] and now >= self.predict["locks_at"]:
                    await self.lock_predict()
                await self.quiet_tick(now)
                await self.trivia_tick(now)
                await self.race_tick(now)
                if not self.sk.paused:
                    self.greet_tick(now)
                    self.follow_tick(now)
                if now - last_effect_check >= 30:
                    last_effect_check = now
                    await self.effect_tick(now)
                await self.glance_tick(now)
                if (self.poll or self.trivia or self.predict) and now - last_push >= 1:
                    last_push = now
                    await self.broadcast()
                if self.dirty and now - last_save >= 20:
                    last_save = now
                    self.save()
            except Exception as e:
                log.error("Features loop: %s", e)
