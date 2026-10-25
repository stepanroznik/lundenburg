# Pi Wi-Fi recovery

The Pi uses NetworkManager. Its saved Wi-Fi profile enables autoconnect with
unlimited retries and disables Wi-Fi power saving. A separate systemd watchdog
recovers connections that remain disconnected despite those settings.

Install from the Pi checkout:

```sh
sudo sh scripts/install-wifi-recovery.sh
```

The installer remembers the currently connected Wi-Fi profile UUID. For a
different interface or when already offline, supply `WIFI_INTERFACE` and
`WIFI_PROFILE_UUID` to the installer. It stores no Wi-Fi passwords; NetworkManager
continues to use its existing credentials. It copies the maintained script to a
root-owned system directory so that later checkout changes cannot change the
running recovery code. Existing files owned by this installer are backed up in
`/var/backups/lkp-wifi-recovery/` before replacement.

`lkp-wifi-recovery.timer` checks two minutes after boot and every minute after
each check finishes. On the first disconnected check it gives NetworkManager
another interval. Starting with the second consecutive failure it explicitly
activates the last connected saved profile. Every fifth consecutive failed check
also cycles the Wi-Fi radio. It starts NetworkManager if stopped, and restarts
it after three consecutive checks where its control interface is unresponsive.
Activation commands have bounded timeouts; failures retry on the next tick.

A healthy connection is left running. The watchdog checks NetworkManager's
device state, so it works without an internet connection and does not reset
Wi-Fi merely because an external site or the router's internet uplink is down.
It does not detect every failure where Wi-Fi still reports connected, and cannot
recover a hung kernel or physically failed adapter. It does not reboot the Pi.

To intentionally leave Wi-Fi disconnected, stop the timer first:

```sh
sudo systemctl stop lkp-wifi-recovery.timer
```

Inspect without changing the connection:

```sh
python3 scripts/wifi-recovery.py --check
systemctl status lkp-wifi-recovery.timer lkp-wifi-recovery.service
journalctl -u lkp-wifi-recovery.service -n 30
```

State and the last connected profile UUID are kept under
`/var/lib/lkp-wifi-recovery/`. Logs contain recovery actions, not SSIDs,
passwords, or raw NetworkManager command output. Tests simulate connection
failures without disconnecting the Pi:

```sh
python3 -m unittest discover -s test -p 'test_wifi_recovery.py'
```
