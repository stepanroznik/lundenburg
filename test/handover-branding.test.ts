import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BrandScene} from '../src/branding/Scene.js';
import {brandFilms} from '../src/branding/identity.js';
import {signatureEffects} from '../src/branding/audio.js';

test('original ten-second handover transformations and their complete soundtracks are preserved',()=>{
  for(const film of ['morning','evening'] as const) {
    assert.equal(brandFilms[film].seconds,10);
    const frame=(seconds:number)=>renderToStaticMarkup(React.createElement(BrandScene,{film,frame:seconds*30,fps:30}));
    assert.notEqual(frame(1),frame(4));assert.notEqual(frame(4),frame(7));
    assert.match(frame(9),film==='morning'?/Guten Morgen, Lundenburg!/:/Der Abend gehört den Entdeckern/);
    assert.ok(signatureEffects(film).some(effect=>effect.at>6));
  }
});
