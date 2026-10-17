// Served separately so the Cast callback is installed before Google's SDK loads.
export const castPlayerJs = `(() => {
  const controls = document.getElementById('cast-controls');
  const hint = document.getElementById('cast-hint');
  const remoteControls = document.getElementById('cast-remote');
  const pauseButton = document.getElementById('cast-pause');
  const stopButton = document.getElementById('cast-stop');
  const findButton = document.getElementById('cast-find');
  let context, remote, controller, active = false, loadingSession;
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
  async function load(session, resumed) {
    if (loadingSession === session) return;
    if (resumed && ownMedia(session)) { connected(session); return; }
    loadingSession = session;
    // Reserve playback for the TV throughout loading and buffering.
    localState(true);
    hint.textContent = 'Connecting the live stream to your TV…';
    try {
      const response = await fetch('/api/cast', { method: 'POST', headers: { 'X-LKP-Cast': '1' }, credentials: 'same-origin' });
      if (!response.ok) throw new Error('access');
      const link = await response.json();
      if (context.getCurrentSession() !== session) return;
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
      if (context.getCurrentSession() === session) connected(session);
    } catch {
      if (context.getCurrentSession() === session) {
        // Keep browser playback suspended until the user disconnects.
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
        // Receivers report unloaded during loading/buffering too. This does
        // not mean the Cast session ended, so never restart local playback.
        hint.textContent = 'TV playback is interrupted. Stop casting and reconnect to try again.';
      }
    });
    pauseButton.addEventListener('click', () => controller.playOrPause());
    stopButton.addEventListener('click', () => context.endCurrentSession(true));
    updateState();
    const session = context.getCurrentSession();
    if (session) void load(session, true);
  };
})();`;
