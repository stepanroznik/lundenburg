"""Run with the project-local yt-dlp Python; all player responses are fixtures."""
import importlib.util
import pathlib
import unittest

from yt_dlp.utils import ExtractorError

spec = importlib.util.spec_from_file_location(
    'lkp_ct', pathlib.Path(__file__).parents[1] / 'tools/yt-dlp-plugins/lkp/yt_dlp_plugins/extractor/lkp_ct.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CurrentPlayerTests(unittest.TestCase):
    def extractor(self, response, formats=None):
        extractor = module.LkpCeskaTelevizeIE()
        self.requests = []

        def api(url, video_id, **options):
            self.requests.append((url, options))
            return response

        extractor._download_json = api
        extractor._extract_m3u8_formats_and_subtitles = lambda *a, **kw: (
            formats if formats is not None else [{'format_id': 'hls', 'has_drm': False}], {})
        return extractor

    def test_modern_endpoint_and_original_language_captions(self):
        response = {
            'episodeTitle': 'Krev | 5', 'playability': {'isPlayable': True},
            'streams': [{'url': 'https://media.example/master.m3u8', 'duration': 1504.92,
                         'subtitles': [{'language': 'ces', 'files': [
                             {'format': 'vtt', 'url': 'https://media.example/captions.vtt'}]}]}],
        }
        result = self.extractor(response)._real_extract(
            'https://www.ceskatelevize.cz/porady/872965-byl-jednou-jeden-zivot/290330753110005/')
        self.assertEqual(result['id'], '290330753110005')
        self.assertEqual(result['title'], 'Krev')
        self.assertEqual(result['episode_number'], 5)
        self.assertEqual(result['duration'], 1504.92)
        self.assertEqual(result['subtitles']['cs'][0]['ext'], 'vtt')
        url, options = self.requests[0]
        self.assertIn('/playlist-vod/v1/stream-data/media/external/', url)
        self.assertEqual(options['query']['canPlayDrm'], 'false')
        self.assertNotIn('X-GEOIP-COUNTRY', options['headers'])
        self.assertNotIn('iframe', url)

    def test_ambiguous_unavailable_and_protected_media_are_rejected(self):
        for response in [
            {'playability': {'isPlayable': False}},
            {'streams': []},
            {'streams': [{'url': 'https://a'}, {'url': 'https://b'}]},
            {'streams': [{'url': 'https://a', 'drm': True}]},
        ]:
            with self.subTest(response=response), self.assertRaises(ExtractorError):
                self.extractor(response)._real_extract(
                    'https://www.ceskatelevize.cz/porady/872965-show/290330753110005/')
        with self.assertRaises(ExtractorError):
            self.extractor({'streams': [{'url': 'https://a'}]}, [{'has_drm': True}])._real_extract(
                'https://www.ceskatelevize.cz/porady/872965-show/290330753110005/')

    def test_provider_errors_do_not_echo_signed_urls(self):
        with self.assertRaises(ExtractorError) as raised:
            self.extractor({'error': 'INTERNAL', 'message': 'https://media.example/?token=secret'})._real_extract(
                'https://www.ceskatelevize.cz/porady/872965-show/290330753110005/')
        self.assertNotIn('secret', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
