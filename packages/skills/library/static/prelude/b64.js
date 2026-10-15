// kit.b64.encode(text, { url }) and kit.b64.decode(text): base64 of UTF-8 text, which QuickJS has no
// btoa or atob for; url: true uses the URL-safe alphabet without padding (as Gmail's raw messages do).
kit.b64 = (function () {
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function utf8(text) {
    const bytes = [];
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return bytes;
  }
  function encode(text, options) {
    const b = utf8(text);
    let out = "";
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63] + (i + 1 < b.length ? ABC[(n >> 6) & 63] : "=") + (i + 2 < b.length ? ABC[n & 63] : "=");
    }
    return options && options.url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
  }
  function decode(text) {
    const clean = String(text).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    for (let i = 0; i < clean.length; i += 4) {
      const n = (ABC.indexOf(clean[i]) << 18) | (ABC.indexOf(clean[i + 1]) << 12) | ((ABC.indexOf(clean[i + 2]) & 63) << 6) | (ABC.indexOf(clean[i + 3]) & 63);
      bytes.push((n >> 16) & 255);
      if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
      if (i + 3 < clean.length) bytes.push(n & 255);
    }
    let out = "";
    for (let i = 0; i < bytes.length; ) {
      const c = bytes[i++];
      if (c < 0x80) out += String.fromCodePoint(c);
      else if (c < 0xe0) out += String.fromCodePoint(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c < 0xf0) out += String.fromCodePoint(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else out += String.fromCodePoint(((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    }
    return out;
  }
  return { encode, decode };
})();
