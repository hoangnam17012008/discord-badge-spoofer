const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'stream_console.js'), 'utf8');
const calls = [];
const output = [];
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
const runtime = { c: { rest: { exports: { default: rest } } } };
const chunks = [];
chunks.push = () => runtime;
const context = {
  window: { webpackChunkdiscord_app: chunks },
  crypto: { randomUUID },
  console: { log: (...args) => output.push(args), error: (...args) => output.push(args) },
};
(async () => {
  await vm.runInNewContext(source, context);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'get');
  assert.equal(calls[1][0], 'post');
  assert.equal(calls[1][1].url, '/science');
  const events = calls[1][1].body.events;
  assert.equal(events.length, 4);
  assert.equal(events[2].properties.total_duration_ms, 18_000_000_000);
  assert.deepEqual(Array.from(events, (event) => event.type), [
    'media_session_joined', 'video_stream_started',
    'video_stream_heartbeat', 'video_stream_ended',
  ]);
  assert.equal(output.at(-1)[2].badgeProgressVerified, false);
  assert.ok(!JSON.stringify(output).includes('fixture-secret'));
  console.log('PASS: one authenticated request, four events, redacted output');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
