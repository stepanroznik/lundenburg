import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Intermission, type SkitProps } from './Show.js';
import '../../weather/video/font.js';
registerRoot(() => <Composition id="Intermission" component={Intermission} fps={30} width={1920} height={1080} durationInFrames={150} calculateMetadata={({ props }) => ({ durationInFrames: props.film.durationInFrames })} defaultProps={{} as SkitProps}/>);
