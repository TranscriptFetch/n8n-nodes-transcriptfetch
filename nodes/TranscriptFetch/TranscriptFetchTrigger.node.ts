import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	NodeConnectionType,
} from 'n8n-workflow';

const BASE_URL = 'https://transcriptfetch.com';

/**
 * How many recent video IDs to remember. The API returns an untrimmed page when
 * the watermark video has been deleted or made private, so this list is what
 * stops an already-emitted upload from firing a second time.
 */
const SEEN_LIMIT = 50;

type VideoListItem = {
	videoId?: string;
	url?: string;
	title?: string;
	thumbnailUrl?: string;
	duration?: number | null;
	channel?: string | null;
	publishedAt?: string | null;
};

type ChannelResponse = {
	data?: { platform?: string; videos?: VideoListItem[] };
};

type Segment = { start?: number; duration?: number; text?: string };

type TranscriptResponse = {
	status?: string;
	job_id?: string;
	poll_url?: string;
	reason?: string;
	data?: {
		title?: string | null;
		platform?: string | null;
		source?: string | null;
		text?: string | null;
		segments?: Segment[] | null;
	};
};

/**
 * Polling trigger for new uploads on a YouTube channel, TikTok profile or
 * Instagram account.
 *
 * n8n has no native YouTube trigger, so the usual workaround is an RSS Feed
 * Trigger plus a separate transcript service. This collapses both into one node:
 * it watches the channel and (by default) emits each new video with its
 * transcript already attached. Since 0.4.0 it talks to the v2 API, so the same
 * node watches TikTok and Instagram profiles too.
 *
 * Polling is free. The channel endpoint accepts a `since_video_id` watermark,
 * trims the page to whatever is newer, and charges nothing when there is nothing
 * new — so a quiet channel costs no credits to watch, and n8n only counts an
 * execution when `poll` actually returns data.
 */
export class TranscriptFetchTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TranscriptFetch Trigger',
		name: 'transcriptFetchTrigger',
		icon: { light: 'file:transcriptfetch.svg', dark: 'file:transcriptfetch.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ "New video: " + $parameter["channel"] }}',
		description:
			'Starts a workflow when a YouTube channel, TikTok profile or Instagram account publishes a new video',
		defaults: {
			name: 'TranscriptFetch Trigger',
		},
		// No usableAsTool here: n8n's scanner (the verification check) rejects it
		// on triggers, which cannot be invoked as AI tools. The older local lint
		// rule that asked for it is superseded.
		polling: true,
		inputs: [],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [
			{
				name: 'transcriptFetchApi',
				required: true,
			},
		],
		properties: [
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
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: true,
				description:
					'Whether to fetch the transcript for each new video and attach it to the output. A caption transcript costs 1 credit; audio transcription is charged per started minute on delivery. Watching the channel is free.',
			},
			{
				// Deliberately NOT named `limit`: the community-package linter requires
				// any parameter called `limit` to default to 50, which would make every
				// poll ask for 50 videos. The request body still sends `limit`.
				displayName: 'Max Videos Per Poll',
				name: 'maxVideos',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 10,
				description:
					'How far back each poll looks. Raise it for channels that publish several videos between polls.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const channel = this.getNodeParameter('channel') as string;
		const maxVideos = this.getNodeParameter('maxVideos') as number;
		const includeTranscript = this.getNodeParameter('includeTranscript') as boolean;

		// "Test step" in the editor. Following the watermark here would be
		// correct but useless: the first test would report the cold start and
		// every later one would find nothing new, so the editor would only ever
		// show "no data" and you'd have nothing to build downstream nodes against.
		const isTestRun = this.getMode() === 'manual';

		const staticData = this.getWorkflowStaticData('node');
		const lastVideoId = staticData.lastVideoId as string | undefined;
		const seen = (staticData.seenVideoIds as string[] | undefined) ?? [];

		// A test only needs one sample; a real poll needs the whole window.
		const body: IDataObject = { channel, limit: isTestRun ? 1 : maxVideos };
		if (lastVideoId && !isTestRun) body.since_video_id = lastVideoId;

		const listed = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'transcriptFetchApi',
			{
				method: 'POST',
				baseURL: BASE_URL,
				url: '/api/v2/transcripts/channel',
				body,
				json: true,
			},
		)) as ChannelResponse;

		const platform = listed?.data?.platform ?? 'youtube';
		const videos = (listed?.data?.videos ?? []).filter(
			(v): v is VideoListItem & { videoId: string } => typeof v.videoId === 'string',
		);

		// Emit the newest upload as a sample. The watermark is deliberately left
		// untouched, so activating the workflow afterwards still starts clean
		// rather than treating this video as already delivered.
		if (isTestRun) {
			if (videos.length === 0) return null;
			return [[await buildItem.call(this, videos[0], platform, includeTranscript)]];
		}

		// First activation: record where the channel stands today and emit nothing,
		// so switching the workflow on doesn't replay the entire back catalogue.
		if (!lastVideoId) {
			if (videos.length > 0) {
				staticData.lastVideoId = videos[0].videoId;
				staticData.seenVideoIds = videos.slice(0, SEEN_LIMIT).map((v) => v.videoId);
			}
			return null;
		}

		const fresh = videos.filter((v) => !seen.includes(v.videoId));
		// Returning null (not an empty array) is what keeps a quiet poll from
		// counting as an execution — and from being logged as a failed one.
		if (fresh.length === 0) return null;

		// The API lists newest first; remember that before flipping the order.
		const newestId = fresh[0].videoId;

		const items: INodeExecutionData[] = [];
		// Oldest first, so downstream nodes see uploads in the order they happened.
		for (const video of [...fresh].reverse()) {
			items.push(await buildItem.call(this, video, platform, includeTranscript));
		}

		staticData.lastVideoId = newestId;
		staticData.seenVideoIds = [...fresh.map((v) => v.videoId), ...seen].slice(0, SEEN_LIMIT);

		return [items];
	}
}

/** Shape one listed video into an output item, with its transcript if asked for. */
async function buildItem(
	this: IPollFunctions,
	video: VideoListItem & { videoId: string },
	platform: string,
	includeTranscript: boolean,
): Promise<INodeExecutionData> {
	// v2 listings carry the platform's own URL. Only a YouTube ID can be turned
	// into a URL by hand; 0.3.x did that for every platform and emitted
	// youtube.com links for TikTok videos.
	const url =
		video.url ?? (platform === 'youtube' ? `https://www.youtube.com/watch?v=${video.videoId}` : null);
	const json: IDataObject = {
		videoId: video.videoId,
		platform,
		title: video.title ?? null,
		url,
		thumbnailUrl: video.thumbnailUrl ?? null,
		duration: video.duration ?? null,
		channel: video.channel ?? null,
		publishedAt: video.publishedAt ?? null,
		transcriptStatus: 'skipped',
		text: null,
		segments: null,
	};

	if (includeTranscript) {
		Object.assign(json, await fetchTranscript.call(this, url ?? video.videoId));
	}

	return { json };
}

/**
 * Fetch one transcript, flattened into the fields the trigger emits.
 *
 * Never throws: a single unavailable or errored video shouldn't lose the rest of
 * the batch (or silently drop the watermark advance), so failures come back as a
 * `transcriptStatus` the workflow can branch on.
 */
async function fetchTranscript(this: IPollFunctions, video: string): Promise<IDataObject> {
	try {
		const res = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'transcriptFetchApi',
			{
				method: 'POST',
				baseURL: BASE_URL,
				url: '/api/v2/transcripts/video',
				body: { video },
				json: true,
			},
		)) as TranscriptResponse;

		// No captions: the API queued an audio transcription instead of answering
		// inline. Hand back the job so the workflow can poll it when it's ready
		// rather than blocking the trigger for the length of the video.
		if (res?.status === 'processing' || res?.job_id) {
			return {
				transcriptStatus: 'processing',
				jobId: res.job_id ?? null,
				pollUrl: res.poll_url ? `${BASE_URL}${res.poll_url}` : null,
			};
		}

		// A v2 200 carries segments (the default) or a joined text, never both;
		// the trigger has always emitted both, so the text is joined here.
		const segments = res?.data?.segments ?? null;
		const text =
			res?.data?.text ??
			(segments ? segments.map((s) => (s.text ?? '').trim()).filter(Boolean).join(' ') : null);
		return {
			transcriptStatus: 'ok',
			title: res?.data?.title ?? null,
			source: res?.data?.source ?? null,
			text,
			segments,
		};
	} catch (error) {
		return {
			transcriptStatus: 'unavailable',
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
