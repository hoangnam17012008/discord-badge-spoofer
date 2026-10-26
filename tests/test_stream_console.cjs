const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'stream_console.js'), 'utf8');

async function run({ inVoice }) {
  const calls = [];
  const output = [];
  const wrongGet = async () => { throw Error('localization module selected'); };
  const localization = { get: wrongGet, post: wrongGet, del: wrongGet, getName: () => 'LocalizationStore' };
  const rest = {
    get: async (request) => {
      calls.push(['get', request]);
      return { body: { analytics_token: 'fixture-secret' } };
    },
    post: async (request) => {
      calls.push(['post', request]);
      return { status: 204 };
    },
    del: async () => {},
  };
  const voice = {
    getName: () => 'VoiceStateStore',
    getVoiceStateForUser: () => inVoice ? { channelId: '123456789012345679' } : undefined,
    isCurrentClientInVoiceChannel: () => inVoice,
  };
  const runtime = (id) => runtime.c[id].exports;
  runtime.m = { http: function HTTPUtils() {} };
  runtime.c = {
    locale: { exports: localization },
    user: { exports: { getName: () => 'UserStore', getCurrentUser: () => ({ id: '123456789012345677' }) } },
    voice: { exports: voice },
    channel: { exports: {
      getName: () => 'ChannelStore',
      getChannel: (id) => id === '123456789012345679'
        ? { getGuildId: () => '123456789012345678' } : undefined,
      getMutableGuildChannelsForGuild: () => ({}),
    } },
    http: { exports: { default: rest } },
  };
  const chunks = [];
  chunks.push = () => runtime;
  const context = {
    window: { webpackChunkdiscord_app: chunks },
    crypto: { randomUUID },
    console: { log: (...args) => output.push(args), error: (...args) => output.push(args) },
  };
  await vm.runInNewContext(source, context);
  return { calls, output };
}

(async () => {
  const { calls, output } = await run({ inVoice: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'get');
  assert.equal(calls[1][0], 'post');
  const events = calls[1][1].body.events;
  assert.equal(events.length, 4);
  assert.equal(events[0].properties.guild_id, '123456789012345678');
  assert.equal(events[0].properties.channel_id, '123456789012345679');
  assert.equal(events[2].properties.total_duration_ms, 18_000_000_000);
  assert.equal(output.at(-1)[2].badgeProgressVerified, false);
  assert.ok(!JSON.stringify(output).includes('fixture-secret'));

  const disconnected = await run({ inVoice: false });
  assert.equal(disconnected.calls.length, 0);
  assert.match(JSON.stringify(disconnected.output), /join a server voice channel/);
  console.log('PASS: current voice channel, correct REST module, no request when disconnected');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
