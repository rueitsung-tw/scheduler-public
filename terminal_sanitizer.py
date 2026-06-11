"""Helpers to keep console and diagnostic text cp950-safe on Windows."""

from __future__ import annotations

import builtins
import sys
from typing import Any

# Force stdout/stderr to UTF-8 encoding on Windows (avoids cp950 UnicodeEncodeError)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass  # Python < 3.7 compatibility
try:
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

# Emoji / symbol → ASCII tag mapping for terminal log sanitization.
# `str.maketrans()` only accepts 1-character keys, so any multi-codepoint
# emoji sequence must be normalized with `replace()` before translation.
_EMOJI_REPLACEMENTS = (
    ("\u26a0\ufe0f", "[WARN]"),     # ⚠️ warning
    ("\U0001f6e0\ufe0f", "[INFO]"), # 🛠️ hammer and wrench
)
_EMOJI_MAP = str.maketrans({
    "\u2705": "[OK]",           # ✅ check mark
    "\u274c": "[ERROR]",        # ❌ cross mark
    "\U0001f50d": "[DEBUG]",    # 🔍 microscope
    "\U0001f680": "[INFO]",     # 🚀 rocket
    "\u23f0": "[TIMEOUT]",      # ⏰ alarm clock
    "\u2795": "",               # ➕ heavy plus sign
    "\u2796": "",               # ➖ heavy minus sign
    "\U0001f4a8": "[ALERT]",    # 💨 doodle cloud
    "\U0001f3af": "[INFO]",     # 🎯 direct hit
    "\U0001f52d": "[FIX]",      # 🔭 telescope
    "\u2728": "",               # ✨ sparkles
})


def sanitize_text(value: Any) -> str:
    """Strip emojis and unsupported symbols while keeping ASCII and CJK text.

    Also replaces known emoji/status symbols with readable ASCII tags
    so Windows cp950 terminals never hit UnicodeEncodeError.
    """
    if not isinstance(value, str):
        value = str(value)

    # First pass: replace known multi-codepoint emoji with ASCII tags.
    for source, target in _EMOJI_REPLACEMENTS:
        value = value.replace(source, target)

    # Second pass: replace single-codepoint emoji with ASCII tags.
    value = value.translate(_EMOJI_MAP)

    kept: list[str] = []
    for ch in value:
        code = ord(ch)
        if ch in "\n\r\t":
            kept.append(ch)
        elif code < 128:
            kept.append(ch)
        elif 0x3000 <= code <= 0x303F:
            kept.append(ch)
        elif 0x3400 <= code <= 0x4DBF:
            kept.append(ch)
        elif 0x4E00 <= code <= 0x9FFF:
            kept.append(ch)
        elif 0xF900 <= code <= 0xFAFF:
            kept.append(ch)
        elif 0xFF00 <= code <= 0xFFEF:
            kept.append(ch)
        # else: drop the character (emoji, private-use, etc.)

    return "".join(kept)


def _install_print_hook() -> None:
    if getattr(builtins, "_scheduler_print_sanitized", False):
        return

    original_print = builtins.print

    def safe_print(*args: Any, **kwargs: Any) -> None:
        safe_args = tuple(sanitize_text(arg) for arg in args)
        safe_kwargs = dict(kwargs)
        if "sep" in safe_kwargs and safe_kwargs["sep"] is not None:
            safe_kwargs["sep"] = sanitize_text(safe_kwargs["sep"])
        if "end" in safe_kwargs and safe_kwargs["end"] is not None:
            safe_kwargs["end"] = sanitize_text(safe_kwargs["end"])
        original_print(*safe_args, **safe_kwargs)

    builtins.print = safe_print
    builtins._scheduler_print_sanitized = True


_install_print_hook()
