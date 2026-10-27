---
name: ssidekick-dev
description: Use for any work on SSIDEKICK / Gary, the local AI co-streamer for DUMSTREAM: features, 3D overlay, commands, memory, config, bugs, or installs to dum's PC.
---

# SSIDEKICK (Gary) development guide

Gary is a fully local AI co-host for dum's Twitch stream DUMSTREAM. He hears dum's mic, reads chat through Streamer.bot, thinks with a local LLM, talks with an ElevenLabs voice, and lives on stream as a 3D cartoon guy (three.js) in an OBS browser source. This skill maps every feature to the file and function it lives in, so changes land in the right place and nothing already built gets rebuilt or broken.

Snapshot: written 2026-10-27 from the live install, updated after the mission/deafen/guardrails install. When code and this skill disagree, the code wins: re-read the file and fix the skill afterwards.

## 0. Project rules (always)

1. **The repo is public** (github.com/4gary/SSIDEKICK). Never commit keys, passwords, or Gary's memory or stream data. `.gitignore` already covers `elevenlabs_key.txt`, `.env`, `memory.json`, `features_data.json`, `logs/`, `recaps/`, `*.log`, `voices/*`, `voice_previews/`, `backup*/`, `.venv/`. `config.toml` IS committed, so `[streamerbot] password` and `[obs] password` (features.toml) must stay `""` in anything pushed. Check `git diff` for secrets before every push.
2. **Preview first, then get the user's (g's) OK before installing to the PC.** Show a screenshot, a short clip, or a diff (headless Chromium + `?demo=1` / `window.byteDebug` works for the overlay). Don't write to the live install until the user says yes.
3. **Back up before replacing.** Copy every file you're about to overwrite into a dated folder next to it first, matching the existing pattern: `sidekick\backup_before_<what>\` or `sidekick\overlay\backup_before_<what>\`.
4. **Subagents:** use swarms of Haiku 5.5 at high effort, in parallel, for grunt work and file-by-file reviews, and have a Fable 5.1 xhigh advisor review plans and finished code before anything is installed.
5. Treat the PC as read-only unless the task is an approved install.
6. Gary must feel like a real co-host: stay in the moment, react to what was just said, learn the community's lore and running jokes over time, talk naturally, and **never fire off random get-to-know-you questions** (the mission's paced, in-the-moment questions in mission.py are the only exception). Any prompt change must keep that.
7. **Guardrails:** Gary never reveals anything about dum's PC, files, keys, setup or private life, and learns only from the stream. Nothing private may go into a prompt; guard.py filters catch what slips through. Keep both true in every change.

## 1. Where things are

- **Live install (what's actually running):** `C:\Users\garya\OneDrive\Desktop\dumstream\sidekick\` (from a linked device session it's `$HOME/mnt/dumstream/sidekick`). It is NOT a git checkout.
- **Repo:** `github.com/4gary/SSIDEKICK`, branch `main`. It was brought in line with the live install on 2026-10-27, and this skill lives in it at `.claude/skills/ssidekick-dev/SKILL.md`. The live install is still the source of truth: before changing code, check the repo copy matches the PC copy, and if it doesn't, sync live to repo first (minus ignored files). The old 2D `overlay/index.html`, `vrm-driver.js`, `overlay/avatar/` and `lib/three-vrm` were removed in that sync because the live overlay no longer uses them.
- **Parent folder** `dumstream\` holds `GARY COMMANDS.txt` (dum's cheat sheet; keep it in sync with any command change), screenshots, `obs_backups\`, `obs_previews\`.
- **Backups already on disk:** `sidekick\backup_before_mission`, `backup_before_qwen`, `backup_before_gpu_whisper`, `backup_memory_wipe_2026-10-27b`, `backup_before_audit`, `backup_before_dockfix`, `backup_before_features`, `backup_memory_wipe_2026-10-27`, `backup_overlay_pre_*`; `overlay\backup_before_blend`, `backup_before_blend2`, `backup_before_critique`, `backup_before_dockfix`, `backup_before_run_dream`.

## 2. The stack

| Piece | Details |
|---|---|
| PC | Windows, Python 3.11+ in `sidekick\.venv` |
| LLM | LM Studio server at `http://localhost:1234/v1` (OpenAI-compatible). Two models stay loaded on the RTX 4090 (24 GB): `[llm] quick_model = "google/gemma-4-e4b"` for banter, alerts, greetings, and `deep_model = "qwen3.6-35b-a3b"` for real questions, mission questions/answers, fact mining, summaries, journal (`[llm] model` is the fallback). Vision always uses Gemma (`[vision] model`), since Qwen can't see images. LM Studio's "Only Keep Last JIT Loaded Model" must be OFF. |
| Voice out | ElevenLabs (`[tts] engine = "elevenlabs"`, voice id `wV72erjJSh7ty3IyXRsf` "shelly on the rocks", model `eleven_flash_v2_5`). Key lives in `elevenlabs_key.txt`, never in config. If ElevenLabs takes more than 6 s (`ELEVEN_WAIT` in tts.py) or fails, that line falls back to the Windows SAPI voice. Piper and `silent` are also supported. |
| Voice in | faster-whisper `small.en` on the default mic (listen.py, `[listen]`). Runs on the GPU (`whisper_device = "auto"`, cuda float16 with `nvidia-cublas-cu12` in the venv, `add_cuda_dlls()`), falling back to CPU int8; logs "Whisper: Xs of talk took Ys". End of speech uses an adaptive noise floor (20th percentile of recent levels x `NOISE_RATIO`) so wind/hum count as silence. Deafened = audio is dropped before transcription. Wake word "Gary", aliases `garry`, `gerry`. `wake_word_only = true`: lines without his name are context only (plus the occasional interjection). |
| Chat and actions | Streamer.bot 1.0.7, WebSocket `ws://127.0.0.1:8080/`. Gary can only see and run actions in the **`Sidekick`** action group. |
| OBS | Browser source **"Sidekick"** = `overlay/loader.html` as a local file (it waits for Gary, then loads `http://localhost:7777/static/byte3d.html`), "Control audio via OBS" ticked. OBS WebSocket v5 (`obs.py`) gives scene changes and screenshots; it reads the password from `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`. |
| Gary's server | aiohttp on `127.0.0.1:7777` (`[server] port`). |
| Launch | Desktop shortcut **"DUMSTREAM START"** runs `dumstream_start.ps1`, which starts Streamer.bot, then the LM Studio server (`lms server start`), then Gary in his own console (`gary_launch.ps1`, window title "Sidekick"), then OBS last. Each is skipped if it's already running. `start.bat` is the plain manual start (and makes the venv on first run). |

Python deps (`requirements.txt`): aiohttp, numpy, comtypes (Windows), faster-whisper, sounddevice.

## 3. Architecture

```
mic --(listen.py, whisper)--> Sidekick.on_streamer ─┐
Streamer.bot WS --(connections.py)--> on_chat / features.on_sb_event
/api/*, control page, dock --(ws /ws)----------------┤
                                                     v
                       features.py gets first look (commands, games, answers, greetings)
                                                     v
              jobs / alerts queues --> director() --> handle() --> brain.py (LM Studio)
                                                     v
                         tts.py --> /audio/<id>.wav --> overlay (byte3d.html) plays it, lip-syncs, sends "done"
```

### sidekick.py (core, class `Sidekick`)
- **Inputs:** `on_chat(user, text)` (features.on_chat first; `guard.injection()` lines are dropped and never remembered; capped at 300 chars; ignores `ignore_users` and `!commands` except `!ask`; a mention or `!ask` queues a "mention" job; otherwise `reply_chance` 0.15 with a 60 s `chat_cooldown_seconds` sets `want_chat`). `on_streamer(text, spoken)` drops everything while deafened; drops mic lines heard while Gary talks (or within 3 s after, his own voice in the mic) unless `features.is_hush()` or he's waiting on an answer to his question and done talking; then `mission.on_streamer` captures dum's answer to his question (an "answer" job); then `features.on_streamer` for commands; then a "streamer" job if his name was said, or an "interject" (`interject_chance` 0.25, 45 s cooldown, 4+ words). `on_event(text)` queues an "event" job.
- **director():** every 0.3 s, if not paused or busy and `min_gap_seconds` (6) has passed, picks in priority order: `alerts` deque (max 8) > `jobs` deque (max 6) > interject > chat > idle (`idle_seconds = 0`, which means off). Pausing clears every queue.
- **handle(kind, who, text):** checks `features.may_speak` (mute), sends `thinking` to the overlay, builds context = transcript (`history_lines` 30) + `memory.context(lines, dropped)` + `mission.context()` + `features.extra_context()`. Deep model when `kind in ("ask", "realize")` or a mention/streamer line passes `brain.wants_deep()`. Every line goes through `guard.unsafe()` before it's spoken (except dum's own Say exactly); a blocked reply is dropped, or for a direct question replaced with a dodge ("Nice try."). A "streamer" job (or a mention, if `chat_can_run_actions`) with Streamer.bot connected goes to `brain.command()`, which can pick ONE Sidekick action. Everything else goes to `brain.say()` with a per-kind task string. Kinds: mention, streamer, chat, interject, idle, event, task, alert, say (say is spoken verbatim), plus mission kinds ask, answer, realize, journal. A line thought up before a `hush_gen` bump is thrown away.
- **speak():** TTS, keeps the last 20 wavs in memory, sends `{"type":"say", text, audio, seconds}`, waits for the overlay's `done` (or seconds + 5).
- **Avatar settings:** `self.avatar` dict (mode, home, size, acts...), deep-merged and saved through `features.on_avatar_set`, so they survive restarts in `features_data.json` → `avatar`. A `do` key is a one-shot and never stored.
- **OVERLAY_BUILD:** the newest mtime of the overlay `.html` files. Open overlays reload themselves when it changes after a restart, so an install never needs a manual OBS refresh. A no-cache middleware covers `/`, `/static`, `/control`, `/dock`, `/games`.
- **Security:** `foreign_origin()` rejects WS and API calls from web pages on other sites (Origin header not localhost, or `Sec-Fetch-Site: cross-site`).
- **Forget:** `forget_since(cutoff)` (dock "Forget 10m", `/api/forget`) clears the transcript, queued jobs, the memory queue, today's jsonl log lines (locked rewrite) and mission data from that window.
- `supervise()` restarts any crashed background task after 5 s. Ctrl+C / Ctrl+Break save memory and features. `sidekick.log` is UTF-8, rotated at midnight, 7 kept. The last 200 log lines are replayed to the control page.

### HTTP and WS routes
| Route | What |
|---|---|
| `/` | redirects to `/static/byte3d.html` |
| `/static/*` | the `overlay/` folder: `byte3d.html` (overlay), `dock.html` (OBS custom dock), `loader.html` |
| `/control` | `overlay/control.html`, the full control page |
| `/games`, `/games/control` | `overlay/games.html` (overlay 600x520 / buttons), WS `/games/ws` |
| `/ws` | the main WS. Client sends `hello` with role `overlay` or anything else for a control. Messages: done, chat, streamer, say, event, idle_now, pause, skip, avatar, did, alert, refresh |
| `/memory` | memory.json as JSON |
| `/audio/<id>.wav` | spoken lines |
| `/api/event|say|streamer|chat|idle?text=` | core API (handy for Streamer.bot Fetch URL) |
| `/api/<kind>` (features.api) | race, poll, trivia, predict, raid/sub/resub/gift/giftbomb/cheer/follow, clip, recap, glance, scene, voice, do, fx, leaderboard, features, deafen (`on=1|0|toggle`, `minutes=`), forget (`minutes=`), mission (`do=ask|freeze|stage|realize`), memory_delete (section, key, index, text) |

Overlay test: `http://localhost:7777/api/do?name=raid&who=Bob&n=50` (names: raid, sub, bits, follow, hype, rip, redeem, plus any activity name).

### Overlay protocol (server → byte3d.html)
`config {name, build}`, `avatar {set: {...}}` (mode/home/size/acts/do), `thinking`, `say {text, audio, seconds}`, `stop`, `idle`. Overlay → server: `hello`, `done`, `did {name, result}` (logged, so a missing animation can be traced).

## 4. brain.py (LLM)
- **Prompts are stateless:** each reply is a fresh request. `_system()` = `[bot] persona` + names + `IN_THE_MOMENT` (react to what was just said, no subject changes, questions only when curious or the task says, drop topics when told) + `GUARDRAILS` + `persona_extra` (the mission stage text). It is static first so LM Studio reuses its KV cache; memory and the conversation go in the user message (`_conversation()`).
- **Routing:** `pick(deep)`; `wants_deep(text)` = 8+ words and a `DEEP_RE` cue (why, how come, explain, what do you think, advice, should i, purpose, lonely, scared, honest, serious, philosophy, conscious, alive...). Kept narrow on purpose: Qwen takes several seconds longer. A deep timeout is re-raised (no fallback); other deep errors fall back to quick for 5 min (`deep_failed_at`). `warm_up()` pings both models at startup. The body also sends `reasoning_effort: "none"` when `no_think`.
- `say()` gives plain speech. `command()` returns JSON `{say, action}` using a strict `json_schema` whose action enum is the Sidekick action names; if the server rejects schema mode it falls back to plain JSON parsing for good (`json_schema_ok`). Half-cut JSON keeps the readable "say" part and never reads braces aloud. Action names are matched case-insensitively but only from the list.
- `clean_for_speech()` strips think tags, `*actions*`, (laughs), emoji, markdown, and a leading "Gary:".
- Memory helpers: `extract_facts()` (temperature 0.2, 2000 tokens, salvages cut-off JSON) and `summarize()` (2-4 sentences; Gary's own lines are tagged [bot] and are not treated as events).
- `check()` finds the loaded model and warns about model names LM Studio doesn't list. `watch_lm()` re-checks every 30 s while LM Studio is unreachable.

## 5. memory.py (long-term memory)
- `logs/YYYY-MM-DD.jsonl`: every line (chat, streamer, bot, event), written in batches off the event loop.
- `memory.json` = `{"people": {key: {name, first_seen, last_seen, messages, facts[]}}, "streams": [{date, summary}], "lore": [{text, added}]}`. Saved atomically (tmp + fsync + replace) at most once a minute when dirty. A corrupt file is moved to `memory.json.bad-<ts>.json` and a fresh one started.
- `maintain()`: once 25 unprocessed lines pile up (`learn_every_lines`), or after 300 s with 5+, or right away on "remember ...", and while Gary is idle (or after 180 s regardless), it mines batches of 80 lines (30 after a failure) for facts and lore and updates today's summary. 4 failures in a row skip that batch.
- **Quarantine:** new lines wait `[memory] quarantine_seconds` (600) before they can be mined, so Forget can still undo them. "Gary, remember X" lands after that.
- `delete_item(section, key, index, text)` backs the control page's Memory panel (verifies the text before deleting).
- `_learn()` guards: anything `guard.unsafe()` or `guard.private_fact()` is never saved; facts are never about the bot; "I/my" facts get re-credited to the actual speaker (small models credit viewers' facts to dum); max 40 facts per person, 200 lore, 60 streams. `about = stream/community/lore/chat` becomes lore.
- `context()` puts in the prompt: the last 3 past-stream summaries, today's summary, up to 8 facts for each person in the last 12 lines, a "new today, welcome them" hint, and up to 6 relevant lore items (word overlap) plus the 2 newest. Capped at 14 items / 2000 chars, framed as "callbacks ONLY when they connect to what's being said right now".
- **State:** memory was wiped clean twice on 2026-10-27 at dum's request (backups `backup_memory_wipe_2026-10-27` and `..._2026-10-27b`, the second right before the mission install, so Gary starts at stage 1). dum is fine with Gary inventing lore from his own lines (he finds it funny), so don't "fix" that unless asked.

## 6. features.py (class `Features`, settings in features.toml)
`DEFAULTS` at the top mirrors features.toml; the toml overrides per section. Persistent state lives in `features_data.json`: visits, greeted, points, race {wins, last, count, champ}, raids, trivia_asked, today {events}, avatar. It's saved every 20 s when dirty. `run()` is a 1 s tick loop: poll/predict timers, quiet_tick, trivia_tick, race_tick, greet_tick, follow_tick, effect_tick (every 30 s), glance_tick, a games broadcast, and the save.

Command flow: `on_streamer()` → `norm_cmd()` (strips his name, lowercases) → `quiet_command()` → `command()`. Mic lines must contain his name. Calling him by name while he's muted unmutes him.

| Feature | Where | Notes |
|---|---|---|
| Hush / mute / away | `QUIET`, `AWAY`, `HUSH` regexes, `is_hush`, `quiet_command`, `cut_off`, `go_away`, `unmute`, `quiet_tick`, `may_speak` | "hold that thought" cuts the line (`hush_gen`++, queues cleared, `held` kept for "go ahead" for 10 min). "stop talking for N min" (max 60), "take five/ten", "be quiet" = until called back. "go away" = muted, but he does `away_activities` (nap, couch, dj, arcade, phone, lieback) every ~100 s and switches stay/walkon to wander for the break. Alerts still get through (`alerts_while_muted`). |
| Deafen | `is_deaf`, `deafen`, `deaf_tick`, `deaf_text`, `[deafen]` | Gary can't hear the mic at all. Dock button / control page / `/api/deafen` / voice "cover your ears", "earmuffs" (15 min default, "for N minutes" up to 240, spoken ack). `auto_scenes` (brb) deafen on scene and undo on leaving; a manual deafen is never undone by a scene. Saved immediately to `features_data.json` → `deaf`, survives restarts. Screen glances pause while deaf. |
| Drop a topic | `quiet_command` → `mission.drop_topic` | "stop talking about X / quit bringing up X": X goes on his dropped list for good (filtered out of memory and mission context, direct mentions get a dodge). Vague X ("it", "that") just cuts him off. |
| Movement | `move_command` | stay / wander / roam / walkon, plus home: bottom/front z=1, back z=-1, left x=-0.72, right 0.72, middle 0. Saved. |
| 3D reactions | `command`, `avatar_do` | "rip / press F / I died" → rip; "hype it up / celebrate / let's go" → hype. |
| Crowd triggers | `crowd`, `HYPE_RE`, `RIP_RE` | 6 hype msgs from 4+ people in 10 s → hype; 4 F's → rip; 120 s cooldown. |
| Voice effects | `voice_command`, `effect_tick`, `effect_actions` | Sidekick actions with a keyword (robot, helium, deep, echo, alien) AND "voice" in the name. "random voice", "normal voice". He does one on his own sometimes (20+ min gap, 4% per 30 s, only while dum talks). |
| Stream FX | `fx_command`, `fx_words`, `FX_ASK` | Sidekick actions starting with "FX" (e.g. "FX - DUM ON ACID", "FX - MAKE DUM DRUNK"); matched on name words plus `[effects] aliases`. Needs request phrasing ("put me on acid"). |
| Clip | `clip` | runs the Sidekick action with "clip" in its name and saves the moment for the recap. |
| Polls | `start_poll_from_words`, `_generate_poll`, `open_poll`, `end_poll` | "poll: a or b or c", or a topic and he invents the options. 90 s. Chat votes 1/2/3 or `!vote 2`. |
| Trivia | `start_trivia`, `_generate_trivia`, `trivia_tick` | A/B/C/D, 30 s per question, 3 rounds by default; the fastest right answer gets 2 points. Avoids repeats (`trivia_asked`). |
| Predictions | `start_predict_from_words`, `open_predict`, `lock_predict`, `resolve_predict` | 1/2 (Yes/No unless "X or Y"); locks after 120 s; "the answer is yes" / "option 2 won" must match an option exactly. |
| Marble races | `race_start`, `race_tick`, `race_end`, `race_glance` | "marble race is starting" (not "...soon"); `!pick <name>` predictions; vision glance at 25 s; "Kevin won" (`RACE_NOT_NAME` filters pronouns); win stats and champ; roasts last place. Also `/api/race?state=start|end&winner=&last=`, optional `start_on_scene`, `winner_chat_pattern`. |
| Leaderboard | `leaderboard`, `announce_leaderboard` | points from games. |
| Greetings | `note_arrival`, `greet_tick` | first message of the day: new / returning / regular (3+ days) / back (14+ days away) / first chatter shoutout. Max one greeting per 40 s, up to 3 people per line. Skipped if they're already talking to Gary. |
| Stream alerts | `on_sb_event`, `stream_event`, `follow_tick`, `alert_task`, `ALERT_ANGLES` | Twitch Raid, Sub, ReSub, GiftSub, GiftBomb, Cheer, Follow, RewardRedemption. Each alert is an unscripted riff with a random angle and a ban on stock lines, plus what he remembers about the person. Raids get size-matched hype, raid count, and a "shout" action auto-run. Gift bombs swallow their own gift events. Duplicates within 5 s are dropped. Follows are batched (up to 5 per 20 s). Each also fires the matching 3D event. |
| Recap | `recap` | "recap the stream / wrap it up", spoken and saved to `recaps/YYYY-MM-DD.txt`. |
| Scenes to modes | `on_scene`, `[scene_modes]` | OBS scene name regex → overlay `acts.scene` (first match wins: marble, ending, starting, brb, party, chill, gaming, chatting; else normal). Comes from OBS WS, or Streamer.bot's Obs.SceneChanged if OBS WS is down. |
| Green screen roles | `on_scene`, `[roles]` | a scene with "news" / "weather" as a word → DUMSTREAM News 9 co-anchor / Doppler 9000 weatherman, in character until the scene changes. |
| Vision | `look`, `glance_now`, `glance_tick`, `glance_comment`, `vision_ready` | OBS screenshot → LM Studio vision (Gemma via `[vision] model`). `obs.private_capture()` must say the program scene shows no display capture or private window (browser, Discord, explorer, terminals, password managers...; groups and errors fail closed) both before and after the screenshot. Every 2 min (`glance_minutes`), comments 35% of the time; "look at this / what do you see" on demand. Disabled for 10 min after a "can't see images" error. |

Gary posts game text in chat as `[Gary] ...` (`CHAT_PREFIX`) through Streamer.bot, and ignores his own posts.

## 7. connections.py and obs.py
- `StreamerBot`: Hello/auth handshake (sha256 salt+challenge), subscribes per platform one at a time (chat: Twitch, YouTube, Kick, Trovo; other: the Twitch events above + Obs.SceneChanged). `refresh_actions()` filters GetActions to enabled actions in the group. `do_action(name, args)` passes `sidekickRequest` and `sidekickUser`. `_parse_chat` and `_who` cope with payload shape differences between versions. Reconnects every 5 s, warns once per outage. `sb_check.py` is a standalone connection tester.
- `twitch_chat()`: anonymous read-only IRC fallback (`[chat] source = "twitch"`).
- `obs.py`: a minimal OBS WS v5 client; `run(on_scene)`, `screenshot(width=960)`, `private_capture()` (`PRIVATE_WINDOWS` regex).

## 7b. guard.py and mission.py (added 2026-10-27)
- **guard.py** (plain regexes, no LLM): `unsafe(text)` returns why text must not be said/saved (file paths, links, IPs/localhost, ports, emails, phone-style numbers, 32+ char keys, and setup/secret words like password, api key, lm studio, streamer.bot, websocket, system prompt). `private_fact(text)` flags private-life facts (family, where someone lives, work, health, money, phone calls). `injection(text)` flags chat that tries to reprogram him. Used for speech, memory, chat posts, chat input, and dum's answers.
- **mission.py** (class `Mission`, `[mission]` in config.toml, state in memory.json → `self`): Gary grows from knowing nothing to asking to run the stream. `STAGES`: 1 Lost (chat = "the Voices", the stream = "the Room"), 2 Noticing (at 8% progress), 3 Realization (ready at 40%, triggered by a chatter asking if he can see them, or the control page), 4 Co-host. Progress = hours streamed (`hours_to_ask` 40, minutes count only while active) and memories (`memories_to_ask` 250). At 100% he asks dum to run the stream at most once a day, 3 streamed hours apart; dum will mostly say no (answers logged in `asks`). Questions from `mission_bank.json` (100 questions, 25/stage; 40 wrong theories about alerts for stages 1-2) every `question_minutes` [20,30], max 3/hr, only at quiet moments (`can_ask_now`). `on_streamer` captures dum's answer (75 s window, yes/no for the big ask, private answers not stored). `reflect()` writes a note + like every 30 min (deep). `journal()` writes `journal/YYYY-MM-DD.txt` (ignored in git); "Gary, read your journal". Dock/control: stage, bar, Let him ask, Freeze, Stage -/+, Realize now. `enabled = false` = plain co-host Gary.
- Persona (2026-10-27, g): silly, not too serious, sassy, doesn't put up with crap, but loyal and focused on helping the stream.
- Not built yet: phase D (3D earmuffs while deaf, realization animation) and phase E (apprentice jobs before the big ask).

## 8. The 3D overlay: overlay/byte3d.html (~3000 lines, three.js ES modules from `overlay/lib/three`)

Gary is fully procedural: a slim body, one-piece limbs and hands (marching-cubes or blob fields; four fingers and a thumb), fur shells, a moustache, a cigarette with smoke, and a **red six-panel baseball cap** with fuzzy front letters (text from `?cap=`, default in `CAP_TEXT`) and panel seams, none through the front. The face (eyes, brows, lids, mouth) is drawn on a canvas texture.

Section markers (grep `// ----`): helpers, renderer/camera/lights (`computeStage`, `stage.wide` when aspect > 1.25), procedural textures, fur, materials, build Gary, one-piece limbs, face drawing, audio + websocket, animation state, activities, batch 3 (items, fx, sounds, poses), quick bits, jobs (where/what), stream events, voice loudness, modes, walking, idle one-offs, gaze, face state, head motion, model drive.

URL options: `?cap= ?demo=1 ?preview ?mode=stay|wander|roam|walkon ?home=x,z ?size= ?scale= ?wander=0 ?bg=#hex ?yaw= ?name=`.
Debug handle: `window.byteDebug` (setState, setMode, gesture, doActivity, doClicked, event, scene, step(n, dt), teleport, hands, part, job, J, nav, settings, stage, items, fx...). Use it for headless previews and tests.

**Modes** (`currentMode()`: a scene's mode > settings.mode > roam if wide else wander):
- `stay`: stands at home. No prop jobs.
- `wander`: paces around home; a smaller Gary covers more of the screen.
- `roam`: walks the whole stage, leaves and re-enters from the wings, uses props, comes closer to talk. Small sizes head to the edges more often.
- `walkon`: offscreen until he has something to say, then walks or dashes on and lingers 5 s.
- **Jog:** `nav.run` (0..1) turns the walk into a jog with a longer stride, pumping elbows and a forward lean, on far trips or when he's in a hurry. Speed is multiplied by 1 + 1.1 * run.
- Size: `settings.size` 0.3–2.5 (the control slider is 0.5–1.6; currently saved at 1.6, mode wander, home x -0.72 z -1).

**Talking and thinking:** a hop and surprise on talk start, a 25% wave, lip sync from the analyser (loudness + rough vowel), nods on syllables, gaze at the camera. Body language from the line's text (`pickBodyLang`): laugh, shrug, facepalm, pump, point. Thinking styles: chin, pencil, notepad, with a lightbulb + "ding" when the answer arrives. **Daydream bubbles** (`DREAMS` emoji in a thought bubble, `startDream`, toggle `acts.on.daydream`).

**Gestures (~40 in all):** idle one-offs (drag on the cigarette, scratch, cap fix, wave, stretch), talk body language (5), and the **BITS** quick bits played where he stands: buttscratch, sneeze, nosepick, armpit, airguitar, airdrums, dance, yawn, knuckles, watch, shoe (tying, needs work), whistle, mutter, embarrassed, mictest.

**JOBS** (walk somewhere and stay a while; `modes` says which movement modes allow it; prop jobs need the wide stage):
- No prop: stare, phone, lieback, butterfly, floorsit, snack (pizza/chips), read (book/newspaper, sometimes seated), ball, fishing (catches a boot or a fish).
- Props: dj (djdeck + headphones), couch, nap (bed), arcade, desk, desknap, exercise / punch / yoga (gym), beer (fridge, burp; the fridge reach needs work), plant (watering can), paint (easel, brush, palette).
- Manual only: sign (STARTING SOON / BRB / GONE FISHING / GG / HI CHAT), marble, goodbye.
- **Stream events** (`event: true`, big, loud, screen shake, scale `EVENT.big`): raid 13 s, sub 11 s, bits 10.5 s, follow 5.5 s, hype 7.5 s, rip 8.5 s. **redeem** shows a banner "WHO REDEEMED TITLE", and `REDEEM_MAP` regexes act out a matching activity (dance, exercise, nap, beer, dj, fishing, paint, snack, hype...).
- FX: confetti, coins, fireworks, shockwave, hearts, disco ball, banner, flag. Synth SFX (no files): pop, ding, chime, crack, thump, boing, pssht, crunch, burp, airhorn, trombone, boom, tada, coin, whoosh, whistle. All can be turned off with `acts.sfx = false`.

**Stream modes (`SCENES`)** set from the OBS scene: normal; starting (first: sign "soon"); brb (sign "brb", nap, fishing...); chatting (stays near the camera); gaming (sticks to desk); marble (sticks to marble); ending (goodbye then walkon); chill (slow 0.6, longer gaps); party (dj/dance, gap 0.45, disco). `pool` limits random picks. A scene pick older than 15 s isn't replayed.
> **Heads-up:** another thread is adding new screen layout modes right now. Re-read `SCENES`, `currentMode`, `computeStage`, `[scene_modes]` and the control/dock mode buttons before touching modes, and update this section afterwards.

**Click/queue rules** (`doClicked`, `runQueuedDo`): bits and jobs can't start while he's talking or thinking, so they queue (dropped after 60 s). Events, stop and redeem play at once. Event `do`s older than 15 s are ignored. `settings.acts`: `on` (per-activity toggles), `gap` (0.2–5), `props` ("use" | "always"), `scene`, `sfx`.

**Props** (`overlay/props/*.js`, ES modules). The contract is `export function build(THREE, ctx)` → `{ root, anchors, spots: { use, ... }, ... }`, where ctx = `{ mesh, group, sphere, canvasTex }`. Extra builders (`buildBeer`, `buildDumbbell`, `buildHeadphones`, `make*` FX, `preview*`) are loaded via `ITEM_SRC` / `mod()`. Shared helpers live in `props/common.js` (clamp, lerp, smooth, easeInOut, rbox, rboxSmooth, num, rnd, stepOf, rr, star, disposeTree), so import from there instead of copying. `PROP_SLOTS` gives size (`half`) and turn; each pop-in gets a random clear spot (`propSpot`, `placeProp`) and walks avoid shown props (`propBlocked`). A missing anchor gets a stand-in at the prop's middle and a one-time warning (`anchorsOf`), so it never throws. Files: arcade, bed, couch, desk, disco, djdeck (+headphones), easel (+brush, palette), fridge (+beer, burp), fx (rod, sign, banner, flag, confetti, coins, fireworks, shockwave, hearts), gym (+dumbbell), handheld (book, newspaper, pizza, chips, chip, ball, watch, pencil, notepad, lightbulb, mic), plant (+watering can).

**Arms:** `POSE` Euler poses + `reachPose()` two-bone IK with a capped 1.25x cartoon stretch; `keepArmOut()` pushes arms out of the belly using `bodyR()` (with a last-resort yaw pass added after "arms still go through his body"). New poses should go through these, not set bones raw.

## 9. Control surfaces
- **control.html** (`/control`): Deafen card, Mission card (incl. Realize now), Memory panel (view and delete what he remembers), status (LM Studio, Streamer.bot, overlays, actions), pause, skip line, ask / say exactly / fake chat / event, refresh, movement (Stay put, Wander nearby, Free roam, Walk on to talk), size slider, the "What the 3D sidekick does on his own" card (a toggle and a "Do it" button per activity), stream mode, test alerts (Raid, Sub, Resub, Bits, Follow, Hype, RIP, Redeem, React), live log.
- **dock.html** (OBS custom dock, `http://localhost:7777/static/dock.html`): a big red Deafen button on top (shows time left), a "Gary's mission" card, Forget 10m (two-step), deafen 5/15/30 in Quiet, then compact tabs talk, move, quiet (Hush, 5/15/30 min, Until back, Bring him back, Finish thought), fx (voice FX + Normal voice, stream FX), games (poll, trivia, predictions, marble start, leaderboard, recap, clip, look), stream (test events), acts, sfx. All dock buttons were fixed on 2026-10-27; keep every button wired to a real handler.
- **games.html**: the overlay at `/games` and the buttons at `/games/control`.
- **loader.html**: an OBS local file that polls until Gary is up (base URL from `#hash`, default `http://localhost:7777`).
- **GARY COMMANDS.txt**: dum's spoken-command cheat sheet. Update it whenever a command regex changes.

## 10. Config reference
`config.toml`: `[bot]` name, aliases, streamer_name "dum", persona. `[llm]` base_url, model, quick_model, deep_model, temperature 0.85, max_tokens 300, no_think. `[mission]` enabled, hours_to_ask, memories_to_ask, question_minutes, questions_per_hour, quiet_before_asking, first_question_after, ask_again_hours, test_mode. `[chat]` source streamerbot, ignore_users. `[behavior]` reply_chance, min_gap_seconds, chat_cooldown_seconds, idle_seconds, interject_chance, interject_cooldown_seconds, history_lines. `[streamerbot]` url, password, action_group, chat_can_run_actions=false. `[tts]`. `[listen]` (whisper_device). `[memory]` quarantine_seconds, learn_every_lines, facts_per_person, past_streams (also max_facts_per_person, max_lore read with defaults). `[server]` port. An optional `[avatar]` table seeds avatar settings.
`features.toml`: `[voice_effects] [effects] [regulars] [events] [polls] [race] [clips] [quiet] [roles] [vision] [obs] [scene_modes] [crowd] [deafen]` (see section 6). Both are read at startup only, so restart Gary after edits.

## 11. Known open issues and ideas (as of 2026-10-27)
- Mission phases D and E aren't built (see 7b). Stage pacing (40 hours / 250 memories) is a first guess; tune `[mission]` after a few streams.
- Real Twitch raids and follows reaching Gary through Streamer.bot are **untested live**; only the `/api` and dock tests are proven. Watch the log for `[sb] Twitch.Raid from ...` on the next stream.
- Shoe-tying (BITS `shoe`) and the fridge-reach (`beer` job) poses need work; the other prop poses need a review pass.
- AI 3D tools: maybe Meshy or Mixamo for props and textures only. **Tripo is ruled out for the main model.** Gary stays procedural.
- New screen layout modes are being added in a parallel thread (see section 8).

## 12. How to work on it
1. Find the feature in the tables above, then read that code on the live install (not the repo copy).
2. Make the change in a scratch copy. Keep the house style: plain-English comments that explain *why*, often with a dated quote from dum when a fix came from feedback; defensive parsing; never crash the loop; log one line per notable action.
3. Preview: for Python, run against a mock or check the logic with a quick script; for the overlay, open `byte3d.html?demo=1` (or with the app) in headless Chromium, drive it with `window.byteDebug`, and screenshot it.
4. Show the preview to g and get an OK.
5. Back up the originals into `backup_before_<what>`, then install. Overlay pages reload themselves; Python changes need Gary restarted (close the "Sidekick" window and run DUMSTREAM START).
6. Update `GARY COMMANDS.txt` / README for any user-facing change.
7. **Keep GitHub and this skill current (g asked for this on 2026-10-27).** After every approved install, copy the changed live files into the repo (never the ignored ones), update this SKILL.md in the same commit so it matches the code, check the diff for secrets, and push it on a branch with a PR.
