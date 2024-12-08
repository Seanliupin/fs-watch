#!/usr/bin/env node

const fs = require("fs");
const pathLib = require("path");
const crypto = require("crypto");
const diff = require("diff");
const http = require("http");
const minimist = require("minimist");

const argv = minimist(process.argv.slice(2), {
  string: ["d", "dir", "p", "port", "t", "target"],
  alias: {
    d: "dir",
    p: "port",
    t: "target",
  },
  default: {
    dir: ".",
    port: "3033",
    target: "http://localhost:3033",
  },
});

function sha256(content) {
  // 计算文件内容的 SHA-256 哈希值
  return crypto.createHash("sha256").update(content).digest("hex");
}

function diffContent(oldContent, newContent) {
  // 创建行级别的差异
  const changes = diff.createPatch(
    "file",
    oldContent,
    newContent,
    "old",
    "new"
  );
  return changes;
}

function applyDiff(oldContent, changes) {
  return diff.applyPatch(oldContent, changes);
}

function clientMode(targetUrl, dir = argv.dir) {
  // 添加文件哈希存储对象
  const fileHashes = new Map();

  const post = async (path, type, hash = "", diff = "", content = "") => {
    const payload = {
      path,
      type,
    };

    if (hash) payload.hash = hash;
    if (diff) payload.diff = diff;
    if (content) payload.content = content;

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return await response.json();
  };

  const handleFileCreate = (filename, content) => {
    const hash = sha256(content);
    const res = post(filename, "new", hash, "", content);
    if (res.status === "done") {
      fileHashes.set(filename, {
        hash,
        content,
      });
      console.log(`创建: ${filename} ${hash}`);
    } else {
      console.error(`创建失败: ${filename} ${res.message}`);
    }
  };

  const handleFileDelete = (filePath) => {
    const res = post(filePath, "delete");
    if (res.status === "done") {
      fileHashes.delete(filePath);
      console.log(`删除: ${filePath}`);
    } else {
      console.error(`删除失败: ${filePath} ${res.message}`);
    }
  };

  const handleFileChange = async (filename, content) => {
    const hash = sha256(content);
    const fileData = fileHashes.get(filename) || { hash: "", content: "" };

    if (!fileData.hash) {
      const res = await post(filename, "change", hash, "", content);
      if (res.status === "done") {
        fileHashes.set(filename, {
          hash,
          content,
        });
        console.log(`首次推送全文: ${filename}`);
      } else {
        console.error(`首次推送全文失败: ${filename} ${res.message}`);
      }
      return;
    }

    const diff = diffContent(fileData.content, content);
    const res = await post(filename, "change", fileData.hash, diff);
    const status = res.status;
    if (status === "done") {
      fileHashes.set(filename, {
        hash,
        content,
      });
      console.log(`推送差异: ${filename} ${fileData.hash}`);
    } else if (status === "needFull") {
      const res = await post(filename, "change", "", "", content);
      if (res.status === "done") {
        fileHashes.set(filename, {
          hash,
          content,
        });
        console.log(`推送全文: ${filename}`);
      } else {
        console.error(`推送全文失败: ${filename} ${res.message}`);
      }
    } else {
      console.error(`推送差异失败: ${filename} ${res.message}`);
    }
  };

  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    console.log(`${filename} [${eventType}]`);

    const filePath = pathLib.join(dir, filename);

    const readContent = () => {
      return new Promise((resolve, reject) => {
        fs.readFile(filePath, "utf8", (err, content) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(content);
        });
      });
    };

    switch (eventType) {
      case "rename":
        fs.access(filePath, fs.constants.F_OK, (err) => {
          if (err) {
            handleFileDelete(filename);
          } else {
            readContent().then((content) => {
              handleFileCreate(filename, content);
            });
          }
        });
        break;

      case "change":
        readContent().then((content) => {
          handleFileChange(filename, content);
        });
        break;
    }
  });
}

function serverMode(port = argv.port, dir = argv.dir) {
  const ok = (res, status, message) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status, message }));
  };

  const error = (res, message) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message }));
  };

  const writeFile = (filePath, content) => {
    return fs.promises.writeFile(filePath, content, "utf8");
  };

  const createFile = async (filePath, content) => {
    await fs.promises.mkdir(pathLib.dirname(filePath), { recursive: true });
    return fs.promises.writeFile(filePath, content, "utf8");
  };

  const deleteFile = (filePath) => {
    return fs.promises.unlink(filePath);
  };

  const getBody = (req) => {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const data = JSON.parse(body);
        resolve(data);
      });
    });
  };

  // 创建 HTTP 服务器
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      error(res, "仅支持 POST 请求");
      return;
    }

    getBody(req).then(async (data) => {
      const filePath = pathLib.join(dir, data.path);
      // 根据不同的类型处理
      switch (data.type) {
        case "change":
          let fileContent;
          try {
            fileContent = await fs.promises.readFile(filePath, "utf8");
          } catch (err) {
            await createFile(filePath, data.content);
            console.log(`创建: ${data.path}`);
            ok(res, "needFull", "");
            return;
          }

          const currentHash = sha256(fileContent);
          if (data.content) {
            await writeFile(filePath, data.content);
            console.log(`更新全文：${data.path}`);
          } else {
            if (currentHash !== data.hash) {
              console.log(`hash不一致: ${currentHash} !== ${data.hash}`);
              ok(res, "needFull", "");
              return;
            }
            await writeFile(filePath, applyDiff(fileContent, data.diff));
            console.log(`更新补丁：${data.path} ${data.hash}`);
          }
          ok(res, "done", "更新已接收");
          return;
        case "new":
          await createFile(filePath, data.content);
          console.log(`创建: ${data.path}`);
          break;
        case "delete":
          try {
            await deleteFile(filePath);
            console.log(`删除: ${data.path}`);
            ok(res, "done", "文件已删除");
            return;
          } catch (err) {
            console.error(`删除失败: ${err.message}`);
            ok(res, "error", "文件删除失败");
            return;
          }
        default:
          error(res, "不支持的操作类型");
          return;
      }
      ok(res, "done", "更新已接收");
    });
  });

  // 启动服务器
  server.listen(port, () => {
    console.log(`服务器已启动，监听端口 ${port}`);
  });
}

// 直接执行启动逻辑
const mode = argv._[0]; // 第一个无标志的参数作为模式
if (mode === "server") {
  console.log(`服务器模式，监听端口: ${argv.port} 目录: ${argv.dir}`);
  serverMode();
} else if (mode === "client") {
  console.log(`客户端模式，目标 URL: ${argv.target} 目录: ${argv.dir}`);
  clientMode(argv.target);
} else {
  console.log(`
使用方法:
  服务器模式: node watcher.js server [-p 端口] [-d 目录]
  客户端模式: node watcher.js client <目标URL> [-d 目录]
    
选项:
  -p, --port   指定服务器端口 (默认: 3033)
  -d, --dir    指定监控目录 (默认: 当前目录)
  `);
  process.exit(1);
}
