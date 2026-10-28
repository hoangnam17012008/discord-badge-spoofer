const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'stream_live_console.js'), 'utf8');

async function test(initiallyInVoice, alreadyStreaming) {
  let joined = initiallyInVoice;
  let clicked = 0;
  let interval = null;
  const messages = [];
  const store = (name, methods) => ({ getName: () => name, ...methods });
  const modules = {
    channel: { exports: store('ChannelStore', {
      getChannel: (id) => id === '1237467715795419196'
        ? { type: 2, getGuildId: () => '1237417691812335628' } : undefined,
    }) },
    user: { exports: store('UserStore', {
      getCurrentUser: () => ({ id: '123456789012345678' }),
    }) },
    voice: { exports: store('VoiceStateStore', {
      getVoiceStateForUser: () => joined ? { channelId: '1237467715795419196' } : undefined,
      isCurrentClientInVoiceChannel: () => joined,
    }) },
    streaming: { exports: store('ApplicationStreamingStore', {
      getCurrentUserActiveStream: () => alreadyStreaming ? { id: 'active' } : null,
    }) },
    actions: { exports: {
      selectVoiceChannel: (id) => { assert.equal(id, '1237467715795419196'); joined = true; },
      selectChannel: () => {},
    } },
  };
  const runtime = { c: modules };
  const chunks = [];
  chunks.push = () => runtime;
  const context = {
    window: { webpackChunkdiscord_app: chunks },
    document: { querySelectorAll: () => [{
      getAttribute: (key) => key === 'aria-label' ? 'Share Your Screen' : null,
      textContent: '', click: () => clicked++,
    }] },
    setTimeout: (callback) => { callback(); return 1; },
    setInterval: (callback) => { interval = callback; return 1; },
    clearInterval: () => {},
    console: { log: (...args) => messages.push(args), error: (...args) => messages.push(args) },
  };
  await vm.runInNewContext(source, context);
  assert.equal(joined, true);
  assert.equal(clicked, alreadyStreaming ? 0 : 1);
  assert.equal(typeof interval, 'function');
  assert.ok(!messages.some((entry) => String(entry[1]).includes('not found')));
}

(async () => {
  await test(false, false);
  await test(true, true);
  console.log('PASS: joins configured channel, opens native share flow, observes existing stream');
})().catch((error) => { console.error(error); process.exitCode = 1; });
