#!/usr/bin/env python3
"""Experimental Discord Streaming telemetry probe. A 204 is not badge progress."""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

from spoofer import (ScienceClient, Session, State, configure_proxy,
                     ensure_token, valid_hours)


def snowflake(raw: str) -> str:
    if not raw.isascii() or not raw.isdecimal() or not 17 <= len(raw) <= 20:
        raise argparse.ArgumentTypeError("expected a 17–20 digit Discord ID")
    return raw


def stream_events(client: ScienceClient, guild_id: str, channel_id: str,
                  hours: float, now_ms: int | None = None) -> list[dict]:
    """Construct the telemetry sequence used by a public experimental client.

    This does not create a Gateway/RTC session, media, or an audience.
    """
    duration_ms = int(valid_hours(str(hours)) * 3_600_000)
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if now < duration_ms:
        raise ValueError("duration predates the Unix epoch")
    base = {"guild_id": guild_id, "channel_id": channel_id, "channel_type": 2,
            "client_heartbeat_session_id": client.session.heartbeat_session,
            "launch_signature": client.session.launch_signature,
            "client_app_state": "focused"}
    result = []
    for event_type, timestamp, extra in (
        ("media_session_joined", now - duration_ms, {}),
        ("video_stream_started", now - duration_ms, {}),
        ("video_stream_heartbeat", now,
         {"duration_tracked_ms": duration_ms, "total_duration_ms": duration_ms}),
        ("video_stream_ended", now, {"duration_ms": duration_ms}),
    ):
        result.append({"type": event_type,
                       "properties": {**base, **extra,
                                      "client_track_timestamp": timestamp,
                                      "client_send_timestamp": now,
                                      "event_sequence_number": client._next_seq()}})
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Experimental Streaming telemetry probe; no badge guarantee")
    parser.add_argument("--guild-id", type=snowflake, required=True)
    parser.add_argument("--channel-id", type=snowflake, required=True)
    parser.add_argument("--hours", type=valid_hours, required=True)
    parser.add_argument("--proxy", help="HTTP(S) proxy for live requests")
    parser.add_argument("--send", action="store_true", help="send one batch using local science_state.json")
    args = parser.parse_args()
    if args.proxy:
        try:
            configure_proxy(args.proxy)
        except ValueError as exc:
            parser.error(str(exc))

    if args.send:
        state = State.load()
        if not state.has_token or not state.has_cookie:
            parser.error("live send requires token and cf_clearance in local science_state.json")
        session = Session.new()
        ensure_token(state, session.super_props)
    else:
        # Preview uses no account state or network.
        state = State()
        session = Session("preview-session", "preview-launch", "")
    client = ScienceClient(state, session)
    events = stream_events(client, args.guild_id, args.channel_id, args.hours)
    if not args.send:
        print(json.dumps({"experimental": True, "sent": False, "events": events}, indent=2))
        return 0
    status = client.post(events)
    print(f"Streaming telemetry HTTP status: {status}. This does not verify badge progress.")
    return 0 if status == 204 else 1


if __name__ == "__main__":
    raise SystemExit(main())
