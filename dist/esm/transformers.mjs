/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015, 2016 MinIO, Inc.
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

import * as Crypto from "crypto";
import Through2 from 'through2';
import { isFunction } from "./internal/helper.mjs";
import * as xmlParsers from "./xml-parsers.mjs";

// getConcater returns a stream that concatenates the input and emits
// the concatenated output when 'end' has reached. If an optional
// parser function is passed upon reaching the 'end' of the stream,
// `parser(concatenated_data)` will be emitted.
export function getConcater(parser, emitError) {
  var objectMode = false;
  var bufs = [];
  if (parser && !isFunction(parser)) {
    throw new TypeError('parser should be of type "function"');
  }
  if (parser) {
    objectMode = true;
  }
  return Through2({
    objectMode
  }, function (chunk, enc, cb) {
    bufs.push(chunk);
    cb();
  }, function (cb) {
    if (emitError) {
      cb(parser(Buffer.concat(bufs).toString()));
      // cb(e) would mean we have to emit 'end' by explicitly calling this.push(null)
      this.push(null);
      return;
    }
    if (bufs.length) {
      if (parser) {
        this.push(parser(Buffer.concat(bufs).toString()));
      } else {
        this.push(Buffer.concat(bufs));
      }
    }
    cb();
  });
}

// A through stream that calculates md5sum and sha256sum
export function getHashSummer(enableSHA256) {
  var md5 = Crypto.createHash('md5');
  var sha256 = Crypto.createHash('sha256');
  return Through2.obj(function (chunk, enc, cb) {
    if (enableSHA256) {
      sha256.update(chunk);
    } else {
      md5.update(chunk);
    }
    cb();
  }, function (cb) {
    var md5sum = '';
    var sha256sum = '';
    if (enableSHA256) {
      sha256sum = sha256.digest('hex');
    } else {
      md5sum = md5.digest('base64');
    }
    var hashData = {
      md5sum,
      sha256sum
    };
    this.push(hashData);
    this.push(null);
    cb();
  });
}

// Following functions return a stream object that parses XML
// and emits suitable Javascript objects.

// Parses listObjects response.
export function getListObjectsV2Transformer() {
  return getConcater(xmlParsers.parseListObjectsV2);
}

// Parses listObjects with metadata response.
export function getListObjectsV2WithMetadataTransformer() {
  return getConcater(xmlParsers.parseListObjectsV2WithMetadata);
}

// Parses GET/SET BucketNotification response
export function getBucketNotificationTransformer() {
  return getConcater(xmlParsers.parseBucketNotification);
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJDcnlwdG8iLCJUaHJvdWdoMiIsImlzRnVuY3Rpb24iLCJ4bWxQYXJzZXJzIiwiZ2V0Q29uY2F0ZXIiLCJwYXJzZXIiLCJlbWl0RXJyb3IiLCJvYmplY3RNb2RlIiwiYnVmcyIsIlR5cGVFcnJvciIsImNodW5rIiwiZW5jIiwiY2IiLCJwdXNoIiwiQnVmZmVyIiwiY29uY2F0IiwidG9TdHJpbmciLCJsZW5ndGgiLCJnZXRIYXNoU3VtbWVyIiwiZW5hYmxlU0hBMjU2IiwibWQ1IiwiY3JlYXRlSGFzaCIsInNoYTI1NiIsIm9iaiIsInVwZGF0ZSIsIm1kNXN1bSIsInNoYTI1NnN1bSIsImRpZ2VzdCIsImhhc2hEYXRhIiwiZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyIiwicGFyc2VMaXN0T2JqZWN0c1YyIiwiZ2V0TGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YVRyYW5zZm9ybWVyIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIiLCJwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbiJdLCJzb3VyY2VzIjpbInRyYW5zZm9ybWVycy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxyXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1LCAyMDE2IE1pbklPLCBJbmMuXHJcbiAqXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XHJcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cclxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XHJcbiAqXHJcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcclxuICpcclxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxyXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXHJcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxyXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXHJcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxyXG4gKi9cclxuXHJcbmltcG9ydCAqIGFzIENyeXB0byBmcm9tICdub2RlOmNyeXB0bydcclxuXHJcbmltcG9ydCBUaHJvdWdoMiBmcm9tICd0aHJvdWdoMidcclxuXHJcbmltcG9ydCB7IGlzRnVuY3Rpb24gfSBmcm9tICcuL2ludGVybmFsL2hlbHBlci50cydcclxuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXJzLmpzJ1xyXG5cclxuLy8gZ2V0Q29uY2F0ZXIgcmV0dXJucyBhIHN0cmVhbSB0aGF0IGNvbmNhdGVuYXRlcyB0aGUgaW5wdXQgYW5kIGVtaXRzXHJcbi8vIHRoZSBjb25jYXRlbmF0ZWQgb3V0cHV0IHdoZW4gJ2VuZCcgaGFzIHJlYWNoZWQuIElmIGFuIG9wdGlvbmFsXHJcbi8vIHBhcnNlciBmdW5jdGlvbiBpcyBwYXNzZWQgdXBvbiByZWFjaGluZyB0aGUgJ2VuZCcgb2YgdGhlIHN0cmVhbSxcclxuLy8gYHBhcnNlcihjb25jYXRlbmF0ZWRfZGF0YSlgIHdpbGwgYmUgZW1pdHRlZC5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldENvbmNhdGVyKHBhcnNlciwgZW1pdEVycm9yKSB7XHJcbiAgdmFyIG9iamVjdE1vZGUgPSBmYWxzZVxyXG4gIHZhciBidWZzID0gW11cclxuXHJcbiAgaWYgKHBhcnNlciAmJiAhaXNGdW5jdGlvbihwYXJzZXIpKSB7XHJcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXJzZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcclxuICB9XHJcblxyXG4gIGlmIChwYXJzZXIpIHtcclxuICAgIG9iamVjdE1vZGUgPSB0cnVlXHJcbiAgfVxyXG5cclxuICByZXR1cm4gVGhyb3VnaDIoXHJcbiAgICB7IG9iamVjdE1vZGUgfSxcclxuICAgIGZ1bmN0aW9uIChjaHVuaywgZW5jLCBjYikge1xyXG4gICAgICBidWZzLnB1c2goY2h1bmspXHJcbiAgICAgIGNiKClcclxuICAgIH0sXHJcbiAgICBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgaWYgKGVtaXRFcnJvcikge1xyXG4gICAgICAgIGNiKHBhcnNlcihCdWZmZXIuY29uY2F0KGJ1ZnMpLnRvU3RyaW5nKCkpKVxyXG4gICAgICAgIC8vIGNiKGUpIHdvdWxkIG1lYW4gd2UgaGF2ZSB0byBlbWl0ICdlbmQnIGJ5IGV4cGxpY2l0bHkgY2FsbGluZyB0aGlzLnB1c2gobnVsbClcclxuICAgICAgICB0aGlzLnB1c2gobnVsbClcclxuICAgICAgICByZXR1cm5cclxuICAgICAgfVxyXG4gICAgICBpZiAoYnVmcy5sZW5ndGgpIHtcclxuICAgICAgICBpZiAocGFyc2VyKSB7XHJcbiAgICAgICAgICB0aGlzLnB1c2gocGFyc2VyKEJ1ZmZlci5jb25jYXQoYnVmcykudG9TdHJpbmcoKSkpXHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHRoaXMucHVzaChCdWZmZXIuY29uY2F0KGJ1ZnMpKVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBjYigpXHJcbiAgICB9LFxyXG4gIClcclxufVxyXG5cclxuLy8gQSB0aHJvdWdoIHN0cmVhbSB0aGF0IGNhbGN1bGF0ZXMgbWQ1c3VtIGFuZCBzaGEyNTZzdW1cclxuZXhwb3J0IGZ1bmN0aW9uIGdldEhhc2hTdW1tZXIoZW5hYmxlU0hBMjU2KSB7XHJcbiAgdmFyIG1kNSA9IENyeXB0by5jcmVhdGVIYXNoKCdtZDUnKVxyXG4gIHZhciBzaGEyNTYgPSBDcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JylcclxuXHJcbiAgcmV0dXJuIFRocm91Z2gyLm9iaihcclxuICAgIGZ1bmN0aW9uIChjaHVuaywgZW5jLCBjYikge1xyXG4gICAgICBpZiAoZW5hYmxlU0hBMjU2KSB7XHJcbiAgICAgICAgc2hhMjU2LnVwZGF0ZShjaHVuaylcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBtZDUudXBkYXRlKGNodW5rKVxyXG4gICAgICB9XHJcbiAgICAgIGNiKClcclxuICAgIH0sXHJcbiAgICBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgdmFyIG1kNXN1bSA9ICcnXHJcbiAgICAgIHZhciBzaGEyNTZzdW0gPSAnJ1xyXG4gICAgICBpZiAoZW5hYmxlU0hBMjU2KSB7XHJcbiAgICAgICAgc2hhMjU2c3VtID0gc2hhMjU2LmRpZ2VzdCgnaGV4JylcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBtZDVzdW0gPSBtZDUuZGlnZXN0KCdiYXNlNjQnKVxyXG4gICAgICB9XHJcbiAgICAgIHZhciBoYXNoRGF0YSA9IHsgbWQ1c3VtLCBzaGEyNTZzdW0gfVxyXG4gICAgICB0aGlzLnB1c2goaGFzaERhdGEpXHJcbiAgICAgIHRoaXMucHVzaChudWxsKVxyXG4gICAgICBjYigpXHJcbiAgICB9LFxyXG4gIClcclxufVxyXG5cclxuLy8gRm9sbG93aW5nIGZ1bmN0aW9ucyByZXR1cm4gYSBzdHJlYW0gb2JqZWN0IHRoYXQgcGFyc2VzIFhNTFxyXG4vLyBhbmQgZW1pdHMgc3VpdGFibGUgSmF2YXNjcmlwdCBvYmplY3RzLlxyXG5cclxuLy8gUGFyc2VzIGxpc3RPYmplY3RzIHJlc3BvbnNlLlxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyKCkge1xyXG4gIHJldHVybiBnZXRDb25jYXRlcih4bWxQYXJzZXJzLnBhcnNlTGlzdE9iamVjdHNWMilcclxufVxyXG5cclxuLy8gUGFyc2VzIGxpc3RPYmplY3RzIHdpdGggbWV0YWRhdGEgcmVzcG9uc2UuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhVHJhbnNmb3JtZXIoKSB7XHJcbiAgcmV0dXJuIGdldENvbmNhdGVyKHhtbFBhcnNlcnMucGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKVxyXG59XHJcblxyXG4vLyBQYXJzZXMgR0VUL1NFVCBCdWNrZXROb3RpZmljYXRpb24gcmVzcG9uc2VcclxuZXhwb3J0IGZ1bmN0aW9uIGdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyKCkge1xyXG4gIHJldHVybiBnZXRDb25jYXRlcih4bWxQYXJzZXJzLnBhcnNlQnVja2V0Tm90aWZpY2F0aW9uKVxyXG59XHJcbiJdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE9BQU8sS0FBS0EsTUFBTTtBQUVsQixPQUFPQyxRQUFRLE1BQU0sVUFBVTtBQUUvQixTQUFTQyxVQUFVLFFBQVEsdUJBQXNCO0FBQ2pELE9BQU8sS0FBS0MsVUFBVSxNQUFNLG1CQUFrQjs7QUFFOUM7QUFDQTtBQUNBO0FBQ0E7QUFDQSxPQUFPLFNBQVNDLFdBQVdBLENBQUNDLE1BQU0sRUFBRUMsU0FBUyxFQUFFO0VBQzdDLElBQUlDLFVBQVUsR0FBRyxLQUFLO0VBQ3RCLElBQUlDLElBQUksR0FBRyxFQUFFO0VBRWIsSUFBSUgsTUFBTSxJQUFJLENBQUNILFVBQVUsQ0FBQ0csTUFBTSxDQUFDLEVBQUU7SUFDakMsTUFBTSxJQUFJSSxTQUFTLENBQUMscUNBQXFDLENBQUM7RUFDNUQ7RUFFQSxJQUFJSixNQUFNLEVBQUU7SUFDVkUsVUFBVSxHQUFHLElBQUk7RUFDbkI7RUFFQSxPQUFPTixRQUFRLENBQ2I7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