import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
	NodeConnectionType,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://transcriptfetch.com';

type ApiResponse = { statusCode: number; body: IDataObject };

type MonitorEvent = {
	id?: string;
	type?: string;
	created_at?: string;
	monitor?: { id?: string; platform?: string; target?: string };
	credits_spent?: number;
	data?: IDataObject & {
		videos?: IDataObject[];
		transcripts?: IDataObject[];
	};
};

/**
 * Starts a workflow when a YouTube channel, TikTok profile or Instagram
 * account publishes a new video.
 *
 * Since 0.5.0 this is a webhook trigger on a TranscriptFetch monitor. Until
 * 0.4.x it polled the channel endpoint from inside n8n, on n8n's schedule
 * (every minute by default). Every check for new uploads now costs 1 credit
 * whether or not it finds one, so the schedule has to be ours: activating the
 * workflow creates a monitor that checks at the chosen interval and POSTs each
 * find to this workflow's webhook URL, signed with the monitor's secret, and
 * deactivating it deletes the monitor. The monitor also waits out the caption
 * grace period for brand-new YouTube uploads before falling back to audio
 * transcription, which the poller could not do.
 *
 * The webhook URL must be public HTTPS (TranscriptFetch refuses private and
 * plain-HTTP addresses), which n8n Cloud always is and a self-hosted instance
 * is once WEBHOOK_URL points at a public address.
 */
export class TranscriptFetchTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TranscriptFetch Trigger',
		name: 'transcriptFetchTrigger',
		icon: { light: 'file:transcriptfetch.svg', dark: 'file:transcriptfetch.dark.svg' },
		group: ['trigger'],
		version: 2,
		subtitle: '={{ "New video: " + $parameter["channel"] }}',
		// n8n's nodes panel merges this trigger with the TranscriptFetch node into
		// one entry and shows THIS description for it, so it describes the package.
		description:
			'Transcripts of any YouTube, TikTok or Instagram video, plus video search, channel and playlist listings, and a trigger for new uploads',
		defaults: {
			name: 'TranscriptFetch Trigger',
		},
		// No usableAsTool here: n8n's scanner (the verification check) rejects it
		// on triggers, which cannot be invoked as AI tools.
		inputs: [],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [
			{
				name: 'transcriptFetchApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Each check for new videos costs 1 credit, whether or not it finds one, and so does the first check when the workflow is activated. A daily check uses about 30 credits a month.',
				name: 'billingNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. @lexfridman',
				description:
					'YouTube channel @handle, /channel/UC… URL or UC… ID, a TikTok @profile or profile URL, or an Instagram account URL to watch for new uploads',
			},
			{
				displayName: 'Check Every',
				name: 'interval',
				type: 'options',
				options: [
					{ name: 'Day', value: 1440 },
					{ name: '6 Hours (Paid Plans)', value: 360 },
					{ name: 'Hour (Paid Plans)', value: 60 },
					{ name: '15 Minutes (Paid Plans)', value: 15 },
				],
				default: 1440,
				description:
					'How often TranscriptFetch checks the channel. Each check costs 1 credit. Accounts without a paid plan can check once a day.',
			},
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: true,
				description:
					'Whether to attach each new video\'s transcript. A caption transcript costs 1 credit; a video without captions is transcribed from its audio at 1 credit per started 5 minutes and arrives as its own item once it is ready.',
			},
			{
				displayName: 'YouTube Tab',
				name: 'tab',
				type: 'options',
				options: [
					{ name: 'Videos', value: 'videos' },
					{ name: 'Shorts', value: 'shorts' },
					{ name: 'Live', value: 'live' },
				],
				default: 'videos',
				description:
					'Which uploads of a YouTube channel to watch. Ignored for TikTok and Instagram.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const monitorId = staticData.monitorId as string | undefined;
				if (!monitorId) return false;

				const res = await api.call(this, 'GET', `/api/v2/monitors/${monitorId}`);
				if (res.statusCode === 404) {
					// Deleted on the TranscriptFetch side: create a new one.
					delete staticData.monitorId;
					delete staticData.webhookSecret;
					return false;
				}
				if (res.statusCode !== 200) throw apiError(this, res);

				const monitor = (res.body.data ?? {}) as IDataObject;
				if (sameSettings.call(this, monitor)) return true;

				// The node's settings changed since activation (or the URL moved):
				// the old monitor is removed and create() starts a new one.
				const removed = await api.call(this, 'DELETE', `/api/v2/monitors/${monitorId}`);
				if (removed.statusCode !== 200 && removed.statusCode !== 404) throw apiError(this, removed);
				delete staticData.monitorId;
				delete staticData.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const body: IDataObject = {
					type: 'channel',
					target: (this.getNodeParameter('channel') as string).trim(),
					webhook_url: webhookUrl,
					interval_minutes: this.getNodeParameter('interval') as number,
					transcripts: this.getNodeParameter('includeTranscript') as boolean,
					name: `n8n: ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 100),
				};
				const tab = this.getNodeParameter('tab') as string;
				if (tab !== 'videos') body.tab = tab;

				const res = await api.call(this, 'POST', '/api/v2/monitors', body);
				if (res.statusCode !== 201) {
					const issues = ((res.body.error as IDataObject | undefined)?.issues ?? []) as IDataObject[];
					if (issues.some((issue) => (issue.path as string[] | undefined)?.[0] === 'webhook_url')) {
						throw new NodeOperationError(
							this.getNode(),
							`TranscriptFetch can only deliver to a public HTTPS URL, and this workflow's webhook URL is ${webhookUrl}`,
							{
								description:
									'Use n8n Cloud, or set WEBHOOK_URL on your n8n instance to a public https:// address (a reverse proxy or tunnel). To fetch transcripts without a public URL, use the TranscriptFetch node on a Schedule Trigger.',
							},
						);
					}
					throw apiError(this, res);
				}

				const monitor = (res.body.data ?? {}) as IDataObject;
				const staticData = this.getWorkflowStaticData('node');
				staticData.monitorId = monitor.id;
				staticData.webhookSecret = monitor.webhook_secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const monitorId = staticData.monitorId as string | undefined;
				if (monitorId) {
					const res = await api.call(this, 'DELETE', `/api/v2/monitors/${monitorId}`);
					// 404: already gone, which is what delete wanted.
					if (res.statusCode !== 200 && res.statusCode !== 404) throw apiError(this, res);
				}
				delete staticData.monitorId;
				delete staticData.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;
		const signature = this.getHeaderData()['x-transcriptfetch-signature'];
		const req = this.getRequestObject() as unknown as { rawBody?: Buffer };
		// The signature covers the exact bytes TranscriptFetch sent.
		const raw = req.rawBody ?? Buffer.from(JSON.stringify(this.getBodyData()));
		if (!secret || typeof signature !== 'string' || !signatureMatches(raw, secret, signature)) {
			this.getResponseObject().status(401).send('Invalid signature');
			return { noWebhookResponse: true };
		}

		const event = this.getBodyData() as MonitorEvent;
		const items = eventItems(event);
		// An event with nothing to emit (an unknown type) is still acknowledged,
		// so TranscriptFetch does not retry it.
		if (items.length === 0) return { webhookResponse: 'ok' };
		return { workflowData: [items] };
	}
}

/** One authenticated call; HTTP errors come back as a status, not a throw. */
async function api(
	this: IHookFunctions,
	method: 'GET' | 'POST' | 'DELETE',
	url: string,
	body?: IDataObject,
): Promise<ApiResponse> {
	const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'transcriptFetchApi', {
		method,
		baseURL: BASE_URL,
		url,
		body,
		json: true,
		headers: { Accept: 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as { statusCode: number; body: unknown };
	const parsed = typeof res.body === 'object' && res.body !== null ? (res.body as IDataObject) : {};
	return { statusCode: res.statusCode, body: parsed };
}

/** The API's own error block, as an n8n error that names the code. */
function apiError(ctx: IHookFunctions, res: ApiResponse): NodeApiError {
	const error = (res.body.error ?? {}) as IDataObject;
	return new NodeApiError(ctx.getNode(), res.body as JsonObject, {
		httpCode: String(res.statusCode),
		message: typeof error.message === 'string' ? error.message : `TranscriptFetch answered HTTP ${res.statusCode}`,
		description: typeof error.code === 'string' ? `Error code: ${error.code}` : undefined,
	});
}

/** Whether the existing monitor still matches the node and this webhook URL. */
function sameSettings(this: IHookFunctions, monitor: IDataObject): boolean {
	const options = (monitor.options ?? {}) as IDataObject;
	const tab = this.getNodeParameter('tab') as string;
	return (
		monitor.webhook_url === this.getNodeWebhookUrl('default') &&
		monitor.target === (this.getNodeParameter('channel') as string).trim() &&
		monitor.interval_minutes === this.getNodeParameter('interval') &&
		monitor.transcripts === this.getNodeParameter('includeTranscript') &&
		(monitor.platform !== 'youtube' || (options.tab ?? 'videos') === tab)
	);
}

function signatureMatches(raw: Buffer, secret: string, header: string): boolean {
	const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
	const given = Buffer.from(header);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * One item per video. A `monitor.videos` event carries the new videos and,
 * with transcripts on, an entry per video; a `monitor.transcript` event
 * carries one transcript that finished later (audio transcription, or
 * captions that appeared during the grace period) for a video an earlier
 * item reported as `processing`.
 */
function eventItems(event: MonitorEvent): INodeExecutionData[] {
	const meta = {
		eventId: event.id ?? null,
		monitorId: event.monitor?.id ?? null,
		platform: event.monitor?.platform ?? null,
		creditsSpent: event.credits_spent ?? 0,
	};
	if (event.type === 'monitor.videos') {
		const transcripts = event.data?.transcripts;
		const byVideo = new Map<string, IDataObject>();
		for (const entry of transcripts ?? []) {
			if (typeof entry.video_id === 'string') byVideo.set(entry.video_id, entry);
		}
		// The API lists newest first; emit oldest first, the order they happened.
		return [...(event.data?.videos ?? [])].reverse().map((video) => ({
			json: {
				event: 'video',
				...meta,
				...video,
				...transcriptFields(transcripts ? byVideo.get(String(video.videoId)) : undefined),
			},
		}));
	}
	if (event.type === 'monitor.transcript' && event.data) {
		return [
			{
				json: {
					event: 'transcript',
					...meta,
					videoId: event.data.video_id ?? null,
					url: event.data.url ?? null,
					videosEventId: event.data.videos_event_id ?? null,
					...transcriptFields(event.data),
				},
			},
		];
	}
	return [];
}

/** A transcript entry flattened into the fields every item carries. */
function transcriptFields(entry: IDataObject | undefined): IDataObject {
	if (!entry) return { transcriptStatus: 'skipped', text: null, segments: null };
	const transcript = (entry.transcript ?? {}) as IDataObject;
	const error = (entry.error ?? {}) as IDataObject;
	switch (entry.outcome) {
		case 'ok':
			return {
				transcriptStatus: 'ok',
				text: transcript.text ?? null,
				segments: transcript.segments ?? null,
				language: transcript.language ?? null,
				source: transcript.source ?? null,
			};
		case 'processing':
			// Delivered later as its own `transcript` item.
			return { transcriptStatus: 'processing', text: null, segments: null };
		default:
			return {
				transcriptStatus: 'unavailable',
				text: null,
				segments: null,
				reason: error.code ?? null,
				message: error.message ?? null,
			};
	}
}
