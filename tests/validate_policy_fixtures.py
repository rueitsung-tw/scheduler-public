"""Validate policy acceptance fixtures for repair_02 / task_06.

Cross-platform: works on Windows PowerShell and bash.
No pytest dependency required.

Usage:
    python tests/validate_policy_fixtures.py --check-inputs
    python tests/validate_policy_fixtures.py --check-outputs
"""
import argparse
import json
import os
import sys


FIXTURES = [
    "strict_feasible_real",
    "strict_infeasible_fallback",
    "teacher_overtime",
    "alternating_exact_two",
    "alternating_odd_group",
    "co_planning",
    "grade12_tuesday_life",
    "daily_subject_teacher_minimum",
    "priority_scheduling",
    "repair_rejection",
]

# repair_rejection is handled by repair_agent, not solver.py directly
OUTPUTS = [f for f in FIXTURES if f != "repair_rejection"]

REQUIRED_OUTPUT_KEYS = [
    "status",
    "solvePass",
    "degraded",
    "degradationReasons",
    "penaltyBreakdown",
]


def _repo_root() -> str:
    """Walk up from this script to find the repo root (where fixtures/ lives)."""
    here = os.path.dirname(os.path.abspath(__file__))
    # tests/ is inside repo root
    root = os.path.dirname(here)
    if os.path.isdir(os.path.join(root, "fixtures")):
        return root
    # Fallback: assume current working directory
    return os.getcwd()


def check_inputs():
    """Check that all 10 fixture JSONs exist, are parseable, and have expected MD."""
    root = _repo_root()
    errors = []

    for name in FIXTURES:
        json_path = os.path.join(root, "fixtures", f"{name}.json")
        md_path = os.path.join(root, "fixtures", "expected", f"{name}.md")

        # Check JSON exists
        if not os.path.isfile(json_path):
            errors.append(f"MISSING fixture: fixtures/{name}.json")
            continue

        # Check JSON is parseable
        try:
            with open(json_path, encoding="utf-8") as f:
                json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"INVALID JSON fixtures/{name}.json: {e}")
        except OSError as e:
            errors.append(f"CANNOT READ fixtures/{name}.json: {e}")

        # Check expected MD exists
        if not os.path.isfile(md_path):
            errors.append(f"MISSING expected: fixtures/expected/{name}.md")

    return errors


def check_outputs():
    """Check that 9 solver output JSONs exist with required keys."""
    root = _repo_root()
    errors = []

    for name in OUTPUTS:
        out_path = os.path.join(root, "fixtures", f"output_{name}.json")

        if not os.path.isfile(out_path):
            errors.append(f"MISSING output: fixtures/output_{name}.json")
            continue

        try:
            with open(out_path, encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"INVALID JSON fixtures/output_{name}.json: {e}")
            continue
        except OSError as e:
            errors.append(f"CANNOT READ fixtures/output_{name}.json: {e}")
            continue

        for key in REQUIRED_OUTPUT_KEYS:
            if key not in data:
                errors.append(
                    f"fixtures/output_{name}.json: missing required key '{key}'"
                )

    return errors


def main():
    parser = argparse.ArgumentParser(
        description="Validate policy acceptance fixtures (task_06 / repair_02)"
    )
    parser.add_argument(
        "--check-inputs",
        action="store_true",
        help="Verify 10 fixture JSONs exist, are parseable, and have expected MD files",
    )
    parser.add_argument(
        "--check-outputs",
        action="store_true",
        help="Verify 9 solver output JSONs exist with required metadata keys",
    )
    args = parser.parse_args()

    if not args.check_inputs and not args.check_outputs:
        parser.print_help()
        sys.exit(1)

    all_errors = []

    if args.check_inputs:
        all_errors.extend(check_inputs())

    if args.check_outputs:
        all_errors.extend(check_outputs())

    if all_errors:
        print("ERRORS:")
        for e in all_errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        checks = []
        if args.check_inputs:
            checks.append("inputs")
        if args.check_outputs:
            checks.append("outputs")
        print(f"OK: all {' + '.join(checks)} checks passed.")


if __name__ == "__main__":
    main()
