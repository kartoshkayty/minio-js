"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
class CopyConditions {
  modified = '';
  unmodified = '';
  matchETag = '';
  matchETagExcept = '';
  setModified(date) {
    if (!(date instanceof Date)) {
      throw new TypeError('date must be of type Date');
    }
    this.modified = date.toUTCString();
  }
  setUnmodified(date) {
    if (!(date instanceof Date)) {
      throw new TypeError('date must be of type Date');
    }
    this.unmodified = date.toUTCString();
  }
  setMatchETag(etag) {
    this.matchETag = etag;
  }
  setMatchETagExcept(etag) {
    this.matchETagExcept = etag;
  }
}
exports.CopyConditions = CopyConditions;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJDb3B5Q29uZGl0aW9ucyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRVRhZ0V4Y2VwdCIsInNldE1vZGlmaWVkIiwiZGF0ZSIsIkRhdGUiLCJUeXBlRXJyb3IiLCJ0b1VUQ1N0cmluZyIsInNldFVubW9kaWZpZWQiLCJzZXRNYXRjaEVUYWciLCJldGFnIiwic2V0TWF0Y2hFVGFnRXhjZXB0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbImNvcHktY29uZGl0aW9ucy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY2xhc3MgQ29weUNvbmRpdGlvbnMge1xyXG4gIHB1YmxpYyBtb2RpZmllZCA9ICcnXHJcbiAgcHVibGljIHVubW9kaWZpZWQgPSAnJ1xyXG4gIHB1YmxpYyBtYXRjaEVUYWcgPSAnJ1xyXG4gIHB1YmxpYyBtYXRjaEVUYWdFeGNlcHQgPSAnJ1xyXG5cclxuICBzZXRNb2RpZmllZChkYXRlOiBEYXRlKTogdm9pZCB7XHJcbiAgICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGF0ZSBtdXN0IGJlIG9mIHR5cGUgRGF0ZScpXHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5tb2RpZmllZCA9IGRhdGUudG9VVENTdHJpbmcoKVxyXG4gIH1cclxuXHJcbiAgc2V0VW5tb2RpZmllZChkYXRlOiBEYXRlKTogdm9pZCB7XHJcbiAgICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGF0ZSBtdXN0IGJlIG9mIHR5cGUgRGF0ZScpXHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy51bm1vZGlmaWVkID0gZGF0ZS50b1VUQ1N0cmluZygpXHJcbiAgfVxyXG5cclxuICBzZXRNYXRjaEVUYWcoZXRhZzogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLm1hdGNoRVRhZyA9IGV0YWdcclxuICB9XHJcblxyXG4gIHNldE1hdGNoRVRhZ0V4Y2VwdChldGFnOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMubWF0Y2hFVGFnRXhjZXB0ID0gZXRhZ1xyXG4gIH1cclxufVxyXG4iXSwibWFwcGluZ3MiOiI7Ozs7O0FBQU8sTUFBTUEsY0FBYyxDQUFDO0VBQ25CQyxRQUFRLEdBQUcsRUFBRTtFQUNiQyxVQUFVLEdBQUcsRUFBRTtFQUNmQyxTQUFTLEdBQUcsRUFBRTtFQUNkQyxlQUFlLEdBQUcsRUFBRTtFQUUzQkMsV0FBV0EsQ0FBQ0MsSUFBVSxFQUFRO0lBQzVCLElBQUksRUFBRUEsSUFBSSxZQUFZQyxJQUFJLENBQUMsRUFBRTtNQUMzQixNQUFNLElBQUlDLFNBQVMsQ0FBQywyQkFBMkIsQ0FBQztJQUNsRDtJQUVBLElBQUksQ0FBQ1AsUUFBUSxHQUFHSyxJQUFJLENBQUNHLFdBQVcsQ0FBQyxDQUFDO0VBQ3BDO0VBRUFDLGFBQWFBLENBQUNKLElBQVUsRUFBUTtJQUM5QixJQUFJLEVBQUVBLElBQUksWUFBWUMsSUFBSSxDQUFDLEVBQUU7TUFDM0IsTUFBTSxJQUFJQyxTQUFTLENBQUMsMkJBQTJCLENBQUM7SUFDbEQ7SUFFQSxJQUFJLENBQUNOLFVBQVUsR0FBR0ksSUFBSSxDQUFDRyxXQUFXLENBQUMsQ0FBQztFQUN0QztFQUVBRSxZQUFZQSxDQUFDQyxJQUFZLEVBQVE7SUFDL0IsSUFBSSxDQUFDVCxTQUFTLEdBQUdTLElBQUk7RUFDdkI7RUFFQUMsa0JBQWtCQSxDQUFDRCxJQUFZLEVBQVE7SUFDckMsSUFBSSxDQUFDUixlQUFlLEdBQUdRLElBQUk7RUFDN0I7QUFDRjtBQUFDRSxPQUFBLENBQUFkLGNBQUEsR0FBQUEsY0FBQSIsImlnbm9yZUxpc3QiOltdfQ==