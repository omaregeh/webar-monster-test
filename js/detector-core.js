// Wraps js-aruco2 with a tiny dictionary containing ONLY our printed markers.
// Plain script (no import/export) so the SAME file runs in:
//   - the browser's detection Web Worker (js/detect-worker.js, via importScripts)
//   - Node, for verification (tools/verify_markers.mjs, via require)
(function (root) {
  function createDetector(AR, markers) {
    // js-aruco2 accepts hex strings; our bits are 16-char binary, 1 = white.
    AR.DICTIONARIES.WEBAR_MONSTER = {
      nBits: 16,
      codeList: markers.map(function (m) { return parseInt(m.bits, 2).toString(16); }),
    };
    // Accept at most 1 wrong bit (js-aruco2 accepts distance < maxHammingDistance).
    // Our IDs differ by >= 8 bits, so 1 bit of noise can never swap one for another.
    var detector = new AR.Detector({ dictionaryName: 'WEBAR_MONSTER', maxHammingDistance: 2 });
    return {
      // imageData: {width, height, data: RGBA bytes}. Returns [{id, name, sizeMm, corners, hamming}]
      detect: function (imageData) {
        return detector.detect(imageData).map(function (m) {
          var info = markers[m.id];
          return { id: info.id, name: info.name, sizeMm: info.sizeMm, corners: m.corners, hamming: m.hammingDistance };
        });
      },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createDetector: createDetector };
  else root.createDetector = createDetector;
})(this);
