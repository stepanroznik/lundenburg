import React from 'react';
import { AbsoluteFill, Audio, Composition, registerRoot, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender, cancelRender } from 'remotion';
import { BrandScene } from './Scene.js';
import { brandFilms, type BrandFilm, type ProgrammeBlock } from './identity.js';

if (typeof FontFace !== 'undefined') {
  for (const [family, file] of [['LN Sans', 'DejaVuSans.ttf'], ['LN Serif', 'DejaVuSerif.ttf'], ['Fredoka', 'Fredoka.ttf']]) {
    const handle = delayRender(`Load ${family}`);
    new FontFace(family!, `url(${staticFile(`fonts/${file}`)})`).load()
      .then(font => { document.fonts.add(font); continueRender(handle); }).catch(cancelRender);
  }
}

export type BrandProps = { film: BrandFilm; block: ProgrammeBlock; audio: boolean; fps: number };
function Film(props: BrandProps) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  return <AbsoluteFill><BrandScene film={props.film} frame={frame} fps={fps} block={props.block}/>
    {props.audio && <Audio src={staticFile(`audio/${props.film}.wav`)}/>}</AbsoluteFill>;
}
registerRoot(() => <Composition id="StationIdentity" component={Film} width={1920} height={1080} fps={30} durationInFrames={300}
  defaultProps={{ film: 'evening', block: 'heimat', audio: true, fps: 30 } as BrandProps}
  calculateMetadata={({ props }) => ({ fps: props.fps, durationInFrames: Math.round(brandFilms[props.film].seconds * props.fps) })}/>);
