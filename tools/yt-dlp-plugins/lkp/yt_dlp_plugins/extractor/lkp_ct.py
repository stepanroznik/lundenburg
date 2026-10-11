"""LKP's VOD adapter for ČT's current public player API.

The bundled yt-dlp extractor still uses the retired iframe-hash endpoint.
Keep this adapter explicit (--use-extractors LkpCeskaTelevize) and release-local.
No credentials, geographic overrides, or DRM decryption are used.
"""

import re
import uuid

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError, float_or_none


class LkpCeskaTelevizeIE(InfoExtractor):
    IE_NAME = 'LkpCeskaTelevize'
    _VALID_URL = r'https://www\.ceskatelevize\.cz/porady/\d+-[^/?#]+/(?P<id>\d+)/?(?:[?#].*)?$'

    def _real_extract(self, url):
        video_id = self._match_id(url)
        data = self._download_json(
            'https://api.ceskatelevize.cz/video/v1/playlist-vod/v1/'
            f'stream-data/media/external/{video_id}', video_id,
            query={
                'canPlayDrm': 'false', 'quality': 'web', 'streamType': 'hls',
                'sessionId': str(uuid.uuid4()), 'origin': 'ivysilani',
                'client': 'iVysilaniWeb', 'clientVersion': '0.25.1',
            },
            headers={
                'Origin': 'https://player.ceskatelevize.cz',
                'Referer': 'https://player.ceskatelevize.cz/', 'X-DEVICE': 'web',
            })
        if data.get('error') == 'UNSUPPORTED_GEOLOCATION':
            self.raise_geo_restricted('ČT content is not available in your region')
        if data.get('error'):
            # Do not forward provider messages: they may include signed URLs.
            raise ExtractorError('ČT player API returned an error')
        if data.get('playability', {}).get('isPlayable') is False:
            raise ExtractorError('ČT episode is unavailable', expected=True)

        streams = [s for s in data.get('streams', []) if s.get('url')]
        if len(streams) != 1:
            raise ExtractorError('ČT player did not return one unambiguous stream')
        stream = streams[0]
        if stream.get('drm') or stream.get('hasDrm') or stream.get('drmOnly'):
            raise ExtractorError('ČT episode is DRM protected', expected=True)
        formats, subtitles = self._extract_m3u8_formats_and_subtitles(
            stream['url'], video_id, 'mp4', m3u8_id='hls', fatal=True)
        # HLS parsing marks SAMPLE-AES and unsupported encryption as DRM.
        formats = [f for f in formats if not f.get('has_drm')]
        if not formats:
            raise ExtractorError('ČT episode has no supported non-DRM formats', expected=True)
        for subtitle in stream.get('subtitles', []):
            language = {'ces': 'cs', 'cze': 'cs', 'deu': 'de', 'eng': 'en'}.get(
                subtitle.get('language'), subtitle.get('language', 'cs'))
            if language not in ('cs', 'de', 'en'):
                continue
            for file in subtitle.get('files', []):
                if file.get('format') in ('vtt', 'ttml') and file.get('url'):
                    subtitles.setdefault(language, []).append({
                        'url': file['url'], 'ext': file['format'],
                    })
        title = data.get('episodeTitle') or data.get('title') or video_id
        number = re.search(r'\|\s*(\d+)\s*$', title)
        return {
            'id': video_id,
            'title': re.sub(r'\s*\|\s*\d+\s*$', '', title),
            'episode_number': int(number.group(1)) if number else None,
            'duration': float_or_none(stream.get('duration') or data.get('duration')),
            'formats': formats, 'subtitles': subtitles,
        }
