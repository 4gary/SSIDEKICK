"""Tiny OBS WebSocket (v5, built into OBS 28+) client: scene changes and screenshots of what's on stream.

The password is read from features.toml, or else straight from OBS's own settings file, so usually
there's nothing to set up.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import uuid

import aiohttp

log = logging.getLogger("obs")


def obs_saved_settings():
    """OBS keeps its WebSocket settings in %APPDATA%. Returns (port, password) or (None, None)."""
    path = os.path.join(os.environ.get("APPDATA", ""), "obs-studio", "plugin_config", "obs-websocket", "config.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        pw = data.get("server_password", "") if data.get("auth_required", True) else ""
        return data.get("server_port"), pw
    except Exception:
        return None, None


class OBS:
    def __init__(self, cfg, session: aiohttp.ClientSession):
        self.cfg = cfg
        self.session = session
        self.ws = None
        self.connected = False
        self.scene = ""
        self.pending = {}
        self.on_scene = None
        self._tasks = set()   # strong refs to scene-change tasks until they finish

    async def run(self, on_scene=None):
        self.on_scene = on_scene
        port, saved_pw = obs_saved_settings()
        url = self.cfg.get("url") or f"ws://127.0.0.1:{port or 4455}"
        password = self.cfg.get("password") or saved_pw or ""
        warned = False
        while True:
            try:
                async with self.session.ws_connect(url, heartbeat=20) as ws:
                    self.ws = ws
                    await self._identify(password)
                    self.connected, warned = True, False
                    log.info("Connected to OBS (%s)", url)
                    reader = asyncio.create_task(self._reader())
                    try:
                        res = await self.request("GetCurrentProgramScene")
                        await self._scene(res.get("currentProgramSceneName") or res.get("sceneName") or "")
                    except Exception:
                        pass
                    await reader
            except Exception as e:
                if not warned:
                    log.warning("OBS WebSocket not connected (%s). In OBS: Tools -> WebSocket Server Settings -> "
                                "Enable. Retrying quietly...", e)
                    warned = True
            self.connected, self.ws = False, None
            for fut in self.pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("OBS disconnected"))
            self.pending.clear()
            await asyncio.sleep(10)

    async def _identify(self, password):
        hello = (await self.ws.receive_json(timeout=5)).get("d", {})
        ident = {"rpcVersion": 1, "eventSubscriptions": 4}   # 4 = scene events
        auth = hello.get("authentication")
        if auth:
            if not password:
                raise RuntimeError("OBS wants a password; put it in features.toml [obs] password")
            secret = base64.b64encode(hashlib.sha256((password + auth["salt"]).encode()).digest()).decode()
            ident["authentication"] = base64.b64encode(
                hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()
        await self.ws.send_json({"op": 1, "d": ident})
        msg = await self.ws.receive(timeout=5)
        if msg.type != aiohttp.WSMsgType.TEXT or json.loads(msg.data).get("op") != 2:
            raise RuntimeError("OBS refused the login (wrong password?)")

    async def _reader(self):
        async for m in self.ws:
            if m.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(m.data)   # one bad frame must not drop the whole OBS connection
            except ValueError as e:
                log.warning("Skipped a bad frame from OBS: %s", e)
                continue
            op, d = data.get("op"), data.get("d", {})
            if op == 7:
                fut = self.pending.pop(d.get("requestId"), None)
                if fut and not fut.done():
                    status = d.get("requestStatus", {})
                    if status.get("result"):
                        fut.set_result(d.get("responseData") or {})
                    else:
                        fut.set_exception(RuntimeError(status.get("comment") or f"OBS error {status.get('code')}"))
            elif op == 5 and d.get("eventType") == "CurrentProgramSceneChanged":
                # as a task: the scene handler talks to Streamer.bot and the overlays, which must not hold up OBS replies
                t = asyncio.create_task(self._scene_safe(d.get("eventData", {}).get("sceneName", "")))
                self._tasks.add(t)
                t.add_done_callback(self._tasks.discard)

    async def _scene_safe(self, name):
        try:
            await self._scene(name)
        except Exception as e:
            log.warning("Couldn't handle OBS scene change to %s: %s", name, e)

    async def _scene(self, name):
        if name and name != self.scene:
            self.scene = name
            if self.on_scene:
                await self.on_scene(name)

    async def request(self, rtype, data=None, timeout=10):
        if not self.ws:
            raise RuntimeError("OBS is not connected")
        rid = uuid.uuid4().hex
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        await self.ws.send_json({"op": 6, "d": {"requestType": rtype, "requestId": rid, "requestData": data or {}}})
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            self.pending.pop(rid, None)

    # windows that are never stream content: Gary must not look at these even if they're in a scene
    PRIVATE_WINDOWS = re.compile(r"explorer|chrome|firefox|msedge|opera|brave|discord|notepad|code\.exe|cmd\.exe|"
                                 r"powershell|windowsterminal|lm studio|streamer\.bot|obs64|telegram|whatsapp|"
                                 r"outlook|thunderbird|steam\.exe|settings|sidekick|python|zoom|teams|slack|spotify|"
                                 r"signal|1password|bitwarden|keepass|lastpass|mail|messenger|skype|facetime", re.I)

    async def private_capture(self, scene=None, depth=0, group=False):
        """The name of a live (visible) source in the program scene that shows the desktop or a private window, or
        None. 2026-10-27: Gary only looks at the screen when it's showing stream content, never dum's desktop."""
        if depth > 3:
            return None
        if scene is None:
            if not self.scene:
                res = await self.request("GetCurrentProgramScene")
                self.scene = res.get("currentProgramSceneName") or res.get("sceneName") or ""
            scene = self.scene
        res = await self.request("GetGroupSceneItemList" if group else "GetSceneItemList", {"sceneName": scene})
        for item in res.get("sceneItems", []):
            if not item.get("sceneItemEnabled", True):
                continue
            kind, name = item.get("inputKind") or "", item.get("sourceName") or ""
            if kind in ("monitor_capture", "display_capture", "xshm_input", "screen_capture"):
                return name
            if kind == "window_capture":
                try:
                    st = (await self.request("GetInputSettings", {"inputName": name})).get("inputSettings", {})
                except Exception:
                    return name     # can't tell what window it is: play it safe
                if self.PRIVATE_WINDOWS.search(str(st.get("window", ""))):
                    return name
            if item.get("isGroup"):
                try:
                    found = await self.private_capture(name, depth + 1, group=True)
                except Exception:
                    return name     # can't see inside the group: play it safe
                if found:
                    return found
            elif item.get("sourceType") == "OBS_SOURCE_TYPE_SCENE":
                found = await self.private_capture(name, depth + 1)
                if found:
                    return found
        return None

    async def screenshot(self, width=960):
        """JPEG of what's live on stream right now, as a data: URL."""
        if not self.scene:
            res = await self.request("GetCurrentProgramScene")
            self.scene = res.get("currentProgramSceneName") or res.get("sceneName") or ""
        res = await self.request("GetSourceScreenshot", {
            "sourceName": self.scene, "imageFormat": "jpg", "imageWidth": width, "imageCompressionQuality": 70})
        img = res.get("imageData", "")
        if not img.startswith("data:"):
            img = "data:image/jpeg;base64," + img
        return img
