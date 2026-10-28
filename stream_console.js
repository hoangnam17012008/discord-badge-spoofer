// Experimental Streaming telemetry probe for the Discord desktop client console.
// HTTP acceptance is not proof that any badge hours were credited.
(async () => {
  "use strict";

  const config = {
    hours: 5000,
    dryRun: false,
  };
  const label = "[kanashi-stream]";
  const validId = (id) => /^\d{17,20}$/.test(id);
  const durationMs = config.hours * 3_600_000;
  if (!Number.isFinite(durationMs) || durationMs < 1 ||
      durationMs > Math.min(Date.now(), Number.MAX_SAFE_INTEGER)) {
    console.error(label, "invalid duration");
    return;
  }
  // Find the client's authenticated REST module. No account token is copied,
  // logged, or stored by this script.
  const runtime = window.webpackChunkdiscord_app.push([[Symbol()], {}, (require) => require]);
  window.webpackChunkdiscord_app.pop();
  const findExport = (predicate) => {
    for (const mod of Object.values(runtime.c)) {
      if (!mod?.exports) continue;
      const exports = mod.exports;
      const candidates = [exports, exports.default, ...Object.values(exports)];
      const found = candidates.find(predicate);
      if (found) return found;
    }
    return null;
  };
  const hasDeclaredMethod = (value, method) => {
    try {
      for (let proto = value, depth = 0; proto && depth < 8;
           proto = Object.getPrototypeOf(proto), depth++) {
        if (typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function") {
          return true;
        }
      }
    } catch {
      // Some Discord exports are dynamic proxies. Do not read arbitrary keys
      // on them; localization proxies log warnings for every unknown key.
    }
    return false;
  };
  const findStore = (name) => findExport((value) => {
    if (!value || !hasDeclaredMethod(value, "getName")) return false;
    try { return value.getName() === name; }
    catch { return false; }
  });
  const userStore = findStore("UserStore");
  const voiceStore = findStore("VoiceStateStore");
  const channelStore = findStore("ChannelStore");
  if (!userStore || !voiceStore || !channelStore ||
      typeof userStore.getCurrentUser !== "function" ||
      typeof voiceStore.getVoiceStateForUser !== "function" ||
      typeof voiceStore.isCurrentClientInVoiceChannel !== "function" ||
      typeof channelStore.getChannel !== "function") {
    console.error(label, "voice/channel stores not found; this client version may differ");
    return;
  }
  const userId = userStore.getCurrentUser()?.id;
  const voiceState = userId && voiceStore.getVoiceStateForUser(userId);
  const channelId = voiceState?.channelId;
  const channel = channelId && channelStore.getChannel(channelId);
  const guildId = channel && (channel.getGuildId?.() ?? channel.guild_id);
  if (!voiceStore.isCurrentClientInVoiceChannel() ||
      !validId(channelId) || !validId(guildId)) {
    console.error(label, "join a server voice channel before running this script");
    return;
  }

  const isRest = (value) => value && ["get", "post", "del"].every(
    (method) => typeof value[method] === "function"
  );
  // A generic method-name scan can select Discord's localization proxy:
  // it also exposes get/post/del but treats REST arguments as message keys.
  // Search only modules whose factory identifies the HTTP utilities.
  let rest = null;
  for (const [id, factory] of Object.entries(runtime.m ?? {})) {
    if (!factory.toString().includes("HTTPUtils")) continue;
    const exports = runtime(id);
    const candidates = [exports, exports?.default, ...Object.values(exports ?? {})];
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
    guild_id: guildId,
    channel_id: channelId,
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
    console.log(label, "preview only; nothing sent", { guildId, channelId, hours: config.hours, events });
    return;
  }
  try {
    const response = await rest.post({
      url: "/science",
      body: { token: analyticsToken, events },
    });
    console.log(label, "telemetry request completed", {
      guildId,
      channelId,
      status: response?.status ?? "not exposed by client REST module",
      badgeProgressVerified: false,
    });
  } catch (error) {
    console.error(label, "telemetry request failed", error?.status ?? error?.message);
  }
})();
