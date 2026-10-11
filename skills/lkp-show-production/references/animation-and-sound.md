# Animation, design, and sound

## Establish physical cause and effect

Plan every important action as a chain:

1. Anticipate and look toward the target.
2. Shift weight, walk, crouch, or bend toward it.
3. Put the hand at the prop's grip point.
4. Move the prop with the hand while it is held.
5. Release from that exact world position.
6. Let gravity, momentum, collision, or resistance determine the next motion.
7. React only after the result is visible.

Use the shared grounded rig, articulated hands, crouch, bend, stride, and world/local coordinate helpers. Keep feet on the floor during a crouch. Bend around the hips instead of translating the entire actor downward. A prop must touch the hand, rest on a surface before pickup, and return to a believable support after use.

Examples of the quality bar:

- Planting: bend down, put the plant into the soil, release it, then rise. Root the plant's sway at the soil, not at the flower head.
- Watering: the can begins on the ground or a table, follows the gripping hand, tilts to pour, and is set down.
- Umbrella splash: move the umbrella into the trajectory before impact; split the splash into droplets and sheets that deflect from its canopy.
- Ball: use beach-ball scale; rotate while airborne, then settle or roll according to contact rather than spinning in place.
- Leaves: build a pile large enough to cover the actor and keep the actor behind its foreground layer. Never delete the actor and reappear underground.
- Kite: walk to it, bend and grip, lift it, release it into wind, and track the string tension.
- Snowballs: place the ball against the palm, shape a real crouch, then wind up and throw.

Inspect hands and contact points at full frame resolution. Motion paths and code comments do not prove visual contact.

## Animate intent, not generic movement

Give the pose a readable line of action. Eyes lead attention, the head follows, the torso prepares, and limbs complete the action. Use both arms when balance, effort, celebration, or surprise naturally calls for them. Vary gestures across scenes. Do not rely on a single raised arm for every success beat.

Maintain character volume and outline during movement. White characters and white effects need a dark outline or contrasting backing. Avoid character limbs merging into light backgrounds.

Make holds deliberate. Remove constant decorative bobbing when a character should be planted, concentrating, or waiting. Small motion should express breathing, thought, wind, or weight rather than conceal a static rig.

## Design the set for the story

Stylize real places while preserving recognizable structure. Check maps or reference photographs for location-specific scenes: a town pool should include its neighbouring buildings and urban setting, not become a generic forest pool. Props must clearly resemble the intended object; replace ambiguous decoration.

For weather maps, use real or carefully modified geography. Show important railways as rails, keep country borders joined and subdued, distinguish primary and secondary transport lines, and add local landmarks without obscuring data. Keep city labels consistently placed. Make the active time period unmistakable through map state, date, and a prominent language-appropriate label.

Use the LKP palette as the core visual language:

- Primary teal `#004f4f`
- Pink `#fb1143`
- Orange `#fd6f04`
- Yellow `#fdbf11`
- Green `#79c718`
- Blue `#02aafd`

White and pale neutrals are welcome. Combine clean edges, smooth waves, and restrained rounded corners. Aim for playful children's television rather than a corporate dashboard. Give text protected space or a backing shape. Keep required map attribution legible but unobtrusive.

The broadcast system may add its own persistent channel bug, so avoid embedding an extra corner logo in programmes. Every intermission still ends on the full LKP logo. The ident should be brisk: logo parts and voices arrive in tight succession, then the complete mark holds briefly.

## Build sound around the action

Silent means no spoken language, not no audio. Use local, deterministic foley and ambience with no ElevenLabs call. Match material and action: water, leaves, wind, packed snow, rubber, soil, or wood should have distinct envelopes and textures.

Place the effect at visible contact, not near it. Use restrained ambience under longer scenes and stronger transients for impacts. Vary pitch, rhythm, duration, and texture so consecutive skits do not share the same generic swoosh or pop. A sound should help explain weight, surface, speed, or location.

Keep foley below speech and use limiting on the mix. Review audio together with video; a convincing splash with the wrong trajectory still reads as an error.

## Review decisive frames

Create a contact sheet that includes, for each action:

- anticipation;
- first contact or grip;
- maximum pose or airborne midpoint;
- impact or release;
- reaction and recovery;
- the final logo.

Check for floating props, underground feet, clipped limbs, incorrect foreground order, early expressions, blank image edges, accidental gestures, and unreadable labels. Also scrub between selected frames: a good beginning and end can hide a broken transition.
