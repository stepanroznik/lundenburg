# Small educational classifier audit — 9 October 2026

Reviewed ten saved decisions against the exact cached source metadata used for
classification. No new model requests, transcripts or video inspection.
This is a targeted spot check, not an accuracy benchmark; the suggested seed
ranks are editorial expectations, not ground truth.

At the snapshot: 159 normal uploads classified, with 42 A, 90 B and 27 C;
no A+ or D. Thirteen deterministic X decisions are separate. One C was a
conservative fallback after an invalid successful response.

| Upload | Decision | Assessment |
|---|---|---|
| Rachel: Play Street Museum (`w264Mn-2MnQ`) | A, episode | Supported learning goals; venue name does not cause rejection. |
| Rachel: Friendship & Social Skills (`2dDpryw3z5w`) | A, episode | Coherent social learning; 61-minute duration is accepted. |
| Rachel: Speech Practice (`xkYved-ucGg`) | C | Likely false rejection. Metadata specifies first words, sentences, gestures and interactive play; no reuse evidence. Reasoning appears overly suspicious of Rachel's originality. |
| Rachel: Christmas Songs (`w1lRsjY2EmI`) | B, compilation, Christmas | Supported seasonal songs and learning sections; compilation is not automatically rejected. |
| Rachel: In and Out (`bIWT6RCMk-o`) | B, episode | Topic is supported, but EPG copy includes commentary about the absence of compilation evidence. That belongs in the reasoning field. |
| Josi: 60-minute learning bundle (`NEv0X0p41b8`) | C, compilation | Correctly identifies explicitly repackaged older videos. |
| Josi: Surprise Box (`K5kiGoKQuuQ`) | B, episode | Useful original speech learning; B seems conservative relative to the seed suggestion A+. Still eligible for Josi. |
| Josi: Morning Routine (`ZlO2YmtCOmY`) | B, episode | Grounded metadata and year-round status; again conservative relative to suggested A+. |
| Josi: Four Seasons (`Gzgs6Fz8ZCQ`) | B, no seasonal tags | Correctly distinguishes teaching seasons from a season-specific programme. |
| Josi: Bubble Pop (`qWhyIw9ysSQ`) | B, interstitial | Correctly retains a short standalone educational song. |

The classifier is useful for curation and metadata, but the upper ranks are
not well calibrated to our editorial expectations. It sometimes treats the
absence of proof of originality as evidence against a clearly described
learning programme. A-only acquisition therefore may miss worthwhile future
Rachel uploads. Metadata cannot establish actual footage overlap or teaching
quality; existing deterministic duplicate detection remains authoritative.

The follow-up approved by the user is implemented in `educational-v3`: concrete
A/A+ educational criteria, lower priority for standalone song performances,
explicit distinction between structured teaching through music and a simple
song, no unsupported suspicion of reuse, and viewer-facing EPG copy.
These instructions apply to previously unclassified uploads. Historical
decisions keep their original prompt version and are never reclassified just
because the prompt changed. No cached ranking or catalogue entry was changed
by this audit, and no second-pass classification was performed. The revised
prompt's real-world calibration remains to be assessed on future uploads.
