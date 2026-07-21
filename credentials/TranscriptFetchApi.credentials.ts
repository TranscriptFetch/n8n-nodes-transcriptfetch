import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TranscriptFetchApi implements ICredentialType {
	name = 'transcriptFetchApi';

	displayName = 'TranscriptFetch API';

	documentationUrl = 'https://transcriptfetch.com/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Your TranscriptFetch API key. Create one in the dashboard at https://transcriptfetch.com/app.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://transcriptfetch.com',
			url: '/api/v1/health',
		},
	};
}
