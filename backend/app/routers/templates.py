"""Prompt snippet endpoints: reusable positive / negative prompt fragments."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import messages
from ..services import prompt_templates
from ..services.prompt_templates import PromptSnippet

router = APIRouter(prefix="/api/prompt-templates", tags=["prompt-templates"])


class CreateSnippet(BaseModel):
    kind: str
    name: str = Field(min_length=1)
    text: str = Field(min_length=1)


class UpdateSnippet(BaseModel):
    name: str = Field(min_length=1)
    text: str = Field(min_length=1)


@router.get("", response_model=list[PromptSnippet])
def list_snippets() -> list[PromptSnippet]:
    return prompt_templates.load()


@router.post("", response_model=PromptSnippet)
def create_snippet(body: CreateSnippet) -> PromptSnippet:
    if body.kind not in prompt_templates.KINDS:
        raise HTTPException(422, messages.SNIPPET_INVALID_KIND.format(kind=body.kind))
    return prompt_templates.add(body.kind, body.name, body.text)


@router.put("/{snippet_id}", response_model=PromptSnippet)
def update_snippet(snippet_id: str, body: UpdateSnippet) -> PromptSnippet:
    updated = prompt_templates.update(snippet_id, body.name, body.text)
    if updated is None:
        raise HTTPException(404, messages.SNIPPET_NOT_FOUND.format(id=snippet_id))
    return updated


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: str) -> dict[str, str]:
    if not prompt_templates.remove(snippet_id):
        raise HTTPException(404, messages.SNIPPET_NOT_FOUND.format(id=snippet_id))
    return {"id": snippet_id, "status": "deleted"}
