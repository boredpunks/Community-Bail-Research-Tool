"""Exercise the built worker in a fresh interpreter; never contact the court."""
import subprocess
import sys
import unittest
from pathlib import Path


class PackagedCourtroomWorkerTests(unittest.TestCase):
    def test_packaged_worker_observation_and_missing_plugin_stop(self):
        root = Path(__file__).resolve().parents[1]
        script = r"""
import sys, unittest
from pathlib import Path
root = Path.cwd()
dist = root / "dist" / "ujs"
sys.path.insert(0, str(dist))
import worker, courtroom_observation, calendar_protocol, calendar_diagnostics, room_discovery
for module in (worker, courtroom_observation, calendar_protocol, calendar_diagnostics, room_discovery):
    assert Path(module.__file__).parent == dist, "Test must use packaged modules"
assert calendar_diagnostics.CalendarLifecycle().state == "BEFORE_POST_ATTEMPT"
assert courtroom_observation.METHOD == "playwright-public-courtroom-observation-v2"
sys.path.insert(0, str(root / "tests"))
names = [
    "test_public_room_label_discovers_unpredicted_named_binding_without_post",
    "test_public_room_label_waits_for_replaced_unnamed_widget_binding",
    "test_room_absent_is_observed_nonexposure_not_no_filter_permission",
    "test_room_disabled_dependency_is_not_forced_or_substituted",
    "test_room_506_unavailable_is_not_another_room",
    "test_room_ambiguous_backing_does_not_claim_binding",
    "test_room_observation_dependency_fetch_never_transmits",
    "test_missing_courtroom_plugin_stops_before_browser_or_network",
]
suite = unittest.defaultTestLoader.loadTestsFromNames(
    ["test_form_inspection.InspectionWorkerTests." + name for name in names])
result = unittest.TextTestRunner(verbosity=0).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=root,
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
