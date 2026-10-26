import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import spoofer as app


class ValidationTests(unittest.TestCase):
    def test_invalid_counts(self):
        for raw in ('0', '-1', '1.5', 'nan', 'inf', 'abc'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                app.positive_count(raw)

    def test_invalid_hours(self):
        for raw in ('0', '-1', 'nan', 'inf', '-inf', '1e309', '1e100', '0.00000000001', 'bad'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                app.valid_hours(raw)
        self.assertEqual(app.valid_hours('6000'), 6000)

    def test_bad_input_does_not_authenticate_or_change_state(self):
        with patch.object(app.State, "load", return_value=app.State()):
            instance = app.App()
        instance.state = app.State()
        instance.games = [app.Game('1', 'One', 'one.exe')]
        for replies in (['0'], ['2'], ['1', 'nan']):
            with self.subTest(replies=replies), patch('builtins.input', side_effect=replies), patch.object(instance, '_require_ready') as auth, patch.object(instance.state, 'save') as save, contextlib.redirect_stdout(io.StringIO()):
                instance.claim_games()
                auth.assert_not_called()
                save.assert_not_called()

    def test_catalog_structure_is_validated(self):
        for raw in ('{}', 'null', '123'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                app._parse_games(raw)
        self.assertEqual(app._parse_games('[null, {"id":"1","executables":null}, {"id":"2","executables":[null]}]'), [])


class DryRunTests(unittest.TestCase):
    def test_preview_is_offline_and_does_not_load_or_save_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / 'games.json'
            catalog.write_text(json.dumps([{'id': str(i), 'name': str(i), 'executables': [{'os': 'win32', 'name': 'game.exe'}]} for i in (1, 2)]))
            output = io.StringIO()
            with patch.object(sys, 'argv', ['kanashi', '--dry-run', '--games-file', str(catalog), '--count', '2', '--hours', '3']), patch.object(app, 'open_url', side_effect=AssertionError('network')), patch.object(app.State, 'load', side_effect=AssertionError('state read')), patch.object(app.State, 'save', side_effect=AssertionError('state write')), contextlib.redirect_stdout(output):
                app.main()
            result = json.loads(output.getvalue())
            self.assertTrue(result['dry_run'])
            self.assertEqual(len(result['events']), 6)
            self.assertNotIn('token', result)
            self.assertEqual(result['events'][2]['properties']['duration_tracked_ms'], 10_800_000)

    def test_count_exceeding_catalog_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'games.json'
            path.write_text('[]')
            with self.assertRaises(ValueError):
                app.dry_run(path, 1, 1)

    def test_non_preview_flags_cannot_be_silently_ignored(self):
        with patch.object(sys, 'argv', ['kanashi', '--count=2']), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exit:
            app.main()
        self.assertEqual(exit.exception.code, 2)


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'state.json'
        patcher = patch.object(app, 'STATE_FILE', self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.games = [app.Game(str(i), str(i), 'game.exe') for i in range(4)]
        self.state = app.State()
        self.state.begin_run(self.games, 2)

    def test_only_accepted_games_update_totals_and_resume_excludes_them(self):
        self.state.begin_batch(self.games[:2])
        self.state.finish_batch(self.games[:2], 204)
        self.state.begin_batch(self.games[2:3])
        self.state.finish_batch(self.games[2:3], 403)
        loaded = app.State.load()
        self.assertEqual(loaded.total_games_claimed, 2)
        self.assertEqual(loaded.total_hours_claimed, 4)
        self.assertEqual(loaded.used_games, ['0', '1'])
        self.assertEqual([g.id for g in loaded.resumable_games()], ['2', '3'])
        loaded.finish_batch(self.games[:2], 204)
        self.assertEqual(loaded.total_games_claimed, 2)  # Idempotent accounting.

    def test_crashed_inflight_and_network_failures_never_auto_replay(self):
        self.state.begin_batch(self.games[:1])
        self.state.begin_batch(self.games[1:2])
        self.state.finish_batch(self.games[1:2], 0)
        loaded = app.State.load()
        self.assertEqual([g.id for g in loaded.resumable_games()], ['2', '3'])
        self.assertEqual([e['status'] for e in loaded.pending_run['games']], ['uncertain', 'uncertain', 'pending', 'pending'])

    def test_selection_does_not_mutate_used_games(self):
        with patch.object(app.State, "load", return_value=app.State()):
            instance = app.App()
        instance.games = self.games
        instance.state.used_games = ['1', '0']
        selected = instance._select_games(3)
        self.assertEqual([g.id for g in selected], ['2', '3', '1'])
        self.assertEqual(instance.state.used_games, ['1', '0'])

    def test_atomic_save_preserves_old_file_if_replace_fails(self):
        before = self.path.read_bytes()
        self.state.total_games_claimed = 99
        with patch.object(app.os, 'replace', side_effect=OSError('disk failure')), self.assertRaises(OSError):
            self.state.save()
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob('.kanashi-*.tmp')), [])

    def test_stop_saves_success_and_preserves_unsent_games(self):
        responses = iter((204, 429))
        class Client:
            def post(self, events):
                return next(responses)
        with patch.object(app, 'BATCH_SIZE', 1), patch.object(app, 'BATCH_DELAY', 0), contextlib.redirect_stdout(io.StringIO()):
            result = app.Spoofer(Client(), app.Console()).run(self.games, lambda g: [{}], self.state.begin_batch, self.state.finish_batch)
        self.assertEqual(result, 1)
        loaded = app.State.load()
        self.assertEqual(loaded.used_games, ['0'])
        self.assertEqual([g.id for g in loaded.resumable_games()], ['1', '2', '3'])

    def test_interrupt_drains_successful_request_before_exit(self):
        class Client:
            def post(self, events):
                return 204
        real_wait = app.wait
        calls = 0
        def interrupt_once(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise KeyboardInterrupt
            return real_wait(*args, **kwargs)
        with patch.object(app, 'wait', side_effect=interrupt_once), patch.object(app, 'BATCH_SIZE', 1), patch.object(app, 'BATCH_DELAY', 0), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(KeyboardInterrupt):
            app.Spoofer(Client(), app.Console()).run(self.games, lambda g: [{}], self.state.begin_batch, self.state.finish_batch)
        loaded = app.State.load()
        self.assertEqual(loaded.total_games_claimed, 1)
        self.assertEqual([g.id for g in loaded.resumable_games()], ['1', '2', '3'])


if __name__ == '__main__':
    unittest.main()
