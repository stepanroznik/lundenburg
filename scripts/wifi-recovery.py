#!/usr/bin/env python3
"""Recover an unattended Pi's saved Wi-Fi connection through NetworkManager."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time


UUID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


class Commands:
    def run(self, *args, wait=15):
        try:
            result = subprocess.run(
                args, capture_output=True, text=True, timeout=wait,
                env={**os.environ, "LC_ALL": "C"},
            )
            return result.stdout.strip() if result.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None

    def nm(self, *args, wait=15):
        return self.run("/usr/bin/nmcli", "--wait", str(wait), *args, wait=wait + 5)

    def pause(self):
        time.sleep(3)


def device_state(commands, interface):
    value = commands.nm("-g", "GENERAL.STATE", "device", "show", interface)
    if value is None:
        return None
    match = re.match(r"^(\d+)", value)
    return int(match[1]) if match else None


def recover(commands, state, interface, profile, *, check=False, log=print):
    """One bounded check; raw command output and network identifiers stay private."""
    status = device_state(commands, interface)
    if check:
        log(f"Wi-Fi device state: {status if status is not None else 'unavailable'}")
        return status == 100
    if status == 100:
        if state.get("failures", 0):
            log("Wi-Fi connection recovered.")
        state["failures"] = 0
        active = commands.nm("-g", "GENERAL.CON-UUID", "device", "show", interface)
        if active and UUID.fullmatch(active):
            state["profile"] = active
        return True

    failures = min(int(state.get("failures", 0)) + 1, 1000000)
    state["failures"] = failures
    if failures < 2:
        log("Wi-Fi is disconnected; allowing another interval for normal reconnection.")
        return False

    # If NetworkManager itself stopped, restore it before trying nmcli again.
    active = commands.run("/usr/bin/systemctl", "is-active", "NetworkManager.service")
    if active != "active":
        log("Starting NetworkManager after sustained Wi-Fi loss.")
        commands.run("/usr/bin/systemctl", "start", "NetworkManager.service", wait=35)
    elif status is None and failures >= 3 and failures % 3 == 0:
        log("Restarting unresponsive NetworkManager after repeated failed checks.")
        commands.run("/usr/bin/systemctl", "restart", "NetworkManager.service", wait=35)

    # Recheck: normal activation might have finished since the first observation.
    if device_state(commands, interface) == 100:
        state["failures"] = 0
        log("Wi-Fi connection recovered before intervention.")
        return True

    if failures >= 5 and failures % 5 == 0:
        log("Cycling the Wi-Fi radio after sustained reconnection failures.")
        # Always attempt 'on', even if the off command or pause fails.
        try:
            commands.nm("radio", "wifi", "off")
            commands.pause()
        finally:
            commands.nm("radio", "wifi", "on")
    else:
        commands.nm("radio", "wifi", "on")
    commands.nm("device", "set", interface, "managed", "yes")
    commands.nm("device", "set", interface, "autoconnect", "yes")
    saved = state.get("profile") or profile
    if not saved or not UUID.fullmatch(saved):
        log("No valid saved Wi-Fi profile configured; refusing to create a network.")
        return False
    log("Retrying the saved Wi-Fi connection.")
    commands.nm("connection", "up", "uuid", saved, "ifname", interface, wait=35)
    if device_state(commands, interface) == 100:
        state["failures"] = 0
        log("Wi-Fi connection recovered.")
        return True
    log("Wi-Fi is still unavailable; the timer will retry.")
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Report device state without changes")
    args = parser.parse_args()
    interface = os.environ.get("WIFI_INTERFACE", "wlan0")
    profile = os.environ.get("WIFI_PROFILE_UUID", "")
    if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,15}", interface):
        parser.error("Invalid Wi-Fi interface")
    if profile and not UUID.fullmatch(profile):
        parser.error("Invalid saved profile UUID")
    commands = Commands()
    if args.check:
        return 0 if recover(commands, {}, interface, profile, check=True) else 1
    directory = Path("/var/lib/lkp-wifi-recovery")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        path = directory / "state.json"
        try:
            state = json.loads(path.read_text())
            if not isinstance(state, dict):
                state = {}
            state["failures"] = max(0, int(state.get("failures", 0)))
        except (OSError, ValueError, TypeError):
            state = {}
        recover(commands, state, interface, profile)
        temporary = directory / "state.json.tmp"
        temporary.write_text(json.dumps(state) + "\n")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
