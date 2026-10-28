// Paste into the Discord desktop developer console while logged in.
// Joins the chosen voice channel and opens Discord's normal screen-share flow.
// The OS/client screen picker still requires your selection.
(async () => {
  "use strict";
  const CHANNEL_ID = "1237467715795419196";
  const label = "[kanashi-live]";
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (!/^\d{17,20}$/.test(CHANNEL_ID)) {
    console.error(label, "invalid channel ID");
    return;
  }

  const runtime = window.webpackChunkdiscord_app.push([[Symbol()], {}, (require) => require]);
  window.webpackChunkdiscord_app.pop();
  const hasDeclaredMethod = (value, method) => {
    try {
      for (let proto = value, depth = 0; proto && depth < 8;
           proto = Object.getPrototypeOf(proto), depth++) {
        if (typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function") {
          return true;
        }
      }
    } catch { /* ignore dynamic exports */ }
    return false;
  };
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
  const store = (name) => findExport((value) => {
    if (!value || !hasDeclaredMethod(value, "getName")) return false;
    try { return value.getName() === name; }
    catch { return false; }
  });
  const channelStore = store("ChannelStore");
  const userStore = store("UserStore");
  const voiceStore = store("VoiceStateStore");
  const streamingStore = store("ApplicationStreamingStore");
  const voiceActions = findExport((value) =>
    hasDeclaredMethod(value, "selectVoiceChannel") &&
    hasDeclaredMethod(value, "selectChannel")
  );
  if (!channelStore || !userStore || !voiceStore || !streamingStore ||
      typeof streamingStore.getCurrentUserActiveStream !== "function" ||
      !voiceActions) {
    console.error(label, "required Discord stores/actions were not found in this client version");
    return;
  }
  const channel = channelStore.getChannel(CHANNEL_ID);
  const guildId = channel && (channel.getGuildId?.() ?? channel.guild_id);
  if (!/^\d{17,20}$/.test(String(guildId)) || channel?.type !== 2) {
    console.error(label, "channel ID must be an accessible server voice channel");
    return;
  }
  const userId = userStore.getCurrentUser()?.id;
  if (!userId) {
    console.error(label, "current Discord user not found");
    return;
  }

  if (voiceStore.getVoiceStateForUser(userId)?.channelId !== CHANNEL_ID) {
    console.log(label, "joining voice channel", { guildId, channelId: CHANNEL_ID });
    voiceActions.selectVoiceChannel(CHANNEL_ID);
  }
  let connected = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (voiceStore.getVoiceStateForUser(userId)?.channelId === CHANNEL_ID &&
        voiceStore.isCurrentClientInVoiceChannel()) {
      connected = true;
      break;
    }
    await pause(500);
  }
  if (!connected) {
    console.error(label, "voice connection was not confirmed within 20 seconds");
    return;
  }
  console.log(label, "connected to voice channel", { guildId, channelId: CHANNEL_ID });

  const ownStream = () => streamingStore.getCurrentUserActiveStream() ?? null;
  if (!ownStream()) {
    // Click the official control so Discord performs its own RTC/stream setup.
    // Text varies by client locale, so report clearly if no matching control exists.
    const shareButton = [...document.querySelectorAll('button,[role="button"]')].find((element) => {
      const text = [element.getAttribute("aria-label"), element.getAttribute("title"),
                    element.textContent].filter(Boolean).join(" ");
      return /share (your )?screen|screen share|go live|chia sẻ màn hình|phát trực tiếp/i.test(text);
    });
    if (shareButton) {
      shareButton.click();
      console.log(label, "screen-share picker opened; select a screen/window and confirm Go Live");
    } else {
      console.log(label, "click Discord's Share Your Screen button, then choose a screen/window");
    }
  }

  let activeSince = null;
  const timer = setInterval(() => {
    const state = voiceStore.getVoiceStateForUser(userId);
    if (state?.channelId !== CHANNEL_ID) {
      clearInterval(timer);
      console.log(label, "voice connection ended; monitor stopped");
      return;
    }
    if (ownStream()) {
      if (activeSince === null) activeSince = Date.now();
      console.log(label, "stream active", {
        elapsedMinutesOnThisMonitor: Math.floor((Date.now() - activeSince) / 60000),
        channelId: CHANNEL_ID,
      });
    } else if (activeSince !== null) {
      clearInterval(timer);
      console.log(label, "stream ended; monitor stopped");
    }
  }, 10000);
  console.log(label, "monitor started; badge hours are determined by Discord, not this timer");
})();
