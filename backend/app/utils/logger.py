"""Centralized logging."""

from __future__ import annotations

import logging
import sys

from app.config import get_settings


def _setup() -> logging.Logger:
    cfg = get_settings()
    logger = logging.getLogger("ghost_search")
    logger.setLevel(getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO))

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        logger.addHandler(handler)

    return logger


log = _setup()
