import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
// Bundled font: no network/font service dependency during unattended renders.
if (typeof FontFace !== 'undefined') {
  const handle = delayRender('Load the bundled weather-show font');
  const font = new FontFace('Fredoka', `url(${staticFile('fonts/Fredoka.ttf')})`, { weight: '300 700' });
  font.load().then(loaded => { document.fonts.add(loaded); continueRender(handle); }).catch(cancelRender);
}
