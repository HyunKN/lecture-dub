from __future__ import annotations

import asyncio

from lecture_dub import server_local


def test_local_model_routes_are_registered_before_legacy_mount() -> None:
    routes = list(server_local.app.routes)
    paths = [getattr(route, "path", "") for route in routes]

    assert "/api/models" in paths
    assert "/api/models/root" in paths
    assert "/api/models/pick-root" in paths
    assert "/api/tts/preview" in paths
    assert "/api/synthesize" in paths

    legacy_index = next(
        index for index, route in enumerate(routes)
        if getattr(route, "app", None) is server_local.legacy_app
    )
    assert paths.index("/api/synthesize") < legacy_index


def test_index_injects_local_model_ui_script() -> None:
    response = asyncio.run(server_local.index())
    body = response.body.decode("utf-8")

    assert '/web/local-models.js' in body
    assert '/web/app.js' in body


def test_model_payload_includes_acceleration_summary(monkeypatch) -> None:
    monkeypatch.setattr(server_local, "gpu_acceleration_summary", lambda: {
        "detected": True,
        "name": "Test GPU",
        "provider": "DmlExecutionProvider",
        "ready": True,
        "install": "install command",
    })
    payload = server_local._model_payload()
    assert payload["acceleration"]["ready"] is True
    assert payload["acceleration"]["provider"] == "DmlExecutionProvider"
