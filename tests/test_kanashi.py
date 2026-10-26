import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import spoofer as app


class CookieTests(unittest.TestCase):
    def test_header_extracts_only_clearance(self):
        self.assertEqual(app.extract_clearance('Cookie: session=private; cf_clearance=abc-123; other=secret'), 'cf_clearance=abc-123')

    def test_json_export_filters_domains(self):
        raw = json.dumps({'cookies': [
            {'name': 'cf_clearance', 'value': 'wrong', 'domain': '.example.com'},
            {'name': 'cf_clearance', 'value': 'right', 'domain': '.discord.com'},
        ]})
        self.assertEqual(app.extract_clearance(raw), 'cf_clearance=right')

    def test_json_map(self):
        self.assertEqual(app.extract_clearance('{"cf_clearance":"abc","session":"private"}'), 'cf_clearance=abc')

    def test_netscape_export(self):
        raw = '# Netscape HTTP Cookie File\n#HttpOnly_.discord.com\tTRUE\t/\tTRUE\t0\tcf_clearance\tabc\n'
        self.assertEqual(app.extract_clearance(raw), 'cf_clearance=abc')

    def test_invalid_missing_ambiguous_and_injected(self):
        for raw in ('', 'session=private', 'cf_clearance=a; cf_clearance=b', 'Cookie: cf_clearance=abc\r\nX-Injected: yes', '[bad',
                    '[{"name":"cf_clearance","value":"a"},{"name":"cf_clearance","value":"b"}]',
                    '{"cf_clearance":"a;b"}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                app.extract_clearance(raw)

    def test_cookie_file_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / 'cookies.json'
            cookie_file.write_text('{"cf_clearance":"fixture"}')
            with patch.object(app, 'STATE_FILE', Path(tmp) / 'state.json'), patch.object(app.App, 'start') as start:
                with patch.object(sys, 'argv', ['kanashi', '--cookies', str(cookie_file), '--workers', '2']):
                    app.main()
                start.assert_called_once()
                self.assertEqual(app.State.load().cookie, 'cf_clearance=fixture')


class ProxyTests(unittest.TestCase):
    def tearDown(self):
        app.configure_proxy(None)

    def test_invalid_urls_rejected_without_echo(self):
        for url in ('socks5://host:1080', 'http://host', 'http://host:bad', 'http://host:80/path', 'http://host:80?x=y'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                app.configure_proxy(url)

    def test_explicit_proxy_used_for_both_protocols(self):
        app.configure_proxy('http://localhost:8080')
        with patch.object(app.urllib.request, 'ProxyHandler') as handler, patch.object(app.urllib.request, 'build_opener') as build:
            app.open_url('https://example.invalid', timeout=15)
            handler.assert_called_once_with({'http': 'http://localhost:8080', 'https': 'http://localhost:8080'})
            build.return_value.open.assert_called_once_with('https://example.invalid', timeout=15)

    def test_system_proxy_preserved_by_default(self):
        app.configure_proxy(None)
        with patch.object(app.urllib.request, 'ProxyHandler') as handler, patch.object(app.urllib.request, 'build_opener'):
            app.open_url('https://example.invalid', timeout=15)
            handler.assert_called_once_with()


class BatchTests(unittest.TestCase):
    def games(self, n):
        return [app.Game(str(i), str(i), 'game.exe') for i in range(n)]

    def test_parallelism_is_bounded_and_requests_globally_paced(self):
        lock = threading.Lock()
        active = 0
        maximum = 0
        starts = []
        class Client:
            def post(self, events):
                nonlocal active, maximum
                with lock:
                    active += 1
                    maximum = max(maximum, active)
                    starts.append(time.monotonic())
                time.sleep(.06)
                with lock:
                    active -= 1
                return 204
        with patch.object(app, 'BATCH_SIZE', 1), patch.object(app, 'BATCH_DELAY', .015), contextlib.redirect_stdout(io.StringIO()):
            count = app.Spoofer(Client(), app.Console(), workers=2).run(self.games(6), lambda game: [{'id': game.id}])
        self.assertEqual(count, 6)
        self.assertEqual(maximum, 2)
        self.assertTrue(all(b-a >= .010 for a, b in zip(starts, starts[1:])))

    def test_auth_and_rate_limit_stop_further_batches(self):
        for status in (401, 403, 429):
            calls = []
            class Client:
                def post(self, events):
                    calls.append(events)
                    return status
            with self.subTest(status=status), patch.object(app, 'BATCH_SIZE', 1), patch.object(app, 'BATCH_DELAY', .03), contextlib.redirect_stdout(io.StringIO()):
                count = app.Spoofer(Client(), app.Console(), 4).run(self.games(20), lambda game: [{}])
                self.assertEqual(count, 0)
                self.assertEqual(len(calls), 1)

    def test_partial_batch_counts_actual_games(self):
        class Client:
            def post(self, events):
                return 204
        with patch.object(app, 'BATCH_SIZE', 2), patch.object(app, 'BATCH_DELAY', 0), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(app.Spoofer(Client(), app.Console(), 2).run(self.games(5), lambda game: [{}]), 5)

    def test_sequence_generation_stays_on_caller_thread(self):
        caller = threading.get_ident()
        session = app.Session('heartbeat', 'launch', 'properties')
        client = app.ScienceClient(app.State(), session)
        seqs = []
        def build(game):
            self.assertEqual(threading.get_ident(), caller)
            events = client.build_session(game, 1000)
            seqs.extend(e['properties']['event_sequence_number'] for e in events)
            return events
        with patch.object(client, 'post', return_value=204), patch.object(app, 'BATCH_SIZE', 1), patch.object(app, 'BATCH_DELAY', 0), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(app.Spoofer(client, app.Console(), 3).run(self.games(7), build), 7)
        self.assertEqual(seqs, list(range(1, 22)))


class StartupTests(unittest.TestCase):
    def test_legacy_state_loads_without_old_promotion_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'state.json'
            path.write_text('{"subscribed":true,"joined_discord":true,"total_games_claimed":4}')
            with patch.object(app, 'STATE_FILE', path):
                state = app.State.load()
                self.assertEqual(state.total_games_claimed, 4)
                state.save()
            self.assertNotIn('subscribed', json.loads(path.read_text()))

    def test_real_cli_starts_without_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / 'spoofer.py'
            script.write_bytes(Path(app.__file__).read_bytes())
            result = subprocess.run([sys.executable, str(script)], input='\n', text=True, capture_output=True,
                                    cwd=tmp, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertIn('kanashi', result.stdout)
        self.assertIn('token', result.stdout)
        for unwanted in ('revere', 'youtube', 'subscribe', 'discord.gg'):
            self.assertNotIn(unwanted, result.stdout.lower())


if __name__ == '__main__':
    unittest.main()
