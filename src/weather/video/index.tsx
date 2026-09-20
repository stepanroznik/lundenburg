import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { WeatherShow, type ShowProps } from './Show.js';
const Root = () => <Composition id="Weather" component={WeatherShow} fps={30} width={1920} height={1080} durationInFrames={90} calculateMetadata={({ props }) => ({ durationInFrames: props.episode.durationInFrames })} defaultProps={{} as ShowProps}/>;
registerRoot(Root);
