"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helper = require("./helper.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// Build PostPolicy object that can be signed by presignedPostPolicy

class PostPolicy {
  policy = {
    conditions: []
  };
  formData = {};

  // set expiration date
  setExpires(date) {
    if (!date) {
      throw new errors.InvalidDateError('Invalid date: cannot be null');
    }
    this.policy.expiration = date.toISOString();
  }

  // set object name
  setKey(objectName) {
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name : ${objectName}`);
    }
    this.policy.conditions.push(['eq', '$key', objectName]);
    this.formData.key = objectName;
  }

  // set object name prefix, i.e policy allows any keys with this prefix
  setKeyStartsWith(prefix) {
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    this.policy.conditions.push(['starts-with', '$key', prefix]);
    this.formData.key = prefix;
  }

  // set bucket name
  setBucket(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }
    this.policy.conditions.push(['eq', '$bucket', bucketName]);
    this.formData.bucket = bucketName;
  }

  // set Content-Type
  setContentType(type) {
    if (!type) {
      throw new Error('content-type cannot be null');
    }
    this.policy.conditions.push(['eq', '$Content-Type', type]);
    this.formData['Content-Type'] = type;
  }

  // set Content-Type prefix, i.e image/ allows any image
  setContentTypeStartsWith(prefix) {
    if (!prefix) {
      throw new Error('content-type cannot be null');
    }
    this.policy.conditions.push(['starts-with', '$Content-Type', prefix]);
    this.formData['Content-Type'] = prefix;
  }

  // set Content-Disposition
  setContentDisposition(value) {
    if (!value) {
      throw new Error('content-disposition cannot be null');
    }
    this.policy.conditions.push(['eq', '$Content-Disposition', value]);
    this.formData['Content-Disposition'] = value;
  }

  // set minimum/maximum length of what Content-Length can be.
  setContentLengthRange(min, max) {
    if (min > max) {
      throw new Error('min cannot be more than max');
    }
    if (min < 0) {
      throw new Error('min should be > 0');
    }
    if (max < 0) {
      throw new Error('max should be > 0');
    }
    this.policy.conditions.push(['content-length-range', min, max]);
  }

  // set user defined metadata
  setUserMetaData(metaData) {
    if (!(0, _helper.isObject)(metaData)) {
      throw new TypeError('metadata should be of type "object"');
    }
    Object.entries(metaData).forEach(([key, value]) => {
      const amzMetaDataKey = `x-amz-meta-${key}`;
      this.policy.conditions.push(['eq', `$${amzMetaDataKey}`, value]);
      this.formData[amzMetaDataKey] = value.toString();
    });
  }
}
exports.PostPolicy = PostPolicy;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJlcnJvcnMiLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJfaGVscGVyIiwiZSIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJfX2VzTW9kdWxlIiwibyIsImkiLCJmIiwiX19wcm90b19fIiwiZGVmYXVsdCIsImhhcyIsImdldCIsInNldCIsImhhc093blByb3BlcnR5IiwiY2FsbCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiUG9zdFBvbGljeSIsInBvbGljeSIsImNvbmRpdGlvbnMiLCJmb3JtRGF0YSIsInNldEV4cGlyZXMiLCJkYXRlIiwiSW52YWxpZERhdGVFcnJvciIsImV4cGlyYXRpb24iLCJ0b0lTT1N0cmluZyIsInNldEtleSIsIm9iamVjdE5hbWUiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJwdXNoIiwia2V5Iiwic2V0S2V5U3RhcnRzV2l0aCIsInByZWZpeCIsImlzVmFsaWRQcmVmaXgiLCJJbnZhbGlkUHJlZml4RXJyb3IiLCJzZXRCdWNrZXQiLCJidWNrZXROYW1lIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiYnVja2V0Iiwic2V0Q29udGVudFR5cGUiLCJ0eXBlIiwiRXJyb3IiLCJzZXRDb250ZW50VHlwZVN0YXJ0c1dpdGgiLCJzZXRDb250ZW50RGlzcG9zaXRpb24iLCJ2YWx1ZSIsInNldENvbnRlbnRMZW5ndGhSYW5nZSIsIm1pbiIsIm1heCIsInNldFVzZXJNZXRhRGF0YSIsIm1ldGFEYXRhIiwiaXNPYmplY3QiLCJUeXBlRXJyb3IiLCJlbnRyaWVzIiwiZm9yRWFjaCIsImFtek1ldGFEYXRhS2V5IiwidG9TdHJpbmciLCJleHBvcnRzIl0sInNvdXJjZXMiOlsicG9zdC1wb2xpY3kudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gQnVpbGQgUG9zdFBvbGljeSBvYmplY3QgdGhhdCBjYW4gYmUgc2lnbmVkIGJ5IHByZXNpZ25lZFBvc3RQb2xpY3lcclxuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcclxuaW1wb3J0IHsgaXNPYmplY3QsIGlzVmFsaWRCdWNrZXROYW1lLCBpc1ZhbGlkT2JqZWN0TmFtZSwgaXNWYWxpZFByZWZpeCB9IGZyb20gJy4vaGVscGVyLnRzJ1xyXG5pbXBvcnQgdHlwZSB7IE9iamVjdE1ldGFEYXRhIH0gZnJvbSAnLi90eXBlLnRzJ1xyXG5cclxuZXhwb3J0IGNsYXNzIFBvc3RQb2xpY3kge1xyXG4gIHB1YmxpYyBwb2xpY3k6IHsgY29uZGl0aW9uczogKHN0cmluZyB8IG51bWJlcilbXVtdOyBleHBpcmF0aW9uPzogc3RyaW5nIH0gPSB7XHJcbiAgICBjb25kaXRpb25zOiBbXSxcclxuICB9XHJcbiAgcHVibGljIGZvcm1EYXRhOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cclxuXHJcbiAgLy8gc2V0IGV4cGlyYXRpb24gZGF0ZVxyXG4gIHNldEV4cGlyZXMoZGF0ZTogRGF0ZSkge1xyXG4gICAgaWYgKCFkYXRlKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZERhdGVFcnJvcignSW52YWxpZCBkYXRlOiBjYW5ub3QgYmUgbnVsbCcpXHJcbiAgICB9XHJcbiAgICB0aGlzLnBvbGljeS5leHBpcmF0aW9uID0gZGF0ZS50b0lTT1N0cmluZygpXHJcbiAgfVxyXG5cclxuICAvLyBzZXQgb2JqZWN0IG5hbWVcclxuICBzZXRLZXkob2JqZWN0TmFtZTogc3RyaW5nKSB7XHJcbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZSA6ICR7b2JqZWN0TmFtZX1gKVxyXG4gICAgfVxyXG4gICAgdGhpcy5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJGtleScsIG9iamVjdE5hbWVdKVxyXG4gICAgdGhpcy5mb3JtRGF0YS5rZXkgPSBvYmplY3ROYW1lXHJcbiAgfVxyXG5cclxuICAvLyBzZXQgb2JqZWN0IG5hbWUgcHJlZml4LCBpLmUgcG9saWN5IGFsbG93cyBhbnkga2V5cyB3aXRoIHRoaXMgcHJlZml4XHJcbiAgc2V0S2V5U3RhcnRzV2l0aChwcmVmaXg6IHN0cmluZykge1xyXG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcclxuICAgIH1cclxuICAgIHRoaXMucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ3N0YXJ0cy13aXRoJywgJyRrZXknLCBwcmVmaXhdKVxyXG4gICAgdGhpcy5mb3JtRGF0YS5rZXkgPSBwcmVmaXhcclxuICB9XHJcblxyXG4gIC8vIHNldCBidWNrZXQgbmFtZVxyXG4gIHNldEJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpIHtcclxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lIDogJHtidWNrZXROYW1lfWApXHJcbiAgICB9XHJcbiAgICB0aGlzLnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckYnVja2V0JywgYnVja2V0TmFtZV0pXHJcbiAgICB0aGlzLmZvcm1EYXRhLmJ1Y2tldCA9IGJ1Y2tldE5hbWVcclxuICB9XHJcblxyXG4gIC8vIHNldCBDb250ZW50LVR5cGVcclxuICBzZXRDb250ZW50VHlwZSh0eXBlOiBzdHJpbmcpIHtcclxuICAgIGlmICghdHlwZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvbnRlbnQtdHlwZSBjYW5ub3QgYmUgbnVsbCcpXHJcbiAgICB9XHJcbiAgICB0aGlzLnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckQ29udGVudC1UeXBlJywgdHlwZV0pXHJcbiAgICB0aGlzLmZvcm1EYXRhWydDb250ZW50LVR5cGUnXSA9IHR5cGVcclxuICB9XHJcblxyXG4gIC8vIHNldCBDb250ZW50LVR5cGUgcHJlZml4LCBpLmUgaW1hZ2UvIGFsbG93cyBhbnkgaW1hZ2VcclxuICBzZXRDb250ZW50VHlwZVN0YXJ0c1dpdGgocHJlZml4OiBzdHJpbmcpIHtcclxuICAgIGlmICghcHJlZml4KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignY29udGVudC10eXBlIGNhbm5vdCBiZSBudWxsJylcclxuICAgIH1cclxuICAgIHRoaXMucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ3N0YXJ0cy13aXRoJywgJyRDb250ZW50LVR5cGUnLCBwcmVmaXhdKVxyXG4gICAgdGhpcy5mb3JtRGF0YVsnQ29udGVudC1UeXBlJ10gPSBwcmVmaXhcclxuICB9XHJcblxyXG4gIC8vIHNldCBDb250ZW50LURpc3Bvc2l0aW9uXHJcbiAgc2V0Q29udGVudERpc3Bvc2l0aW9uKHZhbHVlOiBzdHJpbmcpIHtcclxuICAgIGlmICghdmFsdWUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdjb250ZW50LWRpc3Bvc2l0aW9uIGNhbm5vdCBiZSBudWxsJylcclxuICAgIH1cclxuICAgIHRoaXMucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyRDb250ZW50LURpc3Bvc2l0aW9uJywgdmFsdWVdKVxyXG4gICAgdGhpcy5mb3JtRGF0YVsnQ29udGVudC1EaXNwb3NpdGlvbiddID0gdmFsdWVcclxuICB9XHJcblxyXG4gIC8vIHNldCBtaW5pbXVtL21heGltdW0gbGVuZ3RoIG9mIHdoYXQgQ29udGVudC1MZW5ndGggY2FuIGJlLlxyXG4gIHNldENvbnRlbnRMZW5ndGhSYW5nZShtaW46IG51bWJlciwgbWF4OiBudW1iZXIpIHtcclxuICAgIGlmIChtaW4gPiBtYXgpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdtaW4gY2Fubm90IGJlIG1vcmUgdGhhbiBtYXgnKVxyXG4gICAgfVxyXG4gICAgaWYgKG1pbiA8IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdtaW4gc2hvdWxkIGJlID4gMCcpXHJcbiAgICB9XHJcbiAgICBpZiAobWF4IDwgMCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ21heCBzaG91bGQgYmUgPiAwJylcclxuICAgIH1cclxuICAgIHRoaXMucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2NvbnRlbnQtbGVuZ3RoLXJhbmdlJywgbWluLCBtYXhdKVxyXG4gIH1cclxuXHJcbiAgLy8gc2V0IHVzZXIgZGVmaW5lZCBtZXRhZGF0YVxyXG4gIHNldFVzZXJNZXRhRGF0YShtZXRhRGF0YTogT2JqZWN0TWV0YURhdGEpIHtcclxuICAgIGlmICghaXNPYmplY3QobWV0YURhdGEpKSB7XHJcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ldGFkYXRhIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxyXG4gICAgfVxyXG4gICAgT2JqZWN0LmVudHJpZXMobWV0YURhdGEpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xyXG4gICAgICBjb25zdCBhbXpNZXRhRGF0YUtleSA9IGB4LWFtei1tZXRhLSR7a2V5fWBcclxuICAgICAgdGhpcy5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCBgJCR7YW16TWV0YURhdGFLZXl9YCwgdmFsdWVdKVxyXG4gICAgICB0aGlzLmZvcm1EYXRhW2Ftek1ldGFEYXRhS2V5XSA9IHZhbHVlLnRvU3RyaW5nKClcclxuICAgIH0pXHJcbiAgfVxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFDQSxJQUFBQSxNQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxPQUFBLEdBQUFELE9BQUE7QUFBMkYsU0FBQUQsd0JBQUFHLENBQUEsRUFBQUMsQ0FBQSw2QkFBQUMsT0FBQSxNQUFBQyxDQUFBLE9BQUFELE9BQUEs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