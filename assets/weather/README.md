# Regional map

Run `npm run weather:map` once to download OpenStreetMap railway and river
geometry for Brno, Lundenburg/Břeclav, Wien and Bratislava. The composition
projects real coordinates into the studio screen, omits roads, and overlays
its own Lundenburg label. It does not use the supplied generated illustration.

`region.json` is a reusable offline snapshot; keep it with the deployment.
Data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
(Open Database License 1.0). Attribution is also visible in the programme.
The renderer never contacts a tile server or Overpass while rendering.

Characters are layered, deterministic SVG components in
`src/weather/video/Character.tsx`, rather than flattened weather variants.
