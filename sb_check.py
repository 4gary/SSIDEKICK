"""One-off check of what Streamer.bot's WebSocket offers Gary (run on the stream PC).

python sb_check.py [ws://127.0.0.1:8080/] [seconds_to_listen]

Prints: the Hello message, GetEvents (every event source/type this Streamer.bot knows),
the reply to each Subscribe Gary sends, then every non-chat event that arrives while it
listens (fire Streamer.bot's own "Test" for a Follow / Raid in that window).
Read-only: it never runs actions. Nothing is written except to the console.
"""
import asyncio
import json
import sys
import uuid

try:
    import aiohttp
except ImportError:
    sys.exit("needs aiohttp (run with the sidekick venv python)")

URL = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8080/"
LISTEN = int(sys.argv[2]) if len(sys.argv) > 2 else 45
TWITCH = ["Raid", "Sub", "ReSub", "GiftSub", "GiftBomb", "Cheer", "Follow", "RewardRedemption", "ChatMessage"]


async def main():
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect(URL, heartbeat=20) as ws:
            print("connected to", URL)
            pending = {}

            async def request(req, **fields):
                rid = uuid.uuid4().hex
                fut = asyncio.get_running_loop().create_future()
                pending[rid] = fut
                await ws.send_json({"request": req, "id": rid, **fields})
                return await asyncio.wait_for(fut, 10)

            async def reader():
                async for m in ws:
                    if m.type != aiohttp.WSMsgType.TEXT:
                        continue
                    data = m.json()
                    if data.get("request") == "Hello" or "authentication" in data:
                        print("HELLO:", json.dumps(data)[:600])
                        continue
                    if data.get("id") in pending:
                        pending.pop(data["id"]).set_result(data)
                        continue
                    ev = data.get("event") or {}
                    if ev.get("type") == "ChatMessage":
                        print("chat:", (data.get("data") or {}).get("message", {}).get("message", "")[:80])
                        continue
                    print("EVENT", ev.get("source"), ev.get("type"), json.dumps(data.get("data"))[:800])

            rt = asyncio.create_task(reader())
            await asyncio.sleep(1.5)
            try:
                res = await request("GetEvents")
                print("GETEVENTS status:", res.get("status"))
                for src, types in (res.get("events") or {}).items():
                    print("  ", src, ":", ", ".join(types))
            except Exception as e:
                print("GetEvents failed:", e)
            for e in TWITCH:
                try:
                    res = await request("Subscribe", events={"Twitch": [e]})
                    print(f"SUBSCRIBE Twitch.{e}: status={res.get('status')} {res.get('error', '')} ->", json.dumps(res.get("events"))[:200])
                except Exception as ex:
                    print(f"SUBSCRIBE Twitch.{e} failed: {ex}")
            try:
                res = await request("GetInfo")
                print("INFO:", json.dumps(res.get("info"))[:400])
            except Exception as e:
                print("GetInfo failed:", e)
            print(f"listening {LISTEN}s for events (fire a Test follow/raid in Streamer.bot now)...")
            await asyncio.sleep(LISTEN)
            rt.cancel()


asyncio.run(main())
