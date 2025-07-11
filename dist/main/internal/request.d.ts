import type * as http from 'node:http';
import type * as https from 'node:https';
import type * as stream from 'node:stream';
import type { Transport } from "./type.js";
export declare function request(transport: Transport, opt: https.RequestOptions, body?: Buffer | string | stream.Readable | null): Promise<http.IncomingMessage>;
export declare const retryHttpCodes: Record<string, boolean>;
export declare function requestWithRetry(transport: Transport, opt: https.RequestOptions, body?: Buffer | string | stream.Readable | null, maxRetries?: number): Promise<http.IncomingMessage>;