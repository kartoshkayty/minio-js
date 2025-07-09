/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as crypto from "crypto";
import * as stream from "stream";
import { XMLParser } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import _ from 'lodash';
import * as mime from 'mime-types';
import { fsp, fstat } from "./async.mjs";
import { ENCRYPTION_TYPES } from "./type.mjs";
const MetaDataHeaderPrefix = 'x-amz-meta-';
export function hashBinary(buf, enableSHA256) {
  let sha256sum = '';
  if (enableSHA256) {
    sha256sum = crypto.createHash('sha256').update(buf).digest('hex');
  }
  const md5sum = crypto.createHash('md5').update(buf).digest('base64');
  return {
    md5sum,
    sha256sum
  };
}

// S3 percent-encodes some extra non-standard characters in a URI . So comply with S3.
const encodeAsHex = c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
export function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
export function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
export function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
export function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
export function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
export function isValidIP(ip) {
  return ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
export function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
export function isValidDomain(host) {
  if (!isString(host)) {
    return false;
  }
  // See RFC 1035, RFC 3696.
  if (host.length === 0 || host.length > 255) {
    return false;
  }
  // Host cannot start or end with a '-'
  if (host[0] === '-' || host.slice(-1) === '-') {
    return false;
  }
  // Host cannot start or end with a '_'
  if (host[0] === '_' || host.slice(-1) === '_') {
    return false;
  }
  // Host cannot start with a '.'
  if (host[0] === '.') {
    return false;
  }
  const nonAlphaNumerics = '`~!@#$%^&*()+={}[]|\\"\';:><?/';
  // All non alphanumeric characters are invalid.
  for (const char of nonAlphaNumerics) {
    if (host.includes(char)) {
      return false;
    }
  }
  // No need to regexp match, since the list is non-exhaustive.
  // We let it be valid and fail later.
  return true;
}

/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
export function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
export function isValidPort(port) {
  // Convert string port to number if needed
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  // verify if port is a valid number
  if (!isNumber(portNum) || isNaN(portNum)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= portNum && portNum <= 65535;
}
export function isValidBucketName(bucket) {
  if (!isString(bucket)) {
    return false;
  }

  // bucket length should be less than and no more than 63
  // characters long.
  if (bucket.length < 3 || bucket.length > 63) {
    return false;
  }
  // bucket with successive periods is invalid.
  if (bucket.includes('..')) {
    return false;
  }
  // bucket cannot have ip address style.
  if (/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)) {
    return false;
  }
  // bucket should begin with alphabet/number and end with alphabet/number,
  // with alphabet/number/.- in the middle.
  if (/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
    return true;
  }
  return false;
}

/**
 * check if objectName is a valid object name
 */
export function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
export function isValidPrefix(prefix) {
  if (!isString(prefix)) {
    return false;
  }
  if (prefix.length > 1024) {
    return false;
  }
  return true;
}

/**
 * check if typeof arg number
 */
export function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
export function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
export function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
export function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
/**
 * check if typeof arg is plain object
 */
export function isPlainObject(arg) {
  return Object.prototype.toString.call(arg) === '[object Object]';
}
/**
 * check if object is readable stream
 */
export function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
export function isBoolean(arg) {
  return typeof arg === 'boolean';
}
export function isEmpty(o) {
  return _.isEmpty(o);
}
export function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
export function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
export function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
export function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
export function makeDateShort(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
export function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
export function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
export function insertContentType(metaData, filePath) {
  // check if content-type attribute present in metaData
  for (const key in metaData) {
    if (key.toLowerCase() === 'content-type') {
      return metaData;
    }
  }

  // if `content-type` attribute is not present in metadata, then infer it from the extension in filePath
  return {
    ...metaData,
    'content-type': probeContentType(filePath)
  };
}

/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
export function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
export function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
export function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location', 'if-none-match', 'if-match'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
export function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
export function extractMetadata(headers) {
  return _.mapKeys(_.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
export function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
export function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
export function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
export function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
export function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
export function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
export function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
export function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
export const PART_CONSTRAINTS = {
  // absMinPartSize - absolute minimum part size (5 MiB)
  ABS_MIN_PART_SIZE: 1024 * 1024 * 5,
  // MIN_PART_SIZE - minimum part size 16MiB per object after which
  MIN_PART_SIZE: 1024 * 1024 * 16,
  // MAX_PARTS_COUNT - maximum number of parts for a single multipart session.
  MAX_PARTS_COUNT: 10000,
  // MAX_PART_SIZE - maximum part size 5GiB for a single multipart upload
  // operation.
  MAX_PART_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_SINGLE_PUT_OBJECT_SIZE - maximum size 5GiB of object per PUT
  // operation.
  MAX_SINGLE_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_MULTIPART_PUT_OBJECT_SIZE - maximum size 5TiB of object for
  // Multipart operation.
  MAX_MULTIPART_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 1024 * 5
};
const GENERIC_SSE_HEADER = 'X-Amz-Server-Side-Encryption';
const ENCRYPTION_HEADERS = {
  // sseGenericHeader is the AWS SSE header used for SSE-S3 and SSE-KMS.
  sseGenericHeader: GENERIC_SSE_HEADER,
  // sseKmsKeyID is the AWS SSE-KMS key id.
  sseKmsKeyID: GENERIC_SSE_HEADER + '-Aws-Kms-Key-Id'
};

/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
export function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
export function partsRequired(size) {
  const maxPartSize = PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE / (PART_CONSTRAINTS.MAX_PARTS_COUNT - 1);
  let requiredPartSize = size / maxPartSize;
  if (size % maxPartSize > 0) {
    requiredPartSize++;
  }
  requiredPartSize = Math.trunc(requiredPartSize);
  return requiredPartSize;
}

/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
export function calculateEvenSplits(size, objInfo) {
  if (size === 0) {
    return null;
  }
  const reqParts = partsRequired(size);
  const startIndexParts = [];
  const endIndexParts = [];
  let start = objInfo.Start;
  if (isEmpty(start) || start === -1) {
    start = 0;
  }
  const divisorValue = Math.trunc(size / reqParts);
  const reminderValue = size % reqParts;
  let nextStart = start;
  for (let i = 0; i < reqParts; i++) {
    let curPartSize = divisorValue;
    if (i < reminderValue) {
      curPartSize++;
    }
    const currentStart = nextStart;
    const currentEnd = currentStart + curPartSize - 1;
    nextStart = currentEnd + 1;
    startIndexParts.push(currentStart);
    endIndexParts.push(currentEnd);
  }
  return {
    startIndex: startIndexParts,
    endIndex: endIndexParts,
    objInfo: objInfo
  };
}
const fxp = new XMLParser({
  numberParseOptions: {
    eNotation: false,
    hex: true,
    leadingZeros: true
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
export async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await fstat(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJzdHJlYW0iLCJYTUxQYXJzZXIiLCJpcGFkZHIiLCJfIiwibWltZSIsImZzcCIsImZzdGF0IiwiRU5DUllQVElPTl9UWVBFUyIsIk1ldGFEYXRhSGVhZGVyUHJlZml4IiwiaGFzaEJpbmFyeSIsImJ1ZiIsImVuYWJsZVNIQTI1NiIsInNoYTI1NnN1bSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJtZDVzdW0iLCJlbmNvZGVBc0hleCIsImMiLCJjaGFyQ29kZUF0IiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInVyaUVzY2FwZSIsInVyaVN0ciIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsInN0cmluZyIsImdldFNjb3BlIiwicmVnaW9uIiwiZGF0ZSIsInNlcnZpY2VOYW1lIiwibWFrZURhdGVTaG9ydCIsImlzQW1hem9uRW5kcG9pbnQiLCJlbmRwb2ludCIsImlzVmlydHVhbEhvc3RTdHlsZSIsInByb3RvY29sIiwiYnVja2V0IiwicGF0aFN0eWxlIiwiaW5jbHVkZXMiLCJpc1ZhbGlkSVAiLCJpcCIsImlzVmFsaWQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJpc1ZhbGlkRG9tYWluIiwiaG9zdCIsImlzU3RyaW5nIiwibGVuZ3RoIiwic2xpY2UiLCJub25BbHBoYU51bWVyaWNzIiwiY2hhciIsInByb2JlQ29udGVudFR5cGUiLCJwYXRoIiwiY29udGVudFR5cGUiLCJsb29rdXAiLCJpc1ZhbGlkUG9ydCIsInBvcnQiLCJwb3J0TnVtIiwicGFyc2VJbnQiLCJpc051bWJlciIsImlzTmFOIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJ0ZXN0IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJvYmplY3ROYW1lIiwiaXNWYWxpZFByZWZpeCIsInByZWZpeCIsImFyZyIsImlzRnVuY3Rpb24iLCJpc09iamVjdCIsImlzUGxhaW5PYmplY3QiLCJPYmplY3QiLCJwcm90b3R5cGUiLCJjYWxsIiwiaXNSZWFkYWJsZVN0cmVhbSIsIl9yZWFkIiwiaXNCb29sZWFuIiwiaXNFbXB0eSIsIm8iLCJpc0VtcHR5T2JqZWN0IiwidmFsdWVzIiwiZmlsdGVyIiwieCIsInVuZGVmaW5lZCIsImlzRGVmaW5lZCIsImlzVmFsaWREYXRlIiwiRGF0ZSIsIm1ha2VEYXRlTG9uZyIsInMiLCJ0b0lTT1N0cmluZyIsInBpcGVzZXR1cCIsInN0cmVhbXMiLCJyZWR1Y2UiLCJzcmMiLCJkc3QiLCJvbiIsImVyciIsImVtaXQiLCJwaXBlIiwicmVhZGFibGVTdHJlYW0iLCJkYXRhIiwiUmVhZGFibGUiLCJwdXNoIiwiaW5zZXJ0Q29udGVudFR5cGUiLCJtZXRhRGF0YSIsImZpbGVQYXRoIiwia2V5IiwidG9Mb3dlckNhc2UiLCJwcmVwZW5kWEFNWk1ldGEiLCJtYXBLZXlzIiwidmFsdWUiLCJpc0FtekhlYWRlciIsImlzU3VwcG9ydGVkSGVhZGVyIiwiaXNTdG9yYWdlQ2xhc3NIZWFkZXIiLCJ0ZW1wIiwic3RhcnRzV2l0aCIsInN1cHBvcnRlZF9oZWFkZXJzIiwiZXh0cmFjdE1ldGFkYXRhIiwiaGVhZGVycyIsInBpY2tCeSIsImxvd2VyIiwiZ2V0VmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwiZXRhZyIsInJlcGxhY2VDaGFycyIsIm0iLCJ0b01kNSIsInBheWxvYWQiLCJCdWZmZXIiLCJmcm9tIiwidG9TaGEyNTYiLCJ0b0FycmF5IiwicGFyYW0iLCJBcnJheSIsImlzQXJyYXkiLCJzYW5pdGl6ZU9iamVjdEtleSIsImFzU3RyTmFtZSIsImRlY29kZVVSSUNvbXBvbmVudCIsInNhbml0aXplU2l6ZSIsInNpemUiLCJOdW1iZXIiLCJQQVJUX0NPTlNUUkFJTlRTIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNSU5fUEFSVF9TSVpFIiwiTUFYX1BBUlRTX0NPVU5UIiwiTUFYX1BBUlRfU0laRSIsIk1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJHRU5FUklDX1NTRV9IRUFERVIiLCJFTkNSWVBUSU9OX0hFQURFUlMiLCJzc2VHZW5lcmljSGVhZGVyIiwic3NlS21zS2V5SUQiLCJnZXRFbmNyeXB0aW9uSGVhZGVycyIsImVuY0NvbmZpZyIsImVuY1R5cGUiLCJ0eXBlIiwiU1NFQyIsIktNUyIsIlNTRUFsZ29yaXRobSIsIktNU01hc3RlcktleUlEIiwicGFydHNSZXF1aXJlZCIsIm1heFBhcnRTaXplIiwicmVxdWlyZWRQYXJ0U2l6ZSIsIk1hdGgiLCJ0cnVuYyIsImNhbGN1bGF0ZUV2ZW5TcGxpdHMiLCJvYmpJbmZvIiwicmVxUGFydHMiLCJzdGFydEluZGV4UGFydHMiLCJlbmRJbmRleFBhcnRzIiwic3RhcnQiLCJTdGFydCIsImRpdmlzb3JWYWx1ZSIsInJlbWluZGVyVmFsdWUiLCJuZXh0U3RhcnQiLCJpIiwiY3VyUGFydFNpemUiLCJjdXJyZW50U3RhcnQiLCJjdXJyZW50RW5kIiwic3RhcnRJbmRleCIsImVuZEluZGV4IiwiZnhwIiwibnVtYmVyUGFyc2VPcHRpb25zIiwiZU5vdGF0aW9uIiwiaGV4IiwibGVhZGluZ1plcm9zIiwicGFyc2VYbWwiLCJ4bWwiLCJyZXN1bHQiLCJwYXJzZSIsIkVycm9yIiwiZ2V0Q29udGVudExlbmd0aCIsImlzQnVmZmVyIiwic3RhdCIsImxzdGF0IiwiZmQiXSwic291cmNlcyI6WyJoZWxwZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcclxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSBNaW5JTywgSW5jLlxyXG4gKlxyXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xyXG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXHJcbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxyXG4gKlxyXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXHJcbiAqXHJcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcclxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxyXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cclxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxyXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cclxuICovXHJcblxyXG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnbm9kZTpjcnlwdG8nXHJcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcclxuXHJcbmltcG9ydCB7IFhNTFBhcnNlciB9IGZyb20gJ2Zhc3QteG1sLXBhcnNlcidcclxuaW1wb3J0IGlwYWRkciBmcm9tICdpcGFkZHIuanMnXHJcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcclxuaW1wb3J0ICogYXMgbWltZSBmcm9tICdtaW1lLXR5cGVzJ1xyXG5cclxuaW1wb3J0IHsgZnNwLCBmc3RhdCB9IGZyb20gJy4vYXN5bmMudHMnXHJcbmltcG9ydCB0eXBlIHsgQmluYXJ5LCBFbmNyeXB0aW9uLCBPYmplY3RNZXRhRGF0YSwgUmVxdWVzdEhlYWRlcnMsIFJlc3BvbnNlSGVhZGVyIH0gZnJvbSAnLi90eXBlLnRzJ1xyXG5pbXBvcnQgeyBFTkNSWVBUSU9OX1RZUEVTIH0gZnJvbSAnLi90eXBlLnRzJ1xyXG5cclxuY29uc3QgTWV0YURhdGFIZWFkZXJQcmVmaXggPSAneC1hbXotbWV0YS0nXHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaGFzaEJpbmFyeShidWY6IEJ1ZmZlciwgZW5hYmxlU0hBMjU2OiBib29sZWFuKSB7XHJcbiAgbGV0IHNoYTI1NnN1bSA9ICcnXHJcbiAgaWYgKGVuYWJsZVNIQTI1Nikge1xyXG4gICAgc2hhMjU2c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShidWYpLmRpZ2VzdCgnaGV4JylcclxuICB9XHJcbiAgY29uc3QgbWQ1c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShidWYpLmRpZ2VzdCgnYmFzZTY0JylcclxuXHJcbiAgcmV0dXJuIHsgbWQ1c3VtLCBzaGEyNTZzdW0gfVxyXG59XHJcblxyXG4vLyBTMyBwZXJjZW50LWVuY29kZXMgc29tZSBleHRyYSBub24tc3RhbmRhcmQgY2hhcmFjdGVycyBpbiBhIFVSSSAuIFNvIGNvbXBseSB3aXRoIFMzLlxyXG5jb25zdCBlbmNvZGVBc0hleCA9IChjOiBzdHJpbmcpID0+IGAlJHtjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCl9YFxyXG5leHBvcnQgZnVuY3Rpb24gdXJpRXNjYXBlKHVyaVN0cjogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHVyaVN0cikucmVwbGFjZSgvWyEnKCkqXS9nLCBlbmNvZGVBc0hleClcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHVyaVJlc291cmNlRXNjYXBlKHN0cmluZzogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIHVyaUVzY2FwZShzdHJpbmcpLnJlcGxhY2UoLyUyRi9nLCAnLycpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRTY29wZShyZWdpb246IHN0cmluZywgZGF0ZTogRGF0ZSwgc2VydmljZU5hbWUgPSAnczMnKSB7XHJcbiAgcmV0dXJuIGAke21ha2VEYXRlU2hvcnQoZGF0ZSl9LyR7cmVnaW9ufS8ke3NlcnZpY2VOYW1lfS9hd3M0X3JlcXVlc3RgXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBpc0FtYXpvbkVuZHBvaW50IC0gdHJ1ZSBpZiBlbmRwb2ludCBpcyAnczMuYW1hem9uYXdzLmNvbScgb3IgJ3MzLmNuLW5vcnRoLTEuYW1hem9uYXdzLmNvbS5jbidcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcclxuICByZXR1cm4gZW5kcG9pbnQgPT09ICdzMy5hbWF6b25hd3MuY29tJyB8fCBlbmRwb2ludCA9PT0gJ3MzLmNuLW5vcnRoLTEuYW1hem9uYXdzLmNvbS5jbidcclxufVxyXG5cclxuLyoqXHJcbiAqIGlzVmlydHVhbEhvc3RTdHlsZSAtIHZlcmlmeSBpZiBidWNrZXQgbmFtZSBpcyBzdXBwb3J0IHdpdGggdmlydHVhbFxyXG4gKiBob3N0cy4gYnVja2V0TmFtZXMgd2l0aCBwZXJpb2RzIHNob3VsZCBiZSBhbHdheXMgdHJlYXRlZCBhcyBwYXRoXHJcbiAqIHN0eWxlIGlmIHRoZSBwcm90b2NvbCBpcyAnaHR0cHM6JywgdGhpcyBpcyBkdWUgdG8gU1NMIHdpbGRjYXJkXHJcbiAqIGxpbWl0YXRpb24uIEZvciBhbGwgb3RoZXIgYnVja2V0cyBhbmQgQW1hem9uIFMzIGVuZHBvaW50IHdlIHdpbGxcclxuICogZGVmYXVsdCB0byB2aXJ0dWFsIGhvc3Qgc3R5bGUuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNWaXJ0dWFsSG9zdFN0eWxlKGVuZHBvaW50OiBzdHJpbmcsIHByb3RvY29sOiBzdHJpbmcsIGJ1Y2tldDogc3RyaW5nLCBwYXRoU3R5bGU6IGJvb2xlYW4pIHtcclxuICBpZiAocHJvdG9jb2wgPT09ICdodHRwczonICYmIGJ1Y2tldC5pbmNsdWRlcygnLicpKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgcmV0dXJuIGlzQW1hem9uRW5kcG9pbnQoZW5kcG9pbnQpIHx8ICFwYXRoU3R5bGVcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRJUChpcDogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIGlwYWRkci5pc1ZhbGlkKGlwKVxyXG59XHJcblxyXG4vKipcclxuICogQHJldHVybnMgaWYgZW5kcG9pbnQgaXMgdmFsaWQgZG9tYWluLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRFbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIGlzVmFsaWREb21haW4oZW5kcG9pbnQpIHx8IGlzVmFsaWRJUChlbmRwb2ludClcclxufVxyXG5cclxuLyoqXHJcbiAqIEByZXR1cm5zIGlmIGlucHV0IGhvc3QgaXMgYSB2YWxpZCBkb21haW4uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERvbWFpbihob3N0OiBzdHJpbmcpIHtcclxuICBpZiAoIWlzU3RyaW5nKGhvc3QpKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgLy8gU2VlIFJGQyAxMDM1LCBSRkMgMzY5Ni5cclxuICBpZiAoaG9zdC5sZW5ndGggPT09IDAgfHwgaG9zdC5sZW5ndGggPiAyNTUpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuICAvLyBIb3N0IGNhbm5vdCBzdGFydCBvciBlbmQgd2l0aCBhICctJ1xyXG4gIGlmIChob3N0WzBdID09PSAnLScgfHwgaG9zdC5zbGljZSgtMSkgPT09ICctJykge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJ18nXHJcbiAgaWYgKGhvc3RbMF0gPT09ICdfJyB8fCBob3N0LnNsaWNlKC0xKSA9PT0gJ18nKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgd2l0aCBhICcuJ1xyXG4gIGlmIChob3N0WzBdID09PSAnLicpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuXHJcbiAgY29uc3Qgbm9uQWxwaGFOdW1lcmljcyA9ICdgfiFAIyQlXiYqKCkrPXt9W118XFxcXFwiXFwnOzo+PD8vJ1xyXG4gIC8vIEFsbCBub24gYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYXJlIGludmFsaWQuXHJcbiAgZm9yIChjb25zdCBjaGFyIG9mIG5vbkFscGhhTnVtZXJpY3MpIHtcclxuICAgIGlmIChob3N0LmluY2x1ZGVzKGNoYXIpKSB7XHJcbiAgICAgIHJldHVybiBmYWxzZVxyXG4gICAgfVxyXG4gIH1cclxuICAvLyBObyBuZWVkIHRvIHJlZ2V4cCBtYXRjaCwgc2luY2UgdGhlIGxpc3QgaXMgbm9uLWV4aGF1c3RpdmUuXHJcbiAgLy8gV2UgbGV0IGl0IGJlIHZhbGlkIGFuZCBmYWlsIGxhdGVyLlxyXG4gIHJldHVybiB0cnVlXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9iZXMgY29udGVudFR5cGUgdXNpbmcgZmlsZSBleHRlbnNpb25zLlxyXG4gKlxyXG4gKiBAZXhhbXBsZVxyXG4gKiBgYGBcclxuICogLy8gcmV0dXJuICdpbWFnZS9wbmcnXHJcbiAqIHByb2JlQ29udGVudFR5cGUoJ2ZpbGUucG5nJylcclxuICogYGBgXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcHJvYmVDb250ZW50VHlwZShwYXRoOiBzdHJpbmcpIHtcclxuICBsZXQgY29udGVudFR5cGUgPSBtaW1lLmxvb2t1cChwYXRoKVxyXG4gIGlmICghY29udGVudFR5cGUpIHtcclxuICAgIGNvbnRlbnRUeXBlID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcclxuICB9XHJcbiAgcmV0dXJuIGNvbnRlbnRUeXBlXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBpcyBpbnB1dCBwb3J0IHZhbGlkLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRQb3J0KHBvcnQ6IHVua25vd24pOiBwb3J0IGlzIG51bWJlciB7XHJcbiAgLy8gQ29udmVydCBzdHJpbmcgcG9ydCB0byBudW1iZXIgaWYgbmVlZGVkXHJcbiAgY29uc3QgcG9ydE51bSA9IHR5cGVvZiBwb3J0ID09PSAnc3RyaW5nJyA/IHBhcnNlSW50KHBvcnQsIDEwKSA6IHBvcnRcclxuXHJcbiAgLy8gdmVyaWZ5IGlmIHBvcnQgaXMgYSB2YWxpZCBudW1iZXJcclxuICBpZiAoIWlzTnVtYmVyKHBvcnROdW0pIHx8IGlzTmFOKHBvcnROdW0pKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcblxyXG4gIC8vIHBvcnQgYDBgIGlzIHZhbGlkIGFuZCBzcGVjaWFsIGNhc2VcclxuICByZXR1cm4gMCA8PSBwb3J0TnVtICYmIHBvcnROdW0gPD0gNjU1MzVcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldDogdW5rbm93bikge1xyXG4gIGlmICghaXNTdHJpbmcoYnVja2V0KSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG5cclxuICAvLyBidWNrZXQgbGVuZ3RoIHNob3VsZCBiZSBsZXNzIHRoYW4gYW5kIG5vIG1vcmUgdGhhbiA2M1xyXG4gIC8vIGNoYXJhY3RlcnMgbG9uZy5cclxuICBpZiAoYnVja2V0Lmxlbmd0aCA8IDMgfHwgYnVja2V0Lmxlbmd0aCA+IDYzKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgLy8gYnVja2V0IHdpdGggc3VjY2Vzc2l2ZSBwZXJpb2RzIGlzIGludmFsaWQuXHJcbiAgaWYgKGJ1Y2tldC5pbmNsdWRlcygnLi4nKSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIC8vIGJ1Y2tldCBjYW5ub3QgaGF2ZSBpcCBhZGRyZXNzIHN0eWxlLlxyXG4gIGlmICgvWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rLy50ZXN0KGJ1Y2tldCkpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuICAvLyBidWNrZXQgc2hvdWxkIGJlZ2luIHdpdGggYWxwaGFiZXQvbnVtYmVyIGFuZCBlbmQgd2l0aCBhbHBoYWJldC9udW1iZXIsXHJcbiAgLy8gd2l0aCBhbHBoYWJldC9udW1iZXIvLi0gaW4gdGhlIG1pZGRsZS5cclxuICBpZiAoL15bYS16MC05XVthLXowLTkuLV0rW2EtejAtOV0kLy50ZXN0KGJ1Y2tldCkpIHtcclxuICAgIHJldHVybiB0cnVlXHJcbiAgfVxyXG4gIHJldHVybiBmYWxzZVxyXG59XHJcblxyXG4vKipcclxuICogY2hlY2sgaWYgb2JqZWN0TmFtZSBpcyBhIHZhbGlkIG9iamVjdCBuYW1lXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZTogdW5rbm93bikge1xyXG4gIGlmICghaXNWYWxpZFByZWZpeChvYmplY3ROYW1lKSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG5cclxuICByZXR1cm4gb2JqZWN0TmFtZS5sZW5ndGggIT09IDBcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIHByZWZpeCBpcyB2YWxpZFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRQcmVmaXgocHJlZml4OiB1bmtub3duKTogcHJlZml4IGlzIHN0cmluZyB7XHJcbiAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgaWYgKHByZWZpeC5sZW5ndGggPiAxMDI0KSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgcmV0dXJuIHRydWVcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgbnVtYmVyXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNOdW1iZXIoYXJnOiB1bmtub3duKTogYXJnIGlzIG51bWJlciB7XHJcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInXHJcbn1cclxuXHJcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XHJcbmV4cG9ydCB0eXBlIEFueUZ1bmN0aW9uID0gKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnlcclxuXHJcbi8qKlxyXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIGZ1bmN0aW9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihhcmc6IHVua25vd24pOiBhcmcgaXMgQW55RnVuY3Rpb24ge1xyXG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIHN0cmluZ1xyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzU3RyaW5nKGFyZzogdW5rbm93bik6IGFyZyBpcyBzdHJpbmcge1xyXG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJ1xyXG59XHJcblxyXG4vKipcclxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBvYmplY3RcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc09iamVjdChhcmc6IHVua25vd24pOiBhcmcgaXMgb2JqZWN0IHtcclxuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsXHJcbn1cclxuLyoqXHJcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgaXMgcGxhaW4gb2JqZWN0XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNQbGFpbk9iamVjdChhcmc6IHVua25vd24pOiBhcmcgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xyXG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYXJnKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcclxufVxyXG4vKipcclxuICogY2hlY2sgaWYgb2JqZWN0IGlzIHJlYWRhYmxlIHN0cmVhbVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzUmVhZGFibGVTdHJlYW0oYXJnOiB1bmtub3duKTogYXJnIGlzIHN0cmVhbS5SZWFkYWJsZSB7XHJcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC91bmJvdW5kLW1ldGhvZFxyXG4gIHJldHVybiBpc09iamVjdChhcmcpICYmIGlzRnVuY3Rpb24oKGFyZyBhcyBzdHJlYW0uUmVhZGFibGUpLl9yZWFkKVxyXG59XHJcblxyXG4vKipcclxuICogY2hlY2sgaWYgYXJnIGlzIGJvb2xlYW5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0Jvb2xlYW4oYXJnOiB1bmtub3duKTogYXJnIGlzIGJvb2xlYW4ge1xyXG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnYm9vbGVhbidcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHkobzogdW5rbm93bik6IG8gaXMgbnVsbCB8IHVuZGVmaW5lZCB7XHJcbiAgcmV0dXJuIF8uaXNFbXB0eShvKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eU9iamVjdChvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xyXG4gIHJldHVybiBPYmplY3QudmFsdWVzKG8pLmZpbHRlcigoeCkgPT4geCAhPT0gdW5kZWZpbmVkKS5sZW5ndGggIT09IDBcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzRGVmaW5lZDxUPihvOiBUKTogbyBpcyBFeGNsdWRlPFQsIG51bGwgfCB1bmRlZmluZWQ+IHtcclxuICByZXR1cm4gbyAhPT0gbnVsbCAmJiBvICE9PSB1bmRlZmluZWRcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIGFyZyBpcyBhIHZhbGlkIGRhdGVcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRGF0ZShhcmc6IHVua25vd24pOiBhcmcgaXMgRGF0ZSB7XHJcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciBjaGVja25ldyBEYXRlKE1hdGguTmFOKVxyXG4gIHJldHVybiBhcmcgaW5zdGFuY2VvZiBEYXRlICYmICFpc05hTihhcmcpXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgYSBEYXRlIHN0cmluZyB3aXRoIGZvcm1hdDogJ1lZWVlNTUREVEhIbW1zcycgKyBaXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gbWFrZURhdGVMb25nKGRhdGU/OiBEYXRlKTogc3RyaW5nIHtcclxuICBkYXRlID0gZGF0ZSB8fCBuZXcgRGF0ZSgpXHJcblxyXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xyXG4gIGNvbnN0IHMgPSBkYXRlLnRvSVNPU3RyaW5nKClcclxuXHJcbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMykgKyBzLnNsaWNlKDE0LCAxNikgKyBzLnNsaWNlKDE3LCAxOSkgKyAnWidcclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NREQnXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gbWFrZURhdGVTaG9ydChkYXRlPzogRGF0ZSkge1xyXG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcclxuXHJcbiAgLy8gR2l2ZXMgZm9ybWF0IGxpa2U6ICcyMDE3LTA4LTA3VDE2OjI4OjU5Ljg4OVonXHJcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxyXG5cclxuICByZXR1cm4gcy5zbGljZSgwLCA0KSArIHMuc2xpY2UoNSwgNykgKyBzLnNsaWNlKDgsIDEwKVxyXG59XHJcblxyXG4vKipcclxuICogcGlwZXNldHVwIHNldHMgdXAgcGlwZSgpIGZyb20gbGVmdCB0byByaWdodCBvcyBzdHJlYW1zIGFycmF5XHJcbiAqIHBpcGVzZXR1cCB3aWxsIGFsc28gbWFrZSBzdXJlIHRoYXQgZXJyb3IgZW1pdHRlZCBhdCBhbnkgb2YgdGhlIHVwc3RyZWFtIFN0cmVhbVxyXG4gKiB3aWxsIGJlIGVtaXR0ZWQgYXQgdGhlIGxhc3Qgc3RyZWFtLiBUaGlzIG1ha2VzIGVycm9yIGhhbmRsaW5nIHNpbXBsZVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHBpcGVzZXR1cCguLi5zdHJlYW1zOiBbc3RyZWFtLlJlYWRhYmxlLCAuLi5zdHJlYW0uRHVwbGV4W10sIHN0cmVhbS5Xcml0YWJsZV0pIHtcclxuICAvLyBAdHMtZXhwZWN0LWVycm9yIHRzIGNhbid0IG5hcnJvdyB0aGlzXHJcbiAgcmV0dXJuIHN0cmVhbXMucmVkdWNlKChzcmM6IHN0cmVhbS5SZWFkYWJsZSwgZHN0OiBzdHJlYW0uV3JpdGFibGUpID0+IHtcclxuICAgIHNyYy5vbignZXJyb3InLCAoZXJyKSA9PiBkc3QuZW1pdCgnZXJyb3InLCBlcnIpKVxyXG4gICAgcmV0dXJuIHNyYy5waXBlKGRzdClcclxuICB9KVxyXG59XHJcblxyXG4vKipcclxuICogcmV0dXJuIGEgUmVhZGFibGUgc3RyZWFtIHRoYXQgZW1pdHMgZGF0YVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRhYmxlU3RyZWFtKGRhdGE6IHVua25vd24pOiBzdHJlYW0uUmVhZGFibGUge1xyXG4gIGNvbnN0IHMgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKClcclxuICBzLl9yZWFkID0gKCkgPT4ge31cclxuICBzLnB1c2goZGF0YSlcclxuICBzLnB1c2gobnVsbClcclxuICByZXR1cm4gc1xyXG59XHJcblxyXG4vKipcclxuICogUHJvY2VzcyBtZXRhZGF0YSB0byBpbnNlcnQgYXBwcm9wcmlhdGUgdmFsdWUgdG8gYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGE6IE9iamVjdE1ldGFEYXRhLCBmaWxlUGF0aDogc3RyaW5nKTogT2JqZWN0TWV0YURhdGEge1xyXG4gIC8vIGNoZWNrIGlmIGNvbnRlbnQtdHlwZSBhdHRyaWJ1dGUgcHJlc2VudCBpbiBtZXRhRGF0YVxyXG4gIGZvciAoY29uc3Qga2V5IGluIG1ldGFEYXRhKSB7XHJcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09ICdjb250ZW50LXR5cGUnKSB7XHJcbiAgICAgIHJldHVybiBtZXRhRGF0YVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gaWYgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGlzIG5vdCBwcmVzZW50IGluIG1ldGFkYXRhLCB0aGVuIGluZmVyIGl0IGZyb20gdGhlIGV4dGVuc2lvbiBpbiBmaWxlUGF0aFxyXG4gIHJldHVybiB7XHJcbiAgICAuLi5tZXRhRGF0YSxcclxuICAgICdjb250ZW50LXR5cGUnOiBwcm9iZUNvbnRlbnRUeXBlKGZpbGVQYXRoKSxcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGdW5jdGlvbiBwcmVwZW5kcyBtZXRhZGF0YSB3aXRoIHRoZSBhcHByb3ByaWF0ZSBwcmVmaXggaWYgaXQgaXMgbm90IGFscmVhZHkgb25cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGE/OiBPYmplY3RNZXRhRGF0YSk6IFJlcXVlc3RIZWFkZXJzIHtcclxuICBpZiAoIW1ldGFEYXRhKSB7XHJcbiAgICByZXR1cm4ge31cclxuICB9XHJcblxyXG4gIHJldHVybiBfLm1hcEtleXMobWV0YURhdGEsICh2YWx1ZSwga2V5KSA9PiB7XHJcbiAgICBpZiAoaXNBbXpIZWFkZXIoa2V5KSB8fCBpc1N1cHBvcnRlZEhlYWRlcihrZXkpIHx8IGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleSkpIHtcclxuICAgICAgcmV0dXJuIGtleVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBNZXRhRGF0YUhlYWRlclByZWZpeCArIGtleVxyXG4gIH0pXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDaGVja3MgaWYgaXQgaXMgYSB2YWxpZCBoZWFkZXIgYWNjb3JkaW5nIHRvIHRoZSBBbWF6b25TMyBBUElcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0FtekhlYWRlcihrZXk6IHN0cmluZykge1xyXG4gIGNvbnN0IHRlbXAgPSBrZXkudG9Mb3dlckNhc2UoKVxyXG4gIHJldHVybiAoXHJcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpIHx8XHJcbiAgICB0ZW1wID09PSAneC1hbXotYWNsJyB8fFxyXG4gICAgdGVtcC5zdGFydHNXaXRoKCd4LWFtei1zZXJ2ZXItc2lkZS1lbmNyeXB0aW9uLScpIHx8XHJcbiAgICB0ZW1wID09PSAneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbidcclxuICApXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDaGVja3MgaWYgaXQgaXMgYSBzdXBwb3J0ZWQgSGVhZGVyXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNTdXBwb3J0ZWRIZWFkZXIoa2V5OiBzdHJpbmcpIHtcclxuICBjb25zdCBzdXBwb3J0ZWRfaGVhZGVycyA9IFtcclxuICAgICdjb250ZW50LXR5cGUnLFxyXG4gICAgJ2NhY2hlLWNvbnRyb2wnLFxyXG4gICAgJ2NvbnRlbnQtZW5jb2RpbmcnLFxyXG4gICAgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLFxyXG4gICAgJ2NvbnRlbnQtbGFuZ3VhZ2UnLFxyXG4gICAgJ3gtYW16LXdlYnNpdGUtcmVkaXJlY3QtbG9jYXRpb24nLFxyXG4gICAgJ2lmLW5vbmUtbWF0Y2gnLFxyXG4gICAgJ2lmLW1hdGNoJyxcclxuICBdXHJcbiAgcmV0dXJuIHN1cHBvcnRlZF9oZWFkZXJzLmluY2x1ZGVzKGtleS50b0xvd2VyQ2FzZSgpKVxyXG59XHJcblxyXG4vKipcclxuICogQ2hlY2tzIGlmIGl0IGlzIGEgc3RvcmFnZSBoZWFkZXJcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXk6IHN0cmluZykge1xyXG4gIHJldHVybiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ3gtYW16LXN0b3JhZ2UtY2xhc3MnXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0TWV0YWRhdGEoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIpIHtcclxuICByZXR1cm4gXy5tYXBLZXlzKFxyXG4gICAgXy5waWNrQnkoaGVhZGVycywgKHZhbHVlLCBrZXkpID0+IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSB8fCBpc0FtekhlYWRlcihrZXkpKSxcclxuICAgICh2YWx1ZSwga2V5KSA9PiB7XHJcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKClcclxuICAgICAgaWYgKGxvd2VyLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpKSB7XHJcbiAgICAgICAgcmV0dXJuIGxvd2VyLnNsaWNlKE1ldGFEYXRhSGVhZGVyUHJlZml4Lmxlbmd0aClcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIGtleVxyXG4gICAgfSxcclxuICApXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xyXG4gIHJldHVybiBoZWFkZXJzWyd4LWFtei12ZXJzaW9uLWlkJ10gfHwgbnVsbFxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0U291cmNlVmVyc2lvbklkKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyID0ge30pIHtcclxuICByZXR1cm4gaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtdmVyc2lvbi1pZCddIHx8IG51bGxcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRVRhZyhldGFnID0gJycpOiBzdHJpbmcge1xyXG4gIGNvbnN0IHJlcGxhY2VDaGFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICdcIic6ICcnLFxyXG4gICAgJyZxdW90Oyc6ICcnLFxyXG4gICAgJyYjMzQ7JzogJycsXHJcbiAgICAnJlFVT1Q7JzogJycsXHJcbiAgICAnJiN4MDAwMjInOiAnJyxcclxuICB9XHJcbiAgcmV0dXJuIGV0YWcucmVwbGFjZSgvXihcInwmcXVvdDt8JiMzNDspfChcInwmcXVvdDt8JiMzNDspJC9nLCAobSkgPT4gcmVwbGFjZUNoYXJzW21dIGFzIHN0cmluZylcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHRvTWQ1KHBheWxvYWQ6IEJpbmFyeSk6IHN0cmluZyB7XHJcbiAgLy8gdXNlIHN0cmluZyBmcm9tIGJyb3dzZXIgYW5kIGJ1ZmZlciBmcm9tIG5vZGVqc1xyXG4gIC8vIGJyb3dzZXIgc3VwcG9ydCBpcyB0ZXN0ZWQgb25seSBhZ2FpbnN0IG1pbmlvIHNlcnZlclxyXG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEJ1ZmZlci5mcm9tKHBheWxvYWQpKS5kaWdlc3QoKS50b1N0cmluZygnYmFzZTY0JylcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHRvU2hhMjU2KHBheWxvYWQ6IEJpbmFyeSk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKVxyXG59XHJcblxyXG4vKipcclxuICogdG9BcnJheSByZXR1cm5zIGEgc2luZ2xlIGVsZW1lbnQgYXJyYXkgd2l0aCBwYXJhbSBiZWluZyB0aGUgZWxlbWVudCxcclxuICogaWYgcGFyYW0gaXMganVzdCBhIHN0cmluZywgYW5kIHJldHVybnMgJ3BhcmFtJyBiYWNrIGlmIGl0IGlzIGFuIGFycmF5XHJcbiAqIFNvLCBpdCBtYWtlcyBzdXJlIHBhcmFtIGlzIGFsd2F5cyBhbiBhcnJheVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHRvQXJyYXk8VCA9IHVua25vd24+KHBhcmFtOiBUIHwgVFtdKTogQXJyYXk8VD4ge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShwYXJhbSkpIHtcclxuICAgIHJldHVybiBbcGFyYW1dIGFzIFRbXVxyXG4gIH1cclxuICByZXR1cm4gcGFyYW1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplT2JqZWN0S2V5KG9iamVjdE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgLy8gKyBzeW1ib2wgY2hhcmFjdGVycyBhcmUgbm90IGRlY29kZWQgYXMgc3BhY2VzIGluIEpTLiBzbyByZXBsYWNlIHRoZW0gZmlyc3QgYW5kIGRlY29kZSB0byBnZXQgdGhlIGNvcnJlY3QgcmVzdWx0LlxyXG4gIGNvbnN0IGFzU3RyTmFtZSA9IChvYmplY3ROYW1lID8gb2JqZWN0TmFtZS50b1N0cmluZygpIDogJycpLnJlcGxhY2UoL1xcKy9nLCAnICcpXHJcbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhc1N0ck5hbWUpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNpemUoc2l6ZT86IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XHJcbiAgcmV0dXJuIHNpemUgPyBOdW1iZXIucGFyc2VJbnQoc2l6ZSkgOiB1bmRlZmluZWRcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IFBBUlRfQ09OU1RSQUlOVFMgPSB7XHJcbiAgLy8gYWJzTWluUGFydFNpemUgLSBhYnNvbHV0ZSBtaW5pbXVtIHBhcnQgc2l6ZSAoNSBNaUIpXHJcbiAgQUJTX01JTl9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogNSxcclxuICAvLyBNSU5fUEFSVF9TSVpFIC0gbWluaW11bSBwYXJ0IHNpemUgMTZNaUIgcGVyIG9iamVjdCBhZnRlciB3aGljaFxyXG4gIE1JTl9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTYsXHJcbiAgLy8gTUFYX1BBUlRTX0NPVU5UIC0gbWF4aW11bSBudW1iZXIgb2YgcGFydHMgZm9yIGEgc2luZ2xlIG11bHRpcGFydCBzZXNzaW9uLlxyXG4gIE1BWF9QQVJUU19DT1VOVDogMTAwMDAsXHJcbiAgLy8gTUFYX1BBUlRfU0laRSAtIG1heGltdW0gcGFydCBzaXplIDVHaUIgZm9yIGEgc2luZ2xlIG11bHRpcGFydCB1cGxvYWRcclxuICAvLyBvcGVyYXRpb24uXHJcbiAgTUFYX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcclxuICAvLyBNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1R2lCIG9mIG9iamVjdCBwZXIgUFVUXHJcbiAgLy8gb3BlcmF0aW9uLlxyXG4gIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxyXG4gIC8vIE1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIC0gbWF4aW11bSBzaXplIDVUaUIgb2Ygb2JqZWN0IGZvclxyXG4gIC8vIE11bHRpcGFydCBvcGVyYXRpb24uXHJcbiAgTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxyXG59XHJcblxyXG5jb25zdCBHRU5FUklDX1NTRV9IRUFERVIgPSAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbidcclxuXHJcbmNvbnN0IEVOQ1JZUFRJT05fSEVBREVSUyA9IHtcclxuICAvLyBzc2VHZW5lcmljSGVhZGVyIGlzIHRoZSBBV1MgU1NFIGhlYWRlciB1c2VkIGZvciBTU0UtUzMgYW5kIFNTRS1LTVMuXHJcbiAgc3NlR2VuZXJpY0hlYWRlcjogR0VORVJJQ19TU0VfSEVBREVSLFxyXG4gIC8vIHNzZUttc0tleUlEIGlzIHRoZSBBV1MgU1NFLUtNUyBrZXkgaWQuXHJcbiAgc3NlS21zS2V5SUQ6IEdFTkVSSUNfU1NFX0hFQURFUiArICctQXdzLUttcy1LZXktSWQnLFxyXG59IGFzIGNvbnN0XHJcblxyXG4vKipcclxuICogUmV0dXJuIEVuY3J5cHRpb24gaGVhZGVyc1xyXG4gKiBAcGFyYW0gZW5jQ29uZmlnXHJcbiAqIEByZXR1cm5zIGFuIG9iamVjdCB3aXRoIGtleSB2YWx1ZSBwYWlycyB0aGF0IGNhbiBiZSB1c2VkIGluIGhlYWRlcnMuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5jcnlwdGlvbkhlYWRlcnMoZW5jQ29uZmlnOiBFbmNyeXB0aW9uKTogUmVxdWVzdEhlYWRlcnMge1xyXG4gIGNvbnN0IGVuY1R5cGUgPSBlbmNDb25maWcudHlwZVxyXG5cclxuICBpZiAoIWlzRW1wdHkoZW5jVHlwZSkpIHtcclxuICAgIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLlNTRUMpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUdlbmVyaWNIZWFkZXJdOiAnQUVTMjU2JyxcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLktNUykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06IGVuY0NvbmZpZy5TU0VBbGdvcml0aG0sXHJcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VLbXNLZXlJRF06IGVuY0NvbmZpZy5LTVNNYXN0ZXJLZXlJRCxcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHt9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJ0c1JlcXVpcmVkKHNpemU6IG51bWJlcik6IG51bWJlciB7XHJcbiAgY29uc3QgbWF4UGFydFNpemUgPSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIC8gKFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UIC0gMSlcclxuICBsZXQgcmVxdWlyZWRQYXJ0U2l6ZSA9IHNpemUgLyBtYXhQYXJ0U2l6ZVxyXG4gIGlmIChzaXplICUgbWF4UGFydFNpemUgPiAwKSB7XHJcbiAgICByZXF1aXJlZFBhcnRTaXplKytcclxuICB9XHJcbiAgcmVxdWlyZWRQYXJ0U2l6ZSA9IE1hdGgudHJ1bmMocmVxdWlyZWRQYXJ0U2l6ZSlcclxuICByZXR1cm4gcmVxdWlyZWRQYXJ0U2l6ZVxyXG59XHJcblxyXG4vKipcclxuICogY2FsY3VsYXRlRXZlblNwbGl0cyAtIGNvbXB1dGVzIHNwbGl0cyBmb3IgYSBzb3VyY2UgYW5kIHJldHVybnNcclxuICogc3RhcnQgYW5kIGVuZCBpbmRleCBzbGljZXMuIFNwbGl0cyBoYXBwZW4gZXZlbmx5IHRvIGJlIHN1cmUgdGhhdCBub1xyXG4gKiBwYXJ0IGlzIGxlc3MgdGhhbiA1TWlCLCBhcyB0aGF0IGNvdWxkIGZhaWwgdGhlIG11bHRpcGFydCByZXF1ZXN0IGlmXHJcbiAqIGl0IGlzIG5vdCB0aGUgbGFzdCBwYXJ0LlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNhbGN1bGF0ZUV2ZW5TcGxpdHM8VCBleHRlbmRzIHsgU3RhcnQ/OiBudW1iZXIgfT4oXHJcbiAgc2l6ZTogbnVtYmVyLFxyXG4gIG9iakluZm86IFQsXHJcbik6IHtcclxuICBzdGFydEluZGV4OiBudW1iZXJbXVxyXG4gIG9iakluZm86IFRcclxuICBlbmRJbmRleDogbnVtYmVyW11cclxufSB8IG51bGwge1xyXG4gIGlmIChzaXplID09PSAwKSB7XHJcbiAgICByZXR1cm4gbnVsbFxyXG4gIH1cclxuICBjb25zdCByZXFQYXJ0cyA9IHBhcnRzUmVxdWlyZWQoc2l6ZSlcclxuICBjb25zdCBzdGFydEluZGV4UGFydHM6IG51bWJlcltdID0gW11cclxuICBjb25zdCBlbmRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXHJcblxyXG4gIGxldCBzdGFydCA9IG9iakluZm8uU3RhcnRcclxuICBpZiAoaXNFbXB0eShzdGFydCkgfHwgc3RhcnQgPT09IC0xKSB7XHJcbiAgICBzdGFydCA9IDBcclxuICB9XHJcbiAgY29uc3QgZGl2aXNvclZhbHVlID0gTWF0aC50cnVuYyhzaXplIC8gcmVxUGFydHMpXHJcblxyXG4gIGNvbnN0IHJlbWluZGVyVmFsdWUgPSBzaXplICUgcmVxUGFydHNcclxuXHJcbiAgbGV0IG5leHRTdGFydCA9IHN0YXJ0XHJcblxyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVxUGFydHM7IGkrKykge1xyXG4gICAgbGV0IGN1clBhcnRTaXplID0gZGl2aXNvclZhbHVlXHJcbiAgICBpZiAoaSA8IHJlbWluZGVyVmFsdWUpIHtcclxuICAgICAgY3VyUGFydFNpemUrK1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGN1cnJlbnRTdGFydCA9IG5leHRTdGFydFxyXG4gICAgY29uc3QgY3VycmVudEVuZCA9IGN1cnJlbnRTdGFydCArIGN1clBhcnRTaXplIC0gMVxyXG4gICAgbmV4dFN0YXJ0ID0gY3VycmVudEVuZCArIDFcclxuXHJcbiAgICBzdGFydEluZGV4UGFydHMucHVzaChjdXJyZW50U3RhcnQpXHJcbiAgICBlbmRJbmRleFBhcnRzLnB1c2goY3VycmVudEVuZClcclxuICB9XHJcblxyXG4gIHJldHVybiB7IHN0YXJ0SW5kZXg6IHN0YXJ0SW5kZXhQYXJ0cywgZW5kSW5kZXg6IGVuZEluZGV4UGFydHMsIG9iakluZm86IG9iakluZm8gfVxyXG59XHJcbmNvbnN0IGZ4cCA9IG5ldyBYTUxQYXJzZXIoeyBudW1iZXJQYXJzZU9wdGlvbnM6IHsgZU5vdGF0aW9uOiBmYWxzZSwgaGV4OiB0cnVlLCBsZWFkaW5nWmVyb3M6IHRydWUgfSB9KVxyXG5cclxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlWG1sKHhtbDogc3RyaW5nKTogYW55IHtcclxuICBjb25zdCByZXN1bHQgPSBmeHAucGFyc2UoeG1sKVxyXG4gIGlmIChyZXN1bHQuRXJyb3IpIHtcclxuICAgIHRocm93IHJlc3VsdC5FcnJvclxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlc3VsdFxyXG59XHJcblxyXG4vKipcclxuICogZ2V0IGNvbnRlbnQgc2l6ZSBvZiBvYmplY3QgY29udGVudCB0byB1cGxvYWRcclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDb250ZW50TGVuZ3RoKHM6IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlciB8IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xyXG4gIC8vIHVzZSBsZW5ndGggcHJvcGVydHkgb2Ygc3RyaW5nIHwgQnVmZmVyXHJcbiAgaWYgKHR5cGVvZiBzID09PSAnc3RyaW5nJyB8fCBCdWZmZXIuaXNCdWZmZXIocykpIHtcclxuICAgIHJldHVybiBzLmxlbmd0aFxyXG4gIH1cclxuXHJcbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXHJcbiAgY29uc3QgZmlsZVBhdGggPSAocyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5wYXRoIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxyXG4gIGlmIChmaWxlUGF0aCAmJiB0eXBlb2YgZmlsZVBhdGggPT09ICdzdHJpbmcnKSB7XHJcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnNwLmxzdGF0KGZpbGVQYXRoKVxyXG4gICAgcmV0dXJuIHN0YXQuc2l6ZVxyXG4gIH1cclxuXHJcbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXHJcbiAgY29uc3QgZmQgPSAocyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5mZCBhcyBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkXHJcbiAgaWYgKGZkICYmIHR5cGVvZiBmZCA9PT0gJ251bWJlcicpIHtcclxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3RhdChmZClcclxuICAgIHJldHVybiBzdGF0LnNpemVcclxuICB9XHJcblxyXG4gIHJldHVybiBudWxsXHJcbn1cclxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsT0FBTyxLQUFLQSxNQUFNO0FBQ2xCLE9BQU8sS0FBS0MsTUFBTTtBQUVsQixTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBQzNDLE9BQU9DLE1BQU0sTUFBTSxXQUFXO0FBQzlCLE9BQU9DLENBQUMsTUFBTSxRQUFRO0FBQ3RCLE9BQU8sS0FBS0MsSUFBSSxNQUFNLFlBQVk7QUFFbEMsU0FBU0MsR0FBRyxFQUFFQyxLQUFLLFFBQVEsYUFBWTtBQUV2QyxTQUFTQyxnQkFBZ0IsUUFBUSxZQUFXO0FBRTVDLE1BQU1DLG9CQUFvQixH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