import pytest

from lecture_dub.audio import atempo_chain, format_progress


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


def test_format_progress_reports_percentage_and_counts() -> None:
    assert format_progress("TTS", 5, 10, width=10) == (
        "TTS [#####-----] 5/10 (50.0%)"
    )


def test_format_progress_clamps_current_to_total() -> None:
    assert format_progress("WAV", 12, 10, width=10) == (
        "WAV [##########] 10/10 (100.0%)"
    )
