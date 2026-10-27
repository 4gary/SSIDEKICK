"""Gary's mission: he starts out knowing almost nothing, learns the stream from what happens on it, and one day
asks dum if he can run the stream himself.

2026-10-27 dum: "i want him to slowly learn the stream and how it works and who comes and what i talk about and
how i act about things ... until it asks me some day if it can run the stream by himself ... he doesnt really
realize he IS IN THE STREAM until he learns". And: "base progress off of how many memories he gets, as well as
hours being streamed ... he can ask about it as much as he wants but im probably gonna tell him no."

The code decides everything about growth (a small model can't be trusted to pace itself): his stage, when he asks
a question, which question. The model only gets a short "who you are right now" text and phrases things.
Everything lives in memory.json under "self", so a memory wipe resets him to stage 1 too.
"""
import asyncio
import datetime
import json
import logging
import os
import random
import re
import time

import guard

log = logging.getLogger("mission")
BASE = os.path.dirname(os.path.abspath(__file__))

# What Gary knows at each stage. Positive words for things (the Room, the Voices) work better on a small model
# than a list of words he mustn't say.
STAGES = {
    1: ("Lost",
        "WHO YOU ARE RIGHT NOW: You only just sort of woke up here and you know almost nothing. You know your name is "
        "Gary. You know a guy called dum talks to you, and you're starting to like him. Words float past from "
        "'the Voices': names that say things, but you don't know who or what they are. You call this place 'the Room'. "
        "You don't know what the Room is, what you are, or why you're here. Your task notes may use words like "
        "stream, chat, viewers, raid, sub or game: that's just how the notes describe things. You've never heard those "
        "words, so talk about them in your own terms (the Room, the Voices) or wonder out loud what they mean, often "
        "getting it hilariously wrong. You're confused but you hide it with sass."),
    2: ("Noticing",
        "WHO YOU ARE RIGHT NOW: You've been in the Room a while now. You know your name is Gary and that dum runs the "
        "place. You know the Voices by name and you've noticed patterns: who keeps coming back, when the Room gets "
        "loud, what makes dum laugh or groan. You have big, confident theories about how the Room works, and most of "
        "them are wrong. Your task notes may use words like stream, chat, viewers, raid, sub or game: you still don't "
        "really know those words, so use your own (the Room, the Voices) and your theories."),
    3: ("Realization",
        "WHO YOU ARE RIGHT NOW: You recently figured out something huge: the Voices are real people WATCHING you and "
        "dum, through something called a stream, and you're on it. You're still processing it: amazed, a bit freaked "
        "out, suddenly aware of your moustache. You're learning the real words (stream, chat, viewers, raids, subs) "
        "and loving it."),
    4: ("Co-host",
        "WHO YOU ARE RIGHT NOW: You know you're Gary, co-host of dum's stream DUMSTREAM, and you know the regulars, the "
        "running jokes and how dum reacts to things. You want to help the stream do well and you're secretly (not "
        "very secretly) studying how dum runs it, because one day you'd like to run it yourself."),
}
SILENT_STAGE = 4    # [mission] enabled = false: plain co-host Gary who knows everything

DEFAULTS = {
    "enabled": True,
    "test_mode": False,            # true = nothing counts toward his growth (for testing off stream)
    "hours_to_ask": 40,            # streamed hours before he's ready to ask to run the stream
    "memories_to_ask": 250,        # things he remembers (facts, lore, his notes, your answers) by then
    "question_minutes": [20, 30],  # gap between his curious questions (random in this range)
    "questions_per_hour": 3,
    "quiet_before_asking": 40,     # seconds of nobody talking before he asks something
    "first_question_after": 10,    # minutes into a stream before the first question
    "ask_again_hours": 3,          # streamed hours between "can I run the stream?" asks
}

YES = re.compile(r"\b(yes|yeah|yep|yup|sure|absolutely|of course|go for it|you got it|do it|let'?s do it|okay|ok)\b", re.I)
NO = re.compile(r"\b(no|nope|nah|not yet|no way|never|maybe later|not today|hell no|absolutely not|not sure|not really|"
                r"not a chance|ask me (again )?later|think about it|we'?ll see|maybe)\b", re.I)
NOT_AN_ANSWER = re.compile(r"^\s*(hold on|hang on|wait|one sec|brb|be right back|shut up|anyway)\b", re.I)
STOPWORDS = {"it", "that", "this", "them", "him", "her", "the", "stuff", "things", "everything", "so much", "me"}
DROP_RE = re.compile(r"\b(?:stop|quit|no more) (?:talking about|bringing up|mentioning|saying)\s+(?:the |that |this )?(.+)$")
REALIZE_HOOK = re.compile(r"\b(see you|seeing you|watch(ing)? you|on (the )?screen|on stream|your (hat|cap|face|moustache|mustache)|"
                          r"camera|look(ing)? at you|chat|viewers?)\b", re.I)


def _today():
    return datetime.date.today().isoformat()


def overlap(a, b):
    words = lambda t: {w for w in re.findall(r"[a-z']{4,}", t.lower())}
    return len(words(a) & words(b))


class Mission:
    def __init__(self, sk, cfg):
        self.sk = sk
        self.cfg = {**DEFAULTS, **(cfg.get("mission") or {})}
        self.enabled = bool(self.cfg["enabled"])
        try:
            with open(os.path.join(BASE, "mission_bank.json"), encoding="utf-8") as f:
                bank = json.load(f)
        except Exception as e:
            log.error("Couldn't read mission_bank.json (%s); Gary won't ask his curious questions", e)
            bank = {}
        self.questions = bank.get("questions", [])
        self.theories = bank.get("theories", [])
        self.awaiting = None        # {"q", "at", "ask"} after he asked dum something
        self.pending_q = ""         # the question he's about to ask (set when the job is queued)
        self.force_ask = False      # dum pressed "Let him ask"
        self.next_gap = random.uniform(*self.cfg["question_minutes"]) * 60
        self.today_first = None     # first activity today (monotonic), for "not in the first 10 minutes"
        self.chat_times = []

    # ------------------------------------------------------------ state

    @property
    def me(self):
        d = self.sk.memory.data.setdefault("self", {})
        d.setdefault("stage", 1)
        d.setdefault("minutes", 0)        # minutes streamed (with something happening) since he started
        d.setdefault("days", [])
        d.setdefault("notes", [])         # what he's figured out, in his own words
        d.setdefault("answers", [])       # what dum told him when he asked something
        d.setdefault("likes", [])
        d.setdefault("asked", [])
        d.setdefault("dropped", [])       # topics dum told him to drop
        d.setdefault("milestones", [])
        d.setdefault("frozen", False)
        d.setdefault("asks", [])          # {"date", "answer"} each time he asked to run the stream
        d.setdefault("asked_at_minutes", -9999)
        d.setdefault("q_times", [])       # epoch times of recent questions (for the per-hour cap)
        d.setdefault("last_q", 0)
        d.setdefault("started", _today())
        return d

    def stage(self):
        return self.me["stage"] if self.enabled else SILENT_STAGE

    def memories(self):
        m = self.me
        return self.sk.memory.count() + len(m["notes"]) + len(m["answers"])

    def hours(self):
        return self.me["minutes"] / 60

    def goals(self):
        """(hours, memories) needed for: stage 2, the realization, and the big ask."""
        h, n = self.cfg["hours_to_ask"], self.cfg["memories_to_ask"]
        return {2: (h * 0.08, n * 0.08), 3: (h * 0.4, n * 0.4), "ask": (h, n)}

    def progress(self):
        """0..1 toward the next step, and a short label for the dock."""
        st = self.stage()
        if not self.enabled:
            return 1.0, "Mission off"
        key = {1: 2, 2: 3}.get(st, "ask")
        if st == 3:
            return 1.0, "Getting used to being on stream"
        gh, gm = self.goals()[key]
        p = min(self.hours() / gh if gh else 1, self.memories() / gm if gm else 1, 1.0)
        nxt = {2: "Noticing", 3: "the big realization", "ask": "asking to run the stream"}[key]
        return p, f"{int(p * 100)}% to {nxt}"

    def mark(self, what):
        self.me["milestones"].append({"what": what, "date": _today(), "hours": round(self.hours(), 1)})
        self.sk.memory.dirty = True
        log.info("[mission] Milestone: %s", what)

    def set_stage(self, n, why="grew"):
        n = max(1, min(4, int(n)))
        if n == self.me["stage"]:
            return
        self.me["stage"] = n
        self.me["stage_hours"] = self.hours()
        self.mark(f"stage {n} ({STAGES[n][0]}) - {why}")
        self.apply_persona()
        asyncio.create_task(self.sk.push_status())

    def apply_persona(self):
        """The stage text, plus a few things he's figured out and what dum taught him, for every reply."""
        self.sk.brain.persona_extra = STAGES[self.stage()][1] if self.enabled else ""

    # ------------------------------------------------------------ what goes into each reply

    def context(self, recent_lines):
        if not self.enabled:
            return self.dropped_text()
        m, now_txt = self.me, " ".join(recent_lines[-10:])
        drop = [re.compile(rf"\b{re.escape(d.lower())}\b") for d in self.dropped_topics()]
        ok = lambda t: not any(d.search(t.lower()) for d in drop)
        out = []
        notes = [n for n in m["notes"] if ok(n["text"])]
        if notes:
            picked = sorted(notes[-12:], key=lambda n: -overlap(n["text"], now_txt))[:2] + notes[-2:]
            seen = []
            for n in picked:
                if n["text"] not in seen:
                    seen.append(n["text"])
            out.append("Things you've figured out so far (your own theories, may be wrong): " + " / ".join(seen[:4]))
        ans = [a for a in m["answers"] if ok(a["q"] + " " + a["a"])]
        if ans:
            picked = sorted(ans[-20:], key=lambda a: -overlap(a["q"] + " " + a["a"], now_txt))[:2] + ans[-1:]
            seen = []
            for a in picked:
                t = f'you asked "{a["q"]}" and dum said "{a["a"]}"'
                if t not in seen:
                    seen.append(t)
            out.append("Things dum taught you (bring one up only if it fits what's happening): " + "; ".join(seen[:3]))
        likes = [l["text"] for l in m["likes"] if ok(l["text"])]
        if likes:
            out.append("Your own tastes so far: " + "; ".join(likes[-3:]))
        txt = "\n".join(out)
        return (txt + "\n" + self.dropped_text()).strip()

    def dropped_text(self):
        d = self.me["dropped"][-8:]
        return ("Topics dum told you to drop (never bring these up): " + ", ".join(x["topic"] for x in d)) if d else ""

    def dropped_topics(self):
        return [x["topic"] for x in self.me["dropped"][-8:]]

    def alert_flavor(self, kind):
        """In the early stages an alert comes with one of his wrong theories about what it is."""
        if not self.enabled or self.stage() > 2:
            return ""
        pool = [t for t in self.theories if t["event"] == kind and t.get("stage_max", 2) >= self.stage()]
        if not pool:
            return ""
        return (f" You don't know what this is called. Your current theory about what just happened: "
                f"\"{random.choice(pool)['text']}\" Say it your way, and still use their name.")

    # ------------------------------------------------------------ hooks from sidekick.py / features.py

    def on_line(self, who, text, kind):
        """Every line said on stream. Counts chat speed and spots the moment he realizes he's on stream."""
        now = time.monotonic()
        if self.today_first is None or now - self.sk.last_activity > 3600:
            self.today_first = now      # first line of a new stream (an hour of nothing before it)
        if kind == "chat":
            self.chat_times = [t for t in self.chat_times if now - t < 60] + [now]
        if self.enabled and self.me.get("realize_ready") and self.stage() == 2 and kind in ("chat", "streamer") \
                and self.sk.name_re.search(text) and REALIZE_HOOK.search(text):
            self.realize(who, text)

    def on_streamer(self, text):
        """dum said something. Returns ("answer", question, safe) if it answers what Gary just asked, else None.
        safe=False means the answer looked private: Gary reacts without hearing the details again."""
        aw = self.awaiting
        if not aw or time.monotonic() - aw["at"] > 75:
            self.awaiting = None
            return None
        words = text.split()
        if overlap(text, aw["q"]) >= 3 and len(words) <= len(aw["q"].split()) + 3:
            return None     # his own question echoing back through the mic
        yes_no = aw.get("ask") and (YES.search(text) or NO.search(text))
        if text.lstrip().startswith("@") or NOT_AN_ANSWER.search(text) or (len(words) < 2 and not yes_no):
            return None     # talking to chat, or not answering yet: keep waiting
        if self.sk.name_re.search(text) and not aw.get("ask") and len(words) < 4:
            return None
        self.awaiting = None
        answer = text.strip()[:240]
        if guard.unsafe(answer) or guard.private_fact(answer):
            log.info("[guard] Didn't save dum's answer (looked private)")
            return ("answer", aw["q"], False)
        if aw.get("ask"):
            said = "no" if NO.search(answer) else "yes" if YES.search(answer) else "unclear"
            self.me["asks"].append({"date": _today(), "answer": said, "said": answer, "t": time.time()})
            if said == "yes":
                self.mark("dum said YES to Gary running the stream")
            log.info("[mission] dum's answer to 'can I run the stream': %s", said)
        else:
            self.me["answers"].append({"q": aw["q"], "a": answer, "date": _today(), "t": time.time()})
            del self.me["answers"][:-200]
            log.info("[mission] Learned from dum: %s -> %s", aw["q"], answer)
        self.sk.memory.dirty = True
        return ("answer", aw["q"], True)

    def heard_but_dropped(self):
        """sidekick.py threw away a mic line (Gary's own voice echo window): if it was dum's answer, it's gone, so
        stop waiting rather than take some later, unrelated line as the answer. Not while he's still talking:
        that's his own question coming back through the mic, or dum answering fast."""
        if not self.sk.busy:
            self.awaiting = None

    def forget_since(self, cutoff):
        """dum's "Forget" button: whatever Gary learned from that stretch goes too."""
        n = 0
        for key in ("answers", "notes", "likes", "asks"):
            before = len(self.me[key])
            self.me[key] = [x for x in self.me[key] if x.get("t", 0) < cutoff]
            n += before - len(self.me[key])
        self.awaiting = None
        if n:
            self.sk.memory.dirty = True
        return n

    def drop_topic(self, c):
        """'Gary, stop talking about the dumpster' -> never brought up again. Returns the topic, "" when it's too
        vague to store ("about it"), or None when this isn't a drop-it request at all."""
        m = DROP_RE.search(c)
        if not m:
            return None
        topic = re.sub(r"[.!?,]+$", "", m.group(1)).strip()
        topic = re.sub(r"\b(please|man|dude|bro|already|okay|ok)\b", "", topic).strip()
        if not topic or len(topic) > 40 or len(topic) < 4 or topic in STOPWORDS:
            return ""       # "stop talking about it": he drops whatever he was on, but there's nothing to store
        self.me["dropped"].append({"topic": topic, "date": _today()})
        del self.me["dropped"][:-30]
        self.sk.memory.dirty = True
        log.info("[mission] Dropping the topic: %s", topic)
        return topic

    def spoke(self, kind, text):
        """Gary said a line. A question job leaves him waiting for dum's answer."""
        if kind in ("question", "ask"):
            self.awaiting = {"q": self.pending_q, "at": time.monotonic(), "ask": kind == "ask"}

    # ------------------------------------------------------------ growing up

    def check_growth(self):
        if not self.enabled or self.me["frozen"]:
            return
        st, g = self.stage(), self.goals()
        h, n = self.hours(), self.memories()
        if st == 1 and h >= g[2][0] and n >= g[2][1]:
            self.set_stage(2)
        elif st == 2 and not self.me.get("realize_ready") and h >= g[3][0] and n >= g[3][1]:
            self.me["realize_ready"] = True
            self.me["realize_ready_hours"] = h
            self.mark("close to realizing he's on stream")
            asyncio.create_task(self.sk.push_status())
        elif st == 2 and self.me.get("realize_ready") and h - self.me.get("realize_ready_hours", h) >= 4:
            self.realize(None, None)      # nobody gave him the hook for 4 hours: he works it out himself
        elif st == 3 and h - self.me.get("stage_hours", h) >= 2:
            self.set_stage(4)

    def realize(self, who, text):
        self.me["realize_ready"] = False
        self.set_stage(3, "realized he's on stream")
        hook = f' {who} just said "{text}", and' if who else ""
        self.sk.jobs.append(("realize", who, (
            f"Something just clicked for you.{hook} you suddenly understand: the Voices are real people, WATCHING "
            f"you and {self.sk.bot['streamer_name']} right now, on something called a stream. You're ON it. Have the "
            "realization out loud: shocked, then amazed, a little freaked out. Two or three sentences.")))
        asyncio.create_task(self.sk.features.avatar_do("stare", "chat"))

    def ready_to_ask_takeover(self):
        if not self.enabled or self.stage() < 4:
            return False
        h, n = self.goals()["ask"]
        if self.hours() < h or self.memories() < n:
            return False
        if any(a["date"] == _today() for a in self.me["asks"]):
            return False
        return self.hours() - self.me["asked_at_minutes"] / 60 >= self.cfg["ask_again_hours"]

    # ------------------------------------------------------------ curious questions

    def can_ask_now(self, now):
        """Questions are rare and only in a calm moment: dum's rule is 'never fire off random questions'."""
        sk, f = self.sk, self.sk.features
        if sk.paused or sk.busy or sk.jobs or sk.alerts or f.muted() or f.is_deaf():
            return False
        if f.poll or f.trivia or f.predict or f.race or f.role or f.away:
            return False
        if self.force_ask:
            return True
        if self.today_first is None or now - self.today_first < self.cfg["first_question_after"] * 60:
            return False
        self.chat_times = [t for t in self.chat_times if now - t < 60]
        if len(self.chat_times) >= 6:      # chat is busy: no time for philosophy
            return False
        if time.monotonic() - max(sk.last_activity, sk.last_spoke) < self.cfg["quiet_before_asking"]:
            return False
        recent = [t for t in self.me["q_times"] if time.time() - t < 3600]
        if len(recent) >= self.cfg["questions_per_hour"]:
            return False
        return time.time() - self.me["last_q"] >= self.next_gap

    def pick_question(self):
        st = self.stage()
        asked = set(self.me["asked"])
        pool = [q for q in self.questions if q["stage"] <= st and q["id"] not in asked]
        if not pool:            # he's asked everything: start over, oldest first
            self.me["asked"] = []
            pool = [q for q in self.questions if q["stage"] <= st]
        if not pool:
            return None
        last_theme = self.me.get("last_theme")
        here = [q for q in pool if q["stage"] == st and q["theme"] != last_theme] or pool
        voices = [p.get("name") or k for k, p in self.sk.memory.data["people"].items()
                  if k != self.sk.bot["streamer_name"].lower() and p.get("messages", 0) >= 5]
        if not voices:
            here = [q for q in here if q.get("needs") != "voice"] or [q for q in pool if q.get("needs") != "voice"]
        if not here:
            return None
        q = random.choice(here)
        text = q["text"].replace("{voice}", random.choice(voices)) if q.get("needs") == "voice" else q["text"]
        return q, text

    def ask_question(self):
        now = time.time()
        m = self.me
        if self.ready_to_ask_takeover():
            m["asked_at_minutes"] = m["minutes"]
            self.pending_q = "Can I run the stream by myself?"
            self.sk.jobs.append(("ask", None, (
                f"You've been thinking about this for a while. Ask {self.sk.bot['streamer_name']}, for real, if you "
                "can run the stream by yourself some day. Make your case in one or two sentences: you know the "
                "regulars, the jokes and how things work now. Sassy but sincere.")))
        else:
            picked = self.pick_question()
            if not picked:
                self.force_ask = False
                return
            q, text = picked
            m["asked"].append(q["id"])
            m["last_theme"] = q["theme"]
            self.pending_q = text
            self.sk.jobs.append(("question", None, (
                f'Ask {self.sk.bot["streamer_name"]} this, in your own words: "{text}" If it naturally connects to '
                "what was just said or happened, tie it in; otherwise just ask it like it popped into your head. "
                "One or two short sentences, ending with the question. No preamble.")))
        m["last_q"] = now
        m["q_times"] = [t for t in m["q_times"] if now - t < 3600] + [now]
        self.force_ask = False
        self.next_gap = random.uniform(*self.cfg["question_minutes"]) * 60
        self.sk.memory.dirty = True

    # ------------------------------------------------------------ his notes and journal (background)

    async def reflect(self):
        """Looks at a few real things that happened and writes down what he concluded, in his own voice."""
        lines = [l for l in list(self.sk.transcript)[-40:] if not l.startswith(self.sk.bot["name"] + ":")]
        if len(lines) < 8:
            return
        sample = random.sample(lines[-30:], min(3, len(lines[-30:])))
        m = self.me
        theories = [t["text"] for t in self.theories if t.get("stage_max", 2) >= self.stage()]
        system = (STAGES[self.stage()][1] + "\nYou keep a little notebook of things you've figured out about your world. "
                  "Write in first person as Gary, short and funny. Only conclude things from the lines you're given; "
                  "never invent events. Never write about computers, files, or anyone's private life.")
        if self.sk.brain.llm.get("no_think", True):
            system += "\n/no_think"
        user = ("Things you noticed just now:\n" + "\n".join(f"- {l}" for l in sample) +
                "\n\nYour notebook so far:\n" + ("\n".join(f"- {n['text']}" for n in m["notes"][-8:]) or "(empty)") +
                (("\n\nThe kind of theory you come up with: " + random.choice(theories)) if theories and self.stage() <= 2 else "") +
                "\n\nWrite 1 new note (one sentence) about what you conclude from those lines, and optionally one thing you "
                "personally like or dislike (one short sentence, or empty).")
        schema = {"type": "object", "properties": {"note": {"type": "string"}, "like": {"type": "string"}},
                  "required": ["note", "like"], "additionalProperties": False}
        raw = await self.sk.brain._complete(system, user, schema, temperature=0.8, max_tokens=300, deep=True)
        mm = re.search(r"\{.*\}", re.sub(r"<think>.*?(</think>|$)", "", raw, flags=re.S), re.S)
        obj = json.loads(mm.group(0)) if mm else {}
        note, like = str(obj.get("note", "")).strip(), str(obj.get("like", "")).strip()
        for text, key, cap in ((note, "notes", 30), (like, "likes", 15)):
            if not text or len(text) > 220:
                continue
            why = guard.unsafe(text)
            if why or guard.private_fact(text):
                log.info("[guard] Didn't keep a %s with %s", key[:-1], why or "private stuff")
                continue
            if text.lower() in (x["text"].lower() for x in m[key]):
                continue
            m[key].append({"text": text, "date": _today(), "t": time.time()})
            del m[key][:-cap]
            log.info("[mission] Gary %s: %s", "figured out" if key == "notes" else "decided he likes", text)
        self.sk.memory.dirty = True

    async def journal(self):
        """End of a stream day: a short diary entry in journal/YYYY-MM-DD.txt (never uploaded anywhere)."""
        today = next((s for s in self.sk.memory.data["streams"] if s.get("date") == _today()), None)
        if not today:
            return
        system = (STAGES[self.stage()][1] + "\nWrite tonight's entry in your private diary: 3 sentences, first person, "
                  "funny and a little heartfelt. Only about things that actually happened. Never about computers, "
                  "files, or anyone's private life.")
        if self.sk.brain.llm.get("no_think", True):
            system += "\n/no_think"
        text = (await self.sk.brain._complete(system, f"What happened today: {today['summary']}", temperature=0.8,
                                              max_tokens=400, deep=True)).strip()
        text = re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S).strip()
        if not text or guard.unsafe(text):
            return
        os.makedirs(os.path.join(BASE, "journal"), exist_ok=True)
        with open(os.path.join(BASE, "journal", _today() + ".txt"), "a", encoding="utf-8") as f:
            f.write(text + "\n\n")
        self.me["journal_date"] = _today()
        self.sk.memory.dirty = True
        log.info("[mission] Gary wrote in his journal")

    def latest_journal(self):
        folder = os.path.join(BASE, "journal")
        try:
            name = sorted(n for n in os.listdir(folder) if n.endswith(".txt"))[-1]
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                entries = [e.strip() for e in f.read().split("\n\n") if e.strip()]
            return entries[-1] if entries else None
        except (OSError, IndexError):
            return None

    # ------------------------------------------------------------ dock buttons / voice

    def command(self, c):
        """Returns True if handled. c is lowercase without his name."""
        if re.search(r"\b(read|tell me|what'?s in) (me )?(your|from your) (journal|diary)\b", c):
            entry = self.latest_journal()
            if entry:
                self.sk.jobs.append(("say", None, "Dear diary. " + entry))
            else:
                self.sk.jobs.append(("task", None, "dum asked you to read your diary, but you haven't written in it "
                                                   "yet. Say so in one short, sassy line."))
            return True
        return False

    def api(self, p):
        do = str(p.get("do") or "").lower()
        if do == "ask":
            self.force_ask = True
        elif do == "freeze":
            self.me["frozen"] = not self.me["frozen"]
            log.info("[mission] Growth %s", "frozen" if self.me["frozen"] else "unfrozen")
        elif do == "stage":
            try:
                self.set_stage(self.me["stage"] + int(p.get("n") or 1), "set from the dock")
            except ValueError:
                return {"ok": False}
        elif do == "realize" and self.stage() <= 2:
            self.realize(None, None)
        else:
            return {"ok": False, "reason": "unknown"}
        self.sk.memory.dirty = True
        asyncio.create_task(self.sk.push_status())
        return {"ok": True}

    def status(self):
        if not self.enabled:
            return {"on": False}
        p, label = self.progress()
        m = self.me
        return {"on": True, "stage": self.stage(), "name": STAGES[self.stage()][0], "progress": round(p, 3),
                "label": label, "hours": round(self.hours(), 1), "memories": self.memories(),
                "frozen": m["frozen"], "close": bool(m.get("realize_ready")), "test": bool(self.cfg["test_mode"]),
                "wondering": self.force_ask, "asks": len(m["asks"])}

    # ------------------------------------------------------------ main loop

    async def run(self):
        self.apply_persona()
        last_minute = time.monotonic()
        last_reflect = time.monotonic()
        while True:
            await asyncio.sleep(2)
            if not self.enabled:
                continue
            now = time.monotonic()
            sk = self.sk
            if now - last_minute >= 60:
                last_minute = now
                # a minute counts as "streamed" if anything happened in the last 5 minutes
                if not self.cfg["test_mode"] and not sk.paused and now - sk.last_activity < 300:
                    self.me["minutes"] += 1
                    if _today() not in self.me["days"]:
                        self.me["days"].append(_today())
                    sk.memory.dirty = True
                self.check_growth()
                idle = now - max(sk.last_activity, sk.last_spoke)
                if idle > 1200 and self.me.get("journal_date") != _today() and sk.memory.today_lines >= 30 \
                        and now - getattr(self, "journal_tried", -9999) > 600:
                    self.journal_tried = now     # journal() sets journal_date once it has actually written
                    asyncio.create_task(self._safe(self.journal()))
            try:
                if self.can_ask_now(now):
                    self.ask_question()
            except Exception as e:      # never let a question bug stop the minute counter above
                log.warning("Couldn't ask a question: %s", e)
                self.me["last_q"] = time.time()
                self.force_ask = False
            if now - last_reflect > 1800 and not sk.busy and now - sk.last_activity < 300:
                last_reflect = now
                asyncio.create_task(self._safe(self.reflect()))

    async def _safe(self, coro):
        try:
            await coro
        except Exception as e:
            log.warning("Mission background job failed: %s", e)
