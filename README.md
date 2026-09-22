# n8n-nodes-transcriptfetch

This is an n8n community node for [TranscriptFetch](https://transcriptfetch.com) - the video transcript API for AI.

Fetch transcripts from **YouTube, TikTok & Instagram** - with automatic AI transcription when captions don't exist - directly inside your n8n workflows. Structured JSON output with per-segment timestamps, built for RAG, agents, and LLM pipelines.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. Search for `n8n-nodes-transcriptfetch`.

## Credentials

Sign up at [transcriptfetch.com](https://transcriptfetch.com) and create an API key in the [dashboard](https://transcriptfetch.com/app). Add it as a **TranscriptFetch API** credential in n8n.

Billing is per-credit: a successful caption fetch costs 1 credit, failed or blocked fetches are never charged, and every account gets 50 free credits a month. Videos without captions are transcribed from audio automatically — short videos typically finish in about 30 seconds — and are billed once, on delivery of the finished transcript, at the audio-transcription rate (see [pricing](https://transcriptfetch.com/pricing)).

## Trigger

**TranscriptFetch Trigger** starts a workflow when a YouTube channel, TikTok profile or Instagram account publishes a new video, and hands you the transcript in the same step, so you don't need an RSS Feed Trigger plus a separate transcript call.

- **Channel** - a YouTube `@handle`, `/channel/UC…` URL or `UC…` ID, a TikTok `@profile`, or an Instagram account URL to watch.
- **Include Transcript** - fetch each new video's transcript and attach it (on by default).
- **Max Videos Per Poll** - how far back each poll looks. Raise it for channels that publish several videos between polls.

**Watching a channel is free.** Each poll sends the newest video ID it has already seen, and a poll that finds nothing new costs no credits — so you're only charged when a video actually appears (1 credit for its transcript). n8n also doesn't count a quiet poll as an execution, so a watched channel doesn't burn your workflow quota either.

When the workflow is first activated the trigger records where the channel stands and emits nothing, so turning it on doesn't replay the entire back catalogue. That one baseline poll costs 1 credit; every quiet poll after it is free. New videos are emitted oldest-first.

**Test step** returns the channel's latest video so you have real data to build downstream nodes against, without waiting for an upload. It leaves the watermark alone, so activating the workflow afterwards still starts clean.

Each item carries the video metadata (`videoId`, `platform`, `url`, `title`, `channel`, `duration`, `publishedAt`, `thumbnailUrl`) plus a `transcriptStatus`:

| `transcriptStatus` | Meaning |
| --- | --- |
| `ok` | `text` and `segments` are populated; `source` says whether they came from `captions` or `audio` |
| `processing` | No captions existed and the audio transcription is still running; poll `pollUrl` for the result |
| `unavailable` | The transcript couldn't be fetched; see `reason` |
| `skipped` | **Include Transcript** was off |

## Operations

### Transcript

- **Get Video Transcript** - transcript for a YouTube, TikTok or Instagram video, or a direct media file URL. Options: **Mode** (`auto` reads captions and transcribes the audio when there are none; `captions` never transcribes; `audio` always does), **Timestamps** (segments with `start`, `duration`, `text`, or one joined `text`), **Wait for Audio Transcription** (on by default: when the API answers with a job the node polls it, free, and returns the finished transcript; raise **Max Wait** for long videos, or turn it off to get the `job_id` and `poll_url` back immediately), and **Callback URL** (have the finished transcript POSTed to you instead).
- **Get Transcripts (Batch)** - many transcripts in one call: up to 50, or 500 on Mega and Scale. Entries without captions come back as `processing` jobs charged on delivery; re-send the batch once they have finished, or set **Mode** to `captions` to have them fail instead.
- **List Channel Videos** - the latest videos of a YouTube channel, TikTok profile or Instagram account. **Cursor** pages through the listing; **Since Video ID** trims it to what is newer than a video you have already seen, and a page with nothing newer is free.
- **List Playlist Videos** - the videos of a YouTube or TikTok playlist, with **Cursor** paging.
- **Search Videos** - keyword search on YouTube, TikTok or Instagram (**Platform**), with **Cursor** paging. Every result's `url` can go straight into the transcript operations.

All operations call the v2 API and return its envelope: `ok`, `request_id`, `data` and `usage` (credits spent and balance). Transcripts carry `video_id`, `url`, `platform`, `title`, `channel`, `duration`, `language`, `thumbnail_url`, `source` (`captions` or `audio`) and the text.

The node is also marked **usable as a tool**, so n8n AI Agent nodes can call it directly.

## Resources

- [TranscriptFetch API documentation](https://transcriptfetch.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
