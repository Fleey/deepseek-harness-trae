#!/usr/bin/env python3
"""Dump what Trae actually answers for the quota (额度) endpoints.

The dsh plugin shows "当前账号没有额度包" whenever upstream returns a
recognisable `user_entitlement_pack_list` that is empty, or whose packs all
read a limit of 0 / are already expired. That is indistinguishable, from the
UI, from "we asked the wrong host". This script asks every step by hand and
prints the raw answers so the real shape can be seen.

Usage:
    TRAE_PAT=...  python3 -I tools/probe_quota.py   # the traecli PAT
    TRAE_JWT=eyJ… python3 -I tools/probe_quota.py   # a ready Cloud-IDE JWT

Add TRAE_CONSOLE_EMAIL / TRAE_CONSOLE_PASSWORD to also dump the enterprise
console's own figures (the only place a ToB seat's quota exists).

`TRAE_PAT` is the same key traecli logs in with (`traecli login
--with-trae-pat`, `TRAECLI_PERSONAL_ACCESS_TOKEN` in .env) and the same value
the dsh plugin keeps in its credential store.

Nothing is written anywhere; the PAT and the JWT are never printed in full.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

API_HOST = os.environ.get("TRAE_HOST", "https://api.enterprise.trae.cn")
EXCHANGE_PATH = "/cloudide/api/v3/trae/oauth/ExchangeToken"
CHECK_LOGIN_PATH = "/cloudide/api/v3/trae/CheckLogin"
CLI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
QUOTA_PATHS = (
    "/trae/api/v1/pay/ide_user_ent_usage",
    "/trae/api/v2/pay/ide_user_ent_usage",
)
FALLBACK_PAY_HOST = "https://api.trae.cn"
UA = "Trae-CLI/0.206.1-tob"


def post(url: str, body: dict, headers: dict) -> tuple[int, str]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": UA,
        **headers,
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except Exception as err:  # noqa: BLE001 - network shape is the finding
        return 0, f"<{type(err).__name__}: {err}>"


def show(label: str, status: int, text: str, limit: int = 4000) -> object:
    print(f"\n=== {label} -> HTTP {status} ===")
    try:
        parsed = json.loads(text)
    except ValueError:
        print(text[:limit])
        return None
    print(json.dumps(parsed, indent=2, ensure_ascii=False)[:limit])
    return parsed


def dig(obj: object, *keys: str) -> object:
    """First value under any of `keys`, anywhere in a nested dict/list."""
    if isinstance(obj, dict):
        for key in keys:
            if obj.get(key) not in (None, ""):
                return obj[key]
        for value in obj.values():
            found = dig(value, *keys)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = dig(item, *keys)
            if found is not None:
                return found
    return None


CONSOLE_HOST = os.environ.get("TRAE_CONSOLE_HOST", "https://console.enterprise.trae.cn")
CONSOLE_LOGIN = "/trae/gtm/tob/api/v1/account/login"
CONSOLE_QUOTA = "/trae/gtm/tob/api/v1/config/get_personal_quota"
CONSOLE_USAGE = "/trae/gtm/tob/api/v1/config/get_user_model_usage"
CONSOLE_COOKIE = "X-Cloudide-Tob-Session"


def probe_console() -> None:
    """The enterprise console's own figures, if a console account is given.

    These endpoints take the console's session cookie only — a Cloud-IDE JWT is
    refused with `30011 请先登录` — so this logs in the way the console's own
    page does. Set TRAE_CONSOLE_EMAIL / TRAE_CONSOLE_PASSWORD; neither is
    printed.
    """
    email = os.environ.get("TRAE_CONSOLE_EMAIL", "").strip()
    password = os.environ.get("TRAE_CONSOLE_PASSWORD", "")
    if not email or not password:
        print("\n(skipping the enterprise console: set TRAE_CONSOLE_EMAIL and TRAE_CONSOLE_PASSWORD to include it)")
        return

    data = json.dumps({"Email": email, "Password": password}).encode()
    req = urllib.request.Request(f"{CONSOLE_HOST}{CONSOLE_LOGIN}", data=data, method="POST", headers={
        "content-type": "application/json", "accept": "application/json",
        "accept-language": "zh", "user-agent": UA,
        "origin": CONSOLE_HOST, "referer": f"{CONSOLE_HOST}/personal/usage",
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            cookies = res.headers.get_all("Set-Cookie") or []
            body = json.loads(res.read().decode("utf-8", "replace"))
    except Exception as err:  # noqa: BLE001
        print(f"\nconsole login failed: {type(err).__name__}: {err}")
        return
    if body.get("code") not in (0, None):
        print(f"\nconsole login refused: {body.get('code')} {body.get('message')}")
        return
    session = next((re.search(rf"{CONSOLE_COOKIE}=([^;]+)", c).group(1)
                    for c in cookies if CONSOLE_COOKIE in c), None)
    if not session:
        print(f"\nconsole login returned no {CONSOLE_COOKIE} cookie; only: "
              f"{[c.split('=')[0] for c in cookies]}")
        return
    print(f"\nconsole session acquired ({len(session)} chars)")

    for path in (CONSOLE_QUOTA, CONSOLE_USAGE):
        status, text = post(f"{CONSOLE_HOST}{path}", {}, {
            "accept-language": "zh", "cookie": f"{CONSOLE_COOKIE}={session}",
            "origin": CONSOLE_HOST, "referer": f"{CONSOLE_HOST}/personal/usage",
        })
        show(f"{CONSOLE_HOST}{path}", status, text, limit=6000)


def main() -> int:
    pat = (os.environ.get("TRAE_PAT") or os.environ.get("TRAE_JWT") or "").strip()
    if not pat:
        print("set TRAE_PAT (the traecli PAT, i.e. TRAECLI_PERSONAL_ACCESS_TOKEN / the key\n"
              "`traecli login --with-trae-pat` takes, the same one saved in the dsh plugin),\n"
              "or TRAE_JWT=eyJ… to skip the exchange and use a ready Cloud-IDE JWT.",
              file=sys.stderr)
        return 2

    # A Cloud-IDE JWT can be used as is; anything else is exchanged as a PAT,
    # exactly the way src/trae/auth.ts decides between the two.
    if pat.startswith("eyJ") and pat.count(".") == 2:
        token = pat
        print("using the given value as a Cloud-IDE JWT (no exchange)")
    else:
        status, text = post(f"{API_HOST}{EXCHANGE_PATH}",
                            {"RefreshToken": pat, "ClientID": CLI_CLIENT_ID, "ClientId": CLI_CLIENT_ID},
                            {})
        body = show("ExchangeToken", status, text, limit=1200)
        token = dig(body, "AccessToken", "access_token", "Token", "token", "Jwt", "jwt")
        if not isinstance(token, str) or token.count(".") != 2:
            print("\nno JWT in the exchange answer; stopping", file=sys.stderr)
            return 1
    print(f"\nJWT acquired ({len(token)} chars, {token[:10]}…)")

    auth = {"authorization": f"Cloud-IDE-JWT {token}", "x-cloudide-token": token}
    status, text = post(f"{API_HOST}{CHECK_LOGIN_PATH}",
                        {"GetAIPayHost": True, "ReqSource": "IDE"}, auth)
    login = show("CheckLogin (GetAIPayHost)", status, text)
    pay_host = dig(login, "AIPayHost", "AiPayHost", "ai_pay_host")
    print(f"\nAIPayHost = {pay_host!r}")

    hosts: list[str] = []
    for candidate in (pay_host, API_HOST, FALLBACK_PAY_HOST):
        if isinstance(candidate, str) and candidate.strip():
            host = candidate.strip().rstrip("/")
            if not host.startswith("http"):
                host = f"https://{host}"
            if host not in hosts:
                hosts.append(host)

    # The plugin sends only `authorization` to the pay host; the IDE also sends
    # its identity headers. Try both, since the gateway may scope entitlements
    # by app / IDE.
    bare = {"authorization": f"Cloud-IDE-JWT {token}"}
    identity = {
        **bare,
        "originator": "codex_exec",
        "x-app-id": os.environ.get("TRAE_APP_ID", "7b3f9dc2-8a4e-5c6d-2f1b-9e4a3c5b7df0"),
        "x-ide-function": "chat",
        "x-ide-version": "99.99.99",
        "x-ide-version-code": "20260908",
        "version": "0.206.1-tob",
    }

    for host in hosts:
        for path in QUOTA_PATHS:
            for header_name, headers in (("bare", bare), ("identity", identity)):
                for payload in ({"require_usage": True}, {}):
                    label = f"{host}{path} headers={header_name} body={json.dumps(payload)}"
                    status, text = post(f"{host}{path}", payload, headers)
                    answer = show(label, status, text)
                    packs = dig(answer, "user_entitlement_pack_list", "userEntitlementPackList")
                    if isinstance(packs, list):
                        print(f"--> pack list present, {len(packs)} entries")

    probe_console()
    return 0


if __name__ == "__main__":
    sys.exit(main())
