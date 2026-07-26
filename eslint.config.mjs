// Config for `n8n-node lint` (@n8n/node-cli). The CLI runs ESLint 9+, which
// requires a flat config in the package root; without it the lint command
// aborts before checking anything. Rules come from n8n's own community-node
// plugin — the same checks their verification review runs.
import { config } from '@n8n/node-cli/eslint';

export default config;
