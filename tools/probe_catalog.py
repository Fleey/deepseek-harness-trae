#!/usr/bin/env python3
"""Dump what Trae answers for the model-catalog endpoints.

The plugin's model list is hard-coded in `src/trae/catalog.ts`, so a model Trae
retires upstream keeps showing up in the picker and fails every turn with
`4023 the model is unknown`. traecli does not hard-code it: `models-manager`
fetches the catalog and caches it in `~/.trae/cli/models_cache.json`. Two
endpoints appear in the traecli binary:

    /api/ide/v1/batch_get_detail_param   "Trae ToB batch model config"
    /api/ide/v1/get_detail_param         "Trae model detail list"

and the request body it sends is embedded in the binary verbatim (the
TRAE_TOB_MODEL_CONFIG_* env vars override each field). This script sends both
and prints the response shape, so the parser in src/trae/catalog-source.ts can
be written against the real thing rather than against guesses.

Usage:
    python3 -I tools/probe_catalog.py                # JWT from ~/.trae/cli/auth.json
    TRAE_JWT=eyJ… python3 -I tools/probe_catalog.py  # a ready Cloud-IDE JWT

Nothing is written anywhere; the JWT is never printed.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

API_HOST = os.environ.get("TRAE_HOST", "https://api.enterprise.trae.cn")
BATCH_PATH = "/api/ide/v1/batch_get_detail_param"
SINGLE_PATH = "/api/ide/v1/get_detail_param"
AUTH_JSON = pathlib.Path.home() / ".trae" / "cli" / "auth.json"

APP_ID = os.environ.get("TRAE_APP_ID", "7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0")
VERSION_CODE = os.environ.get("TRAE_VERSION_CODE", "20260908")
CLIENT_VERSION = os.environ.get("TRAE_CLIENT_VERSION", "0.209.1")
UA = f"codex_exec/{CLIENT_VERSION} (probe) unknown (codex_exec; {CLIENT_VERSION})"

# The body traecli embeds for the ToB catalog call, with `current_config_name` /
# `current_config_is_custom_model` folded into the `current_config_info` object
# the wire struct names.
BODY = {
    "functions": ["chat"],
    "agent_type": "chat",
    "current_config_info": {"config_name": "", "is_custom_model": False},
    "mode_type": 0,
    "access_type": 4,
    "ab_force_vids": "",
    "ab_autotest_advanced_mode": 0,
    "show_custom_model": True,
}
# Same fields, flat, exactly as the binary's JSON template spells them.
BODY_FLAT = {
    "app_id": APP_ID,
    "version_code": VERSION_CODE,
    "functions": ["chat"],
    "agent_type": "chat",
    "mode_type": 0,
    "access_type": 4,
    "current_config_name": "",
    "current_config_is_custom_model": False,
    "ab_force_vids": "",
    "ab_autotest_advanced_mode": 0,
    "show_custom_model": True,
}


def jwt() -> str:
    token = os.environ.get("TRAE_JWT", "").strip()
    if token:
        return token
    try:
        data = json.loads(AUTH_JSON.read_text())
    except Exception as err:  # noqa: BLE001 - absence is the finding
        sys.exit(f"no TRAE_JWT and {AUTH_JSON} unreadable: {err}")
    token = (data.get("trae") or {}).get("access_token") or ""
    if not token:
        sys.exit(f"{AUTH_JSON} holds no trae.access_token; run traecli login or set TRAE_JWT")
    print(f"using the traecli session token (expires_at {(data.get('trae') or {}).get('expires_at')})")
    return token


def post(path: str, body: dict, token: str) -> tuple[int, str]:
    req = urllib.request.Request(f"{API_HOST}{path}", data=json.dumps(body).encode(), method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json",
        "originator": "codex_exec",
        "user-agent": UA,
        "authorization": f"Cloud-IDE-JWT {token}",
        "x-app-id": APP_ID,
        "x-ide-function": "chat",
        "x-ide-version": "99.99.99",
        "x-ide-version-code": VERSION_CODE,
        "version": CLIENT_VERSION,
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except Exception as err:  # noqa: BLE001 - network shape is the finding
        return 0, f"<{type(err).__name__}: {err}>"


# Prompt blobs are tens of KB each and say nothing about routing.
NOISY = ("instructions_template", "base_instructions", "model_messages", "prompt", "description")


def outline(value, depth: int = 0, path: str = "") -> None:
    pad = "  " * depth
    if isinstance(value, dict):
        for key, item in value.items():
            if key in NOISY and isinstance(item, (str, dict)):
                print(f"{pad}{key}: <{type(item).__name__}, elided>")
                continue
            if isinstance(item, (dict, list)):
                print(f"{pad}{key}:")
                outline(item, depth + 1, f"{path}/{key}")
            else:
                print(f"{pad}{key} = {json.dumps(item, ensure_ascii=False)[:120]}")
    elif isinstance(value, list):
        print(f"{pad}[{len(value)} entries]")
        if value:
            outline(value[0], depth + 1, f"{path}[0]")


def main() -> None:
    token = jwt()
    for label, path, body in (
        ("ToB batch (nested current_config_info)", BATCH_PATH, BODY),
        ("ToB batch (flat template)", BATCH_PATH, BODY_FLAT),
        ("single get_detail_param", SINGLE_PATH, BODY),
    ):
        print(f"\n=== {label} — POST {path}")
        status, text = post(path, body, token)
        print(f"HTTP {status}, {len(text)} bytes")
        try:
            parsed = json.loads(text)
        except Exception:
            print(text[:600])
            continue
        outline(parsed)
        if status == 200:
            pathlib.Path("/tmp/trae_catalog_%s.json" % path.rsplit("/", 1)[-1]).write_text(text)
            print(f"full body saved to /tmp/trae_catalog_{path.rsplit('/', 1)[-1]}.json")


if __name__ == "__main__":
    main()
