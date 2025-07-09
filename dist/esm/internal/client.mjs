import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as stream from "stream";
import * as async from 'async';
import BlockStream2 from 'block-stream2';
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { CopyDestinationOptions, CopySourceOptions, DEFAULT_REGION, LEGAL_HOLD_STATUS, PRESIGN_EXPIRY_DAYS_MAX, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "../helpers.mjs";
import { postPresignSignatureV4, presignSignatureV4, signV4 } from "../signing.mjs";
import { fsp, streamPromise } from "./async.mjs";
import { CopyConditions } from "./copy-conditions.mjs";
import { Extensions } from "./extensions.mjs";
import { calculateEvenSplits, extractMetadata, getContentLength, getScope, getSourceVersionId, getVersionId, hashBinary, insertContentType, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isPlainObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isValidPrefix, isVirtualHostStyle, makeDateLong, PART_CONSTRAINTS, partsRequired, prependXAMZMeta, readableStream, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { joinHostPort } from "./join-host-port.mjs";
import { PostPolicy } from "./post-policy.mjs";
import { request } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import { parseCompleteMultipart, parseInitiateMultipart, parseListObjects, parseObjectLegalHoldConfig, parseSelectObjectContentResponse, uploadPartParser } from "./xml-parser.mjs";
import * as xmlParsers from "./xml-parser.mjs";
const xml = new xml2js.Builder({
  renderOpts: {
    pretty: false
  },
  headless: true
});

// will be replaced by bundler.
const Package = {
  version: "8.0.6" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
export class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.anonymous = false;
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new Extensions(this);
  }
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   *   Set application specific information.
   *   Generates User-Agent in the following style.
   *   MinIO (OS; ARCH) LIB/VER APP/VER
   */
  setAppInfo(appName, appVersion) {
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = joinHostPort(host, port);
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await request(this.transport, reqOptions, body);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  async getBucketRegionAsync(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return DEFAULT_REGION;
        }
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await drainResponse(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  // Bucket operations

  /**
   * Creates the bucket `bucketName`.
   *
   */
  async makeBucket(bucketName, region = '', makeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      makeOpts = region;
      region = '';
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !isObject(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    let payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== DEFAULT_REGION) {
      payload = xml.buildObject({
        CreateBucketConfiguration: {
          $: {
            xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
          },
          LocationConstraint: region
        }
      });
    }
    const method = 'PUT';
    const headers = {};
    if (makeOpts && makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }

    // For custom region clients  default to custom region specified in client constructor
    const finalRegion = this.region || region || DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === DEFAULT_REGION) {
        if (err instanceof errors.S3Error) {
          const errCode = err.code;
          const errRegion = err.region;
          if (errCode === 'AuthorizationHeaderMalformed' && errRegion !== '') {
            // Retry with region returned as part of error
            await this.makeRequestAsyncOmit(requestOpt, payload, [200], errCode);
          }
        }
      }
      throw err;
    }
  }

  /**
   * To check if a bucket already exists.
   */
  async bucketExists(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'HEAD';
    try {
      await this.makeRequestAsyncOmit({
        method,
        bucketName
      });
    } catch (err) {
      // @ts-ignore
      if (err.code === 'NoSuchBucket' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Callback is called with readable stream of the object content.
   */
  async getObject(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.getPartialObject(bucketName, objectName, 0, 0, getOpts);
  }

  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  async getPartialObject(bucketName, objectName, offset, length = 0, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
      throw new TypeError('length should be of type "number"');
    }
    let range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    let query = '';
    let headers = {
      ...(range !== '' && {
        range
      })
    };
    if (getOpts) {
      const sseHeaders = {
        ...(getOpts.SSECustomerAlgorithm && {
          'X-Amz-Server-Side-Encryption-Customer-Algorithm': getOpts.SSECustomerAlgorithm
        }),
        ...(getOpts.SSECustomerKey && {
          'X-Amz-Server-Side-Encryption-Customer-Key': getOpts.SSECustomerKey
        }),
        ...(getOpts.SSECustomerKeyMD5 && {
          'X-Amz-Server-Side-Encryption-Customer-Key-MD5': getOpts.SSECustomerKeyMD5
        })
      };
      query = qs.stringify(getOpts);
      headers = {
        ...prependXAMZMeta(sseHeaders),
        ...headers
      };
    }
    const expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    const method = 'GET';
    return await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes);
  }

  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${base64(etag)}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  async fGetObject(bucketName, objectName, filePath, getOpts) {
    // Input validation.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await fsp.stat(partFile);
        if (objStat.size === stats.size) {
          return partFile;
        }
        offset = stats.size;
        partFileStream = fs.createWriteStream(partFile, {
          flags: 'a'
        });
      } catch (e) {
        if (e instanceof Error && e.code === 'ENOENT') {
          // file not exist
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          // other error, maybe access deny
          throw e;
        }
      }
      const downloadStream = await this.getPartialObject(bucketName, objectName, offset, 0, getOpts);
      await streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOptDef)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOptDef);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    const delimiter = recursive ? '' : '/';
    let keyMarker = '';
    let uploadIdMarker = '';
    const uploads = [];
    let ended = false;

    // TODO: refactor this with async/await and `stream.Readable.from`
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).then(result => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.prefixes.forEach(prefix => uploads.push(prefix));
        async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, err => cb(err));
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          readStream._read();
        });
      }, e => {
        readStream.emit('error', e);
      });
    };
    return readStream;
  }

  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  async listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${uriEscape(keyMarker)}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    const maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }
  async findUploadId(bucketName, objectName) {
    var _latestUpload;
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    let latestUpload;
    let keyMarker = '';
    let uploadIdMarker = '';
    for (;;) {
      const result = await this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '');
      for (const upload of result.uploads) {
        if (upload.key === objectName) {
          if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
            latestUpload = upload;
          }
        }
      }
      if (result.isTruncated) {
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
        continue;
      }
      break;
    }
    return (_latestUpload = latestUpload) === null || _latestUpload === void 0 ? void 0 : _latestUpload.uploadId;
  }

  /**
   * this call will aggregate the parts on the server into a single object.
   */
  async completeMultipartUpload(bucketName, objectName, uploadId, etags) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${uriEscape(uploadId)}`;
    const builder = new xml2js.Builder();
    const payload = builder.buildObject({
      CompleteMultipartUpload: {
        $: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        },
        Part: etags.map(etag => {
          return {
            PartNumber: etag.part,
            ETag: etag.etag
          };
        })
      }
    });
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await readAsBuffer(res);
    const result = parseCompleteMultipart(body.toString());
    if (!result) {
      throw new Error('BUG: failed to parse server response');
    }
    if (result.errCode) {
      // Multipart Complete API returns an error XML after a 200 http status
      throw new errors.S3Error(result.errMessage);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      etag: result.etag,
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!isNumber(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    let partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Uploads the object using contents from a file
   */
  async fPutObject(bucketName, objectName, filePath, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData || {}, filePath);
    const stat = await fsp.stat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await getContentLength(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!isNumber(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    if (size === 0) {
      return this.uploadBuffer(bucketName, objectName, headers, Buffer.from(''));
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = isReadableStream(stream) ? await readAsBuffer(stream) : Buffer.from(stream);
      return this.uploadBuffer(bucketName, objectName, headers, buf);
    }
    return this.uploadStream(bucketName, objectName, headers, stream, partSize);
  }

  /**
   * method to upload buffer in one call
   * @private
   */
  async uploadBuffer(bucketName, objectName, headers, buf) {
    const {
      md5sum,
      sha256sum
    } = hashBinary(buf, this.enableSHA256);
    headers['Content-Length'] = buf.length;
    if (!this.enableSHA256) {
      headers['Content-MD5'] = md5sum;
    }
    const res = await this.makeRequestStreamAsync({
      method: 'PUT',
      bucketName,
      objectName,
      headers
    }, buf, sha256sum, [200], '');
    await drainResponse(res);
    return {
      etag: sanitizeETag(res.headers.etag),
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * upload stream with MultipartUpload
   * @private
   */
  async uploadStream(bucketName, objectName, headers, body, partSize) {
    // A map of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    const oldParts = {};

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    const eTags = [];
    const previousUploadId = await this.findUploadId(bucketName, objectName);
    let uploadId;
    if (!previousUploadId) {
      uploadId = await this.initiateNewMultipartUpload(bucketName, objectName, headers);
    } else {
      uploadId = previousUploadId;
      const oldTags = await this.listParts(bucketName, objectName, previousUploadId);
      oldTags.forEach(e => {
        oldParts[e.part] = e;
      });
    }
    const chunkier = new BlockStream2({
      size: partSize,
      zeroPadding: false
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, o] = await Promise.all([new Promise((resolve, reject) => {
      body.pipe(chunkier).on('error', reject);
      chunkier.on('end', resolve).on('error', reject);
    }), (async () => {
      let partNumber = 1;
      for await (const chunk of chunkier) {
        const md5 = crypto.createHash('md5').update(chunk).digest();
        const oldPart = oldParts[partNumber];
        if (oldPart) {
          if (oldPart.etag === md5.toString('hex')) {
            eTags.push({
              part: partNumber,
              etag: oldPart.etag
            });
            partNumber++;
            continue;
          }
        }
        partNumber++;

        // now start to upload missing part
        const options = {
          method: 'PUT',
          query: qs.stringify({
            partNumber,
            uploadId
          }),
          headers: {
            'Content-Length': chunk.length,
            'Content-MD5': md5.toString('base64')
          },
          bucketName,
          objectName
        };
        const response = await this.makeRequestAsyncOmit(options, chunk);
        let etag = response.headers.etag;
        if (etag) {
          etag = etag.replace(/^"/, '').replace(/"$/, '');
        } else {
          etag = '';
        }
        eTags.push({
          part: partNumber,
          etag
        });
      }
      return await this.completeMultipartUpload(bucketName, objectName, uploadId, eTags);
    })()]);
    return o;
  }
  async removeBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!isObject(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
        throw new TypeError('versionId should be of type string.:', getOpts.versionId);
      }
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, '', [200]);
    const strRes = await readAsString(httpRes);
    return parseObjectLegalHoldConfig(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    const config = {
      Status: setOpts.status
    };
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload);
  }

  /**
   * Get Tags associated with a Bucket
   */
  async getBucketTagging(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    const query = 'policy';
    let method = 'DELETE';
    if (policy) {
      method = 'PUT';
    }
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, policy, [204], '');
  }

  /**
   * Get the policy on a bucket or an object prefix.
   */
  async getBucketPolicy(bucketName) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await readAsString(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    const payload = builder.buildObject(params);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    const config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    const isAllKeysSet = ['unit', 'mode', 'validity'].every(lck => configKeys.includes(lck));
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (!isAllKeysSet) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(versionConfig);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
  async setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts !== null && putOpts !== void 0 && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const headers = {};
    const builder = new xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payloadBuf = Buffer.from(builder.buildObject(taggingConfig));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers,
      ...(objectName && {
        objectName: objectName
      })
    };
    headers['Content-MD5'] = toMd5(payloadBuf);
    await this.makeRequestAsyncOmit(requestOptions, payloadBuf);
  }
  async removeTagging({
    bucketName,
    objectName,
    removeOpts
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    await this.makeRequestAsync(requestOptions, '', [200, 204]);
  }
  async setBucketTagging(bucketName, tags) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isPlainObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      tags
    });
  }
  async removeBucketTagging(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isPlainObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts
    });
  }
  async removeObjectTagging(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    const method = 'POST';
    const query = `select&select-type=2`;
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts === null || selectOpts === void 0 ? void 0 : selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await readAsBuffer(res);
    return parseSelectObjectContentResponse(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async setBucketLifecycle(bucketName, lifeCycleConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    const method = 'PUT';
    const query = 'encryption';
    const builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'encryption';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async getObjectRetention(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !isString(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('versionId should be of type "string"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return isObject(value) ? {
          Key: value.name,
          VersionId: value.versionId
        } : {
          Key: value
        };
      });
      const remObjects = {
        Delete: {
          Quiet: true,
          Object: delObjects
        }
      };
      const payload = Buffer.from(new xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': toMd5(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await readAsString(res);
      return xmlParsers.removeObjectsParser(body);
    };
    const maxEntries = 1000; // max entries accepted in server for DeleteMultipleObjects API.
    // Client side batching
    const batches = [];
    for (let i = 0; i < objectsList.length; i += maxEntries) {
      batches.push(objectsList.slice(i, i + maxEntries));
    }
    const batchResults = await Promise.all(batches.map(runDeleteObjects));
    return batchResults.flat();
  }
  async removeIncompleteUpload(bucketName, objectName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const removeUploadId = await this.findUploadId(bucketName, objectName);
    const method = 'DELETE';
    const query = `uploadId=${removeUploadId}`;
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    }, '', [204]);
  }
  async copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions) {
    if (typeof conditions == 'function') {
      conditions = null;
    }
    if (!isValidBucketName(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!isValidObjectName(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!isString(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(sourceBucketNameAndObjectName);
    if (conditions) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchETagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName: targetBucketName,
      objectName: targetObjectName,
      headers
    });
    const body = await readAsString(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers
    });
    const body = await readAsString(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: extractMetadata(resHeaders),
      VersionId: getVersionId(resHeaders),
      SourceVersionId: getSourceVersionId(resHeaders),
      Etag: sanitizeETag(resHeaders.etag),
      Size: size
    };
  }
  async copyObject(...allArgs) {
    if (typeof allArgs[0] === 'string') {
      const [targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions] = allArgs;
      return await this.copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions);
    }
    const [source, dest] = allArgs;
    return await this.copyObjectV2(source, dest);
  }
  async uploadPart(partConfig, payload) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    const query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    const res = await this.makeRequestAsync(requestOptions, payload);
    const body = await readAsString(res);
    const partRes = uploadPartParser(body);
    return {
      etag: sanitizeETag(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      const sObj = sourceObjList[i];
      if (!sObj.validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => this.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    const srcObjectInfos = await Promise.all(sourceObjStats);
    const validatedStats = srcObjectInfos.map((resItemStat, index) => {
      const srcConfig = sourceObjList[index];
      let srcCopySize = resItemStat.size;
      // Check if a segment is specified, and if so, is the
      // segment within object bounds?
      if (srcConfig && srcConfig.MatchRange) {
        // Since range is specified,
        //    0 <= src.srcStart <= src.srcEnd
        // so only invalid case to check is:
        const srcStart = srcConfig.Start;
        const srcEnd = srcConfig.End;
        if (srcEnd >= srcCopySize || srcStart < 0) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
        }
        srcCopySize = srcEnd - srcStart + 1;
      }

      // Only the last source may be less than `absMinPartSize`
      if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += partsRequired(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
    });
    const getUploadPartConfigList = uploadId => {
      const uploadPartConfigList = [];
      splitPartSizeList.forEach((splitSize, splitIndex) => {
        if (splitSize) {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          const partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            const splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        }
      });
      return uploadPartConfigList;
    };
    const uploadAllParts = async uploadList => {
      const partUploads = uploadList.map(async item => {
        return this.uploadPart(item);
      });
      // Process results here if needed
      return await Promise.all(partUploads);
    };
    const performUploadParts = async uploadId => {
      const uploadList = getUploadPartConfigList(uploadId);
      const partsRes = await uploadAllParts(uploadList);
      return partsRes.map(partCopy => ({
        etag: partCopy.etag,
        part: partCopy.part
      }));
    };
    const newUploadHeaders = destObjConfig.getHeaders();
    const uploadId = await this.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders);
    try {
      const partsDone = await performUploadParts(uploadId);
      return await this.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone);
    } catch (err) {
      return await this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId);
    }
  }
  async presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate) {
    var _requestDate;
    if (this.anonymous) {
      throw new errors.AnonymousRequestError(`Presigned ${method} url cannot be generated for anonymous requests`);
    }
    if (!expires) {
      expires = PRESIGN_EXPIRY_DAYS_MAX;
    }
    if (!reqParams) {
      reqParams = {};
    }
    if (!requestDate) {
      requestDate = new Date();
    }

    // Type assertions
    if (expires && typeof expires !== 'number') {
      throw new TypeError('expires should be of type "number"');
    }
    if (reqParams && typeof reqParams !== 'object') {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (requestDate && !(requestDate instanceof Date) || requestDate && isNaN((_requestDate = requestDate) === null || _requestDate === void 0 ? void 0 : _requestDate.getTime())) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    const query = reqParams ? qs.stringify(reqParams) : undefined;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      await this.checkAndRefreshCreds();
      const reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      return presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = makeDateLong(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
      const opts = {
        region: region,
        bucketName: bucketName,
        method: 'POST'
      };
      const reqOptions = this.getRequestOptions(opts);
      const portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      const urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      return {
        postURL: urlStr,
        formData: postPolicy.formData
      };
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  // list a batch of objects
  async listObjectsQuery(bucketName, prefix, marker, listQueryOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (marker && !isString(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !isObject(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion,
      versionIdMarker,
      keyMarker
    } = listQueryOpts;
    if (!isString(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!isNumber(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (IncludeVersion) {
      // v1 version listing..
      if (keyMarker) {
        queries.push(`key-marker=${keyMarker}`);
      }
      if (versionIdMarker) {
        queries.push(`version-id-marker=${versionIdMarker}`);
      }
    } else if (marker) {
      marker = uriEscape(marker);
      queries.push(`marker=${marker}`);
    }

    // no need to escape maxKeys
    if (MaxKeys) {
      if (MaxKeys >= 1000) {
        MaxKeys = 1000;
      }
      queries.push(`max-keys=${MaxKeys}`);
    }
    queries.sort();
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    const listQryList = parseListObjects(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !isObject(listOpts)) {
      throw new TypeError('listOpts should be of type "object"');
    }
    let marker = '';
    let keyMarker = '';
    let versionIdMarker = '';
    let objects = [];
    let ended = false;
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = async () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      try {
        const listQueryOpts = {
          Delimiter: recursive ? '' : '/',
          // if recursive is false set delimiter to '/'
          MaxKeys: 1000,
          IncludeVersion: listOpts === null || listOpts === void 0 ? void 0 : listOpts.IncludeVersion,
          // version listing specific options
          keyMarker: keyMarker,
          versionIdMarker: versionIdMarker
        };
        const result = await this.listObjectsQuery(bucketName, prefix, marker, listQueryOpts);
        if (result.isTruncated) {
          marker = result.nextMarker || undefined;
          if (result.keyMarker) {
            keyMarker = result.keyMarker;
          }
          if (result.versionIdMarker) {
            versionIdMarker = result.versionIdMarker;
          }
        } else {
          ended = true;
        }
        if (result.objects) {
          objects = result.objects;
        }
        // @ts-ignore
        readStream._read();
      } catch (err) {
        readStream.emit('error', err);
      }
    };
    return readStream;
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsImlzQnJvd3NlciIsIl8iLCJxcyIsInhtbDJqcyIsIkNyZWRlbnRpYWxQcm92aWRlciIsImVycm9ycyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJDb3B5U291cmNlT3B0aW9ucyIsIkRFRkFVTFRfUkVHSU9OIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsIlJFVEVOVElPTl9NT0RFUyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsInBvc3RQcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJzaWduVjQiLCJmc3AiLCJzdHJlYW1Qcm9taXNlIiwiQ29weUNvbmRpdGlvbnMiLCJFeHRlbnNpb25zIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImV4dHJhY3RNZXRhZGF0YSIsImdldENvbnRlbnRMZW5ndGgiLCJnZXRTY29wZSIsImdldFNvdXJjZVZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsImhhc2hCaW5hcnkiLCJpbnNlcnRDb250ZW50VHlwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJpc0Jvb2xlYW4iLCJpc0RlZmluZWQiLCJpc0VtcHR5IiwiaXNOdW1iZXIiLCJpc09iamVjdCIsImlzUGxhaW5PYmplY3QiLCJpc1JlYWRhYmxlU3RyZWFtIiwiaXNTdHJpbmciLCJpc1ZhbGlkQnVja2V0TmFtZSIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWRPYmplY3ROYW1lIiwiaXNWYWxpZFBvcnQiLCJpc1ZhbGlkUHJlZml4IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwibWFrZURhdGVMb25nIiwiUEFSVF9DT05TVFJBSU5UUyIsInBhcnRzUmVxdWlyZWQiLCJwcmVwZW5kWEFNWk1ldGEiLCJyZWFkYWJsZVN0cmVhbSIsInNhbml0aXplRVRhZyIsInRvTWQ1IiwidG9TaGEyNTYiLCJ1cmlFc2NhcGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImpvaW5Ib3N0UG9ydCIsIlBvc3RQb2xpY3kiLCJyZXF1ZXN0IiwiZHJhaW5SZXNwb25zZSIsInJlYWRBc0J1ZmZlciIsInJlYWRBc1N0cmluZyIsImdldFMzRW5kcG9pbnQiLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwicGFyc2VJbml0aWF0ZU11bHRpcGFydCIsInBhcnNlTGlzdE9iamVjdHMiLCJwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwidXBsb2FkUGFydFBhcnNlciIsInhtbFBhcnNlcnMiLCJ4bWwiLCJCdWlsZGVyIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwiUGFja2FnZSIsInZlcnNpb24iLCJyZXF1ZXN0T3B0aW9uUHJvcGVydGllcyIsIlR5cGVkQ2xpZW50IiwicGFydFNpemUiLCJtYXhpbXVtUGFydFNpemUiLCJtYXhPYmplY3RTaXplIiwiY29uc3RydWN0b3IiLCJwYXJhbXMiLCJzZWN1cmUiLCJ1bmRlZmluZWQiLCJFcnJvciIsInVzZVNTTCIsInBvcnQiLCJlbmRQb2ludCIsIkludmFsaWRFbmRwb2ludEVycm9yIiwiSW52YWxpZEFyZ3VtZW50RXJyb3IiLCJyZWdpb24iLCJob3N0IiwidG9Mb3dlckNhc2UiLCJwcm90b2NvbCIsInRyYW5zcG9ydCIsInRyYW5zcG9ydEFnZW50IiwiZ2xvYmFsQWdlbnQiLCJsaWJyYXJ5Q29tbWVudHMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJhcmNoIiwibGlicmFyeUFnZW50IiwidXNlckFnZW50IiwicGF0aFN0eWxlIiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwiYW5vbnltb3VzIiwiY3JlZGVudGlhbHNQcm92aWRlciIsInJlZ2lvbk1hcCIsIm92ZXJSaWRlUGFydFNpemUiLCJlbmFibGVTSEEyNTYiLCJzM0FjY2VsZXJhdGVFbmRwb2ludCIsInJlcU9wdGlvbnMiLCJjbGllbnRFeHRlbnNpb25zIiwiZXh0ZW5zaW9ucyIsInNldFMzVHJhbnNmZXJBY2NlbGVyYXRlIiwic2V0UmVxdWVzdE9wdGlvbnMiLCJvcHRpb25zIiwiVHlwZUVycm9yIiwicGljayIsImdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0IiwiYnVja2V0TmFtZSIsIm9iamVjdE5hbWUiLCJpbmNsdWRlcyIsInNldEFwcEluZm8iLCJhcHBOYW1lIiwiYXBwVmVyc2lvbiIsInRyaW0iLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJhY2NlbGVyYXRlRW5kUG9pbnQiLCJrIiwidiIsIk9iamVjdCIsImVudHJpZXMiLCJhc3NpZ24iLCJtYXBWYWx1ZXMiLCJwaWNrQnkiLCJ0b1N0cmluZyIsInNldENyZWRlbnRpYWxzUHJvdmlkZXIiLCJjaGVja0FuZFJlZnJlc2hDcmVkcyIsImNyZWRlbnRpYWxzQ29uZiIsImdldENyZWRlbnRpYWxzIiwiZ2V0QWNjZXNzS2V5IiwiZ2V0U2VjcmV0S2V5IiwiZ2V0U2Vzc2lvblRva2VuIiwiZSIsImNhdXNlIiwibG9nSFRUUCIsInJlc3BvbnNlIiwiZXJyIiwibG9nU3RyZWFtIiwibG9nSGVhZGVycyIsImZvckVhY2giLCJyZWRhY3RvciIsIlJlZ0V4cCIsInJlcGxhY2UiLCJ3cml0ZSIsInN0YXR1c0NvZGUiLCJlcnJKU09OIiwiSlNPTiIsInN0cmluZ2lmeSIsInRyYWNlT24iLCJzdGRvdXQiLCJ0cmFjZU9mZiIsIm1ha2VSZXF1ZXN0QXN5bmMiLCJwYXlsb2FkIiwiZXhwZWN0ZWRDb2RlcyIsImxlbmd0aCIsInNoYTI1NnN1bSIsIm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMiLCJtYWtlUmVxdWVzdEFzeW5jT21pdCIsInN0YXR1c0NvZGVzIiwicmVzIiwiYm9keSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZ2V0QnVja2V0UmVnaW9uQXN5bmMiLCJkYXRlIiwiRGF0ZSIsImF1dGhvcml6YXRpb24iLCJwYXJzZVJlc3BvbnNlRXJyb3IiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiY2FjaGVkIiwiZXh0cmFjdFJlZ2lvbkFzeW5jIiwicGFyc2VCdWNrZXRSZWdpb24iLCJTM0Vycm9yIiwiZXJyQ29kZSIsImNvZGUiLCJlcnJSZWdpb24iLCJuYW1lIiwiUmVnaW9uIiwibWFrZVJlcXVlc3QiLCJyZXR1cm5SZXNwb25zZSIsImNiIiwicHJvbSIsInRoZW4iLCJyZXN1bHQiLCJtYWtlUmVxdWVzdFN0cmVhbSIsImV4ZWN1dG9yIiwiZ2V0QnVja2V0UmVnaW9uIiwibWFrZUJ1Y2tldCIsIm1ha2VPcHRzIiwiYnVpbGRPYmplY3QiLCJDcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uIiwiJCIsInhtbG5zIiwiTG9jYXRpb25Db25zdHJhaW50IiwiT2JqZWN0TG9ja2luZyIsImZpbmFsUmVnaW9uIiwicmVxdWVzdE9wdCIsImJ1Y2tldEV4aXN0cyIsInJlbW92ZUJ1Y2tldCIsImdldE9iamVjdCIsImdldE9wdHMiLCJJbnZhbGlkT2JqZWN0TmFtZUVycm9yIiwiZ2V0UGFydGlhbE9iamVjdCIsIm9mZnNldCIsInJhbmdlIiwic3NlSGVhZGVycyIsIlNTRUN1c3RvbWVyQWxnb3JpdGhtIiwiU1NFQ3VzdG9tZXJLZXkiLCJTU0VDdXN0b21lcktleU1ENSIsImV4cGVjdGVkU3RhdHVzQ29kZXMiLCJwdXNoIiwiZkdldE9iamVjdCIsImZpbGVQYXRoIiwiZG93bmxvYWRUb1RtcEZpbGUiLCJwYXJ0RmlsZVN0cmVhbSIsIm9ialN0YXQiLCJzdGF0T2JqZWN0IiwiZW5jb2RlZEV0YWciLCJmcm9tIiwiZXRhZyIsInBhcnRGaWxlIiwibWtkaXIiLCJkaXJuYW1lIiwicmVjdXJzaXZlIiwic3RhdHMiLCJzdGF0Iiwic2l6ZSIsImNyZWF0ZVdyaXRlU3RyZWFtIiwiZmxhZ3MiLCJkb3dubG9hZFN0cmVhbSIsInBpcGVsaW5lIiwicmVuYW1lIiwic3RhdE9wdHMiLCJzdGF0T3B0RGVmIiwicGFyc2VJbnQiLCJtZXRhRGF0YSIsImxhc3RNb2RpZmllZCIsInZlcnNpb25JZCIsInJlbW92ZU9iamVjdCIsInJlbW92ZU9wdHMiLCJnb3Zlcm5hbmNlQnlwYXNzIiwiZm9yY2VEZWxldGUiLCJxdWVyeVBhcmFtcyIsImxpc3RJbmNvbXBsZXRlVXBsb2FkcyIsImJ1Y2tldCIsInByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsInByZWZpeGVzIiwiZWFjaFNlcmllcyIsInVwbG9hZCIsImxpc3RQYXJ0cyIsImtleSIsInVwbG9hZElkIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiZW1pdCIsImlzVHJ1bmNhdGVkIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsInF1ZXJpZXMiLCJtYXhVcGxvYWRzIiwic29ydCIsInVuc2hpZnQiLCJqb2luIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJhYm9ydE11bHRpcGFydFVwbG9hZCIsInJlcXVlc3RPcHRpb25zIiwiZmluZFVwbG9hZElkIiwiX2xhdGVzdFVwbG9hZCIsImxhdGVzdFVwbG9hZCIsImluaXRpYXRlZCIsImdldFRpbWUiLCJjb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsImV0YWdzIiwiYnVpbGRlciIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiUGFydCIsIm1hcCIsIlBhcnROdW1iZXIiLCJwYXJ0IiwiRVRhZyIsImVyck1lc3NhZ2UiLCJtYXJrZXIiLCJsaXN0UGFydHNRdWVyeSIsInBhcnNlTGlzdFBhcnRzIiwibGlzdEJ1Y2tldHMiLCJyZWdpb25Db25mIiwiaHR0cFJlcyIsInhtbFJlc3VsdCIsInBhcnNlTGlzdEJ1Y2tldCIsImNhbGN1bGF0ZVBhcnRTaXplIiwiZlB1dE9iamVjdCIsInB1dE9iamVjdCIsImNyZWF0ZVJlYWRTdHJlYW0iLCJzdGF0U2l6ZSIsInVwbG9hZEJ1ZmZlciIsImJ1ZiIsInVwbG9hZFN0cmVhbSIsIm1kNXN1bSIsIm9sZFBhcnRzIiwiZVRhZ3MiLCJwcmV2aW91c1VwbG9hZElkIiwib2xkVGFncyIsImNodW5raWVyIiwiemVyb1BhZGRpbmciLCJvIiwiUHJvbWlzZSIsImFsbCIsInJlc29sdmUiLCJyZWplY3QiLCJwaXBlIiwib24iLCJwYXJ0TnVtYmVyIiwiY2h1bmsiLCJtZDUiLCJjcmVhdGVIYXNoIiwidXBkYXRlIiwiZGlnZXN0Iiwib2xkUGFydCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJyZXBsaWNhdGlvbkNvbmZpZyIsInJvbGUiLCJydWxlcyIsInJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwiUm9sZSIsIlJ1bGUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T3B0cyIsInN0YXR1cyIsIkVOQUJMRUQiLCJESVNBQkxFRCIsImNvbmZpZyIsIlN0YXR1cyIsInJvb3ROYW1lIiwiZ2V0QnVja2V0VGFnZ2luZyIsInBhcnNlVGFnZ2luZyIsImdldE9iamVjdFRhZ2dpbmciLCJzZXRCdWNrZXRQb2xpY3kiLCJwb2xpY3kiLCJJbnZhbGlkQnVja2V0UG9saWN5RXJyb3IiLCJnZXRCdWNrZXRQb2xpY3kiLCJwdXRPYmplY3RSZXRlbnRpb24iLCJyZXRlbnRpb25PcHRzIiwibW9kZSIsIkNPTVBMSUFOQ0UiLCJHT1ZFUk5BTkNFIiwicmV0YWluVW50aWxEYXRlIiwiTW9kZSIsIlJldGFpblVudGlsRGF0ZSIsImdldE9iamVjdExvY2tDb25maWciLCJwYXJzZU9iamVjdExvY2tDb25maWciLCJzZXRPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ09wdHMiLCJyZXRlbnRpb25Nb2RlcyIsInZhbGlkVW5pdHMiLCJEQVlTIiwiWUVBUlMiLCJ1bml0IiwidmFsaWRpdHkiLCJPYmplY3RMb2NrRW5hYmxlZCIsImNvbmZpZ0tleXMiLCJpc0FsbEtleXNTZXQiLCJldmVyeSIsImxjayIsIkRlZmF1bHRSZXRlbnRpb24iLCJEYXlzIiwiWWVhcnMiLCJnZXRCdWNrZXRWZXJzaW9uaW5nIiwicGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnIiwic2V0QnVja2V0VmVyc2lvbmluZyIsInZlcnNpb25Db25maWciLCJzZXRUYWdnaW5nIiwidGFnZ2luZ1BhcmFtcyIsInRhZ3MiLCJwdXRPcHRzIiwidGFnc0xpc3QiLCJ2YWx1ZSIsIktleSIsIlZhbHVlIiwidGFnZ2luZ0NvbmZpZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJwYXlsb2FkQnVmIiwicmVtb3ZlVGFnZ2luZyIsInNldEJ1Y2tldFRhZ2dpbmciLCJyZW1vdmVCdWNrZXRUYWdnaW5nIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2VsZWN0T3B0cyIsImV4cHJlc3Npb24iLCJpbnB1dFNlcmlhbGl6YXRpb24iLCJvdXRwdXRTZXJpYWxpemF0aW9uIiwiRXhwcmVzc2lvbiIsIkV4cHJlc3Npb25UeXBlIiwiZXhwcmVzc2lvblR5cGUiLCJJbnB1dFNlcmlhbGl6YXRpb24iLCJPdXRwdXRTZXJpYWxpemF0aW9uIiwicmVxdWVzdFByb2dyZXNzIiwiUmVxdWVzdFByb2dyZXNzIiwic2NhblJhbmdlIiwiU2NhblJhbmdlIiwiYXBwbHlCdWNrZXRMaWZlY3ljbGUiLCJwb2xpY3lDb25maWciLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlQ3ljbGVDb25maWciLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiZW5jcnlwdGlvbk9iaiIsIkFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQiLCJTU0VBbGdvcml0aG0iLCJnZXRCdWNrZXRFbmNyeXB0aW9uIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwicmVtb3ZlQnVja2V0RW5jcnlwdGlvbiIsImdldE9iamVjdFJldGVudGlvbiIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwicnVuRGVsZXRlT2JqZWN0cyIsImJhdGNoIiwiZGVsT2JqZWN0cyIsIlZlcnNpb25JZCIsInJlbU9iamVjdHMiLCJEZWxldGUiLCJRdWlldCIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJtYXhFbnRyaWVzIiwiYmF0Y2hlcyIsImkiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJtb2RpZmllZCIsInVubW9kaWZpZWQiLCJtYXRjaEVUYWciLCJtYXRjaEVUYWdFeGNlcHQiLCJwYXJzZUNvcHlPYmplY3QiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwidmFsaWRhdGUiLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwiY29weVJlcyIsInJlc0hlYWRlcnMiLCJzaXplSGVhZGVyVmFsdWUiLCJMYXN0TW9kaWZpZWQiLCJNZXRhRGF0YSIsIlNvdXJjZVZlcnNpb25JZCIsIkV0YWciLCJTaXplIiwiY29weU9iamVjdCIsImFsbEFyZ3MiLCJzb3VyY2UiLCJkZXN0IiwidXBsb2FkUGFydCIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnRSZXMiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIk1BWF9QQVJUU19DT1VOVCIsInNPYmoiLCJnZXRTdGF0T3B0aW9ucyIsInNyY0NvbmZpZyIsIlZlcnNpb25JRCIsInNyY09iamVjdFNpemVzIiwidG90YWxTaXplIiwidG90YWxQYXJ0cyIsInNvdXJjZU9ialN0YXRzIiwic3JjSXRlbSIsInNyY09iamVjdEluZm9zIiwidmFsaWRhdGVkU3RhdHMiLCJyZXNJdGVtU3RhdCIsImluZGV4Iiwic3JjQ29weVNpemUiLCJNYXRjaFJhbmdlIiwic3JjU3RhcnQiLCJTdGFydCIsInNyY0VuZCIsIkVuZCIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsImlzTmFOIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwicG9saWN5QmFzZTY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsInZlcnNpb25JZE1hcmtlciIsImxpc3RRcnlMaXN0IiwibGlzdE9iamVjdHMiLCJsaXN0T3B0cyIsIm9iamVjdHMiLCJuZXh0TWFya2VyIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcydcclxuaW1wb3J0IHR5cGUgeyBJbmNvbWluZ0h0dHBIZWFkZXJzIH0gZnJvbSAnbm9kZTpodHRwJ1xyXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcclxuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnbm9kZTpodHRwcydcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnXHJcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcclxuXHJcbmltcG9ydCAqIGFzIGFzeW5jIGZyb20gJ2FzeW5jJ1xyXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXHJcbmltcG9ydCB7IGlzQnJvd3NlciB9IGZyb20gJ2Jyb3dzZXItb3Itbm9kZSdcclxuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xyXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXHJcbmltcG9ydCB4bWwyanMgZnJvbSAneG1sMmpzJ1xyXG5cclxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xyXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi4vZXJyb3JzLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xyXG5pbXBvcnQge1xyXG4gIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXHJcbiAgQ29weVNvdXJjZU9wdGlvbnMsXHJcbiAgREVGQVVMVF9SRUdJT04sXHJcbiAgTEVHQUxfSE9MRF9TVEFUVVMsXHJcbiAgUFJFU0lHTl9FWFBJUllfREFZU19NQVgsXHJcbiAgUkVURU5USU9OX01PREVTLFxyXG4gIFJFVEVOVElPTl9WQUxJRElUWV9VTklUUyxcclxufSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IFBvc3RQb2xpY3lSZXN1bHQgfSBmcm9tICcuLi9taW5pby50cydcclxuaW1wb3J0IHsgcG9zdFByZXNpZ25TaWduYXR1cmVWNCwgcHJlc2lnblNpZ25hdHVyZVY0LCBzaWduVjQgfSBmcm9tICcuLi9zaWduaW5nLnRzJ1xyXG5pbXBvcnQgeyBmc3AsIHN0cmVhbVByb21pc2UgfSBmcm9tICcuL2FzeW5jLnRzJ1xyXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vY29weS1jb25kaXRpb25zLnRzJ1xyXG5pbXBvcnQgeyBFeHRlbnNpb25zIH0gZnJvbSAnLi9leHRlbnNpb25zLnRzJ1xyXG5pbXBvcnQge1xyXG4gIGNhbGN1bGF0ZUV2ZW5TcGxpdHMsXHJcbiAgZXh0cmFjdE1ldGFkYXRhLFxyXG4gIGdldENvbnRlbnRMZW5ndGgsXHJcbiAgZ2V0U2NvcGUsXHJcbiAgZ2V0U291cmNlVmVyc2lvbklkLFxyXG4gIGdldFZlcnNpb25JZCxcclxuICBoYXNoQmluYXJ5LFxyXG4gIGluc2VydENvbnRlbnRUeXBlLFxyXG4gIGlzQW1hem9uRW5kcG9pbnQsXHJcbiAgaXNCb29sZWFuLFxyXG4gIGlzRGVmaW5lZCxcclxuICBpc0VtcHR5LFxyXG4gIGlzTnVtYmVyLFxyXG4gIGlzT2JqZWN0LFxyXG4gIGlzUGxhaW5PYmplY3QsXHJcbiAgaXNSZWFkYWJsZVN0cmVhbSxcclxuICBpc1N0cmluZyxcclxuICBpc1ZhbGlkQnVja2V0TmFtZSxcclxuICBpc1ZhbGlkRW5kcG9pbnQsXHJcbiAgaXNWYWxpZE9iamVjdE5hbWUsXHJcbiAgaXNWYWxpZFBvcnQsXHJcbiAgaXNWYWxpZFByZWZpeCxcclxuICBpc1ZpcnR1YWxIb3N0U3R5bGUsXHJcbiAgbWFrZURhdGVMb25nLFxyXG4gIFBBUlRfQ09OU1RSQUlOVFMsXHJcbiAgcGFydHNSZXF1aXJlZCxcclxuICBwcmVwZW5kWEFNWk1ldGEsXHJcbiAgcmVhZGFibGVTdHJlYW0sXHJcbiAgc2FuaXRpemVFVGFnLFxyXG4gIHRvTWQ1LFxyXG4gIHRvU2hhMjU2LFxyXG4gIHVyaUVzY2FwZSxcclxuICB1cmlSZXNvdXJjZUVzY2FwZSxcclxufSBmcm9tICcuL2hlbHBlci50cydcclxuaW1wb3J0IHsgam9pbkhvc3RQb3J0IH0gZnJvbSAnLi9qb2luLWhvc3QtcG9ydC50cydcclxuaW1wb3J0IHsgUG9zdFBvbGljeSB9IGZyb20gJy4vcG9zdC1wb2xpY3kudHMnXHJcbmltcG9ydCB7IHJlcXVlc3QgfSBmcm9tICcuL3JlcXVlc3QudHMnXHJcbmltcG9ydCB7IGRyYWluUmVzcG9uc2UsIHJlYWRBc0J1ZmZlciwgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcclxuaW1wb3J0IHR5cGUgeyBSZWdpb24gfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcclxuaW1wb3J0IHsgZ2V0UzNFbmRwb2ludCB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xyXG5pbXBvcnQgdHlwZSB7XHJcbiAgQmluYXJ5LFxyXG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcclxuICBCdWNrZXRJdGVtU3RhdCxcclxuICBCdWNrZXRTdHJlYW0sXHJcbiAgQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24sXHJcbiAgQ29weU9iamVjdFBhcmFtcyxcclxuICBDb3B5T2JqZWN0UmVzdWx0LFxyXG4gIENvcHlPYmplY3RSZXN1bHRWMixcclxuICBFbmNyeXB0aW9uQ29uZmlnLFxyXG4gIEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXHJcbiAgR2V0T2JqZWN0T3B0cyxcclxuICBHZXRPYmplY3RSZXRlbnRpb25PcHRzLFxyXG4gIEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0sXHJcbiAgSVJlcXVlc3QsXHJcbiAgSXRlbUJ1Y2tldE1ldGFkYXRhLFxyXG4gIExpZmVjeWNsZUNvbmZpZyxcclxuICBMaWZlQ3ljbGVDb25maWdQYXJhbSxcclxuICBMaXN0T2JqZWN0UXVlcnlPcHRzLFxyXG4gIExpc3RPYmplY3RRdWVyeVJlcyxcclxuICBPYmplY3RJbmZvLFxyXG4gIE9iamVjdExvY2tDb25maWdQYXJhbSxcclxuICBPYmplY3RMb2NrSW5mbyxcclxuICBPYmplY3RNZXRhRGF0YSxcclxuICBPYmplY3RSZXRlbnRpb25JbmZvLFxyXG4gIFByZVNpZ25SZXF1ZXN0UGFyYW1zLFxyXG4gIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXHJcbiAgUHV0VGFnZ2luZ1BhcmFtcyxcclxuICBSZW1vdmVPYmplY3RzUGFyYW0sXHJcbiAgUmVtb3ZlT2JqZWN0c1JlcXVlc3RFbnRyeSxcclxuICBSZW1vdmVPYmplY3RzUmVzcG9uc2UsXHJcbiAgUmVtb3ZlVGFnZ2luZ1BhcmFtcyxcclxuICBSZXBsaWNhdGlvbkNvbmZpZyxcclxuICBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsXHJcbiAgUmVxdWVzdEhlYWRlcnMsXHJcbiAgUmVzcG9uc2VIZWFkZXIsXHJcbiAgUmVzdWx0Q2FsbGJhY2ssXHJcbiAgUmV0ZW50aW9uLFxyXG4gIFNlbGVjdE9wdGlvbnMsXHJcbiAgU3RhdE9iamVjdE9wdHMsXHJcbiAgVGFnLFxyXG4gIFRhZ2dpbmdPcHRzLFxyXG4gIFRhZ3MsXHJcbiAgVHJhbnNwb3J0LFxyXG4gIFVwbG9hZGVkT2JqZWN0SW5mbyxcclxuICBVcGxvYWRQYXJ0Q29uZmlnLFxyXG59IGZyb20gJy4vdHlwZS50cydcclxuaW1wb3J0IHR5cGUgeyBMaXN0TXVsdGlwYXJ0UmVzdWx0LCBVcGxvYWRlZFBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXHJcbmltcG9ydCB7XHJcbiAgcGFyc2VDb21wbGV0ZU11bHRpcGFydCxcclxuICBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0LFxyXG4gIHBhcnNlTGlzdE9iamVjdHMsXHJcbiAgcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcsXHJcbiAgcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UsXHJcbiAgdXBsb2FkUGFydFBhcnNlcixcclxufSBmcm9tICcuL3htbC1wYXJzZXIudHMnXHJcbmltcG9ydCAqIGFzIHhtbFBhcnNlcnMgZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xyXG5cclxuY29uc3QgeG1sID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXHJcblxyXG4vLyB3aWxsIGJlIHJlcGxhY2VkIGJ5IGJ1bmRsZXIuXHJcbmNvbnN0IFBhY2thZ2UgPSB7IHZlcnNpb246IHByb2Nlc3MuZW52Lk1JTklPX0pTX1BBQ0tBR0VfVkVSU0lPTiB8fCAnZGV2ZWxvcG1lbnQnIH1cclxuXHJcbmNvbnN0IHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzID0gW1xyXG4gICdhZ2VudCcsXHJcbiAgJ2NhJyxcclxuICAnY2VydCcsXHJcbiAgJ2NpcGhlcnMnLFxyXG4gICdjbGllbnRDZXJ0RW5naW5lJyxcclxuICAnY3JsJyxcclxuICAnZGhwYXJhbScsXHJcbiAgJ2VjZGhDdXJ2ZScsXHJcbiAgJ2ZhbWlseScsXHJcbiAgJ2hvbm9yQ2lwaGVyT3JkZXInLFxyXG4gICdrZXknLFxyXG4gICdwYXNzcGhyYXNlJyxcclxuICAncGZ4JyxcclxuICAncmVqZWN0VW5hdXRob3JpemVkJyxcclxuICAnc2VjdXJlT3B0aW9ucycsXHJcbiAgJ3NlY3VyZVByb3RvY29sJyxcclxuICAnc2VydmVybmFtZScsXHJcbiAgJ3Nlc3Npb25JZENvbnRleHQnLFxyXG5dIGFzIGNvbnN0XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudE9wdGlvbnMge1xyXG4gIGVuZFBvaW50OiBzdHJpbmdcclxuICBhY2Nlc3NLZXk/OiBzdHJpbmdcclxuICBzZWNyZXRLZXk/OiBzdHJpbmdcclxuICB1c2VTU0w/OiBib29sZWFuXHJcbiAgcG9ydD86IG51bWJlclxyXG4gIHJlZ2lvbj86IFJlZ2lvblxyXG4gIHRyYW5zcG9ydD86IFRyYW5zcG9ydFxyXG4gIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xyXG4gIHBhcnRTaXplPzogbnVtYmVyXHJcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxyXG4gIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcclxuICBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xyXG4gIHRyYW5zcG9ydEFnZW50PzogaHR0cC5BZ2VudFxyXG59XHJcblxyXG5leHBvcnQgdHlwZSBSZXF1ZXN0T3B0aW9uID0gUGFydGlhbDxJUmVxdWVzdD4gJiB7XHJcbiAgbWV0aG9kOiBzdHJpbmdcclxuICBidWNrZXROYW1lPzogc3RyaW5nXHJcbiAgb2JqZWN0TmFtZT86IHN0cmluZ1xyXG4gIHF1ZXJ5Pzogc3RyaW5nXHJcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxyXG59XHJcblxyXG5leHBvcnQgdHlwZSBOb1Jlc3VsdENhbGxiYWNrID0gKGVycm9yOiB1bmtub3duKSA9PiB2b2lkXHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIE1ha2VCdWNrZXRPcHQge1xyXG4gIE9iamVjdExvY2tpbmc/OiBib29sZWFuXHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUmVtb3ZlT3B0aW9ucyB7XHJcbiAgdmVyc2lvbklkPzogc3RyaW5nXHJcbiAgZ292ZXJuYW5jZUJ5cGFzcz86IGJvb2xlYW5cclxuICBmb3JjZURlbGV0ZT86IGJvb2xlYW5cclxufVxyXG5cclxudHlwZSBQYXJ0ID0ge1xyXG4gIHBhcnQ6IG51bWJlclxyXG4gIGV0YWc6IHN0cmluZ1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgVHlwZWRDbGllbnQge1xyXG4gIHByb3RlY3RlZCB0cmFuc3BvcnQ6IFRyYW5zcG9ydFxyXG4gIHByb3RlY3RlZCBob3N0OiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgcG9ydDogbnVtYmVyXHJcbiAgcHJvdGVjdGVkIHByb3RvY29sOiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgYWNjZXNzS2V5OiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgc2VjcmV0S2V5OiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgc2Vzc2lvblRva2VuPzogc3RyaW5nXHJcbiAgcHJvdGVjdGVkIHVzZXJBZ2VudDogc3RyaW5nXHJcbiAgcHJvdGVjdGVkIGFub255bW91czogYm9vbGVhblxyXG4gIHByb3RlY3RlZCBwYXRoU3R5bGU6IGJvb2xlYW5cclxuICBwcm90ZWN0ZWQgcmVnaW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbiAgcHVibGljIHJlZ2lvbj86IHN0cmluZ1xyXG4gIHByb3RlY3RlZCBjcmVkZW50aWFsc1Byb3ZpZGVyPzogQ3JlZGVudGlhbFByb3ZpZGVyXHJcbiAgcGFydFNpemU6IG51bWJlciA9IDY0ICogMTAyNCAqIDEwMjRcclxuICBwcm90ZWN0ZWQgb3ZlclJpZGVQYXJ0U2l6ZT86IGJvb2xlYW5cclxuXHJcbiAgcHJvdGVjdGVkIG1heGltdW1QYXJ0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjRcclxuICBwcm90ZWN0ZWQgbWF4T2JqZWN0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0XHJcbiAgcHVibGljIGVuYWJsZVNIQTI1NjogYm9vbGVhblxyXG4gIHByb3RlY3RlZCBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xyXG4gIHByb3RlY3RlZCByZXFPcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxyXG5cclxuICBwcm90ZWN0ZWQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcclxuICBwcml2YXRlIHJlYWRvbmx5IGNsaWVudEV4dGVuc2lvbnM6IEV4dGVuc2lvbnNcclxuXHJcbiAgY29uc3RydWN0b3IocGFyYW1zOiBDbGllbnRPcHRpb25zKSB7XHJcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGRlcHJlY2F0ZWQgcHJvcGVydHlcclxuICAgIGlmIChwYXJhbXMuc2VjdXJlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcInNlY3VyZVwiIG9wdGlvbiBkZXByZWNhdGVkLCBcInVzZVNTTFwiIHNob3VsZCBiZSB1c2VkIGluc3RlYWQnKVxyXG4gICAgfVxyXG4gICAgLy8gRGVmYXVsdCB2YWx1ZXMgaWYgbm90IHNwZWNpZmllZC5cclxuICAgIGlmIChwYXJhbXMudXNlU1NMID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgcGFyYW1zLnVzZVNTTCA9IHRydWVcclxuICAgIH1cclxuICAgIGlmICghcGFyYW1zLnBvcnQpIHtcclxuICAgICAgcGFyYW1zLnBvcnQgPSAwXHJcbiAgICB9XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dCBwYXJhbXMuXHJcbiAgICBpZiAoIWlzVmFsaWRFbmRwb2ludChwYXJhbXMuZW5kUG9pbnQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEVuZHBvaW50RXJyb3IoYEludmFsaWQgZW5kUG9pbnQgOiAke3BhcmFtcy5lbmRQb2ludH1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkUG9ydChwYXJhbXMucG9ydCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBwb3J0IDogJHtwYXJhbXMucG9ydH1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc0Jvb2xlYW4ocGFyYW1zLnVzZVNTTCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICBgSW52YWxpZCB1c2VTU0wgZmxhZyB0eXBlIDogJHtwYXJhbXMudXNlU1NMfSwgZXhwZWN0ZWQgdG8gYmUgb2YgdHlwZSBcImJvb2xlYW5cImAsXHJcbiAgICAgIClcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSByZWdpb24gb25seSBpZiBpdHMgc2V0LlxyXG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcclxuICAgICAgaWYgKCFpc1N0cmluZyhwYXJhbXMucmVnaW9uKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgcmVnaW9uIDogJHtwYXJhbXMucmVnaW9ufWApXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBob3N0ID0gcGFyYW1zLmVuZFBvaW50LnRvTG93ZXJDYXNlKClcclxuICAgIGxldCBwb3J0ID0gcGFyYW1zLnBvcnRcclxuICAgIGxldCBwcm90b2NvbDogc3RyaW5nXHJcbiAgICBsZXQgdHJhbnNwb3J0XHJcbiAgICBsZXQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcclxuICAgIC8vIFZhbGlkYXRlIGlmIGNvbmZpZ3VyYXRpb24gaXMgbm90IHVzaW5nIFNTTFxyXG4gICAgLy8gZm9yIGNvbnN0cnVjdGluZyByZWxldmFudCBlbmRwb2ludHMuXHJcbiAgICBpZiAocGFyYW1zLnVzZVNTTCkge1xyXG4gICAgICAvLyBEZWZhdWx0cyB0byBzZWN1cmUuXHJcbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBzXHJcbiAgICAgIHByb3RvY29sID0gJ2h0dHBzOidcclxuICAgICAgcG9ydCA9IHBvcnQgfHwgNDQzXHJcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cHMuZ2xvYmFsQWdlbnRcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBcclxuICAgICAgcHJvdG9jb2wgPSAnaHR0cDonXHJcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDgwXHJcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cC5nbG9iYWxBZ2VudFxyXG4gICAgfVxyXG5cclxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgaXMgc2V0LCB1c2UgaXQuXHJcbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydCkge1xyXG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnQpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydCB0eXBlIDogJHtwYXJhbXMudHJhbnNwb3J0fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcclxuICAgICAgICApXHJcbiAgICAgIH1cclxuICAgICAgdHJhbnNwb3J0ID0gcGFyYW1zLnRyYW5zcG9ydFxyXG4gICAgfVxyXG5cclxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgYWdlbnQgaXMgc2V0LCB1c2UgaXQuXHJcbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydEFnZW50KSB7XHJcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydEFnZW50KSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXHJcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnRBZ2VudCB0eXBlOiAke3BhcmFtcy50cmFuc3BvcnRBZ2VudH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXHJcbiAgICAgICAgKVxyXG4gICAgICB9XHJcblxyXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IHBhcmFtcy50cmFuc3BvcnRBZ2VudFxyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZXIgQWdlbnQgc2hvdWxkIGFsd2F5cyBmb2xsb3dpbmcgdGhlIGJlbG93IHN0eWxlLlxyXG4gICAgLy8gUGxlYXNlIG9wZW4gYW4gaXNzdWUgdG8gZGlzY3VzcyBhbnkgbmV3IGNoYW5nZXMgaGVyZS5cclxuICAgIC8vXHJcbiAgICAvLyAgICAgICBNaW5JTyAoT1M7IEFSQ0gpIExJQi9WRVIgQVBQL1ZFUlxyXG4gICAgLy9cclxuICAgIGNvbnN0IGxpYnJhcnlDb21tZW50cyA9IGAoJHtwcm9jZXNzLnBsYXRmb3JtfTsgJHtwcm9jZXNzLmFyY2h9KWBcclxuICAgIGNvbnN0IGxpYnJhcnlBZ2VudCA9IGBNaW5JTyAke2xpYnJhcnlDb21tZW50c30gbWluaW8tanMvJHtQYWNrYWdlLnZlcnNpb259YFxyXG4gICAgLy8gVXNlciBhZ2VudCBibG9jayBlbmRzLlxyXG5cclxuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0XHJcbiAgICB0aGlzLnRyYW5zcG9ydEFnZW50ID0gdHJhbnNwb3J0QWdlbnRcclxuICAgIHRoaXMuaG9zdCA9IGhvc3RcclxuICAgIHRoaXMucG9ydCA9IHBvcnRcclxuICAgIHRoaXMucHJvdG9jb2wgPSBwcm90b2NvbFxyXG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHtsaWJyYXJ5QWdlbnR9YFxyXG5cclxuICAgIC8vIERlZmF1bHQgcGF0aCBzdHlsZSBpcyB0cnVlXHJcbiAgICBpZiAocGFyYW1zLnBhdGhTdHlsZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gdHJ1ZVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5wYXRoU3R5bGUgPSBwYXJhbXMucGF0aFN0eWxlXHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBwYXJhbXMuYWNjZXNzS2V5ID8/ICcnXHJcbiAgICB0aGlzLnNlY3JldEtleSA9IHBhcmFtcy5zZWNyZXRLZXkgPz8gJydcclxuICAgIHRoaXMuc2Vzc2lvblRva2VuID0gcGFyYW1zLnNlc3Npb25Ub2tlblxyXG4gICAgdGhpcy5hbm9ueW1vdXMgPSAhdGhpcy5hY2Nlc3NLZXkgfHwgIXRoaXMuc2VjcmV0S2V5XHJcblxyXG4gICAgaWYgKHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XHJcbiAgICAgIHRoaXMuYW5vbnltb3VzID0gZmFsc2VcclxuICAgICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gcGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXJcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnJlZ2lvbk1hcCA9IHt9XHJcbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xyXG4gICAgICB0aGlzLnJlZ2lvbiA9IHBhcmFtcy5yZWdpb25cclxuICAgIH1cclxuXHJcbiAgICBpZiAocGFyYW1zLnBhcnRTaXplKSB7XHJcbiAgICAgIHRoaXMucGFydFNpemUgPSBwYXJhbXMucGFydFNpemVcclxuICAgICAgdGhpcy5vdmVyUmlkZVBhcnRTaXplID0gdHJ1ZVxyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMucGFydFNpemUgPCA1ICogMTAyNCAqIDEwMjQpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBncmVhdGVyIHRoYW4gNU1CYClcclxuICAgIH1cclxuICAgIGlmICh0aGlzLnBhcnRTaXplID4gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGxlc3MgdGhhbiA1R0JgKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFNIQTI1NiBpcyBlbmFibGVkIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgaHR0cCByZXF1ZXN0cy4gSWYgdGhlIHJlcXVlc3QgaXMgYXV0aGVudGljYXRlZFxyXG4gICAgLy8gYW5kIHRoZSBjb25uZWN0aW9uIGlzIGh0dHBzIHdlIHVzZSB4LWFtei1jb250ZW50LXNoYTI1Nj1VTlNJR05FRC1QQVlMT0FEXHJcbiAgICAvLyBoZWFkZXIgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cclxuICAgIHRoaXMuZW5hYmxlU0hBMjU2ID0gIXRoaXMuYW5vbnltb3VzICYmICFwYXJhbXMudXNlU1NMXHJcblxyXG4gICAgdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCA9IHBhcmFtcy5zM0FjY2VsZXJhdGVFbmRwb2ludCB8fCB1bmRlZmluZWRcclxuICAgIHRoaXMucmVxT3B0aW9ucyA9IHt9XHJcbiAgICB0aGlzLmNsaWVudEV4dGVuc2lvbnMgPSBuZXcgRXh0ZW5zaW9ucyh0aGlzKVxyXG4gIH1cclxuICAvKipcclxuICAgKiBNaW5pbyBleHRlbnNpb25zIHRoYXQgYXJlbid0IG5lY2Vzc2FyeSBwcmVzZW50IGZvciBBbWF6b24gUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZlcnNcclxuICAgKi9cclxuICBnZXQgZXh0ZW5zaW9ucygpIHtcclxuICAgIHJldHVybiB0aGlzLmNsaWVudEV4dGVuc2lvbnNcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEBwYXJhbSBlbmRQb2ludCAtIHZhbGlkIFMzIGFjY2VsZXJhdGlvbiBlbmQgcG9pbnRcclxuICAgKi9cclxuICBzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZShlbmRQb2ludDogc3RyaW5nKSB7XHJcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gZW5kUG9pbnRcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdGhlIHN1cHBvcnRlZCByZXF1ZXN0IG9wdGlvbnMuXHJcbiAgICovXHJcbiAgcHVibGljIHNldFJlcXVlc3RPcHRpb25zKG9wdGlvbnM6IFBpY2s8aHR0cHMuUmVxdWVzdE9wdGlvbnMsICh0eXBlb2YgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpW251bWJlcl0+KSB7XHJcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcXVlc3Qgb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIHRoaXMucmVxT3B0aW9ucyA9IF8ucGljayhvcHRpb25zLCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqICBUaGlzIGlzIHMzIFNwZWNpZmljIGFuZCBkb2VzIG5vdCBob2xkIHZhbGlkaXR5IGluIGFueSBvdGhlciBPYmplY3Qgc3RvcmFnZS5cclxuICAgKi9cclxuICBwcml2YXRlIGdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWU/OiBzdHJpbmcsIG9iamVjdE5hbWU/OiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNFbXB0eSh0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50KSAmJiAhaXNFbXB0eShidWNrZXROYW1lKSAmJiAhaXNFbXB0eShvYmplY3ROYW1lKSkge1xyXG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXHJcbiAgICAgIC8vIERpc2FibGUgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGZvciBub24tY29tcGxpYW50IGJ1Y2tldCBuYW1lcy5cclxuICAgICAgaWYgKGJ1Y2tldE5hbWUuaW5jbHVkZXMoJy4nKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmZXIgQWNjZWxlcmF0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIG5vbiBjb21wbGlhbnQgYnVja2V0OiR7YnVja2V0TmFtZX1gKVxyXG4gICAgICB9XHJcbiAgICAgIC8vIElmIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBpcyByZXF1ZXN0ZWQgc2V0IG5ldyBob3N0LlxyXG4gICAgICAvLyBGb3IgbW9yZSBkZXRhaWxzIGFib3V0IGVuYWJsaW5nIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiByZWFkIGhlcmUuXHJcbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcclxuICAgICAgcmV0dXJuIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnRcclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogICBTZXQgYXBwbGljYXRpb24gc3BlY2lmaWMgaW5mb3JtYXRpb24uXHJcbiAgICogICBHZW5lcmF0ZXMgVXNlci1BZ2VudCBpbiB0aGUgZm9sbG93aW5nIHN0eWxlLlxyXG4gICAqICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcclxuICAgKi9cclxuICBzZXRBcHBJbmZvKGFwcE5hbWU6IHN0cmluZywgYXBwVmVyc2lvbjogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzU3RyaW5nKGFwcE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwTmFtZTogJHthcHBOYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoYXBwTmFtZS50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcE5hbWUgY2Fubm90IGJlIGVtcHR5LicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKGFwcFZlcnNpb24pKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwVmVyc2lvbjogJHthcHBWZXJzaW9ufWApXHJcbiAgICB9XHJcbiAgICBpZiAoYXBwVmVyc2lvbi50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcFZlcnNpb24gY2Fubm90IGJlIGVtcHR5LicpXHJcbiAgICB9XHJcbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke3RoaXMudXNlckFnZW50fSAke2FwcE5hbWV9LyR7YXBwVmVyc2lvbn1gXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiByZXR1cm5zIG9wdGlvbnMgb2JqZWN0IHRoYXQgY2FuIGJlIHVzZWQgd2l0aCBodHRwLnJlcXVlc3QoKVxyXG4gICAqIFRha2VzIGNhcmUgb2YgY29uc3RydWN0aW5nIHZpcnR1YWwtaG9zdC1zdHlsZSBvciBwYXRoLXN0eWxlIGhvc3RuYW1lXHJcbiAgICovXHJcbiAgcHJvdGVjdGVkIGdldFJlcXVlc3RPcHRpb25zKFxyXG4gICAgb3B0czogUmVxdWVzdE9wdGlvbiAmIHtcclxuICAgICAgcmVnaW9uOiBzdHJpbmdcclxuICAgIH0sXHJcbiAgKTogSVJlcXVlc3QgJiB7XHJcbiAgICBob3N0OiBzdHJpbmdcclxuICAgIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuICB9IHtcclxuICAgIGNvbnN0IG1ldGhvZCA9IG9wdHMubWV0aG9kXHJcbiAgICBjb25zdCByZWdpb24gPSBvcHRzLnJlZ2lvblxyXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IG9wdHMuYnVja2V0TmFtZVxyXG4gICAgbGV0IG9iamVjdE5hbWUgPSBvcHRzLm9iamVjdE5hbWVcclxuICAgIGNvbnN0IGhlYWRlcnMgPSBvcHRzLmhlYWRlcnNcclxuICAgIGNvbnN0IHF1ZXJ5ID0gb3B0cy5xdWVyeVxyXG5cclxuICAgIGxldCByZXFPcHRpb25zID0ge1xyXG4gICAgICBtZXRob2QsXHJcbiAgICAgIGhlYWRlcnM6IHt9IGFzIFJlcXVlc3RIZWFkZXJzLFxyXG4gICAgICBwcm90b2NvbDogdGhpcy5wcm90b2NvbCxcclxuICAgICAgLy8gSWYgY3VzdG9tIHRyYW5zcG9ydEFnZW50IHdhcyBzdXBwbGllZCBlYXJsaWVyLCB3ZSdsbCBpbmplY3QgaXQgaGVyZVxyXG4gICAgICBhZ2VudDogdGhpcy50cmFuc3BvcnRBZ2VudCxcclxuICAgIH1cclxuXHJcbiAgICAvLyBWZXJpZnkgaWYgdmlydHVhbCBob3N0IHN1cHBvcnRlZC5cclxuICAgIGxldCB2aXJ0dWFsSG9zdFN0eWxlXHJcbiAgICBpZiAoYnVja2V0TmFtZSkge1xyXG4gICAgICB2aXJ0dWFsSG9zdFN0eWxlID0gaXNWaXJ0dWFsSG9zdFN0eWxlKHRoaXMuaG9zdCwgdGhpcy5wcm90b2NvbCwgYnVja2V0TmFtZSwgdGhpcy5wYXRoU3R5bGUpXHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHBhdGggPSAnLydcclxuICAgIGxldCBob3N0ID0gdGhpcy5ob3N0XHJcblxyXG4gICAgbGV0IHBvcnQ6IHVuZGVmaW5lZCB8IG51bWJlclxyXG4gICAgaWYgKHRoaXMucG9ydCkge1xyXG4gICAgICBwb3J0ID0gdGhpcy5wb3J0XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcclxuICAgICAgb2JqZWN0TmFtZSA9IHVyaVJlc291cmNlRXNjYXBlKG9iamVjdE5hbWUpXHJcbiAgICB9XHJcblxyXG4gICAgLy8gRm9yIEFtYXpvbiBTMyBlbmRwb2ludCwgZ2V0IGVuZHBvaW50IGJhc2VkIG9uIHJlZ2lvbi5cclxuICAgIGlmIChpc0FtYXpvbkVuZHBvaW50KGhvc3QpKSB7XHJcbiAgICAgIGNvbnN0IGFjY2VsZXJhdGVFbmRQb2ludCA9IHRoaXMuZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcclxuICAgICAgaWYgKGFjY2VsZXJhdGVFbmRQb2ludCkge1xyXG4gICAgICAgIGhvc3QgPSBgJHthY2NlbGVyYXRlRW5kUG9pbnR9YFxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGhvc3QgPSBnZXRTM0VuZHBvaW50KHJlZ2lvbilcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICh2aXJ0dWFsSG9zdFN0eWxlICYmICFvcHRzLnBhdGhTdHlsZSkge1xyXG4gICAgICAvLyBGb3IgYWxsIGhvc3RzIHdoaWNoIHN1cHBvcnQgdmlydHVhbCBob3N0IHN0eWxlLCBgYnVja2V0TmFtZWBcclxuICAgICAgLy8gaXMgcGFydCBvZiB0aGUgaG9zdG5hbWUgaW4gdGhlIGZvbGxvd2luZyBmb3JtYXQ6XHJcbiAgICAgIC8vXHJcbiAgICAgIC8vICB2YXIgaG9zdCA9ICdidWNrZXROYW1lLmV4YW1wbGUuY29tJ1xyXG4gICAgICAvL1xyXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xyXG4gICAgICAgIGhvc3QgPSBgJHtidWNrZXROYW1lfS4ke2hvc3R9YFxyXG4gICAgICB9XHJcbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XHJcbiAgICAgICAgcGF0aCA9IGAvJHtvYmplY3ROYW1lfWBcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gRm9yIGFsbCBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmljZXMgd2Ugd2lsbCBmYWxsYmFjayB0b1xyXG4gICAgICAvLyBwYXRoIHN0eWxlIHJlcXVlc3RzLCB3aGVyZSBgYnVja2V0TmFtZWAgaXMgcGFydCBvZiB0aGUgVVJJXHJcbiAgICAgIC8vIHBhdGguXHJcbiAgICAgIGlmIChidWNrZXROYW1lKSB7XHJcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfWBcclxuICAgICAgfVxyXG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xyXG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX0vJHtvYmplY3ROYW1lfWBcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChxdWVyeSkge1xyXG4gICAgICBwYXRoICs9IGA/JHtxdWVyeX1gXHJcbiAgICB9XHJcbiAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGhvc3RcclxuICAgIGlmICgocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHA6JyAmJiBwb3J0ICE9PSA4MCkgfHwgKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwczonICYmIHBvcnQgIT09IDQ0MykpIHtcclxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBqb2luSG9zdFBvcnQoaG9zdCwgcG9ydClcclxuICAgIH1cclxuXHJcbiAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSA9IHRoaXMudXNlckFnZW50XHJcbiAgICBpZiAoaGVhZGVycykge1xyXG4gICAgICAvLyBoYXZlIGFsbCBoZWFkZXIga2V5cyBpbiBsb3dlciBjYXNlIC0gdG8gbWFrZSBzaWduaW5nIGVhc3lcclxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcclxuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbay50b0xvd2VyQ2FzZSgpXSA9IHZcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZSBhbnkgcmVxdWVzdCBvcHRpb24gc3BlY2lmaWVkIGluIG1pbmlvQ2xpZW50LnNldFJlcXVlc3RPcHRpb25zKClcclxuICAgIHJlcU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnJlcU9wdGlvbnMsIHJlcU9wdGlvbnMpXHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgLi4ucmVxT3B0aW9ucyxcclxuICAgICAgaGVhZGVyczogXy5tYXBWYWx1ZXMoXy5waWNrQnkocmVxT3B0aW9ucy5oZWFkZXJzLCBpc0RlZmluZWQpLCAodikgPT4gdi50b1N0cmluZygpKSxcclxuICAgICAgaG9zdCxcclxuICAgICAgcG9ydCxcclxuICAgICAgcGF0aCxcclxuICAgIH0gc2F0aXNmaWVzIGh0dHBzLlJlcXVlc3RPcHRpb25zXHJcbiAgfVxyXG5cclxuICBwdWJsaWMgYXN5bmMgc2V0Q3JlZGVudGlhbHNQcm92aWRlcihjcmVkZW50aWFsc1Byb3ZpZGVyOiBDcmVkZW50aWFsUHJvdmlkZXIpIHtcclxuICAgIGlmICghKGNyZWRlbnRpYWxzUHJvdmlkZXIgaW5zdGFuY2VvZiBDcmVkZW50aWFsUHJvdmlkZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5hYmxlIHRvIGdldCBjcmVkZW50aWFscy4gRXhwZWN0ZWQgaW5zdGFuY2Ugb2YgQ3JlZGVudGlhbFByb3ZpZGVyJylcclxuICAgIH1cclxuICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IGNyZWRlbnRpYWxzUHJvdmlkZXJcclxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjaGVja0FuZFJlZnJlc2hDcmVkcygpIHtcclxuICAgIGlmICh0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBjcmVkZW50aWFsc0NvbmYgPSBhd2FpdCB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIuZ2V0Q3JlZGVudGlhbHMoKVxyXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5ID0gY3JlZGVudGlhbHNDb25mLmdldEFjY2Vzc0tleSgpXHJcbiAgICAgICAgdGhpcy5zZWNyZXRLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2VjcmV0S2V5KClcclxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZXNzaW9uVG9rZW4oKVxyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzOiAke2V9YCwgeyBjYXVzZTogZSB9KVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGxvZ1N0cmVhbT86IHN0cmVhbS5Xcml0YWJsZVxyXG5cclxuICAvKipcclxuICAgKiBsb2cgdGhlIHJlcXVlc3QsIHJlc3BvbnNlLCBlcnJvclxyXG4gICAqL1xyXG4gIHByaXZhdGUgbG9nSFRUUChyZXFPcHRpb25zOiBJUmVxdWVzdCwgcmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgbnVsbCwgZXJyPzogdW5rbm93bikge1xyXG4gICAgLy8gaWYgbm8gbG9nU3RyZWFtIGF2YWlsYWJsZSByZXR1cm4uXHJcbiAgICBpZiAoIXRoaXMubG9nU3RyZWFtKSB7XHJcbiAgICAgIHJldHVyblxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChyZXFPcHRpb25zKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFPcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgaWYgKHJlc3BvbnNlICYmICFpc1JlYWRhYmxlU3RyZWFtKHJlc3BvbnNlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNwb25zZSBzaG91bGQgYmUgb2YgdHlwZSBcIlN0cmVhbVwiJylcclxuICAgIH1cclxuICAgIGlmIChlcnIgJiYgIShlcnIgaW5zdGFuY2VvZiBFcnJvcikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXJyIHNob3VsZCBiZSBvZiB0eXBlIFwiRXJyb3JcIicpXHJcbiAgICB9XHJcbiAgICBjb25zdCBsb2dTdHJlYW0gPSB0aGlzLmxvZ1N0cmVhbVxyXG4gICAgY29uc3QgbG9nSGVhZGVycyA9IChoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycykgPT4ge1xyXG4gICAgICBPYmplY3QuZW50cmllcyhoZWFkZXJzKS5mb3JFYWNoKChbaywgdl0pID0+IHtcclxuICAgICAgICBpZiAoayA9PSAnYXV0aG9yaXphdGlvbicpIHtcclxuICAgICAgICAgIGlmIChpc1N0cmluZyh2KSkge1xyXG4gICAgICAgICAgICBjb25zdCByZWRhY3RvciA9IG5ldyBSZWdFeHAoJ1NpZ25hdHVyZT0oWzAtOWEtZl0rKScpXHJcbiAgICAgICAgICAgIHYgPSB2LnJlcGxhY2UocmVkYWN0b3IsICdTaWduYXR1cmU9KipSRURBQ1RFRCoqJylcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2t9OiAke3Z9XFxuYClcclxuICAgICAgfSlcclxuICAgICAgbG9nU3RyZWFtLndyaXRlKCdcXG4nKVxyXG4gICAgfVxyXG4gICAgbG9nU3RyZWFtLndyaXRlKGBSRVFVRVNUOiAke3JlcU9wdGlvbnMubWV0aG9kfSAke3JlcU9wdGlvbnMucGF0aH1cXG5gKVxyXG4gICAgbG9nSGVhZGVycyhyZXFPcHRpb25zLmhlYWRlcnMpXHJcbiAgICBpZiAocmVzcG9uc2UpIHtcclxuICAgICAgdGhpcy5sb2dTdHJlYW0ud3JpdGUoYFJFU1BPTlNFOiAke3Jlc3BvbnNlLnN0YXR1c0NvZGV9XFxuYClcclxuICAgICAgbG9nSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzIGFzIFJlcXVlc3RIZWFkZXJzKVxyXG4gICAgfVxyXG4gICAgaWYgKGVycikge1xyXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ0VSUk9SIEJPRFk6XFxuJylcclxuICAgICAgY29uc3QgZXJySlNPTiA9IEpTT04uc3RyaW5naWZ5KGVyciwgbnVsbCwgJ1xcdCcpXHJcbiAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtlcnJKU09OfVxcbmApXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFbmFibGUgdHJhY2luZ1xyXG4gICAqL1xyXG4gIHB1YmxpYyB0cmFjZU9uKHN0cmVhbT86IHN0cmVhbS5Xcml0YWJsZSkge1xyXG4gICAgaWYgKCFzdHJlYW0pIHtcclxuICAgICAgc3RyZWFtID0gcHJvY2Vzcy5zdGRvdXRcclxuICAgIH1cclxuICAgIHRoaXMubG9nU3RyZWFtID0gc3RyZWFtXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBEaXNhYmxlIHRyYWNpbmdcclxuICAgKi9cclxuICBwdWJsaWMgdHJhY2VPZmYoKSB7XHJcbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHVuZGVmaW5lZFxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXHJcbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cclxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXHJcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cclxuICAgKlxyXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmQgZ2V0QnVja2V0UmVnaW9uLlxyXG4gICAqXHJcbiAgICogQGludGVybmFsXHJcbiAgICovXHJcbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luYyhcclxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXHJcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcclxuICAgIGV4cGVjdGVkQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXHJcbiAgICByZWdpb24gPSAnJyxcclxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XHJcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHBheWxvYWQpICYmICFpc09iamVjdChwYXlsb2FkKSkge1xyXG4gICAgICAvLyBCdWZmZXIgaXMgb2YgdHlwZSAnb2JqZWN0J1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXlsb2FkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCIgb3IgXCJCdWZmZXJcIicpXHJcbiAgICB9XHJcbiAgICBleHBlY3RlZENvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcclxuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFvcHRpb25zLmhlYWRlcnMpIHtcclxuICAgICAgb3B0aW9ucy5oZWFkZXJzID0ge31cclxuICAgIH1cclxuICAgIGlmIChvcHRpb25zLm1ldGhvZCA9PT0gJ1BPU1QnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnUFVUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ0RFTEVURScpIHtcclxuICAgICAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gcGF5bG9hZC5sZW5ndGgudG9TdHJpbmcoKVxyXG4gICAgfVxyXG4gICAgY29uc3Qgc2hhMjU2c3VtID0gdGhpcy5lbmFibGVTSEEyNTYgPyB0b1NoYTI1NihwYXlsb2FkKSA6ICcnXHJcbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHNoYTI1NnN1bSwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogbmV3IHJlcXVlc3Qgd2l0aCBwcm9taXNlXHJcbiAgICpcclxuICAgKiBObyBuZWVkIHRvIGRyYWluIHJlc3BvbnNlLCByZXNwb25zZSBib2R5IGlzIG5vdCB2YWxpZFxyXG4gICAqL1xyXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmNPbWl0KFxyXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcclxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxyXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXHJcbiAgICByZWdpb24gPSAnJyxcclxuICApOiBQcm9taXNlPE9taXQ8aHR0cC5JbmNvbWluZ01lc3NhZ2UsICdvbic+PiB7XHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcclxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxyXG4gICAgcmV0dXJuIHJlc1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxyXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcclxuICAgKlxyXG4gICAqIEBpbnRlcm5hbFxyXG4gICAqL1xyXG4gIGFzeW5jIG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXHJcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxyXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlIHwgQmluYXJ5LFxyXG4gICAgc2hhMjU2c3VtOiBzdHJpbmcsXHJcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXHJcbiAgICByZWdpb246IHN0cmluZyxcclxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XHJcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIShCdWZmZXIuaXNCdWZmZXIoYm9keSkgfHwgdHlwZW9mIGJvZHkgPT09ICdzdHJpbmcnIHx8IGlzUmVhZGFibGVTdHJlYW0oYm9keSkpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXHJcbiAgICAgICAgYHN0cmVhbSBzaG91bGQgYmUgYSBCdWZmZXIsIHN0cmluZyBvciByZWFkYWJsZSBTdHJlYW0sIGdvdCAke3R5cGVvZiBib2R5fSBpbnN0ZWFkYCxcclxuICAgICAgKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhzaGEyNTZzdW0pKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NoYTI1NnN1bSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIHN0YXR1c0NvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcclxuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgLy8gc2hhMjU2c3VtIHdpbGwgYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c1xyXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNoYTI1NnN1bSBleHBlY3RlZCB0byBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzYClcclxuICAgIH1cclxuICAgIC8vIHNoYTI1NnN1bSBzaG91bGQgYmUgdmFsaWQgZm9yIG5vbi1hbm9ueW1vdXMgaHR0cCByZXF1ZXN0cy5cclxuICAgIGlmICh0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSA2NCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHNoYTI1NnN1bSA6ICR7c2hhMjU2c3VtfWApXHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXHJcblxyXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cclxuICAgIHJlZ2lvbiA9IHJlZ2lvbiB8fCAoYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhvcHRpb25zLmJ1Y2tldE5hbWUhKSlcclxuXHJcbiAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IC4uLm9wdGlvbnMsIHJlZ2lvbiB9KVxyXG4gICAgaWYgKCF0aGlzLmFub255bW91cykge1xyXG4gICAgICAvLyBGb3Igbm9uLWFub255bW91cyBodHRwcyByZXF1ZXN0cyBzaGEyNTZzdW0gaXMgJ1VOU0lHTkVELVBBWUxPQUQnIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXHJcbiAgICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcclxuICAgICAgICBzaGEyNTZzdW0gPSAnVU5TSUdORUQtUEFZTE9BRCdcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxyXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWRhdGUnXSA9IG1ha2VEYXRlTG9uZyhkYXRlKVxyXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWNvbnRlbnQtc2hhMjU2J10gPSBzaGEyNTZzdW1cclxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XHJcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cclxuICAgICAgfVxyXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuYXV0aG9yaXphdGlvbiA9IHNpZ25WNChyZXFPcHRpb25zLCB0aGlzLmFjY2Vzc0tleSwgdGhpcy5zZWNyZXRLZXksIHJlZ2lvbiwgZGF0ZSwgc2hhMjU2c3VtKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdCh0aGlzLnRyYW5zcG9ydCwgcmVxT3B0aW9ucywgYm9keSlcclxuICAgIGlmICghcmVzcG9uc2Uuc3RhdHVzQ29kZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCVUc6IHJlc3BvbnNlIGRvZXNuJ3QgaGF2ZSBhIHN0YXR1c0NvZGVcIilcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXN0YXR1c0NvZGVzLmluY2x1ZGVzKHJlc3BvbnNlLnN0YXR1c0NvZGUpKSB7XHJcbiAgICAgIC8vIEZvciBhbiBpbmNvcnJlY3QgcmVnaW9uLCBTMyBzZXJ2ZXIgYWx3YXlzIHNlbmRzIGJhY2sgNDAwLlxyXG4gICAgICAvLyBCdXQgd2Ugd2lsbCBkbyBjYWNoZSBpbnZhbGlkYXRpb24gZm9yIGFsbCBlcnJvcnMgc28gdGhhdCxcclxuICAgICAgLy8gaW4gZnV0dXJlLCBpZiBBV1MgUzMgZGVjaWRlcyB0byBzZW5kIGEgZGlmZmVyZW50IHN0YXR1cyBjb2RlIG9yXHJcbiAgICAgIC8vIFhNTCBlcnJvciBjb2RlIHdlIHdpbGwgc3RpbGwgd29yayBmaW5lLlxyXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxyXG4gICAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbb3B0aW9ucy5idWNrZXROYW1lIV1cclxuXHJcbiAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHhtbFBhcnNlcnMucGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlKVxyXG4gICAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UsIGVycilcclxuICAgICAgdGhyb3cgZXJyXHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlKVxyXG5cclxuICAgIHJldHVybiByZXNwb25zZVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogZ2V0cyB0aGUgcmVnaW9uIG9mIHRoZSBidWNrZXRcclxuICAgKlxyXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXHJcbiAgICpcclxuICAgKiBAaW50ZXJuYWxcclxuICAgKi9cclxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lIDogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVnaW9uIGlzIHNldCB3aXRoIGNvbnN0cnVjdG9yLCByZXR1cm4gdGhlIHJlZ2lvbiByaWdodCBoZXJlLlxyXG4gICAgaWYgKHRoaXMucmVnaW9uKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lvblxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXHJcbiAgICBpZiAoY2FjaGVkKSB7XHJcbiAgICAgIHJldHVybiBjYWNoZWRcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBleHRyYWN0UmVnaW9uQXN5bmMgPSBhc3luYyAocmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXHJcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IHhtbFBhcnNlcnMucGFyc2VCdWNrZXRSZWdpb24oYm9keSkgfHwgREVGQVVMVF9SRUdJT05cclxuICAgICAgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV0gPSByZWdpb25cclxuICAgICAgcmV0dXJuIHJlZ2lvblxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdsb2NhdGlvbidcclxuICAgIC8vIGBnZXRCdWNrZXRMb2NhdGlvbmAgYmVoYXZlcyBkaWZmZXJlbnRseSBpbiBmb2xsb3dpbmcgd2F5cyBmb3JcclxuICAgIC8vIGRpZmZlcmVudCBlbnZpcm9ubWVudHMuXHJcbiAgICAvL1xyXG4gICAgLy8gLSBGb3Igbm9kZWpzIGVudiB3ZSBkZWZhdWx0IHRvIHBhdGggc3R5bGUgcmVxdWVzdHMuXHJcbiAgICAvLyAtIEZvciBicm93c2VyIGVudiBwYXRoIHN0eWxlIHJlcXVlc3RzIG9uIGJ1Y2tldHMgeWllbGRzIENPUlNcclxuICAgIC8vICAgZXJyb3IuIFRvIGNpcmN1bXZlbnQgdGhpcyBwcm9ibGVtIHdlIG1ha2UgYSB2aXJ0dWFsIGhvc3RcclxuICAgIC8vICAgc3R5bGUgcmVxdWVzdCBzaWduZWQgd2l0aCAndXMtZWFzdC0xJy4gVGhpcyByZXF1ZXN0IGZhaWxzXHJcbiAgICAvLyAgIHdpdGggYW4gZXJyb3IgJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnLCBhZGRpdGlvbmFsbHlcclxuICAgIC8vICAgdGhlIGVycm9yIFhNTCBhbHNvIHByb3ZpZGVzIFJlZ2lvbiBvZiB0aGUgYnVja2V0LiBUbyB2YWxpZGF0ZVxyXG4gICAgLy8gICB0aGlzIHJlZ2lvbiBpcyBwcm9wZXIgd2UgcmV0cnkgdGhlIHNhbWUgcmVxdWVzdCB3aXRoIHRoZSBuZXdseVxyXG4gICAgLy8gICBvYnRhaW5lZCByZWdpb24uXHJcbiAgICBjb25zdCBwYXRoU3R5bGUgPSB0aGlzLnBhdGhTdHlsZSAmJiAhaXNCcm93c2VyXHJcbiAgICBsZXQgcmVnaW9uOiBzdHJpbmdcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIHBhdGhTdHlsZSB9LCAnJywgWzIwMF0sIERFRkFVTFRfUkVHSU9OKVxyXG4gICAgICByZXR1cm4gZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgLy8gbWFrZSBhbGlnbm1lbnQgd2l0aCBtYyBjbGlcclxuICAgICAgaWYgKGUgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xyXG4gICAgICAgIGNvbnN0IGVyckNvZGUgPSBlLmNvZGVcclxuICAgICAgICBjb25zdCBlcnJSZWdpb24gPSBlLnJlZ2lvblxyXG4gICAgICAgIGlmIChlcnJDb2RlID09PSAnQWNjZXNzRGVuaWVkJyAmJiAhZXJyUmVnaW9uKSB7XHJcbiAgICAgICAgICByZXR1cm4gREVGQVVMVF9SRUdJT05cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgIGlmICghKGUubmFtZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnKSkge1xyXG4gICAgICAgIHRocm93IGVcclxuICAgICAgfVxyXG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIHdlIHNldCBleHRyYSBwcm9wZXJ0aWVzIG9uIGVycm9yIG9iamVjdFxyXG4gICAgICByZWdpb24gPSBlLlJlZ2lvbiBhcyBzdHJpbmdcclxuICAgICAgaWYgKCFyZWdpb24pIHtcclxuICAgICAgICB0aHJvdyBlXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCByZWdpb24pXHJcbiAgICByZXR1cm4gYXdhaXQgZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxyXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXHJcbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxyXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXHJcbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZFxyXG4gICAqIGdldEJ1Y2tldFJlZ2lvbi5cclxuICAgKlxyXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RBc3luY2AgaW5zdGVhZFxyXG4gICAqL1xyXG4gIG1ha2VSZXF1ZXN0KFxyXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcclxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxyXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcclxuICAgIHJlZ2lvbiA9ICcnLFxyXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXHJcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxyXG4gICkge1xyXG4gICAgbGV0IHByb206IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+XHJcbiAgICBpZiAocmV0dXJuUmVzcG9uc2UpIHtcclxuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29tcGF0aWJsZSBmb3Igb2xkIGJlaGF2aW91clxyXG4gICAgICBwcm9tID0gdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXHJcbiAgICB9XHJcblxyXG4gICAgcHJvbS50aGVuKFxyXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxyXG4gICAgICAoZXJyKSA9PiB7XHJcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgICBjYihlcnIpXHJcbiAgICAgIH0sXHJcbiAgICApXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXHJcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxyXG4gICAqXHJcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jYCBpbnN0ZWFkXHJcbiAgICovXHJcbiAgbWFrZVJlcXVlc3RTdHJlYW0oXHJcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxyXG4gICAgc3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgfCBCdWZmZXIsXHJcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcclxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcclxuICAgIHJlZ2lvbjogc3RyaW5nLFxyXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXHJcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxyXG4gICkge1xyXG4gICAgY29uc3QgZXhlY3V0b3IgPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBzdHJlYW0sIHNoYTI1NnN1bSwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcclxuICAgICAgaWYgKCFyZXR1cm5SZXNwb25zZSkge1xyXG4gICAgICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcmVzXHJcbiAgICB9XHJcblxyXG4gICAgZXhlY3V0b3IoKS50aGVuKFxyXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxyXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcclxuICAgIClcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgZ2V0QnVja2V0UmVnaW9uQXN5bmNgIGluc3RlYWRcclxuICAgKi9cclxuICBnZXRCdWNrZXRSZWdpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjYjogKGVycjogdW5rbm93biwgcmVnaW9uOiBzdHJpbmcpID0+IHZvaWQpIHtcclxuICAgIHJldHVybiB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpLnRoZW4oXHJcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXHJcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxyXG4gICAgKVxyXG4gIH1cclxuXHJcbiAgLy8gQnVja2V0IG9wZXJhdGlvbnNcclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyB0aGUgYnVja2V0IGBidWNrZXROYW1lYC5cclxuICAgKlxyXG4gICAqL1xyXG4gIGFzeW5jIG1ha2VCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCByZWdpb246IFJlZ2lvbiA9ICcnLCBtYWtlT3B0cz86IE1ha2VCdWNrZXRPcHQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcclxuICAgIGlmIChpc09iamVjdChyZWdpb24pKSB7XHJcbiAgICAgIG1ha2VPcHRzID0gcmVnaW9uXHJcbiAgICAgIHJlZ2lvbiA9ICcnXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmIChtYWtlT3B0cyAmJiAhaXNPYmplY3QobWFrZU9wdHMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2VPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBwYXlsb2FkID0gJydcclxuXHJcbiAgICAvLyBSZWdpb24gYWxyZWFkeSBzZXQgaW4gY29uc3RydWN0b3IsIHZhbGlkYXRlIGlmXHJcbiAgICAvLyBjYWxsZXIgcmVxdWVzdGVkIGJ1Y2tldCBsb2NhdGlvbiBpcyBzYW1lLlxyXG4gICAgaWYgKHJlZ2lvbiAmJiB0aGlzLnJlZ2lvbikge1xyXG4gICAgICBpZiAocmVnaW9uICE9PSB0aGlzLnJlZ2lvbikge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENvbmZpZ3VyZWQgcmVnaW9uICR7dGhpcy5yZWdpb259LCByZXF1ZXN0ZWQgJHtyZWdpb259YClcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gc2VuZGluZyBtYWtlQnVja2V0IHJlcXVlc3Qgd2l0aCBYTUwgY29udGFpbmluZyAndXMtZWFzdC0xJyBmYWlscy4gRm9yXHJcbiAgICAvLyBkZWZhdWx0IHJlZ2lvbiBzZXJ2ZXIgZXhwZWN0cyB0aGUgcmVxdWVzdCB3aXRob3V0IGJvZHlcclxuICAgIGlmIChyZWdpb24gJiYgcmVnaW9uICE9PSBERUZBVUxUX1JFR0lPTikge1xyXG4gICAgICBwYXlsb2FkID0geG1sLmJ1aWxkT2JqZWN0KHtcclxuICAgICAgICBDcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uOiB7XHJcbiAgICAgICAgICAkOiB7IHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyB9LFxyXG4gICAgICAgICAgTG9jYXRpb25Db25zdHJhaW50OiByZWdpb24sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XHJcblxyXG4gICAgaWYgKG1ha2VPcHRzICYmIG1ha2VPcHRzLk9iamVjdExvY2tpbmcpIHtcclxuICAgICAgaGVhZGVyc1sneC1hbXotYnVja2V0LW9iamVjdC1sb2NrLWVuYWJsZWQnXSA9IHRydWVcclxuICAgIH1cclxuXHJcbiAgICAvLyBGb3IgY3VzdG9tIHJlZ2lvbiBjbGllbnRzICBkZWZhdWx0IHRvIGN1c3RvbSByZWdpb24gc3BlY2lmaWVkIGluIGNsaWVudCBjb25zdHJ1Y3RvclxyXG4gICAgY29uc3QgZmluYWxSZWdpb24gPSB0aGlzLnJlZ2lvbiB8fCByZWdpb24gfHwgREVGQVVMVF9SRUdJT05cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0T3B0OiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGZpbmFsUmVnaW9uKVxyXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XHJcbiAgICAgIGlmIChyZWdpb24gPT09ICcnIHx8IHJlZ2lvbiA9PT0gREVGQVVMVF9SRUdJT04pIHtcclxuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLlMzRXJyb3IpIHtcclxuICAgICAgICAgIGNvbnN0IGVyckNvZGUgPSBlcnIuY29kZVxyXG4gICAgICAgICAgY29uc3QgZXJyUmVnaW9uID0gZXJyLnJlZ2lvblxyXG4gICAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJyAmJiBlcnJSZWdpb24gIT09ICcnKSB7XHJcbiAgICAgICAgICAgIC8vIFJldHJ5IHdpdGggcmVnaW9uIHJldHVybmVkIGFzIHBhcnQgb2YgZXJyb3JcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZXJyQ29kZSlcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgdGhyb3cgZXJyXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBUbyBjaGVjayBpZiBhIGJ1Y2tldCBhbHJlYWR5IGV4aXN0cy5cclxuICAgKi9cclxuICBhc3luYyBidWNrZXRFeGlzdHMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSlcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgIGlmIChlcnIuY29kZSA9PT0gJ05vU3VjaEJ1Y2tldCcgfHwgZXJyLmNvZGUgPT09ICdOb3RGb3VuZCcpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2VcclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBlcnJcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdHJ1ZVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cclxuXHJcbiAgLyoqXHJcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHByb21pc2Ugc3R5bGUgQVBJXHJcbiAgICovXHJcbiAgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXHJcblxyXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0sICcnLCBbMjA0XSlcclxuICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBvYmplY3QgY29udGVudC5cclxuICAgKi9cclxuICBhc3luYyBnZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTxzdHJlYW0uUmVhZGFibGU+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgMCwgMCwgZ2V0T3B0cylcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgcGFydGlhbCBvYmplY3QgY29udGVudC5cclxuICAgKiBAcGFyYW0gYnVja2V0TmFtZVxyXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lXHJcbiAgICogQHBhcmFtIG9mZnNldFxyXG4gICAqIEBwYXJhbSBsZW5ndGggLSBsZW5ndGggb2YgdGhlIG9iamVjdCB0aGF0IHdpbGwgYmUgcmVhZCBpbiB0aGUgc3RyZWFtIChvcHRpb25hbCwgaWYgbm90IHNwZWNpZmllZCB3ZSByZWFkIHRoZSByZXN0IG9mIHRoZSBmaWxlIGZyb20gdGhlIG9mZnNldClcclxuICAgKiBAcGFyYW0gZ2V0T3B0c1xyXG4gICAqL1xyXG4gIGFzeW5jIGdldFBhcnRpYWxPYmplY3QoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBvZmZzZXQ6IG51bWJlcixcclxuICAgIGxlbmd0aCA9IDAsXHJcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyxcclxuICApOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc051bWJlcihvZmZzZXQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29mZnNldCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgIH1cclxuICAgIGlmICghaXNOdW1iZXIobGVuZ3RoKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsZW5ndGggc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHJhbmdlID0gJydcclxuICAgIGlmIChvZmZzZXQgfHwgbGVuZ3RoKSB7XHJcbiAgICAgIGlmIChvZmZzZXQpIHtcclxuICAgICAgICByYW5nZSA9IGBieXRlcz0keytvZmZzZXR9LWBcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByYW5nZSA9ICdieXRlcz0wLSdcclxuICAgICAgICBvZmZzZXQgPSAwXHJcbiAgICAgIH1cclxuICAgICAgaWYgKGxlbmd0aCkge1xyXG4gICAgICAgIHJhbmdlICs9IGAkeytsZW5ndGggKyBvZmZzZXQgLSAxfWBcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBxdWVyeSA9ICcnXHJcbiAgICBsZXQgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7XHJcbiAgICAgIC4uLihyYW5nZSAhPT0gJycgJiYgeyByYW5nZSB9KSxcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZ2V0T3B0cykge1xyXG4gICAgICBjb25zdCBzc2VIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xyXG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtICYmIHtcclxuICAgICAgICAgICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUFsZ29yaXRobSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgJiYgeyAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXknOiBnZXRPcHRzLlNTRUN1c3RvbWVyS2V5IH0pLFxyXG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyS2V5TUQ1ICYmIHtcclxuICAgICAgICAgICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUtleS1NRDUnOiBnZXRPcHRzLlNTRUN1c3RvbWVyS2V5TUQ1LFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9XHJcbiAgICAgIHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KGdldE9wdHMpXHJcbiAgICAgIGhlYWRlcnMgPSB7XHJcbiAgICAgICAgLi4ucHJlcGVuZFhBTVpNZXRhKHNzZUhlYWRlcnMpLFxyXG4gICAgICAgIC4uLmhlYWRlcnMsXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cclxuICAgIGlmIChyYW5nZSkge1xyXG4gICAgICBleHBlY3RlZFN0YXR1c0NvZGVzLnB1c2goMjA2KVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuXHJcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgZXhwZWN0ZWRTdGF0dXNDb2RlcylcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIGRvd25sb2FkIG9iamVjdCBjb250ZW50IHRvIGEgZmlsZS5cclxuICAgKiBUaGlzIG1ldGhvZCB3aWxsIGNyZWF0ZSBhIHRlbXAgZmlsZSBuYW1lZCBgJHtmaWxlbmFtZX0uJHtiYXNlNjQoZXRhZyl9LnBhcnQubWluaW9gIHdoZW4gZG93bmxvYWRpbmcuXHJcbiAgICpcclxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIG5hbWUgb2YgdGhlIGJ1Y2tldFxyXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gbmFtZSBvZiB0aGUgb2JqZWN0XHJcbiAgICogQHBhcmFtIGZpbGVQYXRoIC0gcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXHJcbiAgICogQHBhcmFtIGdldE9wdHMgLSBPcHRpb25hbCBvYmplY3QgZ2V0IG9wdGlvblxyXG4gICAqL1xyXG4gIGFzeW5jIGZHZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAvLyBJbnB1dCB2YWxpZGF0aW9uLlxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhmaWxlUGF0aCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZG93bmxvYWRUb1RtcEZpbGUgPSBhc3luYyAoKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcclxuICAgICAgbGV0IHBhcnRGaWxlU3RyZWFtOiBzdHJlYW0uV3JpdGFibGVcclxuICAgICAgY29uc3Qgb2JqU3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzKVxyXG4gICAgICBjb25zdCBlbmNvZGVkRXRhZyA9IEJ1ZmZlci5mcm9tKG9ialN0YXQuZXRhZykudG9TdHJpbmcoJ2Jhc2U2NCcpXHJcbiAgICAgIGNvbnN0IHBhcnRGaWxlID0gYCR7ZmlsZVBhdGh9LiR7ZW5jb2RlZEV0YWd9LnBhcnQubWluaW9gXHJcblxyXG4gICAgICBhd2FpdCBmc3AubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSlcclxuXHJcbiAgICAgIGxldCBvZmZzZXQgPSAwXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcclxuICAgICAgICBpZiAob2JqU3RhdC5zaXplID09PSBzdGF0cy5zaXplKSB7XHJcbiAgICAgICAgICByZXR1cm4gcGFydEZpbGVcclxuICAgICAgICB9XHJcbiAgICAgICAgb2Zmc2V0ID0gc3RhdHMuc2l6ZVxyXG4gICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICdhJyB9KVxyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBFcnJvciAmJiAoZSBhcyB1bmtub3duIGFzIHsgY29kZTogc3RyaW5nIH0pLmNvZGUgPT09ICdFTk9FTlQnKSB7XHJcbiAgICAgICAgICAvLyBmaWxlIG5vdCBleGlzdFxyXG4gICAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ3cnIH0pXHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIC8vIG90aGVyIGVycm9yLCBtYXliZSBhY2Nlc3MgZGVueVxyXG4gICAgICAgICAgdGhyb3cgZVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZG93bmxvYWRTdHJlYW0gPSBhd2FpdCB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgb2Zmc2V0LCAwLCBnZXRPcHRzKVxyXG5cclxuICAgICAgYXdhaXQgc3RyZWFtUHJvbWlzZS5waXBlbGluZShkb3dubG9hZFN0cmVhbSwgcGFydEZpbGVTdHJlYW0pXHJcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnNwLnN0YXQocGFydEZpbGUpXHJcbiAgICAgIGlmIChzdGF0cy5zaXplID09PSBvYmpTdGF0LnNpemUpIHtcclxuICAgICAgICByZXR1cm4gcGFydEZpbGVcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTaXplIG1pc21hdGNoIGJldHdlZW4gZG93bmxvYWRlZCBmaWxlIGFuZCB0aGUgb2JqZWN0JylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXJ0RmlsZSA9IGF3YWl0IGRvd25sb2FkVG9UbXBGaWxlKClcclxuICAgIGF3YWl0IGZzcC5yZW5hbWUocGFydEZpbGUsIGZpbGVQYXRoKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RhdCBpbmZvcm1hdGlvbiBvZiB0aGUgb2JqZWN0LlxyXG4gICAqL1xyXG4gIGFzeW5jIHN0YXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHN0YXRPcHRzPzogU3RhdE9iamVjdE9wdHMpOiBQcm9taXNlPEJ1Y2tldEl0ZW1TdGF0PiB7XHJcbiAgICBjb25zdCBzdGF0T3B0RGVmID0gc3RhdE9wdHMgfHwge31cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzT2JqZWN0KHN0YXRPcHREZWYpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3N0YXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHN0YXRPcHREZWYpXHJcbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc2l6ZTogcGFyc2VJbnQocmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gYXMgc3RyaW5nKSxcclxuICAgICAgbWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXHJcbiAgICAgIGxhc3RNb2RpZmllZDogbmV3IERhdGUocmVzLmhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSBhcyBzdHJpbmcpLFxyXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXHJcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0cz86IFJlbW92ZU9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVtb3ZlT3B0cyAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG5cclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cclxuICAgIGlmIChyZW1vdmVPcHRzPy5nb3Zlcm5hbmNlQnlwYXNzKSB7XHJcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxyXG4gICAgfVxyXG4gICAgaWYgKHJlbW92ZU9wdHM/LmZvcmNlRGVsZXRlKSB7XHJcbiAgICAgIGhlYWRlcnNbJ3gtbWluaW8tZm9yY2UtZGVsZXRlJ10gPSB0cnVlXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcXVlcnlQYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxyXG4gICAgaWYgKHJlbW92ZU9wdHM/LnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeVBhcmFtcy52ZXJzaW9uSWQgPSBgJHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShxdWVyeVBhcmFtcylcclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcclxuICB9XHJcblxyXG4gIC8vIENhbGxzIGltcGxlbWVudGVkIGJlbG93IGFyZSByZWxhdGVkIHRvIG11bHRpcGFydC5cclxuXHJcbiAgbGlzdEluY29tcGxldGVVcGxvYWRzKFxyXG4gICAgYnVja2V0OiBzdHJpbmcsXHJcbiAgICBwcmVmaXg6IHN0cmluZyxcclxuICAgIHJlY3Vyc2l2ZTogYm9vbGVhbixcclxuICApOiBCdWNrZXRTdHJlYW08SW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbT4ge1xyXG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHByZWZpeCA9ICcnXHJcbiAgICB9XHJcbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXQpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxyXG4gICAgfVxyXG4gICAgY29uc3QgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcclxuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xyXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcclxuICAgIGNvbnN0IHVwbG9hZHM6IHVua25vd25bXSA9IFtdXHJcbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxyXG5cclxuICAgIC8vIFRPRE86IHJlZmFjdG9yIHRoaXMgd2l0aCBhc3luYy9hd2FpdCBhbmQgYHN0cmVhbS5SZWFkYWJsZS5mcm9tYFxyXG4gICAgY29uc3QgcmVhZFN0cmVhbSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXHJcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xyXG4gICAgICAvLyBwdXNoIG9uZSB1cGxvYWQgaW5mbyBwZXIgX3JlYWQoKVxyXG4gICAgICBpZiAodXBsb2Fkcy5sZW5ndGgpIHtcclxuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKHVwbG9hZHMuc2hpZnQoKSlcclxuICAgICAgfVxyXG4gICAgICBpZiAoZW5kZWQpIHtcclxuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXQsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKS50aGVuKFxyXG4gICAgICAgIChyZXN1bHQpID0+IHtcclxuICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgICAgIHJlc3VsdC5wcmVmaXhlcy5mb3JFYWNoKChwcmVmaXgpID0+IHVwbG9hZHMucHVzaChwcmVmaXgpKVxyXG4gICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyhcclxuICAgICAgICAgICAgcmVzdWx0LnVwbG9hZHMsXHJcbiAgICAgICAgICAgICh1cGxvYWQsIGNiKSA9PiB7XHJcbiAgICAgICAgICAgICAgLy8gZm9yIGVhY2ggaW5jb21wbGV0ZSB1cGxvYWQgYWRkIHRoZSBzaXplcyBvZiBpdHMgdXBsb2FkZWQgcGFydHNcclxuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAgICAgICAgIHRoaXMubGlzdFBhcnRzKGJ1Y2tldCwgdXBsb2FkLmtleSwgdXBsb2FkLnVwbG9hZElkKS50aGVuKFxyXG4gICAgICAgICAgICAgICAgKHBhcnRzOiBQYXJ0W10pID0+IHtcclxuICAgICAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgICAgICAgICAgICAgIHVwbG9hZC5zaXplID0gcGFydHMucmVkdWNlKChhY2MsIGl0ZW0pID0+IGFjYyArIGl0ZW0uc2l6ZSwgMClcclxuICAgICAgICAgICAgICAgICAgdXBsb2Fkcy5wdXNoKHVwbG9hZClcclxuICAgICAgICAgICAgICAgICAgY2IoKVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIChlcnI6IEVycm9yKSA9PiBjYihlcnIpLFxyXG4gICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgIGlmIChlcnIpIHtcclxuICAgICAgICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXHJcbiAgICAgICAgICAgICAgICByZXR1cm5cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xyXG4gICAgICAgICAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcclxuICAgICAgICAgICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxyXG4gICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBlbmRlZCA9IHRydWVcclxuICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgfSxcclxuICAgICAgICAoZSkgPT4ge1xyXG4gICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpXHJcbiAgICAgICAgfSxcclxuICAgICAgKVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENhbGxlZCBieSBsaXN0SW5jb21wbGV0ZVVwbG9hZHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBpbmNvbXBsZXRlIHVwbG9hZHMuXHJcbiAgICovXHJcbiAgYXN5bmMgbGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBwcmVmaXg6IHN0cmluZyxcclxuICAgIGtleU1hcmtlcjogc3RyaW5nLFxyXG4gICAgdXBsb2FkSWRNYXJrZXI6IHN0cmluZyxcclxuICAgIGRlbGltaXRlcjogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8TGlzdE11bHRpcGFydFJlc3VsdD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcoa2V5TWFya2VyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdrZXlNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkTWFya2VyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZE1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBjb25zdCBxdWVyaWVzID0gW11cclxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcclxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcclxuXHJcbiAgICBpZiAoa2V5TWFya2VyKSB7XHJcbiAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke3VyaUVzY2FwZShrZXlNYXJrZXIpfWApXHJcbiAgICB9XHJcbiAgICBpZiAodXBsb2FkSWRNYXJrZXIpIHtcclxuICAgICAgcXVlcmllcy5wdXNoKGB1cGxvYWQtaWQtbWFya2VyPSR7dXBsb2FkSWRNYXJrZXJ9YClcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtYXhVcGxvYWRzID0gMTAwMFxyXG4gICAgcXVlcmllcy5wdXNoKGBtYXgtdXBsb2Fkcz0ke21heFVwbG9hZHN9YClcclxuICAgIHF1ZXJpZXMuc29ydCgpXHJcbiAgICBxdWVyaWVzLnVuc2hpZnQoJ3VwbG9hZHMnKVxyXG4gICAgbGV0IHF1ZXJ5ID0gJydcclxuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RNdWx0aXBhcnQoYm9keSlcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEluaXRpYXRlIGEgbmV3IG11bHRpcGFydCB1cGxvYWQuXHJcbiAgICogQGludGVybmFsXHJcbiAgICovXHJcbiAgYXN5bmMgaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNPYmplY3QoaGVhZGVycykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKCdjb250ZW50VHlwZSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAndXBsb2FkcydcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSlcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxyXG4gICAgcmV0dXJuIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIGFib3J0IGEgbXVsdGlwYXJ0IHVwbG9hZCByZXF1ZXN0IGluIGNhc2Ugb2YgYW55IGVycm9ycy5cclxuICAgKlxyXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gQnVja2V0IE5hbWVcclxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIE9iamVjdCBOYW1lXHJcbiAgICogQHBhcmFtIHVwbG9hZElkIC0gaWQgb2YgYSBtdWx0aXBhcnQgdXBsb2FkIHRvIGNhbmNlbCBkdXJpbmcgY29tcG9zZSBvYmplY3Qgc2VxdWVuY2UuXHJcbiAgICovXHJcbiAgYXN5bmMgYWJvcnRNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXHJcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElkfWBcclxuXHJcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lOiBvYmplY3ROYW1lLCBxdWVyeSB9XHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwNF0pXHJcbiAgfVxyXG5cclxuICBhc3luYyBmaW5kVXBsb2FkSWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBsYXRlc3RVcGxvYWQ6IExpc3RNdWx0aXBhcnRSZXN1bHRbJ3VwbG9hZHMnXVtudW1iZXJdIHwgdW5kZWZpbmVkXHJcbiAgICBsZXQga2V5TWFya2VyID0gJydcclxuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXHJcbiAgICBmb3IgKDs7KSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgJycpXHJcbiAgICAgIGZvciAoY29uc3QgdXBsb2FkIG9mIHJlc3VsdC51cGxvYWRzKSB7XHJcbiAgICAgICAgaWYgKHVwbG9hZC5rZXkgPT09IG9iamVjdE5hbWUpIHtcclxuICAgICAgICAgIGlmICghbGF0ZXN0VXBsb2FkIHx8IHVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpID4gbGF0ZXN0VXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICAgICAgbGF0ZXN0VXBsb2FkID0gdXBsb2FkXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcclxuICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxyXG4gICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxyXG4gICAgICAgIGNvbnRpbnVlXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJyZWFrXHJcbiAgICB9XHJcbiAgICByZXR1cm4gbGF0ZXN0VXBsb2FkPy51cGxvYWRJZFxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogdGhpcyBjYWxsIHdpbGwgYWdncmVnYXRlIHRoZSBwYXJ0cyBvbiB0aGUgc2VydmVyIGludG8gYSBzaW5nbGUgb2JqZWN0LlxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgdXBsb2FkSWQ6IHN0cmluZyxcclxuICAgIGV0YWdzOiB7XHJcbiAgICAgIHBhcnQ6IG51bWJlclxyXG4gICAgICBldGFnPzogc3RyaW5nXHJcbiAgICB9W10sXHJcbiAgKTogUHJvbWlzZTx7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChldGFncykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXRhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJBcnJheVwiJylcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXVwbG9hZElkKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXHJcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxyXG5cclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoKVxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3Qoe1xyXG4gICAgICBDb21wbGV0ZU11bHRpcGFydFVwbG9hZDoge1xyXG4gICAgICAgICQ6IHtcclxuICAgICAgICAgIHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIFBhcnQ6IGV0YWdzLm1hcCgoZXRhZykgPT4ge1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgUGFydE51bWJlcjogZXRhZy5wYXJ0LFxyXG4gICAgICAgICAgICBFVGFnOiBldGFnLmV0YWcsXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSksXHJcbiAgICAgIH0sXHJcbiAgICB9KVxyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxyXG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VDb21wbGV0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXHJcbiAgICBpZiAoIXJlc3VsdCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JVRzogZmFpbGVkIHRvIHBhcnNlIHNlcnZlciByZXNwb25zZScpXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJlc3VsdC5lcnJDb2RlKSB7XHJcbiAgICAgIC8vIE11bHRpcGFydCBDb21wbGV0ZSBBUEkgcmV0dXJucyBhbiBlcnJvciBYTUwgYWZ0ZXIgYSAyMDAgaHR0cCBzdGF0dXNcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5TM0Vycm9yKHJlc3VsdC5lcnJNZXNzYWdlKVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICBldGFnOiByZXN1bHQuZXRhZyBhcyBzdHJpbmcsXHJcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCBwYXJ0LWluZm8gb2YgYWxsIHBhcnRzIG9mIGFuIGluY29tcGxldGUgdXBsb2FkIHNwZWNpZmllZCBieSB1cGxvYWRJZC5cclxuICAgKi9cclxuICBwcm90ZWN0ZWQgYXN5bmMgbGlzdFBhcnRzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTxVcGxvYWRlZFBhcnRbXT4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIXVwbG9hZElkKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGFydHM6IFVwbG9hZGVkUGFydFtdID0gW11cclxuICAgIGxldCBtYXJrZXIgPSAwXHJcbiAgICBsZXQgcmVzdWx0XHJcbiAgICBkbyB7XHJcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIG1hcmtlcilcclxuICAgICAgbWFya2VyID0gcmVzdWx0Lm1hcmtlclxyXG4gICAgICBwYXJ0cy5wdXNoKC4uLnJlc3VsdC5wYXJ0cylcclxuICAgIH0gd2hpbGUgKHJlc3VsdC5pc1RydW5jYXRlZClcclxuXHJcbiAgICByZXR1cm4gcGFydHNcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENhbGxlZCBieSBsaXN0UGFydHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBwYXJ0LWluZm9cclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nLCBtYXJrZXI6IG51bWJlcikge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzTnVtYmVyKG1hcmtlcikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCF1cGxvYWRJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxyXG4gICAgaWYgKG1hcmtlcikge1xyXG4gICAgICBxdWVyeSArPSBgJnBhcnQtbnVtYmVyLW1hcmtlcj0ke21hcmtlcn1gXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdFBhcnRzKGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgbGlzdEJ1Y2tldHMoKTogUHJvbWlzZTxCdWNrZXRJdGVtRnJvbUxpc3RbXT4ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHJlZ2lvbkNvbmYgPSB0aGlzLnJlZ2lvbiB8fCBERUZBVUxUX1JFR0lPTlxyXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCB9LCAnJywgWzIwMF0sIHJlZ2lvbkNvbmYpXHJcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdEJ1Y2tldCh4bWxSZXN1bHQpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDYWxjdWxhdGUgcGFydCBzaXplIGdpdmVuIHRoZSBvYmplY3Qgc2l6ZS4gUGFydCBzaXplIHdpbGwgYmUgYXRsZWFzdCB0aGlzLnBhcnRTaXplXHJcbiAgICovXHJcbiAgY2FsY3VsYXRlUGFydFNpemUoc2l6ZTogbnVtYmVyKSB7XHJcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NpemUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoc2l6ZSA+IHRoaXMubWF4T2JqZWN0U2l6ZSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBzaXplIHNob3VsZCBub3QgYmUgbW9yZSB0aGFuICR7dGhpcy5tYXhPYmplY3RTaXplfWApXHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5vdmVyUmlkZVBhcnRTaXplKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnBhcnRTaXplXHJcbiAgICB9XHJcbiAgICBsZXQgcGFydFNpemUgPSB0aGlzLnBhcnRTaXplXHJcbiAgICBmb3IgKDs7KSB7XHJcbiAgICAgIC8vIHdoaWxlKHRydWUpIHsuLi59IHRocm93cyBsaW50aW5nIGVycm9yLlxyXG4gICAgICAvLyBJZiBwYXJ0U2l6ZSBpcyBiaWcgZW5vdWdoIHRvIGFjY29tb2RhdGUgdGhlIG9iamVjdCBzaXplLCB0aGVuIHVzZSBpdC5cclxuICAgICAgaWYgKHBhcnRTaXplICogMTAwMDAgPiBzaXplKSB7XHJcbiAgICAgICAgcmV0dXJuIHBhcnRTaXplXHJcbiAgICAgIH1cclxuICAgICAgLy8gVHJ5IHBhcnQgc2l6ZXMgYXMgNjRNQiwgODBNQiwgOTZNQiBldGMuXHJcbiAgICAgIHBhcnRTaXplICs9IDE2ICogMTAyNCAqIDEwMjRcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFVwbG9hZHMgdGhlIG9iamVjdCB1c2luZyBjb250ZW50cyBmcm9tIGEgZmlsZVxyXG4gICAqL1xyXG4gIGFzeW5jIGZQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmIChtZXRhRGF0YSAmJiAhaXNPYmplY3QobWV0YURhdGEpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ldGFEYXRhIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEluc2VydHMgY29ycmVjdCBgY29udGVudC10eXBlYCBhdHRyaWJ1dGUgYmFzZWQgb24gbWV0YURhdGEgYW5kIGZpbGVQYXRoXHJcbiAgICBtZXRhRGF0YSA9IGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhIHx8IHt9LCBmaWxlUGF0aClcclxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3Auc3RhdChmaWxlUGF0aClcclxuICAgIHJldHVybiBhd2FpdCB0aGlzLnB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKSwgc3RhdC5zaXplLCBtZXRhRGF0YSlcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqICBVcGxvYWRpbmcgYSBzdHJlYW0sIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIi5cclxuICAgKiAgSXQncyByZWNvbW1lbmRlZCB0byBwYXNzIGBzaXplYCBhcmd1bWVudCB3aXRoIHN0cmVhbS5cclxuICAgKi9cclxuICBhc3luYyBwdXRPYmplY3QoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlciB8IHN0cmluZyxcclxuICAgIHNpemU/OiBudW1iZXIsXHJcbiAgICBtZXRhRGF0YT86IEl0ZW1CdWNrZXRNZXRhZGF0YSxcclxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFdlJ2xsIG5lZWQgdG8gc2hpZnQgYXJndW1lbnRzIHRvIHRoZSBsZWZ0IGJlY2F1c2Ugb2YgbWV0YURhdGFcclxuICAgIC8vIGFuZCBzaXplIGJlaW5nIG9wdGlvbmFsLlxyXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XHJcbiAgICAgIG1ldGFEYXRhID0gc2l6ZVxyXG4gICAgfVxyXG4gICAgLy8gRW5zdXJlcyBNZXRhZGF0YSBoYXMgYXBwcm9wcmlhdGUgcHJlZml4IGZvciBBMyBBUElcclxuICAgIGNvbnN0IGhlYWRlcnMgPSBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGEpXHJcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgc3RyZWFtIGluc3RhbmNlb2YgQnVmZmVyKSB7XHJcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cclxuICAgICAgc2l6ZSA9IHN0cmVhbS5sZW5ndGhcclxuICAgICAgc3RyZWFtID0gcmVhZGFibGVTdHJlYW0oc3RyZWFtKVxyXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3RoaXJkIGFyZ3VtZW50IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyZWFtLlJlYWRhYmxlXCIgb3IgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiJylcclxuICAgIH1cclxuXHJcbiAgICBpZiAoaXNOdW1iZXIoc2l6ZSkgJiYgc2l6ZSA8IDApIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2l6ZSBjYW5ub3QgYmUgbmVnYXRpdmUsIGdpdmVuIHNpemU6ICR7c2l6ZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEdldCB0aGUgcGFydCBzaXplIGFuZCBmb3J3YXJkIHRoYXQgdG8gdGhlIEJsb2NrU3RyZWFtLiBEZWZhdWx0IHRvIHRoZVxyXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cclxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcclxuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEdldCB0aGUgcGFydCBzaXplIGFuZCBmb3J3YXJkIHRoYXQgdG8gdGhlIEJsb2NrU3RyZWFtLiBEZWZhdWx0IHRvIHRoZVxyXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cclxuICAgIGlmIChzaXplID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgY29uc3Qgc3RhdFNpemUgPSBhd2FpdCBnZXRDb250ZW50TGVuZ3RoKHN0cmVhbSlcclxuICAgICAgaWYgKHN0YXRTaXplICE9PSBudWxsKSB7XHJcbiAgICAgICAgc2l6ZSA9IHN0YXRTaXplXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XHJcbiAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcclxuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxyXG4gICAgfVxyXG4gICAgaWYgKHNpemUgPT09IDApIHtcclxuICAgICAgcmV0dXJuIHRoaXMudXBsb2FkQnVmZmVyKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIEJ1ZmZlci5mcm9tKCcnKSlcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXJ0U2l6ZSA9IHRoaXMuY2FsY3VsYXRlUGFydFNpemUoc2l6ZSlcclxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBCdWZmZXIuaXNCdWZmZXIoc3RyZWFtKSB8fCBzaXplIDw9IHBhcnRTaXplKSB7XHJcbiAgICAgIGNvbnN0IGJ1ZiA9IGlzUmVhZGFibGVTdHJlYW0oc3RyZWFtKSA/IGF3YWl0IHJlYWRBc0J1ZmZlcihzdHJlYW0pIDogQnVmZmVyLmZyb20oc3RyZWFtKVxyXG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRCdWZmZXIoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgYnVmKVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0aGlzLnVwbG9hZFN0cmVhbShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBzdHJlYW0sIHBhcnRTaXplKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogbWV0aG9kIHRvIHVwbG9hZCBidWZmZXIgaW4gb25lIGNhbGxcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkQnVmZmVyKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXHJcbiAgICBidWY6IEJ1ZmZlcixcclxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xyXG4gICAgY29uc3QgeyBtZDVzdW0sIHNoYTI1NnN1bSB9ID0gaGFzaEJpbmFyeShidWYsIHRoaXMuZW5hYmxlU0hBMjU2KVxyXG4gICAgaGVhZGVyc1snQ29udGVudC1MZW5ndGgnXSA9IGJ1Zi5sZW5ndGhcclxuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcclxuICAgICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IG1kNXN1bVxyXG4gICAgfVxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxyXG4gICAgICB7XHJcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcclxuICAgICAgICBidWNrZXROYW1lLFxyXG4gICAgICAgIG9iamVjdE5hbWUsXHJcbiAgICAgICAgaGVhZGVycyxcclxuICAgICAgfSxcclxuICAgICAgYnVmLFxyXG4gICAgICBzaGEyNTZzdW0sXHJcbiAgICAgIFsyMDBdLFxyXG4gICAgICAnJyxcclxuICAgIClcclxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxyXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiB1cGxvYWQgc3RyZWFtIHdpdGggTXVsdGlwYXJ0VXBsb2FkXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIHVwbG9hZFN0cmVhbShcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxyXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlLFxyXG4gICAgcGFydFNpemU6IG51bWJlcixcclxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xyXG4gICAgLy8gQSBtYXAgb2YgdGhlIHByZXZpb3VzbHkgdXBsb2FkZWQgY2h1bmtzLCBmb3IgcmVzdW1pbmcgYSBmaWxlIHVwbG9hZC4gVGhpc1xyXG4gICAgLy8gd2lsbCBiZSBudWxsIGlmIHdlIGFyZW4ndCByZXN1bWluZyBhbiB1cGxvYWQuXHJcbiAgICBjb25zdCBvbGRQYXJ0czogUmVjb3JkPG51bWJlciwgUGFydD4gPSB7fVxyXG5cclxuICAgIC8vIEtlZXAgdHJhY2sgb2YgdGhlIGV0YWdzIGZvciBhZ2dyZWdhdGluZyB0aGUgY2h1bmtzIHRvZ2V0aGVyIGxhdGVyLiBFYWNoXHJcbiAgICAvLyBldGFnIHJlcHJlc2VudHMgYSBzaW5nbGUgY2h1bmsgb2YgdGhlIGZpbGUuXHJcbiAgICBjb25zdCBlVGFnczogUGFydFtdID0gW11cclxuXHJcbiAgICBjb25zdCBwcmV2aW91c1VwbG9hZElkID0gYXdhaXQgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcclxuICAgIGxldCB1cGxvYWRJZDogc3RyaW5nXHJcbiAgICBpZiAoIXByZXZpb3VzVXBsb2FkSWQpIHtcclxuICAgICAgdXBsb2FkSWQgPSBhd2FpdCB0aGlzLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMpXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB1cGxvYWRJZCA9IHByZXZpb3VzVXBsb2FkSWRcclxuICAgICAgY29uc3Qgb2xkVGFncyA9IGF3YWl0IHRoaXMubGlzdFBhcnRzKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHByZXZpb3VzVXBsb2FkSWQpXHJcbiAgICAgIG9sZFRhZ3MuZm9yRWFjaCgoZSkgPT4ge1xyXG4gICAgICAgIG9sZFBhcnRzW2UucGFydF0gPSBlXHJcbiAgICAgIH0pXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2h1bmtpZXIgPSBuZXcgQmxvY2tTdHJlYW0yKHsgc2l6ZTogcGFydFNpemUsIHplcm9QYWRkaW5nOiBmYWxzZSB9KVxyXG5cclxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tdW51c2VkLXZhcnNcclxuICAgIGNvbnN0IFtfLCBvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgICAgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGJvZHkucGlwZShjaHVua2llcikub24oJ2Vycm9yJywgcmVqZWN0KVxyXG4gICAgICAgIGNodW5raWVyLm9uKCdlbmQnLCByZXNvbHZlKS5vbignZXJyb3InLCByZWplY3QpXHJcbiAgICAgIH0pLFxyXG4gICAgICAoYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGxldCBwYXJ0TnVtYmVyID0gMVxyXG5cclxuICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIGNodW5raWVyKSB7XHJcbiAgICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxyXG5cclxuICAgICAgICAgIGNvbnN0IG9sZFBhcnQgPSBvbGRQYXJ0c1twYXJ0TnVtYmVyXVxyXG4gICAgICAgICAgaWYgKG9sZFBhcnQpIHtcclxuICAgICAgICAgICAgaWYgKG9sZFBhcnQuZXRhZyA9PT0gbWQ1LnRvU3RyaW5nKCdoZXgnKSkge1xyXG4gICAgICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnOiBvbGRQYXJ0LmV0YWcgfSlcclxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyKytcclxuICAgICAgICAgICAgICBjb250aW51ZVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgcGFydE51bWJlcisrXHJcblxyXG4gICAgICAgICAgLy8gbm93IHN0YXJ0IHRvIHVwbG9hZCBtaXNzaW5nIHBhcnRcclxuICAgICAgICAgIGNvbnN0IG9wdGlvbnM6IFJlcXVlc3RPcHRpb24gPSB7XHJcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXHJcbiAgICAgICAgICAgIHF1ZXJ5OiBxcy5zdHJpbmdpZnkoeyBwYXJ0TnVtYmVyLCB1cGxvYWRJZCB9KSxcclxuICAgICAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgICAgICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCxcclxuICAgICAgICAgICAgICAnQ29udGVudC1NRDUnOiBtZDUudG9TdHJpbmcoJ2Jhc2U2NCcpLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBidWNrZXROYW1lLFxyXG4gICAgICAgICAgICBvYmplY3ROYW1lLFxyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChvcHRpb25zLCBjaHVuaylcclxuXHJcbiAgICAgICAgICBsZXQgZXRhZyA9IHJlc3BvbnNlLmhlYWRlcnMuZXRhZ1xyXG4gICAgICAgICAgaWYgKGV0YWcpIHtcclxuICAgICAgICAgICAgZXRhZyA9IGV0YWcucmVwbGFjZSgvXlwiLywgJycpLnJlcGxhY2UoL1wiJC8sICcnKVxyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgZXRhZyA9ICcnXHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWcgfSlcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElkLCBlVGFncylcclxuICAgICAgfSkoKSxcclxuICAgIF0pXHJcblxyXG4gICAgcmV0dXJuIG9cclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cclxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxyXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0sICcnKVxyXG4gIH1cclxuXHJcbiAgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogdm9pZFxyXG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IFByb21pc2U8dm9pZD5cclxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNPYmplY3QocmVwbGljYXRpb25Db25maWcpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlcGxpY2F0aW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1JvbGUgY2Fubm90IGJlIGVtcHR5JylcclxuICAgICAgfSBlbHNlIGlmIChyZXBsaWNhdGlvbkNvbmZpZy5yb2xlICYmICFpc1N0cmluZyhyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIHJvbGUnLCByZXBsaWNhdGlvbkNvbmZpZy5yb2xlKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucnVsZXMpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWluaW11bSBvbmUgcmVwbGljYXRpb24gcnVsZSBtdXN0IGJlIHNwZWNpZmllZCcpXHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxyXG5cclxuICAgIGNvbnN0IHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnID0ge1xyXG4gICAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcclxuICAgICAgICBSb2xlOiByZXBsaWNhdGlvbkNvbmZpZy5yb2xlLFxyXG4gICAgICAgIFJ1bGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzLFxyXG4gICAgICB9LFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcclxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnKVxyXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxyXG4gIH1cclxuXHJcbiAgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxyXG4gIGFzeW5jIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8UmVwbGljYXRpb25Db25maWc+XHJcbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXHJcblxyXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXHJcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlUmVwbGljYXRpb25Db25maWcoeG1sUmVzdWx0KVxyXG4gIH1cclxuXHJcbiAgZ2V0T2JqZWN0TGVnYWxIb2xkKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXHJcbiAgICBjYWxsYmFjaz86IFJlc3VsdENhbGxiYWNrPExFR0FMX0hPTERfU1RBVFVTPixcclxuICApOiBQcm9taXNlPExFR0FMX0hPTERfU1RBVFVTPlxyXG4gIGFzeW5jIGdldE9iamVjdExlZ2FsSG9sZChcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxyXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZ2V0T3B0cykge1xyXG4gICAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcclxuICAgICAgfSBlbHNlIGlmIChPYmplY3Qua2V5cyhnZXRPcHRzKS5sZW5ndGggPiAwICYmIGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcclxuXHJcbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSlcclxuICAgIGNvbnN0IHN0clJlcyA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxyXG4gICAgcmV0dXJuIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnKHN0clJlcylcclxuICB9XHJcblxyXG4gIHNldE9iamVjdExlZ2FsSG9sZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc2V0T3B0cz86IFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMpOiB2b2lkXHJcbiAgYXN5bmMgc2V0T2JqZWN0TGVnYWxIb2xkKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgc2V0T3B0cyA9IHtcclxuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxyXG4gICAgfSBhcyBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNPYmplY3Qoc2V0T3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGlmICghW0xFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsIExFR0FMX0hPTERfU1RBVFVTLkRJU0FCTEVEXS5pbmNsdWRlcyhzZXRPcHRzPy5zdGF0dXMpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzdGF0dXM6ICcgKyBzZXRPcHRzLnN0YXR1cylcclxuICAgICAgfVxyXG4gICAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQgJiYgIXNldE9wdHMudmVyc2lvbklkLmxlbmd0aCkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicgKyBzZXRPcHRzLnZlcnNpb25JZClcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcclxuXHJcbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcclxuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtzZXRPcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29uZmlnID0ge1xyXG4gICAgICBTdGF0dXM6IHNldE9wdHMuc3RhdHVzLFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ0xlZ2FsSG9sZCcsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxyXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XHJcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IFRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgQnVja2V0XHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFRhZ1tdPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXHJcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMpXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiAgR2V0IHRoZSB0YWdzIGFzc29jaWF0ZWQgd2l0aCBhIGJ1Y2tldCBPUiBhbiBvYmplY3RcclxuICAgKi9cclxuICBhc3luYyBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyk6IFByb21pc2U8VGFnW10+IHtcclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcclxuXHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZ2V0T3B0cyAmJiBnZXRPcHRzLnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XHJcbiAgICBpZiAob2JqZWN0TmFtZSkge1xyXG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogIFNldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXHJcbiAgICovXHJcbiAgYXN5bmMgc2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcocG9saWN5KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXRQb2xpY3lFcnJvcihgSW52YWxpZCBidWNrZXQgcG9saWN5OiAke3BvbGljeX0gLSBtdXN0IGJlIFwic3RyaW5nXCJgKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcclxuXHJcbiAgICBsZXQgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGlmIChwb2xpY3kpIHtcclxuICAgICAgbWV0aG9kID0gJ1BVVCdcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwb2xpY3ksIFsyMDRdLCAnJylcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcclxuICAgIHJldHVybiBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHV0T2JqZWN0UmV0ZW50aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZXRlbnRpb25PcHRzOiBSZXRlbnRpb24gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChyZXRlbnRpb25PcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXRlbnRpb25PcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcyAmJiAhaXNCb29sZWFuKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciBnb3Zlcm5hbmNlQnlwYXNzOiAke3JldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzc31gKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChcclxuICAgICAgICByZXRlbnRpb25PcHRzLm1vZGUgJiZcclxuICAgICAgICAhW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV0uaW5jbHVkZXMocmV0ZW50aW9uT3B0cy5tb2RlKVxyXG4gICAgICApIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIG9iamVjdCByZXRlbnRpb24gbW9kZTogJHtyZXRlbnRpb25PcHRzLm1vZGV9YClcclxuICAgICAgfVxyXG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUgJiYgIWlzU3RyaW5nKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZTogJHtyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZX1gKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkOiAke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWApXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcclxuXHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XHJcbiAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSB7XHJcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ1JldGVudGlvbicsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxyXG4gICAgY29uc3QgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cclxuXHJcbiAgICBpZiAocmV0ZW50aW9uT3B0cy5tb2RlKSB7XHJcbiAgICAgIHBhcmFtcy5Nb2RlID0gcmV0ZW50aW9uT3B0cy5tb2RlXHJcbiAgICB9XHJcbiAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpIHtcclxuICAgICAgcGFyYW1zLlJldGFpblVudGlsRGF0ZSA9IHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlXHJcbiAgICB9XHJcbiAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpIHtcclxuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtyZXRlbnRpb25PcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocGFyYW1zKVxyXG5cclxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMCwgMjA0XSlcclxuICB9XHJcblxyXG4gIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogUmVzdWx0Q2FsbGJhY2s8T2JqZWN0TG9ja0luZm8+KTogdm9pZFxyXG4gIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxyXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxPYmplY3RMb2NrSW5mbz5cclxuICBhc3luYyBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xyXG5cclxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXHJcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWxSZXN1bHQpXHJcbiAgfVxyXG5cclxuICBzZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+KTogdm9pZFxyXG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4sXHJcbiAgKTogUHJvbWlzZTx2b2lkPlxyXG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pIHtcclxuICAgIGNvbnN0IHJldGVudGlvbk1vZGVzID0gW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV1cclxuICAgIGNvbnN0IHZhbGlkVW5pdHMgPSBbUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMsIFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSU11cclxuXHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxvY2tDb25maWdPcHRzLm1vZGUgJiYgIXJldGVudGlvbk1vZGVzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLm1vZGUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXHJcbiAgICB9XHJcbiAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCAmJiAhdmFsaWRVbml0cy5pbmNsdWRlcyhsb2NrQ29uZmlnT3B0cy51bml0KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXHJcbiAgICB9XHJcbiAgICBpZiAobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkgJiYgIWlzTnVtYmVyKGxvY2tDb25maWdPcHRzLnZhbGlkaXR5KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcclxuXHJcbiAgICBjb25zdCBjb25maWc6IE9iamVjdExvY2tDb25maWdQYXJhbSA9IHtcclxuICAgICAgT2JqZWN0TG9ja0VuYWJsZWQ6ICdFbmFibGVkJyxcclxuICAgIH1cclxuICAgIGNvbnN0IGNvbmZpZ0tleXMgPSBPYmplY3Qua2V5cyhsb2NrQ29uZmlnT3B0cylcclxuXHJcbiAgICBjb25zdCBpc0FsbEtleXNTZXQgPSBbJ3VuaXQnLCAnbW9kZScsICd2YWxpZGl0eSddLmV2ZXJ5KChsY2spID0+IGNvbmZpZ0tleXMuaW5jbHVkZXMobGNrKSlcclxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxyXG4gICAgaWYgKGNvbmZpZ0tleXMubGVuZ3RoID4gMCkge1xyXG4gICAgICBpZiAoIWlzQWxsS2V5c1NldCkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXHJcbiAgICAgICAgICBgbG9ja0NvbmZpZ09wdHMubW9kZSxsb2NrQ29uZmlnT3B0cy51bml0LGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IGFsbCB0aGUgcHJvcGVydGllcyBzaG91bGQgYmUgc3BlY2lmaWVkLmAsXHJcbiAgICAgICAgKVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbmZpZy5SdWxlID0ge1xyXG4gICAgICAgICAgRGVmYXVsdFJldGVudGlvbjoge30sXHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlKSB7XHJcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLk1vZGUgPSBsb2NrQ29uZmlnT3B0cy5tb2RlXHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ID09PSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUykge1xyXG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5EYXlzID0gbG9ja0NvbmZpZ09wdHMudmFsaWRpdHlcclxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xyXG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5ZZWFycyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XHJcbiAgICAgIHJvb3ROYW1lOiAnT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24nLFxyXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcclxuICAgICAgaGVhZGxlc3M6IHRydWUsXHJcbiAgICB9KVxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxyXG5cclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cclxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8QnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xyXG5cclxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXHJcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcclxuICAgIHJldHVybiBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWxSZXN1bHQpXHJcbiAgfVxyXG5cclxuICBhc3luYyBzZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdmVyc2lvbkNvbmZpZzogQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghT2JqZWN0LmtleXModmVyc2lvbkNvbmZpZykubGVuZ3RoKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXHJcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcclxuICAgICAgcm9vdE5hbWU6ICdWZXJzaW9uaW5nQ29uZmlndXJhdGlvbicsXHJcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxyXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcclxuICAgIH0pXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh2ZXJzaW9uQ29uZmlnKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNldFRhZ2dpbmcodGFnZ2luZ1BhcmFtczogUHV0VGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzIH0gPSB0YWdnaW5nUGFyYW1zXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXHJcblxyXG4gICAgaWYgKHB1dE9wdHMgJiYgcHV0T3B0cz8udmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3B1dE9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuICAgIGNvbnN0IHRhZ3NMaXN0ID0gW11cclxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XHJcbiAgICAgIHRhZ3NMaXN0LnB1c2goeyBLZXk6IGtleSwgVmFsdWU6IHZhbHVlIH0pXHJcbiAgICB9XHJcbiAgICBjb25zdCB0YWdnaW5nQ29uZmlnID0ge1xyXG4gICAgICBUYWdnaW5nOiB7XHJcbiAgICAgICAgVGFnU2V0OiB7XHJcbiAgICAgICAgICBUYWc6IHRhZ3NMaXN0LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9XHJcbiAgICBjb25zdCBoZWFkZXJzID0ge30gYXMgUmVxdWVzdEhlYWRlcnNcclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSwgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0gfSlcclxuICAgIGNvbnN0IHBheWxvYWRCdWYgPSBCdWZmZXIuZnJvbShidWlsZGVyLmJ1aWxkT2JqZWN0KHRhZ2dpbmdDb25maWcpKVxyXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7XHJcbiAgICAgIG1ldGhvZCxcclxuICAgICAgYnVja2V0TmFtZSxcclxuICAgICAgcXVlcnksXHJcbiAgICAgIGhlYWRlcnMsXHJcblxyXG4gICAgICAuLi4ob2JqZWN0TmFtZSAmJiB7IG9iamVjdE5hbWU6IG9iamVjdE5hbWUgfSksXHJcbiAgICB9XHJcblxyXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWRCdWYpXHJcblxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZEJ1ZilcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfTogUmVtb3ZlVGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xyXG5cclxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiByZW1vdmVPcHRzLnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9XHJcblxyXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcclxuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcclxuICAgIH1cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0pXHJcbiAgfVxyXG5cclxuICBhc3luYyBzZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdGFnczogVGFncyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHRhZ3MpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignbWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgdGFncyB9KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGF3YWl0IHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUgfSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHNldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHRhZ3M6IFRhZ3MsIHB1dE9wdHM/OiBUYWdnaW5nT3B0cykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNQbGFpbk9iamVjdCh0YWdzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZU9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFRhZ2dpbmdPcHRzKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cyB9KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2VsZWN0T2JqZWN0Q29udGVudChcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIHNlbGVjdE9wdHM6IFNlbGVjdE9wdGlvbnMsXHJcbiAgKTogUHJvbWlzZTxTZWxlY3RSZXN1bHRzIHwgdW5kZWZpbmVkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzKSkge1xyXG4gICAgICBpZiAoIWlzU3RyaW5nKHNlbGVjdE9wdHMuZXhwcmVzc2lvbikpIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghXy5pc0VtcHR5KHNlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uKSkge1xyXG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xyXG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3V0cHV0U2VyaWFsaXphdGlvbiBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3V0cHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbGlkIHNlbGVjdCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gYHNlbGVjdCZzZWxlY3QtdHlwZT0yYFxyXG5cclxuICAgIGNvbnN0IGNvbmZpZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSA9IFtcclxuICAgICAge1xyXG4gICAgICAgIEV4cHJlc3Npb246IHNlbGVjdE9wdHMuZXhwcmVzc2lvbixcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIEV4cHJlc3Npb25UeXBlOiBzZWxlY3RPcHRzLmV4cHJlc3Npb25UeXBlIHx8ICdTUUwnLFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgSW5wdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb25dLFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgT3V0cHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbl0sXHJcbiAgICAgIH0sXHJcbiAgICBdXHJcblxyXG4gICAgLy8gT3B0aW9uYWxcclxuICAgIGlmIChzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcykge1xyXG4gICAgICBjb25maWcucHVzaCh7IFJlcXVlc3RQcm9ncmVzczogc2VsZWN0T3B0cz8ucmVxdWVzdFByb2dyZXNzIH0pXHJcbiAgICB9XHJcbiAgICAvLyBPcHRpb25hbFxyXG4gICAgaWYgKHNlbGVjdE9wdHMuc2NhblJhbmdlKSB7XHJcbiAgICAgIGNvbmZpZy5wdXNoKHsgU2NhblJhbmdlOiBzZWxlY3RPcHRzLnNjYW5SYW5nZSB9KVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xyXG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcclxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXHJcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxyXG4gICAgfSlcclxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcclxuXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcclxuICAgIHJldHVybiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShib2R5KVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBhcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIHBvbGljeUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XHJcbiAgICAgIHJvb3ROYW1lOiAnTGlmZWN5Y2xlQ29uZmlndXJhdGlvbicsXHJcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxyXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcclxuICAgIH0pXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXHJcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIGxpZmVDeWNsZUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmIChfLmlzRW1wdHkobGlmZUN5Y2xlQ29uZmlnKSkge1xyXG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lKVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcpXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxMaWZlY3ljbGVDb25maWcgfCBudWxsPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaWZlY3ljbGVDb25maWcoYm9keSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHNldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBlbmNyeXB0aW9uQ29uZmlnPzogRW5jcnlwdGlvbkNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykgJiYgZW5jcnlwdGlvbkNvbmZpZy5SdWxlLmxlbmd0aCA+IDEpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCBSdWxlIGxlbmd0aC4gT25seSBvbmUgcnVsZSBpcyBhbGxvd2VkLjogJyArIGVuY3J5cHRpb25Db25maWcuUnVsZSlcclxuICAgIH1cclxuXHJcbiAgICBsZXQgZW5jcnlwdGlvbk9iaiA9IGVuY3J5cHRpb25Db25maWdcclxuICAgIGlmIChfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykpIHtcclxuICAgICAgZW5jcnlwdGlvbk9iaiA9IHtcclxuICAgICAgICAvLyBEZWZhdWx0IE1pbklPIFNlcnZlciBTdXBwb3J0ZWQgUnVsZVxyXG4gICAgICAgIFJ1bGU6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgQXBwbHlTZXJ2ZXJTaWRlRW5jcnlwdGlvbkJ5RGVmYXVsdDoge1xyXG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xyXG4gICAgICByb290TmFtZTogJ1NlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXHJcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxyXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcclxuICAgIH0pXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChlbmNyeXB0aW9uT2JqKVxyXG5cclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cclxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXHJcblxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWcoYm9keSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRPYmplY3RSZXRlbnRpb24oXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0UmV0ZW50aW9uT3B0cyxcclxuICApOiBQcm9taXNlPE9iamVjdFJldGVudGlvbkluZm8gfCBudWxsIHwgdW5kZWZpbmVkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH0gZWxzZSBpZiAoZ2V0T3B0cz8udmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xyXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoYm9keSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZU9iamVjdHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3RzTGlzdDogUmVtb3ZlT2JqZWN0c1BhcmFtKTogUHJvbWlzZTxSZW1vdmVPYmplY3RzUmVzcG9uc2VbXT4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9iamVjdHNMaXN0KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdvYmplY3RzTGlzdCBzaG91bGQgYmUgYSBsaXN0JylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBydW5EZWxldGVPYmplY3RzID0gYXN5bmMgKGJhdGNoOiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiA9PiB7XHJcbiAgICAgIGNvbnN0IGRlbE9iamVjdHM6IFJlbW92ZU9iamVjdHNSZXF1ZXN0RW50cnlbXSA9IGJhdGNoLm1hcCgodmFsdWUpID0+IHtcclxuICAgICAgICByZXR1cm4gaXNPYmplY3QodmFsdWUpID8geyBLZXk6IHZhbHVlLm5hbWUsIFZlcnNpb25JZDogdmFsdWUudmVyc2lvbklkIH0gOiB7IEtleTogdmFsdWUgfVxyXG4gICAgICB9KVxyXG5cclxuICAgICAgY29uc3QgcmVtT2JqZWN0cyA9IHsgRGVsZXRlOiB7IFF1aWV0OiB0cnVlLCBPYmplY3Q6IGRlbE9iamVjdHMgfSB9XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBCdWZmZXIuZnJvbShuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KS5idWlsZE9iamVjdChyZW1PYmplY3RzKSlcclxuICAgICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7ICdDb250ZW50LU1ENSc6IHRvTWQ1KHBheWxvYWQpIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZDogJ1BPU1QnLCBidWNrZXROYW1lLCBxdWVyeTogJ2RlbGV0ZScsIGhlYWRlcnMgfSwgcGF5bG9hZClcclxuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICAgIHJldHVybiB4bWxQYXJzZXJzLnJlbW92ZU9iamVjdHNQYXJzZXIoYm9keSlcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtYXhFbnRyaWVzID0gMTAwMCAvLyBtYXggZW50cmllcyBhY2NlcHRlZCBpbiBzZXJ2ZXIgZm9yIERlbGV0ZU11bHRpcGxlT2JqZWN0cyBBUEkuXHJcbiAgICAvLyBDbGllbnQgc2lkZSBiYXRjaGluZ1xyXG4gICAgY29uc3QgYmF0Y2hlcyA9IFtdXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9iamVjdHNMaXN0Lmxlbmd0aDsgaSArPSBtYXhFbnRyaWVzKSB7XHJcbiAgICAgIGJhdGNoZXMucHVzaChvYmplY3RzTGlzdC5zbGljZShpLCBpICsgbWF4RW50cmllcykpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hlcy5tYXAocnVuRGVsZXRlT2JqZWN0cykpXHJcbiAgICByZXR1cm4gYmF0Y2hSZXN1bHRzLmZsYXQoKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlSW5jb21wbGV0ZVVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLklzVmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgY29uc3QgcmVtb3ZlVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7cmVtb3ZlVXBsb2FkSWR9YFxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjb3B5T2JqZWN0VjEoXHJcbiAgICB0YXJnZXRCdWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgY29uZGl0aW9ucz86IG51bGwgfCBDb3B5Q29uZGl0aW9ucyxcclxuICApIHtcclxuICAgIGlmICh0eXBlb2YgY29uZGl0aW9ucyA9PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZSh0YXJnZXRCdWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyB0YXJnZXRCdWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZSh0YXJnZXRPYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7dGFyZ2V0T2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgPT09ICcnKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBFbXB0eSBzb3VyY2UgcHJlZml4YClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY29uZGl0aW9ucyAhPSBudWxsICYmICEoY29uZGl0aW9ucyBpbnN0YW5jZW9mIENvcHlDb25kaXRpb25zKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb25kaXRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwiQ29weUNvbmRpdGlvbnNcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxyXG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKVxyXG5cclxuICAgIGlmIChjb25kaXRpb25zKSB7XHJcbiAgICAgIGlmIChjb25kaXRpb25zLm1vZGlmaWVkICE9PSAnJykge1xyXG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLm1vZGlmaWVkXHJcbiAgICAgIH1cclxuICAgICAgaWYgKGNvbmRpdGlvbnMudW5tb2RpZmllZCAhPT0gJycpIHtcclxuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi11bm1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLnVubW9kaWZpZWRcclxuICAgICAgfVxyXG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWcgIT09ICcnKSB7XHJcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnXHJcbiAgICAgIH1cclxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0ICE9PSAnJykge1xyXG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW5vbmUtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7XHJcbiAgICAgIG1ldGhvZCxcclxuICAgICAgYnVja2V0TmFtZTogdGFyZ2V0QnVja2V0TmFtZSxcclxuICAgICAgb2JqZWN0TmFtZTogdGFyZ2V0T2JqZWN0TmFtZSxcclxuICAgICAgaGVhZGVycyxcclxuICAgIH0pXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlQ29weU9iamVjdChib2R5KVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjb3B5T2JqZWN0VjIoXHJcbiAgICBzb3VyY2VDb25maWc6IENvcHlTb3VyY2VPcHRpb25zLFxyXG4gICAgZGVzdENvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcclxuICApOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHRWMj4ge1xyXG4gICAgaWYgKCEoc291cmNlQ29uZmlnIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5U291cmNlT3B0aW9ucyAnKVxyXG4gICAgfVxyXG4gICAgaWYgKCEoZGVzdENvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxyXG4gICAgfVxyXG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcclxuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KClcclxuICAgIH1cclxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XHJcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5hc3NpZ24oe30sIHNvdXJjZUNvbmZpZy5nZXRIZWFkZXJzKCksIGRlc3RDb25maWcuZ2V0SGVhZGVycygpKVxyXG5cclxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBkZXN0Q29uZmlnLkJ1Y2tldFxyXG4gICAgY29uc3Qgb2JqZWN0TmFtZSA9IGRlc3RDb25maWcuT2JqZWN0XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMgfSlcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gICAgY29uc3QgY29weVJlcyA9IHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXHJcbiAgICBjb25zdCByZXNIZWFkZXJzOiBJbmNvbWluZ0h0dHBIZWFkZXJzID0gcmVzLmhlYWRlcnNcclxuXHJcbiAgICBjb25zdCBzaXplSGVhZGVyVmFsdWUgPSByZXNIZWFkZXJzICYmIHJlc0hlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ11cclxuICAgIGNvbnN0IHNpemUgPSB0eXBlb2Ygc2l6ZUhlYWRlclZhbHVlID09PSAnbnVtYmVyJyA/IHNpemVIZWFkZXJWYWx1ZSA6IHVuZGVmaW5lZFxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIEJ1Y2tldDogZGVzdENvbmZpZy5CdWNrZXQsXHJcbiAgICAgIEtleTogZGVzdENvbmZpZy5PYmplY3QsXHJcbiAgICAgIExhc3RNb2RpZmllZDogY29weVJlcy5sYXN0TW9kaWZpZWQsXHJcbiAgICAgIE1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXHJcbiAgICAgIFZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxyXG4gICAgICBTb3VyY2VWZXJzaW9uSWQ6IGdldFNvdXJjZVZlcnNpb25JZChyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgICAgRXRhZzogc2FuaXRpemVFVGFnKHJlc0hlYWRlcnMuZXRhZyksXHJcbiAgICAgIFNpemU6IHNpemUsXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjb3B5T2JqZWN0KHNvdXJjZTogQ29weVNvdXJjZU9wdGlvbnMsIGRlc3Q6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+XHJcbiAgYXN5bmMgY29weU9iamVjdChcclxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIHRhcmdldE9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBjb25kaXRpb25zPzogQ29weUNvbmRpdGlvbnMsXHJcbiAgKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxyXG4gIGFzeW5jIGNvcHlPYmplY3QoLi4uYWxsQXJnczogQ29weU9iamVjdFBhcmFtcyk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD4ge1xyXG4gICAgaWYgKHR5cGVvZiBhbGxBcmdzWzBdID09PSAnc3RyaW5nJykge1xyXG4gICAgICBjb25zdCBbdGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnNdID0gYWxsQXJncyBhcyBbXHJcbiAgICAgICAgc3RyaW5nLFxyXG4gICAgICAgIHN0cmluZyxcclxuICAgICAgICBzdHJpbmcsXHJcbiAgICAgICAgQ29weUNvbmRpdGlvbnM/LFxyXG4gICAgICBdXHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3RWMSh0YXJnZXRCdWNrZXROYW1lLCB0YXJnZXRPYmplY3ROYW1lLCBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSwgY29uZGl0aW9ucylcclxuICAgIH1cclxuICAgIGNvbnN0IFtzb3VyY2UsIGRlc3RdID0gYWxsQXJncyBhcyBbQ29weVNvdXJjZU9wdGlvbnMsIENvcHlEZXN0aW5hdGlvbk9wdGlvbnNdXHJcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjIoc291cmNlLCBkZXN0KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgdXBsb2FkUGFydChcclxuICAgIHBhcnRDb25maWc6IHtcclxuICAgICAgYnVja2V0TmFtZTogc3RyaW5nXHJcbiAgICAgIG9iamVjdE5hbWU6IHN0cmluZ1xyXG4gICAgICB1cGxvYWRJRDogc3RyaW5nXHJcbiAgICAgIHBhcnROdW1iZXI6IG51bWJlclxyXG4gICAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVyc1xyXG4gICAgfSxcclxuICAgIHBheWxvYWQ/OiBCaW5hcnksXHJcbiAgKSB7XHJcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElELCBwYXJ0TnVtYmVyLCBoZWFkZXJzIH0gPSBwYXJ0Q29uZmlnXHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSUR9JnBhcnROdW1iZXI9JHtwYXJ0TnVtYmVyfWBcclxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZClcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gICAgY29uc3QgcGFydFJlcyA9IHVwbG9hZFBhcnRQYXJzZXIoYm9keSlcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhwYXJ0UmVzLkVUYWcpLFxyXG4gICAgICBrZXk6IG9iamVjdE5hbWUsXHJcbiAgICAgIHBhcnQ6IHBhcnROdW1iZXIsXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjb21wb3NlT2JqZWN0KFxyXG4gICAgZGVzdE9iakNvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcclxuICAgIHNvdXJjZU9iakxpc3Q6IENvcHlTb3VyY2VPcHRpb25zW10sXHJcbiAgKTogUHJvbWlzZTxib29sZWFuIHwgeyBldGFnOiBzdHJpbmc7IHZlcnNpb25JZDogc3RyaW5nIHwgbnVsbCB9IHwgUHJvbWlzZTx2b2lkPiB8IENvcHlPYmplY3RSZXN1bHQ+IHtcclxuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcclxuXHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoc291cmNlT2JqTGlzdCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxyXG4gICAgfVxyXG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxyXG4gICAgICAgIGBcIlRoZXJlIG11c3QgYmUgYXMgbGVhc3Qgb25lIGFuZCB1cCB0byAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBzb3VyY2Ugb2JqZWN0cy5gLFxyXG4gICAgICApXHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGNvbnN0IHNPYmogPSBzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zXHJcbiAgICAgIGlmICghc09iai52YWxpZGF0ZSgpKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGFzIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpLnZhbGlkYXRlKCkpIHtcclxuICAgICAgcmV0dXJuIGZhbHNlXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZ2V0U3RhdE9wdGlvbnMgPSAoc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucykgPT4ge1xyXG4gICAgICBsZXQgc3RhdE9wdHMgPSB7fVxyXG4gICAgICBpZiAoIV8uaXNFbXB0eShzcmNDb25maWcuVmVyc2lvbklEKSkge1xyXG4gICAgICAgIHN0YXRPcHRzID0ge1xyXG4gICAgICAgICAgdmVyc2lvbklkOiBzcmNDb25maWcuVmVyc2lvbklELFxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gc3RhdE9wdHNcclxuICAgIH1cclxuICAgIGNvbnN0IHNyY09iamVjdFNpemVzOiBudW1iZXJbXSA9IFtdXHJcbiAgICBsZXQgdG90YWxTaXplID0gMFxyXG4gICAgbGV0IHRvdGFsUGFydHMgPSAwXHJcblxyXG4gICAgY29uc3Qgc291cmNlT2JqU3RhdHMgPSBzb3VyY2VPYmpMaXN0Lm1hcCgoc3JjSXRlbSkgPT5cclxuICAgICAgdGhpcy5zdGF0T2JqZWN0KHNyY0l0ZW0uQnVja2V0LCBzcmNJdGVtLk9iamVjdCwgZ2V0U3RhdE9wdGlvbnMoc3JjSXRlbSkpLFxyXG4gICAgKVxyXG5cclxuICAgIGNvbnN0IHNyY09iamVjdEluZm9zID0gYXdhaXQgUHJvbWlzZS5hbGwoc291cmNlT2JqU3RhdHMpXHJcblxyXG4gICAgY29uc3QgdmFsaWRhdGVkU3RhdHMgPSBzcmNPYmplY3RJbmZvcy5tYXAoKHJlc0l0ZW1TdGF0LCBpbmRleCkgPT4ge1xyXG4gICAgICBjb25zdCBzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zIHwgdW5kZWZpbmVkID0gc291cmNlT2JqTGlzdFtpbmRleF1cclxuXHJcbiAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcclxuICAgICAgLy8gQ2hlY2sgaWYgYSBzZWdtZW50IGlzIHNwZWNpZmllZCwgYW5kIGlmIHNvLCBpcyB0aGVcclxuICAgICAgLy8gc2VnbWVudCB3aXRoaW4gb2JqZWN0IGJvdW5kcz9cclxuICAgICAgaWYgKHNyY0NvbmZpZyAmJiBzcmNDb25maWcuTWF0Y2hSYW5nZSkge1xyXG4gICAgICAgIC8vIFNpbmNlIHJhbmdlIGlzIHNwZWNpZmllZCxcclxuICAgICAgICAvLyAgICAwIDw9IHNyYy5zcmNTdGFydCA8PSBzcmMuc3JjRW5kXHJcbiAgICAgICAgLy8gc28gb25seSBpbnZhbGlkIGNhc2UgdG8gY2hlY2sgaXM6XHJcbiAgICAgICAgY29uc3Qgc3JjU3RhcnQgPSBzcmNDb25maWcuU3RhcnRcclxuICAgICAgICBjb25zdCBzcmNFbmQgPSBzcmNDb25maWcuRW5kXHJcbiAgICAgICAgaWYgKHNyY0VuZCA+PSBzcmNDb3B5U2l6ZSB8fCBzcmNTdGFydCA8IDApIHtcclxuICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXHJcbiAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBoYXMgaW52YWxpZCBzZWdtZW50LXRvLWNvcHkgWyR7c3JjU3RhcnR9LCAke3NyY0VuZH1dIChzaXplIGlzICR7c3JjQ29weVNpemV9KWAsXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgfVxyXG4gICAgICAgIHNyY0NvcHlTaXplID0gc3JjRW5kIC0gc3JjU3RhcnQgKyAxXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIE9ubHkgdGhlIGxhc3Qgc291cmNlIG1heSBiZSBsZXNzIHRoYW4gYGFic01pblBhcnRTaXplYFxyXG4gICAgICBpZiAoc3JjQ29weVNpemUgPCBQQVJUX0NPTlNUUkFJTlRTLkFCU19NSU5fUEFSVF9TSVpFICYmIGluZGV4IDwgc291cmNlRmlsZXNMZW5ndGggLSAxKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBpcyB0b28gc21hbGwgKCR7c3JjQ29weVNpemV9KSBhbmQgaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuYCxcclxuICAgICAgICApXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XHJcbiAgICAgIHRvdGFsU2l6ZSArPSBzcmNDb3B5U2l6ZVxyXG4gICAgICBpZiAodG90YWxTaXplID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIHJlY29yZCBzb3VyY2Ugc2l6ZVxyXG4gICAgICBzcmNPYmplY3RTaXplc1tpbmRleF0gPSBzcmNDb3B5U2l6ZVxyXG5cclxuICAgICAgLy8gY2FsY3VsYXRlIHBhcnRzIG5lZWRlZCBmb3IgY3VycmVudCBzb3VyY2VcclxuICAgICAgdG90YWxQYXJ0cyArPSBwYXJ0c1JlcXVpcmVkKHNyY0NvcHlTaXplKVxyXG4gICAgICAvLyBEbyB3ZSBuZWVkIG1vcmUgcGFydHMgdGhhbiB3ZSBhcmUgYWxsb3dlZD9cclxuICAgICAgaWYgKHRvdGFsUGFydHMgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXHJcbiAgICAgICAgICBgWW91ciBwcm9wb3NlZCBjb21wb3NlIG9iamVjdCByZXF1aXJlcyBtb3JlIHRoYW4gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gcGFydHNgLFxyXG4gICAgICAgIClcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XHJcbiAgICB9KVxyXG5cclxuICAgIGlmICgodG90YWxQYXJ0cyA9PT0gMSAmJiB0b3RhbFNpemUgPD0gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVF9TSVpFKSB8fCB0b3RhbFNpemUgPT09IDApIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdChzb3VyY2VPYmpMaXN0WzBdIGFzIENvcHlTb3VyY2VPcHRpb25zLCBkZXN0T2JqQ29uZmlnKSAvLyB1c2UgY29weU9iamVjdFYyXHJcbiAgICB9XHJcblxyXG4gICAgLy8gcHJlc2VydmUgZXRhZyB0byBhdm9pZCBtb2RpZmljYXRpb24gb2Ygb2JqZWN0IHdoaWxlIGNvcHlpbmcuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcclxuICAgICAgOyhzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zKS5NYXRjaEVUYWcgPSAodmFsaWRhdGVkU3RhdHNbaV0gYXMgQnVja2V0SXRlbVN0YXQpLmV0YWdcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzcGxpdFBhcnRTaXplTGlzdCA9IHZhbGlkYXRlZFN0YXRzLm1hcCgocmVzSXRlbVN0YXQsIGlkeCkgPT4ge1xyXG4gICAgICByZXR1cm4gY2FsY3VsYXRlRXZlblNwbGl0cyhzcmNPYmplY3RTaXplc1tpZHhdIGFzIG51bWJlciwgc291cmNlT2JqTGlzdFtpZHhdIGFzIENvcHlTb3VyY2VPcHRpb25zKVxyXG4gICAgfSlcclxuXHJcbiAgICBjb25zdCBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCA9ICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XHJcbiAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWdMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10gPSBbXVxyXG5cclxuICAgICAgc3BsaXRQYXJ0U2l6ZUxpc3QuZm9yRWFjaCgoc3BsaXRTaXplLCBzcGxpdEluZGV4OiBudW1iZXIpID0+IHtcclxuICAgICAgICBpZiAoc3BsaXRTaXplKSB7XHJcbiAgICAgICAgICBjb25zdCB7IHN0YXJ0SW5kZXg6IHN0YXJ0SWR4LCBlbmRJbmRleDogZW5kSWR4LCBvYmpJbmZvOiBvYmpDb25maWcgfSA9IHNwbGl0U2l6ZVxyXG5cclxuICAgICAgICAgIGNvbnN0IHBhcnRJbmRleCA9IHNwbGl0SW5kZXggKyAxIC8vIHBhcnQgaW5kZXggc3RhcnRzIGZyb20gMS5cclxuICAgICAgICAgIGNvbnN0IHRvdGFsVXBsb2FkcyA9IEFycmF5LmZyb20oc3RhcnRJZHgpXHJcblxyXG4gICAgICAgICAgY29uc3QgaGVhZGVycyA9IChzb3VyY2VPYmpMaXN0W3NwbGl0SW5kZXhdIGFzIENvcHlTb3VyY2VPcHRpb25zKS5nZXRIZWFkZXJzKClcclxuXHJcbiAgICAgICAgICB0b3RhbFVwbG9hZHMuZm9yRWFjaCgoc3BsaXRTdGFydCwgdXBsZEN0cklkeCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBzcGxpdEVuZCA9IGVuZElkeFt1cGxkQ3RySWR4XVxyXG5cclxuICAgICAgICAgICAgY29uc3Qgc291cmNlT2JqID0gYCR7b2JqQ29uZmlnLkJ1Y2tldH0vJHtvYmpDb25maWcuT2JqZWN0fWBcclxuICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IGAke3NvdXJjZU9ian1gXHJcbiAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWcgPSB7XHJcbiAgICAgICAgICAgICAgYnVja2V0TmFtZTogZGVzdE9iakNvbmZpZy5CdWNrZXQsXHJcbiAgICAgICAgICAgICAgb2JqZWN0TmFtZTogZGVzdE9iakNvbmZpZy5PYmplY3QsXHJcbiAgICAgICAgICAgICAgdXBsb2FkSUQ6IHVwbG9hZElkLFxyXG4gICAgICAgICAgICAgIHBhcnROdW1iZXI6IHBhcnRJbmRleCxcclxuICAgICAgICAgICAgICBoZWFkZXJzOiBoZWFkZXJzLFxyXG4gICAgICAgICAgICAgIHNvdXJjZU9iajogc291cmNlT2JqLFxyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB1cGxvYWRQYXJ0Q29uZmlnTGlzdC5wdXNoKHVwbG9hZFBhcnRDb25maWcpXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuXHJcbiAgICAgIHJldHVybiB1cGxvYWRQYXJ0Q29uZmlnTGlzdFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHVwbG9hZEFsbFBhcnRzID0gYXN5bmMgKHVwbG9hZExpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSkgPT4ge1xyXG4gICAgICBjb25zdCBwYXJ0VXBsb2FkcyA9IHVwbG9hZExpc3QubWFwKGFzeW5jIChpdGVtKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMudXBsb2FkUGFydChpdGVtKVxyXG4gICAgICB9KVxyXG4gICAgICAvLyBQcm9jZXNzIHJlc3VsdHMgaGVyZSBpZiBuZWVkZWRcclxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHBhcnRVcGxvYWRzKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBlcmZvcm1VcGxvYWRQYXJ0cyA9IGFzeW5jICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XHJcbiAgICAgIGNvbnN0IHVwbG9hZExpc3QgPSBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCh1cGxvYWRJZClcclxuICAgICAgY29uc3QgcGFydHNSZXMgPSBhd2FpdCB1cGxvYWRBbGxQYXJ0cyh1cGxvYWRMaXN0KVxyXG4gICAgICByZXR1cm4gcGFydHNSZXMubWFwKChwYXJ0Q29weSkgPT4gKHsgZXRhZzogcGFydENvcHkuZXRhZywgcGFydDogcGFydENvcHkucGFydCB9KSlcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBuZXdVcGxvYWRIZWFkZXJzID0gZGVzdE9iakNvbmZpZy5nZXRIZWFkZXJzKClcclxuXHJcbiAgICBjb25zdCB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCBuZXdVcGxvYWRIZWFkZXJzKVxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGFydHNEb25lID0gYXdhaXQgcGVyZm9ybVVwbG9hZFBhcnRzKHVwbG9hZElkKVxyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkLCBwYXJ0c0RvbmUpXHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWJvcnRNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCB1cGxvYWRJZClcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByZXNpZ25lZFVybChcclxuICAgIG1ldGhvZDogc3RyaW5nLFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgZXhwaXJlcz86IG51bWJlciB8IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgdW5kZWZpbmVkLFxyXG4gICAgcmVxUGFyYW1zPzogUHJlU2lnblJlcXVlc3RQYXJhbXMgfCBEYXRlLFxyXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxyXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoYFByZXNpZ25lZCAke21ldGhvZH0gdXJsIGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0c2ApXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFleHBpcmVzKSB7XHJcbiAgICAgIGV4cGlyZXMgPSBQUkVTSUdOX0VYUElSWV9EQVlTX01BWFxyXG4gICAgfVxyXG4gICAgaWYgKCFyZXFQYXJhbXMpIHtcclxuICAgICAgcmVxUGFyYW1zID0ge31cclxuICAgIH1cclxuICAgIGlmICghcmVxdWVzdERhdGUpIHtcclxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXHJcbiAgICB9XHJcblxyXG4gICAgLy8gVHlwZSBhc3NlcnRpb25zXHJcbiAgICBpZiAoZXhwaXJlcyAmJiB0eXBlb2YgZXhwaXJlcyAhPT0gJ251bWJlcicpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXhwaXJlcyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgIH1cclxuICAgIGlmIChyZXFQYXJhbXMgJiYgdHlwZW9mIHJlcVBhcmFtcyAhPT0gJ29iamVjdCcpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxUGFyYW1zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgaWYgKChyZXF1ZXN0RGF0ZSAmJiAhKHJlcXVlc3REYXRlIGluc3RhbmNlb2YgRGF0ZSkpIHx8IChyZXF1ZXN0RGF0ZSAmJiBpc05hTihyZXF1ZXN0RGF0ZT8uZ2V0VGltZSgpKSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdERhdGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJEYXRlXCIgYW5kIHZhbGlkJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBxdWVyeSA9IHJlcVBhcmFtcyA/IHFzLnN0cmluZ2lmeShyZXFQYXJhbXMpIDogdW5kZWZpbmVkXHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxyXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcclxuICAgICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyBtZXRob2QsIHJlZ2lvbiwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcclxuXHJcbiAgICAgIHJldHVybiBwcmVzaWduU2lnbmF0dXJlVjQoXHJcbiAgICAgICAgcmVxT3B0aW9ucyxcclxuICAgICAgICB0aGlzLmFjY2Vzc0tleSxcclxuICAgICAgICB0aGlzLnNlY3JldEtleSxcclxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbixcclxuICAgICAgICByZWdpb24sXHJcbiAgICAgICAgcmVxdWVzdERhdGUsXHJcbiAgICAgICAgZXhwaXJlcyxcclxuICAgICAgKVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcikge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFVuYWJsZSB0byBnZXQgYnVja2V0IHJlZ2lvbiBmb3IgJHtidWNrZXROYW1lfS5gKVxyXG4gICAgICB9XHJcblxyXG4gICAgICB0aHJvdyBlcnJcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByZXNpZ25lZEdldE9iamVjdChcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIGV4cGlyZXM/OiBudW1iZXIsXHJcbiAgICByZXNwSGVhZGVycz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcclxuICAgIHJlcXVlc3REYXRlPzogRGF0ZSxcclxuICApOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHZhbGlkUmVzcEhlYWRlcnMgPSBbXHJcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxyXG4gICAgICAncmVzcG9uc2UtY29udGVudC1sYW5ndWFnZScsXHJcbiAgICAgICdyZXNwb25zZS1leHBpcmVzJyxcclxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxyXG4gICAgICAncmVzcG9uc2UtY29udGVudC1kaXNwb3NpdGlvbicsXHJcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWVuY29kaW5nJyxcclxuICAgIF1cclxuICAgIHZhbGlkUmVzcEhlYWRlcnMuZm9yRWFjaCgoaGVhZGVyKSA9PiB7XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHJlc3BvbnNlIGhlYWRlciAke2hlYWRlcn0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcImApXHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ0dFVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlc3BIZWFkZXJzLCByZXF1ZXN0RGF0ZSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHByZXNpZ25lZFB1dE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZXhwaXJlcz86IG51bWJlcik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdQVVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzKVxyXG4gIH1cclxuXHJcbiAgbmV3UG9zdFBvbGljeSgpOiBQb3N0UG9saWN5IHtcclxuICAgIHJldHVybiBuZXcgUG9zdFBvbGljeSgpXHJcbiAgfVxyXG5cclxuICBhc3luYyBwcmVzaWduZWRQb3N0UG9saWN5KHBvc3RQb2xpY3k6IFBvc3RQb2xpY3kpOiBQcm9taXNlPFBvc3RQb2xpY3lSZXN1bHQ+IHtcclxuICAgIGlmICh0aGlzLmFub255bW91cykge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkIFBPU1QgcG9saWN5IGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzT2JqZWN0KHBvc3RQb2xpY3kpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Bvc3RQb2xpY3kgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBjb25zdCBidWNrZXROYW1lID0gcG9zdFBvbGljeS5mb3JtRGF0YS5idWNrZXQgYXMgc3RyaW5nXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXHJcblxyXG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxyXG4gICAgICBjb25zdCBkYXRlU3RyID0gbWFrZURhdGVMb25nKGRhdGUpXHJcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxyXG5cclxuICAgICAgaWYgKCFwb3N0UG9saWN5LnBvbGljeS5leHBpcmF0aW9uKSB7XHJcbiAgICAgICAgLy8gJ2V4cGlyYXRpb24nIGlzIG1hbmRhdG9yeSBmaWVsZCBmb3IgUzMuXHJcbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgZXhwaXJhdGlvbiBkYXRlIG9mIDcgZGF5cy5cclxuICAgICAgICBjb25zdCBleHBpcmVzID0gbmV3IERhdGUoKVxyXG4gICAgICAgIGV4cGlyZXMuc2V0U2Vjb25kcyhQUkVTSUdOX0VYUElSWV9EQVlTX01BWClcclxuICAgICAgICBwb3N0UG9saWN5LnNldEV4cGlyZXMoZXhwaXJlcylcclxuICAgICAgfVxyXG5cclxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWRhdGUnLCBkYXRlU3RyXSlcclxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotZGF0ZSddID0gZGF0ZVN0clxyXG5cclxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWFsZ29yaXRobScsICdBV1M0LUhNQUMtU0hBMjU2J10pXHJcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWFsZ29yaXRobSddID0gJ0FXUzQtSE1BQy1TSEEyNTYnXHJcblxyXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotY3JlZGVudGlhbCcsIHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKV0pXHJcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWNyZWRlbnRpYWwnXSA9IHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKVxyXG5cclxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XHJcbiAgICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LXNlY3VyaXR5LXRva2VuJywgdGhpcy5zZXNzaW9uVG9rZW5dKVxyXG4gICAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBwb2xpY3lCYXNlNjQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwb3N0UG9saWN5LnBvbGljeSkpLnRvU3RyaW5nKCdiYXNlNjQnKVxyXG5cclxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YS5wb2xpY3kgPSBwb2xpY3lCYXNlNjRcclxuXHJcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNpZ25hdHVyZSddID0gcG9zdFByZXNpZ25TaWduYXR1cmVWNChyZWdpb24sIGRhdGUsIHRoaXMuc2VjcmV0S2V5LCBwb2xpY3lCYXNlNjQpXHJcbiAgICAgIGNvbnN0IG9wdHMgPSB7XHJcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXHJcbiAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgfVxyXG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyhvcHRzKVxyXG4gICAgICBjb25zdCBwb3J0U3RyID0gdGhpcy5wb3J0ID09IDgwIHx8IHRoaXMucG9ydCA9PT0gNDQzID8gJycgOiBgOiR7dGhpcy5wb3J0LnRvU3RyaW5nKCl9YFxyXG4gICAgICBjb25zdCB1cmxTdHIgPSBgJHtyZXFPcHRpb25zLnByb3RvY29sfS8vJHtyZXFPcHRpb25zLmhvc3R9JHtwb3J0U3RyfSR7cmVxT3B0aW9ucy5wYXRofWBcclxuICAgICAgcmV0dXJuIHsgcG9zdFVSTDogdXJsU3RyLCBmb3JtRGF0YTogcG9zdFBvbGljeS5mb3JtRGF0YSB9XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRocm93IGVyclxyXG4gICAgfVxyXG4gIH1cclxuICAvLyBsaXN0IGEgYmF0Y2ggb2Ygb2JqZWN0c1xyXG4gIGFzeW5jIGxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBwcmVmaXg/OiBzdHJpbmcsIG1hcmtlcj86IHN0cmluZywgbGlzdFF1ZXJ5T3B0cz86IExpc3RPYmplY3RRdWVyeU9wdHMpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAobWFya2VyICYmICFpc1N0cmluZyhtYXJrZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuXHJcbiAgICBpZiAobGlzdFF1ZXJ5T3B0cyAmJiAhaXNPYmplY3QobGlzdFF1ZXJ5T3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdFF1ZXJ5T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGxldCB7IERlbGltaXRlciwgTWF4S2V5cywgSW5jbHVkZVZlcnNpb24sIHZlcnNpb25JZE1hcmtlciwga2V5TWFya2VyIH0gPSBsaXN0UXVlcnlPcHRzIGFzIExpc3RPYmplY3RRdWVyeU9wdHNcclxuXHJcbiAgICBpZiAoIWlzU3RyaW5nKERlbGltaXRlcikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc051bWJlcihNYXhLZXlzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxyXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcclxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcclxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKERlbGltaXRlcil9YClcclxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxyXG5cclxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xyXG4gICAgICBxdWVyaWVzLnB1c2goYHZlcnNpb25zYClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcclxuICAgICAgLy8gdjEgdmVyc2lvbiBsaXN0aW5nLi5cclxuICAgICAgaWYgKGtleU1hcmtlcikge1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke2tleU1hcmtlcn1gKVxyXG4gICAgICB9XHJcbiAgICAgIGlmICh2ZXJzaW9uSWRNYXJrZXIpIHtcclxuICAgICAgICBxdWVyaWVzLnB1c2goYHZlcnNpb24taWQtbWFya2VyPSR7dmVyc2lvbklkTWFya2VyfWApXHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAobWFya2VyKSB7XHJcbiAgICAgIG1hcmtlciA9IHVyaUVzY2FwZShtYXJrZXIpXHJcbiAgICAgIHF1ZXJpZXMucHVzaChgbWFya2VyPSR7bWFya2VyfWApXHJcbiAgICB9XHJcblxyXG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xyXG4gICAgaWYgKE1heEtleXMpIHtcclxuICAgICAgaWYgKE1heEtleXMgPj0gMTAwMCkge1xyXG4gICAgICAgIE1heEtleXMgPSAxMDAwXHJcbiAgICAgIH1cclxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke01heEtleXN9YClcclxuICAgIH1cclxuICAgIHF1ZXJpZXMuc29ydCgpXHJcbiAgICBsZXQgcXVlcnkgPSAnJ1xyXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICBjb25zdCBsaXN0UXJ5TGlzdCA9IHBhcnNlTGlzdE9iamVjdHMoYm9keSlcclxuICAgIHJldHVybiBsaXN0UXJ5TGlzdFxyXG4gIH1cclxuXHJcbiAgbGlzdE9iamVjdHMoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBwcmVmaXg/OiBzdHJpbmcsXHJcbiAgICByZWN1cnNpdmU/OiBib29sZWFuLFxyXG4gICAgbGlzdE9wdHM/OiBMaXN0T2JqZWN0UXVlcnlPcHRzIHwgdW5kZWZpbmVkLFxyXG4gICk6IEJ1Y2tldFN0cmVhbTxPYmplY3RJbmZvPiB7XHJcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgcHJlZml4ID0gJydcclxuICAgIH1cclxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdE9wdHMgJiYgIWlzT2JqZWN0KGxpc3RPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGxldCBtYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICcnXHJcbiAgICBsZXQga2V5TWFya2VyOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnJ1xyXG4gICAgbGV0IHZlcnNpb25JZE1hcmtlcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJydcclxuICAgIGxldCBvYmplY3RzOiBPYmplY3RJbmZvW10gPSBbXVxyXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcclxuICAgIGNvbnN0IHJlYWRTdHJlYW06IHN0cmVhbS5SZWFkYWJsZSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXHJcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcclxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XHJcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcclxuICAgICAgICByZXR1cm5cclxuICAgICAgfVxyXG4gICAgICBpZiAoZW5kZWQpIHtcclxuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgbGlzdFF1ZXJ5T3B0cyA9IHtcclxuICAgICAgICAgIERlbGltaXRlcjogcmVjdXJzaXZlID8gJycgOiAnLycsIC8vIGlmIHJlY3Vyc2l2ZSBpcyBmYWxzZSBzZXQgZGVsaW1pdGVyIHRvICcvJ1xyXG4gICAgICAgICAgTWF4S2V5czogMTAwMCxcclxuICAgICAgICAgIEluY2x1ZGVWZXJzaW9uOiBsaXN0T3B0cz8uSW5jbHVkZVZlcnNpb24sXHJcbiAgICAgICAgICAvLyB2ZXJzaW9uIGxpc3Rpbmcgc3BlY2lmaWMgb3B0aW9uc1xyXG4gICAgICAgICAga2V5TWFya2VyOiBrZXlNYXJrZXIsXHJcbiAgICAgICAgICB2ZXJzaW9uSWRNYXJrZXI6IHZlcnNpb25JZE1hcmtlcixcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHJlc3VsdDogTGlzdE9iamVjdFF1ZXJ5UmVzID0gYXdhaXQgdGhpcy5saXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzKVxyXG4gICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcclxuICAgICAgICAgIG1hcmtlciA9IHJlc3VsdC5uZXh0TWFya2VyIHx8IHVuZGVmaW5lZFxyXG4gICAgICAgICAgaWYgKHJlc3VsdC5rZXlNYXJrZXIpIHtcclxuICAgICAgICAgICAga2V5TWFya2VyID0gcmVzdWx0LmtleU1hcmtlclxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKHJlc3VsdC52ZXJzaW9uSWRNYXJrZXIpIHtcclxuICAgICAgICAgICAgdmVyc2lvbklkTWFya2VyID0gcmVzdWx0LnZlcnNpb25JZE1hcmtlclxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBlbmRlZCA9IHRydWVcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHJlc3VsdC5vYmplY3RzKSB7XHJcbiAgICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxyXG4gICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVhZFN0cmVhbVxyXG4gIH1cclxufVxyXG4iXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBS0EsTUFBTTtBQUNsQixPQUFPLEtBQUtDLEVBQUU7QUFFZCxPQUFPLEtBQUtDLElBQUk7QUFDaEIsT0FBTyxLQUFLQyxLQUFLO0FBQ2pCLE9BQU8sS0FBS0MsSUFBSTtBQUNoQixPQUFPLEtBQUtDLE1BQU07QUFFbEIsT0FBTyxLQUFLQyxLQUFLLE1BQU0sT0FBTztBQUM5QixPQUFPQyxZQUFZLE1BQU0sZUFBZTtBQUN4QyxTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBQzNDLE9BQU9DLENBQUMsTUFBTSxRQUFRO0FBQ3RCLE9BQU8sS0FBS0MsRUFBRSxNQUFNLGNBQWM7QUFDbEMsT0FBT0MsTUFBTSxNQUFNLFFBQVE7QUFFM0IsU0FBU0Msa0JBQWtCLFFBQVEsMkJBQTBCO0FBQzdELE9BQU8sS0FBS0MsTUFBTSxNQUFNLGVBQWM7QUFFdEMsU0FDRUMsc0JBQXNCLEVBQ3RCQyxpQkFBaUIsRUFDakJDLGNBQWMsRUFDZEMsaUJBQWlCLEVBQ2pCQyx1QkFBdUIsRUFDdkJDLGVBQWUsRUFDZkMsd0JBQXdCLFFBQ25CLGdCQUFlO0FBRXRCLFNBQVNDLHNCQUFzQixFQUFFQyxrQkFBa0IsRUFBRUMsTUFBTSxRQUFRLGdCQUFlO0FBQ2xGLFNBQVNDLEdBQUcsRUFBRUMsYUFBYSxRQUFRLGFBQVk7QUFDL0MsU0FBU0MsY0FBYyxRQUFRLHVCQUFzQjtBQUNyRCxTQUFTQyxVQUFVLFFBQVEsa0JBQWlCO0FBQzVDLFNBQ0VDLG1CQUFtQixFQUNuQkMsZUFBZSxFQUNmQyxnQkFBZ0IsRUFDaEJDLFFBQVEsRUFDUkMsa0JBQWtCLEVBQ2xCQyxZQUFZLEVBQ1pDLFVBQVUsRUFDVkMsaUJBQWlCLEVBQ2pCQyxnQkFBZ0IsRUFDaEJDLFNBQVMsRUFDVEMsU0FBUyxFQUNUQyxPQUFPLEVBQ1BDLFFBQVEsRUFDUkMsUUFBUSxFQUNSQyxhQUFhLEVBQ2JDLGdCQUFnQixFQUNoQkMsUUFBUSxFQUNSQyxpQkFBaUIsRUFDakJDLGVBQWUsRUFDZkMsaUJBQWlCLEVBQ2pCQyxXQUFXLEVBQ1hDLGFBQWEsRUFDYkMsa0JBQWtCLEVBQ2xCQyxZQUFZLEVBQ1pDLGdCQUFnQixFQUNoQkMsYUFBYSxFQUNiQyxlQUFlLEVBQ2ZDLGNBQWMsRUFDZEMsWUFBWSxFQUNaQyxLQUFLLEVBQ0xDLFFBQVEsRUFDUkMsU0FBUyxFQUNUQyxpQkFBaUIsUUFDWixjQUFhO0FBQ3BCLFNBQVNDLFlBQVksUUFBUSxzQkFBcUI7QUFDbEQsU0FBU0MsVUFBVSxRQUFRLG1CQUFrQjtBQUM3QyxTQUFTQyxPQUFPLFFBQVEsZUFBYztBQUN0QyxTQUFTQyxhQUFhLEVBQUVDLFlBQVksRUFBRUMsWUFBWSxRQUFRLGdCQUFlO0FBRXpFLFNBQVNDLGFBQWEsUUFBUSxvQkFBbUI7QUFpRGpELFNBQ0VDLHNCQUFzQixFQUN0QkMsc0JBQXNCLEVBQ3RCQyxnQkFBZ0IsRUFDaEJDLDBCQUEwQixFQUMxQkMsZ0NBQWdDLEVBQ2hDQyxnQkFBZ0IsUUFDWCxrQkFBaUI7QUFDeEIsT0FBTyxLQUFLQyxVQUFVLE1BQU0sa0JBQWlCO0FBRTdDLE1BQU1DLEdBQUcsR0FBRyxJQUFJaEUsTUFBTSxDQUFDaUUsT0FBTyxDQUFDO0VBQUVDLFVBQVUsRUFBRTtJQUFFQyxNQUFNLEVBQUU7RUFBTSxDQUFDO0VBQUVDLFFBQVEsRUFBRTtBQUFLLENBQUMsQ0FBQzs7QUFFakY7QUFDQSxNQUFNQyxPQUFPLEdBQUc7RUFBRUMsT0FBTyxFQXRJekIsT0FBTyxJQXNJNEQ7QUFBYyxDQUFDO0FBRWxGLE1BQU1DLHVCQUF1QixHQUFHLENBQzlCLE9BQU8sRUFDUCxJQUFJLEVBQ0osTUFBTSxFQUNOLFNBQVMsRUFDVCxrQkFBa0IsRUFDbEIsS0FBSyxFQUNMLFNBQVMsRUFDVCxXQUFXLEVBQ1gsUUFBUSxFQUNSLGtCQUFrQixFQUNsQixLQUFLLEVBQ0wsWUFBWSxFQUNaLEtBQUssRUFDTCxvQkFBb0IsRUFDcEIsZUFBZSxFQUNmLGdCQUFnQixFQUNoQixZQUFZLEVBQ1osa0JBQWtCLENBQ1Y7QUEyQ1YsT0FBTyxNQUFNQyxXQUFXLENBQUM7RUFjdkJDLFFBQVEsR0FBVyxFQUFFLEdBQUcsSUFBSSxHQUFHLElBQUk7RUFHekJDLGVBQWUsR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxJQUFJO0VBQ3hDQyxhQUFhLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLElBQUk7RUFRdkRDLFdBQVdBLENBQUNDLE1BQXFCLEVBQUU7SUFDakM7SUFDQSxJQUFJQSxNQUFNLENBQUNDLE1BQU0sS0FBS0MsU0FBUyxFQUFFO01BQy9CLE1BQU0sSUFBSUMsS0FBSyxDQUFDLDZEQUE2RCxDQUFDO0lBQ2hGO0lBQ0E7SUFDQSxJQUFJSCxNQUFNLENBQUNJLE1BQU0sS0FBS0YsU0FBUyxFQUFFO01BQy9CRixNQUFNLENBQUNJLE1BQU0sR0FBRyxJQUFJO0lBQ3RCO0lBQ0EsSUFBSSxDQUFDSixNQUFNLENBQUNLLElBQUksRUFBRTtNQUNoQkwsTUFBTSxDQUFDSyxJQUFJLEdBQUcsQ0FBQztJQUNqQjtJQUNBO0lBQ0EsSUFBSSxDQUFDL0MsZUFBZSxDQUFDMEMsTUFBTSxDQUFDTSxRQUFRLENBQUMsRUFBRTtNQUNyQyxNQUFNLElBQUlqRixNQUFNLENBQUNrRixvQkFBb0IsQ0FBQyxzQkFBc0JQLE1BQU0sQ0FBQ00sUUFBUSxFQUFFLENBQUM7SUFDaEY7SUFDQSxJQUFJLENBQUM5QyxXQUFXLENBQUN3QyxNQUFNLENBQUNLLElBQUksQ0FBQyxFQUFFO01BQzdCLE1BQU0sSUFBSWhGLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLGtCQUFrQlIsTUFBTSxDQUFDSyxJQUFJLEVBQUUsQ0FBQztJQUN4RTtJQUNBLElBQUksQ0FBQ3hELFNBQVMsQ0FBQ21ELE1BQU0sQ0FBQ0ksTUFBTSxDQUFDLEVBQUU7TUFDN0IsTUFBTSxJQUFJL0UsTUFBTSxDQUFDbUYsb0JBQW9CLENBQ25DLDhCQUE4QlIsTUFBTSxDQUFDSSxNQUFNLG9DQUM3QyxDQUFDO0lBQ0g7O0lBRUE7SUFDQSxJQUFJSixNQUFNLENBQUNTLE1BQU0sRUFBRTtNQUNqQixJQUFJLENBQUNyRCxRQUFRLENBQUM0QyxNQUFNLENBQUNTLE1BQU0sQ0FBQyxFQUFFO1FBQzVCLE1BQU0sSUFBSXBGLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLG9CQUFvQlIsTUFBTSxDQUFDUyxNQUFNLEVBQUUsQ0FBQztNQUM1RTtJQUNGO0lBRUEsTUFBTUMsSUFBSSxHQUFHVixNQUFNLENBQUNNLFFBQVEsQ0FBQ0ssV0FBVyxDQUFDLENBQUM7SUFDMUMsSUFBSU4sSUFBSSxHQUFHTCxNQUFNLENBQUNLLElBQUk7SUFDdEIsSUFBSU8sUUFBZ0I7SUFDcEIsSUFBSUMsU0FBUztJQUNiLElBQUlDLGNBQTBCO0lBQzlCO0lBQ0E7SUFDQSxJQUFJZCxNQUFNLENBQUNJLE1BQU0sRUFBRTtNQUNqQjtNQUNBUyxTQUFTLEdBQUdsRyxLQUFLO01BQ2pCaUcsUUFBUSxHQUFHLFFBQVE7TUFDbkJQLElBQUksR0FBR0EsSUFBSSxJQUFJLEdBQUc7TUFDbEJTLGNBQWMsR0FBR25HLEtBQUssQ0FBQ29HLFdBQVc7SUFDcEMsQ0FBQyxNQUFNO01BQ0xGLFNBQVMsR0FBR25HLElBQUk7TUFDaEJrRyxRQUFRLEdBQUcsT0FBTztNQUNsQlAsSUFBSSxHQUFHQSxJQUFJLElBQUksRUFBRTtNQUNqQlMsY0FBYyxHQUFHcEcsSUFBSSxDQUFDcUcsV0FBVztJQUNuQzs7SUFFQTtJQUNBLElBQUlmLE1BQU0sQ0FBQ2EsU0FBUyxFQUFFO01BQ3BCLElBQUksQ0FBQzVELFFBQVEsQ0FBQytDLE1BQU0sQ0FBQ2EsU0FBUyxDQUFDLEVBQUU7UUFDL0IsTUFBTSxJQUFJeEYsTUFBTSxDQUFDbUYsb0JBQW9CLENBQ25DLDRCQUE0QlIsTUFBTSxDQUFDYSxTQUFTLGdDQUM5QyxDQUFDO01BQ0g7TUFDQUEsU0FBUyxHQUFHYixNQUFNLENBQUNhLFNBQVM7SUFDOUI7O0lBRUE7SUFDQSxJQUFJYixNQUFNLENBQUNjLGNBQWMsRUFBRTtNQUN6QixJQUFJLENBQUM3RCxRQUFRLENBQUMrQyxNQUFNLENBQUNjLGNBQWMsQ0FBQyxFQUFFO1FBQ3BDLE1BQU0sSUFBSXpGLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUNuQyxnQ0FBZ0NSLE1BQU0sQ0FBQ2MsY0FBYyxnQ0FDdkQsQ0FBQztNQUNIO01BRUFBLGNBQWMsR0FBR2QsTUFBTSxDQUFDYyxjQUFjO0lBQ3hDOztJQUVBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQSxNQUFNRSxlQUFlLEdBQUcsSUFBSUMsT0FBTyxDQUFDQyxRQUFRLEtBQUtELE9BQU8sQ0FBQ0UsSUFBSSxHQUFHO0lBQ2hFLE1BQU1DLFlBQVksR0FBRyxTQUFTSixlQUFlLGFBQWF4QixPQUFPLENBQUNDLE9BQU8sRUFBRTtJQUMzRTs7SUFFQSxJQUFJLENBQUNvQixTQUFTLEdBQUdBLFNBQVM7SUFDMUIsSUFBSSxDQUFDQyxjQUFjLEdBQUdBLGNBQWM7SUFDcEMsSUFBSSxDQUFDSixJQUFJLEdBQUdBLElBQUk7SUFDaEIsSUFBSSxDQUFDTCxJQUFJLEdBQUdBLElBQUk7SUFDaEIsSUFBSSxDQUFDTyxRQUFRLEdBQUdBLFFBQVE7SUFDeEIsSUFBSSxDQUFDUyxTQUFTLEdBQUcsR0FBR0QsWUFBWSxFQUFFOztJQUVsQztJQUNBLElBQUlwQixNQUFNLENBQUNzQixTQUFTLEtBQUtwQixTQUFTLEVBQUU7TUFDbEMsSUFBSSxDQUFDb0IsU0FBUyxHQUFHLElBQUk7SUFDdkIsQ0FBQyxNQUFNO01BQ0wsSUFBSSxDQUFDQSxTQUFTLEdBQUd0QixNQUFNLENBQUNzQixTQUFTO0lBQ25DO0lBRUEsSUFBSSxDQUFDQyxTQUFTLEdBQUd2QixNQUFNLENBQUN1QixTQUFTLElBQUksRUFBRTtJQUN2QyxJQUFJLENBQUNDLFNBQVMsR0FBR3hCLE1BQU0sQ0FBQ3dCLFNBQVMsSUFBSSxFQUFFO0lBQ3ZDLElBQUksQ0FBQ0MsWUFBWSxHQUFHekIsTUFBTSxDQUFDeUIsWUFBWTtJQUN2QyxJQUFJLENBQUNDLFNBQVMsR0FBRyxDQUFDLElBQUksQ0FBQ0gsU0FBUyxJQUFJLENBQUMsSUFBSSxDQUFDQyxTQUFTO0lBRW5ELElBQUl4QixNQUFNLENBQUMyQixtQkFBbUIsRUFBRTtNQUM5QixJQUFJLENBQUNELFNBQVMsR0FBRyxLQUFLO01BQ3RCLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUczQixNQUFNLENBQUMyQixtQkFBbUI7SUFDdkQ7SUFFQSxJQUFJLENBQUNDLFNBQVMsR0FBRyxDQUFDLENBQUM7SUFDbkIsSUFBSTVCLE1BQU0sQ0FBQ1MsTUFBTSxFQUFFO01BQ2pCLElBQUksQ0FBQ0EsTUFBTSxHQUFHVCxNQUFNLENBQUNTLE1BQU07SUFDN0I7SUFFQSxJQUFJVCxNQUFNLENBQUNKLFFBQVEsRUFBRTtNQUNuQixJQUFJLENBQUNBLFFBQVEsR0FBR0ksTUFBTSxDQUFDSixRQUFRO01BQy9CLElBQUksQ0FBQ2lDLGdCQUFnQixHQUFHLElBQUk7SUFDOUI7SUFDQSxJQUFJLElBQUksQ0FBQ2pDLFFBQVEsR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksRUFBRTtNQUNuQyxNQUFNLElBQUl2RSxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxzQ0FBc0MsQ0FBQztJQUMvRTtJQUNBLElBQUksSUFBSSxDQUFDWixRQUFRLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSSxFQUFFO01BQzFDLE1BQU0sSUFBSXZFLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLG1DQUFtQyxDQUFDO0lBQzVFOztJQUVBO0lBQ0E7SUFDQTtJQUNBLElBQUksQ0FBQ3NCLFlBQVksR0FBRyxDQUFDLElBQUksQ0FBQ0osU0FBUyxJQUFJLENBQUMxQixNQUFNLENBQUNJLE1BQU07SUFFckQsSUFBSSxDQUFDMkIsb0JBQW9CLEdBQUcvQixNQUFNLENBQUMrQixvQkFBb0IsSUFBSTdCLFNBQVM7SUFDcEUsSUFBSSxDQUFDOEIsVUFBVSxHQUFHLENBQUMsQ0FBQztJQUNwQixJQUFJLENBQUNDLGdCQUFnQixHQUFHLElBQUk5RixVQUFVLENBQUMsSUFBSSxDQUFDO0VBQzlDO0VBQ0E7QUFDRjtBQUNBO0VBQ0UsSUFBSStGLFVBQVVBLENBQUEsRUFBRztJQUNmLE9BQU8sSUFBSSxDQUFDRCxnQkFBZ0I7RUFDOUI7O0VBRUE7QUFDRjtBQUNBO0VBQ0VFLHVCQUF1QkEsQ0FBQzdCLFFBQWdCLEVBQUU7SUFDeEMsSUFBSSxDQUFDeUIsb0JBQW9CLEdBQUd6QixRQUFRO0VBQ3RDOztFQUVBO0FBQ0Y7QUFDQTtFQUNTOEIsaUJBQWlCQSxDQUFDQyxPQUE2RSxFQUFFO0lBQ3RHLElBQUksQ0FBQ3BGLFFBQVEsQ0FBQ29GLE9BQU8sQ0FBQyxFQUFFO01BQ3RCLE1BQU0sSUFBSUMsU0FBUyxDQUFDLDRDQUE0QyxDQUFDO0lBQ25FO0lBQ0EsSUFBSSxDQUFDTixVQUFVLEdBQUcvRyxDQUFDLENBQUNzSCxJQUFJLENBQUNGLE9BQU8sRUFBRTNDLHVCQUF1QixDQUFDO0VBQzVEOztFQUVBO0FBQ0Y7QUFDQTtFQUNVOEMsMEJBQTBCQSxDQUFDQyxVQUFtQixFQUFFQyxVQUFtQixFQUFFO0lBQzNFLElBQUksQ0FBQzNGLE9BQU8sQ0FBQyxJQUFJLENBQUNnRixvQkFBb0IsQ0FBQyxJQUFJLENBQUNoRixPQUFPLENBQUMwRixVQUFVLENBQUMsSUFBSSxDQUFDMUYsT0FBTyxDQUFDMkYsVUFBVSxDQUFDLEVBQUU7TUFDdkY7TUFDQTtNQUNBLElBQUlELFVBQVUsQ0FBQ0UsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO1FBQzVCLE1BQU0sSUFBSXhDLEtBQUssQ0FBQyxtRUFBbUVzQyxVQUFVLEVBQUUsQ0FBQztNQUNsRztNQUNBO01BQ0E7TUFDQTtNQUNBLE9BQU8sSUFBSSxDQUFDVixvQkFBb0I7SUFDbEM7SUFDQSxPQUFPLEtBQUs7RUFDZDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VhLFVBQVVBLENBQUNDLE9BQWUsRUFBRUMsVUFBa0IsRUFBRTtJQUM5QyxJQUFJLENBQUMxRixRQUFRLENBQUN5RixPQUFPLENBQUMsRUFBRTtNQUN0QixNQUFNLElBQUlQLFNBQVMsQ0FBQyxvQkFBb0JPLE9BQU8sRUFBRSxDQUFDO0lBQ3BEO0lBQ0EsSUFBSUEsT0FBTyxDQUFDRSxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtNQUN6QixNQUFNLElBQUkxSCxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxnQ0FBZ0MsQ0FBQztJQUN6RTtJQUNBLElBQUksQ0FBQ3BELFFBQVEsQ0FBQzBGLFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSVIsU0FBUyxDQUFDLHVCQUF1QlEsVUFBVSxFQUFFLENBQUM7SUFDMUQ7SUFDQSxJQUFJQSxVQUFVLENBQUNDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO01BQzVCLE1BQU0sSUFBSTFILE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLG1DQUFtQyxDQUFDO0lBQzVFO0lBQ0EsSUFBSSxDQUFDYSxTQUFTLEdBQUcsR0FBRyxJQUFJLENBQUNBLFNBQVMsSUFBSXdCLE9BQU8sSUFBSUMsVUFBVSxFQUFFO0VBQy9EOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ1lFLGlCQUFpQkEsQ0FDekJDLElBRUMsRUFJRDtJQUNBLE1BQU1DLE1BQU0sR0FBR0QsSUFBSSxDQUFDQyxNQUFNO0lBQzFCLE1BQU16QyxNQUFNLEdBQUd3QyxJQUFJLENBQUN4QyxNQUFNO0lBQzFCLE1BQU1nQyxVQUFVLEdBQUdRLElBQUksQ0FBQ1IsVUFBVTtJQUNsQyxJQUFJQyxVQUFVLEdBQUdPLElBQUksQ0FBQ1AsVUFBVTtJQUNoQyxNQUFNUyxPQUFPLEdBQUdGLElBQUksQ0FBQ0UsT0FBTztJQUM1QixNQUFNQyxLQUFLLEdBQUdILElBQUksQ0FBQ0csS0FBSztJQUV4QixJQUFJcEIsVUFBVSxHQUFHO01BQ2ZrQixNQUFNO01BQ05DLE9BQU8sRUFBRSxDQUFDLENBQW1CO01BQzdCdkMsUUFBUSxFQUFFLElBQUksQ0FBQ0EsUUFBUTtNQUN2QjtNQUNBeUMsS0FBSyxFQUFFLElBQUksQ0FBQ3ZDO0lBQ2QsQ0FBQzs7SUFFRDtJQUNBLElBQUl3QyxnQkFBZ0I7SUFDcEIsSUFBSWIsVUFBVSxFQUFFO01BQ2RhLGdCQUFnQixHQUFHNUYsa0JBQWtCLENBQUMsSUFBSSxDQUFDZ0QsSUFBSSxFQUFFLElBQUksQ0FBQ0UsUUFBUSxFQUFFNkIsVUFBVSxFQUFFLElBQUksQ0FBQ25CLFNBQVMsQ0FBQztJQUM3RjtJQUVBLElBQUkxRyxJQUFJLEdBQUcsR0FBRztJQUNkLElBQUk4RixJQUFJLEdBQUcsSUFBSSxDQUFDQSxJQUFJO0lBRXBCLElBQUlMLElBQXdCO0lBQzVCLElBQUksSUFBSSxDQUFDQSxJQUFJLEVBQUU7TUFDYkEsSUFBSSxHQUFHLElBQUksQ0FBQ0EsSUFBSTtJQUNsQjtJQUVBLElBQUlxQyxVQUFVLEVBQUU7TUFDZEEsVUFBVSxHQUFHdEUsaUJBQWlCLENBQUNzRSxVQUFVLENBQUM7SUFDNUM7O0lBRUE7SUFDQSxJQUFJOUYsZ0JBQWdCLENBQUM4RCxJQUFJLENBQUMsRUFBRTtNQUMxQixNQUFNNkMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDZiwwQkFBMEIsQ0FBQ0MsVUFBVSxFQUFFQyxVQUFVLENBQUM7TUFDbEYsSUFBSWEsa0JBQWtCLEVBQUU7UUFDdEI3QyxJQUFJLEdBQUcsR0FBRzZDLGtCQUFrQixFQUFFO01BQ2hDLENBQUMsTUFBTTtRQUNMN0MsSUFBSSxHQUFHL0IsYUFBYSxDQUFDOEIsTUFBTSxDQUFDO01BQzlCO0lBQ0Y7SUFFQSxJQUFJNkMsZ0JBQWdCLElBQUksQ0FBQ0wsSUFBSSxDQUFDM0IsU0FBUyxFQUFFO01BQ3ZDO01BQ0E7TUFDQTtNQUNBO01BQ0E7TUFDQSxJQUFJbUIsVUFBVSxFQUFFO1FBQ2QvQixJQUFJLEdBQUcsR0FBRytCLFVBQVUsSUFBSS9CLElBQUksRUFBRTtNQUNoQztNQUNBLElBQUlnQyxVQUFVLEVBQUU7UUFDZDlILElBQUksR0FBRyxJQUFJOEgsVUFBVSxFQUFFO01BQ3pCO0lBQ0YsQ0FBQyxNQUFNO01BQ0w7TUFDQTtNQUNBO01BQ0EsSUFBSUQsVUFBVSxFQUFFO1FBQ2Q3SCxJQUFJLEdBQUcsSUFBSTZILFVBQVUsRUFBRTtNQUN6QjtNQUNBLElBQUlDLFVBQVUsRUFBRTtRQUNkOUgsSUFBSSxHQUFHLElBQUk2SCxVQUFVLElBQUlDLFVBQVUsRUFBRTtNQUN2QztJQUNGO0lBRUEsSUFBSVUsS0FBSyxFQUFFO01BQ1R4SSxJQUFJLElBQUksSUFBSXdJLEtBQUssRUFBRTtJQUNyQjtJQUNBcEIsVUFBVSxDQUFDbUIsT0FBTyxDQUFDekMsSUFBSSxHQUFHQSxJQUFJO0lBQzlCLElBQUtzQixVQUFVLENBQUNwQixRQUFRLEtBQUssT0FBTyxJQUFJUCxJQUFJLEtBQUssRUFBRSxJQUFNMkIsVUFBVSxDQUFDcEIsUUFBUSxLQUFLLFFBQVEsSUFBSVAsSUFBSSxLQUFLLEdBQUksRUFBRTtNQUMxRzJCLFVBQVUsQ0FBQ21CLE9BQU8sQ0FBQ3pDLElBQUksR0FBR3JDLFlBQVksQ0FBQ3FDLElBQUksRUFBRUwsSUFBSSxDQUFDO0lBQ3BEO0lBRUEyQixVQUFVLENBQUNtQixPQUFPLENBQUMsWUFBWSxDQUFDLEdBQUcsSUFBSSxDQUFDOUIsU0FBUztJQUNqRCxJQUFJOEIsT0FBTyxFQUFFO01BQ1g7TUFDQSxLQUFLLE1BQU0sQ0FBQ0ssQ0FBQyxFQUFFQyxDQUFDLENBQUMsSUFBSUMsTUFBTSxDQUFDQyxPQUFPLENBQUNSLE9BQU8sQ0FBQyxFQUFFO1FBQzVDbkIsVUFBVSxDQUFDbUIsT0FBTyxDQUFDSyxDQUFDLENBQUM3QyxXQUFXLENBQUMsQ0FBQyxDQUFDLEdBQUc4QyxDQUFDO01BQ3pDO0lBQ0Y7O0lBRUE7SUFDQXpCLFVBQVUsR0FBRzBCLE1BQU0sQ0FBQ0UsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQzVCLFVBQVUsRUFBRUEsVUFBVSxDQUFDO0lBRTNELE9BQU87TUFDTCxHQUFHQSxVQUFVO01BQ2JtQixPQUFPLEVBQUVsSSxDQUFDLENBQUM0SSxTQUFTLENBQUM1SSxDQUFDLENBQUM2SSxNQUFNLENBQUM5QixVQUFVLENBQUNtQixPQUFPLEVBQUVyRyxTQUFTLENBQUMsRUFBRzJHLENBQUMsSUFBS0EsQ0FBQyxDQUFDTSxRQUFRLENBQUMsQ0FBQyxDQUFDO01BQ2xGckQsSUFBSTtNQUNKTCxJQUFJO01BQ0p6RjtJQUNGLENBQUM7RUFDSDtFQUVBLE1BQWFvSixzQkFBc0JBLENBQUNyQyxtQkFBdUMsRUFBRTtJQUMzRSxJQUFJLEVBQUVBLG1CQUFtQixZQUFZdkcsa0JBQWtCLENBQUMsRUFBRTtNQUN4RCxNQUFNLElBQUkrRSxLQUFLLENBQUMsb0VBQW9FLENBQUM7SUFDdkY7SUFDQSxJQUFJLENBQUN3QixtQkFBbUIsR0FBR0EsbUJBQW1CO0lBQzlDLE1BQU0sSUFBSSxDQUFDc0Msb0JBQW9CLENBQUMsQ0FBQztFQUNuQztFQUVBLE1BQWNBLG9CQUFvQkEsQ0FBQSxFQUFHO0lBQ25DLElBQUksSUFBSSxDQUFDdEMsbUJBQW1CLEVBQUU7TUFDNUIsSUFBSTtRQUNGLE1BQU11QyxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUN2QyxtQkFBbUIsQ0FBQ3dDLGNBQWMsQ0FBQyxDQUFDO1FBQ3ZFLElBQUksQ0FBQzVDLFNBQVMsR0FBRzJDLGVBQWUsQ0FBQ0UsWUFBWSxDQUFDLENBQUM7UUFDL0MsSUFBSSxDQUFDNUMsU0FBUyxHQUFHMEMsZUFBZSxDQUFDRyxZQUFZLENBQUMsQ0FBQztRQUMvQyxJQUFJLENBQUM1QyxZQUFZLEdBQUd5QyxlQUFlLENBQUNJLGVBQWUsQ0FBQyxDQUFDO01BQ3ZELENBQUMsQ0FBQyxPQUFPQyxDQUFDLEVBQUU7UUFDVixNQUFNLElBQUlwRSxLQUFLLENBQUMsOEJBQThCb0UsQ0FBQyxFQUFFLEVBQUU7VUFBRUMsS0FBSyxFQUFFRDtRQUFFLENBQUMsQ0FBQztNQUNsRTtJQUNGO0VBQ0Y7RUFJQTtBQUNGO0FBQ0E7RUFDVUUsT0FBT0EsQ0FBQ3pDLFVBQW9CLEVBQUUwQyxRQUFxQyxFQUFFQyxHQUFhLEVBQUU7SUFDMUY7SUFDQSxJQUFJLENBQUMsSUFBSSxDQUFDQyxTQUFTLEVBQUU7TUFDbkI7SUFDRjtJQUNBLElBQUksQ0FBQzNILFFBQVEsQ0FBQytFLFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSU0sU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSW9DLFFBQVEsSUFBSSxDQUFDdkgsZ0JBQWdCLENBQUN1SCxRQUFRLENBQUMsRUFBRTtNQUMzQyxNQUFNLElBQUlwQyxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7SUFDQSxJQUFJcUMsR0FBRyxJQUFJLEVBQUVBLEdBQUcsWUFBWXhFLEtBQUssQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSW1DLFNBQVMsQ0FBQywrQkFBK0IsQ0FBQztJQUN0RDtJQUNBLE1BQU1zQyxTQUFTLEdBQUcsSUFBSSxDQUFDQSxTQUFTO0lBQ2hDLE1BQU1DLFVBQVUsR0FBSTFCLE9BQXVCLElBQUs7TUFDOUNPLE1BQU0sQ0FBQ0MsT0FBTyxDQUFDUixPQUFPLENBQUMsQ0FBQzJCLE9BQU8sQ0FBQyxDQUFDLENBQUN0QixDQUFDLEVBQUVDLENBQUMsQ0FBQyxLQUFLO1FBQzFDLElBQUlELENBQUMsSUFBSSxlQUFlLEVBQUU7VUFDeEIsSUFBSXBHLFFBQVEsQ0FBQ3FHLENBQUMsQ0FBQyxFQUFFO1lBQ2YsTUFBTXNCLFFBQVEsR0FBRyxJQUFJQyxNQUFNLENBQUMsdUJBQXVCLENBQUM7WUFDcER2QixDQUFDLEdBQUdBLENBQUMsQ0FBQ3dCLE9BQU8sQ0FBQ0YsUUFBUSxFQUFFLHdCQUF3QixDQUFDO1VBQ25EO1FBQ0Y7UUFDQUgsU0FBUyxDQUFDTSxLQUFLLENBQUMsR0FBRzFCLENBQUMsS0FBS0MsQ0FBQyxJQUFJLENBQUM7TUFDakMsQ0FBQyxDQUFDO01BQ0ZtQixTQUFTLENBQUNNLEtBQUssQ0FBQyxJQUFJLENBQUM7SUFDdkIsQ0FBQztJQUNETixTQUFTLENBQUNNLEtBQUssQ0FBQyxZQUFZbEQsVUFBVSxDQUFDa0IsTUFBTSxJQUFJbEIsVUFBVSxDQUFDcEgsSUFBSSxJQUFJLENBQUM7SUFDckVpSyxVQUFVLENBQUM3QyxVQUFVLENBQUNtQixPQUFPLENBQUM7SUFDOUIsSUFBSXVCLFFBQVEsRUFBRTtNQUNaLElBQUksQ0FBQ0UsU0FBUyxDQUFDTSxLQUFLLENBQUMsYUFBYVIsUUFBUSxDQUFDUyxVQUFVLElBQUksQ0FBQztNQUMxRE4sVUFBVSxDQUFDSCxRQUFRLENBQUN2QixPQUF5QixDQUFDO0lBQ2hEO0lBQ0EsSUFBSXdCLEdBQUcsRUFBRTtNQUNQQyxTQUFTLENBQUNNLEtBQUssQ0FBQyxlQUFlLENBQUM7TUFDaEMsTUFBTUUsT0FBTyxHQUFHQyxJQUFJLENBQUNDLFNBQVMsQ0FBQ1gsR0FBRyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7TUFDL0NDLFNBQVMsQ0FBQ00sS0FBSyxDQUFDLEdBQUdFLE9BQU8sSUFBSSxDQUFDO0lBQ2pDO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0VBQ1NHLE9BQU9BLENBQUMxSyxNQUF3QixFQUFFO0lBQ3ZDLElBQUksQ0FBQ0EsTUFBTSxFQUFFO01BQ1hBLE1BQU0sR0FBR29HLE9BQU8sQ0FBQ3VFLE1BQU07SUFDekI7SUFDQSxJQUFJLENBQUNaLFNBQVMsR0FBRy9KLE1BQU07RUFDekI7O0VBRUE7QUFDRjtBQUNBO0VBQ1M0SyxRQUFRQSxDQUFBLEVBQUc7SUFDaEIsSUFBSSxDQUFDYixTQUFTLEdBQUcxRSxTQUFTO0VBQzVCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTXdGLGdCQUFnQkEsQ0FDcEJyRCxPQUFzQixFQUN0QnNELE9BQWUsR0FBRyxFQUFFLEVBQ3BCQyxhQUF1QixHQUFHLENBQUMsR0FBRyxDQUFDLEVBQy9CbkYsTUFBTSxHQUFHLEVBQUUsRUFDb0I7SUFDL0IsSUFBSSxDQUFDeEQsUUFBUSxDQUFDb0YsT0FBTyxDQUFDLEVBQUU7TUFDdEIsTUFBTSxJQUFJQyxTQUFTLENBQUMsb0NBQW9DLENBQUM7SUFDM0Q7SUFDQSxJQUFJLENBQUNsRixRQUFRLENBQUN1SSxPQUFPLENBQUMsSUFBSSxDQUFDMUksUUFBUSxDQUFDMEksT0FBTyxDQUFDLEVBQUU7TUFDNUM7TUFDQSxNQUFNLElBQUlyRCxTQUFTLENBQUMsZ0RBQWdELENBQUM7SUFDdkU7SUFDQXNELGFBQWEsQ0FBQ2QsT0FBTyxDQUFFSyxVQUFVLElBQUs7TUFDcEMsSUFBSSxDQUFDbkksUUFBUSxDQUFDbUksVUFBVSxDQUFDLEVBQUU7UUFDekIsTUFBTSxJQUFJN0MsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO01BQzlEO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsSUFBSSxDQUFDbEYsUUFBUSxDQUFDcUQsTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJNkIsU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBQ0EsSUFBSSxDQUFDRCxPQUFPLENBQUNjLE9BQU8sRUFBRTtNQUNwQmQsT0FBTyxDQUFDYyxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQ3RCO0lBQ0EsSUFBSWQsT0FBTyxDQUFDYSxNQUFNLEtBQUssTUFBTSxJQUFJYixPQUFPLENBQUNhLE1BQU0sS0FBSyxLQUFLLElBQUliLE9BQU8sQ0FBQ2EsTUFBTSxLQUFLLFFBQVEsRUFBRTtNQUN4RmIsT0FBTyxDQUFDYyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsR0FBR3dDLE9BQU8sQ0FBQ0UsTUFBTSxDQUFDOUIsUUFBUSxDQUFDLENBQUM7SUFDL0Q7SUFDQSxNQUFNK0IsU0FBUyxHQUFHLElBQUksQ0FBQ2hFLFlBQVksR0FBRzVELFFBQVEsQ0FBQ3lILE9BQU8sQ0FBQyxHQUFHLEVBQUU7SUFDNUQsT0FBTyxJQUFJLENBQUNJLHNCQUFzQixDQUFDMUQsT0FBTyxFQUFFc0QsT0FBTyxFQUFFRyxTQUFTLEVBQUVGLGFBQWEsRUFBRW5GLE1BQU0sQ0FBQztFQUN4Rjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTXVGLG9CQUFvQkEsQ0FDeEIzRCxPQUFzQixFQUN0QnNELE9BQWUsR0FBRyxFQUFFLEVBQ3BCTSxXQUFxQixHQUFHLENBQUMsR0FBRyxDQUFDLEVBQzdCeEYsTUFBTSxHQUFHLEVBQUUsRUFDZ0M7SUFDM0MsTUFBTXlGLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUNyRCxPQUFPLEVBQUVzRCxPQUFPLEVBQUVNLFdBQVcsRUFBRXhGLE1BQU0sQ0FBQztJQUM5RSxNQUFNakMsYUFBYSxDQUFDMEgsR0FBRyxDQUFDO0lBQ3hCLE9BQU9BLEdBQUc7RUFDWjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRSxNQUFNSCxzQkFBc0JBLENBQzFCMUQsT0FBc0IsRUFDdEI4RCxJQUE4QixFQUM5QkwsU0FBaUIsRUFDakJHLFdBQXFCLEVBQ3JCeEYsTUFBYyxFQUNpQjtJQUMvQixJQUFJLENBQUN4RCxRQUFRLENBQUNvRixPQUFPLENBQUMsRUFBRTtNQUN0QixNQUFNLElBQUlDLFNBQVMsQ0FBQyxvQ0FBb0MsQ0FBQztJQUMzRDtJQUNBLElBQUksRUFBRThELE1BQU0sQ0FBQ0MsUUFBUSxDQUFDRixJQUFJLENBQUMsSUFBSSxPQUFPQSxJQUFJLEtBQUssUUFBUSxJQUFJaEosZ0JBQWdCLENBQUNnSixJQUFJLENBQUMsQ0FBQyxFQUFFO01BQ2xGLE1BQU0sSUFBSTlLLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUNuQyw2REFBNkQsT0FBTzJGLElBQUksVUFDMUUsQ0FBQztJQUNIO0lBQ0EsSUFBSSxDQUFDL0ksUUFBUSxDQUFDMEksU0FBUyxDQUFDLEVBQUU7TUFDeEIsTUFBTSxJQUFJeEQsU0FBUyxDQUFDLHNDQUFzQyxDQUFDO0lBQzdEO0lBQ0EyRCxXQUFXLENBQUNuQixPQUFPLENBQUVLLFVBQVUsSUFBSztNQUNsQyxJQUFJLENBQUNuSSxRQUFRLENBQUNtSSxVQUFVLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUk3QyxTQUFTLENBQUMsdUNBQXVDLENBQUM7TUFDOUQ7SUFDRixDQUFDLENBQUM7SUFDRixJQUFJLENBQUNsRixRQUFRLENBQUNxRCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUk2QixTQUFTLENBQUMsbUNBQW1DLENBQUM7SUFDMUQ7SUFDQTtJQUNBLElBQUksQ0FBQyxJQUFJLENBQUNSLFlBQVksSUFBSWdFLFNBQVMsQ0FBQ0QsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUNoRCxNQUFNLElBQUl4SyxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxnRUFBZ0UsQ0FBQztJQUN6RztJQUNBO0lBQ0EsSUFBSSxJQUFJLENBQUNzQixZQUFZLElBQUlnRSxTQUFTLENBQUNELE1BQU0sS0FBSyxFQUFFLEVBQUU7TUFDaEQsTUFBTSxJQUFJeEssTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsdUJBQXVCc0YsU0FBUyxFQUFFLENBQUM7SUFDM0U7SUFFQSxNQUFNLElBQUksQ0FBQzdCLG9CQUFvQixDQUFDLENBQUM7O0lBRWpDO0lBQ0F4RCxNQUFNLEdBQUdBLE1BQU0sS0FBSyxNQUFNLElBQUksQ0FBQzZGLG9CQUFvQixDQUFDakUsT0FBTyxDQUFDSSxVQUFXLENBQUMsQ0FBQztJQUV6RSxNQUFNVCxVQUFVLEdBQUcsSUFBSSxDQUFDZ0IsaUJBQWlCLENBQUM7TUFBRSxHQUFHWCxPQUFPO01BQUU1QjtJQUFPLENBQUMsQ0FBQztJQUNqRSxJQUFJLENBQUMsSUFBSSxDQUFDaUIsU0FBUyxFQUFFO01BQ25CO01BQ0EsSUFBSSxDQUFDLElBQUksQ0FBQ0ksWUFBWSxFQUFFO1FBQ3RCZ0UsU0FBUyxHQUFHLGtCQUFrQjtNQUNoQztNQUNBLE1BQU1TLElBQUksR0FBRyxJQUFJQyxJQUFJLENBQUMsQ0FBQztNQUN2QnhFLFVBQVUsQ0FBQ21CLE9BQU8sQ0FBQyxZQUFZLENBQUMsR0FBR3hGLFlBQVksQ0FBQzRJLElBQUksQ0FBQztNQUNyRHZFLFVBQVUsQ0FBQ21CLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHMkMsU0FBUztNQUN0RCxJQUFJLElBQUksQ0FBQ3JFLFlBQVksRUFBRTtRQUNyQk8sVUFBVSxDQUFDbUIsT0FBTyxDQUFDLHNCQUFzQixDQUFDLEdBQUcsSUFBSSxDQUFDMUIsWUFBWTtNQUNoRTtNQUNBTyxVQUFVLENBQUNtQixPQUFPLENBQUNzRCxhQUFhLEdBQUcxSyxNQUFNLENBQUNpRyxVQUFVLEVBQUUsSUFBSSxDQUFDVCxTQUFTLEVBQUUsSUFBSSxDQUFDQyxTQUFTLEVBQUVmLE1BQU0sRUFBRThGLElBQUksRUFBRVQsU0FBUyxDQUFDO0lBQ2hIO0lBRUEsTUFBTXBCLFFBQVEsR0FBRyxNQUFNbkcsT0FBTyxDQUFDLElBQUksQ0FBQ3NDLFNBQVMsRUFBRW1CLFVBQVUsRUFBRW1FLElBQUksQ0FBQztJQUNoRSxJQUFJLENBQUN6QixRQUFRLENBQUNTLFVBQVUsRUFBRTtNQUN4QixNQUFNLElBQUloRixLQUFLLENBQUMseUNBQXlDLENBQUM7SUFDNUQ7SUFFQSxJQUFJLENBQUM4RixXQUFXLENBQUN0RCxRQUFRLENBQUMrQixRQUFRLENBQUNTLFVBQVUsQ0FBQyxFQUFFO01BQzlDO01BQ0E7TUFDQTtNQUNBO01BQ0E7TUFDQSxPQUFPLElBQUksQ0FBQ3ZELFNBQVMsQ0FBQ1MsT0FBTyxDQUFDSSxVQUFVLENBQUU7TUFFMUMsTUFBTWtDLEdBQUcsR0FBRyxNQUFNekYsVUFBVSxDQUFDd0gsa0JBQWtCLENBQUNoQyxRQUFRLENBQUM7TUFDekQsSUFBSSxDQUFDRCxPQUFPLENBQUN6QyxVQUFVLEVBQUUwQyxRQUFRLEVBQUVDLEdBQUcsQ0FBQztNQUN2QyxNQUFNQSxHQUFHO0lBQ1g7SUFFQSxJQUFJLENBQUNGLE9BQU8sQ0FBQ3pDLFVBQVUsRUFBRTBDLFFBQVEsQ0FBQztJQUVsQyxPQUFPQSxRQUFRO0VBQ2pCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBZ0I0QixvQkFBb0JBLENBQUM3RCxVQUFrQixFQUFtQjtJQUN4RSxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHlCQUF5QmxFLFVBQVUsRUFBRSxDQUFDO0lBQ2hGOztJQUVBO0lBQ0EsSUFBSSxJQUFJLENBQUNoQyxNQUFNLEVBQUU7TUFDZixPQUFPLElBQUksQ0FBQ0EsTUFBTTtJQUNwQjtJQUVBLE1BQU1tRyxNQUFNLEdBQUcsSUFBSSxDQUFDaEYsU0FBUyxDQUFDYSxVQUFVLENBQUM7SUFDekMsSUFBSW1FLE1BQU0sRUFBRTtNQUNWLE9BQU9BLE1BQU07SUFDZjtJQUVBLE1BQU1DLGtCQUFrQixHQUFHLE1BQU9uQyxRQUE4QixJQUFLO01BQ25FLE1BQU15QixJQUFJLEdBQUcsTUFBTXpILFlBQVksQ0FBQ2dHLFFBQVEsQ0FBQztNQUN6QyxNQUFNakUsTUFBTSxHQUFHdkIsVUFBVSxDQUFDNEgsaUJBQWlCLENBQUNYLElBQUksQ0FBQyxJQUFJM0ssY0FBYztNQUNuRSxJQUFJLENBQUNvRyxTQUFTLENBQUNhLFVBQVUsQ0FBQyxHQUFHaEMsTUFBTTtNQUNuQyxPQUFPQSxNQUFNO0lBQ2YsQ0FBQztJQUVELE1BQU15QyxNQUFNLEdBQUcsS0FBSztJQUNwQixNQUFNRSxLQUFLLEdBQUcsVUFBVTtJQUN4QjtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsTUFBTTlCLFNBQVMsR0FBRyxJQUFJLENBQUNBLFNBQVMsSUFBSSxDQUFDdEcsU0FBUztJQUM5QyxJQUFJeUYsTUFBYztJQUNsQixJQUFJO01BQ0YsTUFBTXlGLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7UUFBRXhDLE1BQU07UUFBRVQsVUFBVTtRQUFFVyxLQUFLO1FBQUU5QjtNQUFVLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRTlGLGNBQWMsQ0FBQztNQUM1RyxPQUFPcUwsa0JBQWtCLENBQUNYLEdBQUcsQ0FBQztJQUNoQyxDQUFDLENBQUMsT0FBTzNCLENBQUMsRUFBRTtNQUNWO01BQ0EsSUFBSUEsQ0FBQyxZQUFZbEosTUFBTSxDQUFDMEwsT0FBTyxFQUFFO1FBQy9CLE1BQU1DLE9BQU8sR0FBR3pDLENBQUMsQ0FBQzBDLElBQUk7UUFDdEIsTUFBTUMsU0FBUyxHQUFHM0MsQ0FBQyxDQUFDOUQsTUFBTTtRQUMxQixJQUFJdUcsT0FBTyxLQUFLLGNBQWMsSUFBSSxDQUFDRSxTQUFTLEVBQUU7VUFDNUMsT0FBTzFMLGNBQWM7UUFDdkI7TUFDRjtNQUNBO01BQ0E7TUFDQSxJQUFJLEVBQUUrSSxDQUFDLENBQUM0QyxJQUFJLEtBQUssOEJBQThCLENBQUMsRUFBRTtRQUNoRCxNQUFNNUMsQ0FBQztNQUNUO01BQ0E7TUFDQTlELE1BQU0sR0FBRzhELENBQUMsQ0FBQzZDLE1BQWdCO01BQzNCLElBQUksQ0FBQzNHLE1BQU0sRUFBRTtRQUNYLE1BQU04RCxDQUFDO01BQ1Q7SUFDRjtJQUVBLE1BQU0yQixHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUNSLGdCQUFnQixDQUFDO01BQUV4QyxNQUFNO01BQUVULFVBQVU7TUFBRVcsS0FBSztNQUFFOUI7SUFBVSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUViLE1BQU0sQ0FBQztJQUNwRyxPQUFPLE1BQU1vRyxrQkFBa0IsQ0FBQ1gsR0FBRyxDQUFDO0VBQ3RDOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0VtQixXQUFXQSxDQUNUaEYsT0FBc0IsRUFDdEJzRCxPQUFlLEdBQUcsRUFBRSxFQUNwQkMsYUFBdUIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUMvQm5GLE1BQU0sR0FBRyxFQUFFLEVBQ1g2RyxjQUF1QixFQUN2QkMsRUFBdUQsRUFDdkQ7SUFDQSxJQUFJQyxJQUFtQztJQUN2QyxJQUFJRixjQUFjLEVBQUU7TUFDbEJFLElBQUksR0FBRyxJQUFJLENBQUM5QixnQkFBZ0IsQ0FBQ3JELE9BQU8sRUFBRXNELE9BQU8sRUFBRUMsYUFBYSxFQUFFbkYsTUFBTSxDQUFDO0lBQ3ZFLENBQUMsTUFBTTtNQUNMO01BQ0E7TUFDQStHLElBQUksR0FBRyxJQUFJLENBQUN4QixvQkFBb0IsQ0FBQzNELE9BQU8sRUFBRXNELE9BQU8sRUFBRUMsYUFBYSxFQUFFbkYsTUFBTSxDQUFDO0lBQzNFO0lBRUErRyxJQUFJLENBQUNDLElBQUksQ0FDTkMsTUFBTSxJQUFLSCxFQUFFLENBQUMsSUFBSSxFQUFFRyxNQUFNLENBQUMsRUFDM0IvQyxHQUFHLElBQUs7TUFDUDtNQUNBO01BQ0E0QyxFQUFFLENBQUM1QyxHQUFHLENBQUM7SUFDVCxDQUNGLENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRWdELGlCQUFpQkEsQ0FDZnRGLE9BQXNCLEVBQ3RCeEgsTUFBZ0MsRUFDaENpTCxTQUFpQixFQUNqQkcsV0FBcUIsRUFDckJ4RixNQUFjLEVBQ2Q2RyxjQUF1QixFQUN2QkMsRUFBdUQsRUFDdkQ7SUFDQSxNQUFNSyxRQUFRLEdBQUcsTUFBQUEsQ0FBQSxLQUFZO01BQzNCLE1BQU0xQixHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUNILHNCQUFzQixDQUFDMUQsT0FBTyxFQUFFeEgsTUFBTSxFQUFFaUwsU0FBUyxFQUFFRyxXQUFXLEVBQUV4RixNQUFNLENBQUM7TUFDOUYsSUFBSSxDQUFDNkcsY0FBYyxFQUFFO1FBQ25CLE1BQU05SSxhQUFhLENBQUMwSCxHQUFHLENBQUM7TUFDMUI7TUFFQSxPQUFPQSxHQUFHO0lBQ1osQ0FBQztJQUVEMEIsUUFBUSxDQUFDLENBQUMsQ0FBQ0gsSUFBSSxDQUNaQyxNQUFNLElBQUtILEVBQUUsQ0FBQyxJQUFJLEVBQUVHLE1BQU0sQ0FBQztJQUM1QjtJQUNBO0lBQ0MvQyxHQUFHLElBQUs0QyxFQUFFLENBQUM1QyxHQUFHLENBQ2pCLENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7RUFDRWtELGVBQWVBLENBQUNwRixVQUFrQixFQUFFOEUsRUFBMEMsRUFBRTtJQUM5RSxPQUFPLElBQUksQ0FBQ2pCLG9CQUFvQixDQUFDN0QsVUFBVSxDQUFDLENBQUNnRixJQUFJLENBQzlDQyxNQUFNLElBQUtILEVBQUUsQ0FBQyxJQUFJLEVBQUVHLE1BQU0sQ0FBQztJQUM1QjtJQUNBO0lBQ0MvQyxHQUFHLElBQUs0QyxFQUFFLENBQUM1QyxHQUFHLENBQ2pCLENBQUM7RUFDSDs7RUFFQTs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFLE1BQU1tRCxVQUFVQSxDQUFDckYsVUFBa0IsRUFBRWhDLE1BQWMsR0FBRyxFQUFFLEVBQUVzSCxRQUF3QixFQUFpQjtJQUNqRyxJQUFJLENBQUMxSyxpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0E7SUFDQSxJQUFJeEYsUUFBUSxDQUFDd0QsTUFBTSxDQUFDLEVBQUU7TUFDcEJzSCxRQUFRLEdBQUd0SCxNQUFNO01BQ2pCQSxNQUFNLEdBQUcsRUFBRTtJQUNiO0lBRUEsSUFBSSxDQUFDckQsUUFBUSxDQUFDcUQsTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJNkIsU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBQ0EsSUFBSXlGLFFBQVEsSUFBSSxDQUFDOUssUUFBUSxDQUFDOEssUUFBUSxDQUFDLEVBQUU7TUFDbkMsTUFBTSxJQUFJekYsU0FBUyxDQUFDLHFDQUFxQyxDQUFDO0lBQzVEO0lBRUEsSUFBSXFELE9BQU8sR0FBRyxFQUFFOztJQUVoQjtJQUNBO0lBQ0EsSUFBSWxGLE1BQU0sSUFBSSxJQUFJLENBQUNBLE1BQU0sRUFBRTtNQUN6QixJQUFJQSxNQUFNLEtBQUssSUFBSSxDQUFDQSxNQUFNLEVBQUU7UUFDMUIsTUFBTSxJQUFJcEYsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMscUJBQXFCLElBQUksQ0FBQ0MsTUFBTSxlQUFlQSxNQUFNLEVBQUUsQ0FBQztNQUNoRztJQUNGO0lBQ0E7SUFDQTtJQUNBLElBQUlBLE1BQU0sSUFBSUEsTUFBTSxLQUFLakYsY0FBYyxFQUFFO01BQ3ZDbUssT0FBTyxHQUFHeEcsR0FBRyxDQUFDNkksV0FBVyxDQUFDO1FBQ3hCQyx5QkFBeUIsRUFBRTtVQUN6QkMsQ0FBQyxFQUFFO1lBQUVDLEtBQUssRUFBRTtVQUEwQyxDQUFDO1VBQ3ZEQyxrQkFBa0IsRUFBRTNIO1FBQ3RCO01BQ0YsQ0FBQyxDQUFDO0lBQ0o7SUFDQSxNQUFNeUMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUMsT0FBdUIsR0FBRyxDQUFDLENBQUM7SUFFbEMsSUFBSTRFLFFBQVEsSUFBSUEsUUFBUSxDQUFDTSxhQUFhLEVBQUU7TUFDdENsRixPQUFPLENBQUMsa0NBQWtDLENBQUMsR0FBRyxJQUFJO0lBQ3BEOztJQUVBO0lBQ0EsTUFBTW1GLFdBQVcsR0FBRyxJQUFJLENBQUM3SCxNQUFNLElBQUlBLE1BQU0sSUFBSWpGLGNBQWM7SUFFM0QsTUFBTStNLFVBQXlCLEdBQUc7TUFBRXJGLE1BQU07TUFBRVQsVUFBVTtNQUFFVTtJQUFRLENBQUM7SUFFakUsSUFBSTtNQUNGLE1BQU0sSUFBSSxDQUFDNkMsb0JBQW9CLENBQUN1QyxVQUFVLEVBQUU1QyxPQUFPLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRTJDLFdBQVcsQ0FBQztJQUMxRSxDQUFDLENBQUMsT0FBTzNELEdBQVksRUFBRTtNQUNyQixJQUFJbEUsTUFBTSxLQUFLLEVBQUUsSUFBSUEsTUFBTSxLQUFLakYsY0FBYyxFQUFFO1FBQzlDLElBQUltSixHQUFHLFlBQVl0SixNQUFNLENBQUMwTCxPQUFPLEVBQUU7VUFDakMsTUFBTUMsT0FBTyxHQUFHckMsR0FBRyxDQUFDc0MsSUFBSTtVQUN4QixNQUFNQyxTQUFTLEdBQUd2QyxHQUFHLENBQUNsRSxNQUFNO1VBQzVCLElBQUl1RyxPQUFPLEtBQUssOEJBQThCLElBQUlFLFNBQVMsS0FBSyxFQUFFLEVBQUU7WUFDbEU7WUFDQSxNQUFNLElBQUksQ0FBQ2xCLG9CQUFvQixDQUFDdUMsVUFBVSxFQUFFNUMsT0FBTyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUVxQixPQUFPLENBQUM7VUFDdEU7UUFDRjtNQUNGO01BQ0EsTUFBTXJDLEdBQUc7SUFDWDtFQUNGOztFQUVBO0FBQ0Y7QUFDQTtFQUNFLE1BQU02RCxZQUFZQSxDQUFDL0YsVUFBa0IsRUFBb0I7SUFDdkQsSUFBSSxDQUFDcEYsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLE1BQU1TLE1BQU0sR0FBRyxNQUFNO0lBQ3JCLElBQUk7TUFDRixNQUFNLElBQUksQ0FBQzhDLG9CQUFvQixDQUFDO1FBQUU5QyxNQUFNO1FBQUVUO01BQVcsQ0FBQyxDQUFDO0lBQ3pELENBQUMsQ0FBQyxPQUFPa0MsR0FBRyxFQUFFO01BQ1o7TUFDQSxJQUFJQSxHQUFHLENBQUNzQyxJQUFJLEtBQUssY0FBYyxJQUFJdEMsR0FBRyxDQUFDc0MsSUFBSSxLQUFLLFVBQVUsRUFBRTtRQUMxRCxPQUFPLEtBQUs7TUFDZDtNQUNBLE1BQU10QyxHQUFHO0lBQ1g7SUFFQSxPQUFPLElBQUk7RUFDYjs7RUFJQTtBQUNGO0FBQ0E7O0VBR0UsTUFBTThELFlBQVlBLENBQUNoRyxVQUFrQixFQUFpQjtJQUNwRCxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLFFBQVE7SUFDdkIsTUFBTSxJQUFJLENBQUM4QyxvQkFBb0IsQ0FBQztNQUFFOUMsTUFBTTtNQUFFVDtJQUFXLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNsRSxPQUFPLElBQUksQ0FBQ2IsU0FBUyxDQUFDYSxVQUFVLENBQUM7RUFDbkM7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBTWlHLFNBQVNBLENBQUNqRyxVQUFrQixFQUFFQyxVQUFrQixFQUFFaUcsT0FBdUIsRUFBNEI7SUFDekcsSUFBSSxDQUFDdEwsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxPQUFPLElBQUksQ0FBQ21HLGdCQUFnQixDQUFDcEcsVUFBVSxFQUFFQyxVQUFVLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRWlHLE9BQU8sQ0FBQztFQUNyRTs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUUsZ0JBQWdCQSxDQUNwQnBHLFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQm9HLE1BQWMsRUFDZGpELE1BQU0sR0FBRyxDQUFDLEVBQ1Y4QyxPQUF1QixFQUNHO0lBQzFCLElBQUksQ0FBQ3RMLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUNsRixpQkFBaUIsQ0FBQ21GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXJILE1BQU0sQ0FBQ3VOLHNCQUFzQixDQUFDLHdCQUF3QmxHLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDMUYsUUFBUSxDQUFDOEwsTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJeEcsU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBQ0EsSUFBSSxDQUFDdEYsUUFBUSxDQUFDNkksTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJdkQsU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBRUEsSUFBSXlHLEtBQUssR0FBRyxFQUFFO0lBQ2QsSUFBSUQsTUFBTSxJQUFJakQsTUFBTSxFQUFFO01BQ3BCLElBQUlpRCxNQUFNLEVBQUU7UUFDVkMsS0FBSyxHQUFHLFNBQVMsQ0FBQ0QsTUFBTSxHQUFHO01BQzdCLENBQUMsTUFBTTtRQUNMQyxLQUFLLEdBQUcsVUFBVTtRQUNsQkQsTUFBTSxHQUFHLENBQUM7TUFDWjtNQUNBLElBQUlqRCxNQUFNLEVBQUU7UUFDVmtELEtBQUssSUFBSSxHQUFHLENBQUNsRCxNQUFNLEdBQUdpRCxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ3BDO0lBQ0Y7SUFFQSxJQUFJMUYsS0FBSyxHQUFHLEVBQUU7SUFDZCxJQUFJRCxPQUF1QixHQUFHO01BQzVCLElBQUk0RixLQUFLLEtBQUssRUFBRSxJQUFJO1FBQUVBO01BQU0sQ0FBQztJQUMvQixDQUFDO0lBRUQsSUFBSUosT0FBTyxFQUFFO01BQ1gsTUFBTUssVUFBa0MsR0FBRztRQUN6QyxJQUFJTCxPQUFPLENBQUNNLG9CQUFvQixJQUFJO1VBQ2xDLGlEQUFpRCxFQUFFTixPQUFPLENBQUNNO1FBQzdELENBQUMsQ0FBQztRQUNGLElBQUlOLE9BQU8sQ0FBQ08sY0FBYyxJQUFJO1VBQUUsMkNBQTJDLEVBQUVQLE9BQU8sQ0FBQ087UUFBZSxDQUFDLENBQUM7UUFDdEcsSUFBSVAsT0FBTyxDQUFDUSxpQkFBaUIsSUFBSTtVQUMvQiwrQ0FBK0MsRUFBRVIsT0FBTyxDQUFDUTtRQUMzRCxDQUFDO01BQ0gsQ0FBQztNQUNEL0YsS0FBSyxHQUFHbEksRUFBRSxDQUFDb0ssU0FBUyxDQUFDcUQsT0FBTyxDQUFDO01BQzdCeEYsT0FBTyxHQUFHO1FBQ1IsR0FBR3JGLGVBQWUsQ0FBQ2tMLFVBQVUsQ0FBQztRQUM5QixHQUFHN0Y7TUFDTCxDQUFDO0lBQ0g7SUFFQSxNQUFNaUcsbUJBQW1CLEdBQUcsQ0FBQyxHQUFHLENBQUM7SUFDakMsSUFBSUwsS0FBSyxFQUFFO01BQ1RLLG1CQUFtQixDQUFDQyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQy9CO0lBQ0EsTUFBTW5HLE1BQU0sR0FBRyxLQUFLO0lBRXBCLE9BQU8sTUFBTSxJQUFJLENBQUN3QyxnQkFBZ0IsQ0FBQztNQUFFeEMsTUFBTTtNQUFFVCxVQUFVO01BQUVDLFVBQVU7TUFBRVMsT0FBTztNQUFFQztJQUFNLENBQUMsRUFBRSxFQUFFLEVBQUVnRyxtQkFBbUIsQ0FBQztFQUNqSDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRSxNQUFNRSxVQUFVQSxDQUFDN0csVUFBa0IsRUFBRUMsVUFBa0IsRUFBRTZHLFFBQWdCLEVBQUVaLE9BQXVCLEVBQWlCO0lBQ2pIO0lBQ0EsSUFBSSxDQUFDdEwsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUN0RixRQUFRLENBQUNtTSxRQUFRLENBQUMsRUFBRTtNQUN2QixNQUFNLElBQUlqSCxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7SUFFQSxNQUFNa0gsaUJBQWlCLEdBQUcsTUFBQUEsQ0FBQSxLQUE2QjtNQUNyRCxJQUFJQyxjQUErQjtNQUNuQyxNQUFNQyxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUNDLFVBQVUsQ0FBQ2xILFVBQVUsRUFBRUMsVUFBVSxFQUFFaUcsT0FBTyxDQUFDO01BQ3RFLE1BQU1pQixXQUFXLEdBQUd4RCxNQUFNLENBQUN5RCxJQUFJLENBQUNILE9BQU8sQ0FBQ0ksSUFBSSxDQUFDLENBQUMvRixRQUFRLENBQUMsUUFBUSxDQUFDO01BQ2hFLE1BQU1nRyxRQUFRLEdBQUcsR0FBR1IsUUFBUSxJQUFJSyxXQUFXLGFBQWE7TUFFeEQsTUFBTTVOLEdBQUcsQ0FBQ2dPLEtBQUssQ0FBQ3BQLElBQUksQ0FBQ3FQLE9BQU8sQ0FBQ1YsUUFBUSxDQUFDLEVBQUU7UUFBRVcsU0FBUyxFQUFFO01BQUssQ0FBQyxDQUFDO01BRTVELElBQUlwQixNQUFNLEdBQUcsQ0FBQztNQUNkLElBQUk7UUFDRixNQUFNcUIsS0FBSyxHQUFHLE1BQU1uTyxHQUFHLENBQUNvTyxJQUFJLENBQUNMLFFBQVEsQ0FBQztRQUN0QyxJQUFJTCxPQUFPLENBQUNXLElBQUksS0FBS0YsS0FBSyxDQUFDRSxJQUFJLEVBQUU7VUFDL0IsT0FBT04sUUFBUTtRQUNqQjtRQUNBakIsTUFBTSxHQUFHcUIsS0FBSyxDQUFDRSxJQUFJO1FBQ25CWixjQUFjLEdBQUdoUCxFQUFFLENBQUM2UCxpQkFBaUIsQ0FBQ1AsUUFBUSxFQUFFO1VBQUVRLEtBQUssRUFBRTtRQUFJLENBQUMsQ0FBQztNQUNqRSxDQUFDLENBQUMsT0FBT2hHLENBQUMsRUFBRTtRQUNWLElBQUlBLENBQUMsWUFBWXBFLEtBQUssSUFBS29FLENBQUMsQ0FBaUMwQyxJQUFJLEtBQUssUUFBUSxFQUFFO1VBQzlFO1VBQ0F3QyxjQUFjLEdBQUdoUCxFQUFFLENBQUM2UCxpQkFBaUIsQ0FBQ1AsUUFBUSxFQUFFO1lBQUVRLEtBQUssRUFBRTtVQUFJLENBQUMsQ0FBQztRQUNqRSxDQUFDLE1BQU07VUFDTDtVQUNBLE1BQU1oRyxDQUFDO1FBQ1Q7TUFDRjtNQUVBLE1BQU1pRyxjQUFjLEdBQUcsTUFBTSxJQUFJLENBQUMzQixnQkFBZ0IsQ0FBQ3BHLFVBQVUsRUFBRUMsVUFBVSxFQUFFb0csTUFBTSxFQUFFLENBQUMsRUFBRUgsT0FBTyxDQUFDO01BRTlGLE1BQU0xTSxhQUFhLENBQUN3TyxRQUFRLENBQUNELGNBQWMsRUFBRWYsY0FBYyxDQUFDO01BQzVELE1BQU1VLEtBQUssR0FBRyxNQUFNbk8sR0FBRyxDQUFDb08sSUFBSSxDQUFDTCxRQUFRLENBQUM7TUFDdEMsSUFBSUksS0FBSyxDQUFDRSxJQUFJLEtBQUtYLE9BQU8sQ0FBQ1csSUFBSSxFQUFFO1FBQy9CLE9BQU9OLFFBQVE7TUFDakI7TUFFQSxNQUFNLElBQUk1SixLQUFLLENBQUMsc0RBQXNELENBQUM7SUFDekUsQ0FBQztJQUVELE1BQU00SixRQUFRLEdBQUcsTUFBTVAsaUJBQWlCLENBQUMsQ0FBQztJQUMxQyxNQUFNeE4sR0FBRyxDQUFDME8sTUFBTSxDQUFDWCxRQUFRLEVBQUVSLFFBQVEsQ0FBQztFQUN0Qzs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFNSSxVQUFVQSxDQUFDbEgsVUFBa0IsRUFBRUMsVUFBa0IsRUFBRWlJLFFBQXlCLEVBQTJCO0lBQzNHLE1BQU1DLFVBQVUsR0FBR0QsUUFBUSxJQUFJLENBQUMsQ0FBQztJQUNqQyxJQUFJLENBQUN0TixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUVBLElBQUksQ0FBQ3pGLFFBQVEsQ0FBQzJOLFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSXZQLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLHFDQUFxQyxDQUFDO0lBQzlFO0lBRUEsTUFBTTRDLEtBQUssR0FBR2xJLEVBQUUsQ0FBQ29LLFNBQVMsQ0FBQ3NGLFVBQVUsQ0FBQztJQUN0QyxNQUFNMUgsTUFBTSxHQUFHLE1BQU07SUFDckIsTUFBTWdELEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ0Ysb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVO0lBQU0sQ0FBQyxDQUFDO0lBRXRGLE9BQU87TUFDTGlILElBQUksRUFBRVEsUUFBUSxDQUFDM0UsR0FBRyxDQUFDL0MsT0FBTyxDQUFDLGdCQUFnQixDQUFXLENBQUM7TUFDdkQySCxRQUFRLEVBQUV6TyxlQUFlLENBQUM2SixHQUFHLENBQUMvQyxPQUF5QixDQUFDO01BQ3hENEgsWUFBWSxFQUFFLElBQUl2RSxJQUFJLENBQUNOLEdBQUcsQ0FBQy9DLE9BQU8sQ0FBQyxlQUFlLENBQVcsQ0FBQztNQUM5RDZILFNBQVMsRUFBRXZPLFlBQVksQ0FBQ3lKLEdBQUcsQ0FBQy9DLE9BQXlCLENBQUM7TUFDdEQyRyxJQUFJLEVBQUU5TCxZQUFZLENBQUNrSSxHQUFHLENBQUMvQyxPQUFPLENBQUMyRyxJQUFJO0lBQ3JDLENBQUM7RUFDSDtFQUVBLE1BQU1tQixZQUFZQSxDQUFDeEksVUFBa0IsRUFBRUMsVUFBa0IsRUFBRXdJLFVBQTBCLEVBQWlCO0lBQ3BHLElBQUksQ0FBQzdOLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsd0JBQXdCbEUsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUNsRixpQkFBaUIsQ0FBQ21GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXJILE1BQU0sQ0FBQ3VOLHNCQUFzQixDQUFDLHdCQUF3QmxHLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBRUEsSUFBSXdJLFVBQVUsSUFBSSxDQUFDak8sUUFBUSxDQUFDaU8sVUFBVSxDQUFDLEVBQUU7TUFDdkMsTUFBTSxJQUFJN1AsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsdUNBQXVDLENBQUM7SUFDaEY7SUFFQSxNQUFNMEMsTUFBTSxHQUFHLFFBQVE7SUFFdkIsTUFBTUMsT0FBdUIsR0FBRyxDQUFDLENBQUM7SUFDbEMsSUFBSStILFVBQVUsYUFBVkEsVUFBVSxlQUFWQSxVQUFVLENBQUVDLGdCQUFnQixFQUFFO01BQ2hDaEksT0FBTyxDQUFDLG1DQUFtQyxDQUFDLEdBQUcsSUFBSTtJQUNyRDtJQUNBLElBQUkrSCxVQUFVLGFBQVZBLFVBQVUsZUFBVkEsVUFBVSxDQUFFRSxXQUFXLEVBQUU7TUFDM0JqSSxPQUFPLENBQUMsc0JBQXNCLENBQUMsR0FBRyxJQUFJO0lBQ3hDO0lBRUEsTUFBTWtJLFdBQW1DLEdBQUcsQ0FBQyxDQUFDO0lBQzlDLElBQUlILFVBQVUsYUFBVkEsVUFBVSxlQUFWQSxVQUFVLENBQUVGLFNBQVMsRUFBRTtNQUN6QkssV0FBVyxDQUFDTCxTQUFTLEdBQUcsR0FBR0UsVUFBVSxDQUFDRixTQUFTLEVBQUU7SUFDbkQ7SUFDQSxNQUFNNUgsS0FBSyxHQUFHbEksRUFBRSxDQUFDb0ssU0FBUyxDQUFDK0YsV0FBVyxDQUFDO0lBRXZDLE1BQU0sSUFBSSxDQUFDckYsb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVTLE9BQU87TUFBRUM7SUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0VBQ3JHOztFQUVBOztFQUVBa0kscUJBQXFCQSxDQUNuQkMsTUFBYyxFQUNkQyxNQUFjLEVBQ2R0QixTQUFrQixFQUMwQjtJQUM1QyxJQUFJc0IsTUFBTSxLQUFLdEwsU0FBUyxFQUFFO01BQ3hCc0wsTUFBTSxHQUFHLEVBQUU7SUFDYjtJQUNBLElBQUl0QixTQUFTLEtBQUtoSyxTQUFTLEVBQUU7TUFDM0JnSyxTQUFTLEdBQUcsS0FBSztJQUNuQjtJQUNBLElBQUksQ0FBQzdNLGlCQUFpQixDQUFDa08sTUFBTSxDQUFDLEVBQUU7TUFDOUIsTUFBTSxJQUFJbFEsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUc0RSxNQUFNLENBQUM7SUFDM0U7SUFDQSxJQUFJLENBQUM5TixhQUFhLENBQUMrTixNQUFNLENBQUMsRUFBRTtNQUMxQixNQUFNLElBQUluUSxNQUFNLENBQUNvUSxrQkFBa0IsQ0FBQyxvQkFBb0JELE1BQU0sRUFBRSxDQUFDO0lBQ25FO0lBQ0EsSUFBSSxDQUFDM08sU0FBUyxDQUFDcU4sU0FBUyxDQUFDLEVBQUU7TUFDekIsTUFBTSxJQUFJNUgsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsTUFBTW9KLFNBQVMsR0FBR3hCLFNBQVMsR0FBRyxFQUFFLEdBQUcsR0FBRztJQUN0QyxJQUFJeUIsU0FBUyxHQUFHLEVBQUU7SUFDbEIsSUFBSUMsY0FBYyxHQUFHLEVBQUU7SUFDdkIsTUFBTUMsT0FBa0IsR0FBRyxFQUFFO0lBQzdCLElBQUlDLEtBQUssR0FBRyxLQUFLOztJQUVqQjtJQUNBLE1BQU1DLFVBQVUsR0FBRyxJQUFJbFIsTUFBTSxDQUFDbVIsUUFBUSxDQUFDO01BQUVDLFVBQVUsRUFBRTtJQUFLLENBQUMsQ0FBQztJQUM1REYsVUFBVSxDQUFDRyxLQUFLLEdBQUcsTUFBTTtNQUN2QjtNQUNBLElBQUlMLE9BQU8sQ0FBQ2hHLE1BQU0sRUFBRTtRQUNsQixPQUFPa0csVUFBVSxDQUFDMUMsSUFBSSxDQUFDd0MsT0FBTyxDQUFDTSxLQUFLLENBQUMsQ0FBQyxDQUFDO01BQ3pDO01BQ0EsSUFBSUwsS0FBSyxFQUFFO1FBQ1QsT0FBT0MsVUFBVSxDQUFDMUMsSUFBSSxDQUFDLElBQUksQ0FBQztNQUM5QjtNQUNBLElBQUksQ0FBQytDLDBCQUEwQixDQUFDYixNQUFNLEVBQUVDLE1BQU0sRUFBRUcsU0FBUyxFQUFFQyxjQUFjLEVBQUVGLFNBQVMsQ0FBQyxDQUFDakUsSUFBSSxDQUN2RkMsTUFBTSxJQUFLO1FBQ1Y7UUFDQTtRQUNBQSxNQUFNLENBQUMyRSxRQUFRLENBQUN2SCxPQUFPLENBQUUwRyxNQUFNLElBQUtLLE9BQU8sQ0FBQ3hDLElBQUksQ0FBQ21DLE1BQU0sQ0FBQyxDQUFDO1FBQ3pEMVEsS0FBSyxDQUFDd1IsVUFBVSxDQUNkNUUsTUFBTSxDQUFDbUUsT0FBTyxFQUNkLENBQUNVLE1BQU0sRUFBRWhGLEVBQUUsS0FBSztVQUNkO1VBQ0E7VUFDQTtVQUNBLElBQUksQ0FBQ2lGLFNBQVMsQ0FBQ2pCLE1BQU0sRUFBRWdCLE1BQU0sQ0FBQ0UsR0FBRyxFQUFFRixNQUFNLENBQUNHLFFBQVEsQ0FBQyxDQUFDakYsSUFBSSxDQUNyRGtGLEtBQWEsSUFBSztZQUNqQjtZQUNBO1lBQ0FKLE1BQU0sQ0FBQ2xDLElBQUksR0FBR3NDLEtBQUssQ0FBQ0MsTUFBTSxDQUFDLENBQUNDLEdBQUcsRUFBRUMsSUFBSSxLQUFLRCxHQUFHLEdBQUdDLElBQUksQ0FBQ3pDLElBQUksRUFBRSxDQUFDLENBQUM7WUFDN0R3QixPQUFPLENBQUN4QyxJQUFJLENBQUNrRCxNQUFNLENBQUM7WUFDcEJoRixFQUFFLENBQUMsQ0FBQztVQUNOLENBQUMsRUFDQTVDLEdBQVUsSUFBSzRDLEVBQUUsQ0FBQzVDLEdBQUcsQ0FDeEIsQ0FBQztRQUNILENBQUMsRUFDQUEsR0FBRyxJQUFLO1VBQ1AsSUFBSUEsR0FBRyxFQUFFO1lBQ1BvSCxVQUFVLENBQUNnQixJQUFJLENBQUMsT0FBTyxFQUFFcEksR0FBRyxDQUFDO1lBQzdCO1VBQ0Y7VUFDQSxJQUFJK0MsTUFBTSxDQUFDc0YsV0FBVyxFQUFFO1lBQ3RCckIsU0FBUyxHQUFHakUsTUFBTSxDQUFDdUYsYUFBYTtZQUNoQ3JCLGNBQWMsR0FBR2xFLE1BQU0sQ0FBQ3dGLGtCQUFrQjtVQUM1QyxDQUFDLE1BQU07WUFDTHBCLEtBQUssR0FBRyxJQUFJO1VBQ2Q7O1VBRUE7VUFDQTtVQUNBQyxVQUFVLENBQUNHLEtBQUssQ0FBQyxDQUFDO1FBQ3BCLENBQ0YsQ0FBQztNQUNILENBQUMsRUFDQTNILENBQUMsSUFBSztRQUNMd0gsVUFBVSxDQUFDZ0IsSUFBSSxDQUFDLE9BQU8sRUFBRXhJLENBQUMsQ0FBQztNQUM3QixDQUNGLENBQUM7SUFDSCxDQUFDO0lBQ0QsT0FBT3dILFVBQVU7RUFDbkI7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBTUssMEJBQTBCQSxDQUM5QjNKLFVBQWtCLEVBQ2xCK0ksTUFBYyxFQUNkRyxTQUFpQixFQUNqQkMsY0FBc0IsRUFDdEJGLFNBQWlCLEVBQ2E7SUFDOUIsSUFBSSxDQUFDck8saUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ3JGLFFBQVEsQ0FBQ29PLE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSWxKLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQ2xGLFFBQVEsQ0FBQ3VPLFNBQVMsQ0FBQyxFQUFFO01BQ3hCLE1BQU0sSUFBSXJKLFNBQVMsQ0FBQyxzQ0FBc0MsQ0FBQztJQUM3RDtJQUNBLElBQUksQ0FBQ2xGLFFBQVEsQ0FBQ3dPLGNBQWMsQ0FBQyxFQUFFO01BQzdCLE1BQU0sSUFBSXRKLFNBQVMsQ0FBQywyQ0FBMkMsQ0FBQztJQUNsRTtJQUNBLElBQUksQ0FBQ2xGLFFBQVEsQ0FBQ3NPLFNBQVMsQ0FBQyxFQUFFO01BQ3hCLE1BQU0sSUFBSXBKLFNBQVMsQ0FBQyxzQ0FBc0MsQ0FBQztJQUM3RDtJQUNBLE1BQU02SyxPQUFPLEdBQUcsRUFBRTtJQUNsQkEsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLFVBQVVsTCxTQUFTLENBQUNxTixNQUFNLENBQUMsRUFBRSxDQUFDO0lBQzNDMkIsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLGFBQWFsTCxTQUFTLENBQUN1TixTQUFTLENBQUMsRUFBRSxDQUFDO0lBRWpELElBQUlDLFNBQVMsRUFBRTtNQUNid0IsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLGNBQWNsTCxTQUFTLENBQUN3TixTQUFTLENBQUMsRUFBRSxDQUFDO0lBQ3BEO0lBQ0EsSUFBSUMsY0FBYyxFQUFFO01BQ2xCdUIsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLG9CQUFvQnVDLGNBQWMsRUFBRSxDQUFDO0lBQ3BEO0lBRUEsTUFBTXdCLFVBQVUsR0FBRyxJQUFJO0lBQ3ZCRCxPQUFPLENBQUM5RCxJQUFJLENBQUMsZUFBZStELFVBQVUsRUFBRSxDQUFDO0lBQ3pDRCxPQUFPLENBQUNFLElBQUksQ0FBQyxDQUFDO0lBQ2RGLE9BQU8sQ0FBQ0csT0FBTyxDQUFDLFNBQVMsQ0FBQztJQUMxQixJQUFJbEssS0FBSyxHQUFHLEVBQUU7SUFDZCxJQUFJK0osT0FBTyxDQUFDdEgsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN0QnpDLEtBQUssR0FBRyxHQUFHK0osT0FBTyxDQUFDSSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUU7SUFDaEM7SUFDQSxNQUFNckssTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTWdELEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsQ0FBQztJQUN0RSxNQUFNK0MsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7SUFDcEMsT0FBT2hILFVBQVUsQ0FBQ3NPLGtCQUFrQixDQUFDckgsSUFBSSxDQUFDO0VBQzVDOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0UsTUFBTXNILDBCQUEwQkEsQ0FBQ2hMLFVBQWtCLEVBQUVDLFVBQWtCLEVBQUVTLE9BQXVCLEVBQW1CO0lBQ2pILElBQUksQ0FBQzlGLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUNsRixpQkFBaUIsQ0FBQ21GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXJILE1BQU0sQ0FBQ3VOLHNCQUFzQixDQUFDLHdCQUF3QmxHLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDekYsUUFBUSxDQUFDa0csT0FBTyxDQUFDLEVBQUU7TUFDdEIsTUFBTSxJQUFJOUgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0NBQXdDLENBQUM7SUFDbkY7SUFDQSxNQUFNMUYsTUFBTSxHQUFHLE1BQU07SUFDckIsTUFBTUUsS0FBSyxHQUFHLFNBQVM7SUFDdkIsTUFBTThDLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVLEtBQUs7TUFBRUQ7SUFBUSxDQUFDLENBQUM7SUFDM0YsTUFBTWdELElBQUksR0FBRyxNQUFNMUgsWUFBWSxDQUFDeUgsR0FBRyxDQUFDO0lBQ3BDLE9BQU9ySCxzQkFBc0IsQ0FBQ3NILElBQUksQ0FBQ3BDLFFBQVEsQ0FBQyxDQUFDLENBQUM7RUFDaEQ7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRSxNQUFNMkosb0JBQW9CQSxDQUFDakwsVUFBa0IsRUFBRUMsVUFBa0IsRUFBRWdLLFFBQWdCLEVBQWlCO0lBQ2xHLE1BQU14SixNQUFNLEdBQUcsUUFBUTtJQUN2QixNQUFNRSxLQUFLLEdBQUcsWUFBWXNKLFFBQVEsRUFBRTtJQUVwQyxNQUFNaUIsY0FBYyxHQUFHO01BQUV6SyxNQUFNO01BQUVULFVBQVU7TUFBRUMsVUFBVSxFQUFFQSxVQUFVO01BQUVVO0lBQU0sQ0FBQztJQUM1RSxNQUFNLElBQUksQ0FBQzRDLG9CQUFvQixDQUFDMkgsY0FBYyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0VBQzVEO0VBRUEsTUFBTUMsWUFBWUEsQ0FBQ25MLFVBQWtCLEVBQUVDLFVBQWtCLEVBQStCO0lBQUEsSUFBQW1MLGFBQUE7SUFDdEYsSUFBSSxDQUFDeFEsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFFQSxJQUFJb0wsWUFBZ0U7SUFDcEUsSUFBSW5DLFNBQVMsR0FBRyxFQUFFO0lBQ2xCLElBQUlDLGNBQWMsR0FBRyxFQUFFO0lBQ3ZCLFNBQVM7TUFDUCxNQUFNbEUsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDMEUsMEJBQTBCLENBQUMzSixVQUFVLEVBQUVDLFVBQVUsRUFBRWlKLFNBQVMsRUFBRUMsY0FBYyxFQUFFLEVBQUUsQ0FBQztNQUMzRyxLQUFLLE1BQU1XLE1BQU0sSUFBSTdFLE1BQU0sQ0FBQ21FLE9BQU8sRUFBRTtRQUNuQyxJQUFJVSxNQUFNLENBQUNFLEdBQUcsS0FBSy9KLFVBQVUsRUFBRTtVQUM3QixJQUFJLENBQUNvTCxZQUFZLElBQUl2QixNQUFNLENBQUN3QixTQUFTLENBQUNDLE9BQU8sQ0FBQyxDQUFDLEdBQUdGLFlBQVksQ0FBQ0MsU0FBUyxDQUFDQyxPQUFPLENBQUMsQ0FBQyxFQUFFO1lBQ2xGRixZQUFZLEdBQUd2QixNQUFNO1VBQ3ZCO1FBQ0Y7TUFDRjtNQUNBLElBQUk3RSxNQUFNLENBQUNzRixXQUFXLEVBQUU7UUFDdEJyQixTQUFTLEdBQUdqRSxNQUFNLENBQUN1RixhQUFhO1FBQ2hDckIsY0FBYyxHQUFHbEUsTUFBTSxDQUFDd0Ysa0JBQWtCO1FBQzFDO01BQ0Y7TUFFQTtJQUNGO0lBQ0EsUUFBQVcsYUFBQSxHQUFPQyxZQUFZLGNBQUFELGFBQUEsdUJBQVpBLGFBQUEsQ0FBY25CLFFBQVE7RUFDL0I7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBTXVCLHVCQUF1QkEsQ0FDM0J4TCxVQUFrQixFQUNsQkMsVUFBa0IsRUFDbEJnSyxRQUFnQixFQUNoQndCLEtBR0csRUFDa0Q7SUFDckQsSUFBSSxDQUFDN1EsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUN0RixRQUFRLENBQUNzUCxRQUFRLENBQUMsRUFBRTtNQUN2QixNQUFNLElBQUlwSyxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7SUFDQSxJQUFJLENBQUNyRixRQUFRLENBQUNpUixLQUFLLENBQUMsRUFBRTtNQUNwQixNQUFNLElBQUk1TCxTQUFTLENBQUMsaUNBQWlDLENBQUM7SUFDeEQ7SUFFQSxJQUFJLENBQUNvSyxRQUFRLEVBQUU7TUFDYixNQUFNLElBQUlyUixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQywwQkFBMEIsQ0FBQztJQUNuRTtJQUVBLE1BQU0wQyxNQUFNLEdBQUcsTUFBTTtJQUNyQixNQUFNRSxLQUFLLEdBQUcsWUFBWWpGLFNBQVMsQ0FBQ3VPLFFBQVEsQ0FBQyxFQUFFO0lBRS9DLE1BQU15QixPQUFPLEdBQUcsSUFBSWhULE1BQU0sQ0FBQ2lFLE9BQU8sQ0FBQyxDQUFDO0lBQ3BDLE1BQU11RyxPQUFPLEdBQUd3SSxPQUFPLENBQUNuRyxXQUFXLENBQUM7TUFDbENvRyx1QkFBdUIsRUFBRTtRQUN2QmxHLENBQUMsRUFBRTtVQUNEQyxLQUFLLEVBQUU7UUFDVCxDQUFDO1FBQ0RrRyxJQUFJLEVBQUVILEtBQUssQ0FBQ0ksR0FBRyxDQUFFeEUsSUFBSSxJQUFLO1VBQ3hCLE9BQU87WUFDTHlFLFVBQVUsRUFBRXpFLElBQUksQ0FBQzBFLElBQUk7WUFDckJDLElBQUksRUFBRTNFLElBQUksQ0FBQ0E7VUFDYixDQUFDO1FBQ0gsQ0FBQztNQUNIO0lBQ0YsQ0FBQyxDQUFDO0lBRUYsTUFBTTVELEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVO0lBQU0sQ0FBQyxFQUFFdUMsT0FBTyxDQUFDO0lBQzNGLE1BQU1RLElBQUksR0FBRyxNQUFNMUgsWUFBWSxDQUFDeUgsR0FBRyxDQUFDO0lBQ3BDLE1BQU13QixNQUFNLEdBQUc5SSxzQkFBc0IsQ0FBQ3VILElBQUksQ0FBQ3BDLFFBQVEsQ0FBQyxDQUFDLENBQUM7SUFDdEQsSUFBSSxDQUFDMkQsTUFBTSxFQUFFO01BQ1gsTUFBTSxJQUFJdkgsS0FBSyxDQUFDLHNDQUFzQyxDQUFDO0lBQ3pEO0lBRUEsSUFBSXVILE1BQU0sQ0FBQ1YsT0FBTyxFQUFFO01BQ2xCO01BQ0EsTUFBTSxJQUFJM0wsTUFBTSxDQUFDMEwsT0FBTyxDQUFDVyxNQUFNLENBQUNnSCxVQUFVLENBQUM7SUFDN0M7SUFFQSxPQUFPO01BQ0w7TUFDQTtNQUNBNUUsSUFBSSxFQUFFcEMsTUFBTSxDQUFDb0MsSUFBYztNQUMzQmtCLFNBQVMsRUFBRXZPLFlBQVksQ0FBQ3lKLEdBQUcsQ0FBQy9DLE9BQXlCO0lBQ3ZELENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFnQnFKLFNBQVNBLENBQUMvSixVQUFrQixFQUFFQyxVQUFrQixFQUFFZ0ssUUFBZ0IsRUFBMkI7SUFDM0csSUFBSSxDQUFDclAsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUN0RixRQUFRLENBQUNzUCxRQUFRLENBQUMsRUFBRTtNQUN2QixNQUFNLElBQUlwSyxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7SUFDQSxJQUFJLENBQUNvSyxRQUFRLEVBQUU7TUFDYixNQUFNLElBQUlyUixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQywwQkFBMEIsQ0FBQztJQUNuRTtJQUVBLE1BQU1tTSxLQUFxQixHQUFHLEVBQUU7SUFDaEMsSUFBSWdDLE1BQU0sR0FBRyxDQUFDO0lBQ2QsSUFBSWpILE1BQU07SUFDVixHQUFHO01BQ0RBLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ2tILGNBQWMsQ0FBQ25NLFVBQVUsRUFBRUMsVUFBVSxFQUFFZ0ssUUFBUSxFQUFFaUMsTUFBTSxDQUFDO01BQzVFQSxNQUFNLEdBQUdqSCxNQUFNLENBQUNpSCxNQUFNO01BQ3RCaEMsS0FBSyxDQUFDdEQsSUFBSSxDQUFDLEdBQUczQixNQUFNLENBQUNpRixLQUFLLENBQUM7SUFDN0IsQ0FBQyxRQUFRakYsTUFBTSxDQUFDc0YsV0FBVztJQUUzQixPQUFPTCxLQUFLO0VBQ2Q7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBY2lDLGNBQWNBLENBQUNuTSxVQUFrQixFQUFFQyxVQUFrQixFQUFFZ0ssUUFBZ0IsRUFBRWlDLE1BQWMsRUFBRTtJQUNyRyxJQUFJLENBQUN0UixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ3RGLFFBQVEsQ0FBQ3NQLFFBQVEsQ0FBQyxFQUFFO01BQ3ZCLE1BQU0sSUFBSXBLLFNBQVMsQ0FBQyxxQ0FBcUMsQ0FBQztJQUM1RDtJQUNBLElBQUksQ0FBQ3RGLFFBQVEsQ0FBQzJSLE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSXJNLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQ29LLFFBQVEsRUFBRTtNQUNiLE1BQU0sSUFBSXJSLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLDBCQUEwQixDQUFDO0lBQ25FO0lBRUEsSUFBSTRDLEtBQUssR0FBRyxZQUFZakYsU0FBUyxDQUFDdU8sUUFBUSxDQUFDLEVBQUU7SUFDN0MsSUFBSWlDLE1BQU0sRUFBRTtNQUNWdkwsS0FBSyxJQUFJLHVCQUF1QnVMLE1BQU0sRUFBRTtJQUMxQztJQUVBLE1BQU16TCxNQUFNLEdBQUcsS0FBSztJQUNwQixNQUFNZ0QsR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDUixnQkFBZ0IsQ0FBQztNQUFFeEMsTUFBTTtNQUFFVCxVQUFVO01BQUVDLFVBQVU7TUFBRVU7SUFBTSxDQUFDLENBQUM7SUFDbEYsT0FBT2xFLFVBQVUsQ0FBQzJQLGNBQWMsQ0FBQyxNQUFNblEsWUFBWSxDQUFDd0gsR0FBRyxDQUFDLENBQUM7RUFDM0Q7RUFFQSxNQUFNNEksV0FBV0EsQ0FBQSxFQUFrQztJQUNqRCxNQUFNNUwsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTTZMLFVBQVUsR0FBRyxJQUFJLENBQUN0TyxNQUFNLElBQUlqRixjQUFjO0lBQ2hELE1BQU13VCxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUN0SixnQkFBZ0IsQ0FBQztNQUFFeEM7SUFBTyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUU2TCxVQUFVLENBQUM7SUFDOUUsTUFBTUUsU0FBUyxHQUFHLE1BQU12USxZQUFZLENBQUNzUSxPQUFPLENBQUM7SUFDN0MsT0FBTzlQLFVBQVUsQ0FBQ2dRLGVBQWUsQ0FBQ0QsU0FBUyxDQUFDO0VBQzlDOztFQUVBO0FBQ0Y7QUFDQTtFQUNFRSxpQkFBaUJBLENBQUM5RSxJQUFZLEVBQUU7SUFDOUIsSUFBSSxDQUFDck4sUUFBUSxDQUFDcU4sSUFBSSxDQUFDLEVBQUU7TUFDbkIsTUFBTSxJQUFJL0gsU0FBUyxDQUFDLGlDQUFpQyxDQUFDO0lBQ3hEO0lBQ0EsSUFBSStILElBQUksR0FBRyxJQUFJLENBQUN2SyxhQUFhLEVBQUU7TUFDN0IsTUFBTSxJQUFJd0MsU0FBUyxDQUFDLGdDQUFnQyxJQUFJLENBQUN4QyxhQUFhLEVBQUUsQ0FBQztJQUMzRTtJQUNBLElBQUksSUFBSSxDQUFDK0IsZ0JBQWdCLEVBQUU7TUFDekIsT0FBTyxJQUFJLENBQUNqQyxRQUFRO0lBQ3RCO0lBQ0EsSUFBSUEsUUFBUSxHQUFHLElBQUksQ0FBQ0EsUUFBUTtJQUM1QixTQUFTO01BQ1A7TUFDQTtNQUNBLElBQUlBLFFBQVEsR0FBRyxLQUFLLEdBQUd5SyxJQUFJLEVBQUU7UUFDM0IsT0FBT3pLLFFBQVE7TUFDakI7TUFDQTtNQUNBQSxRQUFRLElBQUksRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJO0lBQzlCO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBTXdQLFVBQVVBLENBQUMzTSxVQUFrQixFQUFFQyxVQUFrQixFQUFFNkcsUUFBZ0IsRUFBRXVCLFFBQXlCLEVBQUU7SUFDcEcsSUFBSSxDQUFDek4saUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFFQSxJQUFJLENBQUN0RixRQUFRLENBQUNtTSxRQUFRLENBQUMsRUFBRTtNQUN2QixNQUFNLElBQUlqSCxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7SUFDQSxJQUFJd0ksUUFBUSxJQUFJLENBQUM3TixRQUFRLENBQUM2TixRQUFRLENBQUMsRUFBRTtNQUNuQyxNQUFNLElBQUl4SSxTQUFTLENBQUMscUNBQXFDLENBQUM7SUFDNUQ7O0lBRUE7SUFDQXdJLFFBQVEsR0FBR25PLGlCQUFpQixDQUFDbU8sUUFBUSxJQUFJLENBQUMsQ0FBQyxFQUFFdkIsUUFBUSxDQUFDO0lBQ3RELE1BQU1hLElBQUksR0FBRyxNQUFNcE8sR0FBRyxDQUFDb08sSUFBSSxDQUFDYixRQUFRLENBQUM7SUFDckMsT0FBTyxNQUFNLElBQUksQ0FBQzhGLFNBQVMsQ0FBQzVNLFVBQVUsRUFBRUMsVUFBVSxFQUFFakksRUFBRSxDQUFDNlUsZ0JBQWdCLENBQUMvRixRQUFRLENBQUMsRUFBRWEsSUFBSSxDQUFDQyxJQUFJLEVBQUVTLFFBQVEsQ0FBQztFQUN6Rzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFLE1BQU11RSxTQUFTQSxDQUNiNU0sVUFBa0IsRUFDbEJDLFVBQWtCLEVBQ2xCN0gsTUFBeUMsRUFDekN3UCxJQUFhLEVBQ2JTLFFBQTZCLEVBQ0E7SUFDN0IsSUFBSSxDQUFDek4saUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx3QkFBd0JsRSxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7O0lBRUE7SUFDQTtJQUNBLElBQUl6RixRQUFRLENBQUNvTixJQUFJLENBQUMsRUFBRTtNQUNsQlMsUUFBUSxHQUFHVCxJQUFJO0lBQ2pCO0lBQ0E7SUFDQSxNQUFNbEgsT0FBTyxHQUFHckYsZUFBZSxDQUFDZ04sUUFBUSxDQUFDO0lBQ3pDLElBQUksT0FBT2pRLE1BQU0sS0FBSyxRQUFRLElBQUlBLE1BQU0sWUFBWXVMLE1BQU0sRUFBRTtNQUMxRDtNQUNBaUUsSUFBSSxHQUFHeFAsTUFBTSxDQUFDZ0wsTUFBTTtNQUNwQmhMLE1BQU0sR0FBR2tELGNBQWMsQ0FBQ2xELE1BQU0sQ0FBQztJQUNqQyxDQUFDLE1BQU0sSUFBSSxDQUFDc0MsZ0JBQWdCLENBQUN0QyxNQUFNLENBQUMsRUFBRTtNQUNwQyxNQUFNLElBQUl5SCxTQUFTLENBQUMsNEVBQTRFLENBQUM7SUFDbkc7SUFFQSxJQUFJdEYsUUFBUSxDQUFDcU4sSUFBSSxDQUFDLElBQUlBLElBQUksR0FBRyxDQUFDLEVBQUU7TUFDOUIsTUFBTSxJQUFJaFAsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsd0NBQXdDNkosSUFBSSxFQUFFLENBQUM7SUFDdkY7O0lBRUE7SUFDQTtJQUNBLElBQUksQ0FBQ3JOLFFBQVEsQ0FBQ3FOLElBQUksQ0FBQyxFQUFFO01BQ25CQSxJQUFJLEdBQUcsSUFBSSxDQUFDdkssYUFBYTtJQUMzQjs7SUFFQTtJQUNBO0lBQ0EsSUFBSXVLLElBQUksS0FBS25LLFNBQVMsRUFBRTtNQUN0QixNQUFNcVAsUUFBUSxHQUFHLE1BQU1qVCxnQkFBZ0IsQ0FBQ3pCLE1BQU0sQ0FBQztNQUMvQyxJQUFJMFUsUUFBUSxLQUFLLElBQUksRUFBRTtRQUNyQmxGLElBQUksR0FBR2tGLFFBQVE7TUFDakI7SUFDRjtJQUVBLElBQUksQ0FBQ3ZTLFFBQVEsQ0FBQ3FOLElBQUksQ0FBQyxFQUFFO01BQ25CO01BQ0FBLElBQUksR0FBRyxJQUFJLENBQUN2SyxhQUFhO0lBQzNCO0lBQ0EsSUFBSXVLLElBQUksS0FBSyxDQUFDLEVBQUU7TUFDZCxPQUFPLElBQUksQ0FBQ21GLFlBQVksQ0FBQy9NLFVBQVUsRUFBRUMsVUFBVSxFQUFFUyxPQUFPLEVBQUVpRCxNQUFNLENBQUN5RCxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDNUU7SUFFQSxNQUFNakssUUFBUSxHQUFHLElBQUksQ0FBQ3VQLGlCQUFpQixDQUFDOUUsSUFBSSxDQUFDO0lBQzdDLElBQUksT0FBT3hQLE1BQU0sS0FBSyxRQUFRLElBQUl1TCxNQUFNLENBQUNDLFFBQVEsQ0FBQ3hMLE1BQU0sQ0FBQyxJQUFJd1AsSUFBSSxJQUFJekssUUFBUSxFQUFFO01BQzdFLE1BQU02UCxHQUFHLEdBQUd0UyxnQkFBZ0IsQ0FBQ3RDLE1BQU0sQ0FBQyxHQUFHLE1BQU00RCxZQUFZLENBQUM1RCxNQUFNLENBQUMsR0FBR3VMLE1BQU0sQ0FBQ3lELElBQUksQ0FBQ2hQLE1BQU0sQ0FBQztNQUN2RixPQUFPLElBQUksQ0FBQzJVLFlBQVksQ0FBQy9NLFVBQVUsRUFBRUMsVUFBVSxFQUFFUyxPQUFPLEVBQUVzTSxHQUFHLENBQUM7SUFDaEU7SUFFQSxPQUFPLElBQUksQ0FBQ0MsWUFBWSxDQUFDak4sVUFBVSxFQUFFQyxVQUFVLEVBQUVTLE9BQU8sRUFBRXRJLE1BQU0sRUFBRStFLFFBQVEsQ0FBQztFQUM3RTs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFLE1BQWM0UCxZQUFZQSxDQUN4Qi9NLFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQlMsT0FBdUIsRUFDdkJzTSxHQUFXLEVBQ2tCO0lBQzdCLE1BQU07TUFBRUUsTUFBTTtNQUFFN0o7SUFBVSxDQUFDLEdBQUdwSixVQUFVLENBQUMrUyxHQUFHLEVBQUUsSUFBSSxDQUFDM04sWUFBWSxDQUFDO0lBQ2hFcUIsT0FBTyxDQUFDLGdCQUFnQixDQUFDLEdBQUdzTSxHQUFHLENBQUM1SixNQUFNO0lBQ3RDLElBQUksQ0FBQyxJQUFJLENBQUMvRCxZQUFZLEVBQUU7TUFDdEJxQixPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUd3TSxNQUFNO0lBQ2pDO0lBQ0EsTUFBTXpKLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ0gsc0JBQXNCLENBQzNDO01BQ0U3QyxNQUFNLEVBQUUsS0FBSztNQUNiVCxVQUFVO01BQ1ZDLFVBQVU7TUFDVlM7SUFDRixDQUFDLEVBQ0RzTSxHQUFHLEVBQ0gzSixTQUFTLEVBQ1QsQ0FBQyxHQUFHLENBQUMsRUFDTCxFQUNGLENBQUM7SUFDRCxNQUFNdEgsYUFBYSxDQUFDMEgsR0FBRyxDQUFDO0lBQ3hCLE9BQU87TUFDTDRELElBQUksRUFBRTlMLFlBQVksQ0FBQ2tJLEdBQUcsQ0FBQy9DLE9BQU8sQ0FBQzJHLElBQUksQ0FBQztNQUNwQ2tCLFNBQVMsRUFBRXZPLFlBQVksQ0FBQ3lKLEdBQUcsQ0FBQy9DLE9BQXlCO0lBQ3ZELENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFLE1BQWN1TSxZQUFZQSxDQUN4QmpOLFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQlMsT0FBdUIsRUFDdkJnRCxJQUFxQixFQUNyQnZHLFFBQWdCLEVBQ2E7SUFDN0I7SUFDQTtJQUNBLE1BQU1nUSxRQUE4QixHQUFHLENBQUMsQ0FBQzs7SUFFekM7SUFDQTtJQUNBLE1BQU1DLEtBQWEsR0FBRyxFQUFFO0lBRXhCLE1BQU1DLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDbEMsWUFBWSxDQUFDbkwsVUFBVSxFQUFFQyxVQUFVLENBQUM7SUFDeEUsSUFBSWdLLFFBQWdCO0lBQ3BCLElBQUksQ0FBQ29ELGdCQUFnQixFQUFFO01BQ3JCcEQsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZSwwQkFBMEIsQ0FBQ2hMLFVBQVUsRUFBRUMsVUFBVSxFQUFFUyxPQUFPLENBQUM7SUFDbkYsQ0FBQyxNQUFNO01BQ0x1SixRQUFRLEdBQUdvRCxnQkFBZ0I7TUFDM0IsTUFBTUMsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDdkQsU0FBUyxDQUFDL0osVUFBVSxFQUFFQyxVQUFVLEVBQUVvTixnQkFBZ0IsQ0FBQztNQUM5RUMsT0FBTyxDQUFDakwsT0FBTyxDQUFFUCxDQUFDLElBQUs7UUFDckJxTCxRQUFRLENBQUNyTCxDQUFDLENBQUNpSyxJQUFJLENBQUMsR0FBR2pLLENBQUM7TUFDdEIsQ0FBQyxDQUFDO0lBQ0o7SUFFQSxNQUFNeUwsUUFBUSxHQUFHLElBQUlqVixZQUFZLENBQUM7TUFBRXNQLElBQUksRUFBRXpLLFFBQVE7TUFBRXFRLFdBQVcsRUFBRTtJQUFNLENBQUMsQ0FBQzs7SUFFekU7SUFDQSxNQUFNLENBQUNoVixDQUFDLEVBQUVpVixDQUFDLENBQUMsR0FBRyxNQUFNQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUMvQixJQUFJRCxPQUFPLENBQUMsQ0FBQ0UsT0FBTyxFQUFFQyxNQUFNLEtBQUs7TUFDL0JuSyxJQUFJLENBQUNvSyxJQUFJLENBQUNQLFFBQVEsQ0FBQyxDQUFDUSxFQUFFLENBQUMsT0FBTyxFQUFFRixNQUFNLENBQUM7TUFDdkNOLFFBQVEsQ0FBQ1EsRUFBRSxDQUFDLEtBQUssRUFBRUgsT0FBTyxDQUFDLENBQUNHLEVBQUUsQ0FBQyxPQUFPLEVBQUVGLE1BQU0sQ0FBQztJQUNqRCxDQUFDLENBQUMsRUFDRixDQUFDLFlBQVk7TUFDWCxJQUFJRyxVQUFVLEdBQUcsQ0FBQztNQUVsQixXQUFXLE1BQU1DLEtBQUssSUFBSVYsUUFBUSxFQUFFO1FBQ2xDLE1BQU1XLEdBQUcsR0FBR25XLE1BQU0sQ0FBQ29XLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQ0MsTUFBTSxDQUFDSCxLQUFLLENBQUMsQ0FBQ0ksTUFBTSxDQUFDLENBQUM7UUFFM0QsTUFBTUMsT0FBTyxHQUFHbkIsUUFBUSxDQUFDYSxVQUFVLENBQUM7UUFDcEMsSUFBSU0sT0FBTyxFQUFFO1VBQ1gsSUFBSUEsT0FBTyxDQUFDakgsSUFBSSxLQUFLNkcsR0FBRyxDQUFDNU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFO1lBQ3hDOEwsS0FBSyxDQUFDeEcsSUFBSSxDQUFDO2NBQUVtRixJQUFJLEVBQUVpQyxVQUFVO2NBQUUzRyxJQUFJLEVBQUVpSCxPQUFPLENBQUNqSDtZQUFLLENBQUMsQ0FBQztZQUNwRDJHLFVBQVUsRUFBRTtZQUNaO1VBQ0Y7UUFDRjtRQUVBQSxVQUFVLEVBQUU7O1FBRVo7UUFDQSxNQUFNcE8sT0FBc0IsR0FBRztVQUM3QmEsTUFBTSxFQUFFLEtBQUs7VUFDYkUsS0FBSyxFQUFFbEksRUFBRSxDQUFDb0ssU0FBUyxDQUFDO1lBQUVtTCxVQUFVO1lBQUUvRDtVQUFTLENBQUMsQ0FBQztVQUM3Q3ZKLE9BQU8sRUFBRTtZQUNQLGdCQUFnQixFQUFFdU4sS0FBSyxDQUFDN0ssTUFBTTtZQUM5QixhQUFhLEVBQUU4SyxHQUFHLENBQUM1TSxRQUFRLENBQUMsUUFBUTtVQUN0QyxDQUFDO1VBQ0R0QixVQUFVO1VBQ1ZDO1FBQ0YsQ0FBQztRQUVELE1BQU1nQyxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNzQixvQkFBb0IsQ0FBQzNELE9BQU8sRUFBRXFPLEtBQUssQ0FBQztRQUVoRSxJQUFJNUcsSUFBSSxHQUFHcEYsUUFBUSxDQUFDdkIsT0FBTyxDQUFDMkcsSUFBSTtRQUNoQyxJQUFJQSxJQUFJLEVBQUU7VUFDUkEsSUFBSSxHQUFHQSxJQUFJLENBQUM3RSxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDQSxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztRQUNqRCxDQUFDLE1BQU07VUFDTDZFLElBQUksR0FBRyxFQUFFO1FBQ1g7UUFFQStGLEtBQUssQ0FBQ3hHLElBQUksQ0FBQztVQUFFbUYsSUFBSSxFQUFFaUMsVUFBVTtVQUFFM0c7UUFBSyxDQUFDLENBQUM7TUFDeEM7TUFFQSxPQUFPLE1BQU0sSUFBSSxDQUFDbUUsdUJBQXVCLENBQUN4TCxVQUFVLEVBQUVDLFVBQVUsRUFBRWdLLFFBQVEsRUFBRW1ELEtBQUssQ0FBQztJQUNwRixDQUFDLEVBQUUsQ0FBQyxDQUNMLENBQUM7SUFFRixPQUFPSyxDQUFDO0VBQ1Y7RUFJQSxNQUFNYyx1QkFBdUJBLENBQUN2TyxVQUFrQixFQUFpQjtJQUMvRCxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLFFBQVE7SUFDdkIsTUFBTUUsS0FBSyxHQUFHLGFBQWE7SUFDM0IsTUFBTSxJQUFJLENBQUM0QyxvQkFBb0IsQ0FBQztNQUFFOUMsTUFBTTtNQUFFVCxVQUFVO01BQUVXO0lBQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLENBQUM7RUFDcEY7RUFJQSxNQUFNNk4sb0JBQW9CQSxDQUFDeE8sVUFBa0IsRUFBRXlPLGlCQUF3QyxFQUFFO0lBQ3ZGLElBQUksQ0FBQzdULGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUN4RixRQUFRLENBQUNpVSxpQkFBaUIsQ0FBQyxFQUFFO01BQ2hDLE1BQU0sSUFBSTdWLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLDhDQUE4QyxDQUFDO0lBQ3ZGLENBQUMsTUFBTTtNQUNMLElBQUl2RixDQUFDLENBQUM4QixPQUFPLENBQUNtVSxpQkFBaUIsQ0FBQ0MsSUFBSSxDQUFDLEVBQUU7UUFDckMsTUFBTSxJQUFJOVYsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsc0JBQXNCLENBQUM7TUFDL0QsQ0FBQyxNQUFNLElBQUkwUSxpQkFBaUIsQ0FBQ0MsSUFBSSxJQUFJLENBQUMvVCxRQUFRLENBQUM4VCxpQkFBaUIsQ0FBQ0MsSUFBSSxDQUFDLEVBQUU7UUFDdEUsTUFBTSxJQUFJOVYsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsd0JBQXdCLEVBQUUwUSxpQkFBaUIsQ0FBQ0MsSUFBSSxDQUFDO01BQ3pGO01BQ0EsSUFBSWxXLENBQUMsQ0FBQzhCLE9BQU8sQ0FBQ21VLGlCQUFpQixDQUFDRSxLQUFLLENBQUMsRUFBRTtRQUN0QyxNQUFNLElBQUkvVixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxnREFBZ0QsQ0FBQztNQUN6RjtJQUNGO0lBQ0EsTUFBTTBDLE1BQU0sR0FBRyxLQUFLO0lBQ3BCLE1BQU1FLEtBQUssR0FBRyxhQUFhO0lBQzNCLE1BQU1ELE9BQStCLEdBQUcsQ0FBQyxDQUFDO0lBRTFDLE1BQU1rTyx1QkFBdUIsR0FBRztNQUM5QkMsd0JBQXdCLEVBQUU7UUFDeEJDLElBQUksRUFBRUwsaUJBQWlCLENBQUNDLElBQUk7UUFDNUJLLElBQUksRUFBRU4saUJBQWlCLENBQUNFO01BQzFCO0lBQ0YsQ0FBQztJQUVELE1BQU1qRCxPQUFPLEdBQUcsSUFBSWhULE1BQU0sQ0FBQ2lFLE9BQU8sQ0FBQztNQUFFQyxVQUFVLEVBQUU7UUFBRUMsTUFBTSxFQUFFO01BQU0sQ0FBQztNQUFFQyxRQUFRLEVBQUU7SUFBSyxDQUFDLENBQUM7SUFDckYsTUFBTW9HLE9BQU8sR0FBR3dJLE9BQU8sQ0FBQ25HLFdBQVcsQ0FBQ3FKLHVCQUF1QixDQUFDO0lBQzVEbE8sT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHbEYsS0FBSyxDQUFDMEgsT0FBTyxDQUFDO0lBQ3ZDLE1BQU0sSUFBSSxDQUFDSyxvQkFBb0IsQ0FBQztNQUFFOUMsTUFBTTtNQUFFVCxVQUFVO01BQUVXLEtBQUs7TUFBRUQ7SUFBUSxDQUFDLEVBQUV3QyxPQUFPLENBQUM7RUFDbEY7RUFJQSxNQUFNOEwsb0JBQW9CQSxDQUFDaFAsVUFBa0IsRUFBRTtJQUM3QyxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLGFBQWE7SUFFM0IsTUFBTTRMLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ3RKLGdCQUFnQixDQUFDO01BQUV4QyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQzFGLE1BQU02TCxTQUFTLEdBQUcsTUFBTXZRLFlBQVksQ0FBQ3NRLE9BQU8sQ0FBQztJQUM3QyxPQUFPOVAsVUFBVSxDQUFDd1Msc0JBQXNCLENBQUN6QyxTQUFTLENBQUM7RUFDckQ7RUFRQSxNQUFNMEMsa0JBQWtCQSxDQUN0QmxQLFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQmlHLE9BQW1DLEVBQ1A7SUFDNUIsSUFBSSxDQUFDdEwsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFFQSxJQUFJaUcsT0FBTyxFQUFFO01BQ1gsSUFBSSxDQUFDMUwsUUFBUSxDQUFDMEwsT0FBTyxDQUFDLEVBQUU7UUFDdEIsTUFBTSxJQUFJckcsU0FBUyxDQUFDLG9DQUFvQyxDQUFDO01BQzNELENBQUMsTUFBTSxJQUFJb0IsTUFBTSxDQUFDa08sSUFBSSxDQUFDakosT0FBTyxDQUFDLENBQUM5QyxNQUFNLEdBQUcsQ0FBQyxJQUFJOEMsT0FBTyxDQUFDcUMsU0FBUyxJQUFJLENBQUM1TixRQUFRLENBQUN1TCxPQUFPLENBQUNxQyxTQUFTLENBQUMsRUFBRTtRQUMvRixNQUFNLElBQUkxSSxTQUFTLENBQUMsc0NBQXNDLEVBQUVxRyxPQUFPLENBQUNxQyxTQUFTLENBQUM7TUFDaEY7SUFDRjtJQUVBLE1BQU05SCxNQUFNLEdBQUcsS0FBSztJQUNwQixJQUFJRSxLQUFLLEdBQUcsWUFBWTtJQUV4QixJQUFJdUYsT0FBTyxhQUFQQSxPQUFPLGVBQVBBLE9BQU8sQ0FBRXFDLFNBQVMsRUFBRTtNQUN0QjVILEtBQUssSUFBSSxjQUFjdUYsT0FBTyxDQUFDcUMsU0FBUyxFQUFFO0lBQzVDO0lBRUEsTUFBTWdFLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ3RKLGdCQUFnQixDQUFDO01BQUV4QyxNQUFNO01BQUVULFVBQVU7TUFBRUMsVUFBVTtNQUFFVTtJQUFNLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNqRyxNQUFNeU8sTUFBTSxHQUFHLE1BQU1uVCxZQUFZLENBQUNzUSxPQUFPLENBQUM7SUFDMUMsT0FBT2pRLDBCQUEwQixDQUFDOFMsTUFBTSxDQUFDO0VBQzNDO0VBR0EsTUFBTUMsa0JBQWtCQSxDQUN0QnJQLFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQnFQLE9BQU8sR0FBRztJQUNSQyxNQUFNLEVBQUV2VyxpQkFBaUIsQ0FBQ3dXO0VBQzVCLENBQThCLEVBQ2Y7SUFDZixJQUFJLENBQUM1VSxpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUVBLElBQUksQ0FBQ3pGLFFBQVEsQ0FBQzhVLE9BQU8sQ0FBQyxFQUFFO01BQ3RCLE1BQU0sSUFBSXpQLFNBQVMsQ0FBQyxvQ0FBb0MsQ0FBQztJQUMzRCxDQUFDLE1BQU07TUFDTCxJQUFJLENBQUMsQ0FBQzdHLGlCQUFpQixDQUFDd1csT0FBTyxFQUFFeFcsaUJBQWlCLENBQUN5VyxRQUFRLENBQUMsQ0FBQ3ZQLFFBQVEsQ0FBQ29QLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFQyxNQUFNLENBQUMsRUFBRTtRQUN0RixNQUFNLElBQUkxUCxTQUFTLENBQUMsa0JBQWtCLEdBQUd5UCxPQUFPLENBQUNDLE1BQU0sQ0FBQztNQUMxRDtNQUNBLElBQUlELE9BQU8sQ0FBQy9HLFNBQVMsSUFBSSxDQUFDK0csT0FBTyxDQUFDL0csU0FBUyxDQUFDbkYsTUFBTSxFQUFFO1FBQ2xELE1BQU0sSUFBSXZELFNBQVMsQ0FBQyxzQ0FBc0MsR0FBR3lQLE9BQU8sQ0FBQy9HLFNBQVMsQ0FBQztNQUNqRjtJQUNGO0lBRUEsTUFBTTlILE1BQU0sR0FBRyxLQUFLO0lBQ3BCLElBQUlFLEtBQUssR0FBRyxZQUFZO0lBRXhCLElBQUkyTyxPQUFPLENBQUMvRyxTQUFTLEVBQUU7TUFDckI1SCxLQUFLLElBQUksY0FBYzJPLE9BQU8sQ0FBQy9HLFNBQVMsRUFBRTtJQUM1QztJQUVBLE1BQU1tSCxNQUFNLEdBQUc7TUFDYkMsTUFBTSxFQUFFTCxPQUFPLENBQUNDO0lBQ2xCLENBQUM7SUFFRCxNQUFNN0QsT0FBTyxHQUFHLElBQUloVCxNQUFNLENBQUNpRSxPQUFPLENBQUM7TUFBRWlULFFBQVEsRUFBRSxXQUFXO01BQUVoVCxVQUFVLEVBQUU7UUFBRUMsTUFBTSxFQUFFO01BQU0sQ0FBQztNQUFFQyxRQUFRLEVBQUU7SUFBSyxDQUFDLENBQUM7SUFDNUcsTUFBTW9HLE9BQU8sR0FBR3dJLE9BQU8sQ0FBQ25HLFdBQVcsQ0FBQ21LLE1BQU0sQ0FBQztJQUMzQyxNQUFNaFAsT0FBK0IsR0FBRyxDQUFDLENBQUM7SUFDMUNBLE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBR2xGLEtBQUssQ0FBQzBILE9BQU8sQ0FBQztJQUV2QyxNQUFNLElBQUksQ0FBQ0ssb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVLEtBQUs7TUFBRUQ7SUFBUSxDQUFDLEVBQUV3QyxPQUFPLENBQUM7RUFDOUY7O0VBRUE7QUFDRjtBQUNBO0VBQ0UsTUFBTTJNLGdCQUFnQkEsQ0FBQzdQLFVBQWtCLEVBQWtCO0lBQ3pELElBQUksQ0FBQ3BGLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsd0JBQXdCbEUsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFFQSxNQUFNUyxNQUFNLEdBQUcsS0FBSztJQUNwQixNQUFNRSxLQUFLLEdBQUcsU0FBUztJQUN2QixNQUFNdUssY0FBYyxHQUFHO01BQUV6SyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDO0lBRXBELE1BQU1zQixRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNnQixnQkFBZ0IsQ0FBQ2lJLGNBQWMsQ0FBQztJQUM1RCxNQUFNeEgsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUNnRyxRQUFRLENBQUM7SUFDekMsT0FBT3hGLFVBQVUsQ0FBQ3FULFlBQVksQ0FBQ3BNLElBQUksQ0FBQztFQUN0Qzs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFNcU0sZ0JBQWdCQSxDQUFDL1AsVUFBa0IsRUFBRUMsVUFBa0IsRUFBRWlHLE9BQXVCLEVBQWtCO0lBQ3RHLE1BQU16RixNQUFNLEdBQUcsS0FBSztJQUNwQixJQUFJRSxLQUFLLEdBQUcsU0FBUztJQUVyQixJQUFJLENBQUMvRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2pFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUlpRyxPQUFPLElBQUksQ0FBQzFMLFFBQVEsQ0FBQzBMLE9BQU8sQ0FBQyxFQUFFO01BQ2pDLE1BQU0sSUFBSXROLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLG9DQUFvQyxDQUFDO0lBQzdFO0lBRUEsSUFBSW1JLE9BQU8sSUFBSUEsT0FBTyxDQUFDcUMsU0FBUyxFQUFFO01BQ2hDNUgsS0FBSyxHQUFHLEdBQUdBLEtBQUssY0FBY3VGLE9BQU8sQ0FBQ3FDLFNBQVMsRUFBRTtJQUNuRDtJQUNBLE1BQU0yQyxjQUE2QixHQUFHO01BQUV6SyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDO0lBQ25FLElBQUlWLFVBQVUsRUFBRTtNQUNkaUwsY0FBYyxDQUFDLFlBQVksQ0FBQyxHQUFHakwsVUFBVTtJQUMzQztJQUVBLE1BQU1nQyxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNnQixnQkFBZ0IsQ0FBQ2lJLGNBQWMsQ0FBQztJQUM1RCxNQUFNeEgsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUNnRyxRQUFRLENBQUM7SUFDekMsT0FBT3hGLFVBQVUsQ0FBQ3FULFlBQVksQ0FBQ3BNLElBQUksQ0FBQztFQUN0Qzs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFNc00sZUFBZUEsQ0FBQ2hRLFVBQWtCLEVBQUVpUSxNQUFjLEVBQWlCO0lBQ3ZFO0lBQ0EsSUFBSSxDQUFDclYsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx3QkFBd0JsRSxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ3JGLFFBQVEsQ0FBQ3NWLE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSXJYLE1BQU0sQ0FBQ3NYLHdCQUF3QixDQUFDLDBCQUEwQkQsTUFBTSxxQkFBcUIsQ0FBQztJQUNsRztJQUVBLE1BQU10UCxLQUFLLEdBQUcsUUFBUTtJQUV0QixJQUFJRixNQUFNLEdBQUcsUUFBUTtJQUNyQixJQUFJd1AsTUFBTSxFQUFFO01BQ1Z4UCxNQUFNLEdBQUcsS0FBSztJQUNoQjtJQUVBLE1BQU0sSUFBSSxDQUFDOEMsb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsRUFBRXNQLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsQ0FBQztFQUNuRjs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFNRSxlQUFlQSxDQUFDblEsVUFBa0IsRUFBbUI7SUFDekQ7SUFDQSxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHdCQUF3QmxFLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBRUEsTUFBTVMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLFFBQVE7SUFDdEIsTUFBTThDLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsQ0FBQztJQUN0RSxPQUFPLE1BQU0xRSxZQUFZLENBQUN3SCxHQUFHLENBQUM7RUFDaEM7RUFFQSxNQUFNMk0sa0JBQWtCQSxDQUFDcFEsVUFBa0IsRUFBRUMsVUFBa0IsRUFBRW9RLGFBQXdCLEdBQUcsQ0FBQyxDQUFDLEVBQWlCO0lBQzdHLElBQUksQ0FBQ3pWLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsd0JBQXdCbEUsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUNsRixpQkFBaUIsQ0FBQ21GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXJILE1BQU0sQ0FBQ3VOLHNCQUFzQixDQUFDLHdCQUF3QmxHLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDekYsUUFBUSxDQUFDNlYsYUFBYSxDQUFDLEVBQUU7TUFDNUIsTUFBTSxJQUFJelgsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsMENBQTBDLENBQUM7SUFDbkYsQ0FBQyxNQUFNO01BQ0wsSUFBSXNTLGFBQWEsQ0FBQzNILGdCQUFnQixJQUFJLENBQUN0TyxTQUFTLENBQUNpVyxhQUFhLENBQUMzSCxnQkFBZ0IsQ0FBQyxFQUFFO1FBQ2hGLE1BQU0sSUFBSTlQLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLHVDQUF1Q3NTLGFBQWEsQ0FBQzNILGdCQUFnQixFQUFFLENBQUM7TUFDaEg7TUFDQSxJQUNFMkgsYUFBYSxDQUFDQyxJQUFJLElBQ2xCLENBQUMsQ0FBQ3BYLGVBQWUsQ0FBQ3FYLFVBQVUsRUFBRXJYLGVBQWUsQ0FBQ3NYLFVBQVUsQ0FBQyxDQUFDdFEsUUFBUSxDQUFDbVEsYUFBYSxDQUFDQyxJQUFJLENBQUMsRUFDdEY7UUFDQSxNQUFNLElBQUkxWCxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxrQ0FBa0NzUyxhQUFhLENBQUNDLElBQUksRUFBRSxDQUFDO01BQy9GO01BQ0EsSUFBSUQsYUFBYSxDQUFDSSxlQUFlLElBQUksQ0FBQzlWLFFBQVEsQ0FBQzBWLGFBQWEsQ0FBQ0ksZUFBZSxDQUFDLEVBQUU7UUFDN0UsTUFBTSxJQUFJN1gsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsc0NBQXNDc1MsYUFBYSxDQUFDSSxlQUFlLEVBQUUsQ0FBQztNQUM5RztNQUNBLElBQUlKLGFBQWEsQ0FBQzlILFNBQVMsSUFBSSxDQUFDNU4sUUFBUSxDQUFDMFYsYUFBYSxDQUFDOUgsU0FBUyxDQUFDLEVBQUU7UUFDakUsTUFBTSxJQUFJM1AsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsZ0NBQWdDc1MsYUFBYSxDQUFDOUgsU0FBUyxFQUFFLENBQUM7TUFDbEc7SUFDRjtJQUVBLE1BQU05SCxNQUFNLEdBQUcsS0FBSztJQUNwQixJQUFJRSxLQUFLLEdBQUcsV0FBVztJQUV2QixNQUFNRCxPQUF1QixHQUFHLENBQUMsQ0FBQztJQUNsQyxJQUFJMlAsYUFBYSxDQUFDM0gsZ0JBQWdCLEVBQUU7TUFDbENoSSxPQUFPLENBQUMsbUNBQW1DLENBQUMsR0FBRyxJQUFJO0lBQ3JEO0lBRUEsTUFBTWdMLE9BQU8sR0FBRyxJQUFJaFQsTUFBTSxDQUFDaUUsT0FBTyxDQUFDO01BQUVpVCxRQUFRLEVBQUUsV0FBVztNQUFFaFQsVUFBVSxFQUFFO1FBQUVDLE1BQU0sRUFBRTtNQUFNLENBQUM7TUFBRUMsUUFBUSxFQUFFO0lBQUssQ0FBQyxDQUFDO0lBQzVHLE1BQU1TLE1BQThCLEdBQUcsQ0FBQyxDQUFDO0lBRXpDLElBQUk4UyxhQUFhLENBQUNDLElBQUksRUFBRTtNQUN0Qi9TLE1BQU0sQ0FBQ21ULElBQUksR0FBR0wsYUFBYSxDQUFDQyxJQUFJO0lBQ2xDO0lBQ0EsSUFBSUQsYUFBYSxDQUFDSSxlQUFlLEVBQUU7TUFDakNsVCxNQUFNLENBQUNvVCxlQUFlLEdBQUdOLGFBQWEsQ0FBQ0ksZUFBZTtJQUN4RDtJQUNBLElBQUlKLGFBQWEsQ0FBQzlILFNBQVMsRUFBRTtNQUMzQjVILEtBQUssSUFBSSxjQUFjMFAsYUFBYSxDQUFDOUgsU0FBUyxFQUFFO0lBQ2xEO0lBRUEsTUFBTXJGLE9BQU8sR0FBR3dJLE9BQU8sQ0FBQ25HLFdBQVcsQ0FBQ2hJLE1BQU0sQ0FBQztJQUUzQ21ELE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBR2xGLEtBQUssQ0FBQzBILE9BQU8sQ0FBQztJQUN2QyxNQUFNLElBQUksQ0FBQ0ssb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVLEtBQUs7TUFBRUQ7SUFBUSxDQUFDLEVBQUV3QyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7RUFDMUc7RUFLQSxNQUFNME4sbUJBQW1CQSxDQUFDNVEsVUFBa0IsRUFBRTtJQUM1QyxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLGFBQWE7SUFFM0IsTUFBTTRMLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ3RKLGdCQUFnQixDQUFDO01BQUV4QyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDLENBQUM7SUFDMUUsTUFBTTZMLFNBQVMsR0FBRyxNQUFNdlEsWUFBWSxDQUFDc1EsT0FBTyxDQUFDO0lBQzdDLE9BQU85UCxVQUFVLENBQUNvVSxxQkFBcUIsQ0FBQ3JFLFNBQVMsQ0FBQztFQUNwRDtFQU9BLE1BQU1zRSxtQkFBbUJBLENBQUM5USxVQUFrQixFQUFFK1EsY0FBeUQsRUFBRTtJQUN2RyxNQUFNQyxjQUFjLEdBQUcsQ0FBQzlYLGVBQWUsQ0FBQ3FYLFVBQVUsRUFBRXJYLGVBQWUsQ0FBQ3NYLFVBQVUsQ0FBQztJQUMvRSxNQUFNUyxVQUFVLEdBQUcsQ0FBQzlYLHdCQUF3QixDQUFDK1gsSUFBSSxFQUFFL1gsd0JBQXdCLENBQUNnWSxLQUFLLENBQUM7SUFFbEYsSUFBSSxDQUFDdlcsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUVBLElBQUkrUSxjQUFjLENBQUNULElBQUksSUFBSSxDQUFDVSxjQUFjLENBQUM5USxRQUFRLENBQUM2USxjQUFjLENBQUNULElBQUksQ0FBQyxFQUFFO01BQ3hFLE1BQU0sSUFBSXpRLFNBQVMsQ0FBQyx3Q0FBd0NtUixjQUFjLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUlELGNBQWMsQ0FBQ0ssSUFBSSxJQUFJLENBQUNILFVBQVUsQ0FBQy9RLFFBQVEsQ0FBQzZRLGNBQWMsQ0FBQ0ssSUFBSSxDQUFDLEVBQUU7TUFDcEUsTUFBTSxJQUFJdlIsU0FBUyxDQUFDLHdDQUF3Q29SLFVBQVUsRUFBRSxDQUFDO0lBQzNFO0lBQ0EsSUFBSUYsY0FBYyxDQUFDTSxRQUFRLElBQUksQ0FBQzlXLFFBQVEsQ0FBQ3dXLGNBQWMsQ0FBQ00sUUFBUSxDQUFDLEVBQUU7TUFDakUsTUFBTSxJQUFJeFIsU0FBUyxDQUFDLDRDQUE0QyxDQUFDO0lBQ25FO0lBRUEsTUFBTVksTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLGFBQWE7SUFFM0IsTUFBTStPLE1BQTZCLEdBQUc7TUFDcEM0QixpQkFBaUIsRUFBRTtJQUNyQixDQUFDO0lBQ0QsTUFBTUMsVUFBVSxHQUFHdFEsTUFBTSxDQUFDa08sSUFBSSxDQUFDNEIsY0FBYyxDQUFDO0lBRTlDLE1BQU1TLFlBQVksR0FBRyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUNDLEtBQUssQ0FBRUMsR0FBRyxJQUFLSCxVQUFVLENBQUNyUixRQUFRLENBQUN3UixHQUFHLENBQUMsQ0FBQztJQUMxRjtJQUNBLElBQUlILFVBQVUsQ0FBQ25PLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDekIsSUFBSSxDQUFDb08sWUFBWSxFQUFFO1FBQ2pCLE1BQU0sSUFBSTNSLFNBQVMsQ0FDakIseUdBQ0YsQ0FBQztNQUNILENBQUMsTUFBTTtRQUNMNlAsTUFBTSxDQUFDWCxJQUFJLEdBQUc7VUFDWjRDLGdCQUFnQixFQUFFLENBQUM7UUFDckIsQ0FBQztRQUNELElBQUlaLGNBQWMsQ0FBQ1QsSUFBSSxFQUFFO1VBQ3ZCWixNQUFNLENBQUNYLElBQUksQ0FBQzRDLGdCQUFnQixDQUFDakIsSUFBSSxHQUFHSyxjQUFjLENBQUNULElBQUk7UUFDekQ7UUFDQSxJQUFJUyxjQUFjLENBQUNLLElBQUksS0FBS2pZLHdCQUF3QixDQUFDK1gsSUFBSSxFQUFFO1VBQ3pEeEIsTUFBTSxDQUFDWCxJQUFJLENBQUM0QyxnQkFBZ0IsQ0FBQ0MsSUFBSSxHQUFHYixjQUFjLENBQUNNLFFBQVE7UUFDN0QsQ0FBQyxNQUFNLElBQUlOLGNBQWMsQ0FBQ0ssSUFBSSxLQUFLalksd0JBQXdCLENBQUNnWSxLQUFLLEVBQUU7VUFDakV6QixNQUFNLENBQUNYLElBQUksQ0FBQzRDLGdCQUFnQixDQUFDRSxLQUFLLEdBQUdkLGNBQWMsQ0FBQ00sUUFBUTtRQUM5RDtNQUNGO0lBQ0Y7SUFFQSxNQUFNM0YsT0FBTyxHQUFHLElBQUloVCxNQUFNLENBQUNpRSxPQUFPLENBQUM7TUFDakNpVCxRQUFRLEVBQUUseUJBQXlCO01BQ25DaFQsVUFBVSxFQUFFO1FBQUVDLE1BQU0sRUFBRTtNQUFNLENBQUM7TUFDN0JDLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLE1BQU1vRyxPQUFPLEdBQUd3SSxPQUFPLENBQUNuRyxXQUFXLENBQUNtSyxNQUFNLENBQUM7SUFFM0MsTUFBTWhQLE9BQXVCLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDQSxPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUdsRixLQUFLLENBQUMwSCxPQUFPLENBQUM7SUFFdkMsTUFBTSxJQUFJLENBQUNLLG9CQUFvQixDQUFDO01BQUU5QyxNQUFNO01BQUVULFVBQVU7TUFBRVcsS0FBSztNQUFFRDtJQUFRLENBQUMsRUFBRXdDLE9BQU8sQ0FBQztFQUNsRjtFQUVBLE1BQU00TyxtQkFBbUJBLENBQUM5UixVQUFrQixFQUEwQztJQUNwRixJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLFlBQVk7SUFFMUIsTUFBTTRMLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ3RKLGdCQUFnQixDQUFDO01BQUV4QyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDLENBQUM7SUFDMUUsTUFBTTZMLFNBQVMsR0FBRyxNQUFNdlEsWUFBWSxDQUFDc1EsT0FBTyxDQUFDO0lBQzdDLE9BQU8sTUFBTTlQLFVBQVUsQ0FBQ3NWLDJCQUEyQixDQUFDdkYsU0FBUyxDQUFDO0VBQ2hFO0VBRUEsTUFBTXdGLG1CQUFtQkEsQ0FBQ2hTLFVBQWtCLEVBQUVpUyxhQUE0QyxFQUFpQjtJQUN6RyxJQUFJLENBQUNyWCxpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDaUIsTUFBTSxDQUFDa08sSUFBSSxDQUFDOEMsYUFBYSxDQUFDLENBQUM3TyxNQUFNLEVBQUU7TUFDdEMsTUFBTSxJQUFJeEssTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsMENBQTBDLENBQUM7SUFDbkY7SUFFQSxNQUFNMEMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLFlBQVk7SUFDMUIsTUFBTStLLE9BQU8sR0FBRyxJQUFJaFQsTUFBTSxDQUFDaUUsT0FBTyxDQUFDO01BQ2pDaVQsUUFBUSxFQUFFLHlCQUF5QjtNQUNuQ2hULFVBQVUsRUFBRTtRQUFFQyxNQUFNLEVBQUU7TUFBTSxDQUFDO01BQzdCQyxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNb0csT0FBTyxHQUFHd0ksT0FBTyxDQUFDbkcsV0FBVyxDQUFDME0sYUFBYSxDQUFDO0lBRWxELE1BQU0sSUFBSSxDQUFDMU8sb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsRUFBRXVDLE9BQU8sQ0FBQztFQUN6RTtFQUVBLE1BQWNnUCxVQUFVQSxDQUFDQyxhQUErQixFQUFpQjtJQUN2RSxNQUFNO01BQUVuUyxVQUFVO01BQUVDLFVBQVU7TUFBRW1TLElBQUk7TUFBRUM7SUFBUSxDQUFDLEdBQUdGLGFBQWE7SUFDL0QsTUFBTTFSLE1BQU0sR0FBRyxLQUFLO0lBQ3BCLElBQUlFLEtBQUssR0FBRyxTQUFTO0lBRXJCLElBQUkwUixPQUFPLElBQUlBLE9BQU8sYUFBUEEsT0FBTyxlQUFQQSxPQUFPLENBQUU5SixTQUFTLEVBQUU7TUFDakM1SCxLQUFLLEdBQUcsR0FBR0EsS0FBSyxjQUFjMFIsT0FBTyxDQUFDOUosU0FBUyxFQUFFO0lBQ25EO0lBQ0EsTUFBTStKLFFBQVEsR0FBRyxFQUFFO0lBQ25CLEtBQUssTUFBTSxDQUFDdEksR0FBRyxFQUFFdUksS0FBSyxDQUFDLElBQUl0UixNQUFNLENBQUNDLE9BQU8sQ0FBQ2tSLElBQUksQ0FBQyxFQUFFO01BQy9DRSxRQUFRLENBQUMxTCxJQUFJLENBQUM7UUFBRTRMLEdBQUcsRUFBRXhJLEdBQUc7UUFBRXlJLEtBQUssRUFBRUY7TUFBTSxDQUFDLENBQUM7SUFDM0M7SUFDQSxNQUFNRyxhQUFhLEdBQUc7TUFDcEJDLE9BQU8sRUFBRTtRQUNQQyxNQUFNLEVBQUU7VUFDTkMsR0FBRyxFQUFFUDtRQUNQO01BQ0Y7SUFDRixDQUFDO0lBQ0QsTUFBTTVSLE9BQU8sR0FBRyxDQUFDLENBQW1CO0lBQ3BDLE1BQU1nTCxPQUFPLEdBQUcsSUFBSWhULE1BQU0sQ0FBQ2lFLE9BQU8sQ0FBQztNQUFFRyxRQUFRLEVBQUUsSUFBSTtNQUFFRixVQUFVLEVBQUU7UUFBRUMsTUFBTSxFQUFFO01BQU07SUFBRSxDQUFDLENBQUM7SUFDckYsTUFBTWlXLFVBQVUsR0FBR25QLE1BQU0sQ0FBQ3lELElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ25HLFdBQVcsQ0FBQ21OLGFBQWEsQ0FBQyxDQUFDO0lBQ2xFLE1BQU14SCxjQUFjLEdBQUc7TUFDckJ6SyxNQUFNO01BQ05ULFVBQVU7TUFDVlcsS0FBSztNQUNMRCxPQUFPO01BRVAsSUFBSVQsVUFBVSxJQUFJO1FBQUVBLFVBQVUsRUFBRUE7TUFBVyxDQUFDO0lBQzlDLENBQUM7SUFFRFMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHbEYsS0FBSyxDQUFDc1gsVUFBVSxDQUFDO0lBRTFDLE1BQU0sSUFBSSxDQUFDdlAsb0JBQW9CLENBQUMySCxjQUFjLEVBQUU0SCxVQUFVLENBQUM7RUFDN0Q7RUFFQSxNQUFjQyxhQUFhQSxDQUFDO0lBQUUvUyxVQUFVO0lBQUVDLFVBQVU7SUFBRXdJO0VBQWdDLENBQUMsRUFBaUI7SUFDdEcsTUFBTWhJLE1BQU0sR0FBRyxRQUFRO0lBQ3ZCLElBQUlFLEtBQUssR0FBRyxTQUFTO0lBRXJCLElBQUk4SCxVQUFVLElBQUl4SCxNQUFNLENBQUNrTyxJQUFJLENBQUMxRyxVQUFVLENBQUMsQ0FBQ3JGLE1BQU0sSUFBSXFGLFVBQVUsQ0FBQ0YsU0FBUyxFQUFFO01BQ3hFNUgsS0FBSyxHQUFHLEdBQUdBLEtBQUssY0FBYzhILFVBQVUsQ0FBQ0YsU0FBUyxFQUFFO0lBQ3REO0lBQ0EsTUFBTTJDLGNBQWMsR0FBRztNQUFFekssTUFBTTtNQUFFVCxVQUFVO01BQUVDLFVBQVU7TUFBRVU7SUFBTSxDQUFDO0lBRWhFLElBQUlWLFVBQVUsRUFBRTtNQUNkaUwsY0FBYyxDQUFDLFlBQVksQ0FBQyxHQUFHakwsVUFBVTtJQUMzQztJQUNBLE1BQU0sSUFBSSxDQUFDZ0QsZ0JBQWdCLENBQUNpSSxjQUFjLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0VBQzdEO0VBRUEsTUFBTThILGdCQUFnQkEsQ0FBQ2hULFVBQWtCLEVBQUVvUyxJQUFVLEVBQWlCO0lBQ3BFLElBQUksQ0FBQ3hYLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUN2RixhQUFhLENBQUMyWCxJQUFJLENBQUMsRUFBRTtNQUN4QixNQUFNLElBQUl4WixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxpQ0FBaUMsQ0FBQztJQUMxRTtJQUNBLElBQUlrRCxNQUFNLENBQUNrTyxJQUFJLENBQUNpRCxJQUFJLENBQUMsQ0FBQ2hQLE1BQU0sR0FBRyxFQUFFLEVBQUU7TUFDakMsTUFBTSxJQUFJeEssTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsNkJBQTZCLENBQUM7SUFDdEU7SUFFQSxNQUFNLElBQUksQ0FBQ21VLFVBQVUsQ0FBQztNQUFFbFMsVUFBVTtNQUFFb1M7SUFBSyxDQUFDLENBQUM7RUFDN0M7RUFFQSxNQUFNYSxtQkFBbUJBLENBQUNqVCxVQUFrQixFQUFFO0lBQzVDLElBQUksQ0FBQ3BGLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxNQUFNLElBQUksQ0FBQytTLGFBQWEsQ0FBQztNQUFFL1M7SUFBVyxDQUFDLENBQUM7RUFDMUM7RUFFQSxNQUFNa1QsZ0JBQWdCQSxDQUFDbFQsVUFBa0IsRUFBRUMsVUFBa0IsRUFBRW1TLElBQVUsRUFBRUMsT0FBcUIsRUFBRTtJQUNoRyxJQUFJLENBQUN6WCxpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2pFLFVBQVUsQ0FBQztJQUMvRTtJQUVBLElBQUksQ0FBQ3hGLGFBQWEsQ0FBQzJYLElBQUksQ0FBQyxFQUFFO01BQ3hCLE1BQU0sSUFBSXhaLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLGlDQUFpQyxDQUFDO0lBQzFFO0lBQ0EsSUFBSWtELE1BQU0sQ0FBQ2tPLElBQUksQ0FBQ2lELElBQUksQ0FBQyxDQUFDaFAsTUFBTSxHQUFHLEVBQUUsRUFBRTtNQUNqQyxNQUFNLElBQUl4SyxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyw2QkFBNkIsQ0FBQztJQUN0RTtJQUVBLE1BQU0sSUFBSSxDQUFDbVUsVUFBVSxDQUFDO01BQUVsUyxVQUFVO01BQUVDLFVBQVU7TUFBRW1TLElBQUk7TUFBRUM7SUFBUSxDQUFDLENBQUM7RUFDbEU7RUFFQSxNQUFNYyxtQkFBbUJBLENBQUNuVCxVQUFrQixFQUFFQyxVQUFrQixFQUFFd0ksVUFBdUIsRUFBRTtJQUN6RixJQUFJLENBQUM3TixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2pFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUl3SSxVQUFVLElBQUl4SCxNQUFNLENBQUNrTyxJQUFJLENBQUMxRyxVQUFVLENBQUMsQ0FBQ3JGLE1BQU0sSUFBSSxDQUFDNUksUUFBUSxDQUFDaU8sVUFBVSxDQUFDLEVBQUU7TUFDekUsTUFBTSxJQUFJN1AsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsdUNBQXVDLENBQUM7SUFDaEY7SUFFQSxNQUFNLElBQUksQ0FBQ2dWLGFBQWEsQ0FBQztNQUFFL1MsVUFBVTtNQUFFQyxVQUFVO01BQUV3STtJQUFXLENBQUMsQ0FBQztFQUNsRTtFQUVBLE1BQU0ySyxtQkFBbUJBLENBQ3ZCcFQsVUFBa0IsRUFDbEJDLFVBQWtCLEVBQ2xCb1QsVUFBeUIsRUFDVztJQUNwQyxJQUFJLENBQUN6WSxpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHdCQUF3QmxFLFVBQVUsRUFBRSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ3pILENBQUMsQ0FBQzhCLE9BQU8sQ0FBQytZLFVBQVUsQ0FBQyxFQUFFO01BQzFCLElBQUksQ0FBQzFZLFFBQVEsQ0FBQzBZLFVBQVUsQ0FBQ0MsVUFBVSxDQUFDLEVBQUU7UUFDcEMsTUFBTSxJQUFJelQsU0FBUyxDQUFDLDBDQUEwQyxDQUFDO01BQ2pFO01BQ0EsSUFBSSxDQUFDckgsQ0FBQyxDQUFDOEIsT0FBTyxDQUFDK1ksVUFBVSxDQUFDRSxrQkFBa0IsQ0FBQyxFQUFFO1FBQzdDLElBQUksQ0FBQy9ZLFFBQVEsQ0FBQzZZLFVBQVUsQ0FBQ0Usa0JBQWtCLENBQUMsRUFBRTtVQUM1QyxNQUFNLElBQUkxVCxTQUFTLENBQUMsK0NBQStDLENBQUM7UUFDdEU7TUFDRixDQUFDLE1BQU07UUFDTCxNQUFNLElBQUlBLFNBQVMsQ0FBQyxnQ0FBZ0MsQ0FBQztNQUN2RDtNQUNBLElBQUksQ0FBQ3JILENBQUMsQ0FBQzhCLE9BQU8sQ0FBQytZLFVBQVUsQ0FBQ0csbUJBQW1CLENBQUMsRUFBRTtRQUM5QyxJQUFJLENBQUNoWixRQUFRLENBQUM2WSxVQUFVLENBQUNHLG1CQUFtQixDQUFDLEVBQUU7VUFDN0MsTUFBTSxJQUFJM1QsU0FBUyxDQUFDLGdEQUFnRCxDQUFDO1FBQ3ZFO01BQ0YsQ0FBQyxNQUFNO1FBQ0wsTUFBTSxJQUFJQSxTQUFTLENBQUMsaUNBQWlDLENBQUM7TUFDeEQ7SUFDRixDQUFDLE1BQU07TUFDTCxNQUFNLElBQUlBLFNBQVMsQ0FBQyx3Q0FBd0MsQ0FBQztJQUMvRDtJQUVBLE1BQU1ZLE1BQU0sR0FBRyxNQUFNO0lBQ3JCLE1BQU1FLEtBQUssR0FBRyxzQkFBc0I7SUFFcEMsTUFBTStPLE1BQWlDLEdBQUcsQ0FDeEM7TUFDRStELFVBQVUsRUFBRUosVUFBVSxDQUFDQztJQUN6QixDQUFDLEVBQ0Q7TUFDRUksY0FBYyxFQUFFTCxVQUFVLENBQUNNLGNBQWMsSUFBSTtJQUMvQyxDQUFDLEVBQ0Q7TUFDRUMsa0JBQWtCLEVBQUUsQ0FBQ1AsVUFBVSxDQUFDRSxrQkFBa0I7SUFDcEQsQ0FBQyxFQUNEO01BQ0VNLG1CQUFtQixFQUFFLENBQUNSLFVBQVUsQ0FBQ0csbUJBQW1CO0lBQ3RELENBQUMsQ0FDRjs7SUFFRDtJQUNBLElBQUlILFVBQVUsQ0FBQ1MsZUFBZSxFQUFFO01BQzlCcEUsTUFBTSxDQUFDOUksSUFBSSxDQUFDO1FBQUVtTixlQUFlLEVBQUVWLFVBQVUsYUFBVkEsVUFBVSx1QkFBVkEsVUFBVSxDQUFFUztNQUFnQixDQUFDLENBQUM7SUFDL0Q7SUFDQTtJQUNBLElBQUlULFVBQVUsQ0FBQ1csU0FBUyxFQUFFO01BQ3hCdEUsTUFBTSxDQUFDOUksSUFBSSxDQUFDO1FBQUVxTixTQUFTLEVBQUVaLFVBQVUsQ0FBQ1c7TUFBVSxDQUFDLENBQUM7SUFDbEQ7SUFFQSxNQUFNdEksT0FBTyxHQUFHLElBQUloVCxNQUFNLENBQUNpRSxPQUFPLENBQUM7TUFDakNpVCxRQUFRLEVBQUUsNEJBQTRCO01BQ3RDaFQsVUFBVSxFQUFFO1FBQUVDLE1BQU0sRUFBRTtNQUFNLENBQUM7TUFDN0JDLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLE1BQU1vRyxPQUFPLEdBQUd3SSxPQUFPLENBQUNuRyxXQUFXLENBQUNtSyxNQUFNLENBQUM7SUFFM0MsTUFBTWpNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVVO0lBQU0sQ0FBQyxFQUFFdUMsT0FBTyxDQUFDO0lBQzNGLE1BQU1RLElBQUksR0FBRyxNQUFNMUgsWUFBWSxDQUFDeUgsR0FBRyxDQUFDO0lBQ3BDLE9BQU9sSCxnQ0FBZ0MsQ0FBQ21ILElBQUksQ0FBQztFQUMvQztFQUVBLE1BQWN3USxvQkFBb0JBLENBQUNsVSxVQUFrQixFQUFFbVUsWUFBa0MsRUFBaUI7SUFDeEcsTUFBTTFULE1BQU0sR0FBRyxLQUFLO0lBQ3BCLE1BQU1FLEtBQUssR0FBRyxXQUFXO0lBRXpCLE1BQU1ELE9BQXVCLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDLE1BQU1nTCxPQUFPLEdBQUcsSUFBSWhULE1BQU0sQ0FBQ2lFLE9BQU8sQ0FBQztNQUNqQ2lULFFBQVEsRUFBRSx3QkFBd0I7TUFDbEM5UyxRQUFRLEVBQUUsSUFBSTtNQUNkRixVQUFVLEVBQUU7UUFBRUMsTUFBTSxFQUFFO01BQU07SUFDOUIsQ0FBQyxDQUFDO0lBQ0YsTUFBTXFHLE9BQU8sR0FBR3dJLE9BQU8sQ0FBQ25HLFdBQVcsQ0FBQzRPLFlBQVksQ0FBQztJQUNqRHpULE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBR2xGLEtBQUssQ0FBQzBILE9BQU8sQ0FBQztJQUV2QyxNQUFNLElBQUksQ0FBQ0ssb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFVyxLQUFLO01BQUVEO0lBQVEsQ0FBQyxFQUFFd0MsT0FBTyxDQUFDO0VBQ2xGO0VBRUEsTUFBTWtSLHFCQUFxQkEsQ0FBQ3BVLFVBQWtCLEVBQWlCO0lBQzdELElBQUksQ0FBQ3BGLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxNQUFNUyxNQUFNLEdBQUcsUUFBUTtJQUN2QixNQUFNRSxLQUFLLEdBQUcsV0FBVztJQUN6QixNQUFNLElBQUksQ0FBQzRDLG9CQUFvQixDQUFDO01BQUU5QyxNQUFNO01BQUVULFVBQVU7TUFBRVc7SUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7RUFDM0U7RUFFQSxNQUFNMFQsa0JBQWtCQSxDQUFDclUsVUFBa0IsRUFBRXNVLGVBQXFDLEVBQWlCO0lBQ2pHLElBQUksQ0FBQzFaLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJeEgsQ0FBQyxDQUFDOEIsT0FBTyxDQUFDZ2EsZUFBZSxDQUFDLEVBQUU7TUFDOUIsTUFBTSxJQUFJLENBQUNGLHFCQUFxQixDQUFDcFUsVUFBVSxDQUFDO0lBQzlDLENBQUMsTUFBTTtNQUNMLE1BQU0sSUFBSSxDQUFDa1Usb0JBQW9CLENBQUNsVSxVQUFVLEVBQUVzVSxlQUFlLENBQUM7SUFDOUQ7RUFDRjtFQUVBLE1BQU1DLGtCQUFrQkEsQ0FBQ3ZVLFVBQWtCLEVBQW1DO0lBQzVFLElBQUksQ0FBQ3BGLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxNQUFNUyxNQUFNLEdBQUcsS0FBSztJQUNwQixNQUFNRSxLQUFLLEdBQUcsV0FBVztJQUV6QixNQUFNOEMsR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDUixnQkFBZ0IsQ0FBQztNQUFFeEMsTUFBTTtNQUFFVCxVQUFVO01BQUVXO0lBQU0sQ0FBQyxDQUFDO0lBQ3RFLE1BQU0rQyxJQUFJLEdBQUcsTUFBTXpILFlBQVksQ0FBQ3dILEdBQUcsQ0FBQztJQUNwQyxPQUFPaEgsVUFBVSxDQUFDK1gsb0JBQW9CLENBQUM5USxJQUFJLENBQUM7RUFDOUM7RUFFQSxNQUFNK1EsbUJBQW1CQSxDQUFDelUsVUFBa0IsRUFBRTBVLGdCQUFtQyxFQUFpQjtJQUNoRyxJQUFJLENBQUM5WixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDeEgsQ0FBQyxDQUFDOEIsT0FBTyxDQUFDb2EsZ0JBQWdCLENBQUMsSUFBSUEsZ0JBQWdCLENBQUMzRixJQUFJLENBQUMzTCxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ3BFLE1BQU0sSUFBSXhLLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLGtEQUFrRCxHQUFHMlcsZ0JBQWdCLENBQUMzRixJQUFJLENBQUM7SUFDbkg7SUFFQSxJQUFJNEYsYUFBYSxHQUFHRCxnQkFBZ0I7SUFDcEMsSUFBSWxjLENBQUMsQ0FBQzhCLE9BQU8sQ0FBQ29hLGdCQUFnQixDQUFDLEVBQUU7TUFDL0JDLGFBQWEsR0FBRztRQUNkO1FBQ0E1RixJQUFJLEVBQUUsQ0FDSjtVQUNFNkYsa0NBQWtDLEVBQUU7WUFDbENDLFlBQVksRUFBRTtVQUNoQjtRQUNGLENBQUM7TUFFTCxDQUFDO0lBQ0g7SUFFQSxNQUFNcFUsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLFlBQVk7SUFDMUIsTUFBTStLLE9BQU8sR0FBRyxJQUFJaFQsTUFBTSxDQUFDaUUsT0FBTyxDQUFDO01BQ2pDaVQsUUFBUSxFQUFFLG1DQUFtQztNQUM3Q2hULFVBQVUsRUFBRTtRQUFFQyxNQUFNLEVBQUU7TUFBTSxDQUFDO01BQzdCQyxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNb0csT0FBTyxHQUFHd0ksT0FBTyxDQUFDbkcsV0FBVyxDQUFDb1AsYUFBYSxDQUFDO0lBRWxELE1BQU1qVSxPQUF1QixHQUFHLENBQUMsQ0FBQztJQUNsQ0EsT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHbEYsS0FBSyxDQUFDMEgsT0FBTyxDQUFDO0lBRXZDLE1BQU0sSUFBSSxDQUFDSyxvQkFBb0IsQ0FBQztNQUFFOUMsTUFBTTtNQUFFVCxVQUFVO01BQUVXLEtBQUs7TUFBRUQ7SUFBUSxDQUFDLEVBQUV3QyxPQUFPLENBQUM7RUFDbEY7RUFFQSxNQUFNNFIsbUJBQW1CQSxDQUFDOVUsVUFBa0IsRUFBRTtJQUM1QyxJQUFJLENBQUNwRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsTUFBTVMsTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTUUsS0FBSyxHQUFHLFlBQVk7SUFFMUIsTUFBTThDLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsQ0FBQztJQUN0RSxNQUFNK0MsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7SUFDcEMsT0FBT2hILFVBQVUsQ0FBQ3NZLDJCQUEyQixDQUFDclIsSUFBSSxDQUFDO0VBQ3JEO0VBRUEsTUFBTXNSLHNCQUFzQkEsQ0FBQ2hWLFVBQWtCLEVBQUU7SUFDL0MsSUFBSSxDQUFDcEYsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLE1BQU1TLE1BQU0sR0FBRyxRQUFRO0lBQ3ZCLE1BQU1FLEtBQUssR0FBRyxZQUFZO0lBRTFCLE1BQU0sSUFBSSxDQUFDNEMsb0JBQW9CLENBQUM7TUFBRTlDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztFQUMzRTtFQUVBLE1BQU1zVSxrQkFBa0JBLENBQ3RCalYsVUFBa0IsRUFDbEJDLFVBQWtCLEVBQ2xCaUcsT0FBZ0MsRUFDaUI7SUFDakQsSUFBSSxDQUFDdEwsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJaUcsT0FBTyxJQUFJLENBQUMxTCxRQUFRLENBQUMwTCxPQUFPLENBQUMsRUFBRTtNQUNqQyxNQUFNLElBQUl0TixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxvQ0FBb0MsQ0FBQztJQUM3RSxDQUFDLE1BQU0sSUFBSW1JLE9BQU8sYUFBUEEsT0FBTyxlQUFQQSxPQUFPLENBQUVxQyxTQUFTLElBQUksQ0FBQzVOLFFBQVEsQ0FBQ3VMLE9BQU8sQ0FBQ3FDLFNBQVMsQ0FBQyxFQUFFO01BQzdELE1BQU0sSUFBSTNQLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUFDLHNDQUFzQyxDQUFDO0lBQy9FO0lBRUEsTUFBTTBDLE1BQU0sR0FBRyxLQUFLO0lBQ3BCLElBQUlFLEtBQUssR0FBRyxXQUFXO0lBQ3ZCLElBQUl1RixPQUFPLGFBQVBBLE9BQU8sZUFBUEEsT0FBTyxDQUFFcUMsU0FBUyxFQUFFO01BQ3RCNUgsS0FBSyxJQUFJLGNBQWN1RixPQUFPLENBQUNxQyxTQUFTLEVBQUU7SUFDNUM7SUFDQSxNQUFNOUUsR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDUixnQkFBZ0IsQ0FBQztNQUFFeEMsTUFBTTtNQUFFVCxVQUFVO01BQUVDLFVBQVU7TUFBRVU7SUFBTSxDQUFDLENBQUM7SUFDbEYsTUFBTStDLElBQUksR0FBRyxNQUFNekgsWUFBWSxDQUFDd0gsR0FBRyxDQUFDO0lBQ3BDLE9BQU9oSCxVQUFVLENBQUN5WSwwQkFBMEIsQ0FBQ3hSLElBQUksQ0FBQztFQUNwRDtFQUVBLE1BQU15UixhQUFhQSxDQUFDblYsVUFBa0IsRUFBRW9WLFdBQStCLEVBQW9DO0lBQ3pHLElBQUksQ0FBQ3hhLGlCQUFpQixDQUFDb0YsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJcEgsTUFBTSxDQUFDc0wsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdsRSxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUNxVixLQUFLLENBQUNDLE9BQU8sQ0FBQ0YsV0FBVyxDQUFDLEVBQUU7TUFDL0IsTUFBTSxJQUFJeGMsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsOEJBQThCLENBQUM7SUFDdkU7SUFFQSxNQUFNd1gsZ0JBQWdCLEdBQUcsTUFBT0MsS0FBeUIsSUFBdUM7TUFDOUYsTUFBTUMsVUFBdUMsR0FBR0QsS0FBSyxDQUFDM0osR0FBRyxDQUFFMEcsS0FBSyxJQUFLO1FBQ25FLE9BQU8vWCxRQUFRLENBQUMrWCxLQUFLLENBQUMsR0FBRztVQUFFQyxHQUFHLEVBQUVELEtBQUssQ0FBQzdOLElBQUk7VUFBRWdSLFNBQVMsRUFBRW5ELEtBQUssQ0FBQ2hLO1FBQVUsQ0FBQyxHQUFHO1VBQUVpSyxHQUFHLEVBQUVEO1FBQU0sQ0FBQztNQUMzRixDQUFDLENBQUM7TUFFRixNQUFNb0QsVUFBVSxHQUFHO1FBQUVDLE1BQU0sRUFBRTtVQUFFQyxLQUFLLEVBQUUsSUFBSTtVQUFFNVUsTUFBTSxFQUFFd1U7UUFBVztNQUFFLENBQUM7TUFDbEUsTUFBTXZTLE9BQU8sR0FBR1MsTUFBTSxDQUFDeUQsSUFBSSxDQUFDLElBQUkxTyxNQUFNLENBQUNpRSxPQUFPLENBQUM7UUFBRUcsUUFBUSxFQUFFO01BQUssQ0FBQyxDQUFDLENBQUN5SSxXQUFXLENBQUNvUSxVQUFVLENBQUMsQ0FBQztNQUMzRixNQUFNalYsT0FBdUIsR0FBRztRQUFFLGFBQWEsRUFBRWxGLEtBQUssQ0FBQzBILE9BQU87TUFBRSxDQUFDO01BRWpFLE1BQU1PLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7UUFBRXhDLE1BQU0sRUFBRSxNQUFNO1FBQUVULFVBQVU7UUFBRVcsS0FBSyxFQUFFLFFBQVE7UUFBRUQ7TUFBUSxDQUFDLEVBQUV3QyxPQUFPLENBQUM7TUFDMUcsTUFBTVEsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7TUFDcEMsT0FBT2hILFVBQVUsQ0FBQ3FaLG1CQUFtQixDQUFDcFMsSUFBSSxDQUFDO0lBQzdDLENBQUM7SUFFRCxNQUFNcVMsVUFBVSxHQUFHLElBQUksRUFBQztJQUN4QjtJQUNBLE1BQU1DLE9BQU8sR0FBRyxFQUFFO0lBQ2xCLEtBQUssSUFBSUMsQ0FBQyxHQUFHLENBQUMsRUFBRUEsQ0FBQyxHQUFHYixXQUFXLENBQUNoUyxNQUFNLEVBQUU2UyxDQUFDLElBQUlGLFVBQVUsRUFBRTtNQUN2REMsT0FBTyxDQUFDcFAsSUFBSSxDQUFDd08sV0FBVyxDQUFDYyxLQUFLLENBQUNELENBQUMsRUFBRUEsQ0FBQyxHQUFHRixVQUFVLENBQUMsQ0FBQztJQUNwRDtJQUVBLE1BQU1JLFlBQVksR0FBRyxNQUFNekksT0FBTyxDQUFDQyxHQUFHLENBQUNxSSxPQUFPLENBQUNuSyxHQUFHLENBQUMwSixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3JFLE9BQU9ZLFlBQVksQ0FBQ0MsSUFBSSxDQUFDLENBQUM7RUFDNUI7RUFFQSxNQUFNQyxzQkFBc0JBLENBQUNyVyxVQUFrQixFQUFFQyxVQUFrQixFQUFpQjtJQUNsRixJQUFJLENBQUNyRixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQzBkLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHdFcsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLE1BQU1zVyxjQUFjLEdBQUcsTUFBTSxJQUFJLENBQUNwTCxZQUFZLENBQUNuTCxVQUFVLEVBQUVDLFVBQVUsQ0FBQztJQUN0RSxNQUFNUSxNQUFNLEdBQUcsUUFBUTtJQUN2QixNQUFNRSxLQUFLLEdBQUcsWUFBWTRWLGNBQWMsRUFBRTtJQUMxQyxNQUFNLElBQUksQ0FBQ2hULG9CQUFvQixDQUFDO01BQUU5QyxNQUFNO01BQUVULFVBQVU7TUFBRUMsVUFBVTtNQUFFVTtJQUFNLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztFQUN2RjtFQUVBLE1BQWM2VixZQUFZQSxDQUN4QkMsZ0JBQXdCLEVBQ3hCQyxnQkFBd0IsRUFDeEJDLDZCQUFxQyxFQUNyQ0MsVUFBa0MsRUFDbEM7SUFDQSxJQUFJLE9BQU9BLFVBQVUsSUFBSSxVQUFVLEVBQUU7TUFDbkNBLFVBQVUsR0FBRyxJQUFJO0lBQ25CO0lBRUEsSUFBSSxDQUFDaGMsaUJBQWlCLENBQUM2YixnQkFBZ0IsQ0FBQyxFQUFFO01BQ3hDLE1BQU0sSUFBSTdkLE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHdVMsZ0JBQWdCLENBQUM7SUFDckY7SUFDQSxJQUFJLENBQUMzYixpQkFBaUIsQ0FBQzRiLGdCQUFnQixDQUFDLEVBQUU7TUFDeEMsTUFBTSxJQUFJOWQsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCdVEsZ0JBQWdCLEVBQUUsQ0FBQztJQUNyRjtJQUNBLElBQUksQ0FBQy9iLFFBQVEsQ0FBQ2djLDZCQUE2QixDQUFDLEVBQUU7TUFDNUMsTUFBTSxJQUFJOVcsU0FBUyxDQUFDLDBEQUEwRCxDQUFDO0lBQ2pGO0lBQ0EsSUFBSThXLDZCQUE2QixLQUFLLEVBQUUsRUFBRTtNQUN4QyxNQUFNLElBQUkvZCxNQUFNLENBQUNvUSxrQkFBa0IsQ0FBQyxxQkFBcUIsQ0FBQztJQUM1RDtJQUVBLElBQUk0TixVQUFVLElBQUksSUFBSSxJQUFJLEVBQUVBLFVBQVUsWUFBWW5kLGNBQWMsQ0FBQyxFQUFFO01BQ2pFLE1BQU0sSUFBSW9HLFNBQVMsQ0FBQywrQ0FBK0MsQ0FBQztJQUN0RTtJQUVBLE1BQU1hLE9BQXVCLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDQSxPQUFPLENBQUMsbUJBQW1CLENBQUMsR0FBRy9FLGlCQUFpQixDQUFDZ2IsNkJBQTZCLENBQUM7SUFFL0UsSUFBSUMsVUFBVSxFQUFFO01BQ2QsSUFBSUEsVUFBVSxDQUFDQyxRQUFRLEtBQUssRUFBRSxFQUFFO1FBQzlCblcsT0FBTyxDQUFDLHFDQUFxQyxDQUFDLEdBQUdrVyxVQUFVLENBQUNDLFFBQVE7TUFDdEU7TUFDQSxJQUFJRCxVQUFVLENBQUNFLFVBQVUsS0FBSyxFQUFFLEVBQUU7UUFDaENwVyxPQUFPLENBQUMsdUNBQXVDLENBQUMsR0FBR2tXLFVBQVUsQ0FBQ0UsVUFBVTtNQUMxRTtNQUNBLElBQUlGLFVBQVUsQ0FBQ0csU0FBUyxLQUFLLEVBQUUsRUFBRTtRQUMvQnJXLE9BQU8sQ0FBQyw0QkFBNEIsQ0FBQyxHQUFHa1csVUFBVSxDQUFDRyxTQUFTO01BQzlEO01BQ0EsSUFBSUgsVUFBVSxDQUFDSSxlQUFlLEtBQUssRUFBRSxFQUFFO1FBQ3JDdFcsT0FBTyxDQUFDLGlDQUFpQyxDQUFDLEdBQUdrVyxVQUFVLENBQUNJLGVBQWU7TUFDekU7SUFDRjtJQUVBLE1BQU12VyxNQUFNLEdBQUcsS0FBSztJQUVwQixNQUFNZ0QsR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDUixnQkFBZ0IsQ0FBQztNQUN0Q3hDLE1BQU07TUFDTlQsVUFBVSxFQUFFeVcsZ0JBQWdCO01BQzVCeFcsVUFBVSxFQUFFeVcsZ0JBQWdCO01BQzVCaFc7SUFDRixDQUFDLENBQUM7SUFDRixNQUFNZ0QsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7SUFDcEMsT0FBT2hILFVBQVUsQ0FBQ3dhLGVBQWUsQ0FBQ3ZULElBQUksQ0FBQztFQUN6QztFQUVBLE1BQWN3VCxZQUFZQSxDQUN4QkMsWUFBK0IsRUFDL0JDLFVBQWtDLEVBQ0w7SUFDN0IsSUFBSSxFQUFFRCxZQUFZLFlBQVlyZSxpQkFBaUIsQ0FBQyxFQUFFO01BQ2hELE1BQU0sSUFBSUYsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsZ0RBQWdELENBQUM7SUFDekY7SUFDQSxJQUFJLEVBQUVxWixVQUFVLFlBQVl2ZSxzQkFBc0IsQ0FBQyxFQUFFO01BQ25ELE1BQU0sSUFBSUQsTUFBTSxDQUFDbUYsb0JBQW9CLENBQUMsbURBQW1ELENBQUM7SUFDNUY7SUFDQSxJQUFJLENBQUNxWixVQUFVLENBQUNDLFFBQVEsQ0FBQyxDQUFDLEVBQUU7TUFDMUIsT0FBTzNKLE9BQU8sQ0FBQ0csTUFBTSxDQUFDLENBQUM7SUFDekI7SUFDQSxJQUFJLENBQUN1SixVQUFVLENBQUNDLFFBQVEsQ0FBQyxDQUFDLEVBQUU7TUFDMUIsT0FBTzNKLE9BQU8sQ0FBQ0csTUFBTSxDQUFDLENBQUM7SUFDekI7SUFFQSxNQUFNbk4sT0FBTyxHQUFHTyxNQUFNLENBQUNFLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRWdXLFlBQVksQ0FBQ0csVUFBVSxDQUFDLENBQUMsRUFBRUYsVUFBVSxDQUFDRSxVQUFVLENBQUMsQ0FBQyxDQUFDO0lBRXJGLE1BQU10WCxVQUFVLEdBQUdvWCxVQUFVLENBQUNHLE1BQU07SUFDcEMsTUFBTXRYLFVBQVUsR0FBR21YLFVBQVUsQ0FBQ25XLE1BQU07SUFFcEMsTUFBTVIsTUFBTSxHQUFHLEtBQUs7SUFFcEIsTUFBTWdELEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVO01BQUVTO0lBQVEsQ0FBQyxDQUFDO0lBQ3BGLE1BQU1nRCxJQUFJLEdBQUcsTUFBTXpILFlBQVksQ0FBQ3dILEdBQUcsQ0FBQztJQUNwQyxNQUFNK1QsT0FBTyxHQUFHL2EsVUFBVSxDQUFDd2EsZUFBZSxDQUFDdlQsSUFBSSxDQUFDO0lBQ2hELE1BQU0rVCxVQUErQixHQUFHaFUsR0FBRyxDQUFDL0MsT0FBTztJQUVuRCxNQUFNZ1gsZUFBZSxHQUFHRCxVQUFVLElBQUlBLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQztJQUNsRSxNQUFNN1AsSUFBSSxHQUFHLE9BQU84UCxlQUFlLEtBQUssUUFBUSxHQUFHQSxlQUFlLEdBQUdqYSxTQUFTO0lBRTlFLE9BQU87TUFDTDhaLE1BQU0sRUFBRUgsVUFBVSxDQUFDRyxNQUFNO01BQ3pCL0UsR0FBRyxFQUFFNEUsVUFBVSxDQUFDblcsTUFBTTtNQUN0QjBXLFlBQVksRUFBRUgsT0FBTyxDQUFDbFAsWUFBWTtNQUNsQ3NQLFFBQVEsRUFBRWhlLGVBQWUsQ0FBQzZkLFVBQTRCLENBQUM7TUFDdkQvQixTQUFTLEVBQUUxYixZQUFZLENBQUN5ZCxVQUE0QixDQUFDO01BQ3JESSxlQUFlLEVBQUU5ZCxrQkFBa0IsQ0FBQzBkLFVBQTRCLENBQUM7TUFDakVLLElBQUksRUFBRXZjLFlBQVksQ0FBQ2tjLFVBQVUsQ0FBQ3BRLElBQUksQ0FBQztNQUNuQzBRLElBQUksRUFBRW5RO0lBQ1IsQ0FBQztFQUNIO0VBU0EsTUFBTW9RLFVBQVVBLENBQUMsR0FBR0MsT0FBeUIsRUFBNkI7SUFDeEUsSUFBSSxPQUFPQSxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssUUFBUSxFQUFFO01BQ2xDLE1BQU0sQ0FBQ3hCLGdCQUFnQixFQUFFQyxnQkFBZ0IsRUFBRUMsNkJBQTZCLEVBQUVDLFVBQVUsQ0FBQyxHQUFHcUIsT0FLdkY7TUFDRCxPQUFPLE1BQU0sSUFBSSxDQUFDekIsWUFBWSxDQUFDQyxnQkFBZ0IsRUFBRUMsZ0JBQWdCLEVBQUVDLDZCQUE2QixFQUFFQyxVQUFVLENBQUM7SUFDL0c7SUFDQSxNQUFNLENBQUNzQixNQUFNLEVBQUVDLElBQUksQ0FBQyxHQUFHRixPQUFzRDtJQUM3RSxPQUFPLE1BQU0sSUFBSSxDQUFDZixZQUFZLENBQUNnQixNQUFNLEVBQUVDLElBQUksQ0FBQztFQUM5QztFQUVBLE1BQU1DLFVBQVVBLENBQ2RDLFVBTUMsRUFDRG5WLE9BQWdCLEVBQ2hCO0lBQ0EsTUFBTTtNQUFFbEQsVUFBVTtNQUFFQyxVQUFVO01BQUVxWSxRQUFRO01BQUV0SyxVQUFVO01BQUV0TjtJQUFRLENBQUMsR0FBRzJYLFVBQVU7SUFFNUUsTUFBTTVYLE1BQU0sR0FBRyxLQUFLO0lBQ3BCLE1BQU1FLEtBQUssR0FBRyxZQUFZMlgsUUFBUSxlQUFldEssVUFBVSxFQUFFO0lBQzdELE1BQU05QyxjQUFjLEdBQUc7TUFBRXpLLE1BQU07TUFBRVQsVUFBVTtNQUFFQyxVQUFVLEVBQUVBLFVBQVU7TUFBRVUsS0FBSztNQUFFRDtJQUFRLENBQUM7SUFDckYsTUFBTStDLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUNpSSxjQUFjLEVBQUVoSSxPQUFPLENBQUM7SUFDaEUsTUFBTVEsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7SUFDcEMsTUFBTThVLE9BQU8sR0FBRy9iLGdCQUFnQixDQUFDa0gsSUFBSSxDQUFDO0lBQ3RDLE9BQU87TUFDTDJELElBQUksRUFBRTlMLFlBQVksQ0FBQ2dkLE9BQU8sQ0FBQ3ZNLElBQUksQ0FBQztNQUNoQ2hDLEdBQUcsRUFBRS9KLFVBQVU7TUFDZjhMLElBQUksRUFBRWlDO0lBQ1IsQ0FBQztFQUNIO0VBRUEsTUFBTXdLLGFBQWFBLENBQ2pCQyxhQUFxQyxFQUNyQ0MsYUFBa0MsRUFDZ0U7SUFDbEcsTUFBTUMsaUJBQWlCLEdBQUdELGFBQWEsQ0FBQ3RWLE1BQU07SUFFOUMsSUFBSSxDQUFDaVMsS0FBSyxDQUFDQyxPQUFPLENBQUNvRCxhQUFhLENBQUMsRUFBRTtNQUNqQyxNQUFNLElBQUk5ZixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxvREFBb0QsQ0FBQztJQUM3RjtJQUNBLElBQUksRUFBRTBhLGFBQWEsWUFBWTVmLHNCQUFzQixDQUFDLEVBQUU7TUFDdEQsTUFBTSxJQUFJRCxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxtREFBbUQsQ0FBQztJQUM1RjtJQUVBLElBQUk0YSxpQkFBaUIsR0FBRyxDQUFDLElBQUlBLGlCQUFpQixHQUFHeGQsZ0JBQWdCLENBQUN5ZCxlQUFlLEVBQUU7TUFDakYsTUFBTSxJQUFJaGdCLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUNuQyx5Q0FBeUM1QyxnQkFBZ0IsQ0FBQ3lkLGVBQWUsa0JBQzNFLENBQUM7SUFDSDtJQUVBLEtBQUssSUFBSTNDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBRzBDLGlCQUFpQixFQUFFMUMsQ0FBQyxFQUFFLEVBQUU7TUFDMUMsTUFBTTRDLElBQUksR0FBR0gsYUFBYSxDQUFDekMsQ0FBQyxDQUFzQjtNQUNsRCxJQUFJLENBQUM0QyxJQUFJLENBQUN4QixRQUFRLENBQUMsQ0FBQyxFQUFFO1FBQ3BCLE9BQU8sS0FBSztNQUNkO0lBQ0Y7SUFFQSxJQUFJLENBQUVvQixhQUFhLENBQTRCcEIsUUFBUSxDQUFDLENBQUMsRUFBRTtNQUN6RCxPQUFPLEtBQUs7SUFDZDtJQUVBLE1BQU15QixjQUFjLEdBQUlDLFNBQTRCLElBQUs7TUFDdkQsSUFBSTdRLFFBQVEsR0FBRyxDQUFDLENBQUM7TUFDakIsSUFBSSxDQUFDMVAsQ0FBQyxDQUFDOEIsT0FBTyxDQUFDeWUsU0FBUyxDQUFDQyxTQUFTLENBQUMsRUFBRTtRQUNuQzlRLFFBQVEsR0FBRztVQUNUSyxTQUFTLEVBQUV3USxTQUFTLENBQUNDO1FBQ3ZCLENBQUM7TUFDSDtNQUNBLE9BQU85USxRQUFRO0lBQ2pCLENBQUM7SUFDRCxNQUFNK1EsY0FBd0IsR0FBRyxFQUFFO0lBQ25DLElBQUlDLFNBQVMsR0FBRyxDQUFDO0lBQ2pCLElBQUlDLFVBQVUsR0FBRyxDQUFDO0lBRWxCLE1BQU1DLGNBQWMsR0FBR1YsYUFBYSxDQUFDN00sR0FBRyxDQUFFd04sT0FBTyxJQUMvQyxJQUFJLENBQUNuUyxVQUFVLENBQUNtUyxPQUFPLENBQUM5QixNQUFNLEVBQUU4QixPQUFPLENBQUNwWSxNQUFNLEVBQUU2WCxjQUFjLENBQUNPLE9BQU8sQ0FBQyxDQUN6RSxDQUFDO0lBRUQsTUFBTUMsY0FBYyxHQUFHLE1BQU01TCxPQUFPLENBQUNDLEdBQUcsQ0FBQ3lMLGNBQWMsQ0FBQztJQUV4RCxNQUFNRyxjQUFjLEdBQUdELGNBQWMsQ0FBQ3pOLEdBQUcsQ0FBQyxDQUFDMk4sV0FBVyxFQUFFQyxLQUFLLEtBQUs7TUFDaEUsTUFBTVYsU0FBd0MsR0FBR0wsYUFBYSxDQUFDZSxLQUFLLENBQUM7TUFFckUsSUFBSUMsV0FBVyxHQUFHRixXQUFXLENBQUM1UixJQUFJO01BQ2xDO01BQ0E7TUFDQSxJQUFJbVIsU0FBUyxJQUFJQSxTQUFTLENBQUNZLFVBQVUsRUFBRTtRQUNyQztRQUNBO1FBQ0E7UUFDQSxNQUFNQyxRQUFRLEdBQUdiLFNBQVMsQ0FBQ2MsS0FBSztRQUNoQyxNQUFNQyxNQUFNLEdBQUdmLFNBQVMsQ0FBQ2dCLEdBQUc7UUFDNUIsSUFBSUQsTUFBTSxJQUFJSixXQUFXLElBQUlFLFFBQVEsR0FBRyxDQUFDLEVBQUU7VUFDekMsTUFBTSxJQUFJaGhCLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUNuQyxrQkFBa0IwYixLQUFLLGlDQUFpQ0csUUFBUSxLQUFLRSxNQUFNLGNBQWNKLFdBQVcsR0FDdEcsQ0FBQztRQUNIO1FBQ0FBLFdBQVcsR0FBR0ksTUFBTSxHQUFHRixRQUFRLEdBQUcsQ0FBQztNQUNyQzs7TUFFQTtNQUNBLElBQUlGLFdBQVcsR0FBR3ZlLGdCQUFnQixDQUFDNmUsaUJBQWlCLElBQUlQLEtBQUssR0FBR2QsaUJBQWlCLEdBQUcsQ0FBQyxFQUFFO1FBQ3JGLE1BQU0sSUFBSS9mLE1BQU0sQ0FBQ21GLG9CQUFvQixDQUNuQyxrQkFBa0IwYixLQUFLLGtCQUFrQkMsV0FBVyxnQ0FDdEQsQ0FBQztNQUNIOztNQUVBO01BQ0FSLFNBQVMsSUFBSVEsV0FBVztNQUN4QixJQUFJUixTQUFTLEdBQUcvZCxnQkFBZ0IsQ0FBQzhlLDZCQUE2QixFQUFFO1FBQzlELE1BQU0sSUFBSXJoQixNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxvQ0FBb0NtYixTQUFTLFdBQVcsQ0FBQztNQUNqRzs7TUFFQTtNQUNBRCxjQUFjLENBQUNRLEtBQUssQ0FBQyxHQUFHQyxXQUFXOztNQUVuQztNQUNBUCxVQUFVLElBQUkvZCxhQUFhLENBQUNzZSxXQUFXLENBQUM7TUFDeEM7TUFDQSxJQUFJUCxVQUFVLEdBQUdoZSxnQkFBZ0IsQ0FBQ3lkLGVBQWUsRUFBRTtRQUNqRCxNQUFNLElBQUloZ0IsTUFBTSxDQUFDbUYsb0JBQW9CLENBQ25DLG1EQUFtRDVDLGdCQUFnQixDQUFDeWQsZUFBZSxRQUNyRixDQUFDO01BQ0g7TUFFQSxPQUFPWSxXQUFXO0lBQ3BCLENBQUMsQ0FBQztJQUVGLElBQUtMLFVBQVUsS0FBSyxDQUFDLElBQUlELFNBQVMsSUFBSS9kLGdCQUFnQixDQUFDK2UsYUFBYSxJQUFLaEIsU0FBUyxLQUFLLENBQUMsRUFBRTtNQUN4RixPQUFPLE1BQU0sSUFBSSxDQUFDbEIsVUFBVSxDQUFDVSxhQUFhLENBQUMsQ0FBQyxDQUFDLEVBQXVCRCxhQUFhLENBQUMsRUFBQztJQUNyRjs7SUFFQTtJQUNBLEtBQUssSUFBSXhDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBRzBDLGlCQUFpQixFQUFFMUMsQ0FBQyxFQUFFLEVBQUU7TUFDMUM7TUFBRXlDLGFBQWEsQ0FBQ3pDLENBQUMsQ0FBQyxDQUF1QmtFLFNBQVMsR0FBSVosY0FBYyxDQUFDdEQsQ0FBQyxDQUFDLENBQW9CNU8sSUFBSTtJQUNqRztJQUVBLE1BQU0rUyxpQkFBaUIsR0FBR2IsY0FBYyxDQUFDMU4sR0FBRyxDQUFDLENBQUMyTixXQUFXLEVBQUVhLEdBQUcsS0FBSztNQUNqRSxPQUFPMWdCLG1CQUFtQixDQUFDc2YsY0FBYyxDQUFDb0IsR0FBRyxDQUFDLEVBQVkzQixhQUFhLENBQUMyQixHQUFHLENBQXNCLENBQUM7SUFDcEcsQ0FBQyxDQUFDO0lBRUYsTUFBTUMsdUJBQXVCLEdBQUlyUSxRQUFnQixJQUFLO01BQ3BELE1BQU1zUSxvQkFBd0MsR0FBRyxFQUFFO01BRW5ESCxpQkFBaUIsQ0FBQy9YLE9BQU8sQ0FBQyxDQUFDbVksU0FBUyxFQUFFQyxVQUFrQixLQUFLO1FBQzNELElBQUlELFNBQVMsRUFBRTtVQUNiLE1BQU07WUFBRUUsVUFBVSxFQUFFQyxRQUFRO1lBQUVDLFFBQVEsRUFBRUMsTUFBTTtZQUFFQyxPQUFPLEVBQUVDO1VBQVUsQ0FBQyxHQUFHUCxTQUFTO1VBRWhGLE1BQU1RLFNBQVMsR0FBR1AsVUFBVSxHQUFHLENBQUMsRUFBQztVQUNqQyxNQUFNUSxZQUFZLEdBQUc1RixLQUFLLENBQUNqTyxJQUFJLENBQUN1VCxRQUFRLENBQUM7VUFFekMsTUFBTWphLE9BQU8sR0FBSWdZLGFBQWEsQ0FBQytCLFVBQVUsQ0FBQyxDQUF1Qm5ELFVBQVUsQ0FBQyxDQUFDO1VBRTdFMkQsWUFBWSxDQUFDNVksT0FBTyxDQUFDLENBQUM2WSxVQUFVLEVBQUVDLFVBQVUsS0FBSztZQUMvQyxNQUFNQyxRQUFRLEdBQUdQLE1BQU0sQ0FBQ00sVUFBVSxDQUFDO1lBRW5DLE1BQU1FLFNBQVMsR0FBRyxHQUFHTixTQUFTLENBQUN4RCxNQUFNLElBQUl3RCxTQUFTLENBQUM5WixNQUFNLEVBQUU7WUFDM0RQLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLEdBQUcyYSxTQUFTLEVBQUU7WUFDN0MzYSxPQUFPLENBQUMseUJBQXlCLENBQUMsR0FBRyxTQUFTd2EsVUFBVSxJQUFJRSxRQUFRLEVBQUU7WUFFdEUsTUFBTUUsZ0JBQWdCLEdBQUc7Y0FDdkJ0YixVQUFVLEVBQUV5WSxhQUFhLENBQUNsQixNQUFNO2NBQ2hDdFgsVUFBVSxFQUFFd1ksYUFBYSxDQUFDeFgsTUFBTTtjQUNoQ3FYLFFBQVEsRUFBRXJPLFFBQVE7Y0FDbEIrRCxVQUFVLEVBQUVnTixTQUFTO2NBQ3JCdGEsT0FBTyxFQUFFQSxPQUFPO2NBQ2hCMmEsU0FBUyxFQUFFQTtZQUNiLENBQUM7WUFFRGQsb0JBQW9CLENBQUMzVCxJQUFJLENBQUMwVSxnQkFBZ0IsQ0FBQztVQUM3QyxDQUFDLENBQUM7UUFDSjtNQUNGLENBQUMsQ0FBQztNQUVGLE9BQU9mLG9CQUFvQjtJQUM3QixDQUFDO0lBRUQsTUFBTWdCLGNBQWMsR0FBRyxNQUFPQyxVQUE4QixJQUFLO01BQy9ELE1BQU1DLFdBQVcsR0FBR0QsVUFBVSxDQUFDM1AsR0FBRyxDQUFDLE1BQU94QixJQUFJLElBQUs7UUFDakQsT0FBTyxJQUFJLENBQUMrTixVQUFVLENBQUMvTixJQUFJLENBQUM7TUFDOUIsQ0FBQyxDQUFDO01BQ0Y7TUFDQSxPQUFPLE1BQU1xRCxPQUFPLENBQUNDLEdBQUcsQ0FBQzhOLFdBQVcsQ0FBQztJQUN2QyxDQUFDO0lBRUQsTUFBTUMsa0JBQWtCLEdBQUcsTUFBT3pSLFFBQWdCLElBQUs7TUFDckQsTUFBTXVSLFVBQVUsR0FBR2xCLHVCQUF1QixDQUFDclEsUUFBUSxDQUFDO01BQ3BELE1BQU0wUixRQUFRLEdBQUcsTUFBTUosY0FBYyxDQUFDQyxVQUFVLENBQUM7TUFDakQsT0FBT0csUUFBUSxDQUFDOVAsR0FBRyxDQUFFK1AsUUFBUSxLQUFNO1FBQUV2VSxJQUFJLEVBQUV1VSxRQUFRLENBQUN2VSxJQUFJO1FBQUUwRSxJQUFJLEVBQUU2UCxRQUFRLENBQUM3UDtNQUFLLENBQUMsQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFFRCxNQUFNOFAsZ0JBQWdCLEdBQUdwRCxhQUFhLENBQUNuQixVQUFVLENBQUMsQ0FBQztJQUVuRCxNQUFNck4sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZSwwQkFBMEIsQ0FBQ3lOLGFBQWEsQ0FBQ2xCLE1BQU0sRUFBRWtCLGFBQWEsQ0FBQ3hYLE1BQU0sRUFBRTRhLGdCQUFnQixDQUFDO0lBQ3BILElBQUk7TUFDRixNQUFNQyxTQUFTLEdBQUcsTUFBTUosa0JBQWtCLENBQUN6UixRQUFRLENBQUM7TUFDcEQsT0FBTyxNQUFNLElBQUksQ0FBQ3VCLHVCQUF1QixDQUFDaU4sYUFBYSxDQUFDbEIsTUFBTSxFQUFFa0IsYUFBYSxDQUFDeFgsTUFBTSxFQUFFZ0osUUFBUSxFQUFFNlIsU0FBUyxDQUFDO0lBQzVHLENBQUMsQ0FBQyxPQUFPNVosR0FBRyxFQUFFO01BQ1osT0FBTyxNQUFNLElBQUksQ0FBQytJLG9CQUFvQixDQUFDd04sYUFBYSxDQUFDbEIsTUFBTSxFQUFFa0IsYUFBYSxDQUFDeFgsTUFBTSxFQUFFZ0osUUFBUSxDQUFDO0lBQzlGO0VBQ0Y7RUFFQSxNQUFNOFIsWUFBWUEsQ0FDaEJ0YixNQUFjLEVBQ2RULFVBQWtCLEVBQ2xCQyxVQUFrQixFQUNsQitiLE9BQW1ELEVBQ25EQyxTQUF1QyxFQUN2Q0MsV0FBa0IsRUFDRDtJQUFBLElBQUFDLFlBQUE7SUFDakIsSUFBSSxJQUFJLENBQUNsZCxTQUFTLEVBQUU7TUFDbEIsTUFBTSxJQUFJckcsTUFBTSxDQUFDd2pCLHFCQUFxQixDQUFDLGFBQWEzYixNQUFNLGlEQUFpRCxDQUFDO0lBQzlHO0lBRUEsSUFBSSxDQUFDdWIsT0FBTyxFQUFFO01BQ1pBLE9BQU8sR0FBRy9pQix1QkFBdUI7SUFDbkM7SUFDQSxJQUFJLENBQUNnakIsU0FBUyxFQUFFO01BQ2RBLFNBQVMsR0FBRyxDQUFDLENBQUM7SUFDaEI7SUFDQSxJQUFJLENBQUNDLFdBQVcsRUFBRTtNQUNoQkEsV0FBVyxHQUFHLElBQUluWSxJQUFJLENBQUMsQ0FBQztJQUMxQjs7SUFFQTtJQUNBLElBQUlpWSxPQUFPLElBQUksT0FBT0EsT0FBTyxLQUFLLFFBQVEsRUFBRTtNQUMxQyxNQUFNLElBQUluYyxTQUFTLENBQUMsb0NBQW9DLENBQUM7SUFDM0Q7SUFDQSxJQUFJb2MsU0FBUyxJQUFJLE9BQU9BLFNBQVMsS0FBSyxRQUFRLEVBQUU7TUFDOUMsTUFBTSxJQUFJcGMsU0FBUyxDQUFDLHNDQUFzQyxDQUFDO0lBQzdEO0lBQ0EsSUFBS3FjLFdBQVcsSUFBSSxFQUFFQSxXQUFXLFlBQVluWSxJQUFJLENBQUMsSUFBTW1ZLFdBQVcsSUFBSUcsS0FBSyxFQUFBRixZQUFBLEdBQUNELFdBQVcsY0FBQUMsWUFBQSx1QkFBWEEsWUFBQSxDQUFhNVEsT0FBTyxDQUFDLENBQUMsQ0FBRSxFQUFFO01BQ3JHLE1BQU0sSUFBSTFMLFNBQVMsQ0FBQyxnREFBZ0QsQ0FBQztJQUN2RTtJQUVBLE1BQU1jLEtBQUssR0FBR3NiLFNBQVMsR0FBR3hqQixFQUFFLENBQUNvSyxTQUFTLENBQUNvWixTQUFTLENBQUMsR0FBR3hlLFNBQVM7SUFFN0QsSUFBSTtNQUNGLE1BQU1PLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQzZGLG9CQUFvQixDQUFDN0QsVUFBVSxDQUFDO01BQzFELE1BQU0sSUFBSSxDQUFDd0Isb0JBQW9CLENBQUMsQ0FBQztNQUNqQyxNQUFNakMsVUFBVSxHQUFHLElBQUksQ0FBQ2dCLGlCQUFpQixDQUFDO1FBQUVFLE1BQU07UUFBRXpDLE1BQU07UUFBRWdDLFVBQVU7UUFBRUMsVUFBVTtRQUFFVTtNQUFNLENBQUMsQ0FBQztNQUU1RixPQUFPdEgsa0JBQWtCLENBQ3ZCa0csVUFBVSxFQUNWLElBQUksQ0FBQ1QsU0FBUyxFQUNkLElBQUksQ0FBQ0MsU0FBUyxFQUNkLElBQUksQ0FBQ0MsWUFBWSxFQUNqQmhCLE1BQU0sRUFDTmtlLFdBQVcsRUFDWEYsT0FDRixDQUFDO0lBQ0gsQ0FBQyxDQUFDLE9BQU85WixHQUFHLEVBQUU7TUFDWixJQUFJQSxHQUFHLFlBQVl0SixNQUFNLENBQUNzTCxzQkFBc0IsRUFBRTtRQUNoRCxNQUFNLElBQUl0TCxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxtQ0FBbUNpQyxVQUFVLEdBQUcsQ0FBQztNQUN6RjtNQUVBLE1BQU1rQyxHQUFHO0lBQ1g7RUFDRjtFQUVBLE1BQU1vYSxrQkFBa0JBLENBQ3RCdGMsVUFBa0IsRUFDbEJDLFVBQWtCLEVBQ2xCK2IsT0FBZ0IsRUFDaEJPLFdBQXlDLEVBQ3pDTCxXQUFrQixFQUNEO0lBQ2pCLElBQUksQ0FBQ3RoQixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDbEYsaUJBQWlCLENBQUNtRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlySCxNQUFNLENBQUN1TixzQkFBc0IsQ0FBQyx3QkFBd0JsRyxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUVBLE1BQU11YyxnQkFBZ0IsR0FBRyxDQUN2Qix1QkFBdUIsRUFDdkIsMkJBQTJCLEVBQzNCLGtCQUFrQixFQUNsQix3QkFBd0IsRUFDeEIsOEJBQThCLEVBQzlCLDJCQUEyQixDQUM1QjtJQUNEQSxnQkFBZ0IsQ0FBQ25hLE9BQU8sQ0FBRW9hLE1BQU0sSUFBSztNQUNuQztNQUNBLElBQUlGLFdBQVcsS0FBSzllLFNBQVMsSUFBSThlLFdBQVcsQ0FBQ0UsTUFBTSxDQUFDLEtBQUtoZixTQUFTLElBQUksQ0FBQzlDLFFBQVEsQ0FBQzRoQixXQUFXLENBQUNFLE1BQU0sQ0FBQyxDQUFDLEVBQUU7UUFDcEcsTUFBTSxJQUFJNWMsU0FBUyxDQUFDLG1CQUFtQjRjLE1BQU0sNkJBQTZCLENBQUM7TUFDN0U7SUFDRixDQUFDLENBQUM7SUFDRixPQUFPLElBQUksQ0FBQ1YsWUFBWSxDQUFDLEtBQUssRUFBRS9iLFVBQVUsRUFBRUMsVUFBVSxFQUFFK2IsT0FBTyxFQUFFTyxXQUFXLEVBQUVMLFdBQVcsQ0FBQztFQUM1RjtFQUVBLE1BQU1RLGtCQUFrQkEsQ0FBQzFjLFVBQWtCLEVBQUVDLFVBQWtCLEVBQUUrYixPQUFnQixFQUFtQjtJQUNsRyxJQUFJLENBQUNwaEIsaUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx3QkFBd0JsRSxVQUFVLEVBQUUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2xGLGlCQUFpQixDQUFDbUYsVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJckgsTUFBTSxDQUFDdU4sc0JBQXNCLENBQUMsd0JBQXdCbEcsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFFQSxPQUFPLElBQUksQ0FBQzhiLFlBQVksQ0FBQyxLQUFLLEVBQUUvYixVQUFVLEVBQUVDLFVBQVUsRUFBRStiLE9BQU8sQ0FBQztFQUNsRTtFQUVBVyxhQUFhQSxDQUFBLEVBQWU7SUFDMUIsT0FBTyxJQUFJOWdCLFVBQVUsQ0FBQyxDQUFDO0VBQ3pCO0VBRUEsTUFBTStnQixtQkFBbUJBLENBQUNDLFVBQXNCLEVBQTZCO0lBQzNFLElBQUksSUFBSSxDQUFDNWQsU0FBUyxFQUFFO01BQ2xCLE1BQU0sSUFBSXJHLE1BQU0sQ0FBQ3dqQixxQkFBcUIsQ0FBQyxrRUFBa0UsQ0FBQztJQUM1RztJQUNBLElBQUksQ0FBQzVoQixRQUFRLENBQUNxaUIsVUFBVSxDQUFDLEVBQUU7TUFDekIsTUFBTSxJQUFJaGQsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsTUFBTUcsVUFBVSxHQUFHNmMsVUFBVSxDQUFDQyxRQUFRLENBQUNoVSxNQUFnQjtJQUN2RCxJQUFJO01BQ0YsTUFBTTlLLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQzZGLG9CQUFvQixDQUFDN0QsVUFBVSxDQUFDO01BRTFELE1BQU04RCxJQUFJLEdBQUcsSUFBSUMsSUFBSSxDQUFDLENBQUM7TUFDdkIsTUFBTWdaLE9BQU8sR0FBRzdoQixZQUFZLENBQUM0SSxJQUFJLENBQUM7TUFDbEMsTUFBTSxJQUFJLENBQUN0QyxvQkFBb0IsQ0FBQyxDQUFDO01BRWpDLElBQUksQ0FBQ3FiLFVBQVUsQ0FBQzVNLE1BQU0sQ0FBQytNLFVBQVUsRUFBRTtRQUNqQztRQUNBO1FBQ0EsTUFBTWhCLE9BQU8sR0FBRyxJQUFJalksSUFBSSxDQUFDLENBQUM7UUFDMUJpWSxPQUFPLENBQUNpQixVQUFVLENBQUNoa0IsdUJBQXVCLENBQUM7UUFDM0M0akIsVUFBVSxDQUFDSyxVQUFVLENBQUNsQixPQUFPLENBQUM7TUFDaEM7TUFFQWEsVUFBVSxDQUFDNU0sTUFBTSxDQUFDMkcsVUFBVSxDQUFDaFEsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRW1XLE9BQU8sQ0FBQyxDQUFDO01BQ2pFRixVQUFVLENBQUNDLFFBQVEsQ0FBQyxZQUFZLENBQUMsR0FBR0MsT0FBTztNQUUzQ0YsVUFBVSxDQUFDNU0sTUFBTSxDQUFDMkcsVUFBVSxDQUFDaFEsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLGtCQUFrQixDQUFDLENBQUM7TUFDakZpVyxVQUFVLENBQUNDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLGtCQUFrQjtNQUUzREQsVUFBVSxDQUFDNU0sTUFBTSxDQUFDMkcsVUFBVSxDQUFDaFEsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLElBQUksQ0FBQzlILFNBQVMsR0FBRyxHQUFHLEdBQUdoRixRQUFRLENBQUNrRSxNQUFNLEVBQUU4RixJQUFJLENBQUMsQ0FBQyxDQUFDO01BQzdHK1ksVUFBVSxDQUFDQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsR0FBRyxJQUFJLENBQUNoZSxTQUFTLEdBQUcsR0FBRyxHQUFHaEYsUUFBUSxDQUFDa0UsTUFBTSxFQUFFOEYsSUFBSSxDQUFDO01BRXZGLElBQUksSUFBSSxDQUFDOUUsWUFBWSxFQUFFO1FBQ3JCNmQsVUFBVSxDQUFDNU0sTUFBTSxDQUFDMkcsVUFBVSxDQUFDaFEsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFLElBQUksQ0FBQzVILFlBQVksQ0FBQyxDQUFDO1FBQ3JGNmQsVUFBVSxDQUFDQyxRQUFRLENBQUMsc0JBQXNCLENBQUMsR0FBRyxJQUFJLENBQUM5ZCxZQUFZO01BQ2pFO01BRUEsTUFBTW1lLFlBQVksR0FBR3haLE1BQU0sQ0FBQ3lELElBQUksQ0FBQ3hFLElBQUksQ0FBQ0MsU0FBUyxDQUFDZ2EsVUFBVSxDQUFDNU0sTUFBTSxDQUFDLENBQUMsQ0FBQzNPLFFBQVEsQ0FBQyxRQUFRLENBQUM7TUFFdEZ1YixVQUFVLENBQUNDLFFBQVEsQ0FBQzdNLE1BQU0sR0FBR2tOLFlBQVk7TUFFekNOLFVBQVUsQ0FBQ0MsUUFBUSxDQUFDLGlCQUFpQixDQUFDLEdBQUcxakIsc0JBQXNCLENBQUM0RSxNQUFNLEVBQUU4RixJQUFJLEVBQUUsSUFBSSxDQUFDL0UsU0FBUyxFQUFFb2UsWUFBWSxDQUFDO01BQzNHLE1BQU0zYyxJQUFJLEdBQUc7UUFDWHhDLE1BQU0sRUFBRUEsTUFBTTtRQUNkZ0MsVUFBVSxFQUFFQSxVQUFVO1FBQ3RCUyxNQUFNLEVBQUU7TUFDVixDQUFDO01BQ0QsTUFBTWxCLFVBQVUsR0FBRyxJQUFJLENBQUNnQixpQkFBaUIsQ0FBQ0MsSUFBSSxDQUFDO01BQy9DLE1BQU00YyxPQUFPLEdBQUcsSUFBSSxDQUFDeGYsSUFBSSxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUNBLElBQUksS0FBSyxHQUFHLEdBQUcsRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDQSxJQUFJLENBQUMwRCxRQUFRLENBQUMsQ0FBQyxFQUFFO01BQ3RGLE1BQU0rYixNQUFNLEdBQUcsR0FBRzlkLFVBQVUsQ0FBQ3BCLFFBQVEsS0FBS29CLFVBQVUsQ0FBQ3RCLElBQUksR0FBR21mLE9BQU8sR0FBRzdkLFVBQVUsQ0FBQ3BILElBQUksRUFBRTtNQUN2RixPQUFPO1FBQUVtbEIsT0FBTyxFQUFFRCxNQUFNO1FBQUVQLFFBQVEsRUFBRUQsVUFBVSxDQUFDQztNQUFTLENBQUM7SUFDM0QsQ0FBQyxDQUFDLE9BQU81YSxHQUFHLEVBQUU7TUFDWixJQUFJQSxHQUFHLFlBQVl0SixNQUFNLENBQUNzTCxzQkFBc0IsRUFBRTtRQUNoRCxNQUFNLElBQUl0TCxNQUFNLENBQUNtRixvQkFBb0IsQ0FBQyxtQ0FBbUNpQyxVQUFVLEdBQUcsQ0FBQztNQUN6RjtNQUVBLE1BQU1rQyxHQUFHO0lBQ1g7RUFDRjtFQUNBO0VBQ0EsTUFBTXFiLGdCQUFnQkEsQ0FBQ3ZkLFVBQWtCLEVBQUUrSSxNQUFlLEVBQUVtRCxNQUFlLEVBQUVzUixhQUFtQyxFQUFFO0lBQ2hILElBQUksQ0FBQzVpQixpQkFBaUIsQ0FBQ29GLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXBILE1BQU0sQ0FBQ3NMLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHbEUsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDckYsUUFBUSxDQUFDb08sTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJbEosU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBQ0EsSUFBSXFNLE1BQU0sSUFBSSxDQUFDdlIsUUFBUSxDQUFDdVIsTUFBTSxDQUFDLEVBQUU7TUFDL0IsTUFBTSxJQUFJck0sU0FBUyxDQUFDLG1DQUFtQyxDQUFDO0lBQzFEO0lBRUEsSUFBSTJkLGFBQWEsSUFBSSxDQUFDaGpCLFFBQVEsQ0FBQ2dqQixhQUFhLENBQUMsRUFBRTtNQUM3QyxNQUFNLElBQUkzZCxTQUFTLENBQUMsMENBQTBDLENBQUM7SUFDakU7SUFDQSxJQUFJO01BQUU0ZCxTQUFTO01BQUVDLE9BQU87TUFBRUMsY0FBYztNQUFFQyxlQUFlO01BQUUxVTtJQUFVLENBQUMsR0FBR3NVLGFBQW9DO0lBRTdHLElBQUksQ0FBQzdpQixRQUFRLENBQUM4aUIsU0FBUyxDQUFDLEVBQUU7TUFDeEIsTUFBTSxJQUFJNWQsU0FBUyxDQUFDLHNDQUFzQyxDQUFDO0lBQzdEO0lBQ0EsSUFBSSxDQUFDdEYsUUFBUSxDQUFDbWpCLE9BQU8sQ0FBQyxFQUFFO01BQ3RCLE1BQU0sSUFBSTdkLFNBQVMsQ0FBQyxvQ0FBb0MsQ0FBQztJQUMzRDtJQUVBLE1BQU02SyxPQUFPLEdBQUcsRUFBRTtJQUNsQjtJQUNBQSxPQUFPLENBQUM5RCxJQUFJLENBQUMsVUFBVWxMLFNBQVMsQ0FBQ3FOLE1BQU0sQ0FBQyxFQUFFLENBQUM7SUFDM0MyQixPQUFPLENBQUM5RCxJQUFJLENBQUMsYUFBYWxMLFNBQVMsQ0FBQytoQixTQUFTLENBQUMsRUFBRSxDQUFDO0lBQ2pEL1MsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLG1CQUFtQixDQUFDO0lBRWpDLElBQUkrVyxjQUFjLEVBQUU7TUFDbEJqVCxPQUFPLENBQUM5RCxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQzFCO0lBRUEsSUFBSStXLGNBQWMsRUFBRTtNQUNsQjtNQUNBLElBQUl6VSxTQUFTLEVBQUU7UUFDYndCLE9BQU8sQ0FBQzlELElBQUksQ0FBQyxjQUFjc0MsU0FBUyxFQUFFLENBQUM7TUFDekM7TUFDQSxJQUFJMFUsZUFBZSxFQUFFO1FBQ25CbFQsT0FBTyxDQUFDOUQsSUFBSSxDQUFDLHFCQUFxQmdYLGVBQWUsRUFBRSxDQUFDO01BQ3REO0lBQ0YsQ0FBQyxNQUFNLElBQUkxUixNQUFNLEVBQUU7TUFDakJBLE1BQU0sR0FBR3hRLFNBQVMsQ0FBQ3dRLE1BQU0sQ0FBQztNQUMxQnhCLE9BQU8sQ0FBQzlELElBQUksQ0FBQyxVQUFVc0YsTUFBTSxFQUFFLENBQUM7SUFDbEM7O0lBRUE7SUFDQSxJQUFJd1IsT0FBTyxFQUFFO01BQ1gsSUFBSUEsT0FBTyxJQUFJLElBQUksRUFBRTtRQUNuQkEsT0FBTyxHQUFHLElBQUk7TUFDaEI7TUFDQWhULE9BQU8sQ0FBQzlELElBQUksQ0FBQyxZQUFZOFcsT0FBTyxFQUFFLENBQUM7SUFDckM7SUFDQWhULE9BQU8sQ0FBQ0UsSUFBSSxDQUFDLENBQUM7SUFDZCxJQUFJakssS0FBSyxHQUFHLEVBQUU7SUFDZCxJQUFJK0osT0FBTyxDQUFDdEgsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN0QnpDLEtBQUssR0FBRyxHQUFHK0osT0FBTyxDQUFDSSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUU7SUFDaEM7SUFFQSxNQUFNckssTUFBTSxHQUFHLEtBQUs7SUFDcEIsTUFBTWdELEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQ1IsZ0JBQWdCLENBQUM7TUFBRXhDLE1BQU07TUFBRVQsVUFBVTtNQUFFVztJQUFNLENBQUMsQ0FBQztJQUN0RSxNQUFNK0MsSUFBSSxHQUFHLE1BQU16SCxZQUFZLENBQUN3SCxHQUFHLENBQUM7SUFDcEMsTUFBTW9hLFdBQVcsR0FBR3hoQixnQkFBZ0IsQ0FBQ3FILElBQUksQ0FBQztJQUMxQyxPQUFPbWEsV0FBVztFQUNwQjtFQUVBQyxXQUFXQSxDQUNUOWQsVUFBa0IsRUFDbEIrSSxNQUFlLEVBQ2Z0QixTQUFtQixFQUNuQnNXLFFBQTBDLEVBQ2hCO0lBQzFCLElBQUloVixNQUFNLEtBQUt0TCxTQUFTLEVBQUU7TUFDeEJzTCxNQUFNLEdBQUcsRUFBRTtJQUNiO0lBQ0EsSUFBSXRCLFNBQVMsS0FBS2hLLFNBQVMsRUFBRTtNQUMzQmdLLFNBQVMsR0FBRyxLQUFLO0lBQ25CO0lBQ0EsSUFBSSxDQUFDN00saUJBQWlCLENBQUNvRixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUlwSCxNQUFNLENBQUNzTCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR2xFLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQ2hGLGFBQWEsQ0FBQytOLE1BQU0sQ0FBQyxFQUFFO01BQzFCLE1BQU0sSUFBSW5RLE1BQU0sQ0FBQ29RLGtCQUFrQixDQUFDLG9CQUFvQkQsTUFBTSxFQUFFLENBQUM7SUFDbkU7SUFDQSxJQUFJLENBQUNwTyxRQUFRLENBQUNvTyxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUlsSixTQUFTLENBQUMsbUNBQW1DLENBQUM7SUFDMUQ7SUFDQSxJQUFJLENBQUN6RixTQUFTLENBQUNxTixTQUFTLENBQUMsRUFBRTtNQUN6QixNQUFNLElBQUk1SCxTQUFTLENBQUMsdUNBQXVDLENBQUM7SUFDOUQ7SUFDQSxJQUFJa2UsUUFBUSxJQUFJLENBQUN2akIsUUFBUSxDQUFDdWpCLFFBQVEsQ0FBQyxFQUFFO01BQ25DLE1BQU0sSUFBSWxlLFNBQVMsQ0FBQyxxQ0FBcUMsQ0FBQztJQUM1RDtJQUNBLElBQUlxTSxNQUEwQixHQUFHLEVBQUU7SUFDbkMsSUFBSWhELFNBQTZCLEdBQUcsRUFBRTtJQUN0QyxJQUFJMFUsZUFBbUMsR0FBRyxFQUFFO0lBQzVDLElBQUlJLE9BQXFCLEdBQUcsRUFBRTtJQUM5QixJQUFJM1UsS0FBSyxHQUFHLEtBQUs7SUFDakIsTUFBTUMsVUFBMkIsR0FBRyxJQUFJbFIsTUFBTSxDQUFDbVIsUUFBUSxDQUFDO01BQUVDLFVBQVUsRUFBRTtJQUFLLENBQUMsQ0FBQztJQUM3RUYsVUFBVSxDQUFDRyxLQUFLLEdBQUcsWUFBWTtNQUM3QjtNQUNBLElBQUl1VSxPQUFPLENBQUM1YSxNQUFNLEVBQUU7UUFDbEJrRyxVQUFVLENBQUMxQyxJQUFJLENBQUNvWCxPQUFPLENBQUN0VSxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ2hDO01BQ0Y7TUFDQSxJQUFJTCxLQUFLLEVBQUU7UUFDVCxPQUFPQyxVQUFVLENBQUMxQyxJQUFJLENBQUMsSUFBSSxDQUFDO01BQzlCO01BRUEsSUFBSTtRQUNGLE1BQU00VyxhQUFhLEdBQUc7VUFDcEJDLFNBQVMsRUFBRWhXLFNBQVMsR0FBRyxFQUFFLEdBQUcsR0FBRztVQUFFO1VBQ2pDaVcsT0FBTyxFQUFFLElBQUk7VUFDYkMsY0FBYyxFQUFFSSxRQUFRLGFBQVJBLFFBQVEsdUJBQVJBLFFBQVEsQ0FBRUosY0FBYztVQUN4QztVQUNBelUsU0FBUyxFQUFFQSxTQUFTO1VBQ3BCMFUsZUFBZSxFQUFFQTtRQUNuQixDQUFDO1FBRUQsTUFBTTNZLE1BQTBCLEdBQUcsTUFBTSxJQUFJLENBQUNzWSxnQkFBZ0IsQ0FBQ3ZkLFVBQVUsRUFBRStJLE1BQU0sRUFBRW1ELE1BQU0sRUFBRXNSLGFBQWEsQ0FBQztRQUN6RyxJQUFJdlksTUFBTSxDQUFDc0YsV0FBVyxFQUFFO1VBQ3RCMkIsTUFBTSxHQUFHakgsTUFBTSxDQUFDZ1osVUFBVSxJQUFJeGdCLFNBQVM7VUFDdkMsSUFBSXdILE1BQU0sQ0FBQ2lFLFNBQVMsRUFBRTtZQUNwQkEsU0FBUyxHQUFHakUsTUFBTSxDQUFDaUUsU0FBUztVQUM5QjtVQUNBLElBQUlqRSxNQUFNLENBQUMyWSxlQUFlLEVBQUU7WUFDMUJBLGVBQWUsR0FBRzNZLE1BQU0sQ0FBQzJZLGVBQWU7VUFDMUM7UUFDRixDQUFDLE1BQU07VUFDTHZVLEtBQUssR0FBRyxJQUFJO1FBQ2Q7UUFDQSxJQUFJcEUsTUFBTSxDQUFDK1ksT0FBTyxFQUFFO1VBQ2xCQSxPQUFPLEdBQUcvWSxNQUFNLENBQUMrWSxPQUFPO1FBQzFCO1FBQ0E7UUFDQTFVLFVBQVUsQ0FBQ0csS0FBSyxDQUFDLENBQUM7TUFDcEIsQ0FBQyxDQUFDLE9BQU92SCxHQUFHLEVBQUU7UUFDWm9ILFVBQVUsQ0FBQ2dCLElBQUksQ0FBQyxPQUFPLEVBQUVwSSxHQUFHLENBQUM7TUFDL0I7SUFDRixDQUFDO0lBQ0QsT0FBT29ILFVBQVU7RUFDbkI7QUFDRiIsImlnbm9yZUxpc3QiOltdfQ==