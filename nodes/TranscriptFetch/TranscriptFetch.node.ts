import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const BASE_URL = 'https://transcriptfetch.com';

/** Poll cadence for audio-transcription jobs (the API is free to poll). */
const JOB_POLL_INTERVAL_MS = 5_000;

type JobEnvelope = {
	ok?: boolean;
	status?: string;
	job_id?: string;
	poll_url?: string;
	data?: IDataObject;
	error?: IDataObject;
};

/**
 * The TranscriptFetch action node, on the v2 API.
 *
 * 0.3.x used declarative routing against /api/v1 and returned whatever the
 * server answered. 0.4.0 moved to an execute() so the node can do the one thing
 * routing cannot: when a video has no captions the API answers 202 with a job,
 * and the node now waits for that job and returns the finished transcript, so
 * a workflow never has to build its own polling loop. Long videos still hand
 * the job back if the wait runs out.
 */
export class TranscriptFetch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TranscriptFetch',
		name: 'transcriptFetch',
		icon: { light: 'file:transcriptfetch.svg', dark: 'file:transcriptfetch.dark.svg' },
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Video transcripts from YouTube, TikTok and Instagram, with automatic AI transcription when captions are missing',
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
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Transcript', value: 'transcript' }],
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
						name: 'Get Transcripts (Batch)',
						value: 'batch',
						action: 'Get many video transcripts',
						description:
							'Fetch transcripts for many videos in one call (up to 50, or 500 on Mega and Scale plans)',
					},
					{
						name: 'Get Video Transcript',
						value: 'getVideo',
						action: 'Get video transcript',
						description:
							'Fetch the transcript for a YouTube, TikTok or Instagram video, or a direct media file URL',
					},
					{
						name: 'List Channel Videos',
						value: 'channel',
						action: 'List channel videos',
						description:
							'List the latest videos of a YouTube channel, TikTok profile or Instagram account (metadata only)',
					},
					{
						name: 'List Playlist Videos',
						value: 'playlist',
						action: 'List playlist videos',
						description: 'List the videos of a YouTube or TikTok playlist (metadata only)',
					},
					{
						name: 'Search Videos',
						value: 'search',
						action: 'Search videos',
						description: 'Search YouTube, TikTok or Instagram by keyword (metadata only)',
					},
				],
				default: 'getVideo',
			},

			// ── Get Video Transcript ─────────────────────────────────────────
			{
				displayName: 'Video URL or ID',
				name: 'video',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				description:
					'YouTube, TikTok or Instagram video URL, a bare YouTube video ID, or a direct media file URL',
				displayOptions: { show: { resource: ['transcript'], operation: ['getVideo'] } },
			},
			{
				displayName: 'Options',
				name: 'videoOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['transcript'], operation: ['getVideo'] } },
				options: [
					{
						displayName: 'Callback URL',
						name: 'callbackUrl',
						type: 'string',
						default: '',
						placeholder: 'e.g. https://example.com/hooks/transcript',
						description:
							'Public HTTPS URL to POST the finished transcript to when the request escalates to audio transcription, instead of polling. The job stays pollable either way.',
					},
					{
						displayName: 'Max Wait (Seconds)',
						name: 'maxWaitSeconds',
						type: 'number',
						typeOptions: { minValue: 5, maxValue: 3600 },
						default: 300,
						description:
							'How long to wait for an audio-transcription job before returning it unfinished. Polling is free; the credits are charged once, on delivery.',
						displayOptions: { show: { waitForJob: [true] } },
					},
					{
						displayName: 'Mode',
						name: 'mode',
						type: 'options',
						options: [
							{
								name: 'Audio Only',
								value: 'audio',
								description: 'Skip captions and transcribe the audio',
							},
							{
								name: 'Auto (Captions, Then Audio)',
								value: 'auto',
								description:
									'Read captions when the platform has them and transcribe the audio when it does not',
							},
							{
								name: 'Captions Only',
								value: 'captions',
								description:
									'Read an existing caption track and fail when there is none. The only way to avoid audio transcription.',
							},
						],
						default: 'auto',
						description:
							'Where the text may come from. Caption fetches cost 1 credit; audio transcription is charged per started minute of audio, on delivery only.',
					},
					{
						displayName: 'Timestamps',
						name: 'timestamps',
						type: 'boolean',
						default: true,
						description:
							'Whether to return timestamped segments (start, duration, text). When off, the transcript comes back as one joined text string instead.',
					},
					{
						displayName: 'Wait for Audio Transcription',
						name: 'waitForJob',
						type: 'boolean',
						default: true,
						description:
							'Whether to wait when the request escalates to audio transcription (a 202 with a job) and return the finished transcript. When off, the job ID and poll URL are returned immediately.',
					},
				],
			},

			// ── Get Transcripts (Batch) ─────────────────────────────────────
			{
				displayName: 'Video IDs or URLs',
				name: 'videoIds',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. dQw4w9WgXcQ, https://www.tiktok.com/@user/video/7398765432101234567',
				description:
					'Comma-separated list of video URLs (YouTube, TikTok, Instagram) or bare YouTube IDs. Up to 50, or 500 on Mega and Scale plans.',
				displayOptions: { show: { resource: ['transcript'], operation: ['batch'] } },
			},
			{
				displayName: 'Options',
				name: 'batchOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['transcript'], operation: ['batch'] } },
				options: [
					{
						displayName: 'Mode',
						name: 'mode',
						type: 'options',
						options: [
							{
								name: 'Auto (Captions, Then Audio)',
								value: 'auto',
								description:
									'Captionless entries are transcribed from audio and come back as processing jobs, charged on delivery',
							},
							{
								name: 'Captions Only',
								value: 'captions',
								description: 'Captionless entries fail as no_transcript instead of queueing audio transcription',
							},
						],
						default: 'auto',
						description: 'Where each entry\'s text may come from',
					},
				],
			},

			// ── List Channel Videos ─────────────────────────────────────────
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. @lexfridman',
				description:
					'YouTube channel @handle, /channel/UC… URL or UC… ID, a TikTok @profile or profile URL, or an Instagram account URL',
				displayOptions: { show: { resource: ['transcript'], operation: ['channel'] } },
			},
			{
				displayName: 'Options',
				name: 'channelOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['transcript'], operation: ['channel'] } },
				options: [
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description:
							'Pagination cursor from a previous response\'s next_cursor. Leave empty for the first page.',
					},
					{
						displayName: 'Since Video ID',
						name: 'sinceVideoId',
						type: 'string',
						default: '',
						description:
							'Newest video ID you have already seen. The response is trimmed to videos newer than it, and a page with nothing newer costs no credits.',
					},
				],
			},

			// ── List Playlist Videos ────────────────────────────────────────
			{
				displayName: 'Playlist',
				name: 'playlist',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. PLrAXtmRdnEQy6nuLMt9H1aZIuhcGOcZQ4',
				description: 'YouTube or TikTok playlist URL, or a YouTube playlist ID',
				displayOptions: { show: { resource: ['transcript'], operation: ['playlist'] } },
			},
			{
				displayName: 'Options',
				name: 'playlistOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['transcript'], operation: ['playlist'] } },
				options: [
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description:
							'Pagination cursor from a previous response\'s next_cursor. Leave empty for the first page.',
					},
				],
			},

			// ── Search Videos ───────────────────────────────────────────────
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. how transformers work',
				description: 'Keyword search query',
				displayOptions: { show: { resource: ['transcript'], operation: ['search'] } },
			},
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				options: [
					{ name: 'YouTube', value: 'youtube' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'Instagram', value: 'instagram' },
				],
				default: 'youtube',
				description: 'Where to search. Every result URL is accepted by the transcript operations as-is.',
				displayOptions: { show: { resource: ['transcript'], operation: ['search'] } },
			},
			{
				displayName: 'Options',
				name: 'searchOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['transcript'], operation: ['search'] } },
				options: [
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description:
							'Pagination cursor from a previous response\'s next_cursor. Leave empty for the first page.',
					},
				],
			},

			// ── Shared ──────────────────────────────────────────────────────
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['transcript'], operation: ['channel', 'playlist', 'search'] },
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const result = await runOperation.call(this, operation, i);
				out.push({ json: result, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				// request() already wraps HTTP failures in NodeApiError; anything else
				// is ours. Both are re-raised as node errors so n8n shows the item.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}

async function runOperation(this: IExecuteFunctions, operation: string, i: number): Promise<IDataObject> {
	switch (operation) {
		case 'getVideo': {
			const opts = this.getNodeParameter('videoOptions', i, {}) as IDataObject;
			const body: IDataObject = { video: this.getNodeParameter('video', i) as string };
			if (opts.mode && opts.mode !== 'auto') body.mode = opts.mode;
			if (opts.timestamps === false) body.timestamps = false;
			if (typeof opts.callbackUrl === 'string' && opts.callbackUrl.trim() !== '') {
				body.callback_url = opts.callbackUrl.trim();
			}
			const res = (await request.call(this, 'POST', '/api/v2/transcripts/video', body)) as JobEnvelope;
			const waitForJob = opts.waitForJob !== false;
			if (res?.status === 'processing' && res.job_id && waitForJob) {
				const maxWait = typeof opts.maxWaitSeconds === 'number' ? opts.maxWaitSeconds : 300;
				return waitForJob_.call(this, res, maxWait);
			}
			return withPollUrl(res);
		}
		case 'batch': {
			const raw = this.getNodeParameter('videoIds', i) as string;
			const videoIds = raw
				.split(',')
				.map((v) => v.trim())
				.filter((v) => v.length > 0);
			if (videoIds.length === 0) {
				throw new NodeOperationError(this.getNode(), 'Video IDs or URLs is empty', { itemIndex: i });
			}
			const opts = this.getNodeParameter('batchOptions', i, {}) as IDataObject;
			const body: IDataObject = { video_ids: videoIds };
			if (opts.mode && opts.mode !== 'auto') body.mode = opts.mode;
			return request.call(this, 'POST', '/api/v2/transcripts/batch', body);
		}
		case 'channel': {
			const opts = this.getNodeParameter('channelOptions', i, {}) as IDataObject;
			const body: IDataObject = {
				channel: this.getNodeParameter('channel', i) as string,
				limit: this.getNodeParameter('limit', i) as number,
			};
			if (typeof opts.cursor === 'string' && opts.cursor !== '') body.cursor = opts.cursor;
			if (typeof opts.sinceVideoId === 'string' && opts.sinceVideoId !== '') {
				body.since_video_id = opts.sinceVideoId;
			}
			return request.call(this, 'POST', '/api/v2/transcripts/channel', body);
		}
		case 'playlist': {
			const opts = this.getNodeParameter('playlistOptions', i, {}) as IDataObject;
			const body: IDataObject = {
				playlist: this.getNodeParameter('playlist', i) as string,
				limit: this.getNodeParameter('limit', i) as number,
			};
			if (typeof opts.cursor === 'string' && opts.cursor !== '') body.cursor = opts.cursor;
			return request.call(this, 'POST', '/api/v2/transcripts/playlist', body);
		}
		case 'search': {
			const opts = this.getNodeParameter('searchOptions', i, {}) as IDataObject;
			const body: IDataObject = {
				query: this.getNodeParameter('query', i) as string,
				platform: this.getNodeParameter('platform', i, 'youtube') as string,
				limit: this.getNodeParameter('limit', i) as number,
			};
			if (typeof opts.cursor === 'string' && opts.cursor !== '') body.cursor = opts.cursor;
			return request.call(this, 'POST', '/api/v2/transcripts/search', body);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
				itemIndex: i,
			});
	}
}

async function request(
	this: IExecuteFunctions,
	method: 'GET' | 'POST',
	url: string,
	body?: IDataObject,
): Promise<IDataObject> {
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'transcriptFetchApi', {
			method,
			baseURL: BASE_URL,
			url,
			body,
			json: true,
			headers: { Accept: 'application/json' },
		})) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as never);
	}
}

/**
 * Poll a transcription job until it finishes or the budget runs out. The
 * finished job carries the same envelope as a 200, so the workflow sees one
 * shape whichever path served it. On timeout the unfinished job is returned
 * (status "processing" plus an absolute pollUrl) rather than thrown: the
 * transcript is still coming, and the cached re-request is free.
 */
async function waitForJob_(this: IExecuteFunctions, first: JobEnvelope, maxWaitSeconds: number): Promise<IDataObject> {
	const deadline = Date.now() + maxWaitSeconds * 1000;
	const pollPath = first.poll_url ?? `/api/v2/transcripts/jobs/${first.job_id}`;
	let last: JobEnvelope = first;
	while (Date.now() < deadline) {
		await sleep(JOB_POLL_INTERVAL_MS);
		last = (await request.call(this, 'GET', pollPath)) as JobEnvelope;
		if (last?.status === 'completed' || last?.status === 'failed') return last as IDataObject;
	}
	return withPollUrl(last);
}

/** Make a relative poll_url usable from the next HTTP node. */
function withPollUrl(res: JobEnvelope): IDataObject {
	if (res && typeof res.poll_url === 'string' && res.poll_url.startsWith('/')) {
		return { ...res, poll_url: `${BASE_URL}${res.poll_url}` } as IDataObject;
	}
	return (res ?? {}) as IDataObject;
}
