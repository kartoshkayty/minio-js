"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.drainResponse = drainResponse;
exports.readAsBuffer = readAsBuffer;
exports.readAsString = readAsString;
async function readAsBuffer(res) {
  return new Promise((resolve, reject) => {
    const body = [];
    res.on('data', chunk => body.push(chunk)).on('error', e => reject(e)).on('end', () => resolve(Buffer.concat(body)));
  });
}
async function readAsString(res) {
  const body = await readAsBuffer(res);
  return body.toString();
}
async function drainResponse(res) {
  return new Promise((resolve, reject) => {
    res.on('data', () => {}).on('error', e => reject(e)).on('end', () => resolve());
  });
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJyZWFkQXNCdWZmZXIiLCJyZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsImJvZHkiLCJvbiIsImNodW5rIiwicHVzaCIsImUiLCJCdWZmZXIiLCJjb25jYXQiLCJyZWFkQXNTdHJpbmciLCJ0b1N0cmluZyIsImRyYWluUmVzcG9uc2UiXSwic291cmNlcyI6WyJyZXNwb25zZS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSBodHRwIGZyb20gJ25vZGU6aHR0cCdcclxuaW1wb3J0IHR5cGUgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRBc0J1ZmZlcihyZXM6IHN0cmVhbS5SZWFkYWJsZSk6IFByb21pc2U8QnVmZmVyPiB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIGNvbnN0IGJvZHk6IEJ1ZmZlcltdID0gW11cclxuICAgIHJlc1xyXG4gICAgICAub24oJ2RhdGEnLCAoY2h1bms6IEJ1ZmZlcikgPT4gYm9keS5wdXNoKGNodW5rKSlcclxuICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiByZWplY3QoZSkpXHJcbiAgICAgIC5vbignZW5kJywgKCkgPT4gcmVzb2x2ZShCdWZmZXIuY29uY2F0KGJvZHkpKSlcclxuICB9KVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZEFzU3RyaW5nKHJlczogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxyXG4gIHJldHVybiBib2R5LnRvU3RyaW5nKClcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRyYWluUmVzcG9uc2UocmVzOiBzdHJlYW0uUmVhZGFibGUpOiBQcm9taXNlPHZvaWQ+IHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgcmVzXHJcbiAgICAgIC5vbignZGF0YScsICgpID0+IHt9KVxyXG4gICAgICAub24oJ2Vycm9yJywgKGUpID0+IHJlamVjdChlKSlcclxuICAgICAgLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKCkpXHJcbiAgfSlcclxufVxyXG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBR08sZUFBZUEsWUFBWUEsQ0FBQ0MsR0FBb0IsRUFBbUI7RUFDeEUsT0FBTyxJQUFJQyxPQUFPLENBQUMsQ0FBQ0MsT0FBTyxFQUFFQyxNQUFNLEtBQUs7SUFDdEMsTUFBTUMsSUFBYyxHQUFHLEVBQUU7SUFDekJKLEdBQUcsQ0FDQUssRUFBRSxDQUFDLE1BQU0sRUFBR0MsS0FBYSxJQUFLRixJQUFJLENBQUNHLElBQUksQ0FBQ0QsS0FBSyxDQUFDLENBQUMsQ0FDL0NELEVBQUUsQ0FBQyxPQUFPLEVBQUdHLENBQUMsSUFBS0wsTUFBTSxDQUFDSyxDQUFDLENBQUMsQ0FBQyxDQUM3QkgsRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNSCxPQUFPLENBQUNPLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDTixJQUFJLENBQUMsQ0FBQyxDQUFDO0VBQ2xELENBQUMsQ0FBQztBQUNKO0FBRU8sZUFBZU8sWUFBWUEsQ0FBQ1gsR0FBeUIsRUFBbUI7RUFDN0UsTUFBTUksSUFBSSxHQUFHLE1BQU1MLFlBQVksQ0FBQ0MsR0FBRyxDQUFDO0VBQ3BDLE9BQU9JLElBQUksQ0FBQ1EsUUFBUSxDQUFDLENBQUM7QUFDeEI7QUFFTyxlQUFlQyxhQUFhQSxDQUFDYixHQUFvQixFQUFpQjtFQUN2RSxPQUFPLElBQUlDLE9BQU8sQ0FBQyxDQUFDQyxPQUFPLEVBQUVDLE1BQU0sS0FBSztJQUN0Q0gsR0FBRyxDQUNBSyxFQUFFLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FDcEJBLEVBQUUsQ0FBQyxPQUFPLEVBQUdHLENBQUMsSUFBS0wsTUFBTSxDQUFDSyxDQUFDLENBQUMsQ0FBQyxDQUM3QkgsRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNSCxPQUFPLENBQUMsQ0FBQyxDQUFDO0VBQy9CLENBQUMsQ0FBQztBQUNKIiwiaWdub3JlTGlzdCI6W119