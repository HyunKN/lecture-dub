import pytest

from lecture_dub.audio import atempo_chain


def test_atempo_chain_stays_in_ffmpeg_range() -> None:
    chain = atempo_chain(5.0)
    factors = [float(part.split("=")[1]) for part in chain.split(",")]
    assert all(0.5 <= factor <= 2.0 for factor in factors)
    product = 1.0
    for factor in factors:
        product *= factor
    assert product == pytest.approx(5.0)


def test_atempo_chain_rejects_non_positive_speed() -> None:
    with pytest.raises(ValueError):
        atempo_chain(0)
