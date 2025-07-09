"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.calculateEvenSplits = calculateEvenSplits;
exports.extractMetadata = extractMetadata;
exports.getContentLength = getContentLength;
exports.getEncryptionHeaders = getEncryptionHeaders;
exports.getScope = getScope;
exports.getSourceVersionId = getSourceVersionId;
exports.getVersionId = getVersionId;
exports.hashBinary = hashBinary;
exports.insertContentType = insertContentType;
exports.isAmazonEndpoint = isAmazonEndpoint;
exports.isAmzHeader = isAmzHeader;
exports.isBoolean = isBoolean;
exports.isDefined = isDefined;
exports.isEmpty = isEmpty;
exports.isEmptyObject = isEmptyObject;
exports.isFunction = isFunction;
exports.isNumber = isNumber;
exports.isObject = isObject;
exports.isPlainObject = isPlainObject;
exports.isReadableStream = isReadableStream;
exports.isStorageClassHeader = isStorageClassHeader;
exports.isString = isString;
exports.isSupportedHeader = isSupportedHeader;
exports.isValidBucketName = isValidBucketName;
exports.isValidDate = isValidDate;
exports.isValidDomain = isValidDomain;
exports.isValidEndpoint = isValidEndpoint;
exports.isValidIP = isValidIP;
exports.isValidObjectName = isValidObjectName;
exports.isValidPort = isValidPort;
exports.isValidPrefix = isValidPrefix;
exports.isVirtualHostStyle = isVirtualHostStyle;
exports.makeDateLong = makeDateLong;
exports.makeDateShort = makeDateShort;
exports.parseXml = parseXml;
exports.partsRequired = partsRequired;
exports.pipesetup = pipesetup;
exports.prependXAMZMeta = prependXAMZMeta;
exports.probeContentType = probeContentType;
exports.readableStream = readableStream;
exports.sanitizeETag = sanitizeETag;
exports.sanitizeObjectKey = sanitizeObjectKey;
exports.sanitizeSize = sanitizeSize;
exports.toArray = toArray;
exports.toMd5 = toMd5;
exports.toSha256 = toSha256;
exports.uriEscape = uriEscape;
exports.uriResourceEscape = uriResourceEscape;
var crypto = _interopRequireWildcard(require("crypto"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var _fastXmlParser = require("fast-xml-parser");
var _ipaddr = require("ipaddr.js");
var _lodash = require("lodash");
var mime = _interopRequireWildcard(require("mime-types"), true);
var _async = require("./async.js");
var _type = require("./type.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
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

const MetaDataHeaderPrefix = 'x-amz-meta-';
function hashBinary(buf, enableSHA256) {
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
function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
function isValidIP(ip) {
  return _ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
function isValidDomain(host) {
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
function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
function isValidPort(port) {
  // Convert string port to number if needed
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  // verify if port is a valid number
  if (!isNumber(portNum) || isNaN(portNum)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= portNum && portNum <= 65535;
}
function isValidBucketName(bucket) {
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
function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
function isValidPrefix(prefix) {
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
function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
/**
 * check if typeof arg is plain object
 */
function isPlainObject(arg) {
  return Object.prototype.toString.call(arg) === '[object Object]';
}
/**
 * check if object is readable stream
 */
function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
function isBoolean(arg) {
  return typeof arg === 'boolean';
}
function isEmpty(o) {
  return _lodash.isEmpty(o);
}
function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
function makeDateShort(date) {
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
function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
function insertContentType(metaData, filePath) {
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
function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _lodash.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location', 'if-none-match', 'if-match'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
function extractMetadata(headers) {
  return _lodash.mapKeys(_lodash.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
const PART_CONSTRAINTS = exports.PART_CONSTRAINTS = {
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
function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === _type.ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === _type.ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
function partsRequired(size) {
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
function calculateEvenSplits(size, objInfo) {
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
const fxp = new _fastXmlParser.XMLParser({
  numberParseOptions: {
    eNotation: false,
    hex: true,
    leadingZeros: true
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await _async.fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await (0, _async.fstat)(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJzdHJlYW0iLCJfZmFzdFhtbFBhcnNlciIsIl9pcGFkZHIiLCJfbG9kYXNoIiwibWltZSIsIl9hc3luYyIsIl90eXBlIiwiZSIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJfX2VzTW9kdWxlIiwibyIsImkiLCJmIiwiX19wcm90b19fIiwiZGVmYXVsdCIsImhhcyIsImdldCIsInNldCIsImhhc093blByb3BlcnR5IiwiY2FsbCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiTWV0YURhdGFIZWFkZXJQcmVmaXgiLCJoYXNoQmluYXJ5IiwiYnVmIiwiZW5hYmxlU0hBMjU2Iiwic2hhMjU2c3VtIiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm1kNXN1bSIsImVuY29kZUFzSGV4IiwiYyIsImNoYXJDb2RlQXQiLCJ0b1N0cmluZyIsInRvVXBwZXJDYXNlIiwidXJpRXNjYXBlIiwidXJpU3RyIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZSIsInVyaVJlc291cmNlRXNjYXBlIiwic3RyaW5nIiwiZ2V0U2NvcGUiLCJyZWdpb24iLCJkYXRlIiwic2VydmljZU5hbWUiLCJtYWtlRGF0ZVNob3J0IiwiaXNBbWF6b25FbmRwb2ludCIsImVuZHBvaW50IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwicHJvdG9jb2wiLCJidWNrZXQiLCJwYXRoU3R5bGUiLCJpbmNsdWRlcyIsImlzVmFsaWRJUCIsImlwIiwiaXBhZGRyIiwiaXNWYWxpZCIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWREb21haW4iLCJob3N0IiwiaXNTdHJpbmciLCJsZW5ndGgiLCJzbGljZSIsIm5vbkFscGhhTnVtZXJpY3MiLCJjaGFyIiwicHJvYmVDb250ZW50VHlwZSIsInBhdGgiLCJjb250ZW50VHlwZSIsImxvb2t1cCIsImlzVmFsaWRQb3J0IiwicG9ydCIsInBvcnROdW0iLCJwYXJzZUludCIsImlzTnVtYmVyIiwiaXNOYU4iLCJpc1ZhbGlkQnVja2V0TmFtZSIsInRlc3QiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIm9iamVjdE5hbWUiLCJpc1ZhbGlkUHJlZml4IiwicHJlZml4IiwiYXJnIiwiaXNGdW5jdGlvbiIsImlzT2JqZWN0IiwiaXNQbGFpbk9iamVjdCIsInByb3RvdHlwZSIsImlzUmVhZGFibGVTdHJlYW0iLCJfcmVhZCIsImlzQm9vbGVhbiIsImlzRW1wdHkiLCJfIiwiaXNFbXB0eU9iamVjdCIsInZhbHVlcyIsImZpbHRlciIsIngiLCJ1bmRlZmluZWQiLCJpc0RlZmluZWQiLCJpc1ZhbGlkRGF0ZSIsIkRhdGUiLCJtYWtlRGF0ZUxvbmciLCJzIiwidG9JU09TdHJpbmciLCJwaXBlc2V0dXAiLCJzdHJlYW1zIiwicmVkdWNlIiwic3JjIiwiZHN0Iiwib24iLCJlcnIiLCJlbWl0IiwicGlwZSIsInJlYWRhYmxlU3RyZWFtIiwiZGF0YSIsIlJlYWRhYmxlIiwicHVzaCIsImluc2VydENvbnRlbnRUeXBlIiwibWV0YURhdGEiLCJmaWxlUGF0aCIsImtleSIsInRvTG93ZXJDYXNlIiwicHJlcGVuZFhBTVpNZXRhIiwibWFwS2V5cyIsInZhbHVlIiwiaXNBbXpIZWFkZXIiLCJpc1N1cHBvcnRlZEhlYWRlciIsImlzU3RvcmFnZUNsYXNzSGVhZGVyIiwidGVtcCIsInN0YXJ0c1dpdGgiLCJzdXBwb3J0ZWRfaGVhZGVycyIsImV4dHJhY3RNZXRhZGF0YSIsImhlYWRlcnMiLCJwaWNrQnkiLCJsb3dlciIsImdldFZlcnNpb25JZCIsImdldFNvdXJjZVZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsImV0YWciLCJyZXBsYWNlQ2hhcnMiLCJtIiwidG9NZDUiLCJwYXlsb2FkIiwiQnVmZmVyIiwiZnJvbSIsInRvU2hhMjU2IiwidG9BcnJheSIsInBhcmFtIiwiQXJyYXkiLCJpc0FycmF5Iiwic2FuaXRpemVPYmplY3RLZXkiLCJhc1N0ck5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJzYW5pdGl6ZVNpemUiLCJzaXplIiwiTnVtYmVyIiwiUEFSVF9DT05TVFJBSU5UUyIsImV4cG9ydHMiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1JTl9QQVJUX1NJWkUiLCJNQVhfUEFSVFNfQ09VTlQiLCJNQVhfUEFSVF9TSVpFIiwiTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsIkdFTkVSSUNfU1NFX0hFQURFUiIsIkVOQ1JZUFRJT05fSEVBREVSUyIsInNzZUdlbmVyaWNIZWFkZXIiLCJzc2VLbXNLZXlJRCIsImdldEVuY3J5cHRpb25IZWFkZXJzIiwiZW5jQ29uZmlnIiwiZW5jVHlwZSIsInR5cGUiLCJFTkNSWVBUSU9OX1RZUEVTIiwiU1NFQyIsIktNUyIsIlNTRUFsZ29yaXRobSIsIktNU01hc3RlcktleUlEIiwicGFydHNSZXF1aXJlZCIsIm1heFBhcnRTaXplIiwicmVxdWlyZWRQYXJ0U2l6ZSIsIk1hdGgiLCJ0cnVuYyIsImNhbGN1bGF0ZUV2ZW5TcGxpdHMiLCJvYmpJbmZvIiwicmVxUGFydHMiLCJzdGFydEluZGV4UGFydHMiLCJlbmRJbmRleFBhcnRzIiwic3RhcnQiLCJTdGFydCIsImRpdmlzb3JWYWx1ZSIsInJlbWluZGVyVmFsdWUiLCJuZXh0U3RhcnQiLCJjdXJQYXJ0U2l6ZSIsImN1cnJlbnRTdGFydCIsImN1cnJlbnRFbmQiLCJzdGFydEluZGV4IiwiZW5kSW5kZXgiLCJmeHAiLCJYTUxQYXJzZXIiLCJudW1iZXJQYXJzZU9wdGlvbnMiLCJlTm90YXRpb24iLCJoZXgiLCJsZWFkaW5nWmVyb3MiLCJwYXJzZVhtbCIsInhtbCIsInJlc3VsdCIsInBhcnNlIiwiRXJyb3IiLCJnZXRDb250ZW50TGVuZ3RoIiwiaXNCdWZmZXIiLCJzdGF0IiwiZnNwIiwibHN0YXQiLCJmZCIsImZzdGF0Il0sInNvdXJjZXMiOlsiaGVscGVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXHJcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUgTWluSU8sIEluYy5cclxuICpcclxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcclxuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxyXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcclxuICpcclxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxyXG4gKlxyXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXHJcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcclxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXHJcbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcclxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXHJcbiAqL1xyXG5cclxuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xyXG5pbXBvcnQgKiBhcyBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXHJcblxyXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXHJcbmltcG9ydCBpcGFkZHIgZnJvbSAnaXBhZGRyLmpzJ1xyXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXHJcbmltcG9ydCAqIGFzIG1pbWUgZnJvbSAnbWltZS10eXBlcydcclxuXHJcbmltcG9ydCB7IGZzcCwgZnN0YXQgfSBmcm9tICcuL2FzeW5jLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IEJpbmFyeSwgRW5jcnlwdGlvbiwgT2JqZWN0TWV0YURhdGEsIFJlcXVlc3RIZWFkZXJzLCBSZXNwb25zZUhlYWRlciB9IGZyb20gJy4vdHlwZS50cydcclxuaW1wb3J0IHsgRU5DUllQVElPTl9UWVBFUyB9IGZyb20gJy4vdHlwZS50cydcclxuXHJcbmNvbnN0IE1ldGFEYXRhSGVhZGVyUHJlZml4ID0gJ3gtYW16LW1ldGEtJ1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hCaW5hcnkoYnVmOiBCdWZmZXIsIGVuYWJsZVNIQTI1NjogYm9vbGVhbikge1xyXG4gIGxldCBzaGEyNTZzdW0gPSAnJ1xyXG4gIGlmIChlbmFibGVTSEEyNTYpIHtcclxuICAgIHNoYTI1NnN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoYnVmKS5kaWdlc3QoJ2hleCcpXHJcbiAgfVxyXG4gIGNvbnN0IG1kNXN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoYnVmKS5kaWdlc3QoJ2Jhc2U2NCcpXHJcblxyXG4gIHJldHVybiB7IG1kNXN1bSwgc2hhMjU2c3VtIH1cclxufVxyXG5cclxuLy8gUzMgcGVyY2VudC1lbmNvZGVzIHNvbWUgZXh0cmEgbm9uLXN0YW5kYXJkIGNoYXJhY3RlcnMgaW4gYSBVUkkgLiBTbyBjb21wbHkgd2l0aCBTMy5cclxuY29uc3QgZW5jb2RlQXNIZXggPSAoYzogc3RyaW5nKSA9PiBgJSR7Yy5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpfWBcclxuZXhwb3J0IGZ1bmN0aW9uIHVyaUVzY2FwZSh1cmlTdHI6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudCh1cmlTdHIpLnJlcGxhY2UoL1shJygpKl0vZywgZW5jb2RlQXNIZXgpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB1cmlSZXNvdXJjZUVzY2FwZShzdHJpbmc6IHN0cmluZykge1xyXG4gIHJldHVybiB1cmlFc2NhcGUoc3RyaW5nKS5yZXBsYWNlKC8lMkYvZywgJy8nKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2NvcGUocmVnaW9uOiBzdHJpbmcsIGRhdGU6IERhdGUsIHNlcnZpY2VOYW1lID0gJ3MzJykge1xyXG4gIHJldHVybiBgJHttYWtlRGF0ZVNob3J0KGRhdGUpfS8ke3JlZ2lvbn0vJHtzZXJ2aWNlTmFtZX0vYXdzNF9yZXF1ZXN0YFxyXG59XHJcblxyXG4vKipcclxuICogaXNBbWF6b25FbmRwb2ludCAtIHRydWUgaWYgZW5kcG9pbnQgaXMgJ3MzLmFtYXpvbmF3cy5jb20nIG9yICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNBbWF6b25FbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIGVuZHBvaW50ID09PSAnczMuYW1hem9uYXdzLmNvbScgfHwgZW5kcG9pbnQgPT09ICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBpc1ZpcnR1YWxIb3N0U3R5bGUgLSB2ZXJpZnkgaWYgYnVja2V0IG5hbWUgaXMgc3VwcG9ydCB3aXRoIHZpcnR1YWxcclxuICogaG9zdHMuIGJ1Y2tldE5hbWVzIHdpdGggcGVyaW9kcyBzaG91bGQgYmUgYWx3YXlzIHRyZWF0ZWQgYXMgcGF0aFxyXG4gKiBzdHlsZSBpZiB0aGUgcHJvdG9jb2wgaXMgJ2h0dHBzOicsIHRoaXMgaXMgZHVlIHRvIFNTTCB3aWxkY2FyZFxyXG4gKiBsaW1pdGF0aW9uLiBGb3IgYWxsIG90aGVyIGJ1Y2tldHMgYW5kIEFtYXpvbiBTMyBlbmRwb2ludCB3ZSB3aWxsXHJcbiAqIGRlZmF1bHQgdG8gdmlydHVhbCBob3N0IHN0eWxlLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmlydHVhbEhvc3RTdHlsZShlbmRwb2ludDogc3RyaW5nLCBwcm90b2NvbDogc3RyaW5nLCBidWNrZXQ6IHN0cmluZywgcGF0aFN0eWxlOiBib29sZWFuKSB7XHJcbiAgaWYgKHByb3RvY29sID09PSAnaHR0cHM6JyAmJiBidWNrZXQuaW5jbHVkZXMoJy4nKSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIHJldHVybiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50KSB8fCAhcGF0aFN0eWxlXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkSVAoaXA6IHN0cmluZykge1xyXG4gIHJldHVybiBpcGFkZHIuaXNWYWxpZChpcClcclxufVxyXG5cclxuLyoqXHJcbiAqIEByZXR1cm5zIGlmIGVuZHBvaW50IGlzIHZhbGlkIGRvbWFpbi5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRW5kcG9pbnQoZW5kcG9pbnQ6IHN0cmluZykge1xyXG4gIHJldHVybiBpc1ZhbGlkRG9tYWluKGVuZHBvaW50KSB8fCBpc1ZhbGlkSVAoZW5kcG9pbnQpXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBAcmV0dXJucyBpZiBpbnB1dCBob3N0IGlzIGEgdmFsaWQgZG9tYWluLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWREb21haW4oaG9zdDogc3RyaW5nKSB7XHJcbiAgaWYgKCFpc1N0cmluZyhob3N0KSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIC8vIFNlZSBSRkMgMTAzNSwgUkZDIDM2OTYuXHJcbiAgaWYgKGhvc3QubGVuZ3RoID09PSAwIHx8IGhvc3QubGVuZ3RoID4gMjU1KSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgb3IgZW5kIHdpdGggYSAnLSdcclxuICBpZiAoaG9zdFswXSA9PT0gJy0nIHx8IGhvc3Quc2xpY2UoLTEpID09PSAnLScpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuICAvLyBIb3N0IGNhbm5vdCBzdGFydCBvciBlbmQgd2l0aCBhICdfJ1xyXG4gIGlmIChob3N0WzBdID09PSAnXycgfHwgaG9zdC5zbGljZSgtMSkgPT09ICdfJykge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IHdpdGggYSAnLidcclxuICBpZiAoaG9zdFswXSA9PT0gJy4nKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcblxyXG4gIGNvbnN0IG5vbkFscGhhTnVtZXJpY3MgPSAnYH4hQCMkJV4mKigpKz17fVtdfFxcXFxcIlxcJzs6Pjw/LydcclxuICAvLyBBbGwgbm9uIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFyZSBpbnZhbGlkLlxyXG4gIGZvciAoY29uc3QgY2hhciBvZiBub25BbHBoYU51bWVyaWNzKSB7XHJcbiAgICBpZiAoaG9zdC5pbmNsdWRlcyhjaGFyKSkge1xyXG4gICAgICByZXR1cm4gZmFsc2VcclxuICAgIH1cclxuICB9XHJcbiAgLy8gTm8gbmVlZCB0byByZWdleHAgbWF0Y2gsIHNpbmNlIHRoZSBsaXN0IGlzIG5vbi1leGhhdXN0aXZlLlxyXG4gIC8vIFdlIGxldCBpdCBiZSB2YWxpZCBhbmQgZmFpbCBsYXRlci5cclxuICByZXR1cm4gdHJ1ZVxyXG59XHJcblxyXG4vKipcclxuICogUHJvYmVzIGNvbnRlbnRUeXBlIHVzaW5nIGZpbGUgZXh0ZW5zaW9ucy5cclxuICpcclxuICogQGV4YW1wbGVcclxuICogYGBgXHJcbiAqIC8vIHJldHVybiAnaW1hZ2UvcG5nJ1xyXG4gKiBwcm9iZUNvbnRlbnRUeXBlKCdmaWxlLnBuZycpXHJcbiAqIGBgYFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHByb2JlQ29udGVudFR5cGUocGF0aDogc3RyaW5nKSB7XHJcbiAgbGV0IGNvbnRlbnRUeXBlID0gbWltZS5sb29rdXAocGF0aClcclxuICBpZiAoIWNvbnRlbnRUeXBlKSB7XHJcbiAgICBjb250ZW50VHlwZSA9ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nXHJcbiAgfVxyXG4gIHJldHVybiBjb250ZW50VHlwZVxyXG59XHJcblxyXG4vKipcclxuICogaXMgaW5wdXQgcG9ydCB2YWxpZC5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUG9ydChwb3J0OiB1bmtub3duKTogcG9ydCBpcyBudW1iZXIge1xyXG4gIC8vIENvbnZlcnQgc3RyaW5nIHBvcnQgdG8gbnVtYmVyIGlmIG5lZWRlZFxyXG4gIGNvbnN0IHBvcnROdW0gPSB0eXBlb2YgcG9ydCA9PT0gJ3N0cmluZycgPyBwYXJzZUludChwb3J0LCAxMCkgOiBwb3J0XHJcblxyXG4gIC8vIHZlcmlmeSBpZiBwb3J0IGlzIGEgdmFsaWQgbnVtYmVyXHJcbiAgaWYgKCFpc051bWJlcihwb3J0TnVtKSB8fCBpc05hTihwb3J0TnVtKSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG5cclxuICAvLyBwb3J0IGAwYCBpcyB2YWxpZCBhbmQgc3BlY2lhbCBjYXNlXHJcbiAgcmV0dXJuIDAgPD0gcG9ydE51bSAmJiBwb3J0TnVtIDw9IDY1NTM1XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQ6IHVua25vd24pIHtcclxuICBpZiAoIWlzU3RyaW5nKGJ1Y2tldCkpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuXHJcbiAgLy8gYnVja2V0IGxlbmd0aCBzaG91bGQgYmUgbGVzcyB0aGFuIGFuZCBubyBtb3JlIHRoYW4gNjNcclxuICAvLyBjaGFyYWN0ZXJzIGxvbmcuXHJcbiAgaWYgKGJ1Y2tldC5sZW5ndGggPCAzIHx8IGJ1Y2tldC5sZW5ndGggPiA2Mykge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIC8vIGJ1Y2tldCB3aXRoIHN1Y2Nlc3NpdmUgcGVyaW9kcyBpcyBpbnZhbGlkLlxyXG4gIGlmIChidWNrZXQuaW5jbHVkZXMoJy4uJykpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuICAvLyBidWNrZXQgY2Fubm90IGhhdmUgaXAgYWRkcmVzcyBzdHlsZS5cclxuICBpZiAoL1swLTldK1xcLlswLTldK1xcLlswLTldK1xcLlswLTldKy8udGVzdChidWNrZXQpKSB7XHJcbiAgICByZXR1cm4gZmFsc2VcclxuICB9XHJcbiAgLy8gYnVja2V0IHNob3VsZCBiZWdpbiB3aXRoIGFscGhhYmV0L251bWJlciBhbmQgZW5kIHdpdGggYWxwaGFiZXQvbnVtYmVyLFxyXG4gIC8vIHdpdGggYWxwaGFiZXQvbnVtYmVyLy4tIGluIHRoZSBtaWRkbGUuXHJcbiAgaWYgKC9eW2EtejAtOV1bYS16MC05Li1dK1thLXowLTldJC8udGVzdChidWNrZXQpKSB7XHJcbiAgICByZXR1cm4gdHJ1ZVxyXG4gIH1cclxuICByZXR1cm4gZmFsc2VcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIG9iamVjdE5hbWUgaXMgYSB2YWxpZCBvYmplY3QgbmFtZVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWU6IHVua25vd24pIHtcclxuICBpZiAoIWlzVmFsaWRQcmVmaXgob2JqZWN0TmFtZSkpIHtcclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIG9iamVjdE5hbWUubGVuZ3RoICE9PSAwXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBjaGVjayBpZiBwcmVmaXggaXMgdmFsaWRcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUHJlZml4KHByZWZpeDogdW5rbm93bik6IHByZWZpeCBpcyBzdHJpbmcge1xyXG4gIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIGlmIChwcmVmaXgubGVuZ3RoID4gMTAyNCkge1xyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG4gIHJldHVybiB0cnVlXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIG51bWJlclxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtYmVyKGFyZzogdW5rbm93bik6IGFyZyBpcyBudW1iZXIge1xyXG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJ1xyXG59XHJcblxyXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxyXG5leHBvcnQgdHlwZSBBbnlGdW5jdGlvbiA9ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55XHJcblxyXG4vKipcclxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBmdW5jdGlvblxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnOiB1bmtub3duKTogYXJnIGlzIEFueUZ1bmN0aW9uIHtcclxuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJ1xyXG59XHJcblxyXG4vKipcclxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBzdHJpbmdcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmluZyhhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyaW5nIHtcclxuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ3N0cmluZydcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgb2JqZWN0XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNPYmplY3QoYXJnOiB1bmtub3duKTogYXJnIGlzIG9iamVjdCB7XHJcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbFxyXG59XHJcbi8qKlxyXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIGlzIHBsYWluIG9iamVjdFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzUGxhaW5PYmplY3QoYXJnOiB1bmtub3duKTogYXJnIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcclxuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGFyZykgPT09ICdbb2JqZWN0IE9iamVjdF0nXHJcbn1cclxuLyoqXHJcbiAqIGNoZWNrIGlmIG9iamVjdCBpcyByZWFkYWJsZSBzdHJlYW1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1JlYWRhYmxlU3RyZWFtKGFyZzogdW5rbm93bik6IGFyZyBpcyBzdHJlYW0uUmVhZGFibGUge1xyXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvdW5ib3VuZC1tZXRob2RcclxuICByZXR1cm4gaXNPYmplY3QoYXJnKSAmJiBpc0Z1bmN0aW9uKChhcmcgYXMgc3RyZWFtLlJlYWRhYmxlKS5fcmVhZClcclxufVxyXG5cclxuLyoqXHJcbiAqIGNoZWNrIGlmIGFyZyBpcyBib29sZWFuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNCb29sZWFuKGFyZzogdW5rbm93bik6IGFyZyBpcyBib29sZWFuIHtcclxuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Jvb2xlYW4nXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0VtcHR5KG86IHVua25vd24pOiBvIGlzIG51bGwgfCB1bmRlZmluZWQge1xyXG4gIHJldHVybiBfLmlzRW1wdHkobylcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHlPYmplY3QobzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBib29sZWFuIHtcclxuICByZXR1cm4gT2JqZWN0LnZhbHVlcyhvKS5maWx0ZXIoKHgpID0+IHggIT09IHVuZGVmaW5lZCkubGVuZ3RoICE9PSAwXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0RlZmluZWQ8VD4obzogVCk6IG8gaXMgRXhjbHVkZTxULCBudWxsIHwgdW5kZWZpbmVkPiB7XHJcbiAgcmV0dXJuIG8gIT09IG51bGwgJiYgbyAhPT0gdW5kZWZpbmVkXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBjaGVjayBpZiBhcmcgaXMgYSB2YWxpZCBkYXRlXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERhdGUoYXJnOiB1bmtub3duKTogYXJnIGlzIERhdGUge1xyXG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgY2hlY2tuZXcgRGF0ZShNYXRoLk5hTilcclxuICByZXR1cm4gYXJnIGluc3RhbmNlb2YgRGF0ZSAmJiAhaXNOYU4oYXJnKVxyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIGEgRGF0ZSBzdHJpbmcgd2l0aCBmb3JtYXQ6ICdZWVlZTU1ERFRISG1tc3MnICsgWlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlTG9uZyhkYXRlPzogRGF0ZSk6IHN0cmluZyB7XHJcbiAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGUoKVxyXG5cclxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcclxuICBjb25zdCBzID0gZGF0ZS50b0lTT1N0cmluZygpXHJcblxyXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTMpICsgcy5zbGljZSgxNCwgMTYpICsgcy5zbGljZSgxNywgMTkpICsgJ1onXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgYSBEYXRlIHN0cmluZyB3aXRoIGZvcm1hdDogJ1lZWVlNTUREJ1xyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlU2hvcnQoZGF0ZT86IERhdGUpIHtcclxuICBkYXRlID0gZGF0ZSB8fCBuZXcgRGF0ZSgpXHJcblxyXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xyXG4gIGNvbnN0IHMgPSBkYXRlLnRvSVNPU3RyaW5nKClcclxuXHJcbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMClcclxufVxyXG5cclxuLyoqXHJcbiAqIHBpcGVzZXR1cCBzZXRzIHVwIHBpcGUoKSBmcm9tIGxlZnQgdG8gcmlnaHQgb3Mgc3RyZWFtcyBhcnJheVxyXG4gKiBwaXBlc2V0dXAgd2lsbCBhbHNvIG1ha2Ugc3VyZSB0aGF0IGVycm9yIGVtaXR0ZWQgYXQgYW55IG9mIHRoZSB1cHN0cmVhbSBTdHJlYW1cclxuICogd2lsbCBiZSBlbWl0dGVkIGF0IHRoZSBsYXN0IHN0cmVhbS4gVGhpcyBtYWtlcyBlcnJvciBoYW5kbGluZyBzaW1wbGVcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBwaXBlc2V0dXAoLi4uc3RyZWFtczogW3N0cmVhbS5SZWFkYWJsZSwgLi4uc3RyZWFtLkR1cGxleFtdLCBzdHJlYW0uV3JpdGFibGVdKSB7XHJcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciB0cyBjYW4ndCBuYXJyb3cgdGhpc1xyXG4gIHJldHVybiBzdHJlYW1zLnJlZHVjZSgoc3JjOiBzdHJlYW0uUmVhZGFibGUsIGRzdDogc3RyZWFtLldyaXRhYmxlKSA9PiB7XHJcbiAgICBzcmMub24oJ2Vycm9yJywgKGVycikgPT4gZHN0LmVtaXQoJ2Vycm9yJywgZXJyKSlcclxuICAgIHJldHVybiBzcmMucGlwZShkc3QpXHJcbiAgfSlcclxufVxyXG5cclxuLyoqXHJcbiAqIHJldHVybiBhIFJlYWRhYmxlIHN0cmVhbSB0aGF0IGVtaXRzIGRhdGFcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiByZWFkYWJsZVN0cmVhbShkYXRhOiB1bmtub3duKTogc3RyZWFtLlJlYWRhYmxlIHtcclxuICBjb25zdCBzID0gbmV3IHN0cmVhbS5SZWFkYWJsZSgpXHJcbiAgcy5fcmVhZCA9ICgpID0+IHt9XHJcbiAgcy5wdXNoKGRhdGEpXHJcbiAgcy5wdXNoKG51bGwpXHJcbiAgcmV0dXJuIHNcclxufVxyXG5cclxuLyoqXHJcbiAqIFByb2Nlc3MgbWV0YWRhdGEgdG8gaW5zZXJ0IGFwcHJvcHJpYXRlIHZhbHVlIHRvIGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSwgZmlsZVBhdGg6IHN0cmluZyk6IE9iamVjdE1ldGFEYXRhIHtcclxuICAvLyBjaGVjayBpZiBjb250ZW50LXR5cGUgYXR0cmlidXRlIHByZXNlbnQgaW4gbWV0YURhdGFcclxuICBmb3IgKGNvbnN0IGtleSBpbiBtZXRhRGF0YSkge1xyXG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSAnY29udGVudC10eXBlJykge1xyXG4gICAgICByZXR1cm4gbWV0YURhdGFcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIGlmIGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZSBpcyBub3QgcHJlc2VudCBpbiBtZXRhZGF0YSwgdGhlbiBpbmZlciBpdCBmcm9tIHRoZSBleHRlbnNpb24gaW4gZmlsZVBhdGhcclxuICByZXR1cm4ge1xyXG4gICAgLi4ubWV0YURhdGEsXHJcbiAgICAnY29udGVudC10eXBlJzogcHJvYmVDb250ZW50VHlwZShmaWxlUGF0aCksXHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogRnVuY3Rpb24gcHJlcGVuZHMgbWV0YWRhdGEgd2l0aCB0aGUgYXBwcm9wcmlhdGUgcHJlZml4IGlmIGl0IGlzIG5vdCBhbHJlYWR5IG9uXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpOiBSZXF1ZXN0SGVhZGVycyB7XHJcbiAgaWYgKCFtZXRhRGF0YSkge1xyXG4gICAgcmV0dXJuIHt9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gXy5tYXBLZXlzKG1ldGFEYXRhLCAodmFsdWUsIGtleSkgPT4ge1xyXG4gICAgaWYgKGlzQW16SGVhZGVyKGtleSkgfHwgaXNTdXBwb3J0ZWRIZWFkZXIoa2V5KSB8fCBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXkpKSB7XHJcbiAgICAgIHJldHVybiBrZXlcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gTWV0YURhdGFIZWFkZXJQcmVmaXggKyBrZXlcclxuICB9KVxyXG59XHJcblxyXG4vKipcclxuICogQ2hlY2tzIGlmIGl0IGlzIGEgdmFsaWQgaGVhZGVyIGFjY29yZGluZyB0byB0aGUgQW1hem9uUzMgQVBJXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNBbXpIZWFkZXIoa2V5OiBzdHJpbmcpIHtcclxuICBjb25zdCB0ZW1wID0ga2V5LnRvTG93ZXJDYXNlKClcclxuICByZXR1cm4gKFxyXG4gICAgdGVtcC5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSB8fFxyXG4gICAgdGVtcCA9PT0gJ3gtYW16LWFjbCcgfHxcclxuICAgIHRlbXAuc3RhcnRzV2l0aCgneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbi0nKSB8fFxyXG4gICAgdGVtcCA9PT0gJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24nXHJcbiAgKVxyXG59XHJcblxyXG4vKipcclxuICogQ2hlY2tzIGlmIGl0IGlzIGEgc3VwcG9ydGVkIEhlYWRlclxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGlzU3VwcG9ydGVkSGVhZGVyKGtleTogc3RyaW5nKSB7XHJcbiAgY29uc3Qgc3VwcG9ydGVkX2hlYWRlcnMgPSBbXHJcbiAgICAnY29udGVudC10eXBlJyxcclxuICAgICdjYWNoZS1jb250cm9sJyxcclxuICAgICdjb250ZW50LWVuY29kaW5nJyxcclxuICAgICdjb250ZW50LWRpc3Bvc2l0aW9uJyxcclxuICAgICdjb250ZW50LWxhbmd1YWdlJyxcclxuICAgICd4LWFtei13ZWJzaXRlLXJlZGlyZWN0LWxvY2F0aW9uJyxcclxuICAgICdpZi1ub25lLW1hdGNoJyxcclxuICAgICdpZi1tYXRjaCcsXHJcbiAgXVxyXG4gIHJldHVybiBzdXBwb3J0ZWRfaGVhZGVycy5pbmNsdWRlcyhrZXkudG9Mb3dlckNhc2UoKSlcclxufVxyXG5cclxuLyoqXHJcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN0b3JhZ2UgaGVhZGVyXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5OiBzdHJpbmcpIHtcclxuICByZXR1cm4ga2V5LnRvTG93ZXJDYXNlKCkgPT09ICd4LWFtei1zdG9yYWdlLWNsYXNzJ1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE1ldGFkYXRhKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyKSB7XHJcbiAgcmV0dXJuIF8ubWFwS2V5cyhcclxuICAgIF8ucGlja0J5KGhlYWRlcnMsICh2YWx1ZSwga2V5KSA9PiBpc1N1cHBvcnRlZEhlYWRlcihrZXkpIHx8IGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleSkgfHwgaXNBbXpIZWFkZXIoa2V5KSksXHJcbiAgICAodmFsdWUsIGtleSkgPT4ge1xyXG4gICAgICBjb25zdCBsb3dlciA9IGtleS50b0xvd2VyQ2FzZSgpXHJcbiAgICAgIGlmIChsb3dlci5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSkge1xyXG4gICAgICAgIHJldHVybiBsb3dlci5zbGljZShNZXRhRGF0YUhlYWRlclByZWZpeC5sZW5ndGgpXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiBrZXlcclxuICAgIH0sXHJcbiAgKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmVyc2lvbklkKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyID0ge30pIHtcclxuICByZXR1cm4gaGVhZGVyc1sneC1hbXotdmVyc2lvbi1pZCddIHx8IG51bGxcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldFNvdXJjZVZlcnNpb25JZChoZWFkZXJzOiBSZXNwb25zZUhlYWRlciA9IHt9KSB7XHJcbiAgcmV0dXJuIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXZlcnNpb24taWQnXSB8fCBudWxsXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZUVUYWcoZXRhZyA9ICcnKTogc3RyaW5nIHtcclxuICBjb25zdCByZXBsYWNlQ2hhcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAnXCInOiAnJyxcclxuICAgICcmcXVvdDsnOiAnJyxcclxuICAgICcmIzM0Oyc6ICcnLFxyXG4gICAgJyZRVU9UOyc6ICcnLFxyXG4gICAgJyYjeDAwMDIyJzogJycsXHJcbiAgfVxyXG4gIHJldHVybiBldGFnLnJlcGxhY2UoL14oXCJ8JnF1b3Q7fCYjMzQ7KXwoXCJ8JnF1b3Q7fCYjMzQ7KSQvZywgKG0pID0+IHJlcGxhY2VDaGFyc1ttXSBhcyBzdHJpbmcpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB0b01kNShwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xyXG4gIC8vIHVzZSBzdHJpbmcgZnJvbSBicm93c2VyIGFuZCBidWZmZXIgZnJvbSBub2RlanNcclxuICAvLyBicm93c2VyIHN1cHBvcnQgaXMgdGVzdGVkIG9ubHkgYWdhaW5zdCBtaW5pbyBzZXJ2ZXJcclxuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShCdWZmZXIuZnJvbShwYXlsb2FkKSkuZGlnZXN0KCkudG9TdHJpbmcoJ2Jhc2U2NCcpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB0b1NoYTI1NihwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xyXG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHBheWxvYWQpLmRpZ2VzdCgnaGV4JylcclxufVxyXG5cclxuLyoqXHJcbiAqIHRvQXJyYXkgcmV0dXJucyBhIHNpbmdsZSBlbGVtZW50IGFycmF5IHdpdGggcGFyYW0gYmVpbmcgdGhlIGVsZW1lbnQsXHJcbiAqIGlmIHBhcmFtIGlzIGp1c3QgYSBzdHJpbmcsIGFuZCByZXR1cm5zICdwYXJhbScgYmFjayBpZiBpdCBpcyBhbiBhcnJheVxyXG4gKiBTbywgaXQgbWFrZXMgc3VyZSBwYXJhbSBpcyBhbHdheXMgYW4gYXJyYXlcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiB0b0FycmF5PFQgPSB1bmtub3duPihwYXJhbTogVCB8IFRbXSk6IEFycmF5PFQ+IHtcclxuICBpZiAoIUFycmF5LmlzQXJyYXkocGFyYW0pKSB7XHJcbiAgICByZXR1cm4gW3BhcmFtXSBhcyBUW11cclxuICB9XHJcbiAgcmV0dXJuIHBhcmFtXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZU9iamVjdEtleShvYmplY3ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIC8vICsgc3ltYm9sIGNoYXJhY3RlcnMgYXJlIG5vdCBkZWNvZGVkIGFzIHNwYWNlcyBpbiBKUy4gc28gcmVwbGFjZSB0aGVtIGZpcnN0IGFuZCBkZWNvZGUgdG8gZ2V0IHRoZSBjb3JyZWN0IHJlc3VsdC5cclxuICBjb25zdCBhc1N0ck5hbWUgPSAob2JqZWN0TmFtZSA/IG9iamVjdE5hbWUudG9TdHJpbmcoKSA6ICcnKS5yZXBsYWNlKC9cXCsvZywgJyAnKVxyXG4gIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoYXNTdHJOYW1lKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTaXplKHNpemU/OiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xyXG4gIHJldHVybiBzaXplID8gTnVtYmVyLnBhcnNlSW50KHNpemUpIDogdW5kZWZpbmVkXHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBQQVJUX0NPTlNUUkFJTlRTID0ge1xyXG4gIC8vIGFic01pblBhcnRTaXplIC0gYWJzb2x1dGUgbWluaW11bSBwYXJ0IHNpemUgKDUgTWlCKVxyXG4gIEFCU19NSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDUsXHJcbiAgLy8gTUlOX1BBUlRfU0laRSAtIG1pbmltdW0gcGFydCBzaXplIDE2TWlCIHBlciBvYmplY3QgYWZ0ZXIgd2hpY2hcclxuICBNSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDE2LFxyXG4gIC8vIE1BWF9QQVJUU19DT1VOVCAtIG1heGltdW0gbnVtYmVyIG9mIHBhcnRzIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgc2Vzc2lvbi5cclxuICBNQVhfUEFSVFNfQ09VTlQ6IDEwMDAwLFxyXG4gIC8vIE1BWF9QQVJUX1NJWkUgLSBtYXhpbXVtIHBhcnQgc2l6ZSA1R2lCIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgdXBsb2FkXHJcbiAgLy8gb3BlcmF0aW9uLlxyXG4gIE1BWF9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDUsXHJcbiAgLy8gTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNUdpQiBvZiBvYmplY3QgcGVyIFBVVFxyXG4gIC8vIG9wZXJhdGlvbi5cclxuICBNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcclxuICAvLyBNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1VGlCIG9mIG9iamVjdCBmb3JcclxuICAvLyBNdWx0aXBhcnQgb3BlcmF0aW9uLlxyXG4gIE1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcclxufVxyXG5cclxuY29uc3QgR0VORVJJQ19TU0VfSEVBREVSID0gJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24nXHJcblxyXG5jb25zdCBFTkNSWVBUSU9OX0hFQURFUlMgPSB7XHJcbiAgLy8gc3NlR2VuZXJpY0hlYWRlciBpcyB0aGUgQVdTIFNTRSBoZWFkZXIgdXNlZCBmb3IgU1NFLVMzIGFuZCBTU0UtS01TLlxyXG4gIHNzZUdlbmVyaWNIZWFkZXI6IEdFTkVSSUNfU1NFX0hFQURFUixcclxuICAvLyBzc2VLbXNLZXlJRCBpcyB0aGUgQVdTIFNTRS1LTVMga2V5IGlkLlxyXG4gIHNzZUttc0tleUlEOiBHRU5FUklDX1NTRV9IRUFERVIgKyAnLUF3cy1LbXMtS2V5LUlkJyxcclxufSBhcyBjb25zdFxyXG5cclxuLyoqXHJcbiAqIFJldHVybiBFbmNyeXB0aW9uIGhlYWRlcnNcclxuICogQHBhcmFtIGVuY0NvbmZpZ1xyXG4gKiBAcmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXkgdmFsdWUgcGFpcnMgdGhhdCBjYW4gYmUgdXNlZCBpbiBoZWFkZXJzLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGdldEVuY3J5cHRpb25IZWFkZXJzKGVuY0NvbmZpZzogRW5jcnlwdGlvbik6IFJlcXVlc3RIZWFkZXJzIHtcclxuICBjb25zdCBlbmNUeXBlID0gZW5jQ29uZmlnLnR5cGVcclxuXHJcbiAgaWYgKCFpc0VtcHR5KGVuY1R5cGUpKSB7XHJcbiAgICBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5TU0VDKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VHZW5lcmljSGVhZGVyXTogJ0FFUzI1NicsXHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5LTVMpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUdlbmVyaWNIZWFkZXJdOiBlbmNDb25maWcuU1NFQWxnb3JpdGhtLFxyXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlS21zS2V5SURdOiBlbmNDb25maWcuS01TTWFzdGVyS2V5SUQsXHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiB7fVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFydHNSZXF1aXJlZChzaXplOiBudW1iZXIpOiBudW1iZXIge1xyXG4gIGNvbnN0IG1heFBhcnRTaXplID0gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAvIChQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCAtIDEpXHJcbiAgbGV0IHJlcXVpcmVkUGFydFNpemUgPSBzaXplIC8gbWF4UGFydFNpemVcclxuICBpZiAoc2l6ZSAlIG1heFBhcnRTaXplID4gMCkge1xyXG4gICAgcmVxdWlyZWRQYXJ0U2l6ZSsrXHJcbiAgfVxyXG4gIHJlcXVpcmVkUGFydFNpemUgPSBNYXRoLnRydW5jKHJlcXVpcmVkUGFydFNpemUpXHJcbiAgcmV0dXJuIHJlcXVpcmVkUGFydFNpemVcclxufVxyXG5cclxuLyoqXHJcbiAqIGNhbGN1bGF0ZUV2ZW5TcGxpdHMgLSBjb21wdXRlcyBzcGxpdHMgZm9yIGEgc291cmNlIGFuZCByZXR1cm5zXHJcbiAqIHN0YXJ0IGFuZCBlbmQgaW5kZXggc2xpY2VzLiBTcGxpdHMgaGFwcGVuIGV2ZW5seSB0byBiZSBzdXJlIHRoYXQgbm9cclxuICogcGFydCBpcyBsZXNzIHRoYW4gNU1pQiwgYXMgdGhhdCBjb3VsZCBmYWlsIHRoZSBtdWx0aXBhcnQgcmVxdWVzdCBpZlxyXG4gKiBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjYWxjdWxhdGVFdmVuU3BsaXRzPFQgZXh0ZW5kcyB7IFN0YXJ0PzogbnVtYmVyIH0+KFxyXG4gIHNpemU6IG51bWJlcixcclxuICBvYmpJbmZvOiBULFxyXG4pOiB7XHJcbiAgc3RhcnRJbmRleDogbnVtYmVyW11cclxuICBvYmpJbmZvOiBUXHJcbiAgZW5kSW5kZXg6IG51bWJlcltdXHJcbn0gfCBudWxsIHtcclxuICBpZiAoc2l6ZSA9PT0gMCkge1xyXG4gICAgcmV0dXJuIG51bGxcclxuICB9XHJcbiAgY29uc3QgcmVxUGFydHMgPSBwYXJ0c1JlcXVpcmVkKHNpemUpXHJcbiAgY29uc3Qgc3RhcnRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXHJcbiAgY29uc3QgZW5kSW5kZXhQYXJ0czogbnVtYmVyW10gPSBbXVxyXG5cclxuICBsZXQgc3RhcnQgPSBvYmpJbmZvLlN0YXJ0XHJcbiAgaWYgKGlzRW1wdHkoc3RhcnQpIHx8IHN0YXJ0ID09PSAtMSkge1xyXG4gICAgc3RhcnQgPSAwXHJcbiAgfVxyXG4gIGNvbnN0IGRpdmlzb3JWYWx1ZSA9IE1hdGgudHJ1bmMoc2l6ZSAvIHJlcVBhcnRzKVxyXG5cclxuICBjb25zdCByZW1pbmRlclZhbHVlID0gc2l6ZSAlIHJlcVBhcnRzXHJcblxyXG4gIGxldCBuZXh0U3RhcnQgPSBzdGFydFxyXG5cclxuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlcVBhcnRzOyBpKyspIHtcclxuICAgIGxldCBjdXJQYXJ0U2l6ZSA9IGRpdmlzb3JWYWx1ZVxyXG4gICAgaWYgKGkgPCByZW1pbmRlclZhbHVlKSB7XHJcbiAgICAgIGN1clBhcnRTaXplKytcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjdXJyZW50U3RhcnQgPSBuZXh0U3RhcnRcclxuICAgIGNvbnN0IGN1cnJlbnRFbmQgPSBjdXJyZW50U3RhcnQgKyBjdXJQYXJ0U2l6ZSAtIDFcclxuICAgIG5leHRTdGFydCA9IGN1cnJlbnRFbmQgKyAxXHJcblxyXG4gICAgc3RhcnRJbmRleFBhcnRzLnB1c2goY3VycmVudFN0YXJ0KVxyXG4gICAgZW5kSW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRFbmQpXHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBzdGFydEluZGV4OiBzdGFydEluZGV4UGFydHMsIGVuZEluZGV4OiBlbmRJbmRleFBhcnRzLCBvYmpJbmZvOiBvYmpJbmZvIH1cclxufVxyXG5jb25zdCBmeHAgPSBuZXcgWE1MUGFyc2VyKHsgbnVtYmVyUGFyc2VPcHRpb25zOiB7IGVOb3RhdGlvbjogZmFsc2UsIGhleDogdHJ1ZSwgbGVhZGluZ1plcm9zOiB0cnVlIH0gfSlcclxuXHJcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVhtbCh4bWw6IHN0cmluZyk6IGFueSB7XHJcbiAgY29uc3QgcmVzdWx0ID0gZnhwLnBhcnNlKHhtbClcclxuICBpZiAocmVzdWx0LkVycm9yKSB7XHJcbiAgICB0aHJvdyByZXN1bHQuRXJyb3JcclxuICB9XHJcblxyXG4gIHJldHVybiByZXN1bHRcclxufVxyXG5cclxuLyoqXHJcbiAqIGdldCBjb250ZW50IHNpemUgb2Ygb2JqZWN0IGNvbnRlbnQgdG8gdXBsb2FkXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0Q29udGVudExlbmd0aChzOiBzdHJlYW0uUmVhZGFibGUgfCBCdWZmZXIgfCBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcclxuICAvLyB1c2UgbGVuZ3RoIHByb3BlcnR5IG9mIHN0cmluZyB8IEJ1ZmZlclxyXG4gIGlmICh0eXBlb2YgcyA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHMpKSB7XHJcbiAgICByZXR1cm4gcy5sZW5ndGhcclxuICB9XHJcblxyXG4gIC8vIHByb3BlcnR5IG9mIGBmcy5SZWFkU3RyZWFtYFxyXG4gIGNvbnN0IGZpbGVQYXRoID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikucGF0aCBhcyBzdHJpbmcgfCB1bmRlZmluZWRcclxuICBpZiAoZmlsZVBhdGggJiYgdHlwZW9mIGZpbGVQYXRoID09PSAnc3RyaW5nJykge1xyXG4gICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzcC5sc3RhdChmaWxlUGF0aClcclxuICAgIHJldHVybiBzdGF0LnNpemVcclxuICB9XHJcblxyXG4gIC8vIHByb3BlcnR5IG9mIGBmcy5SZWFkU3RyZWFtYFxyXG4gIGNvbnN0IGZkID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZmQgYXMgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZFxyXG4gIGlmIChmZCAmJiB0eXBlb2YgZmQgPT09ICdudW1iZXInKSB7XHJcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnN0YXQoZmQpXHJcbiAgICByZXR1cm4gc3RhdC5zaXplXHJcbiAgfVxyXG5cclxuICByZXR1cm4gbnVsbFxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFnQkEsSUFBQUEsTUFBQSxHQUFBQyx1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