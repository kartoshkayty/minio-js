// Returns a wrapper function that will promisify a given callback function.
// It will preserve 'this'.
export function promisify(fn) {
  return function () {
    // If the last argument is a function, assume its the callback.
    let callback = arguments[arguments.length - 1];

    // If the callback is given, don't promisify, just pass straight in.
    if (typeof callback === 'function') {
      return fn.apply(this, arguments);
    }

    // Otherwise, create a new set of arguments, and wrap
    // it in a promise.
    let args = [...arguments];
    return new Promise((resolve, reject) => {
      // Add the callback function.
      args.push((err, value) => {
        if (err) {
          return reject(err);
        }
        resolve(value);
      });

      // Call the function with our special adaptor callback added.
      fn.apply(this, args);
    });
  };
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwcm9taXNpZnkiLCJmbiIsImNhbGxiYWNrIiwiYXJndW1lbnRzIiwibGVuZ3RoIiwiYXBwbHkiLCJhcmdzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJwdXNoIiwiZXJyIiwidmFsdWUiXSwic291cmNlcyI6WyJwcm9taXNpZnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gUmV0dXJucyBhIHdyYXBwZXIgZnVuY3Rpb24gdGhhdCB3aWxsIHByb21pc2lmeSBhIGdpdmVuIGNhbGxiYWNrIGZ1bmN0aW9uLlxyXG4vLyBJdCB3aWxsIHByZXNlcnZlICd0aGlzJy5cclxuZXhwb3J0IGZ1bmN0aW9uIHByb21pc2lmeShmbikge1xyXG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XHJcbiAgICAvLyBJZiB0aGUgbGFzdCBhcmd1bWVudCBpcyBhIGZ1bmN0aW9uLCBhc3N1bWUgaXRzIHRoZSBjYWxsYmFjay5cclxuICAgIGxldCBjYWxsYmFjayA9IGFyZ3VtZW50c1thcmd1bWVudHMubGVuZ3RoIC0gMV1cclxuXHJcbiAgICAvLyBJZiB0aGUgY2FsbGJhY2sgaXMgZ2l2ZW4sIGRvbid0IHByb21pc2lmeSwganVzdCBwYXNzIHN0cmFpZ2h0IGluLlxyXG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKVxyXG4gICAgfVxyXG5cclxuICAgIC8vIE90aGVyd2lzZSwgY3JlYXRlIGEgbmV3IHNldCBvZiBhcmd1bWVudHMsIGFuZCB3cmFwXHJcbiAgICAvLyBpdCBpbiBhIHByb21pc2UuXHJcbiAgICBsZXQgYXJncyA9IFsuLi5hcmd1bWVudHNdXHJcblxyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgLy8gQWRkIHRoZSBjYWxsYmFjayBmdW5jdGlvbi5cclxuICAgICAgYXJncy5wdXNoKChlcnIsIHZhbHVlKSA9PiB7XHJcbiAgICAgICAgaWYgKGVycikge1xyXG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpXHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXNvbHZlKHZhbHVlKVxyXG4gICAgICB9KVxyXG5cclxuICAgICAgLy8gQ2FsbCB0aGUgZnVuY3Rpb24gd2l0aCBvdXIgc3BlY2lhbCBhZGFwdG9yIGNhbGxiYWNrIGFkZGVkLlxyXG4gICAgICBmbi5hcHBseSh0aGlzLCBhcmdzKVxyXG4gICAgfSlcclxuICB9XHJcbn1cclxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0EsT0FBTyxTQUFTQSxTQUFTQSxDQUFDQyxFQUFFLEVBQUU7RUFDNUIsT0FBTyxZQUFZO0lBQ2pCO0lBQ0EsSUFBSUMsUUFBUSxHQUFHQyxTQUFTLENBQUNBLFNBQVMsQ0FBQ0MsTUFBTSxHQUFHLENBQUMsQ0FBQzs7SUFFOUM7SUFDQSxJQUFJLE9BQU9GLFFBQVEsS0FBSyxVQUFVLEVBQUU7TUFDbEMsT0FBT0QsRUFBRSxDQUFDSSxLQUFLLENBQUMsSUFBSSxFQUFFRixTQUFTLENBQUM7SUFDbEM7O0lBRUE7SUFDQTtJQUNBLElBQUlHLElBQUksR0FBRyxDQUFDLEdBQUdILFNBQVMsQ0FBQztJQUV6QixPQUFPLElBQUlJLE9BQU8sQ0FBQyxDQUFDQyxPQUFPLEVBQUVDLE1BQU0sS0FBSztNQUN0QztNQUNBSCxJQUFJLENBQUNJLElBQUksQ0FBQyxDQUFDQyxHQUFHLEVBQUVDLEtBQUssS0FBSztRQUN4QixJQUFJRCxHQUFHLEVBQUU7VUFDUCxPQUFPRixNQUFNLENBQUNFLEdBQUcsQ0FBQztRQUNwQjtRQUVBSCxPQUFPLENBQUNJLEtBQUssQ0FBQztNQUNoQixDQUFDLENBQUM7O01BRUY7TUFDQVgsRUFBRSxDQUFDSSxLQUFLLENBQUMsSUFBSSxFQUFFQyxJQUFJLENBQUM7SUFDdEIsQ0FBQyxDQUFDO0VBQ0osQ0FBQztBQUNIIiwiaWdub3JlTGlzdCI6W119