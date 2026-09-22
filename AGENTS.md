# Lundenburg Kids Premium

## Production Pi

Use `ssh lkp-pi` to connect to the Raspberry Pi without a password. The active LKP working copy on the Pi is `/home/lundenburg/lundenburg`.

Never add SSH passwords, API keys, stream passwords, or their values to source control, `AGENTS.md`, skills, logs, shell command output, or chat replies.

## Runtime credentials

The git-ignored, mode-600 credential file is `runtime/weather/credentials.env` in both this repository and the active Pi working copy. It contains `ELEVENLABS_API_KEY` and `OPENAI_API_KEY`.

`src/weather/speech.ts` reads the ElevenLabs key from that file for uncached spoken weather and voiced skits. OpenAI is not used by the current weather/intermission pipeline, but its key is stored there for future LKP work.

The root-owned `/etc/lkp-stream.env` holds Internet-stream credentials for systemd. Do not print it; inspect only variable names and permissions if maintenance requires it.

## Operating rule

Read `README.md`, `INTERMISSIONS.md`, and the `$lkp-show-production` skill for production work. Do not start, stop, publish, schedule, or render broadcast assets unless the current request explicitly asks for it.
