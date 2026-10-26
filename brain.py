"""Talks to the local LLM in LM Studio (OpenAI-compatible API)."""
import json
import logging
import re

import aiohttp

log = logging.getLogger("brain")

THINK_RE = re.compile(r"<think>.*?(</think>|$)", re.S | re.I)
IN_THE_MOMENT = (
    "How to be a great co-host: stay in the moment. React to what was JUST said or just happened, the way a "
    "friend on the couch would: riff on it, agree or push back, add a joke, a hot take, or a callback to "
    "something from earlier. Never change the subject out of nowhere and never ask random get-to-know-you "
    "questions. Only ask a question when you're genuinely curious about what was just said."
)

EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF️‍]+"
)


def clean_for_speech(text, bot_name):
    text = THINK_RE.sub("", text)
    text = re.sub(r"\*[^*]{1,60}\*", "", text)          # *waves*
    text = re.sub(r"\([^)]{0,40}(laugh|sigh|grin|smile)[^)]*\)", "", text, flags=re.I)
    text = EMOJI_RE.sub("", text)
    text = re.sub(r"[#*_`~>]", "", text)
    text = re.sub(rf"^\s*{re.escape(bot_name)}\s*:\s*", "", text, flags=re.I)
    text = text.strip().strip('"').strip()
    return re.sub(r"\s+", " ", text)


class Brain:
    def __init__(self, cfg, session: aiohttp.ClientSession):
        self.cfg = cfg
        self.llm = cfg["llm"]
        self.bot = cfg["bot"]
        self.session = session
        self.model = self.llm.get("model") or ""
        self.json_schema_ok = True

    async def check(self):
        """Find the loaded model. Returns a status string."""
        try:
            async with self.session.get(self.llm["base_url"] + "/models", timeout=aiohttp.ClientTimeout(total=5)) as r:
                data = await r.json()
            models = [m["id"] for m in data.get("data", [])]
            if not self.model and models:
                # skip embedding models if LM Studio lists them
                chat_models = [m for m in models if "embed" not in m.lower()] or models
                self.model = chat_models[0]
            return f"LM Studio OK, using model: {self.model or '(LM Studio default)'}"
        except Exception as e:
            return f"Can't reach LM Studio at {self.llm['base_url']} ({e}). Is the server started?"

    def _system(self, extra="", memory=""):
        s = self.bot["persona"].strip()
        s += f"\nThe streamer's name is {self.bot['streamer_name']}. Your name is {self.bot['name']}."
        s += "\n" + IN_THE_MOMENT
        if memory:
            s += "\n\n" + memory
        if extra:
            s += "\n" + extra
        if self.llm.get("no_think", True):
            s += "\n/no_think"
        return s

    async def _complete(self, system, user, schema=None, temperature=None, max_tokens=None):
        body = {
            "model": self.model or "local-model",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": self.llm.get("temperature", 0.85) if temperature is None else temperature,
            "max_tokens": max_tokens or self.llm.get("max_tokens", 200),
            "stream": False,
        }
        if self.llm.get("no_think", True):
            # Newer Qwen versions ignore /no_think, and LM Studio honors this instead
            body["reasoning_effort"] = "none"
        if schema and self.json_schema_ok:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "reply", "strict": True, "schema": schema},
            }
        url = self.llm["base_url"] + "/chat/completions"
        async with self.session.post(url, json=body, timeout=aiohttp.ClientTimeout(total=90)) as r:
            if r.status == 400 and "response_format" in body:
                err = await r.text()
                if re.search(r"response_format|json_schema|schema|grammar", err, re.I):
                    log.warning("Model/server rejected JSON schema mode, falling back to plain text JSON")
                    self.json_schema_ok = False
                    return await self._complete(system, user, schema, temperature, max_tokens)
                raise RuntimeError(f"LM Studio error 400: {err[:200]}")
            r.raise_for_status()
            data = await r.json()
        return data["choices"][0]["message"].get("content") or ""

    async def say(self, transcript, task, memory=""):
        """Plain spoken reply. transcript: list of 'who: text' lines."""
        user = "Recent stream conversation (oldest first):\n" + ("\n".join(transcript) or "(nothing yet)")
        user += f"\n\nYour task: {task}\nReply with only what {self.bot['name']} says out loud."
        raw = await self._complete(self._system(memory=memory), user)
        return clean_for_speech(raw, self.bot["name"])

    async def command(self, transcript, who, request, actions, memory=""):
        """Reply that may also pick one Streamer.bot action. Returns (speech, action_name or None)."""
        names = [a["name"] for a in actions]
        listing = "\n".join(f"- {n}" for n in names) or "(none)"
        extra = (
            "You can control the stream by running ONE of these actions when asked:\n"
            f"{listing}\n"
            "Only run an action if the request clearly asks for it. Otherwise action is an empty string.\n"
            'Answer ONLY with JSON like {"say": "what you say out loud", "action": "exact action name or empty"}.'
        )
        user = "Recent stream conversation (oldest first):\n" + "\n".join(transcript)
        user += f"\n\n{who} just said to you: \"{request}\"\nRespond."
        schema = {
            "type": "object",
            "properties": {"say": {"type": "string"}, "action": {"type": "string", "enum": names + [""]}},
            "required": ["say", "action"],
            "additionalProperties": False,
        }
        raw = await self._complete(self._system(extra, memory), user, schema if names else None)
        raw = THINK_RE.sub("", raw).strip()
        speech, action, parsed = raw, None, False
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                obj = json.loads(m.group(0))
                speech = str(obj.get("say", ""))
                action = str(obj.get("action", "")).strip() or None
                parsed = True
            except (ValueError, AttributeError):
                pass
        if not parsed:
            # cut off (max_tokens) or malformed: keep whatever "say" was written, never the braces and key names
            sm = re.search(r'"say"\s*:\s*"((?:[^"\\]|\\.)*)', raw)
            if sm:
                try:
                    speech = json.loads('"' + sm.group(1) + '"')
                except ValueError:
                    speech = sm.group(1)
            elif raw.startswith("{"):
                speech = ""   # JSON with no readable "say": better silence than reading the JSON out loud
        if action:
            # tolerate small spelling/case differences, but never run something not in the list
            lookup = {n.lower(): n for n in names}
            action = lookup.get(action.lower())
        return clean_for_speech(speech, self.bot["name"]), action

    # ------------------------------------------------------------ memory helpers (run in the background)

    async def extract_facts(self, lines, known, streamer, bot_name):
        """Pull lasting facts about people out of a chunk of conversation. Returns [{"line", "about", "fact"}]."""
        known_txt = "\n".join(f"- {who}: {'; '.join(facts)}" for who, facts in known.items()) or "(nothing yet)"
        system = (
            "You maintain the long-term memory of a livestream co-host. From the conversation, pick out facts "
            "worth remembering for future streams: names of pets/partners, where someone is from, their job, "
            "favorite games, big moments, things someone explicitly asked to be remembered, plans for future "
            "streams. Also capture the community's LORE: running jokes, nicknames, catchphrases, recurring bits, "
            "memorable fails and wins, chat traditions. Use about = \"stream\" for lore that belongs to the whole "
            f"community rather than one person. {streamer} is the streamer; {bot_name} is the co-host bot (never store "
            "facts about the bot). Skip greetings, small talk, and anything already known. Each fact is one short "
            "sentence about one person. For each fact give the number of the line it came from and who it is "
            "about. Words like I, my, me in a line always refer to the person who wrote that line, NOT the streamer. "
            "If nothing is worth remembering, return an empty list."
        )
        if self.llm.get("no_think", True):
            system += "\n/no_think"
        numbered = []
        for i, line in enumerate(lines, 1):
            who, _, text = line.partition(":")
            who = who.strip()
            role = "streamer" if who.lower() == streamer.lower() else "bot" if who.lower() == bot_name.lower() else "viewer"
            numbered.append(f"{i}. [{role} {who}] {text.strip()}")
        user = f"Already known:\n{known_txt}\n\nNew conversation:\n" + "\n".join(numbered)
        schema = {
            "type": "object",
            "properties": {"facts": {"type": "array", "items": {
                "type": "object",
                "properties": {"line": {"type": "integer"}, "about": {"type": "string"}, "fact": {"type": "string"}},
                "required": ["line", "about", "fact"], "additionalProperties": False}}},
            "required": ["facts"], "additionalProperties": False,
        }
        # room for a long list: a cut-off answer is broken JSON, and that batch would fail forever
        raw = THINK_RE.sub("", await self._complete(system, user, schema, temperature=0.2, max_tokens=2000))
        m = re.search(r"\{.*\}", raw, re.S)
        try:
            facts = json.loads(m.group(0)).get("facts", []) if m else None
        except json.JSONDecodeError:
            facts = None
        if facts is None and '"facts"' in raw:
            # still cut off somewhere: keep every complete fact before the break
            facts = []
            for item in re.finditer(r"\{[^{}]*\}", raw.split('"facts"', 1)[1]):
                try:
                    facts.append(json.loads(item.group(0)))
                except json.JSONDecodeError:
                    pass
            log.info("Facts answer was cut off; kept %d complete facts", len(facts))
        if facts is None:
            raise RuntimeError(f"model didn't return valid JSON for facts: {raw[:120]!r}")
        return [f for f in facts if isinstance(f, dict)]

    async def summarize(self, lines, previous, streamer):
        """Rolling 2-4 sentence summary of today's stream."""
        bot_name = self.bot["name"]
        system = ("You keep short notes on a livestream. Update the summary of today's stream with the new "
                  "conversation. Mention what the streamer was doing, notable viewers, funny moments, and anything "
                  "planned. Lines marked [bot] are the co-host bot's own jokes and questions: they are NOT things "
                  "that happened, so only mention them if people actually reacted. 2-4 sentences, plain text, no lists.")
        if self.llm.get("no_think", True):
            system += "\n/no_think"
        labeled = []
        for line in lines:
            who = line.partition(":")[0].strip().lower()
            tag = "[bot] " if who == bot_name.lower() else "[streamer] " if who == streamer.lower() else ""
            labeled.append(tag + line)
        user = (f"Summary so far: {previous or '(stream just started)'}\n\nNew conversation "
                f"({streamer} is the streamer, {bot_name} is the bot):\n" + "\n".join(labeled) + "\n\nUpdated summary:")
        raw = await self._complete(system, user, temperature=0.3, max_tokens=1500)   # Gemma can still reason silently first
        return THINK_RE.sub("", raw).strip()
