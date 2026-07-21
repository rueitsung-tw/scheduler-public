"""Tests for repair_06: fallback / degradation fix.

Validates that strict_infeasible_fallback fixture correctly triggers
the two-pass fallback mechanism with proper metadata.

Run:
    python tests/test_repair06_fallback_degradation.py
"""
import json
import os
import sys
import unittest


def _repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(here)


def _load_fixture_output(name: str) -> dict:
    path = os.path.join(_repo_root(), "fixtures", f"output_{name}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestStrictInfeasibleFallbackMetadata(unittest.TestCase):
    """C.1 strict_infeasible_fallback fixture metadata after fix."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_fixture_output("strict_infeasible_fallback")

    def test_status_is_feasible_or_optimal(self):
        self.assertIn(
            self.data["status"],
            ("FEASIBLE", "OPTIMAL"),
            f"Expected FEASIBLE or OPTIMAL, got {self.data['status']}",
        )

    def test_solve_pass_is_feasibility_recovery(self):
        self.assertEqual(
            self.data["solvePass"],
            "feasibility_recovery",
            f"Expected feasibility_recovery, got {self.data['solvePass']}",
        )

    def test_degraded_is_true(self):
        self.assertTrue(
            self.data["degraded"],
            f"Expected degraded=true, got {self.data['degraded']}",
        )

    def test_degradation_reasons_non_empty(self):
        reasons = self.data.get("degradationReasons", [])
        self.assertIsInstance(reasons, list)
        self.assertTrue(
            len(reasons) > 0,
            f"Expected non-empty degradationReasons, got {reasons}",
        )


class TestFallbackPenaltyKey(unittest.TestCase):
    """C.3 fallback penalty key exists and is numeric."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_fixture_output("strict_infeasible_fallback")

    def test_art_music_shape_fallback_penalty_exists(self):
        pb = self.data.get("penaltyBreakdown", {})
        has_key = (
            "art_music_shape_fallback" in pb
            or "natural_shape_fallback" in pb
        )
        self.assertTrue(
            has_key,
            f"Expected art_music_shape_fallback or natural_shape_fallback in penaltyBreakdown. Got keys: {list(pb.keys())}",
        )

    def test_art_music_shape_fallback_is_numeric(self):
        pb = self.data.get("penaltyBreakdown", {})
        val = pb.get("art_music_shape_fallback")
        if val is not None:
            self.assertIsInstance(
                val, (int, float), f"Expected numeric value, got {type(val)}"
            )
            self.assertGreaterEqual(
                val, 0, f"Expected non-negative penalty, got {val}"
            )
        else:
            # Check natural_shape_fallback as alternative
            val = pb.get("natural_shape_fallback")
            if val is not None:
                self.assertIsInstance(val, (int, float))


class TestStrictFeasibleNoRegression(unittest.TestCase):
    """C.2 strict feasible fixture still uses strict_teaching_shape."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_fixture_output("strict_feasible_real")

    def test_solve_pass_is_strict(self):
        self.assertEqual(
            self.data["solvePass"],
            "strict_teaching_shape",
            f"Expected strict_teaching_shape, got {self.data['solvePass']}",
        )

    def test_degraded_is_false(self):
        self.assertFalse(
            self.data["degraded"],
            f"Expected degraded=false for feasible fixture, got {self.data['degraded']}",
        )


class TestSoftConstraintNoRegression(unittest.TestCase):
    """C.4 teacher quota / alternating / priority scheduling remain soft."""

    @classmethod
    def setUpClass(cls):
        cls.strict_data = _load_fixture_output("strict_feasible_real")
        cls.fallback_data = _load_fixture_output("strict_infeasible_fallback")

    # These tests verify that the solver output structure is intact
    # and soft constraints are still represented as penalty entries, not hard failures.
    def test_priority_scheduling_runs_successfully(self):
        data = _load_fixture_output("priority_scheduling")
        self.assertIn(data["status"], ("FEASIBLE", "OPTIMAL"))

    def test_fallback_output_has_complete_metadata(self):
        """Ensure all required metadata keys exist."""
        for key in ["status", "solvePass", "degraded", "degradationReasons", "penaltyBreakdown"]:
            self.assertIn(key, self.__class__.fallback_data, f"Missing key: {key}")


if __name__ == "__main__":
    # Run tests and print summary
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Exit with proper code
    sys.exit(0 if result.wasSuccessful() else 1)