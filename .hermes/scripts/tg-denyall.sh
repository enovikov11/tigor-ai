#!/bin/sh
# Reapply the Deny All button patch after image updates (container /opt/hermes is ephemeral).
# Run: podman exec hermes /opt/data/patches/tg-denyall.sh
/opt/hermes/.venv/bin/python - <<'PYEOF'
import io, py_compile
p = "/opt/hermes/plugins/platforms/telegram/adapter.py"
src = io.open(p, encoding="utf-8").read()
if 'ea:denyall:' in src:
    print("already patched")
    raise SystemExit(0)
pairs = [
    (
        '            buttons.append(InlineKeyboardButton("\u274c Deny", callback_data=f"ea:deny:{approval_id}"))\n',
        '            buttons.append(InlineKeyboardButton("\u274c Deny", callback_data=f"ea:deny:{approval_id}"))\n            buttons.append(InlineKeyboardButton("\U0001f6ab Deny All", callback_data=f"ea:denyall:{approval_id}"))\n',
    ),
    (
        "                    count = resolve_gateway_approval(session_key, choice)\n",
        '                    count = resolve_gateway_approval(session_key, choice, resolve_all=(choice == "denyall"))\n',
    ),
    (
        '                        "Telegram button resolved %d approval(s) for session %s (choice=%s, user=%s)",\n                        count, session_key, choice, user_display,\n',
        '                        "Telegram button resolved %d approval(s) for session %s (choice=%s all=%s, user=%s)",\n                        count, session_key, choice, choice == "denyall", user_display,\n',
    ),
    (
        '                        "deny": "\u274c Denied",\n',
        '                        "deny": "\u274c Denied",\n                        "denyall": "\U0001f6ab All denied",\n',
    ),
]
for old, new in pairs:
    n = src.count(old)
    assert n == 1, "anchor count %d: %r" % (n, old[:60])
    src = src.replace(old, new)
io.open(p, "w", encoding="utf-8").write(src)
py_compile.compile(p, doraise=True)
print("patched OK")
PYEOF
