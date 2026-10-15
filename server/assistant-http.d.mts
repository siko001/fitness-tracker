import type { IncomingMessage, ServerResponse } from 'node:http';
export function assistantHttp(req: IncomingMessage, res: ServerResponse, options?: { localAuthorized?: boolean; env?: Record<string, string | undefined> }): Promise<void>;
