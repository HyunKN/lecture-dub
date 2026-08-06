from lecture_dub.subtitles import clean_caption_text, parse_timestamp, parse_vtt_text


def test_parse_timestamp_with_and_without_hours() -> None:
    assert parse_timestamp("01:02:03.456") == 3723.456
    assert parse_timestamp("02:03.250") == 123.25
    assert parse_timestamp("00:00:01,500") == 1.5


def test_parse_vtt_with_identifier_and_tags() -> None:
    content = """WEBVTT

intro
00:00:01.000 --> 00:00:03.500 align:start
<v Professor>Hello &amp; welcome.</v>

00:00:04.000 --> 00:00:05.000
두 번째 문장입니다.
"""
    cues = parse_vtt_text(content)
    assert len(cues) == 2
    assert cues[0].start == 1.0
    assert cues[0].end == 3.5
    assert cues[0].text == "Hello & welcome."
    assert cues[1].text == "두 번째 문장입니다."


def test_clean_caption_text_collapses_whitespace() -> None:
    assert clean_caption_text("<c>hello</c>   world") == "hello world"
