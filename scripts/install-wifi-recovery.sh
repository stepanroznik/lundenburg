#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this installer with sudo.' >&2
    exit 1
fi
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
interface=${WIFI_INTERFACE:-wlan0}
profile=${WIFI_PROFILE_UUID:-$(nmcli -g GENERAL.CON-UUID device show "$interface")}
python3 - "$interface" "$profile" <<'PY'
import re,sys,uuid
assert re.fullmatch(r'[a-zA-Z0-9_.:-]{1,15}',sys.argv[1]), 'Invalid Wi-Fi interface'
uuid.UUID(sys.argv[2])
PY

# Save only files this installer owns. NetworkManager keeps the credentials.
backup=/var/backups/lkp-wifi-recovery/$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$backup"
for file in /usr/local/lib/lkp/wifi-recovery.py /etc/default/lkp-wifi-recovery /etc/systemd/system/lkp-wifi-recovery.service /etc/systemd/system/lkp-wifi-recovery.timer; do
    if [ -f "$file" ]; then
        cp -p "$file" "$backup/$(basename "$file")"
    fi
done
install -d -m 755 /usr/local/lib/lkp
install -m 644 "$repo/scripts/wifi-recovery.py" /usr/local/lib/lkp/wifi-recovery.py
install -m 644 "$repo/deploy/systemd/lkp-wifi-recovery.service" /etc/systemd/system/
install -m 644 "$repo/deploy/systemd/lkp-wifi-recovery.timer" /etc/systemd/system/
printf 'WIFI_INTERFACE=%s\nWIFI_PROFILE_UUID=%s\n' "$interface" "$profile" > /etc/default/lkp-wifi-recovery
chmod 600 /etc/default/lkp-wifi-recovery
nmcli connection modify uuid "$profile" connection.autoconnect yes connection.autoconnect-retries 0 802-11-wireless.powersave 2
systemctl daemon-reload
systemctl enable --now lkp-wifi-recovery.timer
systemctl start lkp-wifi-recovery.service
echo 'Wi-Fi recovery installed. Healthy connections are left running.'
