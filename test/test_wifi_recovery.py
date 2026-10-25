import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "wifi_recovery", Path(__file__).resolve().parents[1] / "scripts/wifi-recovery.py"
)
wifi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wifi)
PROFILE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OTHER_PROFILE = "11111111-2222-3333-4444-555555555555"


class FakeCommands:
    def __init__(self, states, manager="active", profile=PROFILE):
        self.states = list(states)
        self.manager = manager
        self.profile = profile
        self.calls = []

    def nm(self, *args, wait=15):
        self.calls.append(args)
        if args[:2] == ("-g", "GENERAL.STATE"):
            state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
            return str(state) if state is not None else None
        if args[:2] == ("-g", "GENERAL.CON-UUID"):
            return self.profile
        return ""

    def run(self, *args, wait=15):
        self.calls.append(args)
        return self.manager if args[1] == "is-active" else ""

    def pause(self):
        self.calls.append(("pause",))


class RecoveryTest(unittest.TestCase):
    def recover(self, commands, state, **options):
        return wifi.recover(commands, state, "wlan0", PROFILE, log=lambda _: None, **options)

    def test_healthy_connection_is_never_disrupted(self):
        commands = FakeCommands([100])
        state = {"failures": 5}
        self.assertTrue(self.recover(commands, state))
        self.assertEqual(state, {"failures": 0, "profile": PROFILE})
        self.assertTrue(all(call[0] == "-g" for call in commands.calls))

    def test_first_failure_allows_native_recovery(self):
        commands = FakeCommands([30])
        state = {}
        self.assertFalse(self.recover(commands, state))
        self.assertEqual(state["failures"], 1)
        self.assertEqual(len(commands.calls), 1)

    def test_repeated_failure_reactivates_only_existing_profile(self):
        commands = FakeCommands([30, 30, 100])
        state = {"failures": 1}
        self.assertTrue(self.recover(commands, state))
        self.assertIn(("connection", "up", "uuid", PROFILE, "ifname", "wlan0"), commands.calls)
        self.assertNotIn(("radio", "wifi", "off"), commands.calls)
        self.assertEqual(state["failures"], 0)

    def test_stalled_activation_eventually_cycles_radio_and_retries(self):
        commands = FakeCommands([60])
        state = {"failures": 4}
        self.assertFalse(self.recover(commands, state))
        off = commands.calls.index(("radio", "wifi", "off"))
        on = commands.calls.index(("radio", "wifi", "on"))
        self.assertGreater(on, off)
        self.assertEqual(state["failures"], 5)

    def test_native_recovery_race_avoids_radio_cycle(self):
        commands = FakeCommands([30, 100])
        state = {"failures": 4}
        self.assertTrue(self.recover(commands, state))
        self.assertNotIn(("radio", "wifi", "off"), commands.calls)

    def test_radio_on_is_attempted_even_when_pause_fails(self):
        commands = FakeCommands([30])
        def fail():
            raise RuntimeError("simulated pause failure")
        commands.pause = fail
        with self.assertRaises(RuntimeError):
            self.recover(commands, {"failures": 4})
        self.assertIn(("radio", "wifi", "on"), commands.calls)

    def test_unresponsive_networkmanager_is_restarted_after_grace(self):
        commands = FakeCommands([None])
        self.recover(commands, {"failures": 2})
        self.assertIn(("/usr/bin/systemctl", "restart", "NetworkManager.service"), commands.calls)

    def test_stopped_networkmanager_is_started(self):
        commands = FakeCommands([None], manager="inactive")
        self.recover(commands, {"failures": 1})
        self.assertIn(("/usr/bin/systemctl", "start", "NetworkManager.service"), commands.calls)

    def test_remembers_last_connected_profile(self):
        commands = FakeCommands([100], profile=OTHER_PROFILE)
        state = {}
        self.recover(commands, state)
        commands = FakeCommands([30])
        state["failures"] = 1
        self.recover(commands, state)
        self.assertIn(("connection", "up", "uuid", OTHER_PROFILE, "ifname", "wlan0"), commands.calls)

    def test_check_mode_does_not_change_connection_or_state(self):
        for status in [100, 30, None]:
            commands = FakeCommands([status])
            state = {"failures": 4}
            self.assertEqual(self.recover(commands, state, check=True), status == 100)
            self.assertEqual(state, {"failures": 4})
            self.assertEqual(len(commands.calls), 1)

    def test_recovery_does_not_create_profiles_or_log_command_output(self):
        commands = FakeCommands([30])
        state = {"failures": 1, "profile": "invalid"}
        messages = []
        self.assertFalse(wifi.recover(commands, state, "wlan0", PROFILE, log=messages.append))
        self.assertFalse(any(call[0] == "connection" for call in commands.calls))
        self.assertFalse(any(PROFILE in message for message in messages))


if __name__ == "__main__":
    unittest.main()
