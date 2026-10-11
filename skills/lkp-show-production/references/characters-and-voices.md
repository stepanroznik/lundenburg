# Characters, dialogue, and voices

The repository registry remains authoritative. Use this guide as the established creative baseline and update it when the registry intentionally changes.

| Character | Home / language | Personality and comic role | Voice baseline |
|---|---|---|---|
| Knurpsi | Lundenburg / German | Warm, practical beaver; loves building; quietly literal and proud of useful work | `eerdi6005Xy1VVWpejx6`, about 0.84 speed; clear, warm, energetic, child-friendly |
| Sisi | Vienna / German | Elegant White Vienna rabbit with blue eyes; precise, dignified, mildly theatrical, with dry reactions | `AAiTaAHdZuRZAfYWRq5V`, about 0.82 speed; precise and bright |
| Schalinka | Brno / Czech | Lively crocodile; bold, cheeky, expressive, and proud of being the Brno dragon | `6Aa0226VrdZ4mFzZjj82`, about 0.90 speed; lively but intelligible |
| Haluschka | Bratislava / Slovak | Gentle sheep; curious, warm, calm, and capable of quietly devastating observations | `AAiTaAHdZuRZAfYWRq5V`, about 0.88 speed; soft, flowing, and darker |

Sisi and Haluschka intentionally share a raw voice. Distinguish them through language, tempo, phrasing, energy, and subtle EQ. Avoid obvious pitch shifting.

## Write in character

- Knurpsi explains practical things earnestly. His literal confidence makes the delayed flaw or bureaucratic punchline work.
- Sisi values exact names, history, and manners. Her offence is controlled rather than frantic.
- Schalinka reacts quickly and boldly, but clarity matters more than volume. Brno pride and playful defensiveness suit her.
- Haluschka accepts odd information with warmth or mild curiosity. Do not give her hostility merely to create a reaction.

Keep exchanges short, with one idea per line. Put a pause before the reveal or reaction when the joke needs one. In silent scenes, express the same personalities through choices: who plans, who insists on precision, who rushes in, and who observes.

## Generate speech carefully

Use only the ElevenLabs timestamped TTS endpoint. Do not call voice-list or voice-metadata endpoints. Send an explicit `language_code`, and use neighbouring text context when a short line or difficult word needs stable pronunciation.

For Czech and Slovak TTS, transform character names at the speech boundary:

- `Schalinka` → `Šalinka`; vocative `Schalinko` → `Šalinko`
- `Haluschka` → `Haluška`; vocative `Haluschko` → `Haluško`

Keep the canonical spelling in catalogue text and subtitles. If a Czech or Slovak word such as *drak* receives an English sound, add language context or a pronunciation-only rewrite; never alter the visible line merely to fix synthesis.

Schalinka's expressive voice can shout, rush, or clip. For a failed line, regenerate that line with lower style, higher stability, a slightly slower speed, and useful previous/next text. Listen for the whole sentence, especially its opening and ending. Do not accept speed or excitement that makes words hard to understand.

Generate sentence-sized or natural prosodic atoms rather than isolated words. Lock the text first because every paid change creates a different asset. Cache identity must cover at least voice, model, language, transformed TTS text, speed, voice settings, context, processing profile, and lipsync method.

Normalize measured loudness rather than guessing gain. Preserve distinct EQ profiles. Derive mouth cues from the returned character alignment, and keep Knurpsi's teeth attached to the upper mouth geometry throughout open shapes.

## Time dialogue and reactions

Use actual audio duration and alignment to build the timeline. A character must not look guilty, shocked, or amused before the word that causes the reaction. Use the precise aligned word or line boundary for important beats.

Leave space after dense facts and before punchlines. Silence is part of the performance. When a scene is explicitly a waiting contest, make the wait long enough to become the joke rather than trimming it to normal dialogue pace.

Subtitles must use the exact generated canonical dialogue, without speech-to-text. Match tense to the edition: current weather uses the present; forecasts use the future or otherwise explicit forecast wording.
