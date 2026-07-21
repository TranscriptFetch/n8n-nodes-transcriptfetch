# n8n-nodes-transcriptfetch

This is an n8n community node for [TranscriptFetch](https://transcriptfetch.com) - the video & web data API for AI.

Fetch transcripts from **YouTube, TikTok, Instagram, X (Twitter) & Facebook**, and convert **any web page to clean Markdown** - directly inside your n8n workflows. Structured JSON output with per-segment timestamps, built for RAG, agents, and LLM pipelines.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. Search for `n8n-nodes-transcriptfetch`.

## Credentials

Sign up at [transcriptfetch.com](https://transcriptfetch.com) and create an API key in the [dashboard](https://transcriptfetch.com/app). Add it as a **TranscriptFetch API** credential in n8n.

Billing is usage-based: 1 credit per successful response. Failed, blocked, or no-transcript fetches are never charged.

## Operations

### Transcript

- **Get Video Transcript** - transcript for a YouTube, TikTok, Instagram, X, or Facebook video (text + timestamped segments). When no captions exist, audio is transcribed automatically.
- **Get Transcripts (Batch)** - up to 50 video transcripts in one call.
- **List Channel Videos** - resolve a channel into a list of videos.
- **List Playlist Videos** - resolve a playlist into a list of videos.
- **Search Videos** - resolve a keyword search into a list of videos.

### Web

- **Scrape Page to Markdown** - any http(s) URL as clean Markdown (navigation, ads, and boilerplate removed).
- **Map Site Links** - list the same-site links reachable from a URL.
- **Crawl Site to Markdown** - breadth-first crawl returning Markdown for every readable page.

The node is also marked **usable as a tool**, so n8n AI Agent nodes can call it directly.

## Resources

- [TranscriptFetch API documentation](https://transcriptfetch.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
