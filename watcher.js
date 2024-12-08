const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const diff = require("diff");
const http = require("http");
const minimist = require("minimist");

const argv = minimist(process.argv.slice(2), {
  string: ["d", "dir", "p", "port"],
  alias: {
    d: "dir",
    p: "port",
  },
  default: {
    dir: ".",
    port: "3033",
  },
});

const watchDir = "/Users/seanliu/workspace/projects/money-log/money-wx/pages"; // 替换为你的监控目录

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
    console.log(`新文件创建: ${filename}`);
    const hash = sha256(content);
    const res = post(filename, "new", hash, "", content);
    if (res.status === "done") {
      fileHashes.set(filename, {
        hash,
        content,
      });
    }
  };

  const handleFileDelete = (filePath) => {
    console.log(`文件被删除: ${filePath}`);
    const res = post(filePath, "delete");
    if (res.status === "done") {
      fileHashes.delete(filePath);
    }
  };

  const handleFileChange = (filename, content) => {
    const hash = sha256(content);
    const fileData = fileHashes.get(filename) || { hash: "", content: "" };
    if (fileData.hash === hash) {
      console.log(`文件 ${filename} 内容未发生实质变化`);
      return;
    }

    const diff = diffContent(fileData.content, content);
    const res = post(filename, "change", hash, diff);
    const status = res.status;
    if (status === "done") {
      fileHashes.set(filename, {
        hash,
        content,
      });
    } else if (status === "needFull") {
      const res = post(filename, "change", hash, diff, content);
      if (res.status === "done") {
        fileHashes.set(filename, {
          hash,
          content,
        });
      }
    }
  };

  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    console.log(`${filename} [${eventType}]`);

    const filePath = path.join(dir, filename);

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
            handleFileDelete(filePath);
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

  const writeFile = (path, content) => {
    return fs.promises.writeFile(path, content, "utf8");
  };

  const createFile = async (path, content) => {
    await fs.promises.mkdir(dirname(path), { recursive: true });
    return fs.promises.writeFile(path, content, "utf8");
  };

  const deleteFile = (path) => {
    return fs.promises.unlink(path);
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
      const filePath = path.join(dir, data.path);
      let fileContent;
      try {
        fileContent = await fs.promises.readFile(filePath, "utf8");
      } catch (err) {
        throw new Error(`无法读取文件: ${err.message}`);
      }

      let newContent;
      const currentHash = sha256(fileContent);

      // 根据不同的类型处理
      switch (data.type) {
        case "change":
          if (currentHash !== data.hash) {
            console.log(`需要完整的内容：${filePath}`);
            ok(res, "needFull", "");
            return;
          }

          if (data.content) {
            newContent = data.content;
          } else {
            newContent = applyDiff(fileContent, data.diff);
          }
          await writeFile(filePath, newContent);
          console.log(`补丁已更新：${data.path} ${data.diff}`);
          ok(res, "done", "更新已接收");
          return;
        case "new":
          console.log(`收到完整内容更新：${data.path}`);
          // 直接使用新内容
          newContent = data.content;
          await writeFile(filePath, newContent);
          break;
        case "delete":
          console.log(`收到删除请求：${data.path}`);
          try {
            await fs.promises.unlink(filePath);
          } catch (err) {
            console.error(`删除文件失败: ${err.message}`);
          }
          break;

        default:
          error(res, "不支持的操作类型");
          return;
      }
      ok(res, "done", "更新已接收");
    });
  });

  // 启动服务器
  server.listen(port, () => {
    console.log("服务器已启动，监听端口 3033");
  });
}

// 直接执行启动逻辑
const mode = argv._[0]; // 第一个无标志的参数作为模式
if (mode === "server") {
  serverMode();
} else if (mode === "client") {
  if (!argv._[1]) {
    console.error("客户端模式需要指定目标URL");
    process.exit(1);
  }
  clientMode(argv._[1]);
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
