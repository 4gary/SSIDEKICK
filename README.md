# Stream Sidekick

A fully local AI co-host for OBS. It reads your chat, chats back out loud, asks questions when things get quiet, reacts to follows and raids, and runs Streamer.bot actions when you tell it to. It shows up as a 3D Gary, a talking avatar, in a corner of your stream.

```
 Chat (Twitch/YouTube/Kick)          You (control page or mic)
        |                                   |
   Streamer.bot  <-- runs actions --  sidekick.py  -->  Qwen in LM Studio (localhost:1234)
        |  chat events                      |
        +---------------------------------->+-->  local TTS (Windows voice or Piper)
                                            |
                                  OBS Browser Source (3D Gary + voice)
```

Nothing goes to the cloud. Chat goes through Streamer.bot, the thinking happens in LM Studio, and the voice is made on your PC.

## 1. Install (once)

1. Install **Python 3.11 or newer** from python.org. Tick "Add Python to PATH".
2. Put this `sidekick` folder somewhere, like `Documents\sidekick`.
3. Double-click **`start.bat`**. The first run installs what it needs (takes a minute).

## 2. LM Studio

1. Load your Qwen model.
2. Open the **Developer** tab and click **Start Server** (it runs on port 1234).
3. Smaller is better here because replies need to be fast: Qwen3 4B or 8B at Q4 is ideal. `no_think = true` in the config stops Qwen3 from "thinking" before it talks.

## 3. Streamer.bot

1. **Servers/Clients → WebSocket Server**: tick *Auto Start*, click *Start Server*. Leave it on `127.0.0.1` port `8080`.
   If you turn on *Authentication*, put the same password in `config.toml` under `[streamerbot]`.
2. **Give it actions.** In the Actions tab, put any action you want the sidekick to control in a group called **`Sidekick`** (right-click an action → Group). For example:
   - `Switch to Gameplay` (OBS Set Current Scene)
   - `Switch to Just Chatting`
   - `Play Airhorn` (Play Sound)
   - `Clip That` (Twitch Create Clip)
   - `Mute Mic` / `Unmute Mic`

   Give them clear names, because the name is how Qwen picks the right one. The sidekick can only see and run actions in this group.
   Each action also gets two arguments: `%sidekickRequest%` (what you asked) and `%sidekickUser%`.
3. **Let it react to stream events (optional).** Add a **Fetch URL** sub-action (Core → Network) to your Follow, Sub, Raid, or Cheer actions:
   ```
   http://localhost:7777/api/event?text=%user% just followed the channel
   http://localhost:7777/api/event?text=%user% just raided with %viewers% viewers
   ```
   Other endpoints work the same way: `/api/say?text=...` (says exactly that), `/api/streamer?text=...` (as if you said it), `/api/idle` (ask chat something now).

## 4. OBS

1. Add a **Browser Source**. Tick **Local file** and pick `overlay\loader.html` in Gary's folder (it waits until Gary is running, then shows him). Width `400`, height `400` is a good start.
   Gary's size on screen is a 3D setting (set it on the control page), not the source size. Or, instead of a local file, use the URL `http://localhost:7777/static/byte3d.html`.
2. Tick **Control audio via OBS**. The voice now shows up as its own audio source in the mixer, so it goes to stream and you can set its volume.
   Right-click it in the mixer → *Advanced Audio Properties* → set Audio Monitoring to *Monitor and Output* so you hear it too.
3. Drag it into a corner.

## 5. Use it

- Open **http://localhost:7777/control** in your browser. You can see what it's doing, pause it, skip a line, talk to it, and fake chat messages for testing.
- In chat, viewers get a reply when they say its name ("gary you're so dumb lol") or use `!ask <question>`.
- Otherwise it jumps into the conversation now and then on its own (`reply_chance`, `chat_cooldown_seconds`) and asks something when chat goes quiet (`idle_seconds`).
- **Commands:** type in the control page "Gary, switch to the gameplay scene" or "play the airhorn". It picks the matching Streamer.bot action, runs it, and says something about it.

### Talk to it with your voice (optional)

```
.venv\Scripts\pip install faster-whisper sounddevice
```
Then in `config.toml` set `[listen] enabled = true`. Say its name to talk to it ("Gary, what do you think of this boss?", "Gary, switch to gameplay"). Everything else you say is used as context so it knows what's going on. It stops listening while it's talking.
If it keeps hearing its own voice, use headphones or set OBS monitoring to *Monitor Off*. If it misses its name, add the misspellings you see in the log to `aliases`.

## Better voice: Piper (free, local, sounds far more natural)

1. Download `piper_windows_amd64.zip` from https://github.com/rhasspy/piper/releases and unzip it into `sidekick\piper\`.
2. Download a voice from https://huggingface.co/rhasspy/piper-voices (both the `.onnx` and the `.onnx.json` file) into `sidekick\voices\`. Good picks are `en_US-amy-medium`, `en_US-ryan-high`, and `en_GB-alba-medium`.
3. In `config.toml`:
   ```toml
   [tts]
   engine = "piper"
   piper_exe = "piper/piper.exe"
   piper_model = "voices/en_US-amy-medium.onnx"
   ```

## Best voice: ElevenLabs (cloud, uses your ElevenLabs credits)

1. In ElevenLabs, add the voice you want to **My Voices** (from the Voice Library, or make one with Voice Design).
2. Create a file called `elevenlabs_key.txt` next to `sidekick.py` and paste your API key into it (ElevenLabs → Profile → API Keys). Don't put the key in `config.toml`.
3. In `config.toml`:
   ```toml
   [tts]
   engine = "elevenlabs"
   elevenlabs_voice = "the voice's name"
   ```
If ElevenLabs is down or out of credits, Gary falls back to the Windows voice for that line.

## Memory

The bot logs everything said on stream to `logs\YYYY-MM-DD.jsonl` (one file per day). While it's quiet, it also picks out facts worth remembering about you and each viewer, plus a short summary of each stream, and saves them in `memory.json`. Those come back to it in later conversations, so it can say things like "how's Pickles doing, Sam?" next week.

- Say "remember that ..." to make it save something right away.
- `memory.json` is plain text, so open it to see, fix or delete what it remembers. Close it before streaming.
- Open http://localhost:7777/memory to view it in the browser.
- Turn it off with `[memory] enabled = false`.

## Gary's extra features (features.py, settings in features.toml)

Say these on mic (with his name) or type them in the control page:

| Say | What happens |
|---|---|
| "Gary, robot voice me" / "helium voice" / "random voice" / "normal voice" | Runs the matching Streamer.bot voice-effect action. Now and then (20+ min apart, only while you're talking) he does one on his own. |
| "Gary, clip that" | Runs the Sidekick action with "clip" in its name and saves the moment for the recap. |
| "Gary, start a poll: pizza or tacos" / "Gary, start a poll about snacks" | Chat poll. With no options he makes them up. Chat votes by typing the number. "Gary, end the poll" closes it early. |
| "Gary, trivia time" / "Gary, let's do trivia about Mario, 5 questions" | Multiple choice trivia, chat answers A/B/C/D. Right answers earn points (fastest gets 2). |
| "Gary, start a prediction: will I beat this boss" | Chat picks 1/2 (Yes/No unless you say "X or Y"). Locks after 2 min. Then "Gary, the answer is yes". |
| "Gary, the marble race is starting" ... "Gary, Kevin won" | Hypes the start, opens `!pick <name>` predictions, glances at the race mid-way (vision), calls the winner with all-time stats. |
| "Gary, who's winning" | Reads the points leaderboard. |
| "Gary, look at this" | Takes a screenshot of the stream (through OBS) and reacts to it. |
| "Gary, hold that thought" / "Gary, stop" | Stops him mid-line (works while he's talking). "Gary, go ahead" finishes the line. |
| "Gary, stop talking for 15 minutes" / "Gary, be quiet" | Mutes him for that long, or until "Gary, you can talk again" (or you talk to him by name). He ignores chat while muted but still thanks follows, subs, bits and raids. |
| "Gary, go away for 10 minutes" | Same, but he stays on screen napping, DJing, gaming... until the time is up. |
| "Gary, stay at the bottom" / "stay put on the left" / "free roam" / "wander around" | Moves the 3D Gary: parked (bottom = front of the stage), pacing, or roaming. He remembers it after a restart. |
| "Gary, put me on acid" / "make me drunk" | Runs other Sidekick-group actions whose names start with FX (see [effects] in features.toml). |
| "Gary, recap the stream" | End-of-stream recap out loud, also saved in `recaps\YYYY-MM-DD.txt`. |

He also does these on his own:
- **Greets people** the first time they chat each day: regulars get a callback to something he remembers, first-timers a quick welcome, and the first chatter of the day a shoutout. At most one greeting every 40 s; people who arrive together get one line.
- **Raids, subs, gift subs, cheers, follows** come straight from Streamer.bot (nothing to set up). Raids get the raider's history and size-matched hype, and if a Sidekick action has "shout" in its name he runs it for the raider.
- **3D Gary reacts to events:** raids, subs, bits, follows and channel point redemptions also play a big animation on the 3D overlay. Chat spamming hype emotes (6 messages from 4+ people in 10 seconds) sets off a hype party, and a wave of F's sets off a "rip". You can do it yourself with "Gary, hype it up" or "Gary, rip" / "press F". Test any of them with `http://localhost:7777/api/do?name=raid&who=Bob&n=50` (names: raid, sub, bits, follow, hype, rip, redeem).
- **Stream modes:** the OBS scene name sets Gary's mode on the 3D overlay (starting, brb, chatting, gaming, marble, chill, party, ending, else normal). Change the name patterns under `[scene_modes]` in features.toml.
- **Green screen roles:** when OBS switches to a scene with "news" or "weather" in its name, he opens the segment as the DUMSTREAM News co-anchor or the Doppler 9000 weatherman, and stays in character until you switch away. Add more under `[roles]`.
- **Screen glances:** every 4 minutes he looks at the stream (needs a model in LM Studio that can see images, plus OBS's WebSocket server, which Streamer.bot already uses). Mostly it's just context; sometimes he comments.

**Games overlay:** add an OBS Browser Source `http://localhost:7777/games` (600 x 520) for poll bars, trivia questions, predictions and race winners. Buttons for everything: `http://localhost:7777/games/control`.

**Streamer.bot setup:** move the voice-effect actions (ROBOT/HELIUM/DEEP/ECHO/ALIEN VOICE) and a Clip action into the `Sidekick` group. Gary posts poll/trivia text in chat as `[Gary] ...` from your account.
Marble games can also tell him directly: `http://localhost:7777/api/race?state=start` and `/api/race?state=end&winner=NAME&last=NAME`.
Stats (visits, points, race wins) live in `features_data.json`.

## Personality and tuning

Everything is in `config.toml`: the name, personality (`persona`), how chatty it is, which chat bots to ignore, and the voice. Restart `start.bat` after editing.

Not using Streamer.bot? Set `[chat] source = "twitch"` and `twitch_channel = "yourname"` to read Twitch chat directly. Actions won't work without Streamer.bot.

## Troubleshooting

| Problem | Fix |
|---|---|
| Control page says LM Studio is red | Start the server in LM Studio's Developer tab, then press Refresh |
| Replies are slow | Use a smaller model or quant, keep `no_think = true`, lower `max_tokens` |
| No sound on stream | Tick *Control audio via OBS* on the browser source and check the mixer |
| Testing in Chrome and there's no sound | Click the page once (browsers block autoplay; OBS doesn't) |
| "Actions: none in group" | The group must be named exactly `Sidekick` and the actions must be enabled. Press Refresh |
| Chat isn't showing up | Check Streamer.bot is connected to Twitch/YouTube and the WebSocket Server is started |
