"""
Unit tests for build_reference_templates.py pure helper functions.
Run: cd backend && python -m pytest tests/ -v
Or:  cd backend && python -m unittest tests.test_build_reference_templates -v
"""
import sys
import unittest

# Mock cv2/mediapipe before importing build_reference_templates
class _MockModule:
    def __getattr__(self, name):
        return _MockModule()

sys.modules.setdefault("cv2", _MockModule())
sys.modules.setdefault("mediapipe", _MockModule())
sys.modules.setdefault("mediapipe.python", _MockModule())
sys.modules.setdefault("mediapipe.python.solutions", _MockModule())
sys.modules.setdefault("mediapipe.python.solutions.pose", _MockModule())

import numpy as np

from build_reference_templates import (
    angle,
    torso_angle,
    moving_average,
    resample,
    detect_rep_from_hip_y,
    distance_to_centre,
    aggregate_templates,
    n_samples,
)


# --- angle ---
class TestAngle(unittest.TestCase):
    def test_right_angle(self):
        """Angle at b when a-b-c forms 90 degrees."""
        a, b, c = (0, 0), (0, 1), (1, 1)
        result = angle(a, b, c)
        self.assertAlmostEqual(result, 90.0, places=2)

    def test_straight_line(self):
        """Angle at b when a-b-c are collinear = 180 degrees."""
        a, b, c = (0, 0), (1, 0), (2, 0)
        result = angle(a, b, c)
        self.assertAlmostEqual(result, 180.0, delta=0.01)

    def test_zero_angle(self):
        """Angle at b when a-b-c degenerate (same point) handled safely."""
        a, b, c = (1, 1), (1, 1), (2, 2)
        result = angle(a, b, c)
        self.assertGreaterEqual(result, 0)
        self.assertLessEqual(result, 180)

    def test_acute_angle(self):
        """Acute angle ~60 degrees (equilateral triangle)."""
        a, b, c = (0, 0), (1, 0), (0.5, np.sqrt(3) / 2)
        result = angle(a, b, c)
        self.assertAlmostEqual(result, 60.0, delta=0.5)


# --- torso_angle ---
class TestTorsoAngle(unittest.TestCase):
    def test_upright(self):
        """Vertical torso (hip below shoulder) = 0 degrees."""
        result = torso_angle((0, 100), (0, 0))
        self.assertAlmostEqual(result, 0.0, places=2)

    def test_forward_lean(self):
        """Torso leaning forward gives positive angle."""
        result = torso_angle((0, 100), (20, 50))
        self.assertGreater(result, 0)

    def test_list_input(self):
        """Accepts list or tuple."""
        result = torso_angle([0, 100], [0, 0])
        self.assertAlmostEqual(result, 0.0, places=2)


# --- moving_average ---
class TestMovingAverage(unittest.TestCase):
    def test_identity_short(self):
        """Returns input when len(x) < k."""
        x = [1.0, 2.0]
        result = moving_average(x, k=5)
        np.testing.assert_array_equal(result, x)

    def test_smoothing(self):
        """Smoothing preserves length and produces expected middle value."""
        x = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
        result = moving_average(x, k=3)
        self.assertEqual(len(result), len(x))
        self.assertAlmostEqual(result[5], 6.0, places=2)

    def test_kernel_size_one(self):
        """k=1 effectively returns same values (convolve with [1])."""
        x = np.array([1.0, 2.0, 3.0])
        result = moving_average(x, k=1)
        np.testing.assert_array_almost_equal(result, x)


# --- resample ---
class TestResample(unittest.TestCase):
    def test_empty_trajectory(self):
        """Empty input -> zeros of length n."""
        result = resample([], n=10)
        self.assertEqual(len(result), 10)
        np.testing.assert_array_equal(result, np.zeros(10))

    def test_single_point(self):
        """Single point -> constant array."""
        result = resample([5.0], n=8)
        self.assertEqual(len(result), 8)
        np.testing.assert_array_almost_equal(result, np.full(8, 5.0))

    def test_linear_interp(self):
        """Linear trajectory resamples correctly."""
        traj = [0.0, 10.0]
        result = resample(traj, n=5)
        self.assertEqual(len(result), 5)
        self.assertAlmostEqual(result[0], 0.0, places=2)
        self.assertAlmostEqual(result[-1], 10.0, places=2)
        self.assertAlmostEqual(result[2], 5.0, delta=0.1)

    def test_default_n_samples(self):
        """Uses n_samples when n not provided."""
        result = resample([0.0, 1.0])
        self.assertEqual(len(result), n_samples)


# --- detect_rep_from_hip_y ---
class TestDetectRepFromHipY(unittest.TestCase):
    def test_simple_rep(self):
        """Clear down-up pattern: bottom at max, start/end at minima."""
        hip_y = [100.0] * 5 + list(np.linspace(100, 200, 20)) + [200.0] * 5 + list(np.linspace(200, 100, 15)) + [100.0] * 5
        s, b, e = detect_rep_from_hip_y(hip_y)
        self.assertLess(s, b)
        self.assertLess(b, e)
        self.assertEqual(b, int(np.argmax(moving_average(np.array(hip_y), k=7))))

    def test_monotonic_down(self):
        """Monotonic down: bottom at end, start at beginning."""
        hip_y = list(np.linspace(100, 200, 30))
        s, b, e = detect_rep_from_hip_y(hip_y)
        self.assertGreaterEqual(b, s)
        self.assertGreaterEqual(e, b)

    def test_sanity_end_after_start(self):
        """Sanity check ensures end > start."""
        hip_y = [200.0] * 20
        s, b, e = detect_rep_from_hip_y(hip_y)
        self.assertTrue(e > s or (s == 0 and e == len(hip_y) - 1))


# --- distance_to_centre ---
class TestDistanceToCentre(unittest.TestCase):
    def test_identical(self):
        """Identical template and centre -> 0."""
        centre = {"knee": [10.0, 20.0, 30.0], "hip": [5.0, 10.0, 15.0]}
        template = {"trajectories": centre.copy()}
        self.assertAlmostEqual(distance_to_centre(template, centre), 0.0)

    def test_different_values(self):
        """Different values -> positive MAE."""
        centre = {"knee": [10.0, 20.0, 30.0]}
        template = {"trajectories": {"knee": [12.0, 22.0, 32.0]}}
        self.assertAlmostEqual(distance_to_centre(template, centre), 2.0)

    def test_mismatched_length(self):
        """Uses min length when lengths differ."""
        centre = {"knee": [10.0, 20.0]}
        template = {"trajectories": {"knee": [11.0, 21.0, 31.0]}}
        self.assertAlmostEqual(distance_to_centre(template, centre), 1.0)


# --- aggregate_templates ---
class TestAggregateTemplates(unittest.TestCase):
    def test_empty_returns_none(self):
        """Empty templates -> None."""
        self.assertIsNone(aggregate_templates([]))

    def test_single_template(self):
        """Single template -> centre equals that template."""
        t = {"file": "a.mp4", "trajectories": {"knee": [10.0, 20.0, 30.0], "hip": [5.0, 10.0, 15.0]}}
        result = aggregate_templates([t])
        self.assertIsNotNone(result)
        self.assertEqual(result["centre"]["knee"], [10.0, 20.0, 30.0])
        self.assertEqual(result["kept"], ["a.mp4"])
        self.assertEqual(result["dropped"], [])

    def test_multiple_templates_median(self):
        """Multiple templates -> median centre."""
        templates = [
            {"file": "a.mp4", "trajectories": {"knee": [10.0, 20.0], "hip": [5.0, 10.0]}},
            {"file": "b.mp4", "trajectories": {"knee": [12.0, 22.0], "hip": [7.0, 12.0]}},
            {"file": "c.mp4", "trajectories": {"knee": [14.0, 24.0], "hip": [9.0, 14.0]}},
        ]
        result = aggregate_templates(templates, drop_worst_pct=0.0, use_median=True)
        self.assertEqual(result["centre"]["knee"], [12.0, 22.0])
        self.assertEqual(result["centre"]["hip"], [7.0, 12.0])

    def test_drop_worst(self):
        """drop_worst_pct removes outliers."""
        templates = [
            {"file": "a.mp4", "trajectories": {"knee": [10.0, 20.0], "hip": [5.0, 10.0]}},
            {"file": "b.mp4", "trajectories": {"knee": [11.0, 21.0], "hip": [6.0, 11.0]}},
            {"file": "c.mp4", "trajectories": {"knee": [12.0, 22.0], "hip": [7.0, 12.0]}},
            {"file": "d.mp4", "trajectories": {"knee": [13.0, 23.0], "hip": [8.0, 13.0]}},
            {"file": "e.mp4", "trajectories": {"knee": [100.0, 200.0], "hip": [50.0, 100.0]}},
        ]
        result = aggregate_templates(templates, drop_worst_pct=0.2, use_median=True)
        self.assertIn("e.mp4", result["dropped"])
        self.assertNotIn("e.mp4", result["kept"])

    def test_few_templates_no_drop(self):
        """With < 5 templates, drop_worst_pct is ignored."""
        templates = [
            {"file": "a.mp4", "trajectories": {"knee": [10.0], "hip": [5.0]}},
            {"file": "b.mp4", "trajectories": {"knee": [20.0], "hip": [10.0]}},
        ]
        result = aggregate_templates(templates, drop_worst_pct=0.5, use_median=True)
        self.assertEqual(len(result["kept"]), 2)
        self.assertEqual(result["dropped"], [])

    def test_use_mean(self):
        """use_median=False uses mean and std."""
        templates = [
            {"file": "a.mp4", "trajectories": {"knee": [10.0, 20.0], "hip": [5.0, 10.0]}},
            {"file": "b.mp4", "trajectories": {"knee": [12.0, 22.0], "hip": [7.0, 12.0]}},
        ]
        result = aggregate_templates(templates, drop_worst_pct=0.0, use_median=False)
        self.assertEqual(result["spread_type"], "std")
        self.assertEqual(result["centre"]["knee"], [11.0, 21.0])


if __name__ == "__main__":
    unittest.main()
