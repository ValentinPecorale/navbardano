const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 5500;

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]); // strip query string first
    const filePath = path.join(root, urlPath);

    // Matches Vercel's static hosting: "/" and any directory (or
    // extensionless) path without its own file falls back to that path's
    // own index.html -- e.g. /albums/ehhpdsr -> /albums/ehhpdsr/index.html.
    if (urlPath === "/" || path.extname(filePath) === "") {
      fs.stat(filePath, (statErr, stat) => {
        if (!statErr && stat.isFile()) {
          sendFile(res, filePath);
          return;
        }
        sendFile(res, path.join(filePath, "index.html"));
      });
      return;
    }

    sendFile(res, filePath);
  })
  .listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
