"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var crypto = _interopRequireWildcard(require("crypto"), true);
var fs = _interopRequireWildcard(require("fs"), true);
var http = _interopRequireWildcard(require("http"), true);
var https = _interopRequireWildcard(require("https"), true);
var path = _interopRequireWildcard(require("path"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var async = _interopRequireWildcard(require("async"), true);
var _blockStream = require("block-stream2");
var _browserOrNode = require("browser-or-node");
var _lodash = require("lodash");
var qs = _interopRequireWildcard(require("query-string"), true);
var _xml2js = require("xml2js");
var _CredentialProvider = require("../CredentialProvider.js");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _signing = require("../signing.js");
var _async2 = require("./async.js");
var _copyConditions = require("./copy-conditions.js");
var _extensions = require("./extensions.js");
var _helper = require("./helper.js");
var _joinHostPort = require("./join-host-port.js");
var _postPolicy = require("./post-policy.js");
var _request = require("./request.js");
var _response = require("./response.js");
var _s3Endpoints = require("./s3-endpoints.js");
var _xmlParser = _interopRequireWildcard(require("./xml-parser.js"), true);
var xmlParsers = _xmlParser;
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
const xml = new _xml2js.Builder({
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
class TypedClient {
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
    if (!(0, _helper.isValidEndpoint)(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!(0, _helper.isValidPort)(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!(0, _helper.isBoolean)(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!(0, _helper.isString)(params.region)) {
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
      if (!(0, _helper.isObject)(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!(0, _helper.isObject)(params.transportAgent)) {
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
    this.clientExtensions = new _extensions.Extensions(this);
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _lodash.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!(0, _helper.isEmpty)(this.s3AccelerateEndpoint) && !(0, _helper.isEmpty)(bucketName) && !(0, _helper.isEmpty)(objectName)) {
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
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
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
      virtualHostStyle = (0, _helper.isVirtualHostStyle)(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = (0, _helper.uriResourceEscape)(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if ((0, _helper.isAmazonEndpoint)(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = (0, _s3Endpoints.getS3Endpoint)(region);
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
      reqOptions.headers.host = (0, _joinHostPort.joinHostPort)(host, port);
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
      headers: _lodash.mapValues(_lodash.pickBy(reqOptions.headers, _helper.isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof _CredentialProvider.CredentialProvider)) {
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
    if (!(0, _helper.isObject)(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !(0, _helper.isReadableStream)(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if ((0, _helper.isString)(v)) {
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(0, _helper.isString)(payload) && !(0, _helper.isObject)(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? (0, _helper.toSha256)(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await (0, _response.drainResponse)(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || (0, _helper.isReadableStream)(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!(0, _helper.isString)(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
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
      reqOptions.headers['x-amz-date'] = (0, _helper.makeDateLong)(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = (0, _signing.signV4)(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await (0, _request.requestWithRetry)(this.transport, reqOptions, body);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
      const body = await (0, _response.readAsString)(response);
      const region = xmlParsers.parseBucketRegion(body) || _helpers.DEFAULT_REGION;
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
    const pathStyle = this.pathStyle && !_browserOrNode.isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], _helpers.DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return _helpers.DEFAULT_REGION;
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
        await (0, _response.drainResponse)(res);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if ((0, _helper.isObject)(region)) {
      makeOpts = region;
      region = '';
    }
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !(0, _helper.isObject)(makeOpts)) {
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
    if (region && region !== _helpers.DEFAULT_REGION) {
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
    const finalRegion = this.region || region || _helpers.DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === _helpers.DEFAULT_REGION) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isNumber)(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!(0, _helper.isNumber)(length)) {
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
        ...(0, _helper.prependXAMZMeta)(sseHeaders),
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await _async2.fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await _async2.fsp.stat(partFile);
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
      await _async2.streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await _async2.fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await _async2.fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(statOptDef)) {
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
      metaData: (0, _helper.extractMetadata)(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: (0, _helper.getVersionId)(res.headers),
      etag: (0, _helper.sanitizeETag)(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !(0, _helper.isObject)(removeOpts)) {
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
    if (!(0, _helper.isValidBucketName)(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isBoolean)(recursive)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${(0, _helper.uriEscape)(keyMarker)}`);
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(headers)) {
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
    const body = await (0, _response.readAsBuffer)(res);
    return (0, _xmlParser.parseInitiateMultipart)(body.toString());
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isObject)(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    const builder = new _xml2js.Builder();
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
    const body = await (0, _response.readAsBuffer)(res);
    const result = (0, _xmlParser.parseCompleteMultipart)(body.toString());
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
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isNumber)(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
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
    return xmlParsers.parseListParts(await (0, _response.readAsString)(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || _helpers.DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!(0, _helper.isNumber)(size)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !(0, _helper.isObject)(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = (0, _helper.insertContentType)(metaData || {}, filePath);
    const stat = await _async2.fsp.stat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if ((0, _helper.isObject)(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = (0, _helper.prependXAMZMeta)(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = (0, _helper.readableStream)(stream);
    } else if (!(0, _helper.isReadableStream)(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if ((0, _helper.isNumber)(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!(0, _helper.isNumber)(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await (0, _helper.getContentLength)(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!(0, _helper.isNumber)(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    if (size === 0) {
      return this.uploadBuffer(bucketName, objectName, headers, Buffer.from(''));
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = (0, _helper.isReadableStream)(stream) ? await (0, _response.readAsBuffer)(stream) : Buffer.from(stream);
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
    } = (0, _helper.hashBinary)(buf, this.enableSHA256);
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
    await (0, _response.drainResponse)(res);
    return {
      etag: (0, _helper.sanitizeETag)(res.headers.etag),
      versionId: (0, _helper.getVersionId)(res.headers)
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
    const chunkier = new _blockStream({
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_lodash.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !(0, _helper.isString)(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_lodash.isEmpty(replicationConfig.rules)) {
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
    const builder = new _xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!(0, _helper.isObject)(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
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
    const strRes = await (0, _response.readAsString)(httpRes);
    return (0, _xmlParser.parseObjectLegalHoldConfig)(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: _helpers.LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![_helpers.LEGAL_HOLD_STATUS.ENABLED, _helpers.LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
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
    const builder = new _xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
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
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(policy)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await (0, _response.readAsString)(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !(0, _helper.isBoolean)(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !(0, _helper.isString)(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !(0, _helper.isString)(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new _xml2js.Builder({
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
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE];
    const validUnits = [_helpers.RETENTION_VALIDITY_UNITS.DAYS, _helpers.RETENTION_VALIDITY_UNITS.YEARS];
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !(0, _helper.isNumber)(lockConfigOpts.validity)) {
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
        if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new _xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new _xml2js.Builder({
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
    const builder = new _xml2js.Builder({
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
    headers['Content-MD5'] = (0, _helper.toMd5)(payloadBuf);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isPlainObject)(tags)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!(0, _helper.isPlainObject)(tags)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
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
    const builder = new _xml2js.Builder({
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
    const body = await (0, _response.readAsBuffer)(res);
    return (0, _xmlParser.parseSelectObjectContentResponse)(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new _xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
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
    const builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return (0, _helper.isObject)(value) ? {
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
      const payload = Buffer.from(new _xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': (0, _helper.toMd5)(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await (0, _response.readAsString)(res);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!(0, _helper.isValidObjectName)(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!(0, _helper.isString)(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(sourceBucketNameAndObjectName);
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
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
    const body = await (0, _response.readAsString)(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: (0, _helper.extractMetadata)(resHeaders),
      VersionId: (0, _helper.getVersionId)(resHeaders),
      SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
      Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
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
    const body = await (0, _response.readAsString)(res);
    const partRes = (0, _xmlParser.uploadPartParser)(body);
    return {
      etag: (0, _helper.sanitizeETag)(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
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
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
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
      if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += (0, _helper.partsRequired)(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
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
      expires = _helpers.PRESIGN_EXPIRY_DAYS_MAX;
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
      return (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = (0, _helper.makeDateLong)(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(_helpers.PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (marker && !(0, _helper.isString)(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !(0, _helper.isObject)(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion,
      versionIdMarker,
      keyMarker
    } = listQueryOpts;
    if (!(0, _helper.isString)(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(Delimiter)}`);
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
      marker = (0, _helper.uriEscape)(marker);
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
    const body = await (0, _response.readAsString)(res);
    const listQryList = (0, _xmlParser.parseListObjects)(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !(0, _helper.isObject)(listOpts)) {
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
exports.TypedClient = TypedClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIl9ibG9ja1N0cmVhbSIsIl9icm93c2VyT3JOb2RlIiwiX2xvZGFzaCIsInFzIiwiX3htbDJqcyIsIl9DcmVkZW50aWFsUHJvdmlkZXIiLCJlcnJvcnMiLCJfaGVscGVycyIsIl9zaWduaW5nIiwiX2FzeW5jMiIsIl9jb3B5Q29uZGl0aW9ucyIsIl9leHRlbnNpb25zIiwiX2hlbHBlciIsIl9qb2luSG9zdFBvcnQiLCJfcG9zdFBvbGljeSIsIl9yZXF1ZXN0IiwiX3Jlc3BvbnNlIiwiX3MzRW5kcG9pbnRzIiwiX3htbFBhcnNlciIsInhtbFBhcnNlcnMiLCJlIiwidCIsIldlYWtNYXAiLCJyIiwibiIsIl9fZXNNb2R1bGUiLCJvIiwiaSIsImYiLCJfX3Byb3RvX18iLCJkZWZhdWx0IiwiaGFzIiwiZ2V0Iiwic2V0IiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJ4bWwiLCJ4bWwyanMiLCJCdWlsZGVyIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwiUGFja2FnZSIsInZlcnNpb24iLCJyZXF1ZXN0T3B0aW9uUHJvcGVydGllcyIsIlR5cGVkQ2xpZW50IiwicGFydFNpemUiLCJtYXhpbXVtUGFydFNpemUiLCJtYXhPYmplY3RTaXplIiwiY29uc3RydWN0b3IiLCJwYXJhbXMiLCJzZWN1cmUiLCJ1bmRlZmluZWQiLCJFcnJvciIsInVzZVNTTCIsInBvcnQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJlbmRQb2ludCIsIkludmFsaWRFbmRwb2ludEVycm9yIiwiaXNWYWxpZFBvcnQiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsImlzQm9vbGVhbiIsInJlZ2lvbiIsImlzU3RyaW5nIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwiaXNPYmplY3QiLCJsaWJyYXJ5Q29tbWVudHMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJhcmNoIiwibGlicmFyeUFnZW50IiwidXNlckFnZW50IiwicGF0aFN0eWxlIiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwiYW5vbnltb3VzIiwiY3JlZGVudGlhbHNQcm92aWRlciIsInJlZ2lvbk1hcCIsIm92ZXJSaWRlUGFydFNpemUiLCJlbmFibGVTSEEyNTYiLCJzM0FjY2VsZXJhdGVFbmRwb2ludCIsInJlcU9wdGlvbnMiLCJjbGllbnRFeHRlbnNpb25zIiwiRXh0ZW5zaW9ucyIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsIl8iLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImlzRW1wdHkiLCJpbmNsdWRlcyIsInNldEFwcEluZm8iLCJhcHBOYW1lIiwiYXBwVmVyc2lvbiIsInRyaW0iLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJhY2NlbGVyYXRlRW5kUG9pbnQiLCJnZXRTM0VuZHBvaW50Iiwiam9pbkhvc3RQb3J0IiwiayIsInYiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwiaXNEZWZpbmVkIiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiQ3JlZGVudGlhbFByb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImNhdXNlIiwibG9nSFRUUCIsInJlc3BvbnNlIiwiZXJyIiwibG9nU3RyZWFtIiwiaXNSZWFkYWJsZVN0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJpc051bWJlciIsImxlbmd0aCIsInNoYTI1NnN1bSIsInRvU2hhMjU2IiwibWFrZVJlcXVlc3RTdHJlYW1Bc3luYyIsIm1ha2VSZXF1ZXN0QXN5bmNPbWl0Iiwic3RhdHVzQ29kZXMiLCJyZXMiLCJkcmFpblJlc3BvbnNlIiwiYm9keSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZ2V0QnVja2V0UmVnaW9uQXN5bmMiLCJkYXRlIiwiRGF0ZSIsIm1ha2VEYXRlTG9uZyIsImF1dGhvcml6YXRpb24iLCJzaWduVjQiLCJyZXF1ZXN0V2l0aFJldHJ5IiwicGFyc2VSZXNwb25zZUVycm9yIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiY2FjaGVkIiwiZXh0cmFjdFJlZ2lvbkFzeW5jIiwicmVhZEFzU3RyaW5nIiwicGFyc2VCdWNrZXRSZWdpb24iLCJERUZBVUxUX1JFR0lPTiIsImlzQnJvd3NlciIsIlMzRXJyb3IiLCJlcnJDb2RlIiwiY29kZSIsImVyclJlZ2lvbiIsIm5hbWUiLCJSZWdpb24iLCJtYWtlUmVxdWVzdCIsInJldHVyblJlc3BvbnNlIiwiY2IiLCJwcm9tIiwidGhlbiIsInJlc3VsdCIsIm1ha2VSZXF1ZXN0U3RyZWFtIiwiZXhlY3V0b3IiLCJnZXRCdWNrZXRSZWdpb24iLCJtYWtlQnVja2V0IiwibWFrZU9wdHMiLCJidWlsZE9iamVjdCIsIkNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24iLCIkIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJPYmplY3RMb2NraW5nIiwiZmluYWxSZWdpb24iLCJyZXF1ZXN0T3B0IiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlQnVja2V0IiwiZ2V0T2JqZWN0IiwiZ2V0T3B0cyIsImlzVmFsaWRPYmplY3ROYW1lIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsImdldFBhcnRpYWxPYmplY3QiLCJvZmZzZXQiLCJyYW5nZSIsInNzZUhlYWRlcnMiLCJTU0VDdXN0b21lckFsZ29yaXRobSIsIlNTRUN1c3RvbWVyS2V5IiwiU1NFQ3VzdG9tZXJLZXlNRDUiLCJwcmVwZW5kWEFNWk1ldGEiLCJleHBlY3RlZFN0YXR1c0NvZGVzIiwicHVzaCIsImZHZXRPYmplY3QiLCJmaWxlUGF0aCIsImRvd25sb2FkVG9UbXBGaWxlIiwicGFydEZpbGVTdHJlYW0iLCJvYmpTdGF0Iiwic3RhdE9iamVjdCIsImVuY29kZWRFdGFnIiwiZnJvbSIsImV0YWciLCJwYXJ0RmlsZSIsImZzcCIsIm1rZGlyIiwiZGlybmFtZSIsInJlY3Vyc2l2ZSIsInN0YXRzIiwic3RhdCIsInNpemUiLCJjcmVhdGVXcml0ZVN0cmVhbSIsImZsYWdzIiwiZG93bmxvYWRTdHJlYW0iLCJzdHJlYW1Qcm9taXNlIiwicGlwZWxpbmUiLCJyZW5hbWUiLCJzdGF0T3B0cyIsInN0YXRPcHREZWYiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwiZ2V0VmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiaXNWYWxpZFByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsInByZWZpeGVzIiwiZWFjaFNlcmllcyIsInVwbG9hZCIsImxpc3RQYXJ0cyIsImtleSIsInVwbG9hZElkIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiZW1pdCIsImlzVHJ1bmNhdGVkIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsInF1ZXJpZXMiLCJ1cmlFc2NhcGUiLCJtYXhVcGxvYWRzIiwic29ydCIsInVuc2hpZnQiLCJqb2luIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJyZWFkQXNCdWZmZXIiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwiYWJvcnRNdWx0aXBhcnRVcGxvYWQiLCJyZXF1ZXN0T3B0aW9ucyIsImZpbmRVcGxvYWRJZCIsIl9sYXRlc3RVcGxvYWQiLCJsYXRlc3RVcGxvYWQiLCJpbml0aWF0ZWQiLCJnZXRUaW1lIiwiY29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJldGFncyIsImJ1aWxkZXIiLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIlBhcnQiLCJtYXAiLCJQYXJ0TnVtYmVyIiwicGFydCIsIkVUYWciLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsInJlZ2lvbkNvbmYiLCJodHRwUmVzIiwieG1sUmVzdWx0IiwicGFyc2VMaXN0QnVja2V0IiwiY2FsY3VsYXRlUGFydFNpemUiLCJmUHV0T2JqZWN0IiwiaW5zZXJ0Q29udGVudFR5cGUiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwicmVhZGFibGVTdHJlYW0iLCJzdGF0U2l6ZSIsImdldENvbnRlbnRMZW5ndGgiLCJ1cGxvYWRCdWZmZXIiLCJidWYiLCJ1cGxvYWRTdHJlYW0iLCJtZDVzdW0iLCJoYXNoQmluYXJ5Iiwib2xkUGFydHMiLCJlVGFncyIsInByZXZpb3VzVXBsb2FkSWQiLCJvbGRUYWdzIiwiY2h1bmtpZXIiLCJCbG9ja1N0cmVhbTIiLCJ6ZXJvUGFkZGluZyIsIlByb21pc2UiLCJhbGwiLCJyZXNvbHZlIiwicmVqZWN0IiwicGlwZSIsIm9uIiwicGFydE51bWJlciIsImNodW5rIiwibWQ1IiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm9sZFBhcnQiLCJyZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiIsInNldEJ1Y2tldFJlcGxpY2F0aW9uIiwicmVwbGljYXRpb25Db25maWciLCJyb2xlIiwicnVsZXMiLCJyZXBsaWNhdGlvblBhcmFtc0NvbmZpZyIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsIlJvbGUiLCJSdWxlIiwidG9NZDUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJzZXRPYmplY3RMZWdhbEhvbGQiLCJzZXRPcHRzIiwic3RhdHVzIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJFTkFCTEVEIiwiRElTQUJMRUQiLCJjb25maWciLCJTdGF0dXMiLCJyb290TmFtZSIsImdldEJ1Y2tldFRhZ2dpbmciLCJwYXJzZVRhZ2dpbmciLCJnZXRPYmplY3RUYWdnaW5nIiwic2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yIiwiZ2V0QnVja2V0UG9saWN5IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uT3B0cyIsIm1vZGUiLCJSRVRFTlRJT05fTU9ERVMiLCJDT01QTElBTkNFIiwiR09WRVJOQU5DRSIsInJldGFpblVudGlsRGF0ZSIsIk1vZGUiLCJSZXRhaW5VbnRpbERhdGUiLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdPcHRzIiwicmV0ZW50aW9uTW9kZXMiLCJ2YWxpZFVuaXRzIiwiUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIiwiREFZUyIsIllFQVJTIiwidW5pdCIsInZhbGlkaXR5IiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJjb25maWdLZXlzIiwiaXNBbGxLZXlzU2V0IiwiZXZlcnkiLCJsY2siLCJEZWZhdWx0UmV0ZW50aW9uIiwiRGF5cyIsIlllYXJzIiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsInNldEJ1Y2tldFZlcnNpb25pbmciLCJ2ZXJzaW9uQ29uZmlnIiwic2V0VGFnZ2luZyIsInRhZ2dpbmdQYXJhbXMiLCJ0YWdzIiwicHV0T3B0cyIsInRhZ3NMaXN0IiwidmFsdWUiLCJLZXkiLCJWYWx1ZSIsInRhZ2dpbmdDb25maWciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwicGF5bG9hZEJ1ZiIsInJlbW92ZVRhZ2dpbmciLCJzZXRCdWNrZXRUYWdnaW5nIiwiaXNQbGFpbk9iamVjdCIsInJlbW92ZUJ1Y2tldFRhZ2dpbmciLCJzZXRPYmplY3RUYWdnaW5nIiwicmVtb3ZlT2JqZWN0VGFnZ2luZyIsInNlbGVjdE9iamVjdENvbnRlbnQiLCJzZWxlY3RPcHRzIiwiZXhwcmVzc2lvbiIsImlucHV0U2VyaWFsaXphdGlvbiIsIm91dHB1dFNlcmlhbGl6YXRpb24iLCJFeHByZXNzaW9uIiwiRXhwcmVzc2lvblR5cGUiLCJleHByZXNzaW9uVHlwZSIsIklucHV0U2VyaWFsaXphdGlvbiIsIk91dHB1dFNlcmlhbGl6YXRpb24iLCJyZXF1ZXN0UHJvZ3Jlc3MiLCJSZXF1ZXN0UHJvZ3Jlc3MiLCJzY2FuUmFuZ2UiLCJTY2FuUmFuZ2UiLCJwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSIsImFwcGx5QnVja2V0TGlmZWN5Y2xlIiwicG9saWN5Q29uZmlnIiwicmVtb3ZlQnVja2V0TGlmZWN5Y2xlIiwic2V0QnVja2V0TGlmZWN5Y2xlIiwibGlmZUN5Y2xlQ29uZmlnIiwiZ2V0QnVja2V0TGlmZWN5Y2xlIiwicGFyc2VMaWZlY3ljbGVDb25maWciLCJzZXRCdWNrZXRFbmNyeXB0aW9uIiwiZW5jcnlwdGlvbkNvbmZpZyIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsInBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJnZXRPYmplY3RSZXRlbnRpb24iLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJlbW92ZU9iamVjdHMiLCJvYmplY3RzTGlzdCIsIkFycmF5IiwiaXNBcnJheSIsInJ1bkRlbGV0ZU9iamVjdHMiLCJiYXRjaCIsImRlbE9iamVjdHMiLCJWZXJzaW9uSWQiLCJyZW1PYmplY3RzIiwiRGVsZXRlIiwiUXVpZXQiLCJyZW1vdmVPYmplY3RzUGFyc2VyIiwibWF4RW50cmllcyIsImJhdGNoZXMiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJDb3B5Q29uZGl0aW9ucyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRVRhZ0V4Y2VwdCIsInBhcnNlQ29weU9iamVjdCIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJDb3B5U291cmNlT3B0aW9ucyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJ2YWxpZGF0ZSIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJjb3B5UmVzIiwicmVzSGVhZGVycyIsInNpemVIZWFkZXJWYWx1ZSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiU291cmNlVmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwiRXRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsInNvdXJjZSIsImRlc3QiLCJ1cGxvYWRQYXJ0IiwicGFydENvbmZpZyIsInVwbG9hZElEIiwicGFydFJlcyIsInVwbG9hZFBhcnRQYXJzZXIiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIlBBUlRfQ09OU1RSQUlOVFMiLCJNQVhfUEFSVFNfQ09VTlQiLCJzT2JqIiwiZ2V0U3RhdE9wdGlvbnMiLCJzcmNDb25maWciLCJWZXJzaW9uSUQiLCJzcmNPYmplY3RTaXplcyIsInRvdGFsU2l6ZSIsInRvdGFsUGFydHMiLCJzb3VyY2VPYmpTdGF0cyIsInNyY0l0ZW0iLCJzcmNPYmplY3RJbmZvcyIsInZhbGlkYXRlZFN0YXRzIiwicmVzSXRlbVN0YXQiLCJpbmRleCIsInNyY0NvcHlTaXplIiwiTWF0Y2hSYW5nZSIsInNyY1N0YXJ0IiwiU3RhcnQiLCJzcmNFbmQiLCJFbmQiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwicGFydHNSZXF1aXJlZCIsIk1BWF9QQVJUX1NJWkUiLCJNYXRjaEVUYWciLCJzcGxpdFBhcnRTaXplTGlzdCIsImlkeCIsImNhbGN1bGF0ZUV2ZW5TcGxpdHMiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsIlBSRVNJR05fRVhQSVJZX0RBWVNfTUFYIiwiaXNOYU4iLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduZWRHZXRPYmplY3QiLCJyZXNwSGVhZGVycyIsInZhbGlkUmVzcEhlYWRlcnMiLCJoZWFkZXIiLCJwcmVzaWduZWRQdXRPYmplY3QiLCJuZXdQb3N0UG9saWN5IiwiUG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwiZ2V0U2NvcGUiLCJwb2xpY3lCYXNlNjQiLCJwb3N0UHJlc2lnblNpZ25hdHVyZVY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsInZlcnNpb25JZE1hcmtlciIsImxpc3RRcnlMaXN0IiwicGFyc2VMaXN0T2JqZWN0cyIsImxpc3RPYmplY3RzIiwibGlzdE9wdHMiLCJvYmplY3RzIiwibmV4dE1hcmtlciIsImV4cG9ydHMiXSwic291cmNlcyI6WyJjbGllbnQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJ1xyXG5pbXBvcnQgdHlwZSB7IEluY29taW5nSHR0cEhlYWRlcnMgfSBmcm9tICdub2RlOmh0dHAnXHJcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJ1xyXG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJ1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcclxuaW1wb3J0ICogYXMgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xyXG5cclxuaW1wb3J0ICogYXMgYXN5bmMgZnJvbSAnYXN5bmMnXHJcbmltcG9ydCBCbG9ja1N0cmVhbTIgZnJvbSAnYmxvY2stc3RyZWFtMidcclxuaW1wb3J0IHsgaXNCcm93c2VyIH0gZnJvbSAnYnJvd3Nlci1vci1ub2RlJ1xyXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXHJcbmltcG9ydCAqIGFzIHFzIGZyb20gJ3F1ZXJ5LXN0cmluZydcclxuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXHJcblxyXG5pbXBvcnQgeyBDcmVkZW50aWFsUHJvdmlkZXIgfSBmcm9tICcuLi9DcmVkZW50aWFsUHJvdmlkZXIudHMnXHJcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXHJcbmltcG9ydCB0eXBlIHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXHJcbmltcG9ydCB7XHJcbiAgQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcclxuICBDb3B5U291cmNlT3B0aW9ucyxcclxuICBERUZBVUxUX1JFR0lPTixcclxuICBMRUdBTF9IT0xEX1NUQVRVUyxcclxuICBQUkVTSUdOX0VYUElSWV9EQVlTX01BWCxcclxuICBSRVRFTlRJT05fTU9ERVMsXHJcbiAgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLFxyXG59IGZyb20gJy4uL2hlbHBlcnMudHMnXHJcbmltcG9ydCB0eXBlIHsgUG9zdFBvbGljeVJlc3VsdCB9IGZyb20gJy4uL21pbmlvLnRzJ1xyXG5pbXBvcnQgeyBwb3N0UHJlc2lnblNpZ25hdHVyZVY0LCBwcmVzaWduU2lnbmF0dXJlVjQsIHNpZ25WNCB9IGZyb20gJy4uL3NpZ25pbmcudHMnXHJcbmltcG9ydCB7IGZzcCwgc3RyZWFtUHJvbWlzZSB9IGZyb20gJy4vYXN5bmMudHMnXHJcbmltcG9ydCB7IENvcHlDb25kaXRpb25zIH0gZnJvbSAnLi9jb3B5LWNvbmRpdGlvbnMudHMnXHJcbmltcG9ydCB7IEV4dGVuc2lvbnMgfSBmcm9tICcuL2V4dGVuc2lvbnMudHMnXHJcbmltcG9ydCB7XHJcbiAgY2FsY3VsYXRlRXZlblNwbGl0cyxcclxuICBleHRyYWN0TWV0YWRhdGEsXHJcbiAgZ2V0Q29udGVudExlbmd0aCxcclxuICBnZXRTY29wZSxcclxuICBnZXRTb3VyY2VWZXJzaW9uSWQsXHJcbiAgZ2V0VmVyc2lvbklkLFxyXG4gIGhhc2hCaW5hcnksXHJcbiAgaW5zZXJ0Q29udGVudFR5cGUsXHJcbiAgaXNBbWF6b25FbmRwb2ludCxcclxuICBpc0Jvb2xlYW4sXHJcbiAgaXNEZWZpbmVkLFxyXG4gIGlzRW1wdHksXHJcbiAgaXNOdW1iZXIsXHJcbiAgaXNPYmplY3QsXHJcbiAgaXNQbGFpbk9iamVjdCxcclxuICBpc1JlYWRhYmxlU3RyZWFtLFxyXG4gIGlzU3RyaW5nLFxyXG4gIGlzVmFsaWRCdWNrZXROYW1lLFxyXG4gIGlzVmFsaWRFbmRwb2ludCxcclxuICBpc1ZhbGlkT2JqZWN0TmFtZSxcclxuICBpc1ZhbGlkUG9ydCxcclxuICBpc1ZhbGlkUHJlZml4LFxyXG4gIGlzVmlydHVhbEhvc3RTdHlsZSxcclxuICBtYWtlRGF0ZUxvbmcsXHJcbiAgUEFSVF9DT05TVFJBSU5UUyxcclxuICBwYXJ0c1JlcXVpcmVkLFxyXG4gIHByZXBlbmRYQU1aTWV0YSxcclxuICByZWFkYWJsZVN0cmVhbSxcclxuICBzYW5pdGl6ZUVUYWcsXHJcbiAgdG9NZDUsXHJcbiAgdG9TaGEyNTYsXHJcbiAgdXJpRXNjYXBlLFxyXG4gIHVyaVJlc291cmNlRXNjYXBlLFxyXG59IGZyb20gJy4vaGVscGVyLnRzJ1xyXG5pbXBvcnQgeyBqb2luSG9zdFBvcnQgfSBmcm9tICcuL2pvaW4taG9zdC1wb3J0LnRzJ1xyXG5pbXBvcnQgeyBQb3N0UG9saWN5IH0gZnJvbSAnLi9wb3N0LXBvbGljeS50cydcclxuaW1wb3J0IHsgcmVxdWVzdFdpdGhSZXRyeSB9IGZyb20gJy4vcmVxdWVzdC50cydcclxuaW1wb3J0IHsgZHJhaW5SZXNwb25zZSwgcmVhZEFzQnVmZmVyLCByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IFJlZ2lvbiB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xyXG5pbXBvcnQgeyBnZXRTM0VuZHBvaW50IH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXHJcbmltcG9ydCB0eXBlIHtcclxuICBCaW5hcnksXHJcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxyXG4gIEJ1Y2tldEl0ZW1TdGF0LFxyXG4gIEJ1Y2tldFN0cmVhbSxcclxuICBCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbixcclxuICBDb3B5T2JqZWN0UGFyYW1zLFxyXG4gIENvcHlPYmplY3RSZXN1bHQsXHJcbiAgQ29weU9iamVjdFJlc3VsdFYyLFxyXG4gIEVuY3J5cHRpb25Db25maWcsXHJcbiAgR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcclxuICBHZXRPYmplY3RPcHRzLFxyXG4gIEdldE9iamVjdFJldGVudGlvbk9wdHMsXHJcbiAgSW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbSxcclxuICBJUmVxdWVzdCxcclxuICBJdGVtQnVja2V0TWV0YWRhdGEsXHJcbiAgTGlmZWN5Y2xlQ29uZmlnLFxyXG4gIExpZmVDeWNsZUNvbmZpZ1BhcmFtLFxyXG4gIExpc3RPYmplY3RRdWVyeU9wdHMsXHJcbiAgTGlzdE9iamVjdFF1ZXJ5UmVzLFxyXG4gIE9iamVjdEluZm8sXHJcbiAgT2JqZWN0TG9ja0NvbmZpZ1BhcmFtLFxyXG4gIE9iamVjdExvY2tJbmZvLFxyXG4gIE9iamVjdE1ldGFEYXRhLFxyXG4gIE9iamVjdFJldGVudGlvbkluZm8sXHJcbiAgUHJlU2lnblJlcXVlc3RQYXJhbXMsXHJcbiAgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcclxuICBQdXRUYWdnaW5nUGFyYW1zLFxyXG4gIFJlbW92ZU9iamVjdHNQYXJhbSxcclxuICBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5LFxyXG4gIFJlbW92ZU9iamVjdHNSZXNwb25zZSxcclxuICBSZW1vdmVUYWdnaW5nUGFyYW1zLFxyXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxyXG4gIFJlcGxpY2F0aW9uQ29uZmlnT3B0cyxcclxuICBSZXF1ZXN0SGVhZGVycyxcclxuICBSZXNwb25zZUhlYWRlcixcclxuICBSZXN1bHRDYWxsYmFjayxcclxuICBSZXRlbnRpb24sXHJcbiAgU2VsZWN0T3B0aW9ucyxcclxuICBTdGF0T2JqZWN0T3B0cyxcclxuICBUYWcsXHJcbiAgVGFnZ2luZ09wdHMsXHJcbiAgVGFncyxcclxuICBUcmFuc3BvcnQsXHJcbiAgVXBsb2FkZWRPYmplY3RJbmZvLFxyXG4gIFVwbG9hZFBhcnRDb25maWcsXHJcbn0gZnJvbSAnLi90eXBlLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IExpc3RNdWx0aXBhcnRSZXN1bHQsIFVwbG9hZGVkUGFydCB9IGZyb20gJy4veG1sLXBhcnNlci50cydcclxuaW1wb3J0IHtcclxuICBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0LFxyXG4gIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQsXHJcbiAgcGFyc2VMaXN0T2JqZWN0cyxcclxuICBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyxcclxuICBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSxcclxuICB1cGxvYWRQYXJ0UGFyc2VyLFxyXG59IGZyb20gJy4veG1sLXBhcnNlci50cydcclxuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXIudHMnXHJcblxyXG5jb25zdCB4bWwgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcclxuXHJcbi8vIHdpbGwgYmUgcmVwbGFjZWQgYnkgYnVuZGxlci5cclxuY29uc3QgUGFja2FnZSA9IHsgdmVyc2lvbjogcHJvY2Vzcy5lbnYuTUlOSU9fSlNfUEFDS0FHRV9WRVJTSU9OIHx8ICdkZXZlbG9wbWVudCcgfVxyXG5cclxuY29uc3QgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMgPSBbXHJcbiAgJ2FnZW50JyxcclxuICAnY2EnLFxyXG4gICdjZXJ0JyxcclxuICAnY2lwaGVycycsXHJcbiAgJ2NsaWVudENlcnRFbmdpbmUnLFxyXG4gICdjcmwnLFxyXG4gICdkaHBhcmFtJyxcclxuICAnZWNkaEN1cnZlJyxcclxuICAnZmFtaWx5JyxcclxuICAnaG9ub3JDaXBoZXJPcmRlcicsXHJcbiAgJ2tleScsXHJcbiAgJ3Bhc3NwaHJhc2UnLFxyXG4gICdwZngnLFxyXG4gICdyZWplY3RVbmF1dGhvcml6ZWQnLFxyXG4gICdzZWN1cmVPcHRpb25zJyxcclxuICAnc2VjdXJlUHJvdG9jb2wnLFxyXG4gICdzZXJ2ZXJuYW1lJyxcclxuICAnc2Vzc2lvbklkQ29udGV4dCcsXHJcbl0gYXMgY29uc3RcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50T3B0aW9ucyB7XHJcbiAgZW5kUG9pbnQ6IHN0cmluZ1xyXG4gIGFjY2Vzc0tleT86IHN0cmluZ1xyXG4gIHNlY3JldEtleT86IHN0cmluZ1xyXG4gIHVzZVNTTD86IGJvb2xlYW5cclxuICBwb3J0PzogbnVtYmVyXHJcbiAgcmVnaW9uPzogUmVnaW9uXHJcbiAgdHJhbnNwb3J0PzogVHJhbnNwb3J0XHJcbiAgc2Vzc2lvblRva2VuPzogc3RyaW5nXHJcbiAgcGFydFNpemU/OiBudW1iZXJcclxuICBwYXRoU3R5bGU/OiBib29sZWFuXHJcbiAgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxyXG4gIHMzQWNjZWxlcmF0ZUVuZHBvaW50Pzogc3RyaW5nXHJcbiAgdHJhbnNwb3J0QWdlbnQ/OiBodHRwLkFnZW50XHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIFJlcXVlc3RPcHRpb24gPSBQYXJ0aWFsPElSZXF1ZXN0PiAmIHtcclxuICBtZXRob2Q6IHN0cmluZ1xyXG4gIGJ1Y2tldE5hbWU/OiBzdHJpbmdcclxuICBvYmplY3ROYW1lPzogc3RyaW5nXHJcbiAgcXVlcnk/OiBzdHJpbmdcclxuICBwYXRoU3R5bGU/OiBib29sZWFuXHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIE5vUmVzdWx0Q2FsbGJhY2sgPSAoZXJyb3I6IHVua25vd24pID0+IHZvaWRcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgTWFrZUJ1Y2tldE9wdCB7XHJcbiAgT2JqZWN0TG9ja2luZz86IGJvb2xlYW5cclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBSZW1vdmVPcHRpb25zIHtcclxuICB2ZXJzaW9uSWQ/OiBzdHJpbmdcclxuICBnb3Zlcm5hbmNlQnlwYXNzPzogYm9vbGVhblxyXG4gIGZvcmNlRGVsZXRlPzogYm9vbGVhblxyXG59XHJcblxyXG50eXBlIFBhcnQgPSB7XHJcbiAgcGFydDogbnVtYmVyXHJcbiAgZXRhZzogc3RyaW5nXHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBUeXBlZENsaWVudCB7XHJcbiAgcHJvdGVjdGVkIHRyYW5zcG9ydDogVHJhbnNwb3J0XHJcbiAgcHJvdGVjdGVkIGhvc3Q6IHN0cmluZ1xyXG4gIHByb3RlY3RlZCBwb3J0OiBudW1iZXJcclxuICBwcm90ZWN0ZWQgcHJvdG9jb2w6IHN0cmluZ1xyXG4gIHByb3RlY3RlZCBhY2Nlc3NLZXk6IHN0cmluZ1xyXG4gIHByb3RlY3RlZCBzZWNyZXRLZXk6IHN0cmluZ1xyXG4gIHByb3RlY3RlZCBzZXNzaW9uVG9rZW4/OiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgdXNlckFnZW50OiBzdHJpbmdcclxuICBwcm90ZWN0ZWQgYW5vbnltb3VzOiBib29sZWFuXHJcbiAgcHJvdGVjdGVkIHBhdGhTdHlsZTogYm9vbGVhblxyXG4gIHByb3RlY3RlZCByZWdpb25NYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuICBwdWJsaWMgcmVnaW9uPzogc3RyaW5nXHJcbiAgcHJvdGVjdGVkIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcclxuICBwYXJ0U2l6ZTogbnVtYmVyID0gNjQgKiAxMDI0ICogMTAyNFxyXG4gIHByb3RlY3RlZCBvdmVyUmlkZVBhcnRTaXplPzogYm9vbGVhblxyXG5cclxuICBwcm90ZWN0ZWQgbWF4aW11bVBhcnRTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNFxyXG4gIHByb3RlY3RlZCBtYXhPYmplY3RTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjRcclxuICBwdWJsaWMgZW5hYmxlU0hBMjU2OiBib29sZWFuXHJcbiAgcHJvdGVjdGVkIHMzQWNjZWxlcmF0ZUVuZHBvaW50Pzogc3RyaW5nXHJcbiAgcHJvdGVjdGVkIHJlcU9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XHJcblxyXG4gIHByb3RlY3RlZCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxyXG4gIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50RXh0ZW5zaW9uczogRXh0ZW5zaW9uc1xyXG5cclxuICBjb25zdHJ1Y3RvcihwYXJhbXM6IENsaWVudE9wdGlvbnMpIHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZGVwcmVjYXRlZCBwcm9wZXJ0eVxyXG4gICAgaWYgKHBhcmFtcy5zZWN1cmUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1wic2VjdXJlXCIgb3B0aW9uIGRlcHJlY2F0ZWQsIFwidXNlU1NMXCIgc2hvdWxkIGJlIHVzZWQgaW5zdGVhZCcpXHJcbiAgICB9XHJcbiAgICAvLyBEZWZhdWx0IHZhbHVlcyBpZiBub3Qgc3BlY2lmaWVkLlxyXG4gICAgaWYgKHBhcmFtcy51c2VTU0wgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBwYXJhbXMudXNlU1NMID0gdHJ1ZVxyXG4gICAgfVxyXG4gICAgaWYgKCFwYXJhbXMucG9ydCkge1xyXG4gICAgICBwYXJhbXMucG9ydCA9IDBcclxuICAgIH1cclxuICAgIC8vIFZhbGlkYXRlIGlucHV0IHBhcmFtcy5cclxuICAgIGlmICghaXNWYWxpZEVuZHBvaW50KHBhcmFtcy5lbmRQb2ludCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkRW5kcG9pbnRFcnJvcihgSW52YWxpZCBlbmRQb2ludCA6ICR7cGFyYW1zLmVuZFBvaW50fWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRQb3J0KHBhcmFtcy5wb3J0KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHBvcnQgOiAke3BhcmFtcy5wb3J0fWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzQm9vbGVhbihwYXJhbXMudXNlU1NMKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxyXG4gICAgICAgIGBJbnZhbGlkIHVzZVNTTCBmbGFnIHR5cGUgOiAke3BhcmFtcy51c2VTU0x9LCBleHBlY3RlZCB0byBiZSBvZiB0eXBlIFwiYm9vbGVhblwiYCxcclxuICAgICAgKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIHJlZ2lvbiBvbmx5IGlmIGl0cyBzZXQuXHJcbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xyXG4gICAgICBpZiAoIWlzU3RyaW5nKHBhcmFtcy5yZWdpb24pKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCByZWdpb24gOiAke3BhcmFtcy5yZWdpb259YClcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGhvc3QgPSBwYXJhbXMuZW5kUG9pbnQudG9Mb3dlckNhc2UoKVxyXG4gICAgbGV0IHBvcnQgPSBwYXJhbXMucG9ydFxyXG4gICAgbGV0IHByb3RvY29sOiBzdHJpbmdcclxuICAgIGxldCB0cmFuc3BvcnRcclxuICAgIGxldCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxyXG4gICAgLy8gVmFsaWRhdGUgaWYgY29uZmlndXJhdGlvbiBpcyBub3QgdXNpbmcgU1NMXHJcbiAgICAvLyBmb3IgY29uc3RydWN0aW5nIHJlbGV2YW50IGVuZHBvaW50cy5cclxuICAgIGlmIChwYXJhbXMudXNlU1NMKSB7XHJcbiAgICAgIC8vIERlZmF1bHRzIHRvIHNlY3VyZS5cclxuICAgICAgdHJhbnNwb3J0ID0gaHR0cHNcclxuICAgICAgcHJvdG9jb2wgPSAnaHR0cHM6J1xyXG4gICAgICBwb3J0ID0gcG9ydCB8fCA0NDNcclxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwcy5nbG9iYWxBZ2VudFxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdHJhbnNwb3J0ID0gaHR0cFxyXG4gICAgICBwcm90b2NvbCA9ICdodHRwOidcclxuICAgICAgcG9ydCA9IHBvcnQgfHwgODBcclxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwLmdsb2JhbEFnZW50XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBpcyBzZXQsIHVzZSBpdC5cclxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0KSB7XHJcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxyXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0IHR5cGUgOiAke3BhcmFtcy50cmFuc3BvcnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxyXG4gICAgICAgIClcclxuICAgICAgfVxyXG4gICAgICB0cmFuc3BvcnQgPSBwYXJhbXMudHJhbnNwb3J0XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBhZ2VudCBpcyBzZXQsIHVzZSBpdC5cclxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0QWdlbnQpIHtcclxuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0QWdlbnQpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydEFnZW50IHR5cGU6ICR7cGFyYW1zLnRyYW5zcG9ydEFnZW50fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcclxuICAgICAgICApXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gcGFyYW1zLnRyYW5zcG9ydEFnZW50XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlciBBZ2VudCBzaG91bGQgYWx3YXlzIGZvbGxvd2luZyB0aGUgYmVsb3cgc3R5bGUuXHJcbiAgICAvLyBQbGVhc2Ugb3BlbiBhbiBpc3N1ZSB0byBkaXNjdXNzIGFueSBuZXcgY2hhbmdlcyBoZXJlLlxyXG4gICAgLy9cclxuICAgIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXHJcbiAgICAvL1xyXG4gICAgY29uc3QgbGlicmFyeUNvbW1lbnRzID0gYCgke3Byb2Nlc3MucGxhdGZvcm19OyAke3Byb2Nlc3MuYXJjaH0pYFxyXG4gICAgY29uc3QgbGlicmFyeUFnZW50ID0gYE1pbklPICR7bGlicmFyeUNvbW1lbnRzfSBtaW5pby1qcy8ke1BhY2thZ2UudmVyc2lvbn1gXHJcbiAgICAvLyBVc2VyIGFnZW50IGJsb2NrIGVuZHMuXHJcblxyXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnRcclxuICAgIHRoaXMudHJhbnNwb3J0QWdlbnQgPSB0cmFuc3BvcnRBZ2VudFxyXG4gICAgdGhpcy5ob3N0ID0gaG9zdFxyXG4gICAgdGhpcy5wb3J0ID0gcG9ydFxyXG4gICAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sXHJcbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke2xpYnJhcnlBZ2VudH1gXHJcblxyXG4gICAgLy8gRGVmYXVsdCBwYXRoIHN0eWxlIGlzIHRydWVcclxuICAgIGlmIChwYXJhbXMucGF0aFN0eWxlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgdGhpcy5wYXRoU3R5bGUgPSB0cnVlXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHBhcmFtcy5wYXRoU3R5bGVcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmFjY2Vzc0tleSA9IHBhcmFtcy5hY2Nlc3NLZXkgPz8gJydcclxuICAgIHRoaXMuc2VjcmV0S2V5ID0gcGFyYW1zLnNlY3JldEtleSA/PyAnJ1xyXG4gICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBwYXJhbXMuc2Vzc2lvblRva2VuXHJcbiAgICB0aGlzLmFub255bW91cyA9ICF0aGlzLmFjY2Vzc0tleSB8fCAhdGhpcy5zZWNyZXRLZXlcclxuXHJcbiAgICBpZiAocGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcclxuICAgICAgdGhpcy5hbm9ueW1vdXMgPSBmYWxzZVxyXG4gICAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlclxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucmVnaW9uTWFwID0ge31cclxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XHJcbiAgICAgIHRoaXMucmVnaW9uID0gcGFyYW1zLnJlZ2lvblxyXG4gICAgfVxyXG5cclxuICAgIGlmIChwYXJhbXMucGFydFNpemUpIHtcclxuICAgICAgdGhpcy5wYXJ0U2l6ZSA9IHBhcmFtcy5wYXJ0U2l6ZVxyXG4gICAgICB0aGlzLm92ZXJSaWRlUGFydFNpemUgPSB0cnVlXHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA8IDUgKiAxMDI0ICogMTAyNCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGdyZWF0ZXIgdGhhbiA1TUJgKVxyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMucGFydFNpemUgPiA1ICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgbGVzcyB0aGFuIDVHQmApXHJcbiAgICB9XHJcblxyXG4gICAgLy8gU0hBMjU2IGlzIGVuYWJsZWQgb25seSBmb3IgYXV0aGVudGljYXRlZCBodHRwIHJlcXVlc3RzLiBJZiB0aGUgcmVxdWVzdCBpcyBhdXRoZW50aWNhdGVkXHJcbiAgICAvLyBhbmQgdGhlIGNvbm5lY3Rpb24gaXMgaHR0cHMgd2UgdXNlIHgtYW16LWNvbnRlbnQtc2hhMjU2PVVOU0lHTkVELVBBWUxPQURcclxuICAgIC8vIGhlYWRlciBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxyXG4gICAgdGhpcy5lbmFibGVTSEEyNTYgPSAhdGhpcy5hbm9ueW1vdXMgJiYgIXBhcmFtcy51c2VTU0xcclxuXHJcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gcGFyYW1zLnMzQWNjZWxlcmF0ZUVuZHBvaW50IHx8IHVuZGVmaW5lZFxyXG4gICAgdGhpcy5yZXFPcHRpb25zID0ge31cclxuICAgIHRoaXMuY2xpZW50RXh0ZW5zaW9ucyA9IG5ldyBFeHRlbnNpb25zKHRoaXMpXHJcbiAgfVxyXG4gIC8qKlxyXG4gICAqIE1pbmlvIGV4dGVuc2lvbnMgdGhhdCBhcmVuJ3QgbmVjZXNzYXJ5IHByZXNlbnQgZm9yIEFtYXpvbiBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmVyc1xyXG4gICAqL1xyXG4gIGdldCBleHRlbnNpb25zKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuY2xpZW50RXh0ZW5zaW9uc1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQHBhcmFtIGVuZFBvaW50IC0gdmFsaWQgUzMgYWNjZWxlcmF0aW9uIGVuZCBwb2ludFxyXG4gICAqL1xyXG4gIHNldFMzVHJhbnNmZXJBY2NlbGVyYXRlKGVuZFBvaW50OiBzdHJpbmcpIHtcclxuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBlbmRQb2ludFxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB0aGUgc3VwcG9ydGVkIHJlcXVlc3Qgb3B0aW9ucy5cclxuICAgKi9cclxuICBwdWJsaWMgc2V0UmVxdWVzdE9wdGlvbnMob3B0aW9uczogUGljazxodHRwcy5SZXF1ZXN0T3B0aW9ucywgKHR5cGVvZiByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylbbnVtYmVyXT4pIHtcclxuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdCBvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgdGhpcy5yZXFPcHRpb25zID0gXy5waWNrKG9wdGlvbnMsIHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogIFRoaXMgaXMgczMgU3BlY2lmaWMgYW5kIGRvZXMgbm90IGhvbGQgdmFsaWRpdHkgaW4gYW55IG90aGVyIE9iamVjdCBzdG9yYWdlLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZT86IHN0cmluZywgb2JqZWN0TmFtZT86IHN0cmluZykge1xyXG4gICAgaWYgKCFpc0VtcHR5KHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQpICYmICFpc0VtcHR5KGJ1Y2tldE5hbWUpICYmICFpc0VtcHR5KG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcclxuICAgICAgLy8gRGlzYWJsZSB0cmFuc2ZlciBhY2NlbGVyYXRpb24gZm9yIG5vbi1jb21wbGlhbnQgYnVja2V0IG5hbWVzLlxyXG4gICAgICBpZiAoYnVja2V0TmFtZS5pbmNsdWRlcygnLicpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2ZlciBBY2NlbGVyYXRpb24gaXMgbm90IHN1cHBvcnRlZCBmb3Igbm9uIGNvbXBsaWFudCBidWNrZXQ6JHtidWNrZXROYW1lfWApXHJcbiAgICAgIH1cclxuICAgICAgLy8gSWYgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGlzIHJlcXVlc3RlZCBzZXQgbmV3IGhvc3QuXHJcbiAgICAgIC8vIEZvciBtb3JlIGRldGFpbHMgYWJvdXQgZW5hYmxpbmcgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIHJlYWQgaGVyZS5cclxuICAgICAgLy8gaHR0cDovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uUzMvbGF0ZXN0L2Rldi90cmFuc2Zlci1hY2NlbGVyYXRpb24uaHRtbFxyXG4gICAgICByZXR1cm4gdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludFxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiAgIFNldCBhcHBsaWNhdGlvbiBzcGVjaWZpYyBpbmZvcm1hdGlvbi5cclxuICAgKiAgIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXHJcbiAgICogICBNaW5JTyAoT1M7IEFSQ0gpIExJQi9WRVIgQVBQL1ZFUlxyXG4gICAqL1xyXG4gIHNldEFwcEluZm8oYXBwTmFtZTogc3RyaW5nLCBhcHBWZXJzaW9uOiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNTdHJpbmcoYXBwTmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBOYW1lOiAke2FwcE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmIChhcHBOYW1lLnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwTmFtZSBjYW5ub3QgYmUgZW1wdHkuJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcoYXBwVmVyc2lvbikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBWZXJzaW9uOiAke2FwcFZlcnNpb259YClcclxuICAgIH1cclxuICAgIGlmIChhcHBWZXJzaW9uLnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwVmVyc2lvbiBjYW5ub3QgYmUgZW1wdHkuJylcclxuICAgIH1cclxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7dGhpcy51c2VyQWdlbnR9ICR7YXBwTmFtZX0vJHthcHBWZXJzaW9ufWBcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIHJldHVybnMgb3B0aW9ucyBvYmplY3QgdGhhdCBjYW4gYmUgdXNlZCB3aXRoIGh0dHAucmVxdWVzdCgpXHJcbiAgICogVGFrZXMgY2FyZSBvZiBjb25zdHJ1Y3RpbmcgdmlydHVhbC1ob3N0LXN0eWxlIG9yIHBhdGgtc3R5bGUgaG9zdG5hbWVcclxuICAgKi9cclxuICBwcm90ZWN0ZWQgZ2V0UmVxdWVzdE9wdGlvbnMoXHJcbiAgICBvcHRzOiBSZXF1ZXN0T3B0aW9uICYge1xyXG4gICAgICByZWdpb246IHN0cmluZ1xyXG4gICAgfSxcclxuICApOiBJUmVxdWVzdCAmIHtcclxuICAgIGhvc3Q6IHN0cmluZ1xyXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4gIH0ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gb3B0cy5tZXRob2RcclxuICAgIGNvbnN0IHJlZ2lvbiA9IG9wdHMucmVnaW9uXHJcbiAgICBjb25zdCBidWNrZXROYW1lID0gb3B0cy5idWNrZXROYW1lXHJcbiAgICBsZXQgb2JqZWN0TmFtZSA9IG9wdHMub2JqZWN0TmFtZVxyXG4gICAgY29uc3QgaGVhZGVycyA9IG9wdHMuaGVhZGVyc1xyXG4gICAgY29uc3QgcXVlcnkgPSBvcHRzLnF1ZXJ5XHJcblxyXG4gICAgbGV0IHJlcU9wdGlvbnMgPSB7XHJcbiAgICAgIG1ldGhvZCxcclxuICAgICAgaGVhZGVyczoge30gYXMgUmVxdWVzdEhlYWRlcnMsXHJcbiAgICAgIHByb3RvY29sOiB0aGlzLnByb3RvY29sLFxyXG4gICAgICAvLyBJZiBjdXN0b20gdHJhbnNwb3J0QWdlbnQgd2FzIHN1cHBsaWVkIGVhcmxpZXIsIHdlJ2xsIGluamVjdCBpdCBoZXJlXHJcbiAgICAgIGFnZW50OiB0aGlzLnRyYW5zcG9ydEFnZW50LFxyXG4gICAgfVxyXG5cclxuICAgIC8vIFZlcmlmeSBpZiB2aXJ0dWFsIGhvc3Qgc3VwcG9ydGVkLlxyXG4gICAgbGV0IHZpcnR1YWxIb3N0U3R5bGVcclxuICAgIGlmIChidWNrZXROYW1lKSB7XHJcbiAgICAgIHZpcnR1YWxIb3N0U3R5bGUgPSBpc1ZpcnR1YWxIb3N0U3R5bGUodGhpcy5ob3N0LCB0aGlzLnByb3RvY29sLCBidWNrZXROYW1lLCB0aGlzLnBhdGhTdHlsZSlcclxuICAgIH1cclxuXHJcbiAgICBsZXQgcGF0aCA9ICcvJ1xyXG4gICAgbGV0IGhvc3QgPSB0aGlzLmhvc3RcclxuXHJcbiAgICBsZXQgcG9ydDogdW5kZWZpbmVkIHwgbnVtYmVyXHJcbiAgICBpZiAodGhpcy5wb3J0KSB7XHJcbiAgICAgIHBvcnQgPSB0aGlzLnBvcnRcclxuICAgIH1cclxuXHJcbiAgICBpZiAob2JqZWN0TmFtZSkge1xyXG4gICAgICBvYmplY3ROYW1lID0gdXJpUmVzb3VyY2VFc2NhcGUob2JqZWN0TmFtZSlcclxuICAgIH1cclxuXHJcbiAgICAvLyBGb3IgQW1hem9uIFMzIGVuZHBvaW50LCBnZXQgZW5kcG9pbnQgYmFzZWQgb24gcmVnaW9uLlxyXG4gICAgaWYgKGlzQW1hem9uRW5kcG9pbnQoaG9zdCkpIHtcclxuICAgICAgY29uc3QgYWNjZWxlcmF0ZUVuZFBvaW50ID0gdGhpcy5nZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxyXG4gICAgICBpZiAoYWNjZWxlcmF0ZUVuZFBvaW50KSB7XHJcbiAgICAgICAgaG9zdCA9IGAke2FjY2VsZXJhdGVFbmRQb2ludH1gXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaG9zdCA9IGdldFMzRW5kcG9pbnQocmVnaW9uKVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHZpcnR1YWxIb3N0U3R5bGUgJiYgIW9wdHMucGF0aFN0eWxlKSB7XHJcbiAgICAgIC8vIEZvciBhbGwgaG9zdHMgd2hpY2ggc3VwcG9ydCB2aXJ0dWFsIGhvc3Qgc3R5bGUsIGBidWNrZXROYW1lYFxyXG4gICAgICAvLyBpcyBwYXJ0IG9mIHRoZSBob3N0bmFtZSBpbiB0aGUgZm9sbG93aW5nIGZvcm1hdDpcclxuICAgICAgLy9cclxuICAgICAgLy8gIHZhciBob3N0ID0gJ2J1Y2tldE5hbWUuZXhhbXBsZS5jb20nXHJcbiAgICAgIC8vXHJcbiAgICAgIGlmIChidWNrZXROYW1lKSB7XHJcbiAgICAgICAgaG9zdCA9IGAke2J1Y2tldE5hbWV9LiR7aG9zdH1gXHJcbiAgICAgIH1cclxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcclxuICAgICAgICBwYXRoID0gYC8ke29iamVjdE5hbWV9YFxyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBGb3IgYWxsIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2aWNlcyB3ZSB3aWxsIGZhbGxiYWNrIHRvXHJcbiAgICAgIC8vIHBhdGggc3R5bGUgcmVxdWVzdHMsIHdoZXJlIGBidWNrZXROYW1lYCBpcyBwYXJ0IG9mIHRoZSBVUklcclxuICAgICAgLy8gcGF0aC5cclxuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcclxuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9YFxyXG4gICAgICB9XHJcbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XHJcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfS8ke29iamVjdE5hbWV9YFxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHF1ZXJ5KSB7XHJcbiAgICAgIHBhdGggKz0gYD8ke3F1ZXJ5fWBcclxuICAgIH1cclxuICAgIHJlcU9wdGlvbnMuaGVhZGVycy5ob3N0ID0gaG9zdFxyXG4gICAgaWYgKChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cDonICYmIHBvcnQgIT09IDgwKSB8fCAocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHBzOicgJiYgcG9ydCAhPT0gNDQzKSkge1xyXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGpvaW5Ib3N0UG9ydChob3N0LCBwb3J0KVxyXG4gICAgfVxyXG5cclxuICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sndXNlci1hZ2VudCddID0gdGhpcy51c2VyQWdlbnRcclxuICAgIGlmIChoZWFkZXJzKSB7XHJcbiAgICAgIC8vIGhhdmUgYWxsIGhlYWRlciBrZXlzIGluIGxvd2VyIGNhc2UgLSB0byBtYWtlIHNpZ25pbmcgZWFzeVxyXG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xyXG4gICAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1trLnRvTG93ZXJDYXNlKCldID0gdlxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlIGFueSByZXF1ZXN0IG9wdGlvbiBzcGVjaWZpZWQgaW4gbWluaW9DbGllbnQuc2V0UmVxdWVzdE9wdGlvbnMoKVxyXG4gICAgcmVxT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMucmVxT3B0aW9ucywgcmVxT3B0aW9ucylcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAuLi5yZXFPcHRpb25zLFxyXG4gICAgICBoZWFkZXJzOiBfLm1hcFZhbHVlcyhfLnBpY2tCeShyZXFPcHRpb25zLmhlYWRlcnMsIGlzRGVmaW5lZCksICh2KSA9PiB2LnRvU3RyaW5nKCkpLFxyXG4gICAgICBob3N0LFxyXG4gICAgICBwb3J0LFxyXG4gICAgICBwYXRoLFxyXG4gICAgfSBzYXRpc2ZpZXMgaHR0cHMuUmVxdWVzdE9wdGlvbnNcclxuICB9XHJcblxyXG4gIHB1YmxpYyBhc3luYyBzZXRDcmVkZW50aWFsc1Byb3ZpZGVyKGNyZWRlbnRpYWxzUHJvdmlkZXI6IENyZWRlbnRpYWxQcm92aWRlcikge1xyXG4gICAgaWYgKCEoY3JlZGVudGlhbHNQcm92aWRlciBpbnN0YW5jZW9mIENyZWRlbnRpYWxQcm92aWRlcikpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzLiBFeHBlY3RlZCBpbnN0YW5jZSBvZiBDcmVkZW50aWFsUHJvdmlkZXInKVxyXG4gICAgfVxyXG4gICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gY3JlZGVudGlhbHNQcm92aWRlclxyXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNoZWNrQW5kUmVmcmVzaENyZWRzKCkge1xyXG4gICAgaWYgKHRoaXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGNyZWRlbnRpYWxzQ29uZiA9IGF3YWl0IHRoaXMuY3JlZGVudGlhbHNQcm92aWRlci5nZXRDcmVkZW50aWFscygpXHJcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0QWNjZXNzS2V5KClcclxuICAgICAgICB0aGlzLnNlY3JldEtleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZWNyZXRLZXkoKVxyXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuID0gY3JlZGVudGlhbHNDb25mLmdldFNlc3Npb25Ub2tlbigpXHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgY3JlZGVudGlhbHM6ICR7ZX1gLCB7IGNhdXNlOiBlIH0pXHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgbG9nU3RyZWFtPzogc3RyZWFtLldyaXRhYmxlXHJcblxyXG4gIC8qKlxyXG4gICAqIGxvZyB0aGUgcmVxdWVzdCwgcmVzcG9uc2UsIGVycm9yXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBsb2dIVFRQKHJlcU9wdGlvbnM6IElSZXF1ZXN0LCByZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UgfCBudWxsLCBlcnI/OiB1bmtub3duKSB7XHJcbiAgICAvLyBpZiBubyBsb2dTdHJlYW0gYXZhaWxhYmxlIHJldHVybi5cclxuICAgIGlmICghdGhpcy5sb2dTdHJlYW0pIHtcclxuICAgICAgcmV0dXJuXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzT2JqZWN0KHJlcU9wdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcU9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAocmVzcG9uc2UgJiYgIWlzUmVhZGFibGVTdHJlYW0ocmVzcG9uc2UpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Jlc3BvbnNlIHNob3VsZCBiZSBvZiB0eXBlIFwiU3RyZWFtXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKGVyciAmJiAhKGVyciBpbnN0YW5jZW9mIEVycm9yKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdlcnIgc2hvdWxkIGJlIG9mIHR5cGUgXCJFcnJvclwiJylcclxuICAgIH1cclxuICAgIGNvbnN0IGxvZ1N0cmVhbSA9IHRoaXMubG9nU3RyZWFtXHJcbiAgICBjb25zdCBsb2dIZWFkZXJzID0gKGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKSA9PiB7XHJcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xyXG4gICAgICAgIGlmIChrID09ICdhdXRob3JpemF0aW9uJykge1xyXG4gICAgICAgICAgaWYgKGlzU3RyaW5nKHYpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlZGFjdG9yID0gbmV3IFJlZ0V4cCgnU2lnbmF0dXJlPShbMC05YS1mXSspJylcclxuICAgICAgICAgICAgdiA9IHYucmVwbGFjZShyZWRhY3RvciwgJ1NpZ25hdHVyZT0qKlJFREFDVEVEKionKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7a306ICR7dn1cXG5gKVxyXG4gICAgICB9KVxyXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ1xcbicpXHJcbiAgICB9XHJcbiAgICBsb2dTdHJlYW0ud3JpdGUoYFJFUVVFU1Q6ICR7cmVxT3B0aW9ucy5tZXRob2R9ICR7cmVxT3B0aW9ucy5wYXRofVxcbmApXHJcbiAgICBsb2dIZWFkZXJzKHJlcU9wdGlvbnMuaGVhZGVycylcclxuICAgIGlmIChyZXNwb25zZSkge1xyXG4gICAgICB0aGlzLmxvZ1N0cmVhbS53cml0ZShgUkVTUE9OU0U6ICR7cmVzcG9uc2Uuc3RhdHVzQ29kZX1cXG5gKVxyXG4gICAgICBsb2dIZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVxdWVzdEhlYWRlcnMpXHJcbiAgICB9XHJcbiAgICBpZiAoZXJyKSB7XHJcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnRVJST1IgQk9EWTpcXG4nKVxyXG4gICAgICBjb25zdCBlcnJKU09OID0gSlNPTi5zdHJpbmdpZnkoZXJyLCBudWxsLCAnXFx0JylcclxuICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2VyckpTT059XFxuYClcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEVuYWJsZSB0cmFjaW5nXHJcbiAgICovXHJcbiAgcHVibGljIHRyYWNlT24oc3RyZWFtPzogc3RyZWFtLldyaXRhYmxlKSB7XHJcbiAgICBpZiAoIXN0cmVhbSkge1xyXG4gICAgICBzdHJlYW0gPSBwcm9jZXNzLnN0ZG91dFxyXG4gICAgfVxyXG4gICAgdGhpcy5sb2dTdHJlYW0gPSBzdHJlYW1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIERpc2FibGUgdHJhY2luZ1xyXG4gICAqL1xyXG4gIHB1YmxpYyB0cmFjZU9mZigpIHtcclxuICAgIHRoaXMubG9nU3RyZWFtID0gdW5kZWZpbmVkXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cclxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxyXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcclxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxyXG4gICAqXHJcbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZCBnZXRCdWNrZXRSZWdpb24uXHJcbiAgICpcclxuICAgKiBAaW50ZXJuYWxcclxuICAgKi9cclxuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jKFxyXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcclxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxyXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcclxuICAgIHJlZ2lvbiA9ICcnLFxyXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcclxuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcocGF5bG9hZCkgJiYgIWlzT2JqZWN0KHBheWxvYWQpKSB7XHJcbiAgICAgIC8vIEJ1ZmZlciBpcyBvZiB0eXBlICdvYmplY3QnXHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BheWxvYWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIiBvciBcIkJ1ZmZlclwiJylcclxuICAgIH1cclxuICAgIGV4cGVjdGVkQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xyXG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgICAgfVxyXG4gICAgfSlcclxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xyXG4gICAgICBvcHRpb25zLmhlYWRlcnMgPSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKG9wdGlvbnMubWV0aG9kID09PSAnUE9TVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdQVVQnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnREVMRVRFJykge1xyXG4gICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gPSBwYXlsb2FkLmxlbmd0aC50b1N0cmluZygpXHJcbiAgICB9XHJcbiAgICBjb25zdCBzaGEyNTZzdW0gPSB0aGlzLmVuYWJsZVNIQTI1NiA/IHRvU2hhMjU2KHBheWxvYWQpIDogJydcclxuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc2hhMjU2c3VtLCBleHBlY3RlZENvZGVzLCByZWdpb24pXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBuZXcgcmVxdWVzdCB3aXRoIHByb21pc2VcclxuICAgKlxyXG4gICAqIE5vIG5lZWQgdG8gZHJhaW4gcmVzcG9uc2UsIHJlc3BvbnNlIGJvZHkgaXMgbm90IHZhbGlkXHJcbiAgICovXHJcbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luY09taXQoXHJcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxyXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXHJcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcclxuICAgIHJlZ2lvbiA9ICcnLFxyXG4gICk6IFByb21pc2U8T21pdDxodHRwLkluY29taW5nTWVzc2FnZSwgJ29uJz4+IHtcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxyXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXHJcbiAgICByZXR1cm4gcmVzXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXHJcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxyXG4gICAqXHJcbiAgICogQGludGVybmFsXHJcbiAgICovXHJcbiAgYXN5bmMgbWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhcclxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXHJcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUgfCBCaW5hcnksXHJcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcclxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcclxuICAgIHJlZ2lvbjogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcclxuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGlmICghKEJ1ZmZlci5pc0J1ZmZlcihib2R5KSB8fCB0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycgfHwgaXNSZWFkYWJsZVN0cmVhbShib2R5KSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICBgc3RyZWFtIHNob3VsZCBiZSBhIEJ1ZmZlciwgc3RyaW5nIG9yIHJlYWRhYmxlIFN0cmVhbSwgZ290ICR7dHlwZW9mIGJvZHl9IGluc3RlYWRgLFxyXG4gICAgICApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHNoYTI1NnN1bSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2hhMjU2c3VtIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgc3RhdHVzQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xyXG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgICAgfVxyXG4gICAgfSlcclxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICAvLyBzaGEyNTZzdW0gd2lsbCBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzXHJcbiAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2hhMjU2c3VtIGV4cGVjdGVkIHRvIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNgKVxyXG4gICAgfVxyXG4gICAgLy8gc2hhMjU2c3VtIHNob3VsZCBiZSB2YWxpZCBmb3Igbm9uLWFub255bW91cyBodHRwIHJlcXVlc3RzLlxyXG4gICAgaWYgKHRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDY0KSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgc2hhMjU2c3VtIDogJHtzaGEyNTZzdW19YClcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcclxuXHJcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxyXG4gICAgcmVnaW9uID0gcmVnaW9uIHx8IChhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKG9wdGlvbnMuYnVja2V0TmFtZSEpKVxyXG5cclxuICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgLi4ub3B0aW9ucywgcmVnaW9uIH0pXHJcbiAgICBpZiAoIXRoaXMuYW5vbnltb3VzKSB7XHJcbiAgICAgIC8vIEZvciBub24tYW5vbnltb3VzIGh0dHBzIHJlcXVlc3RzIHNoYTI1NnN1bSBpcyAnVU5TSUdORUQtUEFZTE9BRCcgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cclxuICAgICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xyXG4gICAgICAgIHNoYTI1NnN1bSA9ICdVTlNJR05FRC1QQVlMT0FEJ1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXHJcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotZGF0ZSddID0gbWFrZURhdGVMb25nKGRhdGUpXHJcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotY29udGVudC1zaGEyNTYnXSA9IHNoYTI1NnN1bVxyXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcclxuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxyXG4gICAgICB9XHJcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5hdXRob3JpemF0aW9uID0gc2lnblY0KHJlcU9wdGlvbnMsIHRoaXMuYWNjZXNzS2V5LCB0aGlzLnNlY3JldEtleSwgcmVnaW9uLCBkYXRlLCBzaGEyNTZzdW0pXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0V2l0aFJldHJ5KHRoaXMudHJhbnNwb3J0LCByZXFPcHRpb25zLCBib2R5KVxyXG4gICAgaWYgKCFyZXNwb25zZS5zdGF0dXNDb2RlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJVRzogcmVzcG9uc2UgZG9lc24ndCBoYXZlIGEgc3RhdHVzQ29kZVwiKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghc3RhdHVzQ29kZXMuaW5jbHVkZXMocmVzcG9uc2Uuc3RhdHVzQ29kZSkpIHtcclxuICAgICAgLy8gRm9yIGFuIGluY29ycmVjdCByZWdpb24sIFMzIHNlcnZlciBhbHdheXMgc2VuZHMgYmFjayA0MDAuXHJcbiAgICAgIC8vIEJ1dCB3ZSB3aWxsIGRvIGNhY2hlIGludmFsaWRhdGlvbiBmb3IgYWxsIGVycm9ycyBzbyB0aGF0LFxyXG4gICAgICAvLyBpbiBmdXR1cmUsIGlmIEFXUyBTMyBkZWNpZGVzIHRvIHNlbmQgYSBkaWZmZXJlbnQgc3RhdHVzIGNvZGUgb3JcclxuICAgICAgLy8gWE1MIGVycm9yIGNvZGUgd2Ugd2lsbCBzdGlsbCB3b3JrIGZpbmUuXHJcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXHJcbiAgICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtvcHRpb25zLmJ1Y2tldE5hbWUhXVxyXG5cclxuICAgICAgY29uc3QgZXJyID0gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZVJlc3BvbnNlRXJyb3IocmVzcG9uc2UpXHJcbiAgICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSwgZXJyKVxyXG4gICAgICB0aHJvdyBlcnJcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UpXHJcblxyXG4gICAgcmV0dXJuIHJlc3BvbnNlXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBnZXRzIHRoZSByZWdpb24gb2YgdGhlIGJ1Y2tldFxyXG4gICAqXHJcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcclxuICAgKlxyXG4gICAqIEBpbnRlcm5hbFxyXG4gICAqL1xyXG4gIHByb3RlY3RlZCBhc3luYyBnZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWUgOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWdpb24gaXMgc2V0IHdpdGggY29uc3RydWN0b3IsIHJldHVybiB0aGUgcmVnaW9uIHJpZ2h0IGhlcmUuXHJcbiAgICBpZiAodGhpcy5yZWdpb24pIHtcclxuICAgICAgcmV0dXJuIHRoaXMucmVnaW9uXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2FjaGVkID0gdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cclxuICAgIGlmIChjYWNoZWQpIHtcclxuICAgICAgcmV0dXJuIGNhY2hlZFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGV4dHJhY3RSZWdpb25Bc3luYyA9IGFzeW5jIChyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHtcclxuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcclxuICAgICAgY29uc3QgcmVnaW9uID0geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFJlZ2lvbihib2R5KSB8fCBERUZBVUxUX1JFR0lPTlxyXG4gICAgICB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXSA9IHJlZ2lvblxyXG4gICAgICByZXR1cm4gcmVnaW9uXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xvY2F0aW9uJ1xyXG4gICAgLy8gYGdldEJ1Y2tldExvY2F0aW9uYCBiZWhhdmVzIGRpZmZlcmVudGx5IGluIGZvbGxvd2luZyB3YXlzIGZvclxyXG4gICAgLy8gZGlmZmVyZW50IGVudmlyb25tZW50cy5cclxuICAgIC8vXHJcbiAgICAvLyAtIEZvciBub2RlanMgZW52IHdlIGRlZmF1bHQgdG8gcGF0aCBzdHlsZSByZXF1ZXN0cy5cclxuICAgIC8vIC0gRm9yIGJyb3dzZXIgZW52IHBhdGggc3R5bGUgcmVxdWVzdHMgb24gYnVja2V0cyB5aWVsZHMgQ09SU1xyXG4gICAgLy8gICBlcnJvci4gVG8gY2lyY3VtdmVudCB0aGlzIHByb2JsZW0gd2UgbWFrZSBhIHZpcnR1YWwgaG9zdFxyXG4gICAgLy8gICBzdHlsZSByZXF1ZXN0IHNpZ25lZCB3aXRoICd1cy1lYXN0LTEnLiBUaGlzIHJlcXVlc3QgZmFpbHNcclxuICAgIC8vICAgd2l0aCBhbiBlcnJvciAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcsIGFkZGl0aW9uYWxseVxyXG4gICAgLy8gICB0aGUgZXJyb3IgWE1MIGFsc28gcHJvdmlkZXMgUmVnaW9uIG9mIHRoZSBidWNrZXQuIFRvIHZhbGlkYXRlXHJcbiAgICAvLyAgIHRoaXMgcmVnaW9uIGlzIHByb3BlciB3ZSByZXRyeSB0aGUgc2FtZSByZXF1ZXN0IHdpdGggdGhlIG5ld2x5XHJcbiAgICAvLyAgIG9idGFpbmVkIHJlZ2lvbi5cclxuICAgIGNvbnN0IHBhdGhTdHlsZSA9IHRoaXMucGF0aFN0eWxlICYmICFpc0Jyb3dzZXJcclxuICAgIGxldCByZWdpb246IHN0cmluZ1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXHJcbiAgICAgIHJldHVybiBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAvLyBtYWtlIGFsaWdubWVudCB3aXRoIG1jIGNsaVxyXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIGVycm9ycy5TM0Vycm9yKSB7XHJcbiAgICAgICAgY29uc3QgZXJyQ29kZSA9IGUuY29kZVxyXG4gICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGUucmVnaW9uXHJcbiAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBY2Nlc3NEZW5pZWQnICYmICFlcnJSZWdpb24pIHtcclxuICAgICAgICAgIHJldHVybiBERUZBVUxUX1JFR0lPTlxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgaWYgKCEoZS5uYW1lID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcpKSB7XHJcbiAgICAgICAgdGhyb3cgZVxyXG4gICAgICB9XHJcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugc2V0IGV4dHJhIHByb3BlcnRpZXMgb24gZXJyb3Igb2JqZWN0XHJcbiAgICAgIHJlZ2lvbiA9IGUuUmVnaW9uIGFzIHN0cmluZ1xyXG4gICAgICBpZiAoIXJlZ2lvbikge1xyXG4gICAgICAgIHRocm93IGVcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIHBhdGhTdHlsZSB9LCAnJywgWzIwMF0sIHJlZ2lvbilcclxuICAgIHJldHVybiBhd2FpdCBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXHJcbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cclxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXHJcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cclxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kXHJcbiAgICogZ2V0QnVja2V0UmVnaW9uLlxyXG4gICAqXHJcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdEFzeW5jYCBpbnN0ZWFkXHJcbiAgICovXHJcbiAgbWFrZVJlcXVlc3QoXHJcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxyXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXHJcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxyXG4gICAgcmVnaW9uID0gJycsXHJcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcclxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXHJcbiAgKSB7XHJcbiAgICBsZXQgcHJvbTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT5cclxuICAgIGlmIChyZXR1cm5SZXNwb25zZSkge1xyXG4gICAgICBwcm9tID0gdGhpcy5tYWtlUmVxdWVzdEFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjb21wYXRpYmxlIGZvciBvbGQgYmVoYXZpb3VyXHJcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcclxuICAgIH1cclxuXHJcbiAgICBwcm9tLnRoZW4oXHJcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXHJcbiAgICAgIChlcnIpID0+IHtcclxuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAgIGNiKGVycilcclxuICAgICAgfSxcclxuICAgIClcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIG1ha2VSZXF1ZXN0U3RyZWFtIHdpbGwgYmUgdXNlZCBkaXJlY3RseSBpbnN0ZWFkIG9mIG1ha2VSZXF1ZXN0IGluIGNhc2UgdGhlIHBheWxvYWRcclxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XHJcbiAgICpcclxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmNgIGluc3RlYWRcclxuICAgKi9cclxuICBtYWtlUmVxdWVzdFN0cmVhbShcclxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXHJcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlcixcclxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxyXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdLFxyXG4gICAgcmVnaW9uOiBzdHJpbmcsXHJcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcclxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXHJcbiAgKSB7XHJcbiAgICBjb25zdCBleGVjdXRvciA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHN0cmVhbSwgc2hhMjU2c3VtLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxyXG4gICAgICBpZiAoIXJldHVyblJlc3BvbnNlKSB7XHJcbiAgICAgICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiByZXNcclxuICAgIH1cclxuXHJcbiAgICBleGVjdXRvcigpLnRoZW4oXHJcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXHJcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxyXG4gICAgKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBnZXRCdWNrZXRSZWdpb25Bc3luY2AgaW5zdGVhZFxyXG4gICAqL1xyXG4gIGdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lOiBzdHJpbmcsIGNiOiAoZXJyOiB1bmtub3duLCByZWdpb246IHN0cmluZykgPT4gdm9pZCkge1xyXG4gICAgcmV0dXJuIHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSkudGhlbihcclxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcclxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgIChlcnIpID0+IGNiKGVyciksXHJcbiAgICApXHJcbiAgfVxyXG5cclxuICAvLyBCdWNrZXQgb3BlcmF0aW9uc1xyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGVzIHRoZSBidWNrZXQgYGJ1Y2tldE5hbWVgLlxyXG4gICAqXHJcbiAgICovXHJcbiAgYXN5bmMgbWFrZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIHJlZ2lvbjogUmVnaW9uID0gJycsIG1ha2VPcHRzPzogTWFrZUJ1Y2tldE9wdCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgLy8gQmFja3dhcmQgQ29tcGF0aWJpbGl0eVxyXG4gICAgaWYgKGlzT2JqZWN0KHJlZ2lvbikpIHtcclxuICAgICAgbWFrZU9wdHMgPSByZWdpb25cclxuICAgICAgcmVnaW9uID0gJydcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKG1ha2VPcHRzICYmICFpc09iamVjdChtYWtlT3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHBheWxvYWQgPSAnJ1xyXG5cclxuICAgIC8vIFJlZ2lvbiBhbHJlYWR5IHNldCBpbiBjb25zdHJ1Y3RvciwgdmFsaWRhdGUgaWZcclxuICAgIC8vIGNhbGxlciByZXF1ZXN0ZWQgYnVja2V0IGxvY2F0aW9uIGlzIHNhbWUuXHJcbiAgICBpZiAocmVnaW9uICYmIHRoaXMucmVnaW9uKSB7XHJcbiAgICAgIGlmIChyZWdpb24gIT09IHRoaXMucmVnaW9uKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgQ29uZmlndXJlZCByZWdpb24gJHt0aGlzLnJlZ2lvbn0sIHJlcXVlc3RlZCAke3JlZ2lvbn1gKVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBzZW5kaW5nIG1ha2VCdWNrZXQgcmVxdWVzdCB3aXRoIFhNTCBjb250YWluaW5nICd1cy1lYXN0LTEnIGZhaWxzLiBGb3JcclxuICAgIC8vIGRlZmF1bHQgcmVnaW9uIHNlcnZlciBleHBlY3RzIHRoZSByZXF1ZXN0IHdpdGhvdXQgYm9keVxyXG4gICAgaWYgKHJlZ2lvbiAmJiByZWdpb24gIT09IERFRkFVTFRfUkVHSU9OKSB7XHJcbiAgICAgIHBheWxvYWQgPSB4bWwuYnVpbGRPYmplY3Qoe1xyXG4gICAgICAgIENyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb246IHtcclxuICAgICAgICAgICQ6IHsgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nIH0sXHJcbiAgICAgICAgICBMb2NhdGlvbkNvbnN0cmFpbnQ6IHJlZ2lvbixcclxuICAgICAgICB9LFxyXG4gICAgICB9KVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cclxuXHJcbiAgICBpZiAobWFrZU9wdHMgJiYgbWFrZU9wdHMuT2JqZWN0TG9ja2luZykge1xyXG4gICAgICBoZWFkZXJzWyd4LWFtei1idWNrZXQtb2JqZWN0LWxvY2stZW5hYmxlZCddID0gdHJ1ZVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEZvciBjdXN0b20gcmVnaW9uIGNsaWVudHMgIGRlZmF1bHQgdG8gY3VzdG9tIHJlZ2lvbiBzcGVjaWZpZWQgaW4gY2xpZW50IGNvbnN0cnVjdG9yXHJcbiAgICBjb25zdCBmaW5hbFJlZ2lvbiA9IHRoaXMucmVnaW9uIHx8IHJlZ2lvbiB8fCBERUZBVUxUX1JFR0lPTlxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3RPcHQ6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgaGVhZGVycyB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZmluYWxSZWdpb24pXHJcbiAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcclxuICAgICAgaWYgKHJlZ2lvbiA9PT0gJycgfHwgcmVnaW9uID09PSBERUZBVUxUX1JFR0lPTikge1xyXG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xyXG4gICAgICAgICAgY29uc3QgZXJyQ29kZSA9IGVyci5jb2RlXHJcbiAgICAgICAgICBjb25zdCBlcnJSZWdpb24gPSBlcnIucmVnaW9uXHJcbiAgICAgICAgICBpZiAoZXJyQ29kZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnICYmIGVyclJlZ2lvbiAhPT0gJycpIHtcclxuICAgICAgICAgICAgLy8gUmV0cnkgd2l0aCByZWdpb24gcmV0dXJuZWQgYXMgcGFydCBvZiBlcnJvclxyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHQsIHBheWxvYWQsIFsyMDBdLCBlcnJDb2RlKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBlcnJcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFRvIGNoZWNrIGlmIGEgYnVja2V0IGFscmVhZHkgZXhpc3RzLlxyXG4gICAqL1xyXG4gIGFzeW5jIGJ1Y2tldEV4aXN0cyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9KVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgaWYgKGVyci5jb2RlID09PSAnTm9TdWNoQnVja2V0JyB8fCBlcnIuY29kZSA9PT0gJ05vdEZvdW5kJykge1xyXG4gICAgICAgIHJldHVybiBmYWxzZVxyXG4gICAgICB9XHJcbiAgICAgIHRocm93IGVyclxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB0cnVlXHJcbiAgfVxyXG5cclxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxyXG5cclxuICAvKipcclxuICAgKiBAZGVwcmVjYXRlZCB1c2UgcHJvbWlzZSBzdHlsZSBBUElcclxuICAgKi9cclxuICByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSwgJycsIFsyMDRdKVxyXG4gICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIG9iamVjdCBjb250ZW50LlxyXG4gICAqL1xyXG4gIGFzeW5jIGdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAwLCAwLCBnZXRPcHRzKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBwYXJ0aWFsIG9iamVjdCBjb250ZW50LlxyXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXHJcbiAgICogQHBhcmFtIG9iamVjdE5hbWVcclxuICAgKiBAcGFyYW0gb2Zmc2V0XHJcbiAgICogQHBhcmFtIGxlbmd0aCAtIGxlbmd0aCBvZiB0aGUgb2JqZWN0IHRoYXQgd2lsbCBiZSByZWFkIGluIHRoZSBzdHJlYW0gKG9wdGlvbmFsLCBpZiBub3Qgc3BlY2lmaWVkIHdlIHJlYWQgdGhlIHJlc3Qgb2YgdGhlIGZpbGUgZnJvbSB0aGUgb2Zmc2V0KVxyXG4gICAqIEBwYXJhbSBnZXRPcHRzXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0UGFydGlhbE9iamVjdChcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIG9mZnNldDogbnVtYmVyLFxyXG4gICAgbGVuZ3RoID0gMCxcclxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzLFxyXG4gICk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzTnVtYmVyKG9mZnNldCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb2Zmc2V0IHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc051bWJlcihsZW5ndGgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xlbmd0aCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgIH1cclxuXHJcbiAgICBsZXQgcmFuZ2UgPSAnJ1xyXG4gICAgaWYgKG9mZnNldCB8fCBsZW5ndGgpIHtcclxuICAgICAgaWYgKG9mZnNldCkge1xyXG4gICAgICAgIHJhbmdlID0gYGJ5dGVzPSR7K29mZnNldH0tYFxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJhbmdlID0gJ2J5dGVzPTAtJ1xyXG4gICAgICAgIG9mZnNldCA9IDBcclxuICAgICAgfVxyXG4gICAgICBpZiAobGVuZ3RoKSB7XHJcbiAgICAgICAgcmFuZ2UgKz0gYCR7K2xlbmd0aCArIG9mZnNldCAtIDF9YFxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHF1ZXJ5ID0gJydcclxuICAgIGxldCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHtcclxuICAgICAgLi4uKHJhbmdlICE9PSAnJyAmJiB7IHJhbmdlIH0pLFxyXG4gICAgfVxyXG5cclxuICAgIGlmIChnZXRPcHRzKSB7XHJcbiAgICAgIGNvbnN0IHNzZUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0gJiYge1xyXG4gICAgICAgICAgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItQWxnb3JpdGhtJzogZ2V0T3B0cy5TU0VDdXN0b21lckFsZ29yaXRobSxcclxuICAgICAgICB9KSxcclxuICAgICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lcktleSAmJiB7ICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUtleSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgfSksXHJcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUgJiYge1xyXG4gICAgICAgICAgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItS2V5LU1ENSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH1cclxuICAgICAgcXVlcnkgPSBxcy5zdHJpbmdpZnkoZ2V0T3B0cylcclxuICAgICAgaGVhZGVycyA9IHtcclxuICAgICAgICAuLi5wcmVwZW5kWEFNWk1ldGEoc3NlSGVhZGVycyksXHJcbiAgICAgICAgLi4uaGVhZGVycyxcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGV4cGVjdGVkU3RhdHVzQ29kZXMgPSBbMjAwXVxyXG4gICAgaWYgKHJhbmdlKSB7XHJcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG5cclxuICAgIHJldHVybiBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogZG93bmxvYWQgb2JqZWN0IGNvbnRlbnQgdG8gYSBmaWxlLlxyXG4gICAqIFRoaXMgbWV0aG9kIHdpbGwgY3JlYXRlIGEgdGVtcCBmaWxlIG5hbWVkIGAke2ZpbGVuYW1lfS4ke2Jhc2U2NChldGFnKX0ucGFydC5taW5pb2Agd2hlbiBkb3dubG9hZGluZy5cclxuICAgKlxyXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gbmFtZSBvZiB0aGUgYnVja2V0XHJcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBuYW1lIG9mIHRoZSBvYmplY3RcclxuICAgKiBAcGFyYW0gZmlsZVBhdGggLSBwYXRoIHRvIHdoaWNoIHRoZSBvYmplY3QgZGF0YSB3aWxsIGJlIHdyaXR0ZW4gdG9cclxuICAgKiBAcGFyYW0gZ2V0T3B0cyAtIE9wdGlvbmFsIG9iamVjdCBnZXQgb3B0aW9uXHJcbiAgICovXHJcbiAgYXN5bmMgZkdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIElucHV0IHZhbGlkYXRpb24uXHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkb3dubG9hZFRvVG1wRmlsZSA9IGFzeW5jICgpOiBQcm9taXNlPHN0cmluZz4gPT4ge1xyXG4gICAgICBsZXQgcGFydEZpbGVTdHJlYW06IHN0cmVhbS5Xcml0YWJsZVxyXG4gICAgICBjb25zdCBvYmpTdGF0ID0gYXdhaXQgdGhpcy5zdGF0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMpXHJcbiAgICAgIGNvbnN0IGVuY29kZWRFdGFnID0gQnVmZmVyLmZyb20ob2JqU3RhdC5ldGFnKS50b1N0cmluZygnYmFzZTY0JylcclxuICAgICAgY29uc3QgcGFydEZpbGUgPSBgJHtmaWxlUGF0aH0uJHtlbmNvZGVkRXRhZ30ucGFydC5taW5pb2BcclxuXHJcbiAgICAgIGF3YWl0IGZzcC5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxyXG5cclxuICAgICAgbGV0IG9mZnNldCA9IDBcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzcC5zdGF0KHBhcnRGaWxlKVxyXG4gICAgICAgIGlmIChvYmpTdGF0LnNpemUgPT09IHN0YXRzLnNpemUpIHtcclxuICAgICAgICAgIHJldHVybiBwYXJ0RmlsZVxyXG4gICAgICAgIH1cclxuICAgICAgICBvZmZzZXQgPSBzdGF0cy5zaXplXHJcbiAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ2EnIH0pXHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEVycm9yICYmIChlIGFzIHVua25vd24gYXMgeyBjb2RlOiBzdHJpbmcgfSkuY29kZSA9PT0gJ0VOT0VOVCcpIHtcclxuICAgICAgICAgIC8vIGZpbGUgbm90IGV4aXN0XHJcbiAgICAgICAgICBwYXJ0RmlsZVN0cmVhbSA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHBhcnRGaWxlLCB7IGZsYWdzOiAndycgfSlcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgLy8gb3RoZXIgZXJyb3IsIG1heWJlIGFjY2VzcyBkZW55XHJcbiAgICAgICAgICB0aHJvdyBlXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBkb3dubG9hZFN0cmVhbSA9IGF3YWl0IHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBvZmZzZXQsIDAsIGdldE9wdHMpXHJcblxyXG4gICAgICBhd2FpdCBzdHJlYW1Qcm9taXNlLnBpcGVsaW5lKGRvd25sb2FkU3RyZWFtLCBwYXJ0RmlsZVN0cmVhbSlcclxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcclxuICAgICAgaWYgKHN0YXRzLnNpemUgPT09IG9ialN0YXQuc2l6ZSkge1xyXG4gICAgICAgIHJldHVybiBwYXJ0RmlsZVxyXG4gICAgICB9XHJcblxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NpemUgbWlzbWF0Y2ggYmV0d2VlbiBkb3dubG9hZGVkIGZpbGUgYW5kIHRoZSBvYmplY3QnKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBhcnRGaWxlID0gYXdhaXQgZG93bmxvYWRUb1RtcEZpbGUoKVxyXG4gICAgYXdhaXQgZnNwLnJlbmFtZShwYXJ0RmlsZSwgZmlsZVBhdGgpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGF0IGluZm9ybWF0aW9uIG9mIHRoZSBvYmplY3QuXHJcbiAgICovXHJcbiAgYXN5bmMgc3RhdE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc3RhdE9wdHM/OiBTdGF0T2JqZWN0T3B0cyk6IFByb21pc2U8QnVja2V0SXRlbVN0YXQ+IHtcclxuICAgIGNvbnN0IHN0YXRPcHREZWYgPSBzdGF0T3B0cyB8fCB7fVxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNPYmplY3Qoc3RhdE9wdERlZikpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc3RhdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoc3RhdE9wdERlZilcclxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzaXplOiBwYXJzZUludChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSBhcyBzdHJpbmcpLFxyXG4gICAgICBtZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgICAgbGFzdE1vZGlmaWVkOiBuZXcgRGF0ZShyZXMuaGVhZGVyc1snbGFzdC1tb2RpZmllZCddIGFzIHN0cmluZyksXHJcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlT2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZW1vdmVPcHRzPzogUmVtb3ZlT3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZW1vdmVPcHRzICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxyXG4gICAgaWYgKHJlbW92ZU9wdHM/LmdvdmVybmFuY2VCeXBhc3MpIHtcclxuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXHJcbiAgICB9XHJcbiAgICBpZiAocmVtb3ZlT3B0cz8uZm9yY2VEZWxldGUpIHtcclxuICAgICAgaGVhZGVyc1sneC1taW5pby1mb3JjZS1kZWxldGUnXSA9IHRydWVcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBxdWVyeVBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XHJcbiAgICBpZiAocmVtb3ZlT3B0cz8udmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5UGFyYW1zLnZlcnNpb25JZCA9IGAke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHF1ZXJ5UGFyYW1zKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxyXG4gIH1cclxuXHJcbiAgLy8gQ2FsbHMgaW1wbGVtZW50ZWQgYmVsb3cgYXJlIHJlbGF0ZWQgdG8gbXVsdGlwYXJ0LlxyXG5cclxuICBsaXN0SW5jb21wbGV0ZVVwbG9hZHMoXHJcbiAgICBidWNrZXQ6IHN0cmluZyxcclxuICAgIHByZWZpeDogc3RyaW5nLFxyXG4gICAgcmVjdXJzaXZlOiBib29sZWFuLFxyXG4gICk6IEJ1Y2tldFN0cmVhbTxJbmNvbXBsZXRlVXBsb2FkZWRCdWNrZXRJdGVtPiB7XHJcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgcHJlZml4ID0gJydcclxuICAgIH1cclxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldClcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXHJcbiAgICB9XHJcbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xyXG4gICAgbGV0IGtleU1hcmtlciA9ICcnXHJcbiAgICBsZXQgdXBsb2FkSWRNYXJrZXIgPSAnJ1xyXG4gICAgY29uc3QgdXBsb2FkczogdW5rbm93bltdID0gW11cclxuICAgIGxldCBlbmRlZCA9IGZhbHNlXHJcblxyXG4gICAgLy8gVE9ETzogcmVmYWN0b3IgdGhpcyB3aXRoIGFzeW5jL2F3YWl0IGFuZCBgc3RyZWFtLlJlYWRhYmxlLmZyb21gXHJcbiAgICBjb25zdCByZWFkU3RyZWFtID0gbmV3IHN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcclxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XHJcbiAgICAgIC8vIHB1c2ggb25lIHVwbG9hZCBpbmZvIHBlciBfcmVhZCgpXHJcbiAgICAgIGlmICh1cGxvYWRzLmxlbmd0aCkge1xyXG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2godXBsb2Fkcy5zaGlmdCgpKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChlbmRlZCkge1xyXG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldCwgcHJlZml4LCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCBkZWxpbWl0ZXIpLnRoZW4oXHJcbiAgICAgICAgKHJlc3VsdCkgPT4ge1xyXG4gICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICAgICAgcmVzdWx0LnByZWZpeGVzLmZvckVhY2goKHByZWZpeCkgPT4gdXBsb2Fkcy5wdXNoKHByZWZpeCkpXHJcbiAgICAgICAgICBhc3luYy5lYWNoU2VyaWVzKFxyXG4gICAgICAgICAgICByZXN1bHQudXBsb2FkcyxcclxuICAgICAgICAgICAgKHVwbG9hZCwgY2IpID0+IHtcclxuICAgICAgICAgICAgICAvLyBmb3IgZWFjaCBpbmNvbXBsZXRlIHVwbG9hZCBhZGQgdGhlIHNpemVzIG9mIGl0cyB1cGxvYWRlZCBwYXJ0c1xyXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcclxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgICAgICAgICAgdGhpcy5saXN0UGFydHMoYnVja2V0LCB1cGxvYWQua2V5LCB1cGxvYWQudXBsb2FkSWQpLnRoZW4oXHJcbiAgICAgICAgICAgICAgICAocGFydHM6IFBhcnRbXSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XHJcbiAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgICAgICAgICAgICAgdXBsb2FkLnNpemUgPSBwYXJ0cy5yZWR1Y2UoKGFjYywgaXRlbSkgPT4gYWNjICsgaXRlbS5zaXplLCAwKVxyXG4gICAgICAgICAgICAgICAgICB1cGxvYWRzLnB1c2godXBsb2FkKVxyXG4gICAgICAgICAgICAgICAgICBjYigpXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgKGVycjogRXJyb3IpID0+IGNiKGVyciksXHJcbiAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAoZXJyKSA9PiB7XHJcbiAgICAgICAgICAgICAgaWYgKGVycikge1xyXG4gICAgICAgICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcclxuICAgICAgICAgICAgICAgIHJldHVyblxyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XHJcbiAgICAgICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxyXG4gICAgICAgICAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXHJcbiAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxyXG4gICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIClcclxuICAgICAgICB9LFxyXG4gICAgICAgIChlKSA9PiB7XHJcbiAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSlcclxuICAgICAgICB9LFxyXG4gICAgICApXHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVhZFN0cmVhbVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2FsbGVkIGJ5IGxpc3RJbmNvbXBsZXRlVXBsb2FkcyB0byBmZXRjaCBhIGJhdGNoIG9mIGluY29tcGxldGUgdXBsb2Fkcy5cclxuICAgKi9cclxuICBhc3luYyBsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIHByZWZpeDogc3RyaW5nLFxyXG4gICAga2V5TWFya2VyOiBzdHJpbmcsXHJcbiAgICB1cGxvYWRJZE1hcmtlcjogc3RyaW5nLFxyXG4gICAgZGVsaW1pdGVyOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTxMaXN0TXVsdGlwYXJ0UmVzdWx0PiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhrZXlNYXJrZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2tleU1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWRNYXJrZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkTWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxyXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxyXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoZGVsaW1pdGVyKX1gKVxyXG5cclxuICAgIGlmIChrZXlNYXJrZXIpIHtcclxuICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7dXJpRXNjYXBlKGtleU1hcmtlcil9YClcclxuICAgIH1cclxuICAgIGlmICh1cGxvYWRJZE1hcmtlcikge1xyXG4gICAgICBxdWVyaWVzLnB1c2goYHVwbG9hZC1pZC1tYXJrZXI9JHt1cGxvYWRJZE1hcmtlcn1gKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1heFVwbG9hZHMgPSAxMDAwXHJcbiAgICBxdWVyaWVzLnB1c2goYG1heC11cGxvYWRzPSR7bWF4VXBsb2Fkc31gKVxyXG4gICAgcXVlcmllcy5zb3J0KClcclxuICAgIHF1ZXJpZXMudW5zaGlmdCgndXBsb2FkcycpXHJcbiAgICBsZXQgcXVlcnkgPSAnJ1xyXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdE11bHRpcGFydChib2R5KVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSW5pdGlhdGUgYSBuZXcgbXVsdGlwYXJ0IHVwbG9hZC5cclxuICAgKiBAaW50ZXJuYWxcclxuICAgKi9cclxuICBhc3luYyBpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChoZWFkZXJzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoJ2NvbnRlbnRUeXBlIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXHJcbiAgICBjb25zdCBxdWVyeSA9ICd1cGxvYWRzJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXHJcbiAgICByZXR1cm4gcGFyc2VJbml0aWF0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBJbnRlcm5hbCBNZXRob2QgdG8gYWJvcnQgYSBtdWx0aXBhcnQgdXBsb2FkIHJlcXVlc3QgaW4gY2FzZSBvZiBhbnkgZXJyb3JzLlxyXG4gICAqXHJcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBCdWNrZXQgTmFtZVxyXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gT2JqZWN0IE5hbWVcclxuICAgKiBAcGFyYW0gdXBsb2FkSWQgLSBpZCBvZiBhIG11bHRpcGFydCB1cGxvYWQgdG8gY2FuY2VsIGR1cmluZyBjb21wb3NlIG9iamVjdCBzZXF1ZW5jZS5cclxuICAgKi9cclxuICBhc3luYyBhYm9ydE11bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSWR9YFxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5IH1cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsICcnLCBbMjA0XSlcclxuICB9XHJcblxyXG4gIGFzeW5jIGZpbmRVcGxvYWRJZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGxhdGVzdFVwbG9hZDogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gfCB1bmRlZmluZWRcclxuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xyXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcclxuICAgIGZvciAoOzspIHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCAnJylcclxuICAgICAgZm9yIChjb25zdCB1cGxvYWQgb2YgcmVzdWx0LnVwbG9hZHMpIHtcclxuICAgICAgICBpZiAodXBsb2FkLmtleSA9PT0gb2JqZWN0TmFtZSkge1xyXG4gICAgICAgICAgaWYgKCFsYXRlc3RVcGxvYWQgfHwgdXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkgPiBsYXRlc3RVcGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSkge1xyXG4gICAgICAgICAgICBsYXRlc3RVcGxvYWQgPSB1cGxvYWRcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xyXG4gICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXHJcbiAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXHJcbiAgICAgICAgY29udGludWVcclxuICAgICAgfVxyXG5cclxuICAgICAgYnJlYWtcclxuICAgIH1cclxuICAgIHJldHVybiBsYXRlc3RVcGxvYWQ/LnVwbG9hZElkXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiB0aGlzIGNhbGwgd2lsbCBhZ2dyZWdhdGUgdGhlIHBhcnRzIG9uIHRoZSBzZXJ2ZXIgaW50byBhIHNpbmdsZSBvYmplY3QuXHJcbiAgICovXHJcbiAgYXN5bmMgY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICB1cGxvYWRJZDogc3RyaW5nLFxyXG4gICAgZXRhZ3M6IHtcclxuICAgICAgcGFydDogbnVtYmVyXHJcbiAgICAgIGV0YWc/OiBzdHJpbmdcclxuICAgIH1bXSxcclxuICApOiBQcm9taXNlPHsgZXRhZzogc3RyaW5nOyB2ZXJzaW9uSWQ6IHN0cmluZyB8IG51bGwgfT4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzT2JqZWN0KGV0YWdzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIkFycmF5XCInKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghdXBsb2FkSWQpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcigpXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh7XHJcbiAgICAgIENvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkOiB7XHJcbiAgICAgICAgJDoge1xyXG4gICAgICAgICAgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgUGFydDogZXRhZ3MubWFwKChldGFnKSA9PiB7XHJcbiAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBQYXJ0TnVtYmVyOiBldGFnLnBhcnQsXHJcbiAgICAgICAgICAgIEVUYWc6IGV0YWcuZXRhZyxcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pXHJcblxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXHJcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcclxuICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignQlVHOiBmYWlsZWQgdG8gcGFyc2Ugc2VydmVyIHJlc3BvbnNlJylcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVzdWx0LmVyckNvZGUpIHtcclxuICAgICAgLy8gTXVsdGlwYXJ0IENvbXBsZXRlIEFQSSByZXR1cm5zIGFuIGVycm9yIFhNTCBhZnRlciBhIDIwMCBodHRwIHN0YXR1c1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLlMzRXJyb3IocmVzdWx0LmVyck1lc3NhZ2UpXHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxyXG4gICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgIGV0YWc6IHJlc3VsdC5ldGFnIGFzIHN0cmluZyxcclxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IHBhcnQtaW5mbyBvZiBhbGwgcGFydHMgb2YgYW4gaW5jb21wbGV0ZSB1cGxvYWQgc3BlY2lmaWVkIGJ5IHVwbG9hZElkLlxyXG4gICAqL1xyXG4gIHByb3RlY3RlZCBhc3luYyBsaXN0UGFydHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPFVwbG9hZGVkUGFydFtdPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghdXBsb2FkSWQpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXJ0czogVXBsb2FkZWRQYXJ0W10gPSBbXVxyXG4gICAgbGV0IG1hcmtlciA9IDBcclxuICAgIGxldCByZXN1bHRcclxuICAgIGRvIHtcclxuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0UGFydHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgbWFya2VyKVxyXG4gICAgICBtYXJrZXIgPSByZXN1bHQubWFya2VyXHJcbiAgICAgIHBhcnRzLnB1c2goLi4ucmVzdWx0LnBhcnRzKVxyXG4gICAgfSB3aGlsZSAocmVzdWx0LmlzVHJ1bmNhdGVkKVxyXG5cclxuICAgIHJldHVybiBwYXJ0c1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2FsbGVkIGJ5IGxpc3RQYXJ0cyB0byBmZXRjaCBhIGJhdGNoIG9mIHBhcnQtaW5mb1xyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgbGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcsIG1hcmtlcjogbnVtYmVyKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghaXNOdW1iZXIobWFya2VyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIXVwbG9hZElkKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXHJcbiAgICBpZiAobWFya2VyKSB7XHJcbiAgICAgIHF1ZXJ5ICs9IGAmcGFydC1udW1iZXItbWFya2VyPSR7bWFya2VyfWBcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0UGFydHMoYXdhaXQgcmVhZEFzU3RyaW5nKHJlcykpXHJcbiAgfVxyXG5cclxuICBhc3luYyBsaXN0QnVja2V0cygpOiBQcm9taXNlPEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdPiB7XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcmVnaW9uQ29uZiA9IHRoaXMucmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXHJcbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kIH0sICcnLCBbMjAwXSwgcmVnaW9uQ29uZilcclxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENhbGN1bGF0ZSBwYXJ0IHNpemUgZ2l2ZW4gdGhlIG9iamVjdCBzaXplLiBQYXJ0IHNpemUgd2lsbCBiZSBhdGxlYXN0IHRoaXMucGFydFNpemVcclxuICAgKi9cclxuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplOiBudW1iZXIpIHtcclxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2l6ZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcclxuICAgIH1cclxuICAgIGlmIChzaXplID4gdGhpcy5tYXhPYmplY3RTaXplKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHNpemUgc2hvdWxkIG5vdCBiZSBtb3JlIHRoYW4gJHt0aGlzLm1heE9iamVjdFNpemV9YClcclxuICAgIH1cclxuICAgIGlmICh0aGlzLm92ZXJSaWRlUGFydFNpemUpIHtcclxuICAgICAgcmV0dXJuIHRoaXMucGFydFNpemVcclxuICAgIH1cclxuICAgIGxldCBwYXJ0U2l6ZSA9IHRoaXMucGFydFNpemVcclxuICAgIGZvciAoOzspIHtcclxuICAgICAgLy8gd2hpbGUodHJ1ZSkgey4uLn0gdGhyb3dzIGxpbnRpbmcgZXJyb3IuXHJcbiAgICAgIC8vIElmIHBhcnRTaXplIGlzIGJpZyBlbm91Z2ggdG8gYWNjb21vZGF0ZSB0aGUgb2JqZWN0IHNpemUsIHRoZW4gdXNlIGl0LlxyXG4gICAgICBpZiAocGFydFNpemUgKiAxMDAwMCA+IHNpemUpIHtcclxuICAgICAgICByZXR1cm4gcGFydFNpemVcclxuICAgICAgfVxyXG4gICAgICAvLyBUcnkgcGFydCBzaXplcyBhcyA2NE1CLCA4ME1CLCA5Nk1CIGV0Yy5cclxuICAgICAgcGFydFNpemUgKz0gMTYgKiAxMDI0ICogMTAyNFxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVXBsb2FkcyB0aGUgb2JqZWN0IHVzaW5nIGNvbnRlbnRzIGZyb20gYSBmaWxlXHJcbiAgICovXHJcbiAgYXN5bmMgZlB1dE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbWV0YURhdGE/OiBPYmplY3RNZXRhRGF0YSkge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2ZpbGVQYXRoIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKG1ldGFEYXRhICYmICFpc09iamVjdChtZXRhRGF0YSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWV0YURhdGEgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcblxyXG4gICAgLy8gSW5zZXJ0cyBjb3JyZWN0IGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZSBiYXNlZCBvbiBtZXRhRGF0YSBhbmQgZmlsZVBhdGhcclxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEgfHwge30sIGZpbGVQYXRoKVxyXG4gICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzcC5zdGF0KGZpbGVQYXRoKVxyXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucHV0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpLCBzdGF0LnNpemUsIG1ldGFEYXRhKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogIFVwbG9hZGluZyBhIHN0cmVhbSwgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiLlxyXG4gICAqICBJdCdzIHJlY29tbWVuZGVkIHRvIHBhc3MgYHNpemVgIGFyZ3VtZW50IHdpdGggc3RyZWFtLlxyXG4gICAqL1xyXG4gIGFzeW5jIHB1dE9iamVjdChcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nLFxyXG4gICAgc2l6ZT86IG51bWJlcixcclxuICAgIG1ldGFEYXRhPzogSXRlbUJ1Y2tldE1ldGFkYXRhLFxyXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgLy8gV2UnbGwgbmVlZCB0byBzaGlmdCBhcmd1bWVudHMgdG8gdGhlIGxlZnQgYmVjYXVzZSBvZiBtZXRhRGF0YVxyXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXHJcbiAgICBpZiAoaXNPYmplY3Qoc2l6ZSkpIHtcclxuICAgICAgbWV0YURhdGEgPSBzaXplXHJcbiAgICB9XHJcbiAgICAvLyBFbnN1cmVzIE1ldGFkYXRhIGhhcyBhcHByb3ByaWF0ZSBwcmVmaXggZm9yIEEzIEFQSVxyXG4gICAgY29uc3QgaGVhZGVycyA9IHByZXBlbmRYQU1aTWV0YShtZXRhRGF0YSlcclxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcclxuICAgICAgLy8gQWRhcHRzIHRoZSBub24tc3RyZWFtIGludGVyZmFjZSBpbnRvIGEgc3RyZWFtLlxyXG4gICAgICBzaXplID0gc3RyZWFtLmxlbmd0aFxyXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXHJcbiAgICB9IGVsc2UgaWYgKCFpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndGhpcmQgYXJndW1lbnQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJlYW0uUmVhZGFibGVcIiBvciBcIkJ1ZmZlclwiIG9yIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChpc051bWJlcihzaXplKSAmJiBzaXplIDwgMCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaXplIGNhbm5vdCBiZSBuZWdhdGl2ZSwgZ2l2ZW4gc2l6ZTogJHtzaXplfWApXHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXHJcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxyXG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xyXG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXHJcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxyXG4gICAgaWYgKHNpemUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBjb25zdCBzdGF0U2l6ZSA9IGF3YWl0IGdldENvbnRlbnRMZW5ndGgoc3RyZWFtKVxyXG4gICAgICBpZiAoc3RhdFNpemUgIT09IG51bGwpIHtcclxuICAgICAgICBzaXplID0gc3RhdFNpemVcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcclxuICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXHJcbiAgICB9XHJcbiAgICBpZiAoc2l6ZSA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRCdWZmZXIoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgQnVmZmVyLmZyb20oJycpKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBhcnRTaXplID0gdGhpcy5jYWxjdWxhdGVQYXJ0U2l6ZShzaXplKVxyXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdHJlYW0pIHx8IHNpemUgPD0gcGFydFNpemUpIHtcclxuICAgICAgY29uc3QgYnVmID0gaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pID8gYXdhaXQgcmVhZEFzQnVmZmVyKHN0cmVhbSkgOiBCdWZmZXIuZnJvbShzdHJlYW0pXHJcbiAgICAgIHJldHVybiB0aGlzLnVwbG9hZEJ1ZmZlcihidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBidWYpXHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXMudXBsb2FkU3RyZWFtKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHN0cmVhbSwgcGFydFNpemUpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBtZXRob2QgdG8gdXBsb2FkIGJ1ZmZlciBpbiBvbmUgY2FsbFxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCdWZmZXIoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyxcclxuICAgIGJ1ZjogQnVmZmVyLFxyXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XHJcbiAgICBjb25zdCB7IG1kNXN1bSwgc2hhMjU2c3VtIH0gPSBoYXNoQmluYXJ5KGJ1ZiwgdGhpcy5lbmFibGVTSEEyNTYpXHJcbiAgICBoZWFkZXJzWydDb250ZW50LUxlbmd0aCddID0gYnVmLmxlbmd0aFxyXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xyXG4gICAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gbWQ1c3VtXHJcbiAgICB9XHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXHJcbiAgICAgIHtcclxuICAgICAgICBtZXRob2Q6ICdQVVQnLFxyXG4gICAgICAgIGJ1Y2tldE5hbWUsXHJcbiAgICAgICAgb2JqZWN0TmFtZSxcclxuICAgICAgICBoZWFkZXJzLFxyXG4gICAgICB9LFxyXG4gICAgICBidWYsXHJcbiAgICAgIHNoYTI1NnN1bSxcclxuICAgICAgWzIwMF0sXHJcbiAgICAgICcnLFxyXG4gICAgKVxyXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXHJcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIHVwbG9hZCBzdHJlYW0gd2l0aCBNdWx0aXBhcnRVcGxvYWRcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkU3RyZWFtKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXHJcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUsXHJcbiAgICBwYXJ0U2l6ZTogbnVtYmVyLFxyXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XHJcbiAgICAvLyBBIG1hcCBvZiB0aGUgcHJldmlvdXNseSB1cGxvYWRlZCBjaHVua3MsIGZvciByZXN1bWluZyBhIGZpbGUgdXBsb2FkLiBUaGlzXHJcbiAgICAvLyB3aWxsIGJlIG51bGwgaWYgd2UgYXJlbid0IHJlc3VtaW5nIGFuIHVwbG9hZC5cclxuICAgIGNvbnN0IG9sZFBhcnRzOiBSZWNvcmQ8bnVtYmVyLCBQYXJ0PiA9IHt9XHJcblxyXG4gICAgLy8gS2VlcCB0cmFjayBvZiB0aGUgZXRhZ3MgZm9yIGFnZ3JlZ2F0aW5nIHRoZSBjaHVua3MgdG9nZXRoZXIgbGF0ZXIuIEVhY2hcclxuICAgIC8vIGV0YWcgcmVwcmVzZW50cyBhIHNpbmdsZSBjaHVuayBvZiB0aGUgZmlsZS5cclxuICAgIGNvbnN0IGVUYWdzOiBQYXJ0W10gPSBbXVxyXG5cclxuICAgIGNvbnN0IHByZXZpb3VzVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxyXG4gICAgbGV0IHVwbG9hZElkOiBzdHJpbmdcclxuICAgIGlmICghcHJldmlvdXNVcGxvYWRJZCkge1xyXG4gICAgICB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycylcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHVwbG9hZElkID0gcHJldmlvdXNVcGxvYWRJZFxyXG4gICAgICBjb25zdCBvbGRUYWdzID0gYXdhaXQgdGhpcy5saXN0UGFydHMoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcHJldmlvdXNVcGxvYWRJZClcclxuICAgICAgb2xkVGFncy5mb3JFYWNoKChlKSA9PiB7XHJcbiAgICAgICAgb2xkUGFydHNbZS5wYXJ0XSA9IGVcclxuICAgICAgfSlcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjaHVua2llciA9IG5ldyBCbG9ja1N0cmVhbTIoeyBzaXplOiBwYXJ0U2l6ZSwgemVyb1BhZGRpbmc6IGZhbHNlIH0pXHJcblxyXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby11bnVzZWQtdmFyc1xyXG4gICAgY29uc3QgW18sIG9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgYm9keS5waXBlKGNodW5raWVyKS5vbignZXJyb3InLCByZWplY3QpXHJcbiAgICAgICAgY2h1bmtpZXIub24oJ2VuZCcsIHJlc29sdmUpLm9uKCdlcnJvcicsIHJlamVjdClcclxuICAgICAgfSksXHJcbiAgICAgIChhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgbGV0IHBhcnROdW1iZXIgPSAxXHJcblxyXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgY2h1bmtpZXIpIHtcclxuICAgICAgICAgIGNvbnN0IG1kNSA9IGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoY2h1bmspLmRpZ2VzdCgpXHJcblxyXG4gICAgICAgICAgY29uc3Qgb2xkUGFydCA9IG9sZFBhcnRzW3BhcnROdW1iZXJdXHJcbiAgICAgICAgICBpZiAob2xkUGFydCkge1xyXG4gICAgICAgICAgICBpZiAob2xkUGFydC5ldGFnID09PSBtZDUudG9TdHJpbmcoJ2hleCcpKSB7XHJcbiAgICAgICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxyXG4gICAgICAgICAgICAgIHBhcnROdW1iZXIrK1xyXG4gICAgICAgICAgICAgIGNvbnRpbnVlXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICBwYXJ0TnVtYmVyKytcclxuXHJcbiAgICAgICAgICAvLyBub3cgc3RhcnQgdG8gdXBsb2FkIG1pc3NpbmcgcGFydFxyXG4gICAgICAgICAgY29uc3Qgb3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHtcclxuICAgICAgICAgICAgbWV0aG9kOiAnUFVUJyxcclxuICAgICAgICAgICAgcXVlcnk6IHFzLnN0cmluZ2lmeSh7IHBhcnROdW1iZXIsIHVwbG9hZElkIH0pLFxyXG4gICAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogY2h1bmsubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICdDb250ZW50LU1ENSc6IG1kNS50b1N0cmluZygnYmFzZTY0JyksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGJ1Y2tldE5hbWUsXHJcbiAgICAgICAgICAgIG9iamVjdE5hbWUsXHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIGNodW5rKVxyXG5cclxuICAgICAgICAgIGxldCBldGFnID0gcmVzcG9uc2UuaGVhZGVycy5ldGFnXHJcbiAgICAgICAgICBpZiAoZXRhZykge1xyXG4gICAgICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBldGFnID0gJydcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICBlVGFncy5wdXNoKHsgcGFydDogcGFydE51bWJlciwgZXRhZyB9KVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIGVUYWdzKVxyXG4gICAgICB9KSgpLFxyXG4gICAgXSlcclxuXHJcbiAgICByZXR1cm4gb1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxyXG4gIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSwgJycpXHJcbiAgfVxyXG5cclxuICBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpOiB2b2lkXHJcbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogUHJvbWlzZTx2b2lkPlxyXG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChyZXBsaWNhdGlvbkNvbmZpZykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVwbGljYXRpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignUm9sZSBjYW5ub3QgYmUgZW1wdHknKVxyXG4gICAgICB9IGVsc2UgaWYgKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUgJiYgIWlzU3RyaW5nKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3Igcm9sZScsIHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpXHJcbiAgICAgIH1cclxuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5ydWxlcykpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNaW5pbXVtIG9uZSByZXBsaWNhdGlvbiBydWxlIG11c3QgYmUgc3BlY2lmaWVkJylcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xyXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XHJcblxyXG4gICAgY29uc3QgcmVwbGljYXRpb25QYXJhbXNDb25maWcgPSB7XHJcbiAgICAgIFJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbjoge1xyXG4gICAgICAgIFJvbGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUsXHJcbiAgICAgICAgUnVsZTogcmVwbGljYXRpb25Db25maWcucnVsZXMsXHJcbiAgICAgIH0sXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocmVwbGljYXRpb25QYXJhbXNDb25maWcpXHJcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXHJcbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxSZXBsaWNhdGlvbkNvbmZpZz5cclxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcclxuXHJcbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcclxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWxSZXN1bHQpXHJcbiAgfVxyXG5cclxuICBnZXRPYmplY3RMZWdhbEhvbGQoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcclxuICAgIGNhbGxiYWNrPzogUmVzdWx0Q2FsbGJhY2s8TEVHQUxfSE9MRF9TVEFUVVM+LFxyXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+XHJcbiAgYXN5bmMgZ2V0T2JqZWN0TGVnYWxIb2xkKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXHJcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChnZXRPcHRzKSB7XHJcbiAgICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxyXG4gICAgICB9IGVsc2UgaWYgKE9iamVjdC5rZXlzKGdldE9wdHMpLmxlbmd0aCA+IDAgJiYgZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicsIGdldE9wdHMudmVyc2lvbklkKVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xyXG5cclxuICAgIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQpIHtcclxuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdKVxyXG4gICAgY29uc3Qgc3RyUmVzID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXHJcbiAgICByZXR1cm4gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoc3RyUmVzKVxyXG4gIH1cclxuXHJcbiAgc2V0T2JqZWN0TGVnYWxIb2xkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzZXRPcHRzPzogUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyk6IHZvaWRcclxuICBhc3luYyBzZXRPYmplY3RMZWdhbEhvbGQoXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBzZXRPcHRzID0ge1xyXG4gICAgICBzdGF0dXM6IExFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsXHJcbiAgICB9IGFzIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXHJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFpc09iamVjdChzZXRPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgaWYgKCFbTEVHQUxfSE9MRF9TVEFUVVMuRU5BQkxFRCwgTEVHQUxfSE9MRF9TVEFUVVMuRElTQUJMRURdLmluY2x1ZGVzKHNldE9wdHM/LnN0YXR1cykpIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHN0YXR1czogJyArIHNldE9wdHMuc3RhdHVzKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCAmJiAhc2V0T3B0cy52ZXJzaW9uSWQubGVuZ3RoKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JyArIHNldE9wdHMudmVyc2lvbklkKVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xyXG5cclxuICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3NldE9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb25maWcgPSB7XHJcbiAgICAgIFN0YXR1czogc2V0T3B0cy5zdGF0dXMsXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnTGVnYWxIb2xkJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cclxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcclxuICAgKi9cclxuICBhc3luYyBnZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8VGFnW10+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAndGFnZ2luZydcclxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXHJcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZVRhZ2dpbmcoYm9keSlcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqICBHZXQgdGhlIHRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgYnVja2V0IE9SIGFuIG9iamVjdFxyXG4gICAqL1xyXG4gIGFzeW5jIGdldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTxUYWdbXT4ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xyXG5cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcclxuICAgIH1cclxuICAgIGlmIChnZXRPcHRzICYmICFpc09iamVjdChnZXRPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChnZXRPcHRzICYmIGdldE9wdHMudmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cclxuICAgIGlmIChvYmplY3ROYW1lKSB7XHJcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMpXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiAgU2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cclxuICAgKi9cclxuICBhc3luYyBzZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZTogc3RyaW5nLCBwb2xpY3k6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhwb2xpY3kpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBwb2xpY3k6ICR7cG9saWN5fSAtIG11c3QgYmUgXCJzdHJpbmdcImApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xyXG5cclxuICAgIGxldCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgaWYgKHBvbGljeSkge1xyXG4gICAgICBtZXRob2QgPSAnUFVUJ1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBvbGljeSwgWzIwNF0sICcnKVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cclxuICAgKi9cclxuICBhc3luYyBnZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxyXG4gICAgcmV0dXJuIGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgfVxyXG5cclxuICBhc3luYyBwdXRPYmplY3RSZXRlbnRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJldGVudGlvbk9wdHM6IFJldGVudGlvbiA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzT2JqZWN0KHJldGVudGlvbk9wdHMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JldGVudGlvbk9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzICYmICFpc0Jvb2xlYW4ocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIGdvdmVybmFuY2VCeXBhc3M6ICR7cmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzfWApXHJcbiAgICAgIH1cclxuICAgICAgaWYgKFxyXG4gICAgICAgIHJldGVudGlvbk9wdHMubW9kZSAmJlxyXG4gICAgICAgICFbUkVURU5USU9OX01PREVTLkNPTVBMSUFOQ0UsIFJFVEVOVElPTl9NT0RFUy5HT1ZFUk5BTkNFXS5pbmNsdWRlcyhyZXRlbnRpb25PcHRzLm1vZGUpXHJcbiAgICAgICkge1xyXG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgb2JqZWN0IHJldGVudGlvbiBtb2RlOiAke3JldGVudGlvbk9wdHMubW9kZX1gKVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgcmV0YWluVW50aWxEYXRlOiAke3JldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlfWApXHJcbiAgICAgIH1cclxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciB2ZXJzaW9uSWQ6ICR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YClcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xyXG5cclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cclxuICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcclxuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnUmV0ZW50aW9uJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXHJcbiAgICBjb25zdCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxyXG5cclxuICAgIGlmIChyZXRlbnRpb25PcHRzLm1vZGUpIHtcclxuICAgICAgcGFyYW1zLk1vZGUgPSByZXRlbnRpb25PcHRzLm1vZGVcclxuICAgIH1cclxuICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkge1xyXG4gICAgICBwYXJhbXMuUmV0YWluVW50aWxEYXRlID0gcmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGVcclxuICAgIH1cclxuICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkge1xyXG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwYXJhbXMpXHJcblxyXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwLCAyMDRdKVxyXG4gIH1cclxuXHJcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBSZXN1bHRDYWxsYmFjazxPYmplY3RMb2NrSW5mbz4pOiB2b2lkXHJcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXHJcbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPE9iamVjdExvY2tJbmZvPlxyXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXHJcblxyXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcclxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbFJlc3VsdClcclxuICB9XHJcblxyXG4gIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pOiB2b2lkXHJcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPixcclxuICApOiBQcm9taXNlPHZvaWQ+XHJcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPikge1xyXG4gICAgY29uc3QgcmV0ZW50aW9uTW9kZXMgPSBbUkVURU5USU9OX01PREVTLkNPTVBMSUFOQ0UsIFJFVEVOVElPTl9NT0RFUy5HT1ZFUk5BTkNFXVxyXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxyXG5cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuXHJcbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMubW9kZSBzaG91bGQgYmUgb25lIG9mICR7cmV0ZW50aW9uTW9kZXN9YClcclxuICAgIH1cclxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnVuaXQgc2hvdWxkIGJlIG9uZSBvZiAke3ZhbGlkVW5pdHN9YClcclxuICAgIH1cclxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IHNob3VsZCBiZSBhIG51bWJlcmApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xyXG5cclxuICAgIGNvbnN0IGNvbmZpZzogT2JqZWN0TG9ja0NvbmZpZ1BhcmFtID0ge1xyXG4gICAgICBPYmplY3RMb2NrRW5hYmxlZDogJ0VuYWJsZWQnLFxyXG4gICAgfVxyXG4gICAgY29uc3QgY29uZmlnS2V5cyA9IE9iamVjdC5rZXlzKGxvY2tDb25maWdPcHRzKVxyXG5cclxuICAgIGNvbnN0IGlzQWxsS2V5c1NldCA9IFsndW5pdCcsICdtb2RlJywgJ3ZhbGlkaXR5J10uZXZlcnkoKGxjaykgPT4gY29uZmlnS2V5cy5pbmNsdWRlcyhsY2spKVxyXG4gICAgLy8gQ2hlY2sgaWYga2V5cyBhcmUgcHJlc2VudCBhbmQgYWxsIGtleXMgYXJlIHByZXNlbnQuXHJcbiAgICBpZiAoY29uZmlnS2V5cy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmICghaXNBbGxLZXlzU2V0KSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcclxuICAgICAgICAgIGBsb2NrQ29uZmlnT3B0cy5tb2RlLGxvY2tDb25maWdPcHRzLnVuaXQsbG9ja0NvbmZpZ09wdHMudmFsaWRpdHkgYWxsIHRoZSBwcm9wZXJ0aWVzIHNob3VsZCBiZSBzcGVjaWZpZWQuYCxcclxuICAgICAgICApXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uZmlnLlJ1bGUgPSB7XHJcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGxvY2tDb25maWdPcHRzLm1vZGUpIHtcclxuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTKSB7XHJcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxyXG4gICAgICAgIH0gZWxzZSBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTKSB7XHJcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLlllYXJzID0gbG9ja0NvbmZpZ09wdHMudmFsaWRpdHlcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcclxuICAgICAgcm9vdE5hbWU6ICdPYmplY3RMb2NrQ29uZmlndXJhdGlvbicsXHJcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxyXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcclxuICAgIH0pXHJcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxyXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXHJcblxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcclxuICB9XHJcblxyXG4gIGFzeW5jIGdldEJ1Y2tldFZlcnNpb25pbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbj4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXHJcblxyXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcclxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxyXG4gICAgcmV0dXJuIGF3YWl0IHhtbFBhcnNlcnMucGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnKHhtbFJlc3VsdClcclxuICB9XHJcblxyXG4gIGFzeW5jIHNldEJ1Y2tldFZlcnNpb25pbmcoYnVja2V0TmFtZTogc3RyaW5nLCB2ZXJzaW9uQ29uZmlnOiBCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFPYmplY3Qua2V5cyh2ZXJzaW9uQ29uZmlnKS5sZW5ndGgpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAndmVyc2lvbmluZydcclxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xyXG4gICAgICByb290TmFtZTogJ1ZlcnNpb25pbmdDb25maWd1cmF0aW9uJyxcclxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXHJcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxyXG4gICAgfSlcclxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHZlcnNpb25Db25maWcpXHJcblxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2V0VGFnZ2luZyh0YWdnaW5nUGFyYW1zOiBQdXRUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSA9IHRhZ2dpbmdQYXJhbXNcclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcclxuXHJcbiAgICBpZiAocHV0T3B0cyAmJiBwdXRPcHRzPy52ZXJzaW9uSWQpIHtcclxuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cHV0T3B0cy52ZXJzaW9uSWR9YFxyXG4gICAgfVxyXG4gICAgY29uc3QgdGFnc0xpc3QgPSBbXVxyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcclxuICAgICAgdGFnc0xpc3QucHVzaCh7IEtleToga2V5LCBWYWx1ZTogdmFsdWUgfSlcclxuICAgIH1cclxuICAgIGNvbnN0IHRhZ2dpbmdDb25maWcgPSB7XHJcbiAgICAgIFRhZ2dpbmc6IHtcclxuICAgICAgICBUYWdTZXQ6IHtcclxuICAgICAgICAgIFRhZzogdGFnc0xpc3QsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgIH1cclxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fSBhcyBSZXF1ZXN0SGVhZGVyc1xyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSB9KVxyXG4gICAgY29uc3QgcGF5bG9hZEJ1ZiA9IEJ1ZmZlci5mcm9tKGJ1aWxkZXIuYnVpbGRPYmplY3QodGFnZ2luZ0NvbmZpZykpXHJcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHtcclxuICAgICAgbWV0aG9kLFxyXG4gICAgICBidWNrZXROYW1lLFxyXG4gICAgICBxdWVyeSxcclxuICAgICAgaGVhZGVycyxcclxuXHJcbiAgICAgIC4uLihvYmplY3ROYW1lICYmIHsgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSB9KSxcclxuICAgIH1cclxuXHJcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZEJ1ZilcclxuXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkQnVmKVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cyB9OiBSZW1vdmVUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXHJcblxyXG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmIHJlbW92ZU9wdHMudmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcclxuICAgIH1cclxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH1cclxuXHJcbiAgICBpZiAob2JqZWN0TmFtZSkge1xyXG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxyXG4gICAgfVxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMCwgMjA0XSlcclxuICB9XHJcblxyXG4gIGFzeW5jIHNldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCB0YWdzOiBUYWdzKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzUGxhaW5PYmplY3QodGFncykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdtYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCB0YWdzIH0pXHJcbiAgfVxyXG5cclxuICBhc3luYyByZW1vdmVCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgYXdhaXQgdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSB9KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdGFnczogVGFncywgcHV0T3B0cz86IFRhZ2dpbmdPcHRzKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHRhZ3MpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlT2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0czogVGFnZ2luZ09wdHMpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcclxuICAgIH1cclxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzIH0pXHJcbiAgfVxyXG5cclxuICBhc3luYyBzZWxlY3RPYmplY3RDb250ZW50KFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgc2VsZWN0T3B0czogU2VsZWN0T3B0aW9ucyxcclxuICApOiBQcm9taXNlPFNlbGVjdFJlc3VsdHMgfCB1bmRlZmluZWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghXy5pc0VtcHR5KHNlbGVjdE9wdHMpKSB7XHJcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NxbEV4cHJlc3Npb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XHJcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcclxuICAgICAgfVxyXG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XHJcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSBgc2VsZWN0JnNlbGVjdC10eXBlPTJgXHJcblxyXG4gICAgY29uc3QgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgRXhwcmVzc2lvbjogc2VsZWN0T3B0cy5leHByZXNzaW9uLFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgRXhwcmVzc2lvblR5cGU6IHNlbGVjdE9wdHMuZXhwcmVzc2lvblR5cGUgfHwgJ1NRTCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBJbnB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbl0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBPdXRwdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uXSxcclxuICAgICAgfSxcclxuICAgIF1cclxuXHJcbiAgICAvLyBPcHRpb25hbFxyXG4gICAgaWYgKHNlbGVjdE9wdHMucmVxdWVzdFByb2dyZXNzKSB7XHJcbiAgICAgIGNvbmZpZy5wdXNoKHsgUmVxdWVzdFByb2dyZXNzOiBzZWxlY3RPcHRzPy5yZXF1ZXN0UHJvZ3Jlc3MgfSlcclxuICAgIH1cclxuICAgIC8vIE9wdGlvbmFsXHJcbiAgICBpZiAoc2VsZWN0T3B0cy5zY2FuUmFuZ2UpIHtcclxuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XHJcbiAgICAgIHJvb3ROYW1lOiAnU2VsZWN0T2JqZWN0Q29udGVudFJlcXVlc3QnLFxyXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcclxuICAgICAgaGVhZGxlc3M6IHRydWUsXHJcbiAgICB9KVxyXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxyXG4gICAgcmV0dXJuIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGJvZHkpXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5Q29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcclxuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcclxuXHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XHJcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcclxuICAgICAgcm9vdE5hbWU6ICdMaWZlY3ljbGVDb25maWd1cmF0aW9uJyxcclxuICAgICAgaGVhZGxlc3M6IHRydWUsXHJcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxyXG4gICAgfSlcclxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBvbGljeUNvbmZpZylcclxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXHJcbiAgfVxyXG5cclxuICBhc3luYyByZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgbGlmZUN5Y2xlQ29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKF8uaXNFbXB0eShsaWZlQ3ljbGVDb25maWcpKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUpXHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBhd2FpdCB0aGlzLmFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGxpZmVDeWNsZUNvbmZpZylcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPExpZmVjeWNsZUNvbmZpZyB8IG51bGw+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXHJcblxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpZmVjeWNsZUNvbmZpZyhib2R5KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGVuY3J5cHRpb25Db25maWc/OiBFbmNyeXB0aW9uQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIV8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSAmJiBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUubGVuZ3RoID4gMSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIFJ1bGUgbGVuZ3RoLiBPbmx5IG9uZSBydWxlIGlzIGFsbG93ZWQuOiAnICsgZW5jcnlwdGlvbkNvbmZpZy5SdWxlKVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBlbmNyeXB0aW9uT2JqID0gZW5jcnlwdGlvbkNvbmZpZ1xyXG4gICAgaWYgKF8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSkge1xyXG4gICAgICBlbmNyeXB0aW9uT2JqID0ge1xyXG4gICAgICAgIC8vIERlZmF1bHQgTWluSU8gU2VydmVyIFN1cHBvcnRlZCBSdWxlXHJcbiAgICAgICAgUnVsZTogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XHJcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xyXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XHJcbiAgICAgIHJvb3ROYW1lOiAnU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcclxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXHJcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxyXG4gICAgfSlcclxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGVuY3J5cHRpb25PYmopXHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxyXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXHJcblxyXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcclxuICB9XHJcblxyXG4gIGFzeW5jIGdldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcclxuXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcclxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyhib2R5KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlQnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXHJcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xyXG5cclxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcclxuICB9XHJcblxyXG4gIGFzeW5jIGdldE9iamVjdFJldGVudGlvbihcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RSZXRlbnRpb25PcHRzLFxyXG4gICk6IFByb21pc2U8T2JqZWN0UmV0ZW50aW9uSW5mbyB8IG51bGwgfCB1bmRlZmluZWQ+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmIChnZXRPcHRzICYmICFpc09iamVjdChnZXRPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfSBlbHNlIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcclxuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXHJcbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XHJcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxyXG4gICAgfVxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyhib2R5KVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlT2JqZWN0cyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdHNMaXN0OiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2JqZWN0c0xpc3QpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ29iamVjdHNMaXN0IHNob3VsZCBiZSBhIGxpc3QnKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJ1bkRlbGV0ZU9iamVjdHMgPSBhc3luYyAoYmF0Y2g6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+ID0+IHtcclxuICAgICAgY29uc3QgZGVsT2JqZWN0czogUmVtb3ZlT2JqZWN0c1JlcXVlc3RFbnRyeVtdID0gYmF0Y2gubWFwKCh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBpc09iamVjdCh2YWx1ZSkgPyB7IEtleTogdmFsdWUubmFtZSwgVmVyc2lvbklkOiB2YWx1ZS52ZXJzaW9uSWQgfSA6IHsgS2V5OiB2YWx1ZSB9XHJcbiAgICAgIH0pXHJcblxyXG4gICAgICBjb25zdCByZW1PYmplY3RzID0geyBEZWxldGU6IHsgUXVpZXQ6IHRydWUsIE9iamVjdDogZGVsT2JqZWN0cyB9IH1cclxuICAgICAgY29uc3QgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlIH0pLmJ1aWxkT2JqZWN0KHJlbU9iamVjdHMpKVxyXG4gICAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHsgJ0NvbnRlbnQtTUQ1JzogdG9NZDUocGF5bG9hZCkgfVxyXG5cclxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kOiAnUE9TVCcsIGJ1Y2tldE5hbWUsIHF1ZXJ5OiAnZGVsZXRlJywgaGVhZGVycyB9LCBwYXlsb2FkKVxyXG4gICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcclxuICAgICAgcmV0dXJuIHhtbFBhcnNlcnMucmVtb3ZlT2JqZWN0c1BhcnNlcihib2R5KVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwIC8vIG1heCBlbnRyaWVzIGFjY2VwdGVkIGluIHNlcnZlciBmb3IgRGVsZXRlTXVsdGlwbGVPYmplY3RzIEFQSS5cclxuICAgIC8vIENsaWVudCBzaWRlIGJhdGNoaW5nXHJcbiAgICBjb25zdCBiYXRjaGVzID0gW11cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb2JqZWN0c0xpc3QubGVuZ3RoOyBpICs9IG1heEVudHJpZXMpIHtcclxuICAgICAgYmF0Y2hlcy5wdXNoKG9iamVjdHNMaXN0LnNsaWNlKGksIGkgKyBtYXhFbnRyaWVzKSlcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBiYXRjaFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChiYXRjaGVzLm1hcChydW5EZWxldGVPYmplY3RzKSlcclxuICAgIHJldHVybiBiYXRjaFJlc3VsdHMuZmxhdCgpXHJcbiAgfVxyXG5cclxuICBhc3luYyByZW1vdmVJbmNvbXBsZXRlVXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSXNWYWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBjb25zdCByZW1vdmVVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXHJcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xyXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHtyZW1vdmVVcGxvYWRJZH1gXHJcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMShcclxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIHRhcmdldE9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBjb25kaXRpb25zPzogbnVsbCB8IENvcHlDb25kaXRpb25zLFxyXG4gICkge1xyXG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09ICdmdW5jdGlvbicpIHtcclxuICAgICAgY29uZGl0aW9ucyA9IG51bGxcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKHRhcmdldEJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIHRhcmdldEJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKHRhcmdldE9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHt0YXJnZXRPYmplY3ROYW1lfWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmIChzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEVtcHR5IHNvdXJjZSBwcmVmaXhgKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChjb25kaXRpb25zICE9IG51bGwgJiYgIShjb25kaXRpb25zIGluc3RhbmNlb2YgQ29weUNvbmRpdGlvbnMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XHJcbiAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gdXJpUmVzb3VyY2VFc2NhcGUoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUpXHJcblxyXG4gICAgaWYgKGNvbmRpdGlvbnMpIHtcclxuICAgICAgaWYgKGNvbmRpdGlvbnMubW9kaWZpZWQgIT09ICcnKSB7XHJcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMubW9kaWZpZWRcclxuICAgICAgfVxyXG4gICAgICBpZiAoY29uZGl0aW9ucy51bm1vZGlmaWVkICE9PSAnJykge1xyXG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLXVubW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMudW5tb2RpZmllZFxyXG4gICAgICB9XHJcbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRVRhZyAhPT0gJycpIHtcclxuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdcclxuICAgICAgfVxyXG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHQgIT09ICcnKSB7XHJcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbm9uZS1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHRcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXHJcblxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHtcclxuICAgICAgbWV0aG9kLFxyXG4gICAgICBidWNrZXROYW1lOiB0YXJnZXRCdWNrZXROYW1lLFxyXG4gICAgICBvYmplY3ROYW1lOiB0YXJnZXRPYmplY3ROYW1lLFxyXG4gICAgICBoZWFkZXJzLFxyXG4gICAgfSlcclxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxyXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMihcclxuICAgIHNvdXJjZUNvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMsXHJcbiAgICBkZXN0Q29uZmlnOiBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxyXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdFYyPiB7XHJcbiAgICBpZiAoIShzb3VyY2VDb25maWcgaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlTb3VyY2VPcHRpb25zICcpXHJcbiAgICB9XHJcbiAgICBpZiAoIShkZXN0Q29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXHJcbiAgICB9XHJcbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xyXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoKVxyXG4gICAgfVxyXG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcclxuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KClcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmFzc2lnbih7fSwgc291cmNlQ29uZmlnLmdldEhlYWRlcnMoKSwgZGVzdENvbmZpZy5nZXRIZWFkZXJzKCkpXHJcblxyXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IGRlc3RDb25maWcuQnVja2V0XHJcbiAgICBjb25zdCBvYmplY3ROYW1lID0gZGVzdENvbmZpZy5PYmplY3RcclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG5cclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9KVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICBjb25zdCBjb3B5UmVzID0geG1sUGFyc2Vycy5wYXJzZUNvcHlPYmplY3QoYm9keSlcclxuICAgIGNvbnN0IHJlc0hlYWRlcnM6IEluY29taW5nSHR0cEhlYWRlcnMgPSByZXMuaGVhZGVyc1xyXG5cclxuICAgIGNvbnN0IHNpemVIZWFkZXJWYWx1ZSA9IHJlc0hlYWRlcnMgJiYgcmVzSGVhZGVyc1snY29udGVudC1sZW5ndGgnXVxyXG4gICAgY29uc3Qgc2l6ZSA9IHR5cGVvZiBzaXplSGVhZGVyVmFsdWUgPT09ICdudW1iZXInID8gc2l6ZUhlYWRlclZhbHVlIDogdW5kZWZpbmVkXHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgQnVja2V0OiBkZXN0Q29uZmlnLkJ1Y2tldCxcclxuICAgICAgS2V5OiBkZXN0Q29uZmlnLk9iamVjdCxcclxuICAgICAgTGFzdE1vZGlmaWVkOiBjb3B5UmVzLmxhc3RNb2RpZmllZCxcclxuICAgICAgTWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcclxuICAgICAgVmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXHJcbiAgICAgIFNvdXJjZVZlcnNpb25JZDogZ2V0U291cmNlVmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxyXG4gICAgICBFdGFnOiBzYW5pdGl6ZUVUYWcocmVzSGVhZGVycy5ldGFnKSxcclxuICAgICAgU2l6ZTogc2l6ZSxcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGNvcHlPYmplY3Qoc291cmNlOiBDb3B5U291cmNlT3B0aW9ucywgZGVzdDogQ29weURlc3RpbmF0aW9uT3B0aW9ucyk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD5cclxuICBhc3luYyBjb3B5T2JqZWN0KFxyXG4gICAgdGFyZ2V0QnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgdGFyZ2V0T2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcclxuICAgIGNvbmRpdGlvbnM/OiBDb3B5Q29uZGl0aW9ucyxcclxuICApOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+XHJcbiAgYXN5bmMgY29weU9iamVjdCguLi5hbGxBcmdzOiBDb3B5T2JqZWN0UGFyYW1zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PiB7XHJcbiAgICBpZiAodHlwZW9mIGFsbEFyZ3NbMF0gPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGNvbnN0IFt0YXJnZXRCdWNrZXROYW1lLCB0YXJnZXRPYmplY3ROYW1lLCBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSwgY29uZGl0aW9uc10gPSBhbGxBcmdzIGFzIFtcclxuICAgICAgICBzdHJpbmcsXHJcbiAgICAgICAgc3RyaW5nLFxyXG4gICAgICAgIHN0cmluZyxcclxuICAgICAgICBDb3B5Q29uZGl0aW9ucz8sXHJcbiAgICAgIF1cclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdFYxKHRhcmdldEJ1Y2tldE5hbWUsIHRhcmdldE9iamVjdE5hbWUsIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lLCBjb25kaXRpb25zKVxyXG4gICAgfVxyXG4gICAgY29uc3QgW3NvdXJjZSwgZGVzdF0gPSBhbGxBcmdzIGFzIFtDb3B5U291cmNlT3B0aW9ucywgQ29weURlc3RpbmF0aW9uT3B0aW9uc11cclxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3RWMihzb3VyY2UsIGRlc3QpXHJcbiAgfVxyXG5cclxuICBhc3luYyB1cGxvYWRQYXJ0KFxyXG4gICAgcGFydENvbmZpZzoge1xyXG4gICAgICBidWNrZXROYW1lOiBzdHJpbmdcclxuICAgICAgb2JqZWN0TmFtZTogc3RyaW5nXHJcbiAgICAgIHVwbG9hZElEOiBzdHJpbmdcclxuICAgICAgcGFydE51bWJlcjogbnVtYmVyXHJcbiAgICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzXHJcbiAgICB9LFxyXG4gICAgcGF5bG9hZD86IEJpbmFyeSxcclxuICApIHtcclxuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSUQsIHBhcnROdW1iZXIsIGhlYWRlcnMgfSA9IHBhcnRDb25maWdcclxuXHJcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xyXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJRH0mcGFydE51bWJlcj0ke3BhcnROdW1iZXJ9YFxyXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkKVxyXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXHJcbiAgICBjb25zdCBwYXJ0UmVzID0gdXBsb2FkUGFydFBhcnNlcihib2R5KVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHBhcnRSZXMuRVRhZyksXHJcbiAgICAgIGtleTogb2JqZWN0TmFtZSxcclxuICAgICAgcGFydDogcGFydE51bWJlcixcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGNvbXBvc2VPYmplY3QoXHJcbiAgICBkZXN0T2JqQ29uZmlnOiBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxyXG4gICAgc291cmNlT2JqTGlzdDogQ29weVNvdXJjZU9wdGlvbnNbXSxcclxuICApOiBQcm9taXNlPGJvb2xlYW4gfCB7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0gfCBQcm9taXNlPHZvaWQ+IHwgQ29weU9iamVjdFJlc3VsdD4ge1xyXG4gICAgY29uc3Qgc291cmNlRmlsZXNMZW5ndGggPSBzb3VyY2VPYmpMaXN0Lmxlbmd0aFxyXG5cclxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIGFuIGFycmF5IG9mIENvcHlTb3VyY2VPcHRpb25zICcpXHJcbiAgICB9XHJcbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNvdXJjZUZpbGVzTGVuZ3RoIDwgMSB8fCBzb3VyY2VGaWxlc0xlbmd0aCA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXHJcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXHJcbiAgICAgIClcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcclxuICAgICAgY29uc3Qgc09iaiA9IHNvdXJjZU9iakxpc3RbaV0gYXMgQ29weVNvdXJjZU9wdGlvbnNcclxuICAgICAgaWYgKCFzT2JqLnZhbGlkYXRlKCkpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2VcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmICghKGRlc3RPYmpDb25maWcgYXMgQ29weURlc3RpbmF0aW9uT3B0aW9ucykudmFsaWRhdGUoKSkge1xyXG4gICAgICByZXR1cm4gZmFsc2VcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zKSA9PiB7XHJcbiAgICAgIGxldCBzdGF0T3B0cyA9IHt9XHJcbiAgICAgIGlmICghXy5pc0VtcHR5KHNyY0NvbmZpZy5WZXJzaW9uSUQpKSB7XHJcbiAgICAgICAgc3RhdE9wdHMgPSB7XHJcbiAgICAgICAgICB2ZXJzaW9uSWQ6IHNyY0NvbmZpZy5WZXJzaW9uSUQsXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBzdGF0T3B0c1xyXG4gICAgfVxyXG4gICAgY29uc3Qgc3JjT2JqZWN0U2l6ZXM6IG51bWJlcltdID0gW11cclxuICAgIGxldCB0b3RhbFNpemUgPSAwXHJcbiAgICBsZXQgdG90YWxQYXJ0cyA9IDBcclxuXHJcbiAgICBjb25zdCBzb3VyY2VPYmpTdGF0cyA9IHNvdXJjZU9iakxpc3QubWFwKChzcmNJdGVtKSA9PlxyXG4gICAgICB0aGlzLnN0YXRPYmplY3Qoc3JjSXRlbS5CdWNrZXQsIHNyY0l0ZW0uT2JqZWN0LCBnZXRTdGF0T3B0aW9ucyhzcmNJdGVtKSksXHJcbiAgICApXHJcblxyXG4gICAgY29uc3Qgc3JjT2JqZWN0SW5mb3MgPSBhd2FpdCBQcm9taXNlLmFsbChzb3VyY2VPYmpTdGF0cylcclxuXHJcbiAgICBjb25zdCB2YWxpZGF0ZWRTdGF0cyA9IHNyY09iamVjdEluZm9zLm1hcCgocmVzSXRlbVN0YXQsIGluZGV4KSA9PiB7XHJcbiAgICAgIGNvbnN0IHNyY0NvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMgfCB1bmRlZmluZWQgPSBzb3VyY2VPYmpMaXN0W2luZGV4XVxyXG5cclxuICAgICAgbGV0IHNyY0NvcHlTaXplID0gcmVzSXRlbVN0YXQuc2l6ZVxyXG4gICAgICAvLyBDaGVjayBpZiBhIHNlZ21lbnQgaXMgc3BlY2lmaWVkLCBhbmQgaWYgc28sIGlzIHRoZVxyXG4gICAgICAvLyBzZWdtZW50IHdpdGhpbiBvYmplY3QgYm91bmRzP1xyXG4gICAgICBpZiAoc3JjQ29uZmlnICYmIHNyY0NvbmZpZy5NYXRjaFJhbmdlKSB7XHJcbiAgICAgICAgLy8gU2luY2UgcmFuZ2UgaXMgc3BlY2lmaWVkLFxyXG4gICAgICAgIC8vICAgIDAgPD0gc3JjLnNyY1N0YXJ0IDw9IHNyYy5zcmNFbmRcclxuICAgICAgICAvLyBzbyBvbmx5IGludmFsaWQgY2FzZSB0byBjaGVjayBpczpcclxuICAgICAgICBjb25zdCBzcmNTdGFydCA9IHNyY0NvbmZpZy5TdGFydFxyXG4gICAgICAgIGNvbnN0IHNyY0VuZCA9IHNyY0NvbmZpZy5FbmRcclxuICAgICAgICBpZiAoc3JjRW5kID49IHNyY0NvcHlTaXplIHx8IHNyY1N0YXJ0IDwgMCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGhhcyBpbnZhbGlkIHNlZ21lbnQtdG8tY29weSBbJHtzcmNTdGFydH0sICR7c3JjRW5kfV0gKHNpemUgaXMgJHtzcmNDb3B5U2l6ZX0pYCxcclxuICAgICAgICAgIClcclxuICAgICAgICB9XHJcbiAgICAgICAgc3JjQ29weVNpemUgPSBzcmNFbmQgLSBzcmNTdGFydCArIDFcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXHJcbiAgICAgIGlmIChzcmNDb3B5U2l6ZSA8IFBBUlRfQ09OU1RSQUlOVFMuQUJTX01JTl9QQVJUX1NJWkUgJiYgaW5kZXggPCBzb3VyY2VGaWxlc0xlbmd0aCAtIDEpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxyXG4gICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxyXG4gICAgICAgIClcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gSXMgZGF0YSB0byBjb3B5IHRvbyBsYXJnZT9cclxuICAgICAgdG90YWxTaXplICs9IHNyY0NvcHlTaXplXHJcbiAgICAgIGlmICh0b3RhbFNpemUgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgQ2Fubm90IGNvbXBvc2UgYW4gb2JqZWN0IG9mIHNpemUgJHt0b3RhbFNpemV9ICg+IDVUaUIpYClcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gcmVjb3JkIHNvdXJjZSBzaXplXHJcbiAgICAgIHNyY09iamVjdFNpemVzW2luZGV4XSA9IHNyY0NvcHlTaXplXHJcblxyXG4gICAgICAvLyBjYWxjdWxhdGUgcGFydHMgbmVlZGVkIGZvciBjdXJyZW50IHNvdXJjZVxyXG4gICAgICB0b3RhbFBhcnRzICs9IHBhcnRzUmVxdWlyZWQoc3JjQ29weVNpemUpXHJcbiAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xyXG4gICAgICBpZiAodG90YWxQYXJ0cyA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcclxuICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXHJcbiAgICAgICAgKVxyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcmVzSXRlbVN0YXRcclxuICAgIH0pXHJcblxyXG4gICAgaWYgKCh0b3RhbFBhcnRzID09PSAxICYmIHRvdGFsU2l6ZSA8PSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUX1NJWkUpIHx8IHRvdGFsU2l6ZSA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0KHNvdXJjZU9iakxpc3RbMF0gYXMgQ29weVNvdXJjZU9wdGlvbnMsIGRlc3RPYmpDb25maWcpIC8vIHVzZSBjb3B5T2JqZWN0VjJcclxuICAgIH1cclxuXHJcbiAgICAvLyBwcmVzZXJ2ZSBldGFnIHRvIGF2b2lkIG1vZGlmaWNhdGlvbiBvZiBvYmplY3Qgd2hpbGUgY29weWluZy5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xyXG4gICAgICA7KHNvdXJjZU9iakxpc3RbaV0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLk1hdGNoRVRhZyA9ICh2YWxpZGF0ZWRTdGF0c1tpXSBhcyBCdWNrZXRJdGVtU3RhdCkuZXRhZ1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNwbGl0UGFydFNpemVMaXN0ID0gdmFsaWRhdGVkU3RhdHMubWFwKChyZXNJdGVtU3RhdCwgaWR4KSA9PiB7XHJcbiAgICAgIHJldHVybiBjYWxjdWxhdGVFdmVuU3BsaXRzKHNyY09iamVjdFNpemVzW2lkeF0gYXMgbnVtYmVyLCBzb3VyY2VPYmpMaXN0W2lkeF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpXHJcbiAgICB9KVxyXG5cclxuICAgIGNvbnN0IGdldFVwbG9hZFBhcnRDb25maWdMaXN0ID0gKHVwbG9hZElkOiBzdHJpbmcpID0+IHtcclxuICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZ0xpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSA9IFtdXHJcblxyXG4gICAgICBzcGxpdFBhcnRTaXplTGlzdC5mb3JFYWNoKChzcGxpdFNpemUsIHNwbGl0SW5kZXg6IG51bWJlcikgPT4ge1xyXG4gICAgICAgIGlmIChzcGxpdFNpemUpIHtcclxuICAgICAgICAgIGNvbnN0IHsgc3RhcnRJbmRleDogc3RhcnRJZHgsIGVuZEluZGV4OiBlbmRJZHgsIG9iakluZm86IG9iakNvbmZpZyB9ID0gc3BsaXRTaXplXHJcblxyXG4gICAgICAgICAgY29uc3QgcGFydEluZGV4ID0gc3BsaXRJbmRleCArIDEgLy8gcGFydCBpbmRleCBzdGFydHMgZnJvbSAxLlxyXG4gICAgICAgICAgY29uc3QgdG90YWxVcGxvYWRzID0gQXJyYXkuZnJvbShzdGFydElkeClcclxuXHJcbiAgICAgICAgICBjb25zdCBoZWFkZXJzID0gKHNvdXJjZU9iakxpc3Rbc3BsaXRJbmRleF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLmdldEhlYWRlcnMoKVxyXG5cclxuICAgICAgICAgIHRvdGFsVXBsb2Fkcy5mb3JFYWNoKChzcGxpdFN0YXJ0LCB1cGxkQ3RySWR4KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXHJcblxyXG4gICAgICAgICAgICBjb25zdCBzb3VyY2VPYmogPSBgJHtvYmpDb25maWcuQnVja2V0fS8ke29iakNvbmZpZy5PYmplY3R9YFxyXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gYCR7c291cmNlT2JqfWBcclxuICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtcmFuZ2UnXSA9IGBieXRlcz0ke3NwbGl0U3RhcnR9LSR7c3BsaXRFbmR9YFxyXG5cclxuICAgICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZyA9IHtcclxuICAgICAgICAgICAgICBidWNrZXROYW1lOiBkZXN0T2JqQ29uZmlnLkJ1Y2tldCxcclxuICAgICAgICAgICAgICBvYmplY3ROYW1lOiBkZXN0T2JqQ29uZmlnLk9iamVjdCxcclxuICAgICAgICAgICAgICB1cGxvYWRJRDogdXBsb2FkSWQsXHJcbiAgICAgICAgICAgICAgcGFydE51bWJlcjogcGFydEluZGV4LFxyXG4gICAgICAgICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXHJcbiAgICAgICAgICAgICAgc291cmNlT2JqOiBzb3VyY2VPYmosXHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG5cclxuICAgICAgcmV0dXJuIHVwbG9hZFBhcnRDb25maWdMaXN0XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdXBsb2FkQWxsUGFydHMgPSBhc3luYyAodXBsb2FkTGlzdDogVXBsb2FkUGFydENvbmZpZ1tdKSA9PiB7XHJcbiAgICAgIGNvbnN0IHBhcnRVcGxvYWRzID0gdXBsb2FkTGlzdC5tYXAoYXN5bmMgKGl0ZW0pID0+IHtcclxuICAgICAgICByZXR1cm4gdGhpcy51cGxvYWRQYXJ0KGl0ZW0pXHJcbiAgICAgIH0pXHJcbiAgICAgIC8vIFByb2Nlc3MgcmVzdWx0cyBoZXJlIGlmIG5lZWRlZFxyXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwocGFydFVwbG9hZHMpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGVyZm9ybVVwbG9hZFBhcnRzID0gYXN5bmMgKHVwbG9hZElkOiBzdHJpbmcpID0+IHtcclxuICAgICAgY29uc3QgdXBsb2FkTGlzdCA9IGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKVxyXG4gICAgICBjb25zdCBwYXJ0c1JlcyA9IGF3YWl0IHVwbG9hZEFsbFBhcnRzKHVwbG9hZExpc3QpXHJcbiAgICAgIHJldHVybiBwYXJ0c1Jlcy5tYXAoKHBhcnRDb3B5KSA9PiAoeyBldGFnOiBwYXJ0Q29weS5ldGFnLCBwYXJ0OiBwYXJ0Q29weS5wYXJ0IH0pKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5ld1VwbG9hZEhlYWRlcnMgPSBkZXN0T2JqQ29uZmlnLmdldEhlYWRlcnMoKVxyXG5cclxuICAgIGNvbnN0IHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIG5ld1VwbG9hZEhlYWRlcnMpXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBwYXJ0c0RvbmUgPSBhd2FpdCBwZXJmb3JtVXBsb2FkUGFydHModXBsb2FkSWQpXHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSlcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hYm9ydE11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkKVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJlc2lnbmVkVXJsKFxyXG4gICAgbWV0aG9kOiBzdHJpbmcsXHJcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXHJcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXHJcbiAgICBleHBpcmVzPzogbnVtYmVyIHwgUHJlU2lnblJlcXVlc3RQYXJhbXMgfCB1bmRlZmluZWQsXHJcbiAgICByZXFQYXJhbXM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXHJcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXHJcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGlmICh0aGlzLmFub255bW91cykge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcihgUHJlc2lnbmVkICR7bWV0aG9kfSB1cmwgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzYClcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWV4cGlyZXMpIHtcclxuICAgICAgZXhwaXJlcyA9IFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYXHJcbiAgICB9XHJcbiAgICBpZiAoIXJlcVBhcmFtcykge1xyXG4gICAgICByZXFQYXJhbXMgPSB7fVxyXG4gICAgfVxyXG4gICAgaWYgKCFyZXF1ZXN0RGF0ZSkge1xyXG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcclxuICAgIH1cclxuXHJcbiAgICAvLyBUeXBlIGFzc2VydGlvbnNcclxuICAgIGlmIChleHBpcmVzICYmIHR5cGVvZiBleHBpcmVzICE9PSAnbnVtYmVyJykge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdleHBpcmVzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKHJlcVBhcmFtcyAmJiB0eXBlb2YgcmVxUGFyYW1zICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFQYXJhbXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoKHJlcXVlc3REYXRlICYmICEocmVxdWVzdERhdGUgaW5zdGFuY2VvZiBEYXRlKSkgfHwgKHJlcXVlc3REYXRlICYmIGlzTmFOKHJlcXVlc3REYXRlPy5nZXRUaW1lKCkpKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0RGF0ZSBzaG91bGQgYmUgb2YgdHlwZSBcIkRhdGVcIiBhbmQgdmFsaWQnKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxUGFyYW1zID8gcXMuc3RyaW5naWZ5KHJlcVBhcmFtcykgOiB1bmRlZmluZWRcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXHJcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxyXG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IG1ldGhvZCwgcmVnaW9uLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxyXG5cclxuICAgICAgcmV0dXJuIHByZXNpZ25TaWduYXR1cmVWNChcclxuICAgICAgICByZXFPcHRpb25zLFxyXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5LFxyXG4gICAgICAgIHRoaXMuc2VjcmV0S2V5LFxyXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuLFxyXG4gICAgICAgIHJlZ2lvbixcclxuICAgICAgICByZXF1ZXN0RGF0ZSxcclxuICAgICAgICBleHBpcmVzLFxyXG4gICAgICApXHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRocm93IGVyclxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJlc2lnbmVkR2V0T2JqZWN0KFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxyXG4gICAgZXhwaXJlcz86IG51bWJlcixcclxuICAgIHJlc3BIZWFkZXJzPzogUHJlU2lnblJlcXVlc3RQYXJhbXMgfCBEYXRlLFxyXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxyXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdmFsaWRSZXNwSGVhZGVycyA9IFtcclxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtdHlwZScsXHJcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWxhbmd1YWdlJyxcclxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxyXG4gICAgICAncmVzcG9uc2UtY2FjaGUtY29udHJvbCcsXHJcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWRpc3Bvc2l0aW9uJyxcclxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxyXG4gICAgXVxyXG4gICAgdmFsaWRSZXNwSGVhZGVycy5mb3JFYWNoKChoZWFkZXIpID0+IHtcclxuICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICBpZiAocmVzcEhlYWRlcnMgIT09IHVuZGVmaW5lZCAmJiByZXNwSGVhZGVyc1toZWFkZXJdICE9PSB1bmRlZmluZWQgJiYgIWlzU3RyaW5nKHJlc3BIZWFkZXJzW2hlYWRlcl0pKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgcmVzcG9uc2UgaGVhZGVyICR7aGVhZGVyfSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiYClcclxuICAgICAgfVxyXG4gICAgfSlcclxuICAgIHJldHVybiB0aGlzLnByZXNpZ25lZFVybCgnR0VUJywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVzcEhlYWRlcnMsIHJlcXVlc3REYXRlKVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJlc2lnbmVkUHV0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBleHBpcmVzPzogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ1BVVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMpXHJcbiAgfVxyXG5cclxuICBuZXdQb3N0UG9saWN5KCk6IFBvc3RQb2xpY3kge1xyXG4gICAgcmV0dXJuIG5ldyBQb3N0UG9saWN5KClcclxuICB9XHJcblxyXG4gIGFzeW5jIHByZXNpZ25lZFBvc3RQb2xpY3kocG9zdFBvbGljeTogUG9zdFBvbGljeSk6IFByb21pc2U8UG9zdFBvbGljeVJlc3VsdD4ge1xyXG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgUE9TVCBwb2xpY3kgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzJylcclxuICAgIH1cclxuICAgIGlmICghaXNPYmplY3QocG9zdFBvbGljeSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncG9zdFBvbGljeSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcclxuICAgIH1cclxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCBhcyBzdHJpbmdcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IGF3YWl0IHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSlcclxuXHJcbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXHJcbiAgICAgIGNvbnN0IGRhdGVTdHIgPSBtYWtlRGF0ZUxvbmcoZGF0ZSlcclxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXHJcblxyXG4gICAgICBpZiAoIXBvc3RQb2xpY3kucG9saWN5LmV4cGlyYXRpb24pIHtcclxuICAgICAgICAvLyAnZXhwaXJhdGlvbicgaXMgbWFuZGF0b3J5IGZpZWxkIGZvciBTMy5cclxuICAgICAgICAvLyBTZXQgZGVmYXVsdCBleHBpcmF0aW9uIGRhdGUgb2YgNyBkYXlzLlxyXG4gICAgICAgIGNvbnN0IGV4cGlyZXMgPSBuZXcgRGF0ZSgpXHJcbiAgICAgICAgZXhwaXJlcy5zZXRTZWNvbmRzKFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYKVxyXG4gICAgICAgIHBvc3RQb2xpY3kuc2V0RXhwaXJlcyhleHBpcmVzKVxyXG4gICAgICB9XHJcblxyXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotZGF0ZScsIGRhdGVTdHJdKVxyXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1kYXRlJ10gPSBkYXRlU3RyXHJcblxyXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotYWxnb3JpdGhtJywgJ0FXUzQtSE1BQy1TSEEyNTYnXSlcclxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotYWxnb3JpdGhtJ10gPSAnQVdTNC1ITUFDLVNIQTI1NidcclxuXHJcbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1jcmVkZW50aWFsJywgdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXSlcclxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotY3JlZGVudGlhbCddID0gdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXHJcblxyXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcclxuICAgICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotc2VjdXJpdHktdG9rZW4nLCB0aGlzLnNlc3Npb25Ub2tlbl0pXHJcbiAgICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHBvbGljeUJhc2U2NCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBvc3RQb2xpY3kucG9saWN5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXHJcblxyXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhLnBvbGljeSA9IHBvbGljeUJhc2U2NFxyXG5cclxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2lnbmF0dXJlJ10gPSBwb3N0UHJlc2lnblNpZ25hdHVyZVY0KHJlZ2lvbiwgZGF0ZSwgdGhpcy5zZWNyZXRLZXksIHBvbGljeUJhc2U2NClcclxuICAgICAgY29uc3Qgb3B0cyA9IHtcclxuICAgICAgICByZWdpb246IHJlZ2lvbixcclxuICAgICAgICBidWNrZXROYW1lOiBidWNrZXROYW1lLFxyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKG9wdHMpXHJcbiAgICAgIGNvbnN0IHBvcnRTdHIgPSB0aGlzLnBvcnQgPT0gODAgfHwgdGhpcy5wb3J0ID09PSA0NDMgPyAnJyA6IGA6JHt0aGlzLnBvcnQudG9TdHJpbmcoKX1gXHJcbiAgICAgIGNvbnN0IHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxyXG4gICAgICByZXR1cm4geyBwb3N0VVJMOiB1cmxTdHIsIGZvcm1EYXRhOiBwb3N0UG9saWN5LmZvcm1EYXRhIH1cclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IpIHtcclxuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBVbmFibGUgdG8gZ2V0IGJ1Y2tldCByZWdpb24gZm9yICR7YnVja2V0TmFtZX0uYClcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhyb3cgZXJyXHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIGxpc3QgYSBiYXRjaCBvZiBvYmplY3RzXHJcbiAgYXN5bmMgbGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lOiBzdHJpbmcsIHByZWZpeD86IHN0cmluZywgbWFya2VyPzogc3RyaW5nLCBsaXN0UXVlcnlPcHRzPzogTGlzdE9iamVjdFF1ZXJ5T3B0cykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmIChtYXJrZXIgJiYgIWlzU3RyaW5nKG1hcmtlcikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChsaXN0UXVlcnlPcHRzICYmICFpc09iamVjdChsaXN0UXVlcnlPcHRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0UXVlcnlPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgbGV0IHsgRGVsaW1pdGVyLCBNYXhLZXlzLCBJbmNsdWRlVmVyc2lvbiwgdmVyc2lvbklkTWFya2VyLCBrZXlNYXJrZXIgfSA9IGxpc3RRdWVyeU9wdHMgYXMgTGlzdE9iamVjdFF1ZXJ5T3B0c1xyXG5cclxuICAgIGlmICghaXNTdHJpbmcoRGVsaW1pdGVyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdEZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzTnVtYmVyKE1heEtleXMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ01heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcXVlcmllcyA9IFtdXHJcbiAgICAvLyBlc2NhcGUgZXZlcnkgdmFsdWUgaW4gcXVlcnkgc3RyaW5nLCBleGNlcHQgbWF4S2V5c1xyXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxyXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoRGVsaW1pdGVyKX1gKVxyXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXHJcblxyXG4gICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XHJcbiAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbnNgKVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xyXG4gICAgICAvLyB2MSB2ZXJzaW9uIGxpc3RpbmcuLlxyXG4gICAgICBpZiAoa2V5TWFya2VyKSB7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7a2V5TWFya2VyfWApXHJcbiAgICAgIH1cclxuICAgICAgaWYgKHZlcnNpb25JZE1hcmtlcikge1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbi1pZC1tYXJrZXI9JHt2ZXJzaW9uSWRNYXJrZXJ9YClcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChtYXJrZXIpIHtcclxuICAgICAgbWFya2VyID0gdXJpRXNjYXBlKG1hcmtlcilcclxuICAgICAgcXVlcmllcy5wdXNoKGBtYXJrZXI9JHttYXJrZXJ9YClcclxuICAgIH1cclxuXHJcbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXHJcbiAgICBpZiAoTWF4S2V5cykge1xyXG4gICAgICBpZiAoTWF4S2V5cyA+PSAxMDAwKSB7XHJcbiAgICAgICAgTWF4S2V5cyA9IDEwMDBcclxuICAgICAgfVxyXG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7TWF4S2V5c31gKVxyXG4gICAgfVxyXG4gICAgcXVlcmllcy5zb3J0KClcclxuICAgIGxldCBxdWVyeSA9ICcnXHJcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXHJcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcclxuICAgIGNvbnN0IGxpc3RRcnlMaXN0ID0gcGFyc2VMaXN0T2JqZWN0cyhib2R5KVxyXG4gICAgcmV0dXJuIGxpc3RRcnlMaXN0XHJcbiAgfVxyXG5cclxuICBsaXN0T2JqZWN0cyhcclxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcclxuICAgIHByZWZpeD86IHN0cmluZyxcclxuICAgIHJlY3Vyc2l2ZT86IGJvb2xlYW4sXHJcbiAgICBsaXN0T3B0cz86IExpc3RPYmplY3RRdWVyeU9wdHMgfCB1bmRlZmluZWQsXHJcbiAgKTogQnVja2V0U3RyZWFtPE9iamVjdEluZm8+IHtcclxuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBwcmVmaXggPSAnJ1xyXG4gICAgfVxyXG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcclxuICAgIH1cclxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcclxuICAgIH1cclxuICAgIGlmIChsaXN0T3B0cyAmJiAhaXNPYmplY3QobGlzdE9wdHMpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgbGV0IG1hcmtlcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJydcclxuICAgIGxldCBrZXlNYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICcnXHJcbiAgICBsZXQgdmVyc2lvbklkTWFya2VyOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnJ1xyXG4gICAgbGV0IG9iamVjdHM6IE9iamVjdEluZm9bXSA9IFtdXHJcbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxyXG4gICAgY29uc3QgcmVhZFN0cmVhbTogc3RyZWFtLlJlYWRhYmxlID0gbmV3IHN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcclxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIHB1c2ggb25lIG9iamVjdCBwZXIgX3JlYWQoKVxyXG4gICAgICBpZiAob2JqZWN0cy5sZW5ndGgpIHtcclxuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxyXG4gICAgICAgIHJldHVyblxyXG4gICAgICB9XHJcbiAgICAgIGlmIChlbmRlZCkge1xyXG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcclxuICAgICAgfVxyXG5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBsaXN0UXVlcnlPcHRzID0ge1xyXG4gICAgICAgICAgRGVsaW1pdGVyOiByZWN1cnNpdmUgPyAnJyA6ICcvJywgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXHJcbiAgICAgICAgICBNYXhLZXlzOiAxMDAwLFxyXG4gICAgICAgICAgSW5jbHVkZVZlcnNpb246IGxpc3RPcHRzPy5JbmNsdWRlVmVyc2lvbixcclxuICAgICAgICAgIC8vIHZlcnNpb24gbGlzdGluZyBzcGVjaWZpYyBvcHRpb25zXHJcbiAgICAgICAgICBrZXlNYXJrZXI6IGtleU1hcmtlcixcclxuICAgICAgICAgIHZlcnNpb25JZE1hcmtlcjogdmVyc2lvbklkTWFya2VyLFxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgcmVzdWx0OiBMaXN0T2JqZWN0UXVlcnlSZXMgPSBhd2FpdCB0aGlzLmxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBtYXJrZXIsIGxpc3RRdWVyeU9wdHMpXHJcbiAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xyXG4gICAgICAgICAgbWFya2VyID0gcmVzdWx0Lm5leHRNYXJrZXIgfHwgdW5kZWZpbmVkXHJcbiAgICAgICAgICBpZiAocmVzdWx0LmtleU1hcmtlcikge1xyXG4gICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQua2V5TWFya2VyXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAocmVzdWx0LnZlcnNpb25JZE1hcmtlcikge1xyXG4gICAgICAgICAgICB2ZXJzaW9uSWRNYXJrZXIgPSByZXN1bHQudmVyc2lvbklkTWFya2VyXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGVuZGVkID0gdHJ1ZVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmVzdWx0Lm9iamVjdHMpIHtcclxuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBAdHMtaWdub3JlXHJcbiAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXHJcbiAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiByZWFkU3RyZWFtXHJcbiAgfVxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxJQUFBQSxNQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxFQUFBLEdB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