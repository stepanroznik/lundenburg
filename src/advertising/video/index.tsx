import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { AdvertisingBumper, type BumperProps } from './Show.js';
import { bumperFps, bumperFrames } from '../model.js';
import '../../weather/video/font.js';

registerRoot(() => <Composition id="AdvertisingBumper" component={AdvertisingBumper}
  fps={bumperFps} width={1920} height={1080} durationInFrames={bumperFrames} defaultProps={{} as BumperProps}/>);
