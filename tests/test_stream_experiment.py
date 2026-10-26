import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stream_experiment as experiment
import spoofer


class StreamExperimentTests(unittest.TestCase):
    def test_preview_uses_no_auth_or_network(self):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['stream_experiment', '--guild-id', '123456789012345678',
                                        '--channel-id', '123456789012345679', '--hours', '1']), \
             patch.object(spoofer.State, 'load', side_effect=AssertionError('account state read')), \
             patch.object(spoofer, 'open_url', side_effect=AssertionError('network')), \
             contextlib.redirect_stdout(output):
            self.assertEqual(experiment.main(), 0)
        result = json.loads(output.getvalue())
        self.assertFalse(result['sent'])
        self.assertEqual([e['type'] for e in result['events']],
                         ['media_session_joined', 'video_stream_started',
                          'video_stream_heartbeat', 'video_stream_ended'])
        self.assertEqual(result['events'][2]['properties']['total_duration_ms'], 3600000)
        self.assertEqual([e['properties']['event_sequence_number'] for e in result['events']], [1, 2, 3, 4])

    def test_live_send_reports_http_only(self):
        output = io.StringIO()
        state = spoofer.State(token='fixture', cookie='cf_clearance=fixture',
                              analytics_token='fixture', fetched_at=spoofer.time.time())
        session = spoofer.Session('heartbeat', 'launch', 'props')
        with patch.object(sys, 'argv', ['stream_experiment', '--guild-id', '123456789012345678',
                                        '--channel-id', '123456789012345679', '--hours', '1', '--send']), \
             patch.object(spoofer.State, 'load', return_value=state), \
             patch.object(experiment.Session, 'new', return_value=session), \
             patch.object(experiment, 'ensure_token'), \
             patch.object(experiment.ScienceClient, 'post', return_value=204) as post, \
             contextlib.redirect_stdout(output):
            self.assertEqual(experiment.main(), 0)
        self.assertEqual(len(post.call_args.args[0]), 4)
        self.assertIn('does not verify badge progress', output.getvalue())

    def test_invalid_ids_rejected(self):
        for value in ('123', '12345678901234567x', '1' * 21):
            with self.assertRaises(Exception):
                experiment.snowflake(value)


if __name__ == '__main__':
    unittest.main()
