"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketEncryptionConfig = parseBucketEncryptionConfig;
exports.parseBucketRegion = parseBucketRegion;
exports.parseBucketVersioningConfig = parseBucketVersioningConfig;
exports.parseCompleteMultipart = parseCompleteMultipart;
exports.parseCopyObject = parseCopyObject;
exports.parseError = parseError;
exports.parseInitiateMultipart = parseInitiateMultipart;
exports.parseLifecycleConfig = parseLifecycleConfig;
exports.parseListBucket = parseListBucket;
exports.parseListMultipart = parseListMultipart;
exports.parseListObjects = parseListObjects;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseListParts = parseListParts;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectLockConfig = parseObjectLockConfig;
exports.parseObjectRetentionConfig = parseObjectRetentionConfig;
exports.parseReplicationConfig = parseReplicationConfig;
exports.parseResponseError = parseResponseError;
exports.parseSelectObjectContentResponse = parseSelectObjectContentResponse;
exports.parseTagging = parseTagging;
exports.removeObjectsParser = removeObjectsParser;
exports.uploadPartParser = uploadPartParser;
var _bufferCrc = require("buffer-crc32");
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _helper = require("./helper.js");
var _response = require("./response.js");
var _type = require("./type.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// parse XML response for bucket region
function parseBucketRegion(xml) {
  // return region information
  return (0, _helper.parseXml)(xml).LocationConstraint;
}
const fxp = new _fastXmlParser.XMLParser();
const fxpWithoutNumParser = new _fastXmlParser.XMLParser({
  // @ts-ignore
  numberParseOptions: {
    skipLike: /./
  }
});

// Parse XML and return information as Javascript types
// parse error XML response
function parseError(xml, headerInfo) {
  let xmlErr = {};
  const xmlObj = fxp.parse(xml);
  if (xmlObj.Error) {
    xmlErr = xmlObj.Error;
  }
  const e = new errors.S3Error();
  Object.entries(xmlErr).forEach(([key, value]) => {
    e[key.toLowerCase()] = value;
  });
  Object.entries(headerInfo).forEach(([key, value]) => {
    e[key] = value;
  });
  return e;
}

// Generates an Error object depending on http statusCode and XML body
async function parseResponseError(response) {
  const statusCode = response.statusCode;
  let code = '',
    message = '';
  if (statusCode === 301) {
    code = 'MovedPermanently';
    message = 'Moved Permanently';
  } else if (statusCode === 307) {
    code = 'TemporaryRedirect';
    message = 'Are you using the correct endpoint URL?';
  } else if (statusCode === 403) {
    code = 'AccessDenied';
    message = 'Valid and authorized credentials required';
  } else if (statusCode === 404) {
    code = 'NotFound';
    message = 'Not Found';
  } else if (statusCode === 405) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 501) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 503) {
    code = 'SlowDown';
    message = 'Please reduce your request rate.';
  } else {
    const hErrCode = response.headers['x-minio-error-code'];
    const hErrDesc = response.headers['x-minio-error-desc'];
    if (hErrCode && hErrDesc) {
      code = hErrCode;
      message = hErrDesc;
    }
  }
  const headerInfo = {};
  // A value created by S3 compatible server that uniquely identifies the request.
  headerInfo.amzRequestid = response.headers['x-amz-request-id'];
  // A special token that helps troubleshoot API replies and issues.
  headerInfo.amzId2 = response.headers['x-amz-id-2'];

  // Region where the bucket is located. This header is returned only
  // in HEAD bucket and ListObjects response.
  headerInfo.amzBucketRegion = response.headers['x-amz-bucket-region'];
  const xmlString = await (0, _response.readAsString)(response);
  if (xmlString) {
    throw parseError(xmlString, headerInfo);
  }

  // Message should be instantiated for each S3Errors.
  const e = new errors.S3Error(message, {
    cause: headerInfo
  });
  // S3 Error code.
  e.code = code;
  Object.entries(headerInfo).forEach(([key, value]) => {
    // @ts-expect-error force set error properties
    e[key] = value;
  });
  throw e;
}

/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      const name = (0, _helper.sanitizeObjectKey)(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = (0, _helper.sanitizeETag)(content.ETag);
      const size = content.Size;
      let tags = {};
      if (content.UserTags != null) {
        (0, _helper.toArray)(content.UserTags.split('&')).forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value;
        });
      } else {
        tags = {};
      }
      let metadata;
      if (content.UserMetadata != null) {
        metadata = (0, _helper.toArray)(content.UserMetadata)[0];
      } else {
        metadata = null;
      }
      result.objects.push({
        name,
        lastModified,
        etag,
        size,
        metadata,
        tags
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
// parse XML response for list parts of an in progress multipart upload
function parseListParts(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  const result = {
    isTruncated: false,
    parts: [],
    marker: 0
  };
  if (!xmlobj.ListPartsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListPartsResult"');
  }
  xmlobj = xmlobj.ListPartsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextPartNumberMarker) {
    result.marker = (0, _helper.toArray)(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    (0, _helper.toArray)(xmlobj.Part).forEach(p => {
      const part = parseInt((0, _helper.toArray)(p.PartNumber)[0], 10);
      const lastModified = new Date(p.LastModified);
      const etag = p.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
      result.parts.push({
        part,
        lastModified,
        etag,
        size: parseInt(p.Size, 10)
      });
    });
  }
  return result;
}
function parseListBucket(xml) {
  let result = [];
  const listBucketResultParser = new _fastXmlParser.XMLParser({
    parseTagValue: true,
    // Enable parsing of values
    numberParseOptions: {
      leadingZeros: false,
      // Disable number parsing for values with leading zeros
      hex: false,
      // Disable hex number parsing - Invalid bucket name
      skipLike: /^[0-9]+$/ // Skip number parsing if the value consists entirely of digits
    },
    tagValueProcessor: (tagName, tagValue = '') => {
      // Ensure that the Name tag is always treated as a string
      if (tagName === 'Name') {
        return tagValue.toString();
      }
      return tagValue;
    },
    ignoreAttributes: false // Ensure that all attributes are parsed
  });
  const parsedXmlRes = listBucketResultParser.parse(xml);
  if (!parsedXmlRes.ListAllMyBucketsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListAllMyBucketsResult"');
  }
  const {
    ListAllMyBucketsResult: {
      Buckets = {}
    } = {}
  } = parsedXmlRes;
  if (Buckets.Bucket) {
    result = (0, _helper.toArray)(Buckets.Bucket).map((bucket = {}) => {
      const {
        Name: bucketName,
        CreationDate
      } = bucket;
      const creationDate = new Date(CreationDate);
      return {
        name: bucketName,
        creationDate
      };
    });
  }
  return result;
}
function parseInitiateMultipart(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
function parseReplicationConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: (0, _helper.toArray)(Rule)
    }
  };
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function parseTagging(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if (Array.isArray(tagResult)) {
      result = [...tagResult];
    } else {
      result.push(tagResult);
    }
  }
  return result;
}

// parse XML response when a multipart upload is completed
function parseCompleteMultipart(xml) {
  const xmlobj = (0, _helper.parseXml)(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = (0, _helper.toArray)(xmlobj.Location)[0];
    const bucket = (0, _helper.toArray)(xmlobj.Bucket)[0];
    const key = xmlobj.Key;
    const etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
    return {
      location,
      bucket,
      key,
      etag
    };
  }
  // Complete Multipart can return XML Error after a 200 OK response
  if (xmlobj.Code && xmlobj.Message) {
    const errCode = (0, _helper.toArray)(xmlobj.Code)[0];
    const errMessage = (0, _helper.toArray)(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListMultipartUploadsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListMultipartUploadsResult"');
  }
  xmlobj = xmlobj.ListMultipartUploadsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextKeyMarker) {
    result.nextKeyMarker = xmlobj.NextKeyMarker;
  }
  if (xmlobj.NextUploadIdMarker) {
    result.nextUploadIdMarker = xmlobj.nextUploadIdMarker || '';
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    (0, _helper.toArray)(xmlobj.Upload).forEach(upload => {
      const uploadItem = {
        key: upload.Key,
        uploadId: upload.UploadId,
        storageClass: upload.StorageClass,
        initiated: new Date(upload.Initiated)
      };
      if (upload.Initiator) {
        uploadItem.initiator = {
          id: upload.Initiator.ID,
          displayName: upload.Initiator.DisplayName
        };
      }
      if (upload.Owner) {
        uploadItem.owner = {
          id: upload.Owner.ID,
          displayName: upload.Owner.DisplayName
        };
      }
      result.uploads.push(uploadItem);
    });
  }
  return result;
}
function parseObjectLockConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let lockConfigResult = {};
  if (xmlObj.ObjectLockConfiguration) {
    lockConfigResult = {
      objectLockEnabled: xmlObj.ObjectLockConfiguration.ObjectLockEnabled
    };
    let retentionResp;
    if (xmlObj.ObjectLockConfiguration && xmlObj.ObjectLockConfiguration.Rule && xmlObj.ObjectLockConfiguration.Rule.DefaultRetention) {
      retentionResp = xmlObj.ObjectLockConfiguration.Rule.DefaultRetention || {};
      lockConfigResult.mode = retentionResp.Mode;
    }
    if (retentionResp) {
      const isUnitYears = retentionResp.Years;
      if (isUnitYears) {
        lockConfigResult.validity = isUnitYears;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
function parseBucketVersioningConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.VersioningConfiguration;
}

// Used only in selectObjectContent API.
// extractHeaderType extracts the first half of the header message, the header type.
function extractHeaderType(stream) {
  const headerNameLen = Buffer.from(stream.read(1)).readUInt8();
  const headerNameWithSeparator = Buffer.from(stream.read(headerNameLen)).toString();
  const splitBySeparator = (headerNameWithSeparator || '').split(':');
  return splitBySeparator.length >= 1 ? splitBySeparator[1] : '';
}
function extractHeaderValue(stream) {
  const bodyLen = Buffer.from(stream.read(2)).readUInt16BE();
  return Buffer.from(stream.read(bodyLen)).toString();
}
function parseSelectObjectContentResponse(res) {
  const selectResults = new _helpers.SelectResults({}); // will be returned

  const responseStream = (0, _helper.readableStream)(res); // convert byte array to a readable responseStream
  // @ts-ignore
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = _bufferCrc(preludeCrcBuffer, msgCrcAccumulator);
    const totalMsgLength = totalByteLengthBuffer.readInt32BE();
    const headerLength = headerBytesBuffer.readInt32BE();
    const preludeCrcByteValue = preludeCrcBuffer.readInt32BE();
    if (preludeCrcByteValue !== calculatedPreludeCrc) {
      // Handle Header CRC mismatch Error
      throw new Error(`Header Checksum Mismatch, Prelude CRC of ${preludeCrcByteValue} does not equal expected CRC of ${calculatedPreludeCrc}`);
    }
    const headers = {};
    if (headerLength > 0) {
      const headerBytes = Buffer.from(responseStream.read(headerLength));
      msgCrcAccumulator = _bufferCrc(headerBytes, msgCrcAccumulator);
      const headerReaderStream = (0, _helper.readableStream)(headerBytes);
      // @ts-ignore
      while (headerReaderStream._readableState.length) {
        const headerTypeName = extractHeaderType(headerReaderStream);
        headerReaderStream.read(1); // just read and ignore it.
        if (headerTypeName) {
          headers[headerTypeName] = extractHeaderValue(headerReaderStream);
        }
      }
    }
    let payloadStream;
    const payLoadLength = totalMsgLength - headerLength - 16;
    if (payLoadLength > 0) {
      const payLoadBuffer = Buffer.from(responseStream.read(payLoadLength));
      msgCrcAccumulator = _bufferCrc(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = (0, _helper.readableStream)(payLoadBuffer);
    }
    const messageType = headers['message-type'];
    switch (messageType) {
      case 'error':
        {
          const errorMessage = headers['error-code'] + ':"' + headers['error-message'] + '"';
          throw new Error(errorMessage);
        }
      case 'event':
        {
          const contentType = headers['content-type'];
          const eventType = headers['event-type'];
          switch (eventType) {
            case 'End':
              {
                selectResults.setResponse(res);
                return selectResults;
              }
            case 'Records':
              {
                var _payloadStream;
                const readData = (_payloadStream = payloadStream) === null || _payloadStream === void 0 ? void 0 : _payloadStream.read(payLoadLength);
                selectResults.setRecords(readData);
                break;
              }
            case 'Progress':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream2;
                      const progressData = (_payloadStream2 = payloadStream) === null || _payloadStream2 === void 0 ? void 0 : _payloadStream2.read(payLoadLength);
                      selectResults.setProgress(progressData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Progress`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            case 'Stats':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream3;
                      const statsData = (_payloadStream3 = payloadStream) === null || _payloadStream3 === void 0 ? void 0 : _payloadStream3.read(payLoadLength);
                      selectResults.setStats(statsData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Stats`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            default:
              {
                // Continuation message: Not sure if it is supported. did not find a reference or any message in response.
                // It does not have a payload.
                const warningMessage = `Un implemented event detected  ${messageType}.`;
                // eslint-disable-next-line no-console
                console.warn(warningMessage);
              }
          }
        }
    }
  }
}
function parseLifecycleConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LifecycleConfiguration;
}
function parseBucketEncryptionConfig(xml) {
  return (0, _helper.parseXml)(xml);
}
function parseObjectRetentionConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
function removeObjectsParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return (0, _helper.toArray)(xmlObj.DeleteResult.Error);
  }
  return [];
}

// parse XML response for copy object
function parseCopyObject(xml) {
  const result = {
    etag: '',
    lastModified: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.CopyObjectResult) {
    throw new errors.InvalidXMLError('Missing tag: "CopyObjectResult"');
  }
  xmlobj = xmlobj.CopyObjectResult;
  if (xmlobj.ETag) {
    result.etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
  }
  if (xmlobj.LastModified) {
    result.lastModified = new Date(xmlobj.LastModified);
  }
  return result;
}
const formatObjInfo = (content, opts = {}) => {
  const {
    Key,
    LastModified,
    ETag,
    Size,
    VersionId,
    IsLatest
  } = content;
  if (!(0, _helper.isObject)(opts)) {
    opts = {};
  }
  const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(Key)[0] || '');
  const lastModified = LastModified ? new Date((0, _helper.toArray)(LastModified)[0] || '') : undefined;
  const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(ETag)[0] || '');
  const size = (0, _helper.sanitizeSize)(Size || '');
  return {
    name,
    lastModified,
    etag,
    size,
    versionId: VersionId,
    isLatest: IsLatest,
    isDeleteMarker: opts.IsDeleteMarker ? opts.IsDeleteMarker : false
  };
};

// parse XML response for list objects in a bucket
function parseListObjects(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextMarker: undefined,
    versionIdMarker: undefined,
    keyMarker: undefined
  };
  let isTruncated = false;
  let nextMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = commonPrefixEntry => {
    if (commonPrefixEntry) {
      (0, _helper.toArray)(commonPrefixEntry).forEach(commonPrefix => {
        result.objects.push({
          prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0] || ''),
          size: 0
        });
      });
    }
  };
  const listBucketResult = xmlobj.ListBucketResult;
  const listVersionsResult = xmlobj.ListVersionsResult;
  if (listBucketResult) {
    if (listBucketResult.IsTruncated) {
      isTruncated = listBucketResult.IsTruncated;
    }
    if (listBucketResult.Contents) {
      (0, _helper.toArray)(listBucketResult.Contents).forEach(content => {
        const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0] || '');
        const lastModified = new Date((0, _helper.toArray)(content.LastModified)[0] || '');
        const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(content.ETag)[0] || '');
        const size = (0, _helper.sanitizeSize)(content.Size || '');
        result.objects.push({
          name,
          lastModified,
          etag,
          size
        });
      });
    }
    if (listBucketResult.Marker) {
      nextMarker = listBucketResult.Marker;
    }
    if (listBucketResult.NextMarker) {
      nextMarker = listBucketResult.NextMarker;
    } else if (isTruncated && result.objects.length > 0) {
      var _result$objects;
      nextMarker = (_result$objects = result.objects[result.objects.length - 1]) === null || _result$objects === void 0 ? void 0 : _result$objects.name;
    }
    if (listBucketResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listBucketResult.CommonPrefixes);
    }
  }
  if (listVersionsResult) {
    if (listVersionsResult.IsTruncated) {
      isTruncated = listVersionsResult.IsTruncated;
    }
    if (listVersionsResult.Version) {
      (0, _helper.toArray)(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      (0, _helper.toArray)(listVersionsResult.DeleteMarker).forEach(content => {
        result.objects.push(formatObjInfo(content, {
          IsDeleteMarker: true
        }));
      });
    }
    if (listVersionsResult.NextKeyMarker) {
      result.keyMarker = listVersionsResult.NextKeyMarker;
    }
    if (listVersionsResult.NextVersionIdMarker) {
      result.versionIdMarker = listVersionsResult.NextVersionIdMarker;
    }
    if (listVersionsResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listVersionsResult.CommonPrefixes);
    }
  }
  result.isTruncated = isTruncated;
  if (isTruncated) {
    result.nextMarker = nextMarker;
  }
  return result;
}
function uploadPartParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYnVmZmVyQ3JjIiwicmVxdWlyZSIsIl9mYXN0WG1sUGFyc2VyIiwiZXJyb3JzIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJfaGVscGVycyIsIl9oZWxwZXIiLCJfcmVzcG9uc2UiLCJfdHlwZSIsImUiLCJ0IiwiV2Vha01hcCIsInIiLCJuIiwiX19lc01vZHVsZSIsIm8iLCJpIiwiZiIsIl9fcHJvdG9fXyIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsInBhcnNlQnVja2V0UmVnaW9uIiwieG1sIiwicGFyc2VYbWwiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJmeHAiLCJYTUxQYXJzZXIiLCJmeHBXaXRob3V0TnVtUGFyc2VyIiwibnVtYmVyUGFyc2VPcHRpb25zIiwic2tpcExpa2UiLCJwYXJzZUVycm9yIiwiaGVhZGVySW5mbyIsInhtbEVyciIsInhtbE9iaiIsInBhcnNlIiwiRXJyb3IiLCJTM0Vycm9yIiwiZW50cmllcyIsImZvckVhY2giLCJrZXkiLCJ2YWx1ZSIsInRvTG93ZXJDYXNlIiwicGFyc2VSZXNwb25zZUVycm9yIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiY29kZSIsIm1lc3NhZ2UiLCJoRXJyQ29kZSIsImhlYWRlcnMiLCJoRXJyRGVzYyIsImFtelJlcXVlc3RpZCIsImFteklkMiIsImFtekJ1Y2tldFJlZ2lvbiIsInhtbFN0cmluZyIsInJlYWRBc1N0cmluZyIsImNhdXNlIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwicmVzdWx0Iiwib2JqZWN0cyIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwieG1sb2JqIiwiTGlzdEJ1Y2tldFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIklzVHJ1bmNhdGVkIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwiQ29udGVudHMiLCJ0b0FycmF5IiwiY29udGVudCIsIm5hbWUiLCJzYW5pdGl6ZU9iamVjdEtleSIsIktleSIsImxhc3RNb2RpZmllZCIsIkRhdGUiLCJMYXN0TW9kaWZpZWQiLCJldGFnIiwic2FuaXRpemVFVGFnIiwiRVRhZyIsInNpemUiLCJTaXplIiwidGFncyIsIlVzZXJUYWdzIiwic3BsaXQiLCJ0YWciLCJtZXRhZGF0YSIsIlVzZXJNZXRhZGF0YSIsInB1c2giLCJDb21tb25QcmVmaXhlcyIsImNvbW1vblByZWZpeCIsInByZWZpeCIsIlByZWZpeCIsInBhcnNlTGlzdFBhcnRzIiwicGFydHMiLCJtYXJrZXIiLCJMaXN0UGFydHNSZXN1bHQiLCJOZXh0UGFydE51bWJlck1hcmtlciIsIlBhcnQiLCJwIiwicGFydCIsInBhcnNlSW50IiwiUGFydE51bWJlciIsInJlcGxhY2UiLCJwYXJzZUxpc3RCdWNrZXQiLCJsaXN0QnVja2V0UmVzdWx0UGFyc2VyIiwicGFyc2VUYWdWYWx1ZSIsImxlYWRpbmdaZXJvcyIsImhleCIsInRhZ1ZhbHVlUHJvY2Vzc29yIiwidGFnTmFtZSIsInRhZ1ZhbHVlIiwidG9TdHJpbmciLCJpZ25vcmVBdHRyaWJ1dGVzIiwicGFyc2VkWG1sUmVzIiwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdCIsIkJ1Y2tldHMiLCJCdWNrZXQiLCJtYXAiLCJidWNrZXQiLCJOYW1lIiwiYnVja2V0TmFtZSIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIlVwbG9hZElkIiwicGFyc2VSZXBsaWNhdGlvbkNvbmZpZyIsIlJvbGUiLCJSdWxlIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwicm9sZSIsInJ1bGVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJMZWdhbEhvbGQiLCJwYXJzZVRhZ2dpbmciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwidGFnUmVzdWx0IiwiQXJyYXkiLCJpc0FycmF5IiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiTG9jYXRpb24iLCJsb2NhdGlvbiIsIkNvZGUiLCJNZXNzYWdlIiwiZXJyQ29kZSIsImVyck1lc3NhZ2UiLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJwcmVmaXhlcyIsInVwbG9hZHMiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQiLCJOZXh0S2V5TWFya2VyIiwiTmV4dFVwbG9hZElkTWFya2VyIiwiVXBsb2FkIiwidXBsb2FkIiwidXBsb2FkSXRlbSIsInVwbG9hZElkIiwic3RvcmFnZUNsYXNzIiwiU3RvcmFnZUNsYXNzIiwiaW5pdGlhdGVkIiwiSW5pdGlhdGVkIiwiSW5pdGlhdG9yIiwiaW5pdGlhdG9yIiwiaWQiLCJJRCIsImRpc3BsYXlOYW1lIiwiRGlzcGxheU5hbWUiLCJPd25lciIsIm93bmVyIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ1Jlc3VsdCIsIk9iamVjdExvY2tDb25maWd1cmF0aW9uIiwib2JqZWN0TG9ja0VuYWJsZWQiLCJPYmplY3RMb2NrRW5hYmxlZCIsInJldGVudGlvblJlc3AiLCJEZWZhdWx0UmV0ZW50aW9uIiwibW9kZSIsIk1vZGUiLCJpc1VuaXRZZWFycyIsIlllYXJzIiwidmFsaWRpdHkiLCJ1bml0IiwiUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIiwiWUVBUlMiLCJEYXlzIiwiREFZUyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsIlZlcnNpb25pbmdDb25maWd1cmF0aW9uIiwiZXh0cmFjdEhlYWRlclR5cGUiLCJzdHJlYW0iLCJoZWFkZXJOYW1lTGVuIiwiQnVmZmVyIiwiZnJvbSIsInJlYWQiLCJyZWFkVUludDgiLCJoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciIsInNwbGl0QnlTZXBhcmF0b3IiLCJsZW5ndGgiLCJleHRyYWN0SGVhZGVyVmFsdWUiLCJib2R5TGVuIiwicmVhZFVJbnQxNkJFIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJyZXMiLCJzZWxlY3RSZXN1bHRzIiwiU2VsZWN0UmVzdWx0cyIsInJlc3BvbnNlU3RyZWFtIiwicmVhZGFibGVTdHJlYW0iLCJfcmVhZGFibGVTdGF0ZSIsIm1zZ0NyY0FjY3VtdWxhdG9yIiwidG90YWxCeXRlTGVuZ3RoQnVmZmVyIiwiY3JjMzIiLCJoZWFkZXJCeXRlc0J1ZmZlciIsImNhbGN1bGF0ZWRQcmVsdWRlQ3JjIiwicmVhZEludDMyQkUiLCJwcmVsdWRlQ3JjQnVmZmVyIiwidG90YWxNc2dMZW5ndGgiLCJoZWFkZXJMZW5ndGgiLCJwcmVsdWRlQ3JjQnl0ZVZhbHVlIiwiaGVhZGVyQnl0ZXMiLCJoZWFkZXJSZWFkZXJTdHJlYW0iLCJoZWFkZXJUeXBlTmFtZSIsInBheWxvYWRTdHJlYW0iLCJwYXlMb2FkTGVuZ3RoIiwicGF5TG9hZEJ1ZmZlciIsIm1lc3NhZ2VDcmNCeXRlVmFsdWUiLCJjYWxjdWxhdGVkQ3JjIiwibWVzc2FnZVR5cGUiLCJlcnJvck1lc3NhZ2UiLCJjb250ZW50VHlwZSIsImV2ZW50VHlwZSIsInNldFJlc3BvbnNlIiwiX3BheWxvYWRTdHJlYW0iLCJyZWFkRGF0YSIsInNldFJlY29yZHMiLCJfcGF5bG9hZFN0cmVhbTIiLCJwcm9ncmVzc0RhdGEiLCJzZXRQcm9ncmVzcyIsIl9wYXlsb2FkU3RyZWFtMyIsInN0YXRzRGF0YSIsInNldFN0YXRzIiwid2FybmluZ01lc3NhZ2UiLCJjb25zb2xlIiwid2FybiIsInBhcnNlTGlmZWN5Y2xlQ29uZmlnIiwiTGlmZWN5Y2xlQ29uZmlndXJhdGlvbiIsInBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmV0ZW50aW9uQ29uZmlnIiwiUmV0ZW50aW9uIiwicmV0YWluVW50aWxEYXRlIiwiUmV0YWluVW50aWxEYXRlIiwicmVtb3ZlT2JqZWN0c1BhcnNlciIsIkRlbGV0ZVJlc3VsdCIsInBhcnNlQ29weU9iamVjdCIsIkNvcHlPYmplY3RSZXN1bHQiLCJmb3JtYXRPYmpJbmZvIiwib3B0cyIsIlZlcnNpb25JZCIsIklzTGF0ZXN0IiwiaXNPYmplY3QiLCJ1bmRlZmluZWQiLCJzYW5pdGl6ZVNpemUiLCJ2ZXJzaW9uSWQiLCJpc0xhdGVzdCIsImlzRGVsZXRlTWFya2VyIiwiSXNEZWxldGVNYXJrZXIiLCJwYXJzZUxpc3RPYmplY3RzIiwibmV4dE1hcmtlciIsInZlcnNpb25JZE1hcmtlciIsImtleU1hcmtlciIsInBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkiLCJjb21tb25QcmVmaXhFbnRyeSIsImxpc3RCdWNrZXRSZXN1bHQiLCJsaXN0VmVyc2lvbnNSZXN1bHQiLCJMaXN0VmVyc2lvbnNSZXN1bHQiLCJNYXJrZXIiLCJOZXh0TWFya2VyIiwiX3Jlc3VsdCRvYmplY3RzIiwiVmVyc2lvbiIsIkRlbGV0ZU1hcmtlciIsIk5leHRWZXJzaW9uSWRNYXJrZXIiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwicmVzcEVsIiwiQ29weVBhcnRSZXN1bHQiXSwic291cmNlcyI6WyJ4bWwtcGFyc2VyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXHJcbmltcG9ydCB0eXBlIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcclxuXHJcbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXHJcbmltcG9ydCB7IFhNTFBhcnNlciB9IGZyb20gJ2Zhc3QteG1sLXBhcnNlcidcclxuXHJcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXHJcbmltcG9ydCB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xyXG5pbXBvcnQgeyBpc09iamVjdCwgcGFyc2VYbWwsIHJlYWRhYmxlU3RyZWFtLCBzYW5pdGl6ZUVUYWcsIHNhbml0aXplT2JqZWN0S2V5LCBzYW5pdGl6ZVNpemUsIHRvQXJyYXkgfSBmcm9tICcuL2hlbHBlci50cydcclxuaW1wb3J0IHsgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcclxuaW1wb3J0IHR5cGUge1xyXG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcclxuICBCdWNrZXRJdGVtV2l0aE1ldGFkYXRhLFxyXG4gIENvbW1vblByZWZpeCxcclxuICBDb3B5T2JqZWN0UmVzdWx0VjEsXHJcbiAgTGlzdEJ1Y2tldFJlc3VsdFYxLFxyXG4gIE9iamVjdEluZm8sXHJcbiAgT2JqZWN0TG9ja0luZm8sXHJcbiAgT2JqZWN0Um93RW50cnksXHJcbiAgUmVwbGljYXRpb25Db25maWcsXHJcbiAgVGFnLFxyXG4gIFRhZ3MsXHJcbn0gZnJvbSAnLi90eXBlLnRzJ1xyXG5pbXBvcnQgeyBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuL3R5cGUudHMnXHJcblxyXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGJ1Y2tldCByZWdpb25cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0UmVnaW9uKHhtbDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAvLyByZXR1cm4gcmVnaW9uIGluZm9ybWF0aW9uXHJcbiAgcmV0dXJuIHBhcnNlWG1sKHhtbCkuTG9jYXRpb25Db25zdHJhaW50XHJcbn1cclxuXHJcbmNvbnN0IGZ4cCA9IG5ldyBYTUxQYXJzZXIoKVxyXG5cclxuY29uc3QgZnhwV2l0aG91dE51bVBhcnNlciA9IG5ldyBYTUxQYXJzZXIoe1xyXG4gIC8vIEB0cy1pZ25vcmVcclxuICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcclxuICAgIHNraXBMaWtlOiAvLi8sXHJcbiAgfSxcclxufSlcclxuXHJcbi8vIFBhcnNlIFhNTCBhbmQgcmV0dXJuIGluZm9ybWF0aW9uIGFzIEphdmFzY3JpcHQgdHlwZXNcclxuLy8gcGFyc2UgZXJyb3IgWE1MIHJlc3BvbnNlXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUVycm9yKHhtbDogc3RyaW5nLCBoZWFkZXJJbmZvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikge1xyXG4gIGxldCB4bWxFcnIgPSB7fVxyXG4gIGNvbnN0IHhtbE9iaiA9IGZ4cC5wYXJzZSh4bWwpXHJcbiAgaWYgKHhtbE9iai5FcnJvcikge1xyXG4gICAgeG1sRXJyID0geG1sT2JqLkVycm9yXHJcbiAgfVxyXG4gIGNvbnN0IGUgPSBuZXcgZXJyb3JzLlMzRXJyb3IoKSBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XHJcbiAgT2JqZWN0LmVudHJpZXMoeG1sRXJyKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcclxuICAgIGVba2V5LnRvTG93ZXJDYXNlKCldID0gdmFsdWVcclxuICB9KVxyXG4gIE9iamVjdC5lbnRyaWVzKGhlYWRlckluZm8pLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xyXG4gICAgZVtrZXldID0gdmFsdWVcclxuICB9KVxyXG4gIHJldHVybiBlXHJcbn1cclxuXHJcbi8vIEdlbmVyYXRlcyBhbiBFcnJvciBvYmplY3QgZGVwZW5kaW5nIG9uIGh0dHAgc3RhdHVzQ29kZSBhbmQgWE1MIGJvZHlcclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+IHtcclxuICBjb25zdCBzdGF0dXNDb2RlID0gcmVzcG9uc2Uuc3RhdHVzQ29kZVxyXG4gIGxldCBjb2RlID0gJycsXHJcbiAgICBtZXNzYWdlID0gJydcclxuICBpZiAoc3RhdHVzQ29kZSA9PT0gMzAxKSB7XHJcbiAgICBjb2RlID0gJ01vdmVkUGVybWFuZW50bHknXHJcbiAgICBtZXNzYWdlID0gJ01vdmVkIFBlcm1hbmVudGx5J1xyXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gMzA3KSB7XHJcbiAgICBjb2RlID0gJ1RlbXBvcmFyeVJlZGlyZWN0J1xyXG4gICAgbWVzc2FnZSA9ICdBcmUgeW91IHVzaW5nIHRoZSBjb3JyZWN0IGVuZHBvaW50IFVSTD8nXHJcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDMpIHtcclxuICAgIGNvZGUgPSAnQWNjZXNzRGVuaWVkJ1xyXG4gICAgbWVzc2FnZSA9ICdWYWxpZCBhbmQgYXV0aG9yaXplZCBjcmVkZW50aWFscyByZXF1aXJlZCdcclxuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwNCkge1xyXG4gICAgY29kZSA9ICdOb3RGb3VuZCdcclxuICAgIG1lc3NhZ2UgPSAnTm90IEZvdW5kJ1xyXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDA1KSB7XHJcbiAgICBjb2RlID0gJ01ldGhvZE5vdEFsbG93ZWQnXHJcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcclxuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDUwMSkge1xyXG4gICAgY29kZSA9ICdNZXRob2ROb3RBbGxvd2VkJ1xyXG4gICAgbWVzc2FnZSA9ICdNZXRob2QgTm90IEFsbG93ZWQnXHJcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA1MDMpIHtcclxuICAgIGNvZGUgPSAnU2xvd0Rvd24nXHJcbiAgICBtZXNzYWdlID0gJ1BsZWFzZSByZWR1Y2UgeW91ciByZXF1ZXN0IHJhdGUuJ1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjb25zdCBoRXJyQ29kZSA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtbWluaW8tZXJyb3ItY29kZSddIGFzIHN0cmluZ1xyXG4gICAgY29uc3QgaEVyckRlc2MgPSByZXNwb25zZS5oZWFkZXJzWyd4LW1pbmlvLWVycm9yLWRlc2MnXSBhcyBzdHJpbmdcclxuXHJcbiAgICBpZiAoaEVyckNvZGUgJiYgaEVyckRlc2MpIHtcclxuICAgICAgY29kZSA9IGhFcnJDb2RlXHJcbiAgICAgIG1lc3NhZ2UgPSBoRXJyRGVzY1xyXG4gICAgfVxyXG4gIH1cclxuICBjb25zdCBoZWFkZXJJbmZvOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsPiA9IHt9XHJcbiAgLy8gQSB2YWx1ZSBjcmVhdGVkIGJ5IFMzIGNvbXBhdGlibGUgc2VydmVyIHRoYXQgdW5pcXVlbHkgaWRlbnRpZmllcyB0aGUgcmVxdWVzdC5cclxuICBoZWFkZXJJbmZvLmFtelJlcXVlc3RpZCA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LXJlcXVlc3QtaWQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcclxuICAvLyBBIHNwZWNpYWwgdG9rZW4gdGhhdCBoZWxwcyB0cm91Ymxlc2hvb3QgQVBJIHJlcGxpZXMgYW5kIGlzc3Vlcy5cclxuICBoZWFkZXJJbmZvLmFteklkMiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWlkLTInXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcclxuXHJcbiAgLy8gUmVnaW9uIHdoZXJlIHRoZSBidWNrZXQgaXMgbG9jYXRlZC4gVGhpcyBoZWFkZXIgaXMgcmV0dXJuZWQgb25seVxyXG4gIC8vIGluIEhFQUQgYnVja2V0IGFuZCBMaXN0T2JqZWN0cyByZXNwb25zZS5cclxuICBoZWFkZXJJbmZvLmFtekJ1Y2tldFJlZ2lvbiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1yZWdpb24nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcclxuXHJcbiAgY29uc3QgeG1sU3RyaW5nID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxyXG5cclxuICBpZiAoeG1sU3RyaW5nKSB7XHJcbiAgICB0aHJvdyBwYXJzZUVycm9yKHhtbFN0cmluZywgaGVhZGVySW5mbylcclxuICB9XHJcblxyXG4gIC8vIE1lc3NhZ2Ugc2hvdWxkIGJlIGluc3RhbnRpYXRlZCBmb3IgZWFjaCBTM0Vycm9ycy5cclxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKG1lc3NhZ2UsIHsgY2F1c2U6IGhlYWRlckluZm8gfSlcclxuICAvLyBTMyBFcnJvciBjb2RlLlxyXG4gIGUuY29kZSA9IGNvZGVcclxuICBPYmplY3QuZW50cmllcyhoZWFkZXJJbmZvKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZm9yY2Ugc2V0IGVycm9yIHByb3BlcnRpZXNcclxuICAgIGVba2V5XSA9IHZhbHVlXHJcbiAgfSlcclxuXHJcbiAgdGhyb3cgZVxyXG59XHJcblxyXG4vKipcclxuICogcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgdjIgd2l0aCBtZXRhZGF0YSBpbiBhIGJ1Y2tldFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YSh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHJlc3VsdDoge1xyXG4gICAgb2JqZWN0czogQXJyYXk8QnVja2V0SXRlbVdpdGhNZXRhZGF0YT5cclxuICAgIGlzVHJ1bmNhdGVkOiBib29sZWFuXHJcbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46IHN0cmluZ1xyXG4gIH0gPSB7XHJcbiAgICBvYmplY3RzOiBbXSxcclxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcclxuICAgIG5leHRDb250aW51YXRpb25Ub2tlbjogJycsXHJcbiAgfVxyXG5cclxuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIGlmICgheG1sb2JqLkxpc3RCdWNrZXRSZXN1bHQpIHtcclxuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxyXG4gIH1cclxuICB4bWxvYmogPSB4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdFxyXG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcclxuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxyXG4gIH1cclxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xyXG4gICAgcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlbiA9IHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW5cclxuICB9XHJcblxyXG4gIGlmICh4bWxvYmouQ29udGVudHMpIHtcclxuICAgIHRvQXJyYXkoeG1sb2JqLkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcclxuICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUoY29udGVudC5MYXN0TW9kaWZpZWQpXHJcbiAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcoY29udGVudC5FVGFnKVxyXG4gICAgICBjb25zdCBzaXplID0gY29udGVudC5TaXplXHJcblxyXG4gICAgICBsZXQgdGFnczogVGFncyA9IHt9XHJcbiAgICAgIGlmIChjb250ZW50LlVzZXJUYWdzICE9IG51bGwpIHtcclxuICAgICAgICB0b0FycmF5KGNvbnRlbnQuVXNlclRhZ3Muc3BsaXQoJyYnKSkuZm9yRWFjaCgodGFnKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBba2V5LCB2YWx1ZV0gPSB0YWcuc3BsaXQoJz0nKVxyXG4gICAgICAgICAgdGFnc1trZXldID0gdmFsdWVcclxuICAgICAgICB9KVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRhZ3MgPSB7fVxyXG4gICAgICB9XHJcblxyXG4gICAgICBsZXQgbWV0YWRhdGFcclxuICAgICAgaWYgKGNvbnRlbnQuVXNlck1ldGFkYXRhICE9IG51bGwpIHtcclxuICAgICAgICBtZXRhZGF0YSA9IHRvQXJyYXkoY29udGVudC5Vc2VyTWV0YWRhdGEpWzBdXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbWV0YWRhdGEgPSBudWxsXHJcbiAgICAgIH1cclxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEsIHRhZ3MgfSlcclxuICAgIH0pXHJcbiAgfVxyXG5cclxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XHJcbiAgICB0b0FycmF5KHhtbG9iai5Db21tb25QcmVmaXhlcykuZm9yRWFjaCgoY29tbW9uUHJlZml4KSA9PiB7XHJcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXHJcbiAgICB9KVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIFVwbG9hZGVkUGFydCA9IHtcclxuICBwYXJ0OiBudW1iZXJcclxuICBsYXN0TW9kaWZpZWQ/OiBEYXRlXHJcbiAgZXRhZzogc3RyaW5nXHJcbiAgc2l6ZTogbnVtYmVyXHJcbn1cclxuXHJcbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBwYXJ0cyBvZiBhbiBpbiBwcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2FkXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RQYXJ0cyh4bWw6IHN0cmluZyk6IHtcclxuICBpc1RydW5jYXRlZDogYm9vbGVhblxyXG4gIG1hcmtlcjogbnVtYmVyXHJcbiAgcGFydHM6IFVwbG9hZGVkUGFydFtdXHJcbn0ge1xyXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgY29uc3QgcmVzdWx0OiB7XHJcbiAgICBpc1RydW5jYXRlZDogYm9vbGVhblxyXG4gICAgbWFya2VyOiBudW1iZXJcclxuICAgIHBhcnRzOiBVcGxvYWRlZFBhcnRbXVxyXG4gIH0gPSB7XHJcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXHJcbiAgICBwYXJ0czogW10sXHJcbiAgICBtYXJrZXI6IDAsXHJcbiAgfVxyXG4gIGlmICgheG1sb2JqLkxpc3RQYXJ0c1Jlc3VsdCkge1xyXG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RQYXJ0c1Jlc3VsdFwiJylcclxuICB9XHJcbiAgeG1sb2JqID0geG1sb2JqLkxpc3RQYXJ0c1Jlc3VsdFxyXG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcclxuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxyXG4gIH1cclxuICBpZiAoeG1sb2JqLk5leHRQYXJ0TnVtYmVyTWFya2VyKSB7XHJcbiAgICByZXN1bHQubWFya2VyID0gdG9BcnJheSh4bWxvYmouTmV4dFBhcnROdW1iZXJNYXJrZXIpWzBdIHx8ICcnXHJcbiAgfVxyXG4gIGlmICh4bWxvYmouUGFydCkge1xyXG4gICAgdG9BcnJheSh4bWxvYmouUGFydCkuZm9yRWFjaCgocCkgPT4ge1xyXG4gICAgICBjb25zdCBwYXJ0ID0gcGFyc2VJbnQodG9BcnJheShwLlBhcnROdW1iZXIpWzBdLCAxMClcclxuICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUocC5MYXN0TW9kaWZpZWQpXHJcbiAgICAgIGNvbnN0IGV0YWcgPSBwLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXHJcbiAgICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXHJcbiAgICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXHJcbiAgICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxyXG4gICAgICByZXN1bHQucGFydHMucHVzaCh7IHBhcnQsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZTogcGFyc2VJbnQocC5TaXplLCAxMCkgfSlcclxuICAgIH0pXHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHRcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdEJ1Y2tldCh4bWw6IHN0cmluZyk6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdIHtcclxuICBsZXQgcmVzdWx0OiBCdWNrZXRJdGVtRnJvbUxpc3RbXSA9IFtdXHJcbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdFBhcnNlciA9IG5ldyBYTUxQYXJzZXIoe1xyXG4gICAgcGFyc2VUYWdWYWx1ZTogdHJ1ZSwgLy8gRW5hYmxlIHBhcnNpbmcgb2YgdmFsdWVzXHJcbiAgICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcclxuICAgICAgbGVhZGluZ1plcm9zOiBmYWxzZSwgLy8gRGlzYWJsZSBudW1iZXIgcGFyc2luZyBmb3IgdmFsdWVzIHdpdGggbGVhZGluZyB6ZXJvc1xyXG4gICAgICBoZXg6IGZhbHNlLCAvLyBEaXNhYmxlIGhleCBudW1iZXIgcGFyc2luZyAtIEludmFsaWQgYnVja2V0IG5hbWVcclxuICAgICAgc2tpcExpa2U6IC9eWzAtOV0rJC8sIC8vIFNraXAgbnVtYmVyIHBhcnNpbmcgaWYgdGhlIHZhbHVlIGNvbnNpc3RzIGVudGlyZWx5IG9mIGRpZ2l0c1xyXG4gICAgfSxcclxuICAgIHRhZ1ZhbHVlUHJvY2Vzc29yOiAodGFnTmFtZSwgdGFnVmFsdWUgPSAnJykgPT4ge1xyXG4gICAgICAvLyBFbnN1cmUgdGhhdCB0aGUgTmFtZSB0YWcgaXMgYWx3YXlzIHRyZWF0ZWQgYXMgYSBzdHJpbmdcclxuICAgICAgaWYgKHRhZ05hbWUgPT09ICdOYW1lJykge1xyXG4gICAgICAgIHJldHVybiB0YWdWYWx1ZS50b1N0cmluZygpXHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHRhZ1ZhbHVlXHJcbiAgICB9LFxyXG4gICAgaWdub3JlQXR0cmlidXRlczogZmFsc2UsIC8vIEVuc3VyZSB0aGF0IGFsbCBhdHRyaWJ1dGVzIGFyZSBwYXJzZWRcclxuICB9KVxyXG5cclxuICBjb25zdCBwYXJzZWRYbWxSZXMgPSBsaXN0QnVja2V0UmVzdWx0UGFyc2VyLnBhcnNlKHhtbClcclxuXHJcbiAgaWYgKCFwYXJzZWRYbWxSZXMuTGlzdEFsbE15QnVja2V0c1Jlc3VsdCkge1xyXG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHRcIicpXHJcbiAgfVxyXG5cclxuICBjb25zdCB7IExpc3RBbGxNeUJ1Y2tldHNSZXN1bHQ6IHsgQnVja2V0cyA9IHt9IH0gPSB7fSB9ID0gcGFyc2VkWG1sUmVzXHJcblxyXG4gIGlmIChCdWNrZXRzLkJ1Y2tldCkge1xyXG4gICAgcmVzdWx0ID0gdG9BcnJheShCdWNrZXRzLkJ1Y2tldCkubWFwKChidWNrZXQgPSB7fSkgPT4ge1xyXG4gICAgICBjb25zdCB7IE5hbWU6IGJ1Y2tldE5hbWUsIENyZWF0aW9uRGF0ZSB9ID0gYnVja2V0XHJcbiAgICAgIGNvbnN0IGNyZWF0aW9uRGF0ZSA9IG5ldyBEYXRlKENyZWF0aW9uRGF0ZSlcclxuXHJcbiAgICAgIHJldHVybiB7IG5hbWU6IGJ1Y2tldE5hbWUsIGNyZWF0aW9uRGF0ZSB9XHJcbiAgICB9KVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlc3VsdFxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VJbml0aWF0ZU11bHRpcGFydCh4bWw6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcclxuXHJcbiAgaWYgKCF4bWxvYmouSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHQpIHtcclxuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFwiJylcclxuICB9XHJcbiAgeG1sb2JqID0geG1sb2JqLkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XHJcblxyXG4gIGlmICh4bWxvYmouVXBsb2FkSWQpIHtcclxuICAgIHJldHVybiB4bWxvYmouVXBsb2FkSWRcclxuICB9XHJcbiAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIlVwbG9hZElkXCInKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWw6IHN0cmluZyk6IFJlcGxpY2F0aW9uQ29uZmlnIHtcclxuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgY29uc3QgeyBSb2xlLCBSdWxlIH0gPSB4bWxPYmouUmVwbGljYXRpb25Db25maWd1cmF0aW9uXHJcbiAgcmV0dXJuIHtcclxuICAgIFJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbjoge1xyXG4gICAgICByb2xlOiBSb2xlLFxyXG4gICAgICBydWxlczogdG9BcnJheShSdWxlKSxcclxuICAgIH0sXHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgcmV0dXJuIHhtbE9iai5MZWdhbEhvbGRcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVGFnZ2luZyh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBsZXQgcmVzdWx0OiBUYWdbXSA9IFtdXHJcbiAgaWYgKHhtbE9iai5UYWdnaW5nICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldCAmJiB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnKSB7XHJcbiAgICBjb25zdCB0YWdSZXN1bHQ6IFRhZyA9IHhtbE9iai5UYWdnaW5nLlRhZ1NldC5UYWdcclxuICAgIC8vIGlmIGl0IGlzIGEgc2luZ2xlIHRhZyBjb252ZXJ0IGludG8gYW4gYXJyYXkgc28gdGhhdCB0aGUgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyBhbiBhcnJheS5cclxuICAgIGlmIChBcnJheS5pc0FycmF5KHRhZ1Jlc3VsdCkpIHtcclxuICAgICAgcmVzdWx0ID0gWy4uLnRhZ1Jlc3VsdF1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKHRhZ1Jlc3VsdClcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIHJlc3VsdFxyXG59XHJcblxyXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2Ugd2hlbiBhIG11bHRpcGFydCB1cGxvYWQgaXMgY29tcGxldGVkXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0KHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgeG1sb2JqID0gcGFyc2VYbWwoeG1sKS5Db21wbGV0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFxyXG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcclxuICAgIGNvbnN0IGxvY2F0aW9uID0gdG9BcnJheSh4bWxvYmouTG9jYXRpb24pWzBdXHJcbiAgICBjb25zdCBidWNrZXQgPSB0b0FycmF5KHhtbG9iai5CdWNrZXQpWzBdXHJcbiAgICBjb25zdCBrZXkgPSB4bWxvYmouS2V5XHJcbiAgICBjb25zdCBldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXHJcblxyXG4gICAgcmV0dXJuIHsgbG9jYXRpb24sIGJ1Y2tldCwga2V5LCBldGFnIH1cclxuICB9XHJcbiAgLy8gQ29tcGxldGUgTXVsdGlwYXJ0IGNhbiByZXR1cm4gWE1MIEVycm9yIGFmdGVyIGEgMjAwIE9LIHJlc3BvbnNlXHJcbiAgaWYgKHhtbG9iai5Db2RlICYmIHhtbG9iai5NZXNzYWdlKSB7XHJcbiAgICBjb25zdCBlcnJDb2RlID0gdG9BcnJheSh4bWxvYmouQ29kZSlbMF1cclxuICAgIGNvbnN0IGVyck1lc3NhZ2UgPSB0b0FycmF5KHhtbG9iai5NZXNzYWdlKVswXVxyXG4gICAgcmV0dXJuIHsgZXJyQ29kZSwgZXJyTWVzc2FnZSB9XHJcbiAgfVxyXG59XHJcblxyXG50eXBlIFVwbG9hZElEID0gc3RyaW5nXHJcblxyXG5leHBvcnQgdHlwZSBMaXN0TXVsdGlwYXJ0UmVzdWx0ID0ge1xyXG4gIHVwbG9hZHM6IHtcclxuICAgIGtleTogc3RyaW5nXHJcbiAgICB1cGxvYWRJZDogVXBsb2FkSURcclxuICAgIGluaXRpYXRvcj86IHsgaWQ6IHN0cmluZzsgZGlzcGxheU5hbWU6IHN0cmluZyB9XHJcbiAgICBvd25lcj86IHsgaWQ6IHN0cmluZzsgZGlzcGxheU5hbWU6IHN0cmluZyB9XHJcbiAgICBzdG9yYWdlQ2xhc3M6IHVua25vd25cclxuICAgIGluaXRpYXRlZDogRGF0ZVxyXG4gIH1bXVxyXG4gIHByZWZpeGVzOiB7XHJcbiAgICBwcmVmaXg6IHN0cmluZ1xyXG4gIH1bXVxyXG4gIGlzVHJ1bmNhdGVkOiBib29sZWFuXHJcbiAgbmV4dEtleU1hcmtlcjogc3RyaW5nXHJcbiAgbmV4dFVwbG9hZElkTWFya2VyOiBzdHJpbmdcclxufVxyXG5cclxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0aW5nIGluLXByb2dyZXNzIG11bHRpcGFydCB1cGxvYWRzXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RNdWx0aXBhcnQoeG1sOiBzdHJpbmcpOiBMaXN0TXVsdGlwYXJ0UmVzdWx0IHtcclxuICBjb25zdCByZXN1bHQ6IExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XHJcbiAgICBwcmVmaXhlczogW10sXHJcbiAgICB1cGxvYWRzOiBbXSxcclxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcclxuICAgIG5leHRLZXlNYXJrZXI6ICcnLFxyXG4gICAgbmV4dFVwbG9hZElkTWFya2VyOiAnJyxcclxuICB9XHJcblxyXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXHJcblxyXG4gIGlmICgheG1sb2JqLkxpc3RNdWx0aXBhcnRVcGxvYWRzUmVzdWx0KSB7XHJcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcIicpXHJcbiAgfVxyXG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFxyXG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcclxuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxyXG4gIH1cclxuICBpZiAoeG1sb2JqLk5leHRLZXlNYXJrZXIpIHtcclxuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcclxuICB9XHJcbiAgaWYgKHhtbG9iai5OZXh0VXBsb2FkSWRNYXJrZXIpIHtcclxuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXHJcbiAgfVxyXG5cclxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XHJcbiAgICB0b0FycmF5KHhtbG9iai5Db21tb25QcmVmaXhlcykuZm9yRWFjaCgocHJlZml4KSA9PiB7XHJcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgaW5kZXggY2hlY2tcclxuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXk8c3RyaW5nPihwcmVmaXguUHJlZml4KVswXSkgfSlcclxuICAgIH0pXHJcbiAgfVxyXG5cclxuICBpZiAoeG1sb2JqLlVwbG9hZCkge1xyXG4gICAgdG9BcnJheSh4bWxvYmouVXBsb2FkKS5mb3JFYWNoKCh1cGxvYWQpID0+IHtcclxuICAgICAgY29uc3QgdXBsb2FkSXRlbTogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gPSB7XHJcbiAgICAgICAga2V5OiB1cGxvYWQuS2V5LFxyXG4gICAgICAgIHVwbG9hZElkOiB1cGxvYWQuVXBsb2FkSWQsXHJcbiAgICAgICAgc3RvcmFnZUNsYXNzOiB1cGxvYWQuU3RvcmFnZUNsYXNzLFxyXG4gICAgICAgIGluaXRpYXRlZDogbmV3IERhdGUodXBsb2FkLkluaXRpYXRlZCksXHJcbiAgICAgIH1cclxuICAgICAgaWYgKHVwbG9hZC5Jbml0aWF0b3IpIHtcclxuICAgICAgICB1cGxvYWRJdGVtLmluaXRpYXRvciA9IHsgaWQ6IHVwbG9hZC5Jbml0aWF0b3IuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuSW5pdGlhdG9yLkRpc3BsYXlOYW1lIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAodXBsb2FkLk93bmVyKSB7XHJcbiAgICAgICAgdXBsb2FkSXRlbS5vd25lciA9IHsgaWQ6IHVwbG9hZC5Pd25lci5JRCwgZGlzcGxheU5hbWU6IHVwbG9hZC5Pd25lci5EaXNwbGF5TmFtZSB9XHJcbiAgICAgIH1cclxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh1cGxvYWRJdGVtKVxyXG4gICAgfSlcclxuICB9XHJcbiAgcmV0dXJuIHJlc3VsdFxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbDogc3RyaW5nKTogT2JqZWN0TG9ja0luZm8ge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBsZXQgbG9ja0NvbmZpZ1Jlc3VsdCA9IHt9IGFzIE9iamVjdExvY2tJbmZvXHJcbiAgaWYgKHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbikge1xyXG4gICAgbG9ja0NvbmZpZ1Jlc3VsdCA9IHtcclxuICAgICAgb2JqZWN0TG9ja0VuYWJsZWQ6IHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5PYmplY3RMb2NrRW5hYmxlZCxcclxuICAgIH0gYXMgT2JqZWN0TG9ja0luZm9cclxuICAgIGxldCByZXRlbnRpb25SZXNwXHJcbiAgICBpZiAoXHJcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbiAmJlxyXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZSAmJlxyXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uXHJcbiAgICApIHtcclxuICAgICAgcmV0ZW50aW9uUmVzcCA9IHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlLkRlZmF1bHRSZXRlbnRpb24gfHwge31cclxuICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC5tb2RlID0gcmV0ZW50aW9uUmVzcC5Nb2RlXHJcbiAgICB9XHJcbiAgICBpZiAocmV0ZW50aW9uUmVzcCkge1xyXG4gICAgICBjb25zdCBpc1VuaXRZZWFycyA9IHJldGVudGlvblJlc3AuWWVhcnNcclxuICAgICAgaWYgKGlzVW5pdFllYXJzKSB7XHJcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC52YWxpZGl0eSA9IGlzVW5pdFllYXJzXHJcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC52YWxpZGl0eSA9IHJldGVudGlvblJlc3AuRGF5c1xyXG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudW5pdCA9IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTXHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiBsb2NrQ29uZmlnUmVzdWx0XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWcoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxyXG59XHJcblxyXG4vLyBVc2VkIG9ubHkgaW4gc2VsZWN0T2JqZWN0Q29udGVudCBBUEkuXHJcbi8vIGV4dHJhY3RIZWFkZXJUeXBlIGV4dHJhY3RzIHRoZSBmaXJzdCBoYWxmIG9mIHRoZSBoZWFkZXIgbWVzc2FnZSwgdGhlIGhlYWRlciB0eXBlLlxyXG5mdW5jdGlvbiBleHRyYWN0SGVhZGVyVHlwZShzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XHJcbiAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxyXG4gIGNvbnN0IGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoaGVhZGVyTmFtZUxlbikpLnRvU3RyaW5nKClcclxuICBjb25zdCBzcGxpdEJ5U2VwYXJhdG9yID0gKGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yIHx8ICcnKS5zcGxpdCgnOicpXHJcbiAgcmV0dXJuIHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcclxufVxyXG5cclxuZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKSB7XHJcbiAgY29uc3QgYm9keUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDIpKS5yZWFkVUludDE2QkUoKVxyXG4gIHJldHVybiBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZChib2R5TGVuKSkudG9TdHJpbmcoKVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UocmVzOiBCdWZmZXIpIHtcclxuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcclxuXHJcbiAgY29uc3QgcmVzcG9uc2VTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShyZXMpIC8vIGNvbnZlcnQgYnl0ZSBhcnJheSB0byBhIHJlYWRhYmxlIHJlc3BvbnNlU3RyZWFtXHJcbiAgLy8gQHRzLWlnbm9yZVxyXG4gIHdoaWxlIChyZXNwb25zZVN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcclxuICAgIC8vIFRvcCBsZXZlbCByZXNwb25zZVN0cmVhbSByZWFkIHRyYWNrZXIuXHJcbiAgICBsZXQgbXNnQ3JjQWNjdW11bGF0b3IgLy8gYWNjdW11bGF0ZSBmcm9tIHN0YXJ0IG9mIHRoZSBtZXNzYWdlIHRpbGwgdGhlIG1lc3NhZ2UgY3JjIHN0YXJ0LlxyXG5cclxuICAgIGNvbnN0IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXHJcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlcilcclxuXHJcbiAgICBjb25zdCBoZWFkZXJCeXRlc0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXHJcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcclxuXHJcbiAgICBjb25zdCBjYWxjdWxhdGVkUHJlbHVkZUNyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKCkgLy8gdXNlIGl0IHRvIGNoZWNrIGlmIGFueSBDUkMgbWlzbWF0Y2ggaW4gaGVhZGVyIGl0c2VsZi5cclxuXHJcbiAgICBjb25zdCBwcmVsdWRlQ3JjQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkgLy8gcmVhZCA0IGJ5dGVzICAgIGkuZSA0KzQgPTggKyA0ID0gMTIgKCBwcmVsdWRlICsgcHJlbHVkZSBjcmMpXHJcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHByZWx1ZGVDcmNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxyXG5cclxuICAgIGNvbnN0IHRvdGFsTXNnTGVuZ3RoID0gdG90YWxCeXRlTGVuZ3RoQnVmZmVyLnJlYWRJbnQzMkJFKClcclxuICAgIGNvbnN0IGhlYWRlckxlbmd0aCA9IGhlYWRlckJ5dGVzQnVmZmVyLnJlYWRJbnQzMkJFKClcclxuICAgIGNvbnN0IHByZWx1ZGVDcmNCeXRlVmFsdWUgPSBwcmVsdWRlQ3JjQnVmZmVyLnJlYWRJbnQzMkJFKClcclxuXHJcbiAgICBpZiAocHJlbHVkZUNyY0J5dGVWYWx1ZSAhPT0gY2FsY3VsYXRlZFByZWx1ZGVDcmMpIHtcclxuICAgICAgLy8gSGFuZGxlIEhlYWRlciBDUkMgbWlzbWF0Y2ggRXJyb3JcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBIZWFkZXIgQ2hlY2tzdW0gTWlzbWF0Y2gsIFByZWx1ZGUgQ1JDIG9mICR7cHJlbHVkZUNyY0J5dGVWYWx1ZX0gZG9lcyBub3QgZXF1YWwgZXhwZWN0ZWQgQ1JDIG9mICR7Y2FsY3VsYXRlZFByZWx1ZGVDcmN9YCxcclxuICAgICAgKVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge31cclxuICAgIGlmIChoZWFkZXJMZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnN0IGhlYWRlckJ5dGVzID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChoZWFkZXJMZW5ndGgpKVxyXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcclxuICAgICAgY29uc3QgaGVhZGVyUmVhZGVyU3RyZWFtID0gcmVhZGFibGVTdHJlYW0oaGVhZGVyQnl0ZXMpXHJcbiAgICAgIC8vIEB0cy1pZ25vcmVcclxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcclxuICAgICAgICBjb25zdCBoZWFkZXJUeXBlTmFtZSA9IGV4dHJhY3RIZWFkZXJUeXBlKGhlYWRlclJlYWRlclN0cmVhbSlcclxuICAgICAgICBoZWFkZXJSZWFkZXJTdHJlYW0ucmVhZCgxKSAvLyBqdXN0IHJlYWQgYW5kIGlnbm9yZSBpdC5cclxuICAgICAgICBpZiAoaGVhZGVyVHlwZU5hbWUpIHtcclxuICAgICAgICAgIGhlYWRlcnNbaGVhZGVyVHlwZU5hbWVdID0gZXh0cmFjdEhlYWRlclZhbHVlKGhlYWRlclJlYWRlclN0cmVhbSlcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBsZXQgcGF5bG9hZFN0cmVhbVxyXG4gICAgY29uc3QgcGF5TG9hZExlbmd0aCA9IHRvdGFsTXNnTGVuZ3RoIC0gaGVhZGVyTGVuZ3RoIC0gMTZcclxuICAgIGlmIChwYXlMb2FkTGVuZ3RoID4gMCkge1xyXG4gICAgICBjb25zdCBwYXlMb2FkQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKSlcclxuICAgICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihwYXlMb2FkQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcclxuICAgICAgLy8gcmVhZCB0aGUgY2hlY2tzdW0gZWFybHkgYW5kIGRldGVjdCBhbnkgbWlzbWF0Y2ggc28gd2UgY2FuIGF2b2lkIHVubmVjZXNzYXJ5IGZ1cnRoZXIgcHJvY2Vzc2luZy5cclxuICAgICAgY29uc3QgbWVzc2FnZUNyY0J5dGVWYWx1ZSA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpLnJlYWRJbnQzMkJFKClcclxuICAgICAgY29uc3QgY2FsY3VsYXRlZENyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKClcclxuICAgICAgLy8gSGFuZGxlIG1lc3NhZ2UgQ1JDIEVycm9yXHJcbiAgICAgIGlmIChtZXNzYWdlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkQ3JjKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgICAgYE1lc3NhZ2UgQ2hlY2tzdW0gTWlzbWF0Y2gsIE1lc3NhZ2UgQ1JDIG9mICR7bWVzc2FnZUNyY0J5dGVWYWx1ZX0gZG9lcyBub3QgZXF1YWwgZXhwZWN0ZWQgQ1JDIG9mICR7Y2FsY3VsYXRlZENyY31gLFxyXG4gICAgICAgIClcclxuICAgICAgfVxyXG4gICAgICBwYXlsb2FkU3RyZWFtID0gcmVhZGFibGVTdHJlYW0ocGF5TG9hZEJ1ZmZlcilcclxuICAgIH1cclxuICAgIGNvbnN0IG1lc3NhZ2VUeXBlID0gaGVhZGVyc1snbWVzc2FnZS10eXBlJ11cclxuXHJcbiAgICBzd2l0Y2ggKG1lc3NhZ2VUeXBlKSB7XHJcbiAgICAgIGNhc2UgJ2Vycm9yJzoge1xyXG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGhlYWRlcnNbJ2Vycm9yLWNvZGUnXSArICc6XCInICsgaGVhZGVyc1snZXJyb3ItbWVzc2FnZSddICsgJ1wiJ1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXHJcbiAgICAgIH1cclxuICAgICAgY2FzZSAnZXZlbnQnOiB7XHJcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBoZWFkZXJzWydjb250ZW50LXR5cGUnXVxyXG4gICAgICAgIGNvbnN0IGV2ZW50VHlwZSA9IGhlYWRlcnNbJ2V2ZW50LXR5cGUnXVxyXG5cclxuICAgICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xyXG4gICAgICAgICAgY2FzZSAnRW5kJzoge1xyXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlc3BvbnNlKHJlcylcclxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdFJlc3VsdHNcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICBjYXNlICdSZWNvcmRzJzoge1xyXG4gICAgICAgICAgICBjb25zdCByZWFkRGF0YSA9IHBheWxvYWRTdHJlYW0/LnJlYWQocGF5TG9hZExlbmd0aClcclxuICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRSZWNvcmRzKHJlYWREYXRhKVxyXG4gICAgICAgICAgICBicmVha1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN3aXRjaCAoY29udGVudFR5cGUpIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xyXG4gICAgICAgICAgICAgICAgICBjb25zdCBwcm9ncmVzc0RhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXHJcbiAgICAgICAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0UHJvZ3Jlc3MocHJvZ3Jlc3NEYXRhLnRvU3RyaW5nKCkpXHJcbiAgICAgICAgICAgICAgICAgIGJyZWFrXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB7XHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFByb2dyZXNzYFxyXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVha1xyXG4gICAgICAgICAgY2FzZSAnU3RhdHMnOlxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRzRGF0YSA9IHBheWxvYWRTdHJlYW0/LnJlYWQocGF5TG9hZExlbmd0aClcclxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRTdGF0cyhzdGF0c0RhdGEudG9TdHJpbmcoKSlcclxuICAgICAgICAgICAgICAgICAgYnJlYWtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcclxuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgU3RhdHNgXHJcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrXHJcbiAgICAgICAgICBkZWZhdWx0OiB7XHJcbiAgICAgICAgICAgIC8vIENvbnRpbnVhdGlvbiBtZXNzYWdlOiBOb3Qgc3VyZSBpZiBpdCBpcyBzdXBwb3J0ZWQuIGRpZCBub3QgZmluZCBhIHJlZmVyZW5jZSBvciBhbnkgbWVzc2FnZSBpbiByZXNwb25zZS5cclxuICAgICAgICAgICAgLy8gSXQgZG9lcyBub3QgaGF2ZSBhIHBheWxvYWQuXHJcbiAgICAgICAgICAgIGNvbnN0IHdhcm5pbmdNZXNzYWdlID0gYFVuIGltcGxlbWVudGVkIGV2ZW50IGRldGVjdGVkICAke21lc3NhZ2VUeXBlfS5gXHJcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nTWVzc2FnZSlcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpZmVjeWNsZUNvbmZpZyh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyh4bWw6IHN0cmluZykge1xyXG4gIHJldHVybiBwYXJzZVhtbCh4bWwpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBjb25zdCByZXRlbnRpb25Db25maWcgPSB4bWxPYmouUmV0ZW50aW9uXHJcbiAgcmV0dXJuIHtcclxuICAgIG1vZGU6IHJldGVudGlvbkNvbmZpZy5Nb2RlLFxyXG4gICAgcmV0YWluVW50aWxEYXRlOiByZXRlbnRpb25Db25maWcuUmV0YWluVW50aWxEYXRlLFxyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZU9iamVjdHNQYXJzZXIoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgaWYgKHhtbE9iai5EZWxldGVSZXN1bHQgJiYgeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcikge1xyXG4gICAgLy8gcmV0dXJuIGVycm9ycyBhcyBhcnJheSBhbHdheXMuIGFzIHRoZSByZXNwb25zZSBpcyBvYmplY3QgaW4gY2FzZSBvZiBzaW5nbGUgb2JqZWN0IHBhc3NlZCBpbiByZW1vdmVPYmplY3RzXHJcbiAgICByZXR1cm4gdG9BcnJheSh4bWxPYmouRGVsZXRlUmVzdWx0LkVycm9yKVxyXG4gIH1cclxuICByZXR1cm4gW11cclxufVxyXG5cclxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBjb3B5IG9iamVjdFxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb3B5T2JqZWN0KHhtbDogc3RyaW5nKTogQ29weU9iamVjdFJlc3VsdFYxIHtcclxuICBjb25zdCByZXN1bHQ6IENvcHlPYmplY3RSZXN1bHRWMSA9IHtcclxuICAgIGV0YWc6ICcnLFxyXG4gICAgbGFzdE1vZGlmaWVkOiAnJyxcclxuICB9XHJcblxyXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgaWYgKCF4bWxvYmouQ29weU9iamVjdFJlc3VsdCkge1xyXG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkNvcHlPYmplY3RSZXN1bHRcIicpXHJcbiAgfVxyXG4gIHhtbG9iaiA9IHhtbG9iai5Db3B5T2JqZWN0UmVzdWx0XHJcbiAgaWYgKHhtbG9iai5FVGFnKSB7XHJcbiAgICByZXN1bHQuZXRhZyA9IHhtbG9iai5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxyXG4gIH1cclxuICBpZiAoeG1sb2JqLkxhc3RNb2RpZmllZCkge1xyXG4gICAgcmVzdWx0Lmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHhtbG9iai5MYXN0TW9kaWZpZWQpXHJcbiAgfVxyXG5cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbmNvbnN0IGZvcm1hdE9iakluZm8gPSAoY29udGVudDogT2JqZWN0Um93RW50cnksIG9wdHM6IHsgSXNEZWxldGVNYXJrZXI/OiBib29sZWFuIH0gPSB7fSkgPT4ge1xyXG4gIGNvbnN0IHsgS2V5LCBMYXN0TW9kaWZpZWQsIEVUYWcsIFNpemUsIFZlcnNpb25JZCwgSXNMYXRlc3QgfSA9IGNvbnRlbnRcclxuXHJcbiAgaWYgKCFpc09iamVjdChvcHRzKSkge1xyXG4gICAgb3B0cyA9IHt9XHJcbiAgfVxyXG5cclxuICBjb25zdCBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShLZXkpWzBdIHx8ICcnKVxyXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IExhc3RNb2RpZmllZCA/IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSB8fCAnJykgOiB1bmRlZmluZWRcclxuICBjb25zdCBldGFnID0gc2FuaXRpemVFVGFnKHRvQXJyYXkoRVRhZylbMF0gfHwgJycpXHJcbiAgY29uc3Qgc2l6ZSA9IHNhbml0aXplU2l6ZShTaXplIHx8ICcnKVxyXG5cclxuICByZXR1cm4ge1xyXG4gICAgbmFtZSxcclxuICAgIGxhc3RNb2RpZmllZCxcclxuICAgIGV0YWcsXHJcbiAgICBzaXplLFxyXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXHJcbiAgICBpc0xhdGVzdDogSXNMYXRlc3QsXHJcbiAgICBpc0RlbGV0ZU1hcmtlcjogb3B0cy5Jc0RlbGV0ZU1hcmtlciA/IG9wdHMuSXNEZWxldGVNYXJrZXIgOiBmYWxzZSxcclxuICB9XHJcbn1cclxuXHJcbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RPYmplY3RzKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgcmVzdWx0OiB7XHJcbiAgICBvYmplY3RzOiBPYmplY3RJbmZvW11cclxuICAgIGlzVHJ1bmNhdGVkPzogYm9vbGVhblxyXG4gICAgbmV4dE1hcmtlcj86IHN0cmluZ1xyXG4gICAgdmVyc2lvbklkTWFya2VyPzogc3RyaW5nXHJcbiAgICBrZXlNYXJrZXI/OiBzdHJpbmdcclxuICB9ID0ge1xyXG4gICAgb2JqZWN0czogW10sXHJcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXHJcbiAgICBuZXh0TWFya2VyOiB1bmRlZmluZWQsXHJcbiAgICB2ZXJzaW9uSWRNYXJrZXI6IHVuZGVmaW5lZCxcclxuICAgIGtleU1hcmtlcjogdW5kZWZpbmVkLFxyXG4gIH1cclxuICBsZXQgaXNUcnVuY2F0ZWQgPSBmYWxzZVxyXG4gIGxldCBuZXh0TWFya2VyXHJcbiAgY29uc3QgeG1sb2JqID0gZnhwV2l0aG91dE51bVBhcnNlci5wYXJzZSh4bWwpXHJcblxyXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAoY29tbW9uUHJlZml4RW50cnk6IENvbW1vblByZWZpeFtdKSA9PiB7XHJcbiAgICBpZiAoY29tbW9uUHJlZml4RW50cnkpIHtcclxuICAgICAgdG9BcnJheShjb21tb25QcmVmaXhFbnRyeSkuZm9yRWFjaCgoY29tbW9uUHJlZml4KSA9PiB7XHJcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSB8fCAnJyksIHNpemU6IDAgfSlcclxuICAgICAgfSlcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGNvbnN0IGxpc3RCdWNrZXRSZXN1bHQ6IExpc3RCdWNrZXRSZXN1bHRWMSA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XHJcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0OiBMaXN0QnVja2V0UmVzdWx0VjEgPSB4bWxvYmouTGlzdFZlcnNpb25zUmVzdWx0XHJcblxyXG4gIGlmIChsaXN0QnVja2V0UmVzdWx0KSB7XHJcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZCkge1xyXG4gICAgICBpc1RydW5jYXRlZCA9IGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWRcclxuICAgIH1cclxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKSB7XHJcbiAgICAgIHRvQXJyYXkobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykuZm9yRWFjaCgoY29udGVudCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbnRlbnQuS2V5KVswXSB8fCAnJylcclxuICAgICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh0b0FycmF5KGNvbnRlbnQuTGFzdE1vZGlmaWVkKVswXSB8fCAnJylcclxuICAgICAgICBjb25zdCBldGFnID0gc2FuaXRpemVFVGFnKHRvQXJyYXkoY29udGVudC5FVGFnKVswXSB8fCAnJylcclxuICAgICAgICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKGNvbnRlbnQuU2l6ZSB8fCAnJylcclxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplIH0pXHJcbiAgICAgIH0pXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuTWFya2VyKSB7XHJcbiAgICAgIG5leHRNYXJrZXIgPSBsaXN0QnVja2V0UmVzdWx0Lk1hcmtlclxyXG4gICAgfVxyXG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuTmV4dE1hcmtlcikge1xyXG4gICAgICBuZXh0TWFya2VyID0gbGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyXHJcbiAgICB9IGVsc2UgaWYgKGlzVHJ1bmNhdGVkICYmIHJlc3VsdC5vYmplY3RzLmxlbmd0aCA+IDApIHtcclxuICAgICAgbmV4dE1hcmtlciA9IHJlc3VsdC5vYmplY3RzW3Jlc3VsdC5vYmplY3RzLmxlbmd0aCAtIDFdPy5uYW1lXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcykge1xyXG4gICAgICBwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5KGxpc3RCdWNrZXRSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBpZiAobGlzdFZlcnNpb25zUmVzdWx0KSB7XHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LklzVHJ1bmNhdGVkKSB7XHJcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdFZlcnNpb25zUmVzdWx0LklzVHJ1bmNhdGVkXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5WZXJzaW9uKSB7XHJcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pLmZvckVhY2goKGNvbnRlbnQpID0+IHtcclxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCkpXHJcbiAgICAgIH0pXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikge1xyXG4gICAgICB0b0FycmF5KGxpc3RWZXJzaW9uc1Jlc3VsdC5EZWxldGVNYXJrZXIpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcclxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCwgeyBJc0RlbGV0ZU1hcmtlcjogdHJ1ZSB9KSlcclxuICAgICAgfSlcclxuICAgIH1cclxuXHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXIpIHtcclxuICAgICAgcmVzdWx0LmtleU1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXIpIHtcclxuICAgICAgcmVzdWx0LnZlcnNpb25JZE1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LkNvbW1vblByZWZpeGVzKSB7XHJcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdFZlcnNpb25zUmVzdWx0LkNvbW1vblByZWZpeGVzKVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmVzdWx0LmlzVHJ1bmNhdGVkID0gaXNUcnVuY2F0ZWRcclxuICBpZiAoaXNUcnVuY2F0ZWQpIHtcclxuICAgIHJlc3VsdC5uZXh0TWFya2VyID0gbmV4dE1hcmtlclxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB1cGxvYWRQYXJ0UGFyc2VyKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIGNvbnN0IHJlc3BFbCA9IHhtbE9iai5Db3B5UGFydFJlc3VsdFxyXG4gIHJldHVybiByZXNwRWxcclxufVxyXG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUdBLElBQUFBLFVBQUEsR0FBQUMsT0FBQTtBQUNBLElBQUFD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QixDQUFDcE4sV0FBVyxFQUFFO01BQ2xDTCxXQUFXLEdBQUd5TixrQkFBa0IsQ0FBQ3BOLFdBQVc7SUFDOUM7SUFFQSxJQUFJb04sa0JBQWtCLENBQUNLLE9BQU8sRUFBRTtNQUM5QixJQUFBdE4sZUFBTyxFQUFDaU4sa0JBQWtCLENBQUNLLE9BQU8sQ0FBQyxDQUFDblAsT0FBTyxDQUFFOEIsT0FBTyxJQUFLO1FBQ3ZEWCxNQUFNLENBQUNDLE9BQU8sQ0FBQzRCLElBQUksQ0FBQzRLLGFBQWEsQ0FBQzlMLE9BQU8sQ0FBQyxDQUFDO01BQzdDLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSWdOLGtCQUFrQixDQUFDTSxZQUFZLEVBQUU7TUFDbkMsSUFBQXZOLGVBQU8sRUFBQ2lOLGtCQUFrQixDQUFDTSxZQUFZLENBQUMsQ0FBQ3BQLE9BQU8sQ0FBRThCLE9BQU8sSUFBSztRQUM1RFgsTUFBTSxDQUFDQyxPQUFPLENBQUM0QixJQUFJLENBQUM0SyxhQUFhLENBQUM5TCxPQUFPLEVBQUU7VUFBRXdNLGNBQWMsRUFBRTtRQUFLLENBQUMsQ0FBQyxDQUFDO01BQ3ZFLENBQUMsQ0FBQztJQUNKO0lBRUEsSUFBSVEsa0JBQWtCLENBQUMxSCxhQUFhLEVBQUU7TUFDcENqRyxNQUFNLENBQUN1TixTQUFTLEdBQUdJLGtCQUFrQixDQUFDMUgsYUFBYTtJQUNyRDtJQUNBLElBQUkwSCxrQkFBa0IsQ0FBQ08sbUJBQW1CLEVBQUU7TUFDMUNsTyxNQUFNLENBQUNzTixlQUFlLEdBQUdLLGtCQUFrQixDQUFDTyxtQkFBbUI7SUFDakU7SUFDQSxJQUFJUCxrQkFBa0IsQ0FBQzdMLGNBQWMsRUFBRTtNQUNyQzBMLHlCQUF5QixDQUFDRyxrQkFBa0IsQ0FBQzdMLGNBQWMsQ0FBQztJQUM5RDtFQUNGO0VBRUE5QixNQUFNLENBQUNFLFdBQVcsR0FBR0EsV0FBVztFQUNoQyxJQUFJQSxXQUFXLEVBQUU7SUFDZkYsTUFBTSxDQUFDcU4sVUFBVSxHQUFHQSxVQUFVO0VBQ2hDO0VBQ0EsT0FBT3JOLE1BQU07QUFDZjtBQUVPLFNBQVNtTyxnQkFBZ0JBLENBQUN0USxHQUFXLEVBQUU7RUFDNUMsTUFBTVcsTUFBTSxHQUFHLElBQUFWLGdCQUFRLEVBQUNELEdBQUcsQ0FBQztFQUM1QixNQUFNdVEsTUFBTSxHQUFHNVAsTUFBTSxDQUFDNlAsY0FBYztFQUNwQyxPQUFPRCxNQUFNO0FBQ2YiLCJpZ25vcmVMaXN0IjpbXX0=