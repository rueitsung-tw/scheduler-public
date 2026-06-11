"""
tests/test_terminal_sanitizer.py

回歸測試：terminal_sanitizer 必須能在 Windows / Python 3.12+ 正常 import，
且多字元 emoji 序列不能再次讓 str.maketrans() 在模組載入時拋出 ValueError。
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import terminal_sanitizer


def test_sanitize_text_replaces_multi_codepoint_emojis():
    text = "⚠️ ✅ ❌ 🔍 🚀 🛠️"

    sanitized = terminal_sanitizer.sanitize_text(text)

    assert "[WARN]" in sanitized
    assert "[OK]" in sanitized
    assert "[ERROR]" in sanitized
    assert "[DEBUG]" in sanitized
    assert "[INFO]" in sanitized
    assert "⚠️" not in sanitized
    assert "🛠️" not in sanitized
