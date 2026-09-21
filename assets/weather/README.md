# Regional map

Run `npm run weather:map` once to download OpenStreetMap railway and river
geometry for Brno, Lundenburg/Břeclav, Wien and Bratislava. The composition
projects real coordinates into the studio screen, omits roads, and overlays
its own Lundenburg label. It does not use the supplied generated illustration.

`region.json` is a reusable offline snapshot; keep it with the deployment.
Data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
(Open Database License 1.0). Attribution is also visible in the programme.
The renderer never contacts a tile server or Overpass while rendering.

The atlas adds stylized landmarks, village symbols at real settlement coordinates,
and illustrative tree clusters/fields. These decorative areas are not a precise
land-cover map. Real river/rail geometry remains beneath them, with paired rails
and sleeper marks. `atlas-cache.tsx` rasterizes this static scenery once at twice
its display resolution; weather cards, characters and highlighting stay animated.
Attribution is shown in the closing credits rather than throughout the forecast.

`borders.json` contains cropped country boundaries from Natural Earth's public-domain
1:10m [Admin 0 land boundaries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_boundary_lines_land.geojson).
They are a subtle geographic reference, not a survey of legal boundaries.

`fonts/Fredoka.ttf` is the bundled Fredoka variable font from
[Google Fonts](https://github.com/google/fonts/tree/main/ofl/fredoka), under the
SIL Open Font License in `fonts/OFL.txt`. Fonts and borders are local assets;
rendering requires no font or map downloads.

Characters are layered, deterministic SVG components in
`src/weather/video/Character.tsx`, rather than flattened weather variants.
