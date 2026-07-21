import type { INodeType, INodeTypeDescription, NodeConnectionType } from 'n8n-workflow';

export class TranscriptFetch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TranscriptFetch',
		name: 'transcriptFetch',
		icon: 'file:transcriptfetch.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Video transcripts from YouTube, TikTok, Instagram, X & Facebook, plus any web page as clean Markdown',
		defaults: {
			name: 'TranscriptFetch',
		},
		usableAsTool: true,
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [
			{
				name: 'transcriptFetchApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: 'https://transcriptfetch.com',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Transcript', value: 'transcript' },
					{ name: 'Web', value: 'web' },
				],
				default: 'transcript',
			},

			// ── Transcript operations ─────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['transcript'] } },
				options: [
					{
						name: 'Get Video Transcript',
						value: 'getVideo',
						action: 'Get a video transcript',
						description:
							'Fetch the transcript for a YouTube, TikTok, Instagram, X (Twitter), or Facebook video (text + timestamped segments)',
						routing: { request: { method: 'POST', url: '/api/v1/transcripts/video' } },
					},
					{
						name: 'Get Transcripts (Batch)',
						value: 'batch',
						action: 'Get up to 50 transcripts in one call',
						description:
							'Fetch transcripts for up to 50 YouTube video IDs or URLs concurrently',
						routing: { request: { method: 'POST', url: '/api/v1/transcripts/batch' } },
					},
					{
						name: 'List Channel Videos',
						value: 'channel',
						action: 'List a channel s videos',
						description: 'Resolve a YouTube channel into a list of videos (metadata only)',
						routing: { request: { method: 'POST', url: '/api/v1/transcripts/channel' } },
					},
					{
						name: 'List Playlist Videos',
						value: 'playlist',
						action: 'List a playlist s videos',
						description: 'Resolve a YouTube playlist into a list of videos (metadata only)',
						routing: { request: { method: 'POST', url: '/api/v1/transcripts/playlist' } },
					},
					{
						name: 'Search Videos',
						value: 'search',
						action: 'Search you tube for videos',
						description: 'Resolve a keyword search into a list of videos (metadata only)',
						routing: { request: { method: 'POST', url: '/api/v1/transcripts/search' } },
					},
				],
				default: 'getVideo',
			},

			// ── Web operations ────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['web'] } },
				options: [
					{
						name: 'Scrape Page to Markdown',
						value: 'scrape',
						action: 'Scrape a web page to markdown',
						description:
							'Fetch any http(s) URL and return the main readable content as clean Markdown',
						routing: { request: { method: 'POST', url: '/api/v1/web' } },
					},
					{
						name: 'Map Site Links',
						value: 'map',
						action: 'Map a site s links',
						description: 'List the same-site links reachable from a URL',
						routing: { request: { method: 'POST', url: '/api/v1/web/map' } },
					},
					{
						name: 'Crawl Site to Markdown',
						value: 'crawl',
						action: 'Crawl a site to markdown',
						description:
							'Breadth-first crawl from a start URL, returning clean Markdown for every readable page (up to 25 per call)',
						routing: { request: { method: 'POST', url: '/api/v1/web/crawl' } },
					},
				],
				default: 'scrape',
			},

			// ── Transcript fields ─────────────────────────────────────────────
			{
				displayName: 'Video URL or ID',
				name: 'video',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				description:
					'YouTube, TikTok, Instagram, X (Twitter), or Facebook video URL - or a bare YouTube video ID',
				displayOptions: { show: { resource: ['transcript'], operation: ['getVideo'] } },
				routing: { send: { type: 'body', property: 'video' } },
			},
			{
				displayName: 'Video IDs or URLs',
				name: 'videoIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'dQw4w9WgXcQ, 9bZkp7q19f0',
				description: 'Comma-separated list of up to 50 YouTube video IDs or URLs',
				displayOptions: { show: { resource: ['transcript'], operation: ['batch'] } },
				routing: {
					send: {
						type: 'body',
						property: 'videoIds',
						value:
							'={{ $parameter["videoIds"].split(",").map(v => v.trim()).filter(v => v.length > 0) }}',
					},
				},
			},
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				required: true,
				default: '',
				placeholder: '@lexfridman',
				description: 'Channel @handle, /channel/UC… URL, or UC… ID',
				displayOptions: { show: { resource: ['transcript'], operation: ['channel'] } },
				routing: { send: { type: 'body', property: 'channel' } },
			},
			{
				displayName: 'Playlist',
				name: 'playlist',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'PLrAXtmRdnEQy6nuLMt9H1aZIuhcGOcZQ4',
				description: 'Playlist URL or playlist ID',
				displayOptions: { show: { resource: ['transcript'], operation: ['playlist'] } },
				routing: { send: { type: 'body', property: 'playlist' } },
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'how transformers work',
				description: 'Keyword search query',
				displayOptions: { show: { resource: ['transcript'], operation: ['search'] } },
				routing: { send: { type: 'body', property: 'query' } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 10,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['transcript'], operation: ['channel', 'playlist', 'search'] },
				},
				routing: { send: { type: 'body', property: 'limit' } },
			},

			// ── Web fields ────────────────────────────────────────────────────
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/article',
				description: 'The http(s) URL to fetch',
				displayOptions: { show: { resource: ['web'] } },
				routing: { send: { type: 'body', property: 'url' } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 10,
				description: 'Max number of links (map) or pages (crawl) to return',
				displayOptions: { show: { resource: ['web'], operation: ['map', 'crawl'] } },
				routing: { send: { type: 'body', property: 'limit' } },
			},
		],
	};
}
