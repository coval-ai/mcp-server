"""Behavioral checks for the conservative full-CI gate."""

import itertools
import os
import subprocess
import unittest
from pathlib import Path

import yaml


class CiGateTests(unittest.TestCase):
    def setUp(self):
        workflow = Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml"
        self.workflow = yaml.load(workflow.read_text(), Loader=yaml.BaseLoader)

    def test_merge_groups_run_the_existing_ci_jobs(self):
        events = self.workflow["on"]
        self.assertIn("pull_request", events)
        self.assertIn("push", events)
        self.assertEqual(events.get("merge_group"), {"types": ["checks_requested"]})
        for name in ("verify", "api-parity"):
            self.assertNotIn("if", self.workflow["jobs"][name])

    def test_gate_requires_both_actual_ci_jobs_even_after_failure(self):
        gate = self.workflow["jobs"].get("switchboard_gate", {})
        self.assertEqual(gate.get("name"), "Switchboard Gate")
        self.assertEqual(gate.get("needs"), ["verify", "api-parity"])
        self.assertEqual(gate.get("if"), "always()")
        step = gate.get("steps", [{}])[0]
        self.assertEqual(
            step.get("env", {}).get("VERIFY_RESULT"), "${{ needs.verify.result }}"
        )
        self.assertEqual(
            step.get("env", {}).get("API_PARITY_RESULT"),
            "${{ needs.api-parity.result }}",
        )

    def test_actual_gate_script_accepts_only_two_successful_jobs(self):
        gate = self.workflow["jobs"].get("switchboard_gate", {})
        script = gate.get("steps", [{}])[0].get("run", "")
        self.assertTrue(script)
        statuses = ("success", "failure", "cancelled", "skipped", "", "unknown", None)
        for verify, parity in itertools.product(statuses, repeat=2):
            with self.subTest(verify=verify, parity=parity):
                environment = {
                    "PATH": os.environ["PATH"],
                    "GITHUB_STEP_SUMMARY": os.devnull,
                }
                for key, value in (
                    ("VERIFY_RESULT", verify),
                    ("API_PARITY_RESULT", parity),
                ):
                    if value is not None:
                        environment[key] = value
                result = subprocess.run(
                    ["bash", "-e", "-c", script],
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode == 0, verify == parity == "success")


if __name__ == "__main__":
    unittest.main()
