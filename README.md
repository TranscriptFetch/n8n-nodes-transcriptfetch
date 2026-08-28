# n8n-nodes-transcriptfetch

This is an n8n community node for [TranscriptFetch](https://transcriptfetch.com) - the video transcript API for AI.

Fetch transcripts from **YouTube, TikTok & Instagram** - with automatic AI transcription when captions don't exist - directly inside your n8n workflows. Structured JSON output with per-segment timestamps, built for RAG, agents, and LLM pipelines.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. Search for `n8n-nodes-transcriptfetch`.

## Credentials

Sign up at [transcriptfetch.com](https://transcriptfetch.com) and create an API key in the [dashboard](https://transcriptfetch.com/app). Add it as a **TranscriptFetch API** credential in n8n.

Billing is per-credit: a successful caption fetch costs 1 credit, failed or blocked fetches are never charged, and every account gets 100 free credits a month. Videos without captions are transcribed from audio automatically — short videos typically finish in about 30 seconds — and are billed once, on delivery of the finished transcript, at the audio-transcription rate (see [pricing](https://transcriptfetch.com/pricing)).

## Trigger

**TranscriptFetch Trigger** starts a workflow when a YouTube channel publishes a new video — and hands you the transcript in the same step, so you don't need an RSS Feed Trigger plus a separate transcript call.

- **Channel** - the `@handle`, `/channel/UC…` URL, or `UC…` ID to watch.
- **Include Transcript** - fetch each new video's transcript and attach it (on by default).
- **Max Videos Per Poll** - how far back each poll looks. Raise it for channels that publish several videos between polls.

**Watching a channel is free.** Each poll sends the newest video ID it has already seen, and a poll that finds nothing new costs no credits — so you're only charged when a video actually appears (1 credit for its transcript). n8n also doesn't count a quiet poll as an execution, so a watched channel doesn't burn your workflow quota either.

When the workflow is first activated the trigger records where the channel stands and emits nothing, so turning it on doesn't replay the entire back catalogue. That one baseline poll costs 1 credit; every quiet poll after it is free. New videos are emitted oldest-first.

**Test step** returns the channel's latest video so you have real data to build downstream nodes against, without waiting for an upload. It leaves the watermark alone, so activating the workflow afterwards still starts clean.

Each item carries the video metadata plus a `transcriptStatus`:

| `transcriptStatus` | Meaning |
| --- | --- |
| `ok` | `text` and `segments` are populated |
| `processing` | No captions existed, so audio transcription was queued — poll `pollUrl` for the result |
| `unavailable` | The transcript couldn't be fetched; see `reason` |
| `skipped` | **Include Transcript** was off |

## Operations

### Transcript

- **Get Video Transcript** - transcript for a YouTube, TikTok, or Instagram video (text + timestamped segments). When no captions exist, audio is transcribed automatically.
- **Get Transcripts (Batch)** - up to 50 video transcripts in one call.
- **List Channel Videos** - resolve a channel into a list of videos.
- **List Playlist Videos** - resolve a playlist into a list of videos.
- **Search Videos** - resolve a keyword search into a list of videos.

The node is also marked **usable as a tool**, so n8n AI Agent nodes can call it directly.

## Resources

- [TranscriptFetch API documentation](https://transcriptfetch.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
