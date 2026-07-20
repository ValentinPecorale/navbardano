const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 5500;

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    let filePath = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    if (req.url === "/") filePath = path.join(root, "index.html");

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
