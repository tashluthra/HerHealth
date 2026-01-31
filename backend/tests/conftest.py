"""
Mock cv2 and mediapipe so tests can import build_reference_templates
without video dependencies. Run before any test module loads.
"""
import sys


class _MockModule:
    def __getattr__(self, name):
        return _MockModule()


for mod in ("cv2", "mediapipe", "mediapipe.python", "mediapipe.python.solutions", "mediapipe.python.solutions.pose"):
    sys.modules.setdefault(mod, _MockModule())
