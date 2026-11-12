// 端到端测试用：本地静态服务（只监听 127.0.0.1）和 Chrome / Edge。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {playwright} from '../../plugin/tools/lib/vendor.mjs';

const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.xml': 'application/octet-stream', '.css': 'text/css'};

// routes：网址前缀 → 本地目录或文件。
export async function serve(routes) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const [prefix, target] of Object.entries(routes)) {
      if (url !== prefix && !url.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) continue;
      const file = fs.statSync(target, {throwIfNoEntry: false})?.isDirectory() ? path.join(target, url.slice(prefix.length)) : target;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream'});
        res.end(fs.readFileSync(file));
        return;
      }
    }
    res.writeHead(404).end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })};
}

// 先试 Chrome，再试 Edge；都没有时返回 null（测试标「跳过」）。
export async function launchBrowser() {
  const {chromium} = playwright();
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({channel, headless: true});
    } catch {
      // 换下一个
    }
  }
  return null;
}
