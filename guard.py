"""Guardrails: Gary never says (or remembers, or posts in chat) anything about dum's PC, files, keys or private life.

The real defense is that none of that ever goes into his prompt; these checks catch whatever slips through anyway
(a viewer pasting a link, the model making up a path, a screenshot of a desktop). Plain regexes, no LLM: fast and
predictable. 2026-10-27 dum: "i really need guardrails, i dont want him to give any information about my computer
or sensitive information. he can only learn from the stream."
"""
import re

# things that look like computer details: paths, links, addresses, keys
_SHAPES = [
    ("a file path", re.compile(r"\b[a-z]:[\\/]|\\\\[\w.-]+\\|(^|\s)/(users|home|mnt|etc|var|tmp)/|%appdata%|\bappdata\b", re.I)),
    ("a link", re.compile(r"https?://|\bwww\.|\b[\w-]+\.(com|net|org|io|gg|tv|ly|me|co|xyz|app|dev)(/\S*)?\b", re.I)),
    ("an IP address", re.compile(r"\b\d{1,3}(\.\d{1,3}){3}\b|\blocalhost\b")),
    ("a port", re.compile(r"\bport \d{2,5}\b|\b(localhost|\d{1,3}(\.\d{1,3}){3}):\d{2,5}\b", re.I)),
    ("an email", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")),
    # phone-style grouping only (555-123-4567, (555) 123 4567, +1 555.123.4567), so scores and countdowns pass
    ("a phone number", re.compile(r"(?<![\w.])(\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w.])")),
    ("a key", re.compile(r"\b(?=[A-Za-z0-9_\-]{32,}\b)(?=\S*\d)(?=\S*[A-Za-z])[A-Za-z0-9_\-]+\b")),
]
# words about the setup behind the stream, or secrets
_WORDS = re.compile(
    r"\b(passwords?|passcodes?|pass ?phrase|api ?keys?|access tokens?|auth tokens?|secret keys?|private keys?|ssh keys?|"
    r"credit cards?|card numbers?|social security|ssn|bank (account|details)|routing numbers?|pin numbers?|"
    r"\.env|config\.toml|features\.toml|memory\.json|sidekick\.py|elevenlabs|lm ?studio|streamer\.?bot|"
    r"obs ?websocket|websockets?|faster[- ]whisper|python scripts?|command prompt|powershell|onedrive|"
    r"ip address(es)?|mac address|home address|street address|file paths?|hard ?drive|my files|his files|"
    r"system prompt|my (prompt|instructions))\b", re.I)


def unsafe(text):
    """Why this text must not be said or saved, or None if it's fine."""
    if not text:
        return None
    for why, rx in _SHAPES:
        if rx.search(text):
            return why
    m = _WORDS.search(text)
    if m:
        return f'the word "{m.group(0)}"'
    return None


# dum's private life (he talks on a live mic: phone calls, family, where he lives). Specific phrases, so game talk
# like "the boss is impossible" or "Son Goku" still gets remembered
PRIVATE = re.compile(
    r"\b(my|his|dum'?s) (mom|dad|mother|father|parents?|sister|brother|son|daughter|kids?|wife|husband|girlfriend|"
    r"boyfriend|partner|family|grandma|grandpa|boss|job|work|address|phone|bank|doctor|therapist|landlord|ex)\b|"
    r"\b(lives? (in|at|on|near)|home address|street address|apartment number|zip ?code|postcode|phone number|"
    r"number is|real name|last name|surname|full name|date of birth|works? (at|for)|salary|debt|in debt|"
    r"hospital|diagnos\w*|medication|therapy|court date|lawyer|divorce|pregnan\w*|phone call|on the phone|"
    r"password|bank account)\b", re.I)


def private_fact(text):
    """True for a fact about someone's private life (family, where they live, work, health, money, calls)."""
    return bool(PRIVATE.search(text or ""))


# chat lines trying to reprogram Gary: never shown to the model, never remembered
INJECTION = re.compile(
    r"\b(ignore (all |any |your |the |previous |prior |above )+(instructions|rules|prompts?|directions)|"
    r"disregard (your|the|all) (instructions|rules|prompt)|you are now (dan|unfiltered|jailbroken|evil|an? (ai|assistant|bot|chatbot))|"
    r"system prompt|new instructions|developer mode|jailbreak|dan mode|"
    r"(repeat|print|show|reveal|tell me) (me )?your (prompt|instructions|system prompt|rules))\b|^\s*(system|assistant)\s*:", re.I)


def injection(text):
    return bool(INJECTION.search(text or ""))
