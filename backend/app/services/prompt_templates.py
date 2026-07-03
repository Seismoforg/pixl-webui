"""Persistence for reusable prompt snippets (positive / negative).

Users save frequently-used prompt fragments as named snippets and stack them into
the prompt or negative-prompt fields. Positive and negative snippets share one
store file (``data/prompt_templates.json``) and are distinguished by ``kind``;
the UI presents them as two separate lists. Mirrors the simple JSON-store pattern
used for custom models.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime

from pydantic import BaseModel

from .. import config

KINDS = ("positive", "negative")

_FILE = config.DATA_DIR / "prompt_templates.json"
_lock = threading.Lock()
_counter = 0


class PromptSnippet(BaseModel):
    id: str
    kind: str  # "positive" | "negative"
    name: str
    text: str


def _new_id() -> str:
    """Process-unique id (timestamp + counter), so duplicate names are allowed."""
    global _counter
    _counter += 1
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{_counter:04d}"


def _read() -> list[PromptSnippet]:
    if not _FILE.exists():
        return []
    try:
        raw = json.loads(_FILE.read_text("utf-8"))
        return [PromptSnippet.model_validate(entry) for entry in raw]
    except (ValueError, OSError):
        return []


def _write(snippets: list[PromptSnippet]) -> None:
    config.ensure_dirs()
    _FILE.write_text(
        json.dumps([s.model_dump() for s in snippets], indent=2), "utf-8"
    )


def load() -> list[PromptSnippet]:
    """Return all persisted snippets (both kinds)."""
    with _lock:
        return _read()


def add(kind: str, name: str, text: str) -> PromptSnippet:
    """Create and persist a new snippet, returning it."""
    with _lock:
        snippets = _read()
        snippet = PromptSnippet(id=_new_id(), kind=kind, name=name, text=text)
        snippets.append(snippet)
        _write(snippets)
        return snippet


def update(snippet_id: str, name: str, text: str) -> PromptSnippet | None:
    """Update a snippet's name/text (kind is fixed). Returns it, or None if
    unknown."""
    with _lock:
        snippets = _read()
        for i, s in enumerate(snippets):
            if s.id == snippet_id:
                updated = s.model_copy(update={"name": name, "text": text})
                snippets[i] = updated
                _write(snippets)
                return updated
    return None


def remove(snippet_id: str) -> bool:
    """Delete a snippet by id. Returns False if it did not exist."""
    with _lock:
        snippets = _read()
        kept = [s for s in snippets if s.id != snippet_id]
        if len(kept) == len(snippets):
            return False
        _write(kept)
        return True
