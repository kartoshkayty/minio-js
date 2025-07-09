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

import { isString } from "./helper.mjs";

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
export function getS3Endpoint(region) {
  if (!isString(region)) {
    throw new TypeError(`Invalid region: ${region}`);
  }
  const endpoint = awsS3Endpoint[region];
  if (endpoint) {
    return endpoint;
  }
  return 's3.amazonaws.com';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpc1N0cmluZyIsImF3c1MzRW5kcG9pbnQiLCJnZXRTM0VuZHBvaW50IiwicmVnaW9uIiwiVHlwZUVycm9yIiwiZW5kcG9pbnQiXSwic291cmNlcyI6WyJzMy1lbmRwb2ludHMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcclxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSwgMjAxNiBNaW5JTywgSW5jLlxyXG4gKlxyXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xyXG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXHJcbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxyXG4gKlxyXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXHJcbiAqXHJcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcclxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxyXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cclxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxyXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cclxuICovXHJcblxyXG5pbXBvcnQgeyBpc1N0cmluZyB9IGZyb20gJy4vaGVscGVyLnRzJ1xyXG5cclxuLy8gTGlzdCBvZiBjdXJyZW50bHkgc3VwcG9ydGVkIGVuZHBvaW50cy5cclxuY29uc3QgYXdzUzNFbmRwb2ludCA9IHtcclxuICAnYWYtc291dGgtMSc6ICdzMy5hZi1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1lYXN0LTEnOiAnczMuYXAtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1zb3V0aC0xJzogJ3MzLmFwLXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLXNvdXRoLTInOiAnczMuYXAtc291dGgtMi5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtc291dGhlYXN0LTEnOiAnczMuYXAtc291dGhlYXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLXNvdXRoZWFzdC0yJzogJ3MzLmFwLXNvdXRoZWFzdC0yLmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1zb3V0aGVhc3QtMyc6ICdzMy5hcC1zb3V0aGVhc3QtMy5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtc291dGhlYXN0LTQnOiAnczMuYXAtc291dGhlYXN0LTQuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLXNvdXRoZWFzdC01JzogJ3MzLmFwLXNvdXRoZWFzdC01LmFtYXpvbmF3cy5jb20nLFxyXG4gICdhcC1ub3J0aGVhc3QtMSc6ICdzMy5hcC1ub3J0aGVhc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAnYXAtbm9ydGhlYXN0LTInOiAnczMuYXAtbm9ydGhlYXN0LTIuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2FwLW5vcnRoZWFzdC0zJzogJ3MzLmFwLW5vcnRoZWFzdC0zLmFtYXpvbmF3cy5jb20nLFxyXG4gICdjYS1jZW50cmFsLTEnOiAnczMuY2EtY2VudHJhbC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdjYS13ZXN0LTEnOiAnczMuY2Etd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdjbi1ub3J0aC0xJzogJ3MzLmNuLW5vcnRoLTEuYW1hem9uYXdzLmNvbS5jbicsXHJcbiAgJ2V1LWNlbnRyYWwtMSc6ICdzMy5ldS1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LWNlbnRyYWwtMic6ICdzMy5ldS1jZW50cmFsLTIuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LW5vcnRoLTEnOiAnczMuZXUtbm9ydGgtMS5hbWF6b25hd3MuY29tJyxcclxuICAnZXUtc291dGgtMSc6ICdzMy5ldS1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICdldS1zb3V0aC0yJzogJ3MzLmV1LXNvdXRoLTIuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LXdlc3QtMSc6ICdzMy5ldS13ZXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LXdlc3QtMic6ICdzMy5ldS13ZXN0LTIuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2V1LXdlc3QtMyc6ICdzMy5ldS13ZXN0LTMuYW1hem9uYXdzLmNvbScsXHJcbiAgJ2lsLWNlbnRyYWwtMSc6ICdzMy5pbC1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ21lLWNlbnRyYWwtMSc6ICdzMy5tZS1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXHJcbiAgJ21lLXNvdXRoLTEnOiAnczMubWUtc291dGgtMS5hbWF6b25hd3MuY29tJyxcclxuICAnc2EtZWFzdC0xJzogJ3MzLnNhLWVhc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAndXMtZWFzdC0xJzogJ3MzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAndXMtZWFzdC0yJzogJ3MzLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tJyxcclxuICAndXMtd2VzdC0xJzogJ3MzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tJyxcclxuICAndXMtd2VzdC0yJzogJ3MzLnVzLXdlc3QtMi5hbWF6b25hd3MuY29tJyxcclxuICAndXMtZ292LWVhc3QtMSc6ICdzMy51cy1nb3YtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxyXG4gICd1cy1nb3Ytd2VzdC0xJzogJ3MzLnVzLWdvdi13ZXN0LTEuYW1hem9uYXdzLmNvbScsXHJcbiAgLy8gQWRkIG5ldyBlbmRwb2ludHMgaGVyZS5cclxufVxyXG5cclxuZXhwb3J0IHR5cGUgUmVnaW9uID0ga2V5b2YgdHlwZW9mIGF3c1MzRW5kcG9pbnQgfCBzdHJpbmdcclxuXHJcbi8vIGdldFMzRW5kcG9pbnQgZ2V0IHJlbGV2YW50IGVuZHBvaW50IGZvciB0aGUgcmVnaW9uLlxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0UzNFbmRwb2ludChyZWdpb246IFJlZ2lvbik6IHN0cmluZyB7XHJcbiAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XHJcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIHJlZ2lvbjogJHtyZWdpb259YClcclxuICB9XHJcblxyXG4gIGNvbnN0IGVuZHBvaW50ID0gKGF3c1MzRW5kcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbcmVnaW9uXVxyXG4gIGlmIChlbmRwb2ludCkge1xyXG4gICAgcmV0dXJuIGVuZHBvaW50XHJcbiAgfVxyXG4gIHJldHVybiAnczMuYW1hem9uYXdzLmNvbSdcclxufVxyXG4iXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxTQUFTQSxRQUFRLFFBQVEsY0FBYTs7QUFFdEM7QUFDQSxNQUFNQyxhQUFhLEdBQUc7RUFDcEIsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxZQUFZLEVBQUUsZ0NBQWdDO0VBQzlDLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsY0FBYyxFQUFFLCtCQUErQjtFQUMvQyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsZUFBZSxFQUFFLGdDQUFnQztFQUNqRCxlQUFlLEVBQUU7RUFDakI7QUFDRixDQUFDO0FBSUQ7QUFDQSxPQUFPLFNBQVNDLGFBQWFBLENBQUNDLE1BQWMsRUFBVTtFQUNwRCxJQUFJLENBQUNILFFBQVEsQ0FBQ0csTUFBTSxDQUFDLEVBQUU7SUFDckIsTUFBTSxJQUFJQyxTQUFTLENBQUMsbUJBQW1CRCxNQUFNLEVBQUUsQ0FBQztFQUNsRDtFQUVBLE1BQU1FLFFBQVEsR0FBSUosYUFBYSxDQUE0QkUsTUFBTSxDQUFDO0VBQ2xFLElBQUlFLFFBQVEsRUFBRTtJQUNaLE9BQU9BLFFBQVE7RUFDakI7RUFDQSxPQUFPLGtCQUFrQjtBQUMzQiIsImlnbm9yZUxpc3QiOltdfQ==