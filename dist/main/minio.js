"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  Client: true,
  CopyConditions: true,
  PostPolicy: true
};
var Stream = _interopRequireWildcard(require("stream"), true);
var _xml2js = require("xml2js");
var errors = _interopRequireWildcard(require("./errors.js"), true);
Object.keys(errors).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === errors[key]) return;
  exports[key] = errors[key];
});
var _callbackify = require("./internal/callbackify.js");
var _client = require("./internal/client.js");
var _copyConditions = require("./internal/copy-conditions.js");
exports.CopyConditions = _copyConditions.CopyConditions;
var _helper = require("./internal/helper.js");
var _postPolicy = require("./internal/post-policy.js");
exports.PostPolicy = _postPolicy.PostPolicy;
var _notification = require("./notification.js");
Object.keys(_notification).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _notification[key]) return;
  exports[key] = _notification[key];
});
var _promisify = require("./promisify.js");
var transformers = _interopRequireWildcard(require("./transformers.js"), true);
var _helpers = require("./helpers.js");
Object.keys(_helpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _helpers[key]) return;
  exports[key] = _helpers[key];
});
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

class Client extends _client.TypedClient {
  //
  // __Arguments__
  // * `appName` _string_ - Application name.
  // * `appVersion` _string_ - Application version.

  // listObjectsV2Query - (List Objects V2) - List some or all (up to 1000) of the objects in a bucket.
  //
  // You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
  // request parameters :-
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: Limits the response to keys that begin with the specified prefix.
  // * `continuation-token` _string_: Used to continue iterating over a set of objects.
  // * `delimiter` _string_: A delimiter is a character you use to group keys.
  // * `max-keys` _number_: Sets the maximum number of keys returned in the response body.
  // * `start-after` _string_: Specifies the key to start after when listing objects in a bucket.
  listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, maxKeys, startAfter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (continuationToken) {
      continuationToken = (0, _helper.uriEscape)(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = (0, _helper.uriEscape)(startAfter);
      queries.push(`start-after=${startAfter}`);
    }
    // no need to escape maxKeys
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000;
      }
      queries.push(`max-keys=${maxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsV2Transformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      (0, _helper.pipesetup)(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket using S3 ListObjects V2
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `startAfter` _string_: Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
  //
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  //   * `obj.name` _string_: name of the object
  //   * `obj.prefix` _string_: name of the object prefix
  //   * `obj.size` _number_: size of the object
  //   * `obj.etag` _string_: etag of the object
  //   * `obj.lastModified` _Date_: modified time stamp
  listObjectsV2(bucketName, prefix, recursive, startAfter) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (startAfter === undefined) {
      startAfter = '';
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
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    // if recursive is false set delimiter to '/'
    var delimiter = recursive ? '' : '/';
    var continuationToken = '';
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, 1000, startAfter).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          continuationToken = result.nextContinuationToken;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // Remove all the notification configurations in the S3 provider
  setBucketNotification(bucketName, config, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new _xml2js.Builder({
      rootName: 'NotificationConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    var payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      query
    }, payload, [200], '', false, cb);
  }
  removeAllBucketNotification(bucketName, cb) {
    this.setBucketNotification(bucketName, new _notification.NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'GET';
    var query = 'notification';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getBucketNotificationTransformer();
      var bucketNotification;
      (0, _helper.pipesetup)(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!(0, _helper.isString)(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new _notification.NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
}
exports.Client = Client;
Client.prototype.getBucketNotification = (0, _promisify.promisify)(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = (0, _promisify.promisify)(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = (0, _promisify.promisify)(Client.prototype.removeAllBucketNotification);

// refactored API use promise internally
Client.prototype.makeBucket = (0, _callbackify.callbackify)(Client.prototype.makeBucket);
Client.prototype.bucketExists = (0, _callbackify.callbackify)(Client.prototype.bucketExists);
Client.prototype.removeBucket = (0, _callbackify.callbackify)(Client.prototype.removeBucket);
Client.prototype.listBuckets = (0, _callbackify.callbackify)(Client.prototype.listBuckets);
Client.prototype.getObject = (0, _callbackify.callbackify)(Client.prototype.getObject);
Client.prototype.fGetObject = (0, _callbackify.callbackify)(Client.prototype.fGetObject);
Client.prototype.getPartialObject = (0, _callbackify.callbackify)(Client.prototype.getPartialObject);
Client.prototype.statObject = (0, _callbackify.callbackify)(Client.prototype.statObject);
Client.prototype.putObjectRetention = (0, _callbackify.callbackify)(Client.prototype.putObjectRetention);
Client.prototype.putObject = (0, _callbackify.callbackify)(Client.prototype.putObject);
Client.prototype.fPutObject = (0, _callbackify.callbackify)(Client.prototype.fPutObject);
Client.prototype.removeObject = (0, _callbackify.callbackify)(Client.prototype.removeObject);
Client.prototype.removeBucketReplication = (0, _callbackify.callbackify)(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = (0, _callbackify.callbackify)(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = (0, _callbackify.callbackify)(Client.prototype.getBucketReplication);
Client.prototype.getObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.getObjectLegalHold);
Client.prototype.setObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.setObjectLegalHold);
Client.prototype.setObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.getObjectLockConfig);
Client.prototype.getBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.setBucketPolicy);
Client.prototype.getBucketTagging = (0, _callbackify.callbackify)(Client.prototype.getBucketTagging);
Client.prototype.getObjectTagging = (0, _callbackify.callbackify)(Client.prototype.getObjectTagging);
Client.prototype.setBucketTagging = (0, _callbackify.callbackify)(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = (0, _callbackify.callbackify)(Client.prototype.removeBucketTagging);
Client.prototype.setObjectTagging = (0, _callbackify.callbackify)(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = (0, _callbackify.callbackify)(Client.prototype.removeObjectTagging);
Client.prototype.getBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.setBucketVersioning);
Client.prototype.selectObjectContent = (0, _callbackify.callbackify)(Client.prototype.selectObjectContent);
Client.prototype.setBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.removeBucketLifecycle);
Client.prototype.setBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.removeBucketEncryption);
Client.prototype.getObjectRetention = (0, _callbackify.callbackify)(Client.prototype.getObjectRetention);
Client.prototype.removeObjects = (0, _callbackify.callbackify)(Client.prototype.removeObjects);
Client.prototype.removeIncompleteUpload = (0, _callbackify.callbackify)(Client.prototype.removeIncompleteUpload);
Client.prototype.copyObject = (0, _callbackify.callbackify)(Client.prototype.copyObject);
Client.prototype.composeObject = (0, _callbackify.callbackify)(Client.prototype.composeObject);
Client.prototype.presignedUrl = (0, _callbackify.callbackify)(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = (0, _callbackify.callbackify)(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = (0, _callbackify.callbackify)(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = (0, _callbackify.callbackify)(Client.prototype.presignedPostPolicy);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTdHJlYW0iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJfeG1sMmpzIiwiZXJyb3JzIiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJfZXhwb3J0TmFtZXMiLCJleHBvcnRzIiwiX2NhbGxiYWNraWZ5IiwiX2NsaWVudCIsIl9jb3B5Q29uZGl0aW9ucyIsIkNvcHlDb25kaXRpb25zIiwiX2hlbHBlciIsIl9wb3N0UG9saWN5IiwiUG9zdFBvbGljeSIsIl9ub3RpZmljYXRpb24iLCJfcHJvbWlzaWZ5IiwidHJhbnNmb3JtZXJzIiwiX2hlbHBlcnMiLCJlIiwidCIsIldlYWtNYXAiLCJyIiwibiIsIl9fZXNNb2R1bGUiLCJvIiwiaSIsImYiLCJfX3Byb3RvX18iLCJkZWZhdWx0IiwiaGFzIiwiZ2V0Iiwic2V0IiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJDbGllbnQiLCJUeXBlZENsaWVudCIsImxpc3RPYmplY3RzVjJRdWVyeSIsImJ1Y2tldE5hbWUiLCJwcmVmaXgiLCJjb250aW51YXRpb25Ub2tlbiIsImRlbGltaXRlciIsIm1heEtleXMiLCJzdGFydEFmdGVyIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJpc051bWJlciIsInF1ZXJpZXMiLCJwdXNoIiwidXJpRXNjYXBlIiwic29ydCIsInF1ZXJ5IiwibGVuZ3RoIiwiam9pbiIsIm1ldGhvZCIsInRyYW5zZm9ybWVyIiwiZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyIiwibWFrZVJlcXVlc3QiLCJyZXNwb25zZSIsImVtaXQiLCJwaXBlc2V0dXAiLCJsaXN0T2JqZWN0c1YyIiwicmVjdXJzaXZlIiwidW5kZWZpbmVkIiwiaXNWYWxpZFByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImlzQm9vbGVhbiIsIm9iamVjdHMiLCJlbmRlZCIsInJlYWRTdHJlYW0iLCJSZWFkYWJsZSIsIm9iamVjdE1vZGUiLCJfcmVhZCIsInNoaWZ0Iiwib24iLCJyZXN1bHQiLCJpc1RydW5jYXRlZCIsIm5leHRDb250aW51YXRpb25Ub2tlbiIsInNldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImNvbmZpZyIsImNiIiwiaXNPYmplY3QiLCJpc0Z1bmN0aW9uIiwiYnVpbGRlciIsInhtbDJqcyIsIkJ1aWxkZXIiLCJyb290TmFtZSIsInJlbmRlck9wdHMiLCJwcmV0dHkiLCJoZWFkbGVzcyIsInBheWxvYWQiLCJidWlsZE9iamVjdCIsInJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbiIsIk5vdGlmaWNhdGlvbkNvbmZpZyIsImdldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyIiwiYnVja2V0Tm90aWZpY2F0aW9uIiwibGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uIiwic3VmZml4IiwiZXZlbnRzIiwiQXJyYXkiLCJpc0FycmF5IiwibGlzdGVuZXIiLCJOb3RpZmljYXRpb25Qb2xsZXIiLCJzdGFydCIsInByb21pc2lmeSIsIm1ha2VCdWNrZXQiLCJjYWxsYmFja2lmeSIsImJ1Y2tldEV4aXN0cyIsInJlbW92ZUJ1Y2tldCIsImxpc3RCdWNrZXRzIiwiZ2V0T2JqZWN0IiwiZkdldE9iamVjdCIsImdldFBhcnRpYWxPYmplY3QiLCJzdGF0T2JqZWN0IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicHV0T2JqZWN0IiwiZlB1dE9iamVjdCIsInJlbW92ZU9iamVjdCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsImdldE9iamVjdExlZ2FsSG9sZCIsInNldE9iamVjdExlZ2FsSG9sZCIsInNldE9iamVjdExvY2tDb25maWciLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwiZ2V0QnVja2V0UG9saWN5Iiwic2V0QnVja2V0UG9saWN5IiwiZ2V0QnVja2V0VGFnZ2luZyIsImdldE9iamVjdFRhZ2dpbmciLCJzZXRCdWNrZXRUYWdnaW5nIiwicmVtb3ZlQnVja2V0VGFnZ2luZyIsInNldE9iamVjdFRhZ2dpbmciLCJyZW1vdmVPYmplY3RUYWdnaW5nIiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInNldEJ1Y2tldFZlcnNpb25pbmciLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2V0QnVja2V0TGlmZWN5Y2xlIiwiZ2V0QnVja2V0TGlmZWN5Y2xlIiwicmVtb3ZlQnVja2V0TGlmZWN5Y2xlIiwic2V0QnVja2V0RW5jcnlwdGlvbiIsImdldEJ1Y2tldEVuY3J5cHRpb24iLCJyZW1vdmVCdWNrZXRFbmNyeXB0aW9uIiwiZ2V0T2JqZWN0UmV0ZW50aW9uIiwicmVtb3ZlT2JqZWN0cyIsInJlbW92ZUluY29tcGxldGVVcGxvYWQiLCJjb3B5T2JqZWN0IiwiY29tcG9zZU9iamVjdCIsInByZXNpZ25lZFVybCIsInByZXNpZ25lZEdldE9iamVjdCIsInByZXNpZ25lZFB1dE9iamVjdCIsInByZXNpZ25lZFBvc3RQb2xpY3kiXSwic291cmNlcyI6WyJtaW5pby5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxyXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXHJcbiAqXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XHJcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cclxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XHJcbiAqXHJcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcclxuICpcclxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxyXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXHJcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxyXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXHJcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIFN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcclxuXHJcbmltcG9ydCB4bWwyanMgZnJvbSAneG1sMmpzJ1xyXG5cclxuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4vZXJyb3JzLnRzJ1xyXG5pbXBvcnQgeyBjYWxsYmFja2lmeSB9IGZyb20gJy4vaW50ZXJuYWwvY2FsbGJhY2tpZnkuanMnXHJcbmltcG9ydCB7IFR5cGVkQ2xpZW50IH0gZnJvbSAnLi9pbnRlcm5hbC9jbGllbnQudHMnXHJcbmltcG9ydCB7IENvcHlDb25kaXRpb25zIH0gZnJvbSAnLi9pbnRlcm5hbC9jb3B5LWNvbmRpdGlvbnMudHMnXHJcbmltcG9ydCB7XHJcbiAgaXNCb29sZWFuLFxyXG4gIGlzRnVuY3Rpb24sXHJcbiAgaXNOdW1iZXIsXHJcbiAgaXNPYmplY3QsXHJcbiAgaXNTdHJpbmcsXHJcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXHJcbiAgaXNWYWxpZFByZWZpeCxcclxuICBwaXBlc2V0dXAsXHJcbiAgdXJpRXNjYXBlLFxyXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xyXG5pbXBvcnQgeyBQb3N0UG9saWN5IH0gZnJvbSAnLi9pbnRlcm5hbC9wb3N0LXBvbGljeS50cydcclxuaW1wb3J0IHsgTm90aWZpY2F0aW9uQ29uZmlnLCBOb3RpZmljYXRpb25Qb2xsZXIgfSBmcm9tICcuL25vdGlmaWNhdGlvbi50cydcclxuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnLi9wcm9taXNpZnkuanMnXHJcbmltcG9ydCAqIGFzIHRyYW5zZm9ybWVycyBmcm9tICcuL3RyYW5zZm9ybWVycy5qcydcclxuXHJcbmV4cG9ydCAqIGZyb20gJy4vZXJyb3JzLnRzJ1xyXG5leHBvcnQgKiBmcm9tICcuL2hlbHBlcnMudHMnXHJcbmV4cG9ydCAqIGZyb20gJy4vbm90aWZpY2F0aW9uLnRzJ1xyXG5leHBvcnQgeyBDb3B5Q29uZGl0aW9ucywgUG9zdFBvbGljeSB9XHJcblxyXG5leHBvcnQgY2xhc3MgQ2xpZW50IGV4dGVuZHMgVHlwZWRDbGllbnQge1xyXG4gIC8vXHJcbiAgLy8gX19Bcmd1bWVudHNfX1xyXG4gIC8vICogYGFwcE5hbWVgIF9zdHJpbmdfIC0gQXBwbGljYXRpb24gbmFtZS5cclxuICAvLyAqIGBhcHBWZXJzaW9uYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIHZlcnNpb24uXHJcblxyXG4gIC8vIGxpc3RPYmplY3RzVjJRdWVyeSAtIChMaXN0IE9iamVjdHMgVjIpIC0gTGlzdCBzb21lIG9yIGFsbCAodXAgdG8gMTAwMCkgb2YgdGhlIG9iamVjdHMgaW4gYSBidWNrZXQuXHJcbiAgLy9cclxuICAvLyBZb3UgY2FuIHVzZSB0aGUgcmVxdWVzdCBwYXJhbWV0ZXJzIGFzIHNlbGVjdGlvbiBjcml0ZXJpYSB0byByZXR1cm4gYSBzdWJzZXQgb2YgdGhlIG9iamVjdHMgaW4gYSBidWNrZXQuXHJcbiAgLy8gcmVxdWVzdCBwYXJhbWV0ZXJzIDotXHJcbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxyXG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IExpbWl0cyB0aGUgcmVzcG9uc2UgdG8ga2V5cyB0aGF0IGJlZ2luIHdpdGggdGhlIHNwZWNpZmllZCBwcmVmaXguXHJcbiAgLy8gKiBgY29udGludWF0aW9uLXRva2VuYCBfc3RyaW5nXzogVXNlZCB0byBjb250aW51ZSBpdGVyYXRpbmcgb3ZlciBhIHNldCBvZiBvYmplY3RzLlxyXG4gIC8vICogYGRlbGltaXRlcmAgX3N0cmluZ186IEEgZGVsaW1pdGVyIGlzIGEgY2hhcmFjdGVyIHlvdSB1c2UgdG8gZ3JvdXAga2V5cy5cclxuICAvLyAqIGBtYXgta2V5c2AgX251bWJlcl86IFNldHMgdGhlIG1heGltdW0gbnVtYmVyIG9mIGtleXMgcmV0dXJuZWQgaW4gdGhlIHJlc3BvbnNlIGJvZHkuXHJcbiAgLy8gKiBgc3RhcnQtYWZ0ZXJgIF9zdHJpbmdfOiBTcGVjaWZpZXMgdGhlIGtleSB0byBzdGFydCBhZnRlciB3aGVuIGxpc3Rpbmcgb2JqZWN0cyBpbiBhIGJ1Y2tldC5cclxuICBsaXN0T2JqZWN0c1YyUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBjb250aW51YXRpb25Ub2tlbiwgZGVsaW1pdGVyLCBtYXhLZXlzLCBzdGFydEFmdGVyKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhjb250aW51YXRpb25Ub2tlbikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29udGludWF0aW9uVG9rZW4gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc051bWJlcihtYXhLZXlzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgdmFyIHF1ZXJpZXMgPSBbXVxyXG5cclxuICAgIC8vIENhbGwgZm9yIGxpc3Rpbmcgb2JqZWN0cyB2MiBBUElcclxuICAgIHF1ZXJpZXMucHVzaChgbGlzdC10eXBlPTJgKVxyXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXHJcblxyXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcclxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcclxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcclxuXHJcbiAgICBpZiAoY29udGludWF0aW9uVG9rZW4pIHtcclxuICAgICAgY29udGludWF0aW9uVG9rZW4gPSB1cmlFc2NhcGUoY29udGludWF0aW9uVG9rZW4pXHJcbiAgICAgIHF1ZXJpZXMucHVzaChgY29udGludWF0aW9uLXRva2VuPSR7Y29udGludWF0aW9uVG9rZW59YClcclxuICAgIH1cclxuICAgIC8vIFNldCBzdGFydC1hZnRlclxyXG4gICAgaWYgKHN0YXJ0QWZ0ZXIpIHtcclxuICAgICAgc3RhcnRBZnRlciA9IHVyaUVzY2FwZShzdGFydEFmdGVyKVxyXG4gICAgICBxdWVyaWVzLnB1c2goYHN0YXJ0LWFmdGVyPSR7c3RhcnRBZnRlcn1gKVxyXG4gICAgfVxyXG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xyXG4gICAgaWYgKG1heEtleXMpIHtcclxuICAgICAgaWYgKG1heEtleXMgPj0gMTAwMCkge1xyXG4gICAgICAgIG1heEtleXMgPSAxMDAwXHJcbiAgICAgIH1cclxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke21heEtleXN9YClcclxuICAgIH1cclxuICAgIHF1ZXJpZXMuc29ydCgpXHJcbiAgICB2YXIgcXVlcnkgPSAnJ1xyXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcclxuICAgIH1cclxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xyXG4gICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldExpc3RPYmplY3RzVjJUcmFuc2Zvcm1lcigpXHJcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcclxuICAgICAgaWYgKGUpIHtcclxuICAgICAgICByZXR1cm4gdHJhbnNmb3JtZXIuZW1pdCgnZXJyb3InLCBlKVxyXG4gICAgICB9XHJcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXHJcbiAgICB9KVxyXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVyXHJcbiAgfVxyXG5cclxuICAvLyBMaXN0IHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQgdXNpbmcgUzMgTGlzdE9iamVjdHMgVjJcclxuICAvL1xyXG4gIC8vIF9fQXJndW1lbnRzX19cclxuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XHJcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogdGhlIHByZWZpeCBvZiB0aGUgb2JqZWN0cyB0aGF0IHNob3VsZCBiZSBsaXN0ZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXHJcbiAgLy8gKiBgcmVjdXJzaXZlYCBfYm9vbF86IGB0cnVlYCBpbmRpY2F0ZXMgcmVjdXJzaXZlIHN0eWxlIGxpc3RpbmcgYW5kIGBmYWxzZWAgaW5kaWNhdGVzIGRpcmVjdG9yeSBzdHlsZSBsaXN0aW5nIGRlbGltaXRlZCBieSAnLycuIChvcHRpb25hbCwgZGVmYXVsdCBgZmFsc2VgKVxyXG4gIC8vICogYHN0YXJ0QWZ0ZXJgIF9zdHJpbmdfOiBTcGVjaWZpZXMgdGhlIGtleSB0byBzdGFydCBhZnRlciB3aGVuIGxpc3Rpbmcgb2JqZWN0cyBpbiBhIGJ1Y2tldC4gKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXHJcbiAgLy9cclxuICAvLyBfX1JldHVybiBWYWx1ZV9fXHJcbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXzogc3RyZWFtIGVtaXR0aW5nIHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQsIHRoZSBvYmplY3QgaXMgb2YgdGhlIGZvcm1hdDpcclxuICAvLyAgICogYG9iai5uYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XHJcbiAgLy8gICAqIGBvYmoucHJlZml4YCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0IHByZWZpeFxyXG4gIC8vICAgKiBgb2JqLnNpemVgIF9udW1iZXJfOiBzaXplIG9mIHRoZSBvYmplY3RcclxuICAvLyAgICogYG9iai5ldGFnYCBfc3RyaW5nXzogZXRhZyBvZiB0aGUgb2JqZWN0XHJcbiAgLy8gICAqIGBvYmoubGFzdE1vZGlmaWVkYCBfRGF0ZV86IG1vZGlmaWVkIHRpbWUgc3RhbXBcclxuICBsaXN0T2JqZWN0c1YyKGJ1Y2tldE5hbWUsIHByZWZpeCwgcmVjdXJzaXZlLCBzdGFydEFmdGVyKSB7XHJcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgcHJlZml4ID0gJydcclxuICAgIH1cclxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxyXG4gICAgfVxyXG4gICAgaWYgKHN0YXJ0QWZ0ZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBzdGFydEFmdGVyID0gJydcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcclxuICAgIH1cclxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxyXG4gICAgfVxyXG4gICAgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXHJcbiAgICB2YXIgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcclxuICAgIHZhciBjb250aW51YXRpb25Ub2tlbiA9ICcnXHJcbiAgICB2YXIgb2JqZWN0cyA9IFtdXHJcbiAgICB2YXIgZW5kZWQgPSBmYWxzZVxyXG4gICAgdmFyIHJlYWRTdHJlYW0gPSBTdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXHJcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xyXG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcclxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XHJcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcclxuICAgICAgICByZXR1cm5cclxuICAgICAgfVxyXG4gICAgICBpZiAoZW5kZWQpIHtcclxuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXHJcbiAgICAgIH1cclxuICAgICAgLy8gaWYgdGhlcmUgYXJlIG5vIG9iamVjdHMgdG8gcHVzaCBkbyBxdWVyeSBmb3IgdGhlIG5leHQgYmF0Y2ggb2Ygb2JqZWN0c1xyXG4gICAgICB0aGlzLmxpc3RPYmplY3RzVjJRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGNvbnRpbnVhdGlvblRva2VuLCBkZWxpbWl0ZXIsIDEwMDAsIHN0YXJ0QWZ0ZXIpXHJcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkpXHJcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xyXG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xyXG4gICAgICAgICAgICBjb250aW51YXRpb25Ub2tlbiA9IHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW5cclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdC5vYmplY3RzXHJcbiAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcclxuICAgICAgICB9KVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cclxuICB9XHJcblxyXG4gIC8vIFJlbW92ZSBhbGwgdGhlIG5vdGlmaWNhdGlvbiBjb25maWd1cmF0aW9ucyBpbiB0aGUgUzMgcHJvdmlkZXJcclxuICBzZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgY29uZmlnLCBjYikge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc09iamVjdChjb25maWcpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ25vdGlmaWNhdGlvbiBjb25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXHJcbiAgICB9XHJcbiAgICB2YXIgbWV0aG9kID0gJ1BVVCdcclxuICAgIHZhciBxdWVyeSA9ICdub3RpZmljYXRpb24nXHJcbiAgICB2YXIgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XHJcbiAgICAgIHJvb3ROYW1lOiAnTm90aWZpY2F0aW9uQ29uZmlndXJhdGlvbicsXHJcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxyXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcclxuICAgIH0pXHJcbiAgICB2YXIgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxyXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXHJcbiAgfVxyXG5cclxuICByZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgY2IpIHtcclxuICAgIHRoaXMuc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIG5ldyBOb3RpZmljYXRpb25Db25maWcoKSwgY2IpXHJcbiAgfVxyXG5cclxuICAvLyBSZXR1cm4gdGhlIGxpc3Qgb2Ygbm90aWZpY2F0aW9uIGNvbmZpZ3VyYXRpb25zIHN0b3JlZFxyXG4gIC8vIGluIHRoZSBTMyBwcm92aWRlclxyXG4gIGdldEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBjYikge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxyXG4gICAgfVxyXG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXHJcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xyXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XHJcbiAgICAgIGlmIChlKSB7XHJcbiAgICAgICAgcmV0dXJuIGNiKGUpXHJcbiAgICAgIH1cclxuICAgICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyKClcclxuICAgICAgdmFyIGJ1Y2tldE5vdGlmaWNhdGlvblxyXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxyXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IChidWNrZXROb3RpZmljYXRpb24gPSByZXN1bHQpKVxyXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXHJcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiBjYihudWxsLCBidWNrZXROb3RpZmljYXRpb24pKVxyXG4gICAgfSlcclxuICB9XHJcblxyXG4gIC8vIExpc3RlbnMgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25zLiBSZXR1cm5zIGFuIEV2ZW50RW1pdHRlci5cclxuICBsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cykge1xyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcoc3VmZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdWZmaXggbXVzdCBiZSBvZiB0eXBlIHN0cmluZycpXHJcbiAgICB9XHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldmVudHMgbXVzdCBiZSBvZiB0eXBlIEFycmF5JylcclxuICAgIH1cclxuICAgIGxldCBsaXN0ZW5lciA9IG5ldyBOb3RpZmljYXRpb25Qb2xsZXIodGhpcywgYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cylcclxuICAgIGxpc3RlbmVyLnN0YXJ0KClcclxuXHJcbiAgICByZXR1cm4gbGlzdGVuZXJcclxuICB9XHJcbn1cclxuXHJcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0Tm90aWZpY2F0aW9uKVxyXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbilcclxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24pXHJcblxyXG4vLyByZWZhY3RvcmVkIEFQSSB1c2UgcHJvbWlzZSBpbnRlcm5hbGx5XHJcbkNsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldClcclxuQ2xpZW50LnByb3RvdHlwZS5idWNrZXRFeGlzdHMgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmJ1Y2tldEV4aXN0cylcclxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldClcclxuQ2xpZW50LnByb3RvdHlwZS5saXN0QnVja2V0cyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUubGlzdEJ1Y2tldHMpXHJcblxyXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLmZHZXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmZHZXRPYmplY3QpXHJcbkNsaWVudC5wcm90b3R5cGUuZ2V0UGFydGlhbE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0UGFydGlhbE9iamVjdClcclxuQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0UmV0ZW50aW9uKVxyXG5DbGllbnQucHJvdG90eXBlLnB1dE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QpXHJcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3QpXHJcblxyXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRSZXBsaWNhdGlvbilcclxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UmVwbGljYXRpb24pXHJcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFJlcGxpY2F0aW9uKVxyXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdExlZ2FsSG9sZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TGVnYWxIb2xkKVxyXG5DbGllbnQucHJvdG90eXBlLnNldE9iamVjdExlZ2FsSG9sZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TGVnYWxIb2xkKVxyXG5DbGllbnQucHJvdG90eXBlLnNldE9iamVjdExvY2tDb25maWcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdExvY2tDb25maWcpXHJcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZylcclxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFBvbGljeSlcclxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRQb2xpY3kgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFBvbGljeSlcclxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nKVxyXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdFRhZ2dpbmcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdFRhZ2dpbmcpXHJcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZylcclxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nKVxyXG5DbGllbnQucHJvdG90eXBlLnNldE9iamVjdFRhZ2dpbmcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdFRhZ2dpbmcpXHJcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0VGFnZ2luZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0VGFnZ2luZylcclxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nKVxyXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFZlcnNpb25pbmcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFZlcnNpb25pbmcpXHJcbkNsaWVudC5wcm90b3R5cGUuc2VsZWN0T2JqZWN0Q29udGVudCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2VsZWN0T2JqZWN0Q29udGVudClcclxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRMaWZlY3ljbGUgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldExpZmVjeWNsZSlcclxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldExpZmVjeWNsZSlcclxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRMaWZlY3ljbGUgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSlcclxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uKVxyXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24pXHJcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0RW5jcnlwdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0RW5jcnlwdGlvbilcclxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RSZXRlbnRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbilcclxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RzID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RzKVxyXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUluY29tcGxldGVVcGxvYWQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUluY29tcGxldGVVcGxvYWQpXHJcbkNsaWVudC5wcm90b3R5cGUuY29weU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuY29weU9iamVjdClcclxuQ2xpZW50LnByb3RvdHlwZS5jb21wb3NlT2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5jb21wb3NlT2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFVybCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsKVxyXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZEdldE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkUHV0T2JqZWN0KVxyXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kpXHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQWdCQSxJQUFBQSxNQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBQyxPQUFBLEdBQUFELE9BQUE7QUFFQSxJQUFBRSxNQUFBLEdBQUFILHVCQUFBLENBQUFDLE9BQUE7QUFvQkFHLE1BQUEsQ0FBQUMsSUFBQSxDQUFBRixNQUFBLEVBQUFHLE9BQUEsV0FBQUMsR0FBQTtFQUFBLElBQUFBLEdBQUEsa0JBQUFBLEdBQUE7RUFBQSxJQUFBSCxNQUFBLENBQUFJLFNBQUEsQ0FBQUMsY0FBQSxDQUFBQyxJQUFBLENBQUFDLFlBQUEsRUFBQUosR0FBQTtFQUFBLElBQUFBLEdBQUEsSUFBQUssT0FBQSxJQUFBQSxPQUFBLENBQUFMLEdBQUEsTUFBQUosTUFBQSxDQUFBSSxHQUFBO0VBQUFLLE9BQUEsQ0FBQUwsR0FBQSxJQUFBSixNQUFBLENBQUFJLEdBQUE7QUFBQTtBQW5CQSxJQUFBTSxZQUFBLEdBQUFaLE9BQUE7QUFDQSxJQUFBYSxPQUFBLEdBQUFiLE9BQUE7QUFDQSxJQUFBYyxlQUFBLEdBQUFkLE9BQUE7QUFBOERXLE9BQUEsQ0FBQUksY0FBQSxHQUFBRCxlQUFBLENBQUFDLGNBQUE7QUFDOUQsSUFBQUMsT0FBQSxHQUFBaEIsT0FBQTtBQVdBLElBQUFpQixXQUFBLEdBQUFqQixPQUFBO0FBQXNEVyxPQUFBLENBQUFPLFVBQUEsR0FBQUQsV0FBQSxDQUFBQyxVQUFBO0FBQ3RELElBQUFDLGFBQUEsR0FBQW5CLE9BQUE7QUFNQUcsTUFBQSxDQUFBQyxJQUFBLENBQUFlLGFBQUEsRUFBQWQsT0FBQSxXQUFBQyxHQUFBO0VBQUEsSUFBQUEsR0FBQSxrQkFBQUEsR0FBQTtFQUFBLElBQUFILE1BQUEsQ0FBQUksU0FBQSxDQUFBQyxjQUFBLENBQUFDLElBQUEsQ0FBQUMsWUFBQSxFQUFBSixHQUFBO0VBQUEsSUFBQUEsR0FBQSxJQUFBSyxPQUFBLElBQUFBLE9BQUEsQ0FBQUwsR0FBQSxNQUFBYSxhQUFBLENBQUFiLEdBQUE7RUFBQUssT0FBQSxDQUFBTCxHQUFBLElBQUFhLGFBQUEsQ0FBQWIsR0FBQTtBQUFBO0FBTEEsSUFBQWMsVUFBQSxHQUFBcEIsT0FBQTtBQUNBLElBQUFxQixZQUFBLEdBQUF0Qix1QkFBQSxDQUFBQyxPQUFBO0FBR0EsSUFBQXNCLFFBQUEsR0FBQXRCLE9BQUE7QUFBQUcsTUFBQSxDQUFBQyxJQUFBLENBQUFrQixRQUFBLEVBQUFqQixPQUFBLFdBQUFDLEdBQUE7RUFBQSxJQUFBQSxHQUFBLGtCQUFBQSxHQUFBO0VBQUEsSUFBQUgsTUFBQSxDQUFBSSxTQUFBLENBQUFDLGNBQUEsQ0FBQUMsSUFBQSxDQUFBQyxZQUFBLEVBQUFKLEdBQUE7RUFBQSxJQUFBQSxHQUFBLElBQUFLLE9BQUEsSUFBQUEsT0FBQSxDQUFBTCxHQUFBLE1BQUFnQixRQUFBLENBQUFoQixHQUFBO0VBQUFLLE9BQUEsQ0FBQUwsR0FBQSxJQUFBZ0IsUUFBQSxDQUFBaEIsR0FBQTtBQUFBO0FBQTRCLFNBQUFQLHdCQUFBd0IsQ0FBQSxFQUFBQyxDQUFBLDZCQUFBQyxPQUFBLE1BQUFDLENBQUEsT0FBQUQsT0FBQSxJQUFBRSxDQUFBLE9BQUFGLE9BQUEsWUFBQTFCLHVCQUFBLFlBQUFBLENBQUF3QixDQUFBLEVBQUFDLENBQUEsU0FBQUEsQ0FBQSxJQUFBRCxDQUFBLElBQUFBLENBQUEsQ0FBQUssVUFBQSxTQUFBTCxDQUFBLE1BQUFNLENBQUEsRUFBQUMsQ0FBQSxFQUFBQyxDQUFBLEtBQUFDLFNBQUEsUUFBQUMsT0FBQSxFQUFBVixDQUFBLGlCQUFBQSxDQUFBLHVCQUFBQSxDQUFBLHlCQUFBQSxDQUFBLFNBQUFRLENBQUEsTUFBQUYsQ0FBQSxHQUFBTCxDQUFBLEdBQUFHLENBQUEsR0FBQUQsQ0FBQSxRQUFBRyxDQUFBLENBQUFLLEdBQUEsQ0FBQVgsQ0FBQSxVQUFBTSxDQUFBLENBQUFNLEdBQUEsQ0FBQVosQ0FBQSxHQUFBTSxDQUFBLENBQUFPLEdBQUEsQ0FBQWIsQ0FBQSxFQUFBUSxDQUFBLGdCQUFBUCxDQUFBLElBQUFELENBQUEsZ0JBQUFDLENBQUEsT0FBQWhCLGNBQUEsQ0FBQUMsSUFBQSxDQUFBYyxDQUFBLEVBQUFDLENBQUEsT0FBQU0sQ0FBQSxJQUFBRCxDQUFBLEdBQUExQixNQUFBLENBQUFrQyxjQUFBLEtBQUFsQyxNQUFBLENBQUFtQyx3QkFBQSxDQUFBZixDQUFBLEVBQUFDLENBQUEsT0FBQU0sQ0FBQSxDQUFBSyxHQUFBLElBQUFMLENBQUEsQ0FBQU0sR0FBQSxJQUFBUCxDQUFBLENBQUFFLENBQUEsRUFBQVAsQ0FBQSxFQUFBTSxDQUFBLElBQUFDLENBQUEsQ0FBQVAsQ0FBQSxJQUFBRCxDQUFBLENBQUFDLENBQUEsV0FBQU8sQ0FBQSxLQUFBUixDQUFBLEVBQUFDLENBQUE7QUF6QzVCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUErQk8sTUFBTWUsTUFBTSxTQUFTQyxtQkFBVyxDQUFDO0VBQ3RDO0VBQ0E7RUFDQTtFQUNBOztFQUVBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0FDLGtCQUFrQkEsQ0FBQ0MsVUFBVSxFQUFFQyxNQUFNLEVBQUVDLGlCQUFpQixFQUFFQyxTQUFTLEVBQUVDLE9BQU8sRUFBRUMsVUFBVSxFQUFFO0lBQ3hGLElBQUksQ0FBQyxJQUFBQyx5QkFBaUIsRUFBQ04sVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJeEMsTUFBTSxDQUFDK0Msc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdQLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQyxJQUFBUSxnQkFBUSxFQUFDUCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUlRLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQyxJQUFBRCxnQkFBUSxFQUFDTixpQkFBaUIsQ0FBQyxFQUFFO01BQ2hDLE1BQU0sSUFBSU8sU0FBUyxDQUFDLDhDQUE4QyxDQUFDO0lBQ3JFO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNMLFNBQVMsQ0FBQyxFQUFFO01BQ3hCLE1BQU0sSUFBSU0sU0FBUyxDQUFDLHNDQUFzQyxDQUFDO0lBQzdEO0lBQ0EsSUFBSSxDQUFDLElBQUFDLGdCQUFRLEVBQUNOLE9BQU8sQ0FBQyxFQUFFO01BQ3RCLE1BQU0sSUFBSUssU0FBUyxDQUFDLG9DQUFvQyxDQUFDO0lBQzNEO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNILFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSUksU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSUUsT0FBTyxHQUFHLEVBQUU7O0lBRWhCO0lBQ0FBLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLGFBQWEsQ0FBQztJQUMzQkQsT0FBTyxDQUFDQyxJQUFJLENBQUMsbUJBQW1CLENBQUM7O0lBRWpDO0lBQ0FELE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLFVBQVUsSUFBQUMsaUJBQVMsRUFBQ1osTUFBTSxDQUFDLEVBQUUsQ0FBQztJQUMzQ1UsT0FBTyxDQUFDQyxJQUFJLENBQUMsYUFBYSxJQUFBQyxpQkFBUyxFQUFDVixTQUFTLENBQUMsRUFBRSxDQUFDO0lBRWpELElBQUlELGlCQUFpQixFQUFFO01BQ3JCQSxpQkFBaUIsR0FBRyxJQUFBVyxpQkFBUyxFQUFDWCxpQkFBaUIsQ0FBQztNQUNoRFMsT0FBTyxDQUFDQyxJQUFJLENBQUMsc0JBQXNCVixpQkFBaUIsRUFBRSxDQUFDO0lBQ3pEO0lBQ0E7SUFDQSxJQUFJRyxVQUFVLEVBQUU7TUFDZEEsVUFBVSxHQUFHLElBQUFRLGlCQUFTLEVBQUNSLFVBQVUsQ0FBQztNQUNsQ00sT0FBTyxDQUFDQyxJQUFJLENBQUMsZUFBZVAsVUFBVSxFQUFFLENBQUM7SUFDM0M7SUFDQTtJQUNBLElBQUlELE9BQU8sRUFBRTtNQUNYLElBQUlBLE9BQU8sSUFBSSxJQUFJLEVBQUU7UUFDbkJBLE9BQU8sR0FBRyxJQUFJO01BQ2hCO01BQ0FPLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLFlBQVlSLE9BQU8sRUFBRSxDQUFDO0lBQ3JDO0lBQ0FPLE9BQU8sQ0FBQ0csSUFBSSxDQUFDLENBQUM7SUFDZCxJQUFJQyxLQUFLLEdBQUcsRUFBRTtJQUNkLElBQUlKLE9BQU8sQ0FBQ0ssTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN0QkQsS0FBSyxHQUFHLEdBQUdKLE9BQU8sQ0FBQ00sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0lBQ2hDO0lBQ0EsSUFBSUMsTUFBTSxHQUFHLEtBQUs7SUFDbEIsSUFBSUMsV0FBVyxHQUFHeEMsWUFBWSxDQUFDeUMsMkJBQTJCLENBQUMsQ0FBQztJQUM1RCxJQUFJLENBQUNDLFdBQVcsQ0FBQztNQUFFSCxNQUFNO01BQUVsQixVQUFVO01BQUVlO0lBQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQ2xDLENBQUMsRUFBRXlDLFFBQVEsS0FBSztNQUNwRixJQUFJekMsQ0FBQyxFQUFFO1FBQ0wsT0FBT3NDLFdBQVcsQ0FBQ0ksSUFBSSxDQUFDLE9BQU8sRUFBRTFDLENBQUMsQ0FBQztNQUNyQztNQUNBLElBQUEyQyxpQkFBUyxFQUFDRixRQUFRLEVBQUVILFdBQVcsQ0FBQztJQUNsQyxDQUFDLENBQUM7SUFDRixPQUFPQSxXQUFXO0VBQ3BCOztFQUVBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBTSxhQUFhQSxDQUFDekIsVUFBVSxFQUFFQyxNQUFNLEVBQUV5QixTQUFTLEVBQUVyQixVQUFVLEVBQUU7SUFDdkQsSUFBSUosTUFBTSxLQUFLMEIsU0FBUyxFQUFFO01BQ3hCMUIsTUFBTSxHQUFHLEVBQUU7SUFDYjtJQUNBLElBQUl5QixTQUFTLEtBQUtDLFNBQVMsRUFBRTtNQUMzQkQsU0FBUyxHQUFHLEtBQUs7SUFDbkI7SUFDQSxJQUFJckIsVUFBVSxLQUFLc0IsU0FBUyxFQUFFO01BQzVCdEIsVUFBVSxHQUFHLEVBQUU7SUFDakI7SUFDQSxJQUFJLENBQUMsSUFBQUMseUJBQWlCLEVBQUNOLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXhDLE1BQU0sQ0FBQytDLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHUCxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUMsSUFBQTRCLHFCQUFhLEVBQUMzQixNQUFNLENBQUMsRUFBRTtNQUMxQixNQUFNLElBQUl6QyxNQUFNLENBQUNxRSxrQkFBa0IsQ0FBQyxvQkFBb0I1QixNQUFNLEVBQUUsQ0FBQztJQUNuRTtJQUNBLElBQUksQ0FBQyxJQUFBTyxnQkFBUSxFQUFDUCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUlRLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQyxJQUFBcUIsaUJBQVMsRUFBQ0osU0FBUyxDQUFDLEVBQUU7TUFDekIsTUFBTSxJQUFJakIsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNILFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSUksU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0E7SUFDQSxJQUFJTixTQUFTLEdBQUd1QixTQUFTLEdBQUcsRUFBRSxHQUFHLEdBQUc7SUFDcEMsSUFBSXhCLGlCQUFpQixHQUFHLEVBQUU7SUFDMUIsSUFBSTZCLE9BQU8sR0FBRyxFQUFFO0lBQ2hCLElBQUlDLEtBQUssR0FBRyxLQUFLO0lBQ2pCLElBQUlDLFVBQVUsR0FBRzdFLE1BQU0sQ0FBQzhFLFFBQVEsQ0FBQztNQUFFQyxVQUFVLEVBQUU7SUFBSyxDQUFDLENBQUM7SUFDdERGLFVBQVUsQ0FBQ0csS0FBSyxHQUFHLE1BQU07TUFDdkI7TUFDQSxJQUFJTCxPQUFPLENBQUNmLE1BQU0sRUFBRTtRQUNsQmlCLFVBQVUsQ0FBQ3JCLElBQUksQ0FBQ21CLE9BQU8sQ0FBQ00sS0FBSyxDQUFDLENBQUMsQ0FBQztRQUNoQztNQUNGO01BQ0EsSUFBSUwsS0FBSyxFQUFFO1FBQ1QsT0FBT0MsVUFBVSxDQUFDckIsSUFBSSxDQUFDLElBQUksQ0FBQztNQUM5QjtNQUNBO01BQ0EsSUFBSSxDQUFDYixrQkFBa0IsQ0FBQ0MsVUFBVSxFQUFFQyxNQUFNLEVBQUVDLGlCQUFpQixFQUFFQyxTQUFTLEVBQUUsSUFBSSxFQUFFRSxVQUFVLENBQUMsQ0FDeEZpQyxFQUFFLENBQUMsT0FBTyxFQUFHekQsQ0FBQyxJQUFLb0QsVUFBVSxDQUFDVixJQUFJLENBQUMsT0FBTyxFQUFFMUMsQ0FBQyxDQUFDLENBQUMsQ0FDL0N5RCxFQUFFLENBQUMsTUFBTSxFQUFHQyxNQUFNLElBQUs7UUFDdEIsSUFBSUEsTUFBTSxDQUFDQyxXQUFXLEVBQUU7VUFDdEJ0QyxpQkFBaUIsR0FBR3FDLE1BQU0sQ0FBQ0UscUJBQXFCO1FBQ2xELENBQUMsTUFBTTtVQUNMVCxLQUFLLEdBQUcsSUFBSTtRQUNkO1FBQ0FELE9BQU8sR0FBR1EsTUFBTSxDQUFDUixPQUFPO1FBQ3hCRSxVQUFVLENBQUNHLEtBQUssQ0FBQyxDQUFDO01BQ3BCLENBQUMsQ0FBQztJQUNOLENBQUM7SUFDRCxPQUFPSCxVQUFVO0VBQ25COztFQUVBO0VBQ0FTLHFCQUFxQkEsQ0FBQzFDLFVBQVUsRUFBRTJDLE1BQU0sRUFBRUMsRUFBRSxFQUFFO0lBQzVDLElBQUksQ0FBQyxJQUFBdEMseUJBQWlCLEVBQUNOLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXhDLE1BQU0sQ0FBQytDLHNCQUFzQixDQUFDLHVCQUF1QixHQUFHUCxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUMsSUFBQTZDLGdCQUFRLEVBQUNGLE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSWxDLFNBQVMsQ0FBQyxnREFBZ0QsQ0FBQztJQUN2RTtJQUNBLElBQUksQ0FBQyxJQUFBcUMsa0JBQVUsRUFBQ0YsRUFBRSxDQUFDLEVBQUU7TUFDbkIsTUFBTSxJQUFJbkMsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSVMsTUFBTSxHQUFHLEtBQUs7SUFDbEIsSUFBSUgsS0FBSyxHQUFHLGNBQWM7SUFDMUIsSUFBSWdDLE9BQU8sR0FBRyxJQUFJQyxPQUFNLENBQUNDLE9BQU8sQ0FBQztNQUMvQkMsUUFBUSxFQUFFLDJCQUEyQjtNQUNyQ0MsVUFBVSxFQUFFO1FBQUVDLE1BQU0sRUFBRTtNQUFNLENBQUM7TUFDN0JDLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLElBQUlDLE9BQU8sR0FBR1AsT0FBTyxDQUFDUSxXQUFXLENBQUNaLE1BQU0sQ0FBQztJQUN6QyxJQUFJLENBQUN0QixXQUFXLENBQUM7TUFBRUgsTUFBTTtNQUFFbEIsVUFBVTtNQUFFZTtJQUFNLENBQUMsRUFBRXVDLE9BQU8sRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUVWLEVBQUUsQ0FBQztFQUNoRjtFQUVBWSwyQkFBMkJBLENBQUN4RCxVQUFVLEVBQUU0QyxFQUFFLEVBQUU7SUFDMUMsSUFBSSxDQUFDRixxQkFBcUIsQ0FBQzFDLFVBQVUsRUFBRSxJQUFJeUQsZ0NBQWtCLENBQUMsQ0FBQyxFQUFFYixFQUFFLENBQUM7RUFDdEU7O0VBRUE7RUFDQTtFQUNBYyxxQkFBcUJBLENBQUMxRCxVQUFVLEVBQUU0QyxFQUFFLEVBQUU7SUFDcEMsSUFBSSxDQUFDLElBQUF0Qyx5QkFBaUIsRUFBQ04sVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJeEMsTUFBTSxDQUFDK0Msc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdQLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQyxJQUFBOEMsa0JBQVUsRUFBQ0YsRUFBRSxDQUFDLEVBQUU7TUFDbkIsTUFBTSxJQUFJbkMsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSVMsTUFBTSxHQUFHLEtBQUs7SUFDbEIsSUFBSUgsS0FBSyxHQUFHLGNBQWM7SUFDMUIsSUFBSSxDQUFDTSxXQUFXLENBQUM7TUFBRUgsTUFBTTtNQUFFbEIsVUFBVTtNQUFFZTtJQUFNLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUNsQyxDQUFDLEVBQUV5QyxRQUFRLEtBQUs7TUFDcEYsSUFBSXpDLENBQUMsRUFBRTtRQUNMLE9BQU8rRCxFQUFFLENBQUMvRCxDQUFDLENBQUM7TUFDZDtNQUNBLElBQUlzQyxXQUFXLEdBQUd4QyxZQUFZLENBQUNnRixnQ0FBZ0MsQ0FBQyxDQUFDO01BQ2pFLElBQUlDLGtCQUFrQjtNQUN0QixJQUFBcEMsaUJBQVMsRUFBQ0YsUUFBUSxFQUFFSCxXQUFXLENBQUMsQ0FDN0JtQixFQUFFLENBQUMsTUFBTSxFQUFHQyxNQUFNLElBQU1xQixrQkFBa0IsR0FBR3JCLE1BQU8sQ0FBQyxDQUNyREQsRUFBRSxDQUFDLE9BQU8sRUFBR3pELENBQUMsSUFBSytELEVBQUUsQ0FBQy9ELENBQUMsQ0FBQyxDQUFDLENBQ3pCeUQsRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNTSxFQUFFLENBQUMsSUFBSSxFQUFFZ0Isa0JBQWtCLENBQUMsQ0FBQztJQUNsRCxDQUFDLENBQUM7RUFDSjs7RUFFQTtFQUNBQyx3QkFBd0JBLENBQUM3RCxVQUFVLEVBQUVDLE1BQU0sRUFBRTZELE1BQU0sRUFBRUMsTUFBTSxFQUFFO0lBQzNELElBQUksQ0FBQyxJQUFBekQseUJBQWlCLEVBQUNOLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXhDLE1BQU0sQ0FBQytDLHNCQUFzQixDQUFDLHdCQUF3QlAsVUFBVSxFQUFFLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUMsSUFBQVEsZ0JBQVEsRUFBQ1AsTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJUSxTQUFTLENBQUMsK0JBQStCLENBQUM7SUFDdEQ7SUFDQSxJQUFJLENBQUMsSUFBQUQsZ0JBQVEsRUFBQ3NELE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSXJELFNBQVMsQ0FBQywrQkFBK0IsQ0FBQztJQUN0RDtJQUNBLElBQUksQ0FBQ3VELEtBQUssQ0FBQ0MsT0FBTyxDQUFDRixNQUFNLENBQUMsRUFBRTtNQUMxQixNQUFNLElBQUl0RCxTQUFTLENBQUMsOEJBQThCLENBQUM7SUFDckQ7SUFDQSxJQUFJeUQsUUFBUSxHQUFHLElBQUlDLGdDQUFrQixDQUFDLElBQUksRUFBRW5FLFVBQVUsRUFBRUMsTUFBTSxFQUFFNkQsTUFBTSxFQUFFQyxNQUFNLENBQUM7SUFDL0VHLFFBQVEsQ0FBQ0UsS0FBSyxDQUFDLENBQUM7SUFFaEIsT0FBT0YsUUFBUTtFQUNqQjtBQUNGO0FBQUNqRyxPQUFBLENBQUE0QixNQUFBLEdBQUFBLE1BQUE7QUFFREEsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNkYscUJBQXFCLEdBQUcsSUFBQVcsb0JBQVMsRUFBQ3hFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzZGLHFCQUFxQixDQUFDO0FBQzFGN0QsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNkUscUJBQXFCLEdBQUcsSUFBQTJCLG9CQUFTLEVBQUN4RSxNQUFNLENBQUNoQyxTQUFTLENBQUM2RSxxQkFBcUIsQ0FBQztBQUMxRjdDLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzJGLDJCQUEyQixHQUFHLElBQUFhLG9CQUFTLEVBQUN4RSxNQUFNLENBQUNoQyxTQUFTLENBQUMyRiwyQkFBMkIsQ0FBQzs7QUFFdEc7QUFDQTNELE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3lHLFVBQVUsR0FBRyxJQUFBQyx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDeUcsVUFBVSxDQUFDO0FBQ3RFekUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDMkcsWUFBWSxHQUFHLElBQUFELHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUMyRyxZQUFZLENBQUM7QUFDMUUzRSxNQUFNLENBQUNoQyxTQUFTLENBQUM0RyxZQUFZLEdBQUcsSUFBQUYsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzRHLFlBQVksQ0FBQztBQUMxRTVFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzZHLFdBQVcsR0FBRyxJQUFBSCx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNkcsV0FBVyxDQUFDO0FBRXhFN0UsTUFBTSxDQUFDaEMsU0FBUyxDQUFDOEcsU0FBUyxHQUFHLElBQUFKLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUM4RyxTQUFTLENBQUM7QUFDcEU5RSxNQUFNLENBQUNoQyxTQUFTLENBQUMrRyxVQUFVLEdBQUcsSUFBQUwsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQytHLFVBQVUsQ0FBQztBQUN0RS9FLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2dILGdCQUFnQixHQUFHLElBQUFOLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNnSCxnQkFBZ0IsQ0FBQztBQUNsRmhGLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2lILFVBQVUsR0FBRyxJQUFBUCx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDaUgsVUFBVSxDQUFDO0FBQ3RFakYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDa0gsa0JBQWtCLEdBQUcsSUFBQVIsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2tILGtCQUFrQixDQUFDO0FBQ3RGbEYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDbUgsU0FBUyxHQUFHLElBQUFULHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNtSCxTQUFTLENBQUM7QUFDcEVuRixNQUFNLENBQUNoQyxTQUFTLENBQUNvSCxVQUFVLEdBQUcsSUFBQVYsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ29ILFVBQVUsQ0FBQztBQUN0RXBGLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3FILFlBQVksR0FBRyxJQUFBWCx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDcUgsWUFBWSxDQUFDO0FBRTFFckYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDc0gsdUJBQXVCLEdBQUcsSUFBQVosd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3NILHVCQUF1QixDQUFDO0FBQ2hHdEYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDdUgsb0JBQW9CLEdBQUcsSUFBQWIsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3VILG9CQUFvQixDQUFDO0FBQzFGdkYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDd0gsb0JBQW9CLEdBQUcsSUFBQWQsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3dILG9CQUFvQixDQUFDO0FBQzFGeEYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDeUgsa0JBQWtCLEdBQUcsSUFBQWYsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3lILGtCQUFrQixDQUFDO0FBQ3RGekYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDMEgsa0JBQWtCLEdBQUcsSUFBQWhCLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUMwSCxrQkFBa0IsQ0FBQztBQUN0RjFGLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzJILG1CQUFtQixHQUFHLElBQUFqQix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDMkgsbUJBQW1CLENBQUM7QUFDeEYzRixNQUFNLENBQUNoQyxTQUFTLENBQUM0SCxtQkFBbUIsR0FBRyxJQUFBbEIsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzRILG1CQUFtQixDQUFDO0FBQ3hGNUYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNkgsZUFBZSxHQUFHLElBQUFuQix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNkgsZUFBZSxDQUFDO0FBQ2hGN0YsTUFBTSxDQUFDaEMsU0FBUyxDQUFDOEgsZUFBZSxHQUFHLElBQUFwQix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDOEgsZUFBZSxDQUFDO0FBQ2hGOUYsTUFBTSxDQUFDaEMsU0FBUyxDQUFDK0gsZ0JBQWdCLEdBQUcsSUFBQXJCLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUMrSCxnQkFBZ0IsQ0FBQztBQUNsRi9GLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2dJLGdCQUFnQixHQUFHLElBQUF0Qix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDZ0ksZ0JBQWdCLENBQUM7QUFDbEZoRyxNQUFNLENBQUNoQyxTQUFTLENBQUNpSSxnQkFBZ0IsR0FBRyxJQUFBdkIsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2lJLGdCQUFnQixDQUFDO0FBQ2xGakcsTUFBTSxDQUFDaEMsU0FBUyxDQUFDa0ksbUJBQW1CLEdBQUcsSUFBQXhCLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNrSSxtQkFBbUIsQ0FBQztBQUN4RmxHLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ21JLGdCQUFnQixHQUFHLElBQUF6Qix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDbUksZ0JBQWdCLENBQUM7QUFDbEZuRyxNQUFNLENBQUNoQyxTQUFTLENBQUNvSSxtQkFBbUIsR0FBRyxJQUFBMUIsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ29JLG1CQUFtQixDQUFDO0FBQ3hGcEcsTUFBTSxDQUFDaEMsU0FBUyxDQUFDcUksbUJBQW1CLEdBQUcsSUFBQTNCLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNxSSxtQkFBbUIsQ0FBQztBQUN4RnJHLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3NJLG1CQUFtQixHQUFHLElBQUE1Qix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDc0ksbUJBQW1CLENBQUM7QUFDeEZ0RyxNQUFNLENBQUNoQyxTQUFTLENBQUN1SSxtQkFBbUIsR0FBRyxJQUFBN0Isd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3VJLG1CQUFtQixDQUFDO0FBQ3hGdkcsTUFBTSxDQUFDaEMsU0FBUyxDQUFDd0ksa0JBQWtCLEdBQUcsSUFBQTlCLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUN3SSxrQkFBa0IsQ0FBQztBQUN0RnhHLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3lJLGtCQUFrQixHQUFHLElBQUEvQix3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDeUksa0JBQWtCLENBQUM7QUFDdEZ6RyxNQUFNLENBQUNoQyxTQUFTLENBQUMwSSxxQkFBcUIsR0FBRyxJQUFBaEMsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzBJLHFCQUFxQixDQUFDO0FBQzVGMUcsTUFBTSxDQUFDaEMsU0FBUyxDQUFDMkksbUJBQW1CLEdBQUcsSUFBQWpDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUMySSxtQkFBbUIsQ0FBQztBQUN4RjNHLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzRJLG1CQUFtQixHQUFHLElBQUFsQyx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDNEksbUJBQW1CLENBQUM7QUFDeEY1RyxNQUFNLENBQUNoQyxTQUFTLENBQUM2SSxzQkFBc0IsR0FBRyxJQUFBbkMsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQzZJLHNCQUFzQixDQUFDO0FBQzlGN0csTUFBTSxDQUFDaEMsU0FBUyxDQUFDOEksa0JBQWtCLEdBQUcsSUFBQXBDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUM4SSxrQkFBa0IsQ0FBQztBQUN0RjlHLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQytJLGFBQWEsR0FBRyxJQUFBckMsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQytJLGFBQWEsQ0FBQztBQUM1RS9HLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ2dKLHNCQUFzQixHQUFHLElBQUF0Qyx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDZ0osc0JBQXNCLENBQUM7QUFDOUZoSCxNQUFNLENBQUNoQyxTQUFTLENBQUNpSixVQUFVLEdBQUcsSUFBQXZDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNpSixVQUFVLENBQUM7QUFDdEVqSCxNQUFNLENBQUNoQyxTQUFTLENBQUNrSixhQUFhLEdBQUcsSUFBQXhDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNrSixhQUFhLENBQUM7QUFDNUVsSCxNQUFNLENBQUNoQyxTQUFTLENBQUNtSixZQUFZLEdBQUcsSUFBQXpDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNtSixZQUFZLENBQUM7QUFDMUVuSCxNQUFNLENBQUNoQyxTQUFTLENBQUNvSixrQkFBa0IsR0FBRyxJQUFBMUMsd0JBQVcsRUFBQzFFLE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ29KLGtCQUFrQixDQUFDO0FBQ3RGcEgsTUFBTSxDQUFDaEMsU0FBUyxDQUFDcUosa0JBQWtCLEdBQUcsSUFBQTNDLHdCQUFXLEVBQUMxRSxNQUFNLENBQUNoQyxTQUFTLENBQUNxSixrQkFBa0IsQ0FBQztBQUN0RnJILE1BQU0sQ0FBQ2hDLFNBQVMsQ0FBQ3NKLG1CQUFtQixHQUFHLElBQUE1Qyx3QkFBVyxFQUFDMUUsTUFBTSxDQUFDaEMsU0FBUyxDQUFDc0osbUJBQW1CLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=