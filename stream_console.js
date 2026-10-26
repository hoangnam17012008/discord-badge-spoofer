// Experimental Streaming telemetry probe for the Discord desktop client console.
// HTTP acceptance is not proof that any badge hours were credited.
(async () => {
  "use strict";

  const config = {
    guildId: "1237417691812335628",
    channelId: "1237467715795419196",
    hours: 5000,
    dryRun: false,
  };
  const label = "[kanashi-stream]";
  const validId = (id) => /^\d{17,20}$/.test(id);
  const durationMs = config.hours * 3_600_000;
  if (!validId(config.guildId) || !validId(config.channelId) ||
      !Number.isFinite(durationMs) || durationMs < 1 ||
      durationMs > Math.min(Date.now(), Number.MAX_SAFE_INTEGER)) {
    console.error(label, "invalid guild/channel ID or duration");
    return;
  }
  if (!Array.isArray(window.webpackChunkdiscord_app)) {
    console.error(label, "open this in the Discord desktop client");
    return;
  }

  // Find the client's authenticated REST module. No account token is copied,
  // logged, or stored by this script.
  const runtime = window.webpackChunkdiscord_app.push([[Symbol()], {}, (require) => require]);
  window.webpackChunkdiscord_app.pop();
  const isRest = (value) => value && ["get", "post", "del"].every(
    (method) => typeof value[method] === "function"
  );
  let rest = null;
  for (const mod of Object.values(runtime.c)) {
    if (!mod?.exports) continue;
    const exports = mod.exports;
    const candidates = [exports, exports.default, ...Object.values(exports)];
    rest = candidates.find(isRest);
    if (rest) break;
  }
  if (!rest) {
    console.error(label, "Discord REST module was not found; client version may differ");
    return;
  }

  let analyticsToken;
  if (!config.dryRun) {
    try {
      const response = await rest.get({
        url: "/users/@me",
        query: { with_analytics_token: true },
      });
      analyticsToken = response?.body?.analytics_token;
      if (!analyticsToken) throw new Error("analytics token missing");
    } catch (error) {
      console.error(label, "could not obtain analytics token", error?.status ?? error?.message);
      return;
    }
  }

  const now = Date.now();
  const started = now - durationMs;
  const heartbeatId = crypto.randomUUID();
  const launchSignature = crypto.randomUUID();
  const common = {
    guild_id: config.guildId,
    channel_id: config.channelId,
    channel_type: 2,
    client_heartbeat_session_id: heartbeatId,
    launch_signature: launchSignature,
    client_app_state: "focused",
  };
  const rows = [
    ["media_session_joined", started, {}],
    ["video_stream_started", started, {}],
    ["video_stream_heartbeat", now, {
      duration_tracked_ms: durationMs,
      total_duration_ms: durationMs,
    }],
    ["video_stream_ended", now, { duration_ms: durationMs }],
  ];
  const events = rows.map(([type, timestamp, extra], index) => ({
    type,
    properties: {
      ...common,
      ...extra,
      client_track_timestamp: timestamp,
      client_send_timestamp: now,
      event_sequence_number: index + 1,
    },
  }));

  if (config.dryRun) {
    console.log(label, "preview only; nothing sent", { hours: config.hours, events });
    return;
  }
  try {
    const response = await rest.post({
      url: "/science",
      body: { token: analyticsToken, events },
    });
    console.log(label, "telemetry request completed", {
      status: response?.status ?? "not exposed by client REST module",
      badgeProgressVerified: false,
    });
  } catch (error) {
    console.error(label, "telemetry request failed", error?.status ?? error?.message);
  }
})();
