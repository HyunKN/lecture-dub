from __future__ import annotations

import asyncio

from lecture_dub import server_local


def test_local_model_routes_are_registered_before_legacy_mount() -> None:
    paths = [getattr(route, "path", "") for route in server_local.app.routes]

    assert "/api/models" in paths
    assert "/api/models/root" in paths
    assert "/api/models/pick-root" in paths
    assert "/api/tts/preview" in paths
    assert "/api/synthesize" in paths
    assert paths.index("/api/synthesize") < paths.index("") or paths[-1] == ""


def test_index_injects_local_model_ui_script() -> None:
    response = asyncio.run(server_local.index())
    body = response.body.decode("utf-8")

    assert '/web/local-models.js' in body
    assert '/web/app.js' in body
