// Served separately so the Cast callback is installed before Google's SDK loads.
export const castPlayerJs = `(() => {
  const controls = document.getElementById('cast-controls');
  const hint = document.getElementById('cast-hint');
  const remoteControls = document.getElementById('cast-remote');
  const pauseButton = document.getElementById('cast-pause');
  const stopButton = document.getElementById('cast-stop');
  const findButton = document.getElementById('cast-find');
  let context, remote, controller, active = false, loadingSession;
  let bufferSession, bufferDeadline = 0, bufferingSince = 0, lastRecovery = -Infinity, seeking = false, seekDeadline = 0;
  const pickerFailure = error => {
    const code = typeof error === 'string' ? error : error && (error.code || error.name);
    if (code === 'cancel') return 'Device selection cancelled. Choose Find Chromecast to try again.';
    if (code === 'NotAllowedError' || code === 'not_allowed') return 'Chrome blocked device discovery. Allow Nearby devices for Chrome and local network access for this site, then try again.';
    if (code === 'receiver_unavailable' || code === 'NotFoundError') return 'Chrome found no Chromecast. On Android, check Settings → Apps → Chrome → Permissions → Nearby devices, then reopen Chrome.';
    if (code === 'timeout' || code === 'TimeoutError') return 'The Chromecast search timed out. Try Find Chromecast again.';
    return 'Chrome could not open the Chromecast chooser. Check Chrome’s Nearby devices permission, then try again.';
  };
  const localState = value => {
    active = value;
    if (!value) { bufferSession = undefined; bufferingSince = 0; seeking = false; }
    remoteControls.hidden = !value;
    window.dispatchEvent(new CustomEvent('lkp-cast-state', { detail: { active: value } }));
  };
  const ownMedia = session => {
    const media = session.getMediaSession();
    if (!media || !media.media) return false;
    try {
      const url = new URL(media.media.contentId);
      return url.origin === location.origin && url.pathname.startsWith('/cast/');
    } catch { return false; }
  };
  const connected = session => {
    localState(true);
    hint.textContent = 'Casting live to ' + session.getCastDevice().friendlyName;
  };
  // Use the receiver's media timeline, never wall-clock time. Staying another
  // 16 seconds behind its safe edge gives slow Wi-Fi deliveries room to finish.
  const seekBuffered = (session, recovering) => {
    const media = session.getMediaSession();
    const range = media && (media.getEstimatedLiveSeekableRange?.() || media.liveSeekableRange);
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end - range.start < 20 || !media.seek) return false;
    const target = Math.max(range.start + 2, range.end - 16);
    const position = media.getEstimatedTime?.() ?? media.currentTime;
    if (!recovering && (!Number.isFinite(position) || position <= target + 4)) return false;
    const request = new chrome.cast.media.SeekRequest();
    request.currentTime = target;
    // Omitting resumeState preserves the receiver's current pause/play choice.
    seeking = true;
    seekDeadline = Date.now() + 15000;
    media.seek(request, () => {
      seeking = false;
      if (recovering && active && context.getCurrentSession() === session && ownMedia(session)) connected(session);
    }, () => {
      seeking = false;
      if (recovering && context.getCurrentSession() === session && active) void load(session, false, true);
    });
    return true;
  };
  setInterval(() => {
    const session = context && context.getCurrentSession();
    if (!active || !session || loadingSession || !ownMedia(session)) { bufferingSince = 0; return; }
    const media = session.getMediaSession();
    if (remote?.isPaused || media.playerState === 'PAUSED') { bufferSession = undefined; bufferingSince = 0; return; }
    const now = Date.now();
    if (seeking && now > seekDeadline) seeking = false;
    if (bufferSession === session && !seeking) {
      if (now > bufferDeadline || seekBuffered(session, false)) bufferSession = undefined;
    }
    if (media.playerState !== 'BUFFERING') { bufferingSince = 0; return; }
    if (!bufferingSince) bufferingSince = now;
    if (now - bufferingSince < 20000 || now - lastRecovery < 60000 || seeking) return;
    lastRecovery = now;
    bufferingSince = 0;
    bufferSession = undefined;
    hint.textContent = 'TV playback stalled; reconnecting the live stream…';
    if (!seekBuffered(session, true)) void load(session, false, true);
  }, 3000);
  async function load(session, resumed, recovering = false) {
    const expectedMedia = session.getMediaSession();
    if (recovering && (!active || !ownMedia(session) || remote?.isPaused || expectedMedia.playerState === 'PAUSED')) return;
    if (loadingSession === session) return;
    if (resumed && ownMedia(session)) { connected(session); return; }
    loadingSession = session;
    hint.textContent = 'Connecting the live stream to your TV…';
    try {
      const response = await fetch('/api/cast', { method: 'POST', headers: { 'X-LKP-Cast': '1' }, credentials: 'same-origin' });
      if (!response.ok) throw new Error('access');
      const link = await response.json();
      if (context.getCurrentSession() !== session) return;
      if (recovering && (!active || !ownMedia(session) || session.getMediaSession() !== expectedMedia || remote?.isPaused || expectedMedia.playerState === 'PAUSED')) return;
      const media = new chrome.cast.media.MediaInfo(new URL(link.path, location.origin).href, 'application/vnd.apple.mpegurl');
      media.streamType = chrome.cast.media.StreamType.LIVE;
      media.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.TS;
      media.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
      media.metadata = new chrome.cast.media.GenericMediaMetadata();
      media.metadata.title = 'Lundenburg Kids Premium';
      media.metadata.subtitle = 'Live from Lundenburg';
      const request = new chrome.cast.media.LoadRequest(media);
      request.autoplay = true;
      await session.loadMedia(request);
      if (context.getCurrentSession() === session) {
        bufferSession = session;
        bufferDeadline = Date.now() + 30000;
        connected(session);
      }
    } catch {
      if (context.getCurrentSession() === session) {
        localState(false);
        hint.textContent = 'Could not start casting. Check your TV connection, then stop casting and try again.';
      }
    } finally { if (loadingSession === session) loadingSession = undefined; }
  }
  window.__onGCastApiAvailable = available => {
    if (!available) {
      hint.textContent = 'Casting is unavailable here. Use Chrome on the same Wi-Fi as your TV.';
      return;
    }
    context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    controls.hidden = false;
    findButton.disabled = false;
    findButton.addEventListener('click', async () => {
      findButton.disabled = true;
      hint.textContent = 'Choose your Chromecast in the device chooser…';
      try {
        // Call synchronously within the click gesture, even when background
        // availability says NO_DEVICES_AVAILABLE. Never await a fetch first.
        await context.requestSession();
      } catch (error) { hint.textContent = pickerFailure(error); }
      finally { findButton.disabled = false; }
    });
    const updateState = () => {
      if (active) return;
      hint.textContent = context.getCastState() === cast.framework.CastState.NO_DEVICES_AVAILABLE
        ? 'Tap Find Chromecast to search. If Chrome finds no devices, check its Nearby devices permission.'
        : 'Choose Find Chromecast or the Cast button to watch on your TV.';
    };
    context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, updateState);
    context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, event => {
      const state = cast.framework.SessionState;
      if (event.sessionState === state.SESSION_STARTED || event.sessionState === state.SESSION_RESUMED) {
        const session = context.getCurrentSession();
        if (session) void load(session, event.sessionState === state.SESSION_RESUMED);
      } else if (event.sessionState === state.SESSION_ENDED || event.sessionState === state.SESSION_START_FAILED) {
        localState(false);
        updateState();
      }
    });
    remote = new cast.framework.RemotePlayer();
    controller = new cast.framework.RemotePlayerController(remote);
    controller.addEventListener(cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
      pauseButton.textContent = remote.isPaused ? 'Resume on TV' : 'Pause on TV';
    });
    controller.addEventListener(cast.framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED, () => {
      if (active && !remote.isMediaLoaded) {
        localState(false);
        hint.textContent = 'TV playback ended. Stop casting and reconnect to return to the live stream.';
      }
    });
    pauseButton.addEventListener('click', () => controller.playOrPause());
    stopButton.addEventListener('click', () => context.endCurrentSession(true));
    updateState();
    const session = context.getCurrentSession();
    if (session) void load(session, true);
  };
})();`;
