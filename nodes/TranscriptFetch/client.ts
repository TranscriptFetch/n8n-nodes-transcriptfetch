/**
 * Sent with every API call so TranscriptFetch can attribute the request to
 * this node (its request log records the client). Keep the version in step
 * with package.json.
 */
export const CLIENT = 'n8n/0.5.1';

export const CLIENT_HEADERS = {
	'X-TranscriptFetch-Client': CLIENT,
	'User-Agent': `n8n-nodes-transcriptfetch/${CLIENT.split('/')[1]}`,
};
