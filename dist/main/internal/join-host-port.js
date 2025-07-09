"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.joinHostPort = joinHostPort;
/**
 * joinHostPort combines host and port into a network address of the
 * form "host:port". If host contains a colon, as found in literal
 * IPv6 addresses, then JoinHostPort returns "[host]:port".
 *
 * @param host
 * @param port
 * @returns Cleaned up host
 * @internal
 */
function joinHostPort(host, port) {
  if (port === undefined) {
    return host;
  }

  // We assume that host is a literal IPv6 address if host has
  // colons.
  if (host.includes(':')) {
    return `[${host}]:${port.toString()}`;
  }
  return `${host}:${port.toString()}`;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJqb2luSG9zdFBvcnQiLCJob3N0IiwicG9ydCIsInVuZGVmaW5lZCIsImluY2x1ZGVzIiwidG9TdHJpbmciXSwic291cmNlcyI6WyJqb2luLWhvc3QtcG9ydC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogam9pbkhvc3RQb3J0IGNvbWJpbmVzIGhvc3QgYW5kIHBvcnQgaW50byBhIG5ldHdvcmsgYWRkcmVzcyBvZiB0aGVcclxuICogZm9ybSBcImhvc3Q6cG9ydFwiLiBJZiBob3N0IGNvbnRhaW5zIGEgY29sb24sIGFzIGZvdW5kIGluIGxpdGVyYWxcclxuICogSVB2NiBhZGRyZXNzZXMsIHRoZW4gSm9pbkhvc3RQb3J0IHJldHVybnMgXCJbaG9zdF06cG9ydFwiLlxyXG4gKlxyXG4gKiBAcGFyYW0gaG9zdFxyXG4gKiBAcGFyYW0gcG9ydFxyXG4gKiBAcmV0dXJucyBDbGVhbmVkIHVwIGhvc3RcclxuICogQGludGVybmFsXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gam9pbkhvc3RQb3J0KGhvc3Q6IHN0cmluZywgcG9ydD86IG51bWJlcik6IHN0cmluZyB7XHJcbiAgaWYgKHBvcnQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgcmV0dXJuIGhvc3RcclxuICB9XHJcblxyXG4gIC8vIFdlIGFzc3VtZSB0aGF0IGhvc3QgaXMgYSBsaXRlcmFsIElQdjYgYWRkcmVzcyBpZiBob3N0IGhhc1xyXG4gIC8vIGNvbG9ucy5cclxuICBpZiAoaG9zdC5pbmNsdWRlcygnOicpKSB7XHJcbiAgICByZXR1cm4gYFske2hvc3R9XToke3BvcnQudG9TdHJpbmcoKX1gXHJcbiAgfVxyXG5cclxuICByZXR1cm4gYCR7aG9zdH06JHtwb3J0LnRvU3RyaW5nKCl9YFxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDTyxTQUFTQSxZQUFZQSxDQUFDQyxJQUFZLEVBQUVDLElBQWEsRUFBVTtFQUNoRSxJQUFJQSxJQUFJLEtBQUtDLFNBQVMsRUFBRTtJQUN0QixPQUFPRixJQUFJO0VBQ2I7O0VBRUE7RUFDQTtFQUNBLElBQUlBLElBQUksQ0FBQ0csUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0lBQ3RCLE9BQU8sSUFBSUgsSUFBSSxLQUFLQyxJQUFJLENBQUNHLFFBQVEsQ0FBQyxDQUFDLEVBQUU7RUFDdkM7RUFFQSxPQUFPLEdBQUdKLElBQUksSUFBSUMsSUFBSSxDQUFDRyxRQUFRLENBQUMsQ0FBQyxFQUFFO0FBQ3JDIiwiaWdub3JlTGlzdCI6W119