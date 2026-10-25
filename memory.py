"""Long-term memory: logs everything said on stream, and remembers facts and stream summaries.

Files (all plain text you can open and edit):
  logs/YYYY-MM-DD.jsonl   every chat line, your lines, the bot's lines, and stream events
  memory.json             facts about you and each viewer, plus a summary of each stream
"""
import asyncio
import datetime
import json
import logging
import os
import re
import time

log = logging.getLogger("memory")


def _today():
    return datetime.date.today().isoformat()


class Memory:
    def __init__(self, cfg, base_dir):
        self.cfg = cfg.get("memory", {})
        self.enabled = self.cfg.get("enabled", True)
        self.streamer = cfg["bot"]["streamer_name"]
        self.bot = cfg["bot"]["name"]
        self.log_dir = os.path.join(base_dir, "logs")
        self.path = os.path.join(base_dir, "memory.json")
        self.data = {"people": {}, "streams": [], "lore": []}
        self.unprocessed = []          # lines not yet mined for facts
        self.today_lines = 0
        self.last_extract = time.monotonic()
        self.force_extract = False
        self.retry_after = 0.0
        self.failures = 0
        if self.streamer.lower() == self.bot.lower():
            log.warning("The bot and the streamer have the same name (%s); facts about you may get mixed up", self.bot)
        if os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    self.data.update(json.load(f))
            except Exception as e:
                log.error("Couldn't read memory.json (%s). Starting a fresh one, old file kept as memory.bad.json", e)
                os.replace(self.path, self.path + f".bad-{int(time.time())}.json")
        os.makedirs(self.log_dir, exist_ok=True)
        self.data.setdefault("lore", [])
        n_facts = sum(len(p.get("facts", [])) for p in self.data["people"].values())
        log.info("Memory: %d people, %d facts, %d lore, %d past streams",
                 len(self.data["people"]), n_facts, len(self.data["lore"]), len(self.data["streams"]))

    # ------------------------------------------------------------ logging

    def record(self, who, text, kind):
        """kind: chat | streamer | bot | event"""
        entry = {"t": datetime.datetime.now().isoformat(timespec="seconds"), "kind": kind, "who": who, "text": text}
        try:
            with open(os.path.join(self.log_dir, _today() + ".jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            log.warning("Couldn't write chat log: %s", e)
        if not self.enabled:
            return
        if kind == "chat":
            p = self._person(who)
            p["messages"] = p.get("messages", 0) + 1
            p["last_seen"] = _today()
        self.unprocessed.append(f"{who}: {text}")
        del self.unprocessed[:-400]   # if the LLM is down for ages, keep only the latest lines
        self.today_lines += 1
        if kind in ("chat", "streamer") and re.search(r"\bremember\b", text, re.I):
            self.force_extract = True

    def _person(self, name):
        key = name.lower()
        people = self.data["people"]
        if key not in people:
            people[key] = {"name": name, "first_seen": _today(), "facts": []}
        return people[key]

    def save(self):
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except OSError as e:  # e.g. memory.json open in an editor or locked by OneDrive
            log.warning("Couldn't save memory.json (%s), will try again next time", e)

    # ------------------------------------------------------------ what goes into the prompt

    def context(self, recent_lines):
        """Short 'things you remember' text for the people in the recent conversation."""
        if not self.enabled:
            return ""
        out = []
        streams = self.data["streams"][-self.cfg.get("past_streams", 3):]
        for s in streams:
            if s.get("date") != _today():
                out.append(f"Stream on {s['date']}: {s['summary']}")
        today = next((s for s in self.data["streams"] if s.get("date") == _today()), None)
        if today:
            out.append(f"Earlier today: {today['summary']}")
        names = {self.streamer.lower()}
        for line in recent_lines[-12:]:   # the people in the conversation right now
            names.add(line.split(":", 1)[0].strip().lower())
        per_person = self.cfg.get("facts_per_person", 8)
        for key in names:
            p = self.data["people"].get(key)
            if not p:
                continue
            facts = p.get("facts", [])[-per_person:]
            seen = p.get("messages", 0)
            about = f"About {p['name']}"
            if key != self.streamer.lower():
                about += f" (viewer since {p.get('first_seen', '?')}, {seen} messages)"
            if facts:
                out.append(about + ": " + "; ".join(facts))
            elif key != self.streamer.lower() and p.get("first_seen") == _today() and seen <= 2:
                out.append(f"{p['name']} looks new to the stream today. Welcome them.")
        out = self._relevant_lore(recent_lines) + out
        if not out:
            return ""
        out = out[:14]
        while len("\n".join(out)) > 2000 and len(out) > 1:   # keep the prompt small and fast
            out.pop()
        return ("Things you remember from past streams. Use them for callbacks and inside jokes ONLY when they "
                "connect to what's being said right now, never as a random topic change:\n- " + "\n- ".join(out))

    def _relevant_lore(self, recent_lines, limit=6):
        """Lore that shares words with the current conversation, plus the newest couple of items."""
        lore = self.data.get("lore", [])
        if not lore:
            return []
        words = lambda t: {w for w in re.findall(r"[a-z0-9']{4,}", t.lower())}
        now = words(" ".join(l.split(":", 1)[-1] for l in recent_lines[-12:]))
        scored = sorted(((len(words(item["text"]) & now), i) for i, item in enumerate(lore)), reverse=True)
        picked = [i for score, i in scored if score > 0][:limit]
        for i in range(len(lore) - 1, max(-1, len(lore) - 3), -1):   # always keep the 2 newest in mind
            if i not in picked:
                picked.append(i)
        return ["Stream lore: " + lore[i]["text"] for i in sorted(picked)]

    # ------------------------------------------------------------ background: learn facts, keep summaries

    async def maintain(self, brain, is_idle):
        """Runs forever. When the bot is idle, mines new lines for facts and refreshes today's summary."""
        every = self.cfg.get("learn_every_lines", 25)
        while True:
            await asyncio.sleep(5)
            now = time.monotonic()
            waited = now - self.last_extract
            # learn while the bot is quiet, but don't let a busy stream starve it forever
            if not self.enabled or not self.unprocessed or now < self.retry_after or (not is_idle() and waited < 180):
                continue
            if not (self.force_extract or len(self.unprocessed) >= every or (waited > 300 and len(self.unprocessed) >= 5)):
                continue
            size = 80 if self.failures < 2 else 30     # smaller bites after a failure
            batch, self.unprocessed = self.unprocessed[:size], self.unprocessed[size:]
            self.force_extract = False
            self.last_extract = time.monotonic()
            try:
                await self._learn(brain, batch)
            except Exception as e:
                self.failures += 1
                if self.failures >= 4:   # this chunk just won't go through: skip it rather than retry forever
                    log.warning("Memory update failed again (%s); skipping %d lines (they're still in the log)",
                                e, len(batch))
                    self.failures = 0
                else:
                    log.warning("Memory update failed (%s), retrying in 2 minutes", e)
                    self.unprocessed = (batch + self.unprocessed)[-400:]
                self.retry_after = time.monotonic() + 120
                continue
            self.failures = 0
            self.save()

    async def _learn(self, brain, batch):
        known = {}
        in_batch = ({line.split(":", 1)[0].strip().lower() for line in batch} | {self.streamer.lower()}) - {"(stream event)"}
        for line in batch:
            key = line.split(":", 1)[0].strip().lower()
            p = self.data["people"].get(key)
            if p and p.get("facts"):
                known[p["name"]] = p["facts"][-10:]
        facts = await brain.extract_facts(batch, known, self.streamer, self.bot)
        added = 0
        for item in facts:
            who, fact = str(item.get("about") or item.get("who") or "").strip(), str(item.get("fact", "")).strip()
            if who.lower() in ("stream", "community", "lore", "chat"):
                if fact and len(fact) <= 250 and fact.lower() not in (l["text"].lower() for l in self.data["lore"]):
                    self.data["lore"].append({"text": fact, "added": _today()})
                    self.data["lore"] = self.data["lore"][-self.cfg.get("max_lore", 200):]
                    added += 1
                    log.info("Remembered stream lore: %s", fact)
                continue
            if who.lower() == self.bot.lower() and who.lower() != self.streamer.lower():
                continue  # don't store facts about the bot itself
            # small models often credit a viewer's "my dog..." to the streamer, so check against the source line
            try:
                n = int(item.get("line", 0))
                speaker, _, said = batch[n - 1].partition(":") if 1 <= n <= len(batch) else ("", "", "")
                speaker = speaker.strip()
            except (TypeError, ValueError):
                speaker, said = "", ""
            if speaker and speaker.lower() not in (self.bot.lower(), "(stream event)"):
                first_person = re.search(r"\b(i|i'm|im|my|me|mine|we|our)\b", said, re.I)
                if who.lower() not in in_batch or (first_person and who.lower() != speaker.lower()):
                    if who and fact.lower().startswith(who.lower()):
                        fact = speaker + fact[len(who):]   # "g has a dog" -> "Sam has a dog"
                    who = speaker
            if not who or not fact or len(fact) > 200 or who.lower() not in in_batch:
                continue
            p = self._person(who)
            if fact.lower() not in (f.lower() for f in p["facts"]):
                p["facts"].append(fact)
                p["facts"] = p["facts"][-self.cfg.get("max_facts_per_person", 40):]
                added += 1
                log.info("Remembered about %s: %s", p["name"], fact)

        today = next((s for s in self.data["streams"] if s.get("date") == _today()), None)
        summary = await brain.summarize(batch, today["summary"] if today else "", self.streamer)
        if summary:
            if today:
                today["summary"] = summary
            else:
                self.data["streams"].append({"date": _today(), "summary": summary})
                self.data["streams"] = self.data["streams"][-60:]
        log.info("Memory updated (%d new facts)", added)
