import crc32 from 'buffer-crc32';
import { XMLParser } from 'fast-xml-parser';
import * as errors from "../errors.mjs";
import { SelectResults } from "../helpers.mjs";
import { isObject, parseXml, readableStream, sanitizeETag, sanitizeObjectKey, sanitizeSize, toArray } from "./helper.mjs";
import { readAsString } from "./response.mjs";
import { RETENTION_VALIDITY_UNITS } from "./type.mjs";

// parse XML response for bucket region
export function parseBucketRegion(xml) {
  // return region information
  return parseXml(xml).LocationConstraint;
}
const fxp = new XMLParser();
const fxpWithoutNumParser = new XMLParser({
  // @ts-ignore
  numberParseOptions: {
    skipLike: /./
  }
});

// Parse XML and return information as Javascript types
// parse error XML response
export function parseError(xml, headerInfo) {
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
export async function parseResponseError(response) {
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
  const xmlString = await readAsString(response);
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
export function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = parseXml(xml);
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
    toArray(xmlobj.Contents).forEach(content => {
      const name = sanitizeObjectKey(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = sanitizeETag(content.ETag);
      const size = content.Size;
      let tags = {};
      if (content.UserTags != null) {
        toArray(content.UserTags.split('&')).forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value;
        });
      } else {
        tags = {};
      }
      let metadata;
      if (content.UserMetadata != null) {
        metadata = toArray(content.UserMetadata)[0];
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
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
// parse XML response for list parts of an in progress multipart upload
export function parseListParts(xml) {
  let xmlobj = parseXml(xml);
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
    result.marker = toArray(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    toArray(xmlobj.Part).forEach(p => {
      const part = parseInt(toArray(p.PartNumber)[0], 10);
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
export function parseListBucket(xml) {
  let result = [];
  const listBucketResultParser = new XMLParser({
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
    result = toArray(Buckets.Bucket).map((bucket = {}) => {
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
export function parseInitiateMultipart(xml) {
  let xmlobj = parseXml(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
export function parseReplicationConfig(xml) {
  const xmlObj = parseXml(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: toArray(Rule)
    }
  };
}
export function parseObjectLegalHoldConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LegalHold;
}
export function parseTagging(xml) {
  const xmlObj = parseXml(xml);
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
export function parseCompleteMultipart(xml) {
  const xmlobj = parseXml(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = toArray(xmlobj.Location)[0];
    const bucket = toArray(xmlobj.Bucket)[0];
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
    const errCode = toArray(xmlobj.Code)[0];
    const errMessage = toArray(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
export function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = parseXml(xml);
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
    toArray(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: sanitizeObjectKey(toArray(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    toArray(xmlobj.Upload).forEach(upload => {
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
export function parseObjectLockConfig(xml) {
  const xmlObj = parseXml(xml);
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
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
export function parseBucketVersioningConfig(xml) {
  const xmlObj = parseXml(xml);
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
export function parseSelectObjectContentResponse(res) {
  const selectResults = new SelectResults({}); // will be returned

  const responseStream = readableStream(res); // convert byte array to a readable responseStream
  // @ts-ignore
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = crc32(preludeCrcBuffer, msgCrcAccumulator);
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
      msgCrcAccumulator = crc32(headerBytes, msgCrcAccumulator);
      const headerReaderStream = readableStream(headerBytes);
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
      msgCrcAccumulator = crc32(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = readableStream(payLoadBuffer);
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
export function parseLifecycleConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LifecycleConfiguration;
}
export function parseBucketEncryptionConfig(xml) {
  return parseXml(xml);
}
export function parseObjectRetentionConfig(xml) {
  const xmlObj = parseXml(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
export function removeObjectsParser(xml) {
  const xmlObj = parseXml(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return toArray(xmlObj.DeleteResult.Error);
  }
  return [];
}

// parse XML response for copy object
export function parseCopyObject(xml) {
  const result = {
    etag: '',
    lastModified: ''
  };
  let xmlobj = parseXml(xml);
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
  if (!isObject(opts)) {
    opts = {};
  }
  const name = sanitizeObjectKey(toArray(Key)[0] || '');
  const lastModified = LastModified ? new Date(toArray(LastModified)[0] || '') : undefined;
  const etag = sanitizeETag(toArray(ETag)[0] || '');
  const size = sanitizeSize(Size || '');
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
export function parseListObjects(xml) {
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
      toArray(commonPrefixEntry).forEach(commonPrefix => {
        result.objects.push({
          prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0] || ''),
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
      toArray(listBucketResult.Contents).forEach(content => {
        const name = sanitizeObjectKey(toArray(content.Key)[0] || '');
        const lastModified = new Date(toArray(content.LastModified)[0] || '');
        const etag = sanitizeETag(toArray(content.ETag)[0] || '');
        const size = sanitizeSize(content.Size || '');
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
      toArray(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      toArray(listVersionsResult.DeleteMarker).forEach(content => {
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
export function uploadPartParser(xml) {
  const xmlObj = parseXml(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmMzMiIsIlhNTFBhcnNlciIsImVycm9ycyIsIlNlbGVjdFJlc3VsdHMiLCJpc09iamVjdCIsInBhcnNlWG1sIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJzYW5pdGl6ZU9iamVjdEtleSIsInNhbml0aXplU2l6ZSIsInRvQXJyYXkiLCJyZWFkQXNTdHJpbmciLCJSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsInhtbCIsIkxvY2F0aW9uQ29uc3RyYWludCIsImZ4cCIsImZ4cFdpdGhvdXROdW1QYXJzZXIiLCJudW1iZXJQYXJzZU9wdGlvbnMiLCJza2lwTGlrZSIsInBhcnNlRXJyb3IiLCJoZWFkZXJJbmZvIiwieG1sRXJyIiwieG1sT2JqIiwicGFyc2UiLCJFcnJvciIsImUiLCJTM0Vycm9yIiwiT2JqZWN0IiwiZW50cmllcyIsImZvckVhY2giLCJrZXkiLCJ2YWx1ZSIsInRvTG93ZXJDYXNlIiwicGFyc2VSZXNwb25zZUVycm9yIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiY29kZSIsIm1lc3NhZ2UiLCJoRXJyQ29kZSIsImhlYWRlcnMiLCJoRXJyRGVzYyIsImFtelJlcXVlc3RpZCIsImFteklkMiIsImFtekJ1Y2tldFJlZ2lvbiIsInhtbFN0cmluZyIsImNhdXNlIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwicmVzdWx0Iiwib2JqZWN0cyIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwieG1sb2JqIiwiTGlzdEJ1Y2tldFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIklzVHJ1bmNhdGVkIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwiQ29udGVudHMiLCJjb250ZW50IiwibmFtZSIsIktleSIsImxhc3RNb2RpZmllZCIsIkRhdGUiLCJMYXN0TW9kaWZpZWQiLCJldGFnIiwiRVRhZyIsInNpemUiLCJTaXplIiwidGFncyIsIlVzZXJUYWdzIiwic3BsaXQiLCJ0YWciLCJtZXRhZGF0YSIsIlVzZXJNZXRhZGF0YSIsInB1c2giLCJDb21tb25QcmVmaXhlcyIsImNvbW1vblByZWZpeCIsInByZWZpeCIsIlByZWZpeCIsInBhcnNlTGlzdFBhcnRzIiwicGFydHMiLCJtYXJrZXIiLCJMaXN0UGFydHNSZXN1bHQiLCJOZXh0UGFydE51bWJlck1hcmtlciIsIlBhcnQiLCJwIiwicGFydCIsInBhcnNlSW50IiwiUGFydE51bWJlciIsInJlcGxhY2UiLCJwYXJzZUxpc3RCdWNrZXQiLCJsaXN0QnVja2V0UmVzdWx0UGFyc2VyIiwicGFyc2VUYWdWYWx1ZSIsImxlYWRpbmdaZXJvcyIsImhleCIsInRhZ1ZhbHVlUHJvY2Vzc29yIiwidGFnTmFtZSIsInRhZ1ZhbHVlIiwidG9TdHJpbmciLCJpZ25vcmVBdHRyaWJ1dGVzIiwicGFyc2VkWG1sUmVzIiwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdCIsIkJ1Y2tldHMiLCJCdWNrZXQiLCJtYXAiLCJidWNrZXQiLCJOYW1lIiwiYnVja2V0TmFtZSIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIlVwbG9hZElkIiwicGFyc2VSZXBsaWNhdGlvbkNvbmZpZyIsIlJvbGUiLCJSdWxlIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwicm9sZSIsInJ1bGVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJMZWdhbEhvbGQiLCJwYXJzZVRhZ2dpbmciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwidGFnUmVzdWx0IiwiQXJyYXkiLCJpc0FycmF5IiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiTG9jYXRpb24iLCJsb2NhdGlvbiIsIkNvZGUiLCJNZXNzYWdlIiwiZXJyQ29kZSIsImVyck1lc3NhZ2UiLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJwcmVmaXhlcyIsInVwbG9hZHMiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQiLCJOZXh0S2V5TWFya2VyIiwiTmV4dFVwbG9hZElkTWFya2VyIiwiVXBsb2FkIiwidXBsb2FkIiwidXBsb2FkSXRlbSIsInVwbG9hZElkIiwic3RvcmFnZUNsYXNzIiwiU3RvcmFnZUNsYXNzIiwiaW5pdGlhdGVkIiwiSW5pdGlhdGVkIiwiSW5pdGlhdG9yIiwiaW5pdGlhdG9yIiwiaWQiLCJJRCIsImRpc3BsYXlOYW1lIiwiRGlzcGxheU5hbWUiLCJPd25lciIsIm93bmVyIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ1Jlc3VsdCIsIk9iamVjdExvY2tDb25maWd1cmF0aW9uIiwib2JqZWN0TG9ja0VuYWJsZWQiLCJPYmplY3RMb2NrRW5hYmxlZCIsInJldGVudGlvblJlc3AiLCJEZWZhdWx0UmV0ZW50aW9uIiwibW9kZSIsIk1vZGUiLCJpc1VuaXRZZWFycyIsIlllYXJzIiwidmFsaWRpdHkiLCJ1bml0IiwiWUVBUlMiLCJEYXlzIiwiREFZUyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsIlZlcnNpb25pbmdDb25maWd1cmF0aW9uIiwiZXh0cmFjdEhlYWRlclR5cGUiLCJzdHJlYW0iLCJoZWFkZXJOYW1lTGVuIiwiQnVmZmVyIiwiZnJvbSIsInJlYWQiLCJyZWFkVUludDgiLCJoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciIsInNwbGl0QnlTZXBhcmF0b3IiLCJsZW5ndGgiLCJleHRyYWN0SGVhZGVyVmFsdWUiLCJib2R5TGVuIiwicmVhZFVJbnQxNkJFIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJyZXMiLCJzZWxlY3RSZXN1bHRzIiwicmVzcG9uc2VTdHJlYW0iLCJfcmVhZGFibGVTdGF0ZSIsIm1zZ0NyY0FjY3VtdWxhdG9yIiwidG90YWxCeXRlTGVuZ3RoQnVmZmVyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlckJ5dGVzIiwiaGVhZGVyUmVhZGVyU3RyZWFtIiwiaGVhZGVyVHlwZU5hbWUiLCJwYXlsb2FkU3RyZWFtIiwicGF5TG9hZExlbmd0aCIsInBheUxvYWRCdWZmZXIiLCJtZXNzYWdlQ3JjQnl0ZVZhbHVlIiwiY2FsY3VsYXRlZENyYyIsIm1lc3NhZ2VUeXBlIiwiZXJyb3JNZXNzYWdlIiwiY29udGVudFR5cGUiLCJldmVudFR5cGUiLCJzZXRSZXNwb25zZSIsIl9wYXlsb2FkU3RyZWFtIiwicmVhZERhdGEiLCJzZXRSZWNvcmRzIiwiX3BheWxvYWRTdHJlYW0yIiwicHJvZ3Jlc3NEYXRhIiwic2V0UHJvZ3Jlc3MiLCJfcGF5bG9hZFN0cmVhbTMiLCJzdGF0c0RhdGEiLCJzZXRTdGF0cyIsIndhcm5pbmdNZXNzYWdlIiwiY29uc29sZSIsIndhcm4iLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsInJldGFpblVudGlsRGF0ZSIsIlJldGFpblVudGlsRGF0ZSIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJEZWxldGVSZXN1bHQiLCJwYXJzZUNvcHlPYmplY3QiLCJDb3B5T2JqZWN0UmVzdWx0IiwiZm9ybWF0T2JqSW5mbyIsIm9wdHMiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsInVuZGVmaW5lZCIsInZlcnNpb25JZCIsImlzTGF0ZXN0IiwiaXNEZWxldGVNYXJrZXIiLCJJc0RlbGV0ZU1hcmtlciIsInBhcnNlTGlzdE9iamVjdHMiLCJuZXh0TWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwia2V5TWFya2VyIiwicGFyc2VDb21tb25QcmVmaXhlc0VudGl0eSIsImNvbW1vblByZWZpeEVudHJ5IiwibGlzdEJ1Y2tldFJlc3VsdCIsImxpc3RWZXJzaW9uc1Jlc3VsdCIsIkxpc3RWZXJzaW9uc1Jlc3VsdCIsIk1hcmtlciIsIk5leHRNYXJrZXIiLCJfcmVzdWx0JG9iamVjdHMiLCJWZXJzaW9uIiwiRGVsZXRlTWFya2VyIiwiTmV4dFZlcnNpb25JZE1hcmtlciIsInVwbG9hZFBhcnRQYXJzZXIiLCJyZXNwRWwiLCJDb3B5UGFydFJlc3VsdCJdLCJzb3VyY2VzIjpbInhtbC1wYXJzZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcclxuaW1wb3J0IHR5cGUgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xyXG5cclxuaW1wb3J0IGNyYzMyIGZyb20gJ2J1ZmZlci1jcmMzMidcclxuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xyXG5cclxuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcclxuaW1wb3J0IHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXHJcbmltcG9ydCB7IGlzT2JqZWN0LCBwYXJzZVhtbCwgcmVhZGFibGVTdHJlYW0sIHNhbml0aXplRVRhZywgc2FuaXRpemVPYmplY3RLZXksIHNhbml0aXplU2l6ZSwgdG9BcnJheSB9IGZyb20gJy4vaGVscGVyLnRzJ1xyXG5pbXBvcnQgeyByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xyXG5pbXBvcnQgdHlwZSB7XHJcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxyXG4gIEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGEsXHJcbiAgQ29tbW9uUHJlZml4LFxyXG4gIENvcHlPYmplY3RSZXN1bHRWMSxcclxuICBMaXN0QnVja2V0UmVzdWx0VjEsXHJcbiAgT2JqZWN0SW5mbyxcclxuICBPYmplY3RMb2NrSW5mbyxcclxuICBPYmplY3RSb3dFbnRyeSxcclxuICBSZXBsaWNhdGlvbkNvbmZpZyxcclxuICBUYWcsXHJcbiAgVGFncyxcclxufSBmcm9tICcuL3R5cGUudHMnXHJcbmltcG9ydCB7IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUyB9IGZyb20gJy4vdHlwZS50cydcclxuXHJcbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IHJlZ2lvblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRSZWdpb24oeG1sOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIC8vIHJldHVybiByZWdpb24gaW5mb3JtYXRpb25cclxuICByZXR1cm4gcGFyc2VYbWwoeG1sKS5Mb2NhdGlvbkNvbnN0cmFpbnRcclxufVxyXG5cclxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXHJcblxyXG5jb25zdCBmeHBXaXRob3V0TnVtUGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XHJcbiAgLy8gQHRzLWlnbm9yZVxyXG4gIG51bWJlclBhcnNlT3B0aW9uczoge1xyXG4gICAgc2tpcExpa2U6IC8uLyxcclxuICB9LFxyXG59KVxyXG5cclxuLy8gUGFyc2UgWE1MIGFuZCByZXR1cm4gaW5mb3JtYXRpb24gYXMgSmF2YXNjcmlwdCB0eXBlc1xyXG4vLyBwYXJzZSBlcnJvciBYTUwgcmVzcG9uc2VcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRXJyb3IoeG1sOiBzdHJpbmcsIGhlYWRlckluZm86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XHJcbiAgbGV0IHhtbEVyciA9IHt9XHJcbiAgY29uc3QgeG1sT2JqID0gZnhwLnBhcnNlKHhtbClcclxuICBpZiAoeG1sT2JqLkVycm9yKSB7XHJcbiAgICB4bWxFcnIgPSB4bWxPYmouRXJyb3JcclxuICB9XHJcbiAgY29uc3QgZSA9IG5ldyBlcnJvcnMuUzNFcnJvcigpIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cclxuICBPYmplY3QuZW50cmllcyh4bWxFcnIpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xyXG4gICAgZVtrZXkudG9Mb3dlckNhc2UoKV0gPSB2YWx1ZVxyXG4gIH0pXHJcbiAgT2JqZWN0LmVudHJpZXMoaGVhZGVySW5mbykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XHJcbiAgICBlW2tleV0gPSB2YWx1ZVxyXG4gIH0pXHJcbiAgcmV0dXJuIGVcclxufVxyXG5cclxuLy8gR2VuZXJhdGVzIGFuIEVycm9yIG9iamVjdCBkZXBlbmRpbmcgb24gaHR0cCBzdGF0dXNDb2RlIGFuZCBYTUwgYm9keVxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSk6IFByb21pc2U8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4ge1xyXG4gIGNvbnN0IHN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXNDb2RlXHJcbiAgbGV0IGNvZGUgPSAnJyxcclxuICAgIG1lc3NhZ2UgPSAnJ1xyXG4gIGlmIChzdGF0dXNDb2RlID09PSAzMDEpIHtcclxuICAgIGNvZGUgPSAnTW92ZWRQZXJtYW5lbnRseSdcclxuICAgIG1lc3NhZ2UgPSAnTW92ZWQgUGVybWFuZW50bHknXHJcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSAzMDcpIHtcclxuICAgIGNvZGUgPSAnVGVtcG9yYXJ5UmVkaXJlY3QnXHJcbiAgICBtZXNzYWdlID0gJ0FyZSB5b3UgdXNpbmcgdGhlIGNvcnJlY3QgZW5kcG9pbnQgVVJMPydcclxuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwMykge1xyXG4gICAgY29kZSA9ICdBY2Nlc3NEZW5pZWQnXHJcbiAgICBtZXNzYWdlID0gJ1ZhbGlkIGFuZCBhdXRob3JpemVkIGNyZWRlbnRpYWxzIHJlcXVpcmVkJ1xyXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDA0KSB7XHJcbiAgICBjb2RlID0gJ05vdEZvdW5kJ1xyXG4gICAgbWVzc2FnZSA9ICdOb3QgRm91bmQnXHJcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDUpIHtcclxuICAgIGNvZGUgPSAnTWV0aG9kTm90QWxsb3dlZCdcclxuICAgIG1lc3NhZ2UgPSAnTWV0aG9kIE5vdCBBbGxvd2VkJ1xyXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNTAxKSB7XHJcbiAgICBjb2RlID0gJ01ldGhvZE5vdEFsbG93ZWQnXHJcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcclxuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDUwMykge1xyXG4gICAgY29kZSA9ICdTbG93RG93bidcclxuICAgIG1lc3NhZ2UgPSAnUGxlYXNlIHJlZHVjZSB5b3VyIHJlcXVlc3QgcmF0ZS4nXHJcbiAgfSBlbHNlIHtcclxuICAgIGNvbnN0IGhFcnJDb2RlID0gcmVzcG9uc2UuaGVhZGVyc1sneC1taW5pby1lcnJvci1jb2RlJ10gYXMgc3RyaW5nXHJcbiAgICBjb25zdCBoRXJyRGVzYyA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtbWluaW8tZXJyb3ItZGVzYyddIGFzIHN0cmluZ1xyXG5cclxuICAgIGlmIChoRXJyQ29kZSAmJiBoRXJyRGVzYykge1xyXG4gICAgICBjb2RlID0gaEVyckNvZGVcclxuICAgICAgbWVzc2FnZSA9IGhFcnJEZXNjXHJcbiAgICB9XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlckluZm86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGw+ID0ge31cclxuICAvLyBBIHZhbHVlIGNyZWF0ZWQgYnkgUzMgY29tcGF0aWJsZSBzZXJ2ZXIgdGhhdCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSByZXF1ZXN0LlxyXG4gIGhlYWRlckluZm8uYW16UmVxdWVzdGlkID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotcmVxdWVzdC1pZCddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxyXG4gIC8vIEEgc3BlY2lhbCB0b2tlbiB0aGF0IGhlbHBzIHRyb3VibGVzaG9vdCBBUEkgcmVwbGllcyBhbmQgaXNzdWVzLlxyXG4gIGhlYWRlckluZm8uYW16SWQyID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotaWQtMiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxyXG5cclxuICAvLyBSZWdpb24gd2hlcmUgdGhlIGJ1Y2tldCBpcyBsb2NhdGVkLiBUaGlzIGhlYWRlciBpcyByZXR1cm5lZCBvbmx5XHJcbiAgLy8gaW4gSEVBRCBidWNrZXQgYW5kIExpc3RPYmplY3RzIHJlc3BvbnNlLlxyXG4gIGhlYWRlckluZm8uYW16QnVja2V0UmVnaW9uID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotYnVja2V0LXJlZ2lvbiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxyXG5cclxuICBjb25zdCB4bWxTdHJpbmcgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXHJcblxyXG4gIGlmICh4bWxTdHJpbmcpIHtcclxuICAgIHRocm93IHBhcnNlRXJyb3IoeG1sU3RyaW5nLCBoZWFkZXJJbmZvKVxyXG4gIH1cclxuXHJcbiAgLy8gTWVzc2FnZSBzaG91bGQgYmUgaW5zdGFudGlhdGVkIGZvciBlYWNoIFMzRXJyb3JzLlxyXG4gIGNvbnN0IGUgPSBuZXcgZXJyb3JzLlMzRXJyb3IobWVzc2FnZSwgeyBjYXVzZTogaGVhZGVySW5mbyB9KVxyXG4gIC8vIFMzIEVycm9yIGNvZGUuXHJcbiAgZS5jb2RlID0gY29kZVxyXG4gIE9iamVjdC5lbnRyaWVzKGhlYWRlckluZm8pLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xyXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBmb3JjZSBzZXQgZXJyb3IgcHJvcGVydGllc1xyXG4gICAgZVtrZXldID0gdmFsdWVcclxuICB9KVxyXG5cclxuICB0aHJvdyBlXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3Qgb2JqZWN0cyB2MiB3aXRoIG1ldGFkYXRhIGluIGEgYnVja2V0XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgcmVzdWx0OiB7XHJcbiAgICBvYmplY3RzOiBBcnJheTxCdWNrZXRJdGVtV2l0aE1ldGFkYXRhPlxyXG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cclxuICAgIG5leHRDb250aW51YXRpb25Ub2tlbjogc3RyaW5nXHJcbiAgfSA9IHtcclxuICAgIG9iamVjdHM6IFtdLFxyXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxyXG4gICAgbmV4dENvbnRpbnVhdGlvblRva2VuOiAnJyxcclxuICB9XHJcblxyXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xyXG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RCdWNrZXRSZXN1bHRcIicpXHJcbiAgfVxyXG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XHJcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xyXG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXHJcbiAgfVxyXG4gIGlmICh4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuKSB7XHJcbiAgICByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuID0geG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlblxyXG4gIH1cclxuXHJcbiAgaWYgKHhtbG9iai5Db250ZW50cykge1xyXG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcclxuICAgICAgY29uc3QgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KGNvbnRlbnQuS2V5KVxyXG4gICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShjb250ZW50Lkxhc3RNb2RpZmllZClcclxuICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXHJcbiAgICAgIGNvbnN0IHNpemUgPSBjb250ZW50LlNpemVcclxuXHJcbiAgICAgIGxldCB0YWdzOiBUYWdzID0ge31cclxuICAgICAgaWYgKGNvbnRlbnQuVXNlclRhZ3MgIT0gbnVsbCkge1xyXG4gICAgICAgIHRvQXJyYXkoY29udGVudC5Vc2VyVGFncy5zcGxpdCgnJicpKS5mb3JFYWNoKCh0YWcpID0+IHtcclxuICAgICAgICAgIGNvbnN0IFtrZXksIHZhbHVlXSA9IHRhZy5zcGxpdCgnPScpXHJcbiAgICAgICAgICB0YWdzW2tleV0gPSB2YWx1ZVxyXG4gICAgICAgIH0pXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGFncyA9IHt9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxldCBtZXRhZGF0YVxyXG4gICAgICBpZiAoY29udGVudC5Vc2VyTWV0YWRhdGEgIT0gbnVsbCkge1xyXG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBtZXRhZGF0YSA9IG51bGxcclxuICAgICAgfVxyXG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplLCBtZXRhZGF0YSwgdGFncyB9KVxyXG4gICAgfSlcclxuICB9XHJcblxyXG4gIGlmICh4bWxvYmouQ29tbW9uUHJlZml4ZXMpIHtcclxuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcclxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSksIHNpemU6IDAgfSlcclxuICAgIH0pXHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHRcclxufVxyXG5cclxuZXhwb3J0IHR5cGUgVXBsb2FkZWRQYXJ0ID0ge1xyXG4gIHBhcnQ6IG51bWJlclxyXG4gIGxhc3RNb2RpZmllZD86IERhdGVcclxuICBldGFnOiBzdHJpbmdcclxuICBzaXplOiBudW1iZXJcclxufVxyXG5cclxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IHBhcnRzIG9mIGFuIGluIHByb2dyZXNzIG11bHRpcGFydCB1cGxvYWRcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdFBhcnRzKHhtbDogc3RyaW5nKToge1xyXG4gIGlzVHJ1bmNhdGVkOiBib29sZWFuXHJcbiAgbWFya2VyOiBudW1iZXJcclxuICBwYXJ0czogVXBsb2FkZWRQYXJ0W11cclxufSB7XHJcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBjb25zdCByZXN1bHQ6IHtcclxuICAgIGlzVHJ1bmNhdGVkOiBib29sZWFuXHJcbiAgICBtYXJrZXI6IG51bWJlclxyXG4gICAgcGFydHM6IFVwbG9hZGVkUGFydFtdXHJcbiAgfSA9IHtcclxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcclxuICAgIHBhcnRzOiBbXSxcclxuICAgIG1hcmtlcjogMCxcclxuICB9XHJcbiAgaWYgKCF4bWxvYmouTGlzdFBhcnRzUmVzdWx0KSB7XHJcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdFBhcnRzUmVzdWx0XCInKVxyXG4gIH1cclxuICB4bWxvYmogPSB4bWxvYmouTGlzdFBhcnRzUmVzdWx0XHJcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xyXG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXHJcbiAgfVxyXG4gIGlmICh4bWxvYmouTmV4dFBhcnROdW1iZXJNYXJrZXIpIHtcclxuICAgIHJlc3VsdC5tYXJrZXIgPSB0b0FycmF5KHhtbG9iai5OZXh0UGFydE51bWJlck1hcmtlcilbMF0gfHwgJydcclxuICB9XHJcbiAgaWYgKHhtbG9iai5QYXJ0KSB7XHJcbiAgICB0b0FycmF5KHhtbG9iai5QYXJ0KS5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICAgIGNvbnN0IHBhcnQgPSBwYXJzZUludCh0b0FycmF5KHAuUGFydE51bWJlcilbMF0sIDEwKVxyXG4gICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShwLkxhc3RNb2RpZmllZClcclxuICAgICAgY29uc3QgZXRhZyA9IHAuRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXHJcbiAgICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxyXG4gICAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXHJcbiAgICAgIHJlc3VsdC5wYXJ0cy5wdXNoKHsgcGFydCwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplOiBwYXJzZUludChwLlNpemUsIDEwKSB9KVxyXG4gICAgfSlcclxuICB9XHJcbiAgcmV0dXJuIHJlc3VsdFxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0QnVja2V0KHhtbDogc3RyaW5nKTogQnVja2V0SXRlbUZyb21MaXN0W10ge1xyXG4gIGxldCByZXN1bHQ6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdID0gW11cclxuICBjb25zdCBsaXN0QnVja2V0UmVzdWx0UGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XHJcbiAgICBwYXJzZVRhZ1ZhbHVlOiB0cnVlLCAvLyBFbmFibGUgcGFyc2luZyBvZiB2YWx1ZXNcclxuICAgIG51bWJlclBhcnNlT3B0aW9uczoge1xyXG4gICAgICBsZWFkaW5nWmVyb3M6IGZhbHNlLCAvLyBEaXNhYmxlIG51bWJlciBwYXJzaW5nIGZvciB2YWx1ZXMgd2l0aCBsZWFkaW5nIHplcm9zXHJcbiAgICAgIGhleDogZmFsc2UsIC8vIERpc2FibGUgaGV4IG51bWJlciBwYXJzaW5nIC0gSW52YWxpZCBidWNrZXQgbmFtZVxyXG4gICAgICBza2lwTGlrZTogL15bMC05XSskLywgLy8gU2tpcCBudW1iZXIgcGFyc2luZyBpZiB0aGUgdmFsdWUgY29uc2lzdHMgZW50aXJlbHkgb2YgZGlnaXRzXHJcbiAgICB9LFxyXG4gICAgdGFnVmFsdWVQcm9jZXNzb3I6ICh0YWdOYW1lLCB0YWdWYWx1ZSA9ICcnKSA9PiB7XHJcbiAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBOYW1lIHRhZyBpcyBhbHdheXMgdHJlYXRlZCBhcyBhIHN0cmluZ1xyXG4gICAgICBpZiAodGFnTmFtZSA9PT0gJ05hbWUnKSB7XHJcbiAgICAgICAgcmV0dXJuIHRhZ1ZhbHVlLnRvU3RyaW5nKClcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gdGFnVmFsdWVcclxuICAgIH0sXHJcbiAgICBpZ25vcmVBdHRyaWJ1dGVzOiBmYWxzZSwgLy8gRW5zdXJlIHRoYXQgYWxsIGF0dHJpYnV0ZXMgYXJlIHBhcnNlZFxyXG4gIH0pXHJcblxyXG4gIGNvbnN0IHBhcnNlZFhtbFJlcyA9IGxpc3RCdWNrZXRSZXN1bHRQYXJzZXIucGFyc2UoeG1sKVxyXG5cclxuICBpZiAoIXBhcnNlZFhtbFJlcy5MaXN0QWxsTXlCdWNrZXRzUmVzdWx0KSB7XHJcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdFwiJylcclxuICB9XHJcblxyXG4gIGNvbnN0IHsgTGlzdEFsbE15QnVja2V0c1Jlc3VsdDogeyBCdWNrZXRzID0ge30gfSA9IHt9IH0gPSBwYXJzZWRYbWxSZXNcclxuXHJcbiAgaWYgKEJ1Y2tldHMuQnVja2V0KSB7XHJcbiAgICByZXN1bHQgPSB0b0FycmF5KEJ1Y2tldHMuQnVja2V0KS5tYXAoKGJ1Y2tldCA9IHt9KSA9PiB7XHJcbiAgICAgIGNvbnN0IHsgTmFtZTogYnVja2V0TmFtZSwgQ3JlYXRpb25EYXRlIH0gPSBidWNrZXRcclxuICAgICAgY29uc3QgY3JlYXRpb25EYXRlID0gbmV3IERhdGUoQ3JlYXRpb25EYXRlKVxyXG5cclxuICAgICAgcmV0dXJuIHsgbmFtZTogYnVja2V0TmFtZSwgY3JlYXRpb25EYXRlIH1cclxuICAgIH0pXHJcbiAgfVxyXG5cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0KHhtbDogc3RyaW5nKTogc3RyaW5nIHtcclxuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxyXG5cclxuICBpZiAoIXhtbG9iai5Jbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCkge1xyXG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XCInKVxyXG4gIH1cclxuICB4bWxvYmogPSB4bWxvYmouSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHRcclxuXHJcbiAgaWYgKHhtbG9iai5VcGxvYWRJZCkge1xyXG4gICAgcmV0dXJuIHhtbG9iai5VcGxvYWRJZFxyXG4gIH1cclxuICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiVXBsb2FkSWRcIicpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVJlcGxpY2F0aW9uQ29uZmlnKHhtbDogc3RyaW5nKTogUmVwbGljYXRpb25Db25maWcge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBjb25zdCB7IFJvbGUsIFJ1bGUgfSA9IHhtbE9iai5SZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb25cclxuICByZXR1cm4ge1xyXG4gICAgUmVwbGljYXRpb25Db25maWd1cmF0aW9uOiB7XHJcbiAgICAgIHJvbGU6IFJvbGUsXHJcbiAgICAgIHJ1bGVzOiB0b0FycmF5KFJ1bGUpLFxyXG4gICAgfSxcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICByZXR1cm4geG1sT2JqLkxlZ2FsSG9sZFxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUYWdnaW5nKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIGxldCByZXN1bHQ6IFRhZ1tdID0gW11cclxuICBpZiAoeG1sT2JqLlRhZ2dpbmcgJiYgeG1sT2JqLlRhZ2dpbmcuVGFnU2V0ICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldC5UYWcpIHtcclxuICAgIGNvbnN0IHRhZ1Jlc3VsdDogVGFnID0geG1sT2JqLlRhZ2dpbmcuVGFnU2V0LlRhZ1xyXG4gICAgLy8gaWYgaXQgaXMgYSBzaW5nbGUgdGFnIGNvbnZlcnQgaW50byBhbiBhcnJheSBzbyB0aGF0IHRoZSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIGFuIGFycmF5LlxyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodGFnUmVzdWx0KSkge1xyXG4gICAgICByZXN1bHQgPSBbLi4udGFnUmVzdWx0XVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcmVzdWx0LnB1c2godGFnUmVzdWx0KVxyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbi8vIHBhcnNlIFhNTCByZXNwb25zZSB3aGVuIGEgbXVsdGlwYXJ0IHVwbG9hZCBpcyBjb21wbGV0ZWRcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XHJcbiAgaWYgKHhtbG9iai5Mb2NhdGlvbikge1xyXG4gICAgY29uc3QgbG9jYXRpb24gPSB0b0FycmF5KHhtbG9iai5Mb2NhdGlvbilbMF1cclxuICAgIGNvbnN0IGJ1Y2tldCA9IHRvQXJyYXkoeG1sb2JqLkJ1Y2tldClbMF1cclxuICAgIGNvbnN0IGtleSA9IHhtbG9iai5LZXlcclxuICAgIGNvbnN0IGV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcclxuXHJcbiAgICByZXR1cm4geyBsb2NhdGlvbiwgYnVja2V0LCBrZXksIGV0YWcgfVxyXG4gIH1cclxuICAvLyBDb21wbGV0ZSBNdWx0aXBhcnQgY2FuIHJldHVybiBYTUwgRXJyb3IgYWZ0ZXIgYSAyMDAgT0sgcmVzcG9uc2VcclxuICBpZiAoeG1sb2JqLkNvZGUgJiYgeG1sb2JqLk1lc3NhZ2UpIHtcclxuICAgIGNvbnN0IGVyckNvZGUgPSB0b0FycmF5KHhtbG9iai5Db2RlKVswXVxyXG4gICAgY29uc3QgZXJyTWVzc2FnZSA9IHRvQXJyYXkoeG1sb2JqLk1lc3NhZ2UpWzBdXHJcbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cclxuICB9XHJcbn1cclxuXHJcbnR5cGUgVXBsb2FkSUQgPSBzdHJpbmdcclxuXHJcbmV4cG9ydCB0eXBlIExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XHJcbiAgdXBsb2Fkczoge1xyXG4gICAga2V5OiBzdHJpbmdcclxuICAgIHVwbG9hZElkOiBVcGxvYWRJRFxyXG4gICAgaW5pdGlhdG9yPzogeyBpZDogc3RyaW5nOyBkaXNwbGF5TmFtZTogc3RyaW5nIH1cclxuICAgIG93bmVyPzogeyBpZDogc3RyaW5nOyBkaXNwbGF5TmFtZTogc3RyaW5nIH1cclxuICAgIHN0b3JhZ2VDbGFzczogdW5rbm93blxyXG4gICAgaW5pdGlhdGVkOiBEYXRlXHJcbiAgfVtdXHJcbiAgcHJlZml4ZXM6IHtcclxuICAgIHByZWZpeDogc3RyaW5nXHJcbiAgfVtdXHJcbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cclxuICBuZXh0S2V5TWFya2VyOiBzdHJpbmdcclxuICBuZXh0VXBsb2FkSWRNYXJrZXI6IHN0cmluZ1xyXG59XHJcblxyXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3RpbmcgaW4tcHJvZ3Jlc3MgbXVsdGlwYXJ0IHVwbG9hZHNcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWw6IHN0cmluZyk6IExpc3RNdWx0aXBhcnRSZXN1bHQge1xyXG4gIGNvbnN0IHJlc3VsdDogTGlzdE11bHRpcGFydFJlc3VsdCA9IHtcclxuICAgIHByZWZpeGVzOiBbXSxcclxuICAgIHVwbG9hZHM6IFtdLFxyXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxyXG4gICAgbmV4dEtleU1hcmtlcjogJycsXHJcbiAgICBuZXh0VXBsb2FkSWRNYXJrZXI6ICcnLFxyXG4gIH1cclxuXHJcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcclxuXHJcbiAgaWYgKCF4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQpIHtcclxuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcclxuICB9XHJcbiAgeG1sb2JqID0geG1sb2JqLkxpc3RNdWx0aXBhcnRVcGxvYWRzUmVzdWx0XHJcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xyXG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXHJcbiAgfVxyXG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xyXG4gICAgcmVzdWx0Lm5leHRLZXlNYXJrZXIgPSB4bWxvYmouTmV4dEtleU1hcmtlclxyXG4gIH1cclxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xyXG4gICAgcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlciA9IHhtbG9iai5uZXh0VXBsb2FkSWRNYXJrZXIgfHwgJydcclxuICB9XHJcblxyXG4gIGlmICh4bWxvYmouQ29tbW9uUHJlZml4ZXMpIHtcclxuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChwcmVmaXgpID0+IHtcclxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBpbmRleCBjaGVja1xyXG4gICAgICByZXN1bHQucHJlZml4ZXMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheTxzdHJpbmc+KHByZWZpeC5QcmVmaXgpWzBdKSB9KVxyXG4gICAgfSlcclxuICB9XHJcblxyXG4gIGlmICh4bWxvYmouVXBsb2FkKSB7XHJcbiAgICB0b0FycmF5KHhtbG9iai5VcGxvYWQpLmZvckVhY2goKHVwbG9hZCkgPT4ge1xyXG4gICAgICBjb25zdCB1cGxvYWRJdGVtOiBMaXN0TXVsdGlwYXJ0UmVzdWx0Wyd1cGxvYWRzJ11bbnVtYmVyXSA9IHtcclxuICAgICAgICBrZXk6IHVwbG9hZC5LZXksXHJcbiAgICAgICAgdXBsb2FkSWQ6IHVwbG9hZC5VcGxvYWRJZCxcclxuICAgICAgICBzdG9yYWdlQ2xhc3M6IHVwbG9hZC5TdG9yYWdlQ2xhc3MsXHJcbiAgICAgICAgaW5pdGlhdGVkOiBuZXcgRGF0ZSh1cGxvYWQuSW5pdGlhdGVkKSxcclxuICAgICAgfVxyXG4gICAgICBpZiAodXBsb2FkLkluaXRpYXRvcikge1xyXG4gICAgICAgIHVwbG9hZEl0ZW0uaW5pdGlhdG9yID0geyBpZDogdXBsb2FkLkluaXRpYXRvci5JRCwgZGlzcGxheU5hbWU6IHVwbG9hZC5Jbml0aWF0b3IuRGlzcGxheU5hbWUgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICh1cGxvYWQuT3duZXIpIHtcclxuICAgICAgICB1cGxvYWRJdGVtLm93bmVyID0geyBpZDogdXBsb2FkLk93bmVyLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLk93bmVyLkRpc3BsYXlOYW1lIH1cclxuICAgICAgfVxyXG4gICAgICByZXN1bHQudXBsb2Fkcy5wdXNoKHVwbG9hZEl0ZW0pXHJcbiAgICB9KVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExvY2tDb25maWcoeG1sOiBzdHJpbmcpOiBPYmplY3RMb2NrSW5mbyB7XHJcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIGxldCBsb2NrQ29uZmlnUmVzdWx0ID0ge30gYXMgT2JqZWN0TG9ja0luZm9cclxuICBpZiAoeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uKSB7XHJcbiAgICBsb2NrQ29uZmlnUmVzdWx0ID0ge1xyXG4gICAgICBvYmplY3RMb2NrRW5hYmxlZDogeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLk9iamVjdExvY2tFbmFibGVkLFxyXG4gICAgfSBhcyBPYmplY3RMb2NrSW5mb1xyXG4gICAgbGV0IHJldGVudGlvblJlc3BcclxuICAgIGlmIChcclxuICAgICAgeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uICYmXHJcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlICYmXHJcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlLkRlZmF1bHRSZXRlbnRpb25cclxuICAgICkge1xyXG4gICAgICByZXRlbnRpb25SZXNwID0geG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUuRGVmYXVsdFJldGVudGlvbiB8fCB7fVxyXG4gICAgICBsb2NrQ29uZmlnUmVzdWx0Lm1vZGUgPSByZXRlbnRpb25SZXNwLk1vZGVcclxuICAgIH1cclxuICAgIGlmIChyZXRlbnRpb25SZXNwKSB7XHJcbiAgICAgIGNvbnN0IGlzVW5pdFllYXJzID0gcmV0ZW50aW9uUmVzcC5ZZWFyc1xyXG4gICAgICBpZiAoaXNVbml0WWVhcnMpIHtcclxuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gaXNVbml0WWVhcnNcclxuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnVuaXQgPSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gcmV0ZW50aW9uUmVzcC5EYXlzXHJcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVNcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGxvY2tDb25maWdSZXN1bHRcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICByZXR1cm4geG1sT2JqLlZlcnNpb25pbmdDb25maWd1cmF0aW9uXHJcbn1cclxuXHJcbi8vIFVzZWQgb25seSBpbiBzZWxlY3RPYmplY3RDb250ZW50IEFQSS5cclxuLy8gZXh0cmFjdEhlYWRlclR5cGUgZXh0cmFjdHMgdGhlIGZpcnN0IGhhbGYgb2YgdGhlIGhlYWRlciBtZXNzYWdlLCB0aGUgaGVhZGVyIHR5cGUuXHJcbmZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJUeXBlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcclxuICBjb25zdCBoZWFkZXJOYW1lTGVuID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoMSkpLnJlYWRVSW50OCgpXHJcbiAgY29uc3QgaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IgPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZChoZWFkZXJOYW1lTGVuKSkudG9TdHJpbmcoKVxyXG4gIGNvbnN0IHNwbGl0QnlTZXBhcmF0b3IgPSAoaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IgfHwgJycpLnNwbGl0KCc6JylcclxuICByZXR1cm4gc3BsaXRCeVNlcGFyYXRvci5sZW5ndGggPj0gMSA/IHNwbGl0QnlTZXBhcmF0b3JbMV0gOiAnJ1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0SGVhZGVyVmFsdWUoc3RyZWFtOiBzdHJlYW0uUmVhZGFibGUpIHtcclxuICBjb25zdCBib2R5TGVuID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoMikpLnJlYWRVSW50MTZCRSgpXHJcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShyZXM6IEJ1ZmZlcikge1xyXG4gIGNvbnN0IHNlbGVjdFJlc3VsdHMgPSBuZXcgU2VsZWN0UmVzdWx0cyh7fSkgLy8gd2lsbCBiZSByZXR1cm5lZFxyXG5cclxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cclxuICAvLyBAdHMtaWdub3JlXHJcbiAgd2hpbGUgKHJlc3BvbnNlU3RyZWFtLl9yZWFkYWJsZVN0YXRlLmxlbmd0aCkge1xyXG4gICAgLy8gVG9wIGxldmVsIHJlc3BvbnNlU3RyZWFtIHJlYWQgdHJhY2tlci5cclxuICAgIGxldCBtc2dDcmNBY2N1bXVsYXRvciAvLyBhY2N1bXVsYXRlIGZyb20gc3RhcnQgb2YgdGhlIG1lc3NhZ2UgdGlsbCB0aGUgbWVzc2FnZSBjcmMgc3RhcnQuXHJcblxyXG4gICAgY29uc3QgdG90YWxCeXRlTGVuZ3RoQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcclxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIodG90YWxCeXRlTGVuZ3RoQnVmZmVyKVxyXG5cclxuICAgIGNvbnN0IGhlYWRlckJ5dGVzQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcclxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIoaGVhZGVyQnl0ZXNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxyXG5cclxuICAgIGNvbnN0IGNhbGN1bGF0ZWRQcmVsdWRlQ3JjID0gbXNnQ3JjQWNjdW11bGF0b3IucmVhZEludDMyQkUoKSAvLyB1c2UgaXQgdG8gY2hlY2sgaWYgYW55IENSQyBtaXNtYXRjaCBpbiBoZWFkZXIgaXRzZWxmLlxyXG5cclxuICAgIGNvbnN0IHByZWx1ZGVDcmNCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKSAvLyByZWFkIDQgYnl0ZXMgICAgaS5lIDQrNCA9OCArIDQgPSAxMiAoIHByZWx1ZGUgKyBwcmVsdWRlIGNyYylcclxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocHJlbHVkZUNyY0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXHJcblxyXG4gICAgY29uc3QgdG90YWxNc2dMZW5ndGggPSB0b3RhbEJ5dGVMZW5ndGhCdWZmZXIucmVhZEludDMyQkUoKVxyXG4gICAgY29uc3QgaGVhZGVyTGVuZ3RoID0gaGVhZGVyQnl0ZXNCdWZmZXIucmVhZEludDMyQkUoKVxyXG4gICAgY29uc3QgcHJlbHVkZUNyY0J5dGVWYWx1ZSA9IHByZWx1ZGVDcmNCdWZmZXIucmVhZEludDMyQkUoKVxyXG5cclxuICAgIGlmIChwcmVsdWRlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkUHJlbHVkZUNyYykge1xyXG4gICAgICAvLyBIYW5kbGUgSGVhZGVyIENSQyBtaXNtYXRjaCBFcnJvclxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgYEhlYWRlciBDaGVja3N1bSBNaXNtYXRjaCwgUHJlbHVkZSBDUkMgb2YgJHtwcmVsdWRlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkUHJlbHVkZUNyY31gLFxyXG4gICAgICApXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fVxyXG4gICAgaWYgKGhlYWRlckxlbmd0aCA+IDApIHtcclxuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXHJcbiAgICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIoaGVhZGVyQnl0ZXMsIG1zZ0NyY0FjY3VtdWxhdG9yKVxyXG4gICAgICBjb25zdCBoZWFkZXJSZWFkZXJTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShoZWFkZXJCeXRlcylcclxuICAgICAgLy8gQHRzLWlnbm9yZVxyXG4gICAgICB3aGlsZSAoaGVhZGVyUmVhZGVyU3RyZWFtLl9yZWFkYWJsZVN0YXRlLmxlbmd0aCkge1xyXG4gICAgICAgIGNvbnN0IGhlYWRlclR5cGVOYW1lID0gZXh0cmFjdEhlYWRlclR5cGUoaGVhZGVyUmVhZGVyU3RyZWFtKVxyXG4gICAgICAgIGhlYWRlclJlYWRlclN0cmVhbS5yZWFkKDEpIC8vIGp1c3QgcmVhZCBhbmQgaWdub3JlIGl0LlxyXG4gICAgICAgIGlmIChoZWFkZXJUeXBlTmFtZSkge1xyXG4gICAgICAgICAgaGVhZGVyc1toZWFkZXJUeXBlTmFtZV0gPSBleHRyYWN0SGVhZGVyVmFsdWUoaGVhZGVyUmVhZGVyU3RyZWFtKVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGxldCBwYXlsb2FkU3RyZWFtXHJcbiAgICBjb25zdCBwYXlMb2FkTGVuZ3RoID0gdG90YWxNc2dMZW5ndGggLSBoZWFkZXJMZW5ndGggLSAxNlxyXG4gICAgaWYgKHBheUxvYWRMZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnN0IHBheUxvYWRCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpKVxyXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHBheUxvYWRCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxyXG4gICAgICAvLyByZWFkIHRoZSBjaGVja3N1bSBlYXJseSBhbmQgZGV0ZWN0IGFueSBtaXNtYXRjaCBzbyB3ZSBjYW4gYXZvaWQgdW5uZWNlc3NhcnkgZnVydGhlciBwcm9jZXNzaW5nLlxyXG4gICAgICBjb25zdCBtZXNzYWdlQ3JjQnl0ZVZhbHVlID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkucmVhZEludDMyQkUoKVxyXG4gICAgICBjb25zdCBjYWxjdWxhdGVkQ3JjID0gbXNnQ3JjQWNjdW11bGF0b3IucmVhZEludDMyQkUoKVxyXG4gICAgICAvLyBIYW5kbGUgbWVzc2FnZSBDUkMgRXJyb3JcclxuICAgICAgaWYgKG1lc3NhZ2VDcmNCeXRlVmFsdWUgIT09IGNhbGN1bGF0ZWRDcmMpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgICBgTWVzc2FnZSBDaGVja3N1bSBNaXNtYXRjaCwgTWVzc2FnZSBDUkMgb2YgJHttZXNzYWdlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkQ3JjfWAsXHJcbiAgICAgICAgKVxyXG4gICAgICB9XHJcbiAgICAgIHBheWxvYWRTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShwYXlMb2FkQnVmZmVyKVxyXG4gICAgfVxyXG4gICAgY29uc3QgbWVzc2FnZVR5cGUgPSBoZWFkZXJzWydtZXNzYWdlLXR5cGUnXVxyXG5cclxuICAgIHN3aXRjaCAobWVzc2FnZVR5cGUpIHtcclxuICAgICAgY2FzZSAnZXJyb3InOiB7XHJcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gaGVhZGVyc1snZXJyb3ItY29kZSddICsgJzpcIicgKyBoZWFkZXJzWydlcnJvci1tZXNzYWdlJ10gKyAnXCInXHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcclxuICAgICAgfVxyXG4gICAgICBjYXNlICdldmVudCc6IHtcclxuICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddXHJcbiAgICAgICAgY29uc3QgZXZlbnRUeXBlID0gaGVhZGVyc1snZXZlbnQtdHlwZSddXHJcblxyXG4gICAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XHJcbiAgICAgICAgICBjYXNlICdFbmQnOiB7XHJcbiAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0UmVzcG9uc2UocmVzKVxyXG4gICAgICAgICAgICByZXR1cm4gc2VsZWN0UmVzdWx0c1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGNhc2UgJ1JlY29yZHMnOiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlYWREYXRhID0gcGF5bG9hZFN0cmVhbT8ucmVhZChwYXlMb2FkTGVuZ3RoKVxyXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXHJcbiAgICAgICAgICAgIGJyZWFrXHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgY2FzZSAnUHJvZ3Jlc3MnOlxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2dyZXNzRGF0YSA9IHBheWxvYWRTdHJlYW0/LnJlYWQocGF5TG9hZExlbmd0aClcclxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRQcm9ncmVzcyhwcm9ncmVzc0RhdGEudG9TdHJpbmcoKSlcclxuICAgICAgICAgICAgICAgICAgYnJlYWtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcclxuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgUHJvZ3Jlc3NgXHJcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGJyZWFrXHJcbiAgICAgICAgICBjYXNlICdTdGF0cyc6XHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XHJcbiAgICAgICAgICAgICAgICBjYXNlICd0ZXh0L3htbCc6IHtcclxuICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhdHNEYXRhID0gcGF5bG9hZFN0cmVhbT8ucmVhZChwYXlMb2FkTGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFN0YXRzKHN0YXRzRGF0YS50b1N0cmluZygpKVxyXG4gICAgICAgICAgICAgICAgICBicmVha1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xyXG4gICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgVW5leHBlY3RlZCBjb250ZW50LXR5cGUgJHtjb250ZW50VHlwZX0gc2VudCBmb3IgZXZlbnQtdHlwZSBTdGF0c2BcclxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgYnJlYWtcclxuICAgICAgICAgIGRlZmF1bHQ6IHtcclxuICAgICAgICAgICAgLy8gQ29udGludWF0aW9uIG1lc3NhZ2U6IE5vdCBzdXJlIGlmIGl0IGlzIHN1cHBvcnRlZC4gZGlkIG5vdCBmaW5kIGEgcmVmZXJlbmNlIG9yIGFueSBtZXNzYWdlIGluIHJlc3BvbnNlLlxyXG4gICAgICAgICAgICAvLyBJdCBkb2VzIG5vdCBoYXZlIGEgcGF5bG9hZC5cclxuICAgICAgICAgICAgY29uc3Qgd2FybmluZ01lc3NhZ2UgPSBgVW4gaW1wbGVtZW50ZWQgZXZlbnQgZGV0ZWN0ZWQgICR7bWVzc2FnZVR5cGV9LmBcclxuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKHdhcm5pbmdNZXNzYWdlKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlmZWN5Y2xlQ29uZmlnKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIHJldHVybiB4bWxPYmouTGlmZWN5Y2xlQ29uZmlndXJhdGlvblxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnKHhtbDogc3RyaW5nKSB7XHJcbiAgcmV0dXJuIHBhcnNlWG1sKHhtbClcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKHhtbDogc3RyaW5nKSB7XHJcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxyXG4gIGNvbnN0IHJldGVudGlvbkNvbmZpZyA9IHhtbE9iai5SZXRlbnRpb25cclxuICByZXR1cm4ge1xyXG4gICAgbW9kZTogcmV0ZW50aW9uQ29uZmlnLk1vZGUsXHJcbiAgICByZXRhaW5VbnRpbERhdGU6IHJldGVudGlvbkNvbmZpZy5SZXRhaW5VbnRpbERhdGUsXHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlT2JqZWN0c1BhcnNlcih4bWw6IHN0cmluZykge1xyXG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBpZiAoeG1sT2JqLkRlbGV0ZVJlc3VsdCAmJiB4bWxPYmouRGVsZXRlUmVzdWx0LkVycm9yKSB7XHJcbiAgICAvLyByZXR1cm4gZXJyb3JzIGFzIGFycmF5IGFsd2F5cy4gYXMgdGhlIHJlc3BvbnNlIGlzIG9iamVjdCBpbiBjYXNlIG9mIHNpbmdsZSBvYmplY3QgcGFzc2VkIGluIHJlbW92ZU9iamVjdHNcclxuICAgIHJldHVybiB0b0FycmF5KHhtbE9iai5EZWxldGVSZXN1bHQuRXJyb3IpXHJcbiAgfVxyXG4gIHJldHVybiBbXVxyXG59XHJcblxyXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGNvcHkgb2JqZWN0XHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvcHlPYmplY3QoeG1sOiBzdHJpbmcpOiBDb3B5T2JqZWN0UmVzdWx0VjEge1xyXG4gIGNvbnN0IHJlc3VsdDogQ29weU9iamVjdFJlc3VsdFYxID0ge1xyXG4gICAgZXRhZzogJycsXHJcbiAgICBsYXN0TW9kaWZpZWQ6ICcnLFxyXG4gIH1cclxuXHJcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcclxuICBpZiAoIXhtbG9iai5Db3B5T2JqZWN0UmVzdWx0KSB7XHJcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiQ29weU9iamVjdFJlc3VsdFwiJylcclxuICB9XHJcbiAgeG1sb2JqID0geG1sb2JqLkNvcHlPYmplY3RSZXN1bHRcclxuICBpZiAoeG1sb2JqLkVUYWcpIHtcclxuICAgIHJlc3VsdC5ldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxyXG4gICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcclxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXHJcbiAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXHJcbiAgfVxyXG4gIGlmICh4bWxvYmouTGFzdE1vZGlmaWVkKSB7XHJcbiAgICByZXN1bHQubGFzdE1vZGlmaWVkID0gbmV3IERhdGUoeG1sb2JqLkxhc3RNb2RpZmllZClcclxuICB9XHJcblxyXG4gIHJldHVybiByZXN1bHRcclxufVxyXG5cclxuY29uc3QgZm9ybWF0T2JqSW5mbyA9IChjb250ZW50OiBPYmplY3RSb3dFbnRyeSwgb3B0czogeyBJc0RlbGV0ZU1hcmtlcj86IGJvb2xlYW4gfSA9IHt9KSA9PiB7XHJcbiAgY29uc3QgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxyXG5cclxuICBpZiAoIWlzT2JqZWN0KG9wdHMpKSB7XHJcbiAgICBvcHRzID0ge31cclxuICB9XHJcblxyXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0gfHwgJycpXHJcbiAgY29uc3QgbGFzdE1vZGlmaWVkID0gTGFzdE1vZGlmaWVkID8gbmV3IERhdGUodG9BcnJheShMYXN0TW9kaWZpZWQpWzBdIHx8ICcnKSA6IHVuZGVmaW5lZFxyXG4gIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShFVGFnKVswXSB8fCAnJylcclxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUgfHwgJycpXHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBuYW1lLFxyXG4gICAgbGFzdE1vZGlmaWVkLFxyXG4gICAgZXRhZyxcclxuICAgIHNpemUsXHJcbiAgICB2ZXJzaW9uSWQ6IFZlcnNpb25JZCxcclxuICAgIGlzTGF0ZXN0OiBJc0xhdGVzdCxcclxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxyXG4gIH1cclxufVxyXG5cclxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgaW4gYSBidWNrZXRcclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE9iamVjdHMoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCByZXN1bHQ6IHtcclxuICAgIG9iamVjdHM6IE9iamVjdEluZm9bXVxyXG4gICAgaXNUcnVuY2F0ZWQ/OiBib29sZWFuXHJcbiAgICBuZXh0TWFya2VyPzogc3RyaW5nXHJcbiAgICB2ZXJzaW9uSWRNYXJrZXI/OiBzdHJpbmdcclxuICAgIGtleU1hcmtlcj86IHN0cmluZ1xyXG4gIH0gPSB7XHJcbiAgICBvYmplY3RzOiBbXSxcclxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcclxuICAgIG5leHRNYXJrZXI6IHVuZGVmaW5lZCxcclxuICAgIHZlcnNpb25JZE1hcmtlcjogdW5kZWZpbmVkLFxyXG4gICAga2V5TWFya2VyOiB1bmRlZmluZWQsXHJcbiAgfVxyXG4gIGxldCBpc1RydW5jYXRlZCA9IGZhbHNlXHJcbiAgbGV0IG5leHRNYXJrZXJcclxuICBjb25zdCB4bWxvYmogPSBmeHBXaXRob3V0TnVtUGFyc2VyLnBhcnNlKHhtbClcclxuXHJcbiAgY29uc3QgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eSA9IChjb21tb25QcmVmaXhFbnRyeTogQ29tbW9uUHJlZml4W10pID0+IHtcclxuICAgIGlmIChjb21tb25QcmVmaXhFbnRyeSkge1xyXG4gICAgICB0b0FycmF5KGNvbW1vblByZWZpeEVudHJ5KS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcclxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdIHx8ICcnKSwgc2l6ZTogMCB9KVxyXG4gICAgICB9KVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdDogTGlzdEJ1Y2tldFJlc3VsdFYxID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcclxuICBjb25zdCBsaXN0VmVyc2lvbnNSZXN1bHQ6IExpc3RCdWNrZXRSZXN1bHRWMSA9IHhtbG9iai5MaXN0VmVyc2lvbnNSZXN1bHRcclxuXHJcbiAgaWYgKGxpc3RCdWNrZXRSZXN1bHQpIHtcclxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LklzVHJ1bmNhdGVkKSB7XHJcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZFxyXG4gICAgfVxyXG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuQ29udGVudHMpIHtcclxuICAgICAgdG9BcnJheShsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XHJcbiAgICAgICAgY29uc3QgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29udGVudC5LZXkpWzBdIHx8ICcnKVxyXG4gICAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHRvQXJyYXkoY29udGVudC5MYXN0TW9kaWZpZWQpWzBdIHx8ICcnKVxyXG4gICAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShjb250ZW50LkVUYWcpWzBdIHx8ICcnKVxyXG4gICAgICAgIGNvbnN0IHNpemUgPSBzYW5pdGl6ZVNpemUoY29udGVudC5TaXplIHx8ICcnKVxyXG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBuYW1lLCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemUgfSlcclxuICAgICAgfSlcclxuICAgIH1cclxuXHJcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5NYXJrZXIpIHtcclxuICAgICAgbmV4dE1hcmtlciA9IGxpc3RCdWNrZXRSZXN1bHQuTWFya2VyXHJcbiAgICB9XHJcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyKSB7XHJcbiAgICAgIG5leHRNYXJrZXIgPSBsaXN0QnVja2V0UmVzdWx0Lk5leHRNYXJrZXJcclxuICAgIH0gZWxzZSBpZiAoaXNUcnVuY2F0ZWQgJiYgcmVzdWx0Lm9iamVjdHMubGVuZ3RoID4gMCkge1xyXG4gICAgICBuZXh0TWFya2VyID0gcmVzdWx0Lm9iamVjdHNbcmVzdWx0Lm9iamVjdHMubGVuZ3RoIC0gMV0/Lm5hbWVcclxuICAgIH1cclxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LkNvbW1vblByZWZpeGVzKSB7XHJcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQpIHtcclxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWQpIHtcclxuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWRcclxuICAgIH1cclxuXHJcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pIHtcclxuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xyXG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goZm9ybWF0T2JqSW5mbyhjb250ZW50KSlcclxuICAgICAgfSlcclxuICAgIH1cclxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuRGVsZXRlTWFya2VyKSB7XHJcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xyXG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goZm9ybWF0T2JqSW5mbyhjb250ZW50LCB7IElzRGVsZXRlTWFya2VyOiB0cnVlIH0pKVxyXG4gICAgICB9KVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuTmV4dEtleU1hcmtlcikge1xyXG4gICAgICByZXN1bHQua2V5TWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXJcclxuICAgIH1cclxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuTmV4dFZlcnNpb25JZE1hcmtlcikge1xyXG4gICAgICByZXN1bHQudmVyc2lvbklkTWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXJcclxuICAgIH1cclxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcclxuICAgICAgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eShsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXN1bHQuaXNUcnVuY2F0ZWQgPSBpc1RydW5jYXRlZFxyXG4gIGlmIChpc1RydW5jYXRlZCkge1xyXG4gICAgcmVzdWx0Lm5leHRNYXJrZXIgPSBuZXh0TWFya2VyXHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHRcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHVwbG9hZFBhcnRQYXJzZXIoeG1sOiBzdHJpbmcpIHtcclxuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXHJcbiAgY29uc3QgcmVzcEVsID0geG1sT2JqLkNvcHlQYXJ0UmVzdWx0XHJcbiAgcmV0dXJuIHJlc3BFbFxyXG59XHJcbiJdLCJtYXBwaW5ncyI6IkFBR0EsT0FBT0EsS0FBSyxNQUFNLGNBQWM7QUFDaEMsU0FBU0MsU0FBUyxRQUFRLGlCQUFpQjtBQUUzQyxPQUFPLEtBQUtDLE1BQU0sTUFBTSxlQUFjO0FBQ3RDLFNBQVNDLGFBQWEsUUFBUSxnQkFBZTtBQUM3QyxTQUFTQyxRQUFRLEVBQUVDLFFBQVEsRUFBRUMsY0FBYyxFQUFFQyxZQUFZLEVBQUVDLGlCQUFpQixFQUFFQyxZQUFZLEVBQUVDLE9BQU8sUUFBUSxjQUFhO0FBQ3hILFNBQVNDLFlBQVksUUFBUSxnQkFBZTtBQWM1QyxTQUFTQyx3QkFBd0IsUUFBUSxZQUFXOztBQUVwRDtBQUNBLE9BQU8sU0FBU0MsaUJBQWlCQSxDQUFDQyxHQUFXLEVBQVU7RUFDckQ7RUFDQSxP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