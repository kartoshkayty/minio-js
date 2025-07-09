"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getS3Endpoint = getS3Endpoint;
var _helper = require("./helper.js");
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

// List of currently supported endpoints.
const awsS3Endpoint = {
  'af-south-1': 's3.af-south-1.amazonaws.com',
  'ap-east-1': 's3.ap-east-1.amazonaws.com',
  'ap-south-1': 's3.ap-south-1.amazonaws.com',
  'ap-south-2': 's3.ap-south-2.amazonaws.com',
  'ap-southeast-1': 's3.ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3.ap-southeast-2.amazonaws.com',
  'ap-southeast-3': 's3.ap-southeast-3.amazonaws.com',
  'ap-southeast-4': 's3.ap-southeast-4.amazonaws.com',
  'ap-southeast-5': 's3.ap-southeast-5.amazonaws.com',
  'ap-northeast-1': 's3.ap-northeast-1.amazonaws.com',
  'ap-northeast-2': 's3.ap-northeast-2.amazonaws.com',
  'ap-northeast-3': 's3.ap-northeast-3.amazonaws.com',
  'ca-central-1': 's3.ca-central-1.amazonaws.com',
  'ca-west-1': 's3.ca-west-1.amazonaws.com',
  'cn-north-1': 's3.cn-north-1.amazonaws.com.cn',
  'eu-central-1': 's3.eu-central-1.amazonaws.com',
  'eu-central-2': 's3.eu-central-2.amazonaws.com',
  'eu-north-1': 's3.eu-north-1.amazonaws.com',
  'eu-south-1': 's3.eu-south-1.amazonaws.com',
  'eu-south-2': 's3.eu-south-2.amazonaws.com',
  'eu-west-1': 's3.eu-west-1.amazonaws.com',
  'eu-west-2': 's3.eu-west-2.amazonaws.com',
  'eu-west-3': 's3.eu-west-3.amazonaws.com',
  'il-central-1': 's3.il-central-1.amazonaws.com',
  'me-central-1': 's3.me-central-1.amazonaws.com',
  'me-south-1': 's3.me-south-1.amazonaws.com',
  'sa-east-1': 's3.sa-east-1.amazonaws.com',
  'us-east-1': 's3.us-east-1.amazonaws.com',
  'us-east-2': 's3.us-east-2.amazonaws.com',
  'us-west-1': 's3.us-west-1.amazonaws.com',
  'us-west-2': 's3.us-west-2.amazonaws.com',
  'us-gov-east-1': 's3.us-gov-east-1.amazonaws.com',
  'us-gov-west-1': 's3.us-gov-west-1.amazonaws.com'
  // Add new endpoints here.
};
// getS3Endpoint get relevant endpoint for the region.
function getS3Endpoint(region) {
  if (!(0, _helper.isString)(region)) {
    throw new TypeError(`Invalid region: ${region}`);
  }
  const endpoint = awsS3Endpoint[region];
  if (endpoint) {
    return endpoint;
  }
  return 's3.amazonaws.com';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfaGVscGVyIiwicmVxdWlyZSIsImF3c1MzRW5kcG9pbnQiLCJnZXRTM0VuZHBvaW50IiwicmVnaW9uIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJlbmRwb2ludCJdLCJzb3VyY2VzIjpbInMzLWVuZHBvaW50cy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxyXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1LCAyMDE2IE1pbklPLCBJbmMuXHJcbiAqXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XHJcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cclxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XHJcbiAqXHJcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcclxuICpcclxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxyXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXHJcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxyXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXHJcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxyXG4gKi9cclxuXHJcbmltcG9ydCB7IGlzU3RyaW5nIH0gZnJvbSAnLi9oZWxwZXIudHMnXHJcblxyXG4vLyBMaXN0IG9mIGN1cnJlbnRseSBzdXBwb3J0ZWQgZW5kcG9pbnRzLlxyXG5jb25zdCBhd3NTM0VuZHBvaW50ID0ge1xyXG4gICdhZi1zb3V0aC0xJzogJ3MzLmFmLXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLWVhc3QtMSc6ICdzMy5hcC1lYXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLXNvdXRoLTEnOiAnczMuYXAtc291dGgtMS5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtc291dGgtMic6ICdzMy5hcC1zb3V0aC0yLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1zb3V0aGVhc3QtMSc6ICdzMy5hcC1zb3V0aGVhc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtc291dGhlYXN0LTInOiAnczMuYXAtc291dGhlYXN0LTIuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLXNvdXRoZWFzdC0zJzogJ3MzLmFwLXNvdXRoZWFzdC0zLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1zb3V0aGVhc3QtNCc6ICdzMy5hcC1zb3V0aGVhc3QtNC5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtc291dGhlYXN0LTUnOiAnczMuYXAtc291dGhlYXN0LTUuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLW5vcnRoZWFzdC0xJzogJ3MzLmFwLW5vcnRoZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1ub3J0aGVhc3QtMic6ICdzMy5hcC1ub3J0aGVhc3QtMi5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtbm9ydGhlYXN0LTMnOiAnczMuYXAtbm9ydGhlYXN0LTMuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2NhLWNlbnRyYWwtMSc6ICdzMy5jYS1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2NhLXdlc3QtMSc6ICdzMy5jYS13ZXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2NuLW5vcnRoLTEnOiAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJyxcclxuICAnZXUtY2VudHJhbC0xJzogJ3MzLmV1LWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtY2VudHJhbC0yJzogJ3MzLmV1LWNlbnRyYWwtMi5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtbm9ydGgtMSc6ICdzMy5ldS1ub3J0aC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdldS1zb3V0aC0xJzogJ3MzLmV1LXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LXNvdXRoLTInOiAnczMuZXUtc291dGgtMi5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtd2VzdC0xJzogJ3MzLmV1LXdlc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtd2VzdC0yJzogJ3MzLmV1LXdlc3QtMi5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtd2VzdC0zJzogJ3MzLmV1LXdlc3QtMy5hbWF6b25hd3MuY29tJyxcclxuICAnaWwtY2VudHJhbC0xJzogJ3MzLmlsLWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcclxuICAnbWUtY2VudHJhbC0xJzogJ3MzLm1lLWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcclxuICAnbWUtc291dGgtMSc6ICdzMy5tZS1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdzYS1lYXN0LTEnOiAnczMuc2EtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy1lYXN0LTEnOiAnczMudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy1lYXN0LTInOiAnczMudXMtZWFzdC0yLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy13ZXN0LTEnOiAnczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy13ZXN0LTInOiAnczMudXMtd2VzdC0yLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy1nb3YtZWFzdC0xJzogJ3MzLnVzLWdvdi1lYXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ3VzLWdvdi13ZXN0LTEnOiAnczMudXMtZ292LXdlc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAvLyBBZGQgbmV3IGVuZHBvaW50cyBoZXJlLlxyXG59XHJcblxyXG5leHBvcnQgdHlwZSBSZWdpb24gPSBrZXlvZiB0eXBlb2YgYXdzUzNFbmRwb2ludCB8IHN0cmluZ1xyXG5cclxuLy8gZ2V0UzNFbmRwb2ludCBnZXQgcmVsZXZhbnQgZW5kcG9pbnQgZm9yIHRoZSByZWdpb24uXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRTM0VuZHBvaW50KHJlZ2lvbjogUmVnaW9uKTogc3RyaW5nIHtcclxuICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcclxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgcmVnaW9uOiAke3JlZ2lvbn1gKVxyXG4gIH1cclxuXHJcbiAgY29uc3QgZW5kcG9pbnQgPSAoYXdzUzNFbmRwb2ludCBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KVtyZWdpb25dXHJcbiAgaWYgKGVuZHBvaW50KSB7XHJcbiAgICByZXR1cm4gZW5kcG9pbnRcclxuICB9XHJcbiAgcmV0dXJuICdzMy5hbWF6b25hd3MuY29tJ1xyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBZ0JBLElBQUFBLE9BQUEsR0FBQUMsT0FBQTtBQWhCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBSUE7QUFDQSxNQUFNQyxhQUFhLEdBQUc7RUFDcEIsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxZQUFZLEVBQUUsZ0NBQWdDO0VBQzlDLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsY0FBYyxFQUFFLCtCQUErQjtFQUMvQyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsZUFBZSxFQUFFLGdDQUFnQztFQUNqRCxlQUFlLEVBQUU7RUFDakI7QUFDRixDQUFDO0FBSUQ7QUFDTyxTQUFTQyxhQUFhQSxDQUFDQyxNQUFjLEVBQVU7RUFDcEQsSUFBSSxDQUFDLElBQUFDLGdCQUFRLEVBQUNELE1BQU0sQ0FBQyxFQUFFO0lBQ3JCLE1BQU0sSUFBSUUsU0FBUyxDQUFDLG1CQUFtQkYsTUFBTSxFQUFFLENBQUM7RUFDbEQ7RUFFQSxNQUFNRyxRQUFRLEdBQUlMLGFBQWEsQ0FBNEJFLE1BQU0sQ0FBQztFQUNsRSxJQUFJRyxRQUFRLEVBQUU7SUFDWixPQUFPQSxRQUFRO0VBQ2pCO0VBQ0EsT0FBTyxrQkFBa0I7QUFDM0IiLCJpZ25vcmVMaXN0IjpbXX0=