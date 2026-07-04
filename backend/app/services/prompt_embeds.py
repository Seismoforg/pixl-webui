"""Long-prompt / weighted-prompt embeddings for the CLIP families (SD 1.5, SDXL).

diffusers hands the prompt straight to CLIP, which truncates at 77 tokens, so the
tail of a long prompt silently has no effect. ``compel`` chunks longer prompts and
applies A1111-style attention weighting (``(word:1.2)`` / ``[word]``), returning
the embeddings we pass to the pipe as ``prompt_embeds`` instead of ``prompt``.

Only SD 1.5 and SDXL use CLIP; FLUX / SD 3.x use T5 (no 77-token limit) and keep
the native prompt path. Everything here is best-effort: if compel is missing or the
encode fails (e.g. an offloaded pipe), :func:`build` returns ``None`` and the caller
falls back to the plain prompt string.

Positive and negative prompts are encoded separately and then padded to a common
sequence length. compel's own ``pad_conditioning_tensors_to_same_length`` is broken
for SDXL's dual-encoder provider (missing ``empty_z``), so we pad ourselves.
"""
from __future__ import annotations

# Families whose text encoder is CLIP (77-token limit) — the ones compel helps.
_CLIP_FAMILIES = {"SD 1.5", "SDXL"}


def supported(family: str) -> bool:
    return family in _CLIP_FAMILIES


def _pad_to_same_length(pos, neg):
    """Right-pad the shorter of two ``(1, seq, dim)`` embedding tensors with zeros
    so positive and negative share a sequence length (diffusers requires it)."""
    import torch

    diff = pos.shape[1] - neg.shape[1]
    if diff == 0:
        return pos, neg
    short, n = (neg, diff) if diff > 0 else (pos, -diff)
    pad = torch.zeros(short.shape[0], n, short.shape[2], dtype=short.dtype, device=short.device)
    padded = torch.cat([short, pad], dim=1)
    return (pos, padded) if diff > 0 else (padded, neg)


def build(pipe, family: str, prompt: str, negative_prompt: str | None) -> dict | None:
    """Return pipe kwargs with CLIP prompt embeddings for ``family``, or ``None``
    when unsupported / compel unavailable / encoding fails."""
    if not supported(family):
        return None
    try:
        import contextlib
        import io

        from compel import Compel, ReturnedEmbeddingsType
    except Exception:  # noqa: BLE001 - optional dependency; fall back to plain prompt
        return None

    neg = negative_prompt or ""
    try:
        # compel prints a stdout deprecation notice when handed SDXL's two encoders;
        # swallow it so generation stays quiet (errors are exceptions, not prints).
        with contextlib.redirect_stdout(io.StringIO()):
            if family == "SDXL":
                compel = Compel(
                    tokenizer=[pipe.tokenizer, pipe.tokenizer_2],
                    text_encoder=[pipe.text_encoder, pipe.text_encoder_2],
                    returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
                    requires_pooled=[False, True],
                    truncate_long_prompts=False,
                )
                pos, pos_pooled = compel(prompt)
                neg_embeds, neg_pooled = compel(neg)
                pos, neg_embeds = _pad_to_same_length(pos, neg_embeds)
                return {
                    "prompt_embeds": pos,
                    "negative_prompt_embeds": neg_embeds,
                    "pooled_prompt_embeds": pos_pooled,
                    "negative_pooled_prompt_embeds": neg_pooled,
                }

            # SD 1.5 — a single CLIP encoder, no pooled embeddings.
            compel = Compel(
                tokenizer=pipe.tokenizer,
                text_encoder=pipe.text_encoder,
                truncate_long_prompts=False,
            )
            pos = compel(prompt)
            neg_embeds = compel(neg)
            pos, neg_embeds = _pad_to_same_length(pos, neg_embeds)
            return {
                "prompt_embeds": pos,
                "negative_prompt_embeds": neg_embeds,
            }
    except Exception:  # noqa: BLE001 - never break generation; fall back to prompt
        return None
