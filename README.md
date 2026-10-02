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
- **Check Every** - how often TranscriptFetch checks the channel: once a day on any plan, or every 6 hours, hour or 15 minutes on a paid plan.
- **Include Transcript** - attach each new video's transcript (on by default).
- **YouTube Tab** - watch a YouTube channel's videos, Shorts or live streams.

Since 0.5.0 the trigger runs on a [TranscriptFetch monitor](https://transcriptfetch.com/docs/monitors): activating the workflow creates a monitor that checks the channel on TranscriptFetch's schedule and POSTs each new video to the workflow's webhook URL, signed with the monitor's secret (the trigger rejects anything unsigned). Deactivating the workflow deletes the monitor. Changing the node's settings replaces the monitor on the next activation.

**Billing.** Every check costs 1 credit, whether or not it finds a new video, and so does the first check when the workflow is activated, which records what is already on the channel so the back catalogue is not replayed. A daily check uses about 30 credits a month. A caption transcript costs 1 credit; a video without captions is transcribed from its audio at 1 credit per started 5 minutes. Brand-new YouTube uploads usually get captions a little after they go live, so the monitor waits for them before falling back to audio.

**The webhook URL must be public HTTPS.** n8n Cloud always is. A self-hosted instance needs `WEBHOOK_URL` set to a public `https://` address (a reverse proxy or a tunnel); otherwise activation fails with a message saying so. Without a public URL, run the TranscriptFetch node's **List Channel Videos** on a Schedule Trigger instead.

Each item carries an `event` field and the video metadata (`videoId`, `url`, `title`, `channel`, `duration`, `publishedAt`, `platform`, `eventId`, `monitorId`, `creditsSpent`), plus a `transcriptStatus`:

| `transcriptStatus` | Meaning |
| --- | --- |
| `ok` | `text` and `segments` are populated; `source` says whether they came from `captions` or `audio` |
| `processing` | The transcript is still coming (captions not out yet, or audio transcription running). It arrives later as its own item with `event: "transcript"` and the same `videoId` |
| `unavailable` | The transcript couldn't be fetched; see `reason` and `message` |
| `skipped` | **Include Transcript** was off |

Items with `event: "video"` are new uploads, oldest first. Items with `event: "transcript"` are transcripts that finished after their video was reported.

Upgrading from 0.4.x: the trigger is now version 2. Re-add it to existing workflows; the old polling version is gone.

## Operations

### Transcript

- **Get Video Transcript** - transcript for a YouTube, TikTok or Instagram video, or a direct media file URL. Options: **Mode** (`auto` reads captions and transcribes the audio when there are none; `captions` never transcribes; `audio` always does), **Timestamps** (segments with `start`, `duration`, `text`, or one joined `text`), **Wait for Audio Transcription** (on by default: when the API answers with a job the node polls it, free, and returns the finished transcript; raise **Max Wait** for long videos, or turn it off to get the `job_id` and `poll_url` back immediately), and **Callback URL** (have the finished transcript POSTed to you instead).
- **Get Transcripts (Batch)** - many transcripts in one call: up to 50, or 500 on Mega and Scale. Entries without captions come back as `processing` jobs charged on delivery; re-send the batch once they have finished, or set **Mode** to `captions` to have them fail instead.
- **List Channel Videos** - the latest videos of a YouTube channel, TikTok profile or Instagram account. **Cursor** pages through the listing; **Since Video ID** trims it to what is newer than a video you have already seen; each such poll costs 1 credit, whether or not it finds new videos.
- **List Playlist Videos** - the videos of a YouTube or TikTok playlist, with **Cursor** paging.
- **Search Videos** - keyword search on YouTube, TikTok or Instagram (**Platform**), with **Cursor** paging. Every result's `url` can go straight into the transcript operations.

All operations call the v2 API and return its envelope: `ok`, `request_id`, `data` and `usage` (credits spent and balance). Transcripts carry `video_id`, `url`, `platform`, `title`, `channel`, `duration`, `language`, `thumbnail_url`, `source` (`captions` or `audio`) and the text.

The node is also marked **usable as a tool**, so n8n AI Agent nodes can call it directly.

## Resources

- [TranscriptFetch API documentation](https://transcriptfetch.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
