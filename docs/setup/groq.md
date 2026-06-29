# Groq (audio transcription)

The Audio Transcriber uses Groq's free Whisper API.

1. Create a free account at https://console.groq.com.
2. Create an API key (API Keys -> Create API Key).
3. Put it in `.env`: `GROQ_API_KEY=gsk_...`
4. Restart the dev server.

Notes:
- The free tier rate-limits audio seconds per hour, so a multi-hour file
  transcribes in sequential chunks with backoff. It finishes, just not instantly.
- Large files are transcoded to 16kHz mono and split into ~10-minute chunks
  locally (ffmpeg, bundled) to stay under the free-tier request size cap.
- Set `EE_TRANSCRIBE_MODEL` to override the default `whisper-large-v3-turbo`.

## Google Doc output

The transcriber writes the result to a Google Doc, which needs Drive **write**
access (`drive.file` scope). This is broader than the Sorter's read-only scope,
so after upgrading you must re-connect Google once: go to `/settings` and click
Re-auth on the Google row. `drive.file` only grants access to files this app
creates; it cannot read or change your existing Drive content.
