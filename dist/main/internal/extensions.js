"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var stream = _interopRequireWildcard(require("stream"), true);
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helper = require("./helper.js");
var _response = require("./response.js");
var _xmlParser = require("./xml-parser.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2020 MinIO, Inc.
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

class Extensions {
  constructor(client) {
    this.client = client;
  }

  /**
   * List the objects in the bucket using S3 ListObjects V2 With Metadata
   *
   * @param bucketName - name of the bucket
   * @param prefix - the prefix of the objects that should be listed (optional, default `''`)
   * @param recursive - `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
   * @param startAfter - Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
   * @returns stream emitting the objects in the bucket, the object is of the format:
   */
  listObjectsV2WithMetadata(bucketName, prefix, recursive, startAfter) {
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
    const delimiter = recursive ? '' : '/';
    return stream.Readable.from(this.listObjectsV2WithMetadataGen(bucketName, prefix, delimiter, startAfter), {
      objectMode: true
    });
  }
  async *listObjectsV2WithMetadataGen(bucketName, prefix, delimiter, startAfter) {
    let ended = false;
    let continuationToken = '';
    do {
      const result = await this.listObjectsV2WithMetadataQuery(bucketName, prefix, continuationToken, delimiter, startAfter);
      ended = !result.isTruncated;
      continuationToken = result.nextContinuationToken;
      for (const obj of result.objects) {
        yield obj;
      }
    } while (!ended);
  }
  async listObjectsV2WithMetadataQuery(bucketName, prefix, continuationToken, delimiter, startAfter) {
    const queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    queries.push(`metadata=true`);
    if (continuationToken) {
      continuationToken = (0, _helper.uriEscape)(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = (0, _helper.uriEscape)(startAfter);
      queries.push(`start-after=${startAfter}`);
    }
    queries.push(`max-keys=1000`);
    queries.sort();
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.client.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return (0, _xmlParser.parseListObjectsV2WithMetadata)(await (0, _response.readAsString)(res));
  }
}
exports.Extensions = Extensions;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJzdHJlYW0iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJlcnJvcnMiLCJfaGVscGVyIiwiX3Jlc3BvbnNlIiwiX3htbFBhcnNlciIsImUiLCJ0IiwiV2Vha01hcCIsInIiLCJuIiwiX19lc01vZHVsZSIsIm8iLCJpIiwiZiIsIl9fcHJvdG9fXyIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsIkV4dGVuc2lvbnMiLCJjb25zdHJ1Y3RvciIsImNsaWVudCIsImxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEiLCJidWNrZXROYW1lIiwicHJlZml4IiwicmVjdXJzaXZlIiwic3RhcnRBZnRlciIsInVuZGVmaW5lZCIsImlzVmFsaWRCdWNrZXROYW1lIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImlzVmFsaWRQcmVmaXgiLCJJbnZhbGlkUHJlZml4RXJyb3IiLCJpc1N0cmluZyIsIlR5cGVFcnJvciIsImlzQm9vbGVhbiIsImRlbGltaXRlciIsIlJlYWRhYmxlIiwiZnJvbSIsImxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGFHZW4iLCJvYmplY3RNb2RlIiwiZW5kZWQiLCJjb250aW51YXRpb25Ub2tlbiIsInJlc3VsdCIsImxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGFRdWVyeSIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwib2JqIiwib2JqZWN0cyIsInF1ZXJpZXMiLCJwdXNoIiwidXJpRXNjYXBlIiwic29ydCIsInF1ZXJ5IiwibGVuZ3RoIiwiam9pbiIsIm1ldGhvZCIsInJlcyIsIm1ha2VSZXF1ZXN0QXN5bmMiLCJwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEiLCJyZWFkQXNTdHJpbmciLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiZXh0ZW5zaW9ucy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxyXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDIwIE1pbklPLCBJbmMuXHJcbiAqXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XHJcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cclxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XHJcbiAqXHJcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcclxuICpcclxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxyXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXHJcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxyXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXHJcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcclxuXHJcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXHJcbmltcG9ydCB0eXBlIHsgVHlwZWRDbGllbnQgfSBmcm9tICcuL2NsaWVudC50cydcclxuaW1wb3J0IHsgaXNCb29sZWFuLCBpc1N0cmluZywgaXNWYWxpZEJ1Y2tldE5hbWUsIGlzVmFsaWRQcmVmaXgsIHVyaUVzY2FwZSB9IGZyb20gJy4vaGVscGVyLnRzJ1xyXG5pbXBvcnQgeyByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGEsIEJ1Y2tldFN0cmVhbSB9IGZyb20gJy4vdHlwZS50cydcclxuaW1wb3J0IHsgcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIH0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xyXG5cclxuZXhwb3J0IGNsYXNzIEV4dGVuc2lvbnMge1xyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgY2xpZW50OiBUeXBlZENsaWVudCkge31cclxuXHJcbiAgLyoqXHJcbiAgICogTGlzdCB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0IHVzaW5nIFMzIExpc3RPYmplY3RzIFYyIFdpdGggTWV0YWRhdGFcclxuICAgKlxyXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gbmFtZSBvZiB0aGUgYnVja2V0XHJcbiAgICogQHBhcmFtIHByZWZpeCAtIHRoZSBwcmVmaXggb2YgdGhlIG9iamVjdHMgdGhhdCBzaG91bGQgYmUgbGlzdGVkIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxyXG4gICAqIEBwYXJhbSByZWN1cnNpdmUgLSBgdHJ1ZWAgaW5kaWNhdGVzIHJlY3Vyc2l2ZSBzdHlsZSBsaXN0aW5nIGFuZCBgZmFsc2VgIGluZGljYXRlcyBkaXJlY3Rvcnkgc3R5bGUgbGlzdGluZyBkZWxpbWl0ZWQgYnkgJy8nLiAob3B0aW9uYWwsIGRlZmF1bHQgYGZhbHNlYClcclxuICAgKiBAcGFyYW0gc3RhcnRBZnRlciAtIFNwZWNpZmllcyB0aGUga2V5IHRvIHN0YXJ0IGFmdGVyIHdoZW4gbGlzdGluZyBvYmplY3RzIGluIGEgYnVja2V0LiAob3B0aW9uYWwsIGRlZmF1bHQgYCcnYClcclxuICAgKiBAcmV0dXJucyBzdHJlYW0gZW1pdHRpbmcgdGhlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCwgdGhlIG9iamVjdCBpcyBvZiB0aGUgZm9ybWF0OlxyXG4gICAqL1xyXG4gIHB1YmxpYyBsaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgcHJlZml4Pzogc3RyaW5nLFxyXG4gICAgcmVjdXJzaXZlPzogYm9vbGVhbixcclxuICAgIHN0YXJ0QWZ0ZXI/OiBzdHJpbmcsXHJcbiAgKTogQnVja2V0U3RyZWFtPEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+IHtcclxuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBwcmVmaXggPSAnJ1xyXG4gICAgfVxyXG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXHJcbiAgICB9XHJcbiAgICBpZiAoc3RhcnRBZnRlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHN0YXJ0QWZ0ZXIgPSAnJ1xyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xyXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxyXG4gICAgfVxyXG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcclxuICAgIH1cclxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xyXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXHJcbiAgICB9XHJcbiAgICBpZiAoIWlzU3RyaW5nKHN0YXJ0QWZ0ZXIpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXHJcbiAgICB9XHJcblxyXG4gICAgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXHJcbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xyXG4gICAgcmV0dXJuIHN0cmVhbS5SZWFkYWJsZS5mcm9tKHRoaXMubGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YUdlbihidWNrZXROYW1lLCBwcmVmaXgsIGRlbGltaXRlciwgc3RhcnRBZnRlciksIHtcclxuICAgICAgb2JqZWN0TW9kZTogdHJ1ZSxcclxuICAgIH0pXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jICpsaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhR2VuKFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgcHJlZml4OiBzdHJpbmcsXHJcbiAgICBkZWxpbWl0ZXI6IHN0cmluZyxcclxuICAgIHN0YXJ0QWZ0ZXI6IHN0cmluZyxcclxuICApOiBBc3luY0l0ZXJhYmxlPEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+IHtcclxuICAgIGxldCBlbmRlZCA9IGZhbHNlXHJcbiAgICBsZXQgY29udGludWF0aW9uVG9rZW4gPSAnJ1xyXG4gICAgZG8ge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGFRdWVyeShcclxuICAgICAgICBidWNrZXROYW1lLFxyXG4gICAgICAgIHByZWZpeCxcclxuICAgICAgICBjb250aW51YXRpb25Ub2tlbixcclxuICAgICAgICBkZWxpbWl0ZXIsXHJcbiAgICAgICAgc3RhcnRBZnRlcixcclxuICAgICAgKVxyXG4gICAgICBlbmRlZCA9ICFyZXN1bHQuaXNUcnVuY2F0ZWRcclxuICAgICAgY29udGludWF0aW9uVG9rZW4gPSByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuXHJcbiAgICAgIGZvciAoY29uc3Qgb2JqIG9mIHJlc3VsdC5vYmplY3RzKSB7XHJcbiAgICAgICAgeWllbGQgb2JqXHJcbiAgICAgIH1cclxuICAgIH0gd2hpbGUgKCFlbmRlZClcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgbGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YVF1ZXJ5KFxyXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxyXG4gICAgcHJlZml4OiBzdHJpbmcsXHJcbiAgICBjb250aW51YXRpb25Ub2tlbjogc3RyaW5nLFxyXG4gICAgZGVsaW1pdGVyOiBzdHJpbmcsXHJcbiAgICBzdGFydEFmdGVyOiBzdHJpbmcsXHJcbiAgKSB7XHJcbiAgICBjb25zdCBxdWVyaWVzID0gW11cclxuXHJcbiAgICAvLyBDYWxsIGZvciBsaXN0aW5nIG9iamVjdHMgdjIgQVBJXHJcbiAgICBxdWVyaWVzLnB1c2goYGxpc3QtdHlwZT0yYClcclxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxyXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcclxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcclxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcclxuICAgIHF1ZXJpZXMucHVzaChgbWV0YWRhdGE9dHJ1ZWApXHJcblxyXG4gICAgaWYgKGNvbnRpbnVhdGlvblRva2VuKSB7XHJcbiAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gdXJpRXNjYXBlKGNvbnRpbnVhdGlvblRva2VuKVxyXG4gICAgICBxdWVyaWVzLnB1c2goYGNvbnRpbnVhdGlvbi10b2tlbj0ke2NvbnRpbnVhdGlvblRva2VufWApXHJcbiAgICB9XHJcbiAgICAvLyBTZXQgc3RhcnQtYWZ0ZXJcclxuICAgIGlmIChzdGFydEFmdGVyKSB7XHJcbiAgICAgIHN0YXJ0QWZ0ZXIgPSB1cmlFc2NhcGUoc3RhcnRBZnRlcilcclxuICAgICAgcXVlcmllcy5wdXNoKGBzdGFydC1hZnRlcj0ke3N0YXJ0QWZ0ZXJ9YClcclxuICAgIH1cclxuICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9MTAwMGApXHJcbiAgICBxdWVyaWVzLnNvcnQoKVxyXG4gICAgbGV0IHF1ZXJ5ID0gJydcclxuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXHJcbiAgICB9XHJcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xyXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5jbGllbnQubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcclxuICAgIHJldHVybiBwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEoYXdhaXQgcmVhZEFzU3RyaW5nKHJlcykpXHJcbiAgfVxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFnQkEsSUFBQUEsTUFBQSxHQUFBQyx1QkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsTUFBQSxHQUFBRix1QkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUUsT0FBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsU0FBQSxHQUFBSCxPQUFBO0FBRUEsSUFBQUksVUFBQSxHQUFBSixPQUFBO0FBQWdFLFNBQUFELHdCQUFBTSxDQUFBLEVBQUFDLENBQUEsNkJBQUFDLE9BQUEsTUFBQUMsQ0FBQSxPQUFBRCxPQUFBLElBQUFFLENBQUEsT0FBQUYsT0FBQSxZQUFBUix1QkFBQSxZQUFBQSxDQUFBTSxDQUFBLEVBQUFDLENBQUEsU0FBQUEsQ0FBQSxJQUFBRCxDQUFBLElBQUFBLENBQUEsQ0FBQUssVUFBQSxTQUFB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