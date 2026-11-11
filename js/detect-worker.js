// Runs marker detection off the main thread so the 3D animation stays smooth.
importScripts('../vendor/js-aruco2/cv.js', '../vendor/js-aruco2/aruco.js', 'detector-core.js');

var detector = null;
self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type === 'init') {
    detector = self.createDetector(self.AR, msg.markers);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'frame') {
    var t0 = performance.now();
    var image = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buffer) };
    var markers = [];
    try { markers = detector.detect(image); } catch (err) { /* ignore a bad frame */ }
    // Hand the pixel buffer back so the main thread can reuse it (no garbage).
    self.postMessage({ type: 'result', markers: markers, ms: performance.now() - t0,
      frameTime: msg.frameTime, buffer: msg.buffer }, [msg.buffer]);
  }
};
