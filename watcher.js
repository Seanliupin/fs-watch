const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const diff = require('diff');

const watchDir = "/Users/seanliu/workspace/projects/money-log/money-wx/pages"; // 替换为你的监控目录

// 添加文件哈希存储对象
const fileHashes = new Map();

fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  console.log(`${filename} [${eventType}]`);

  const filePath = path.join(watchDir, filename);

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

function handleFileCreate(filename, content) {
  console.log(`新文件创建: ${filename}`);
}

function handleFileDelete(filePath) {
  console.log(`文件被删除: ${filePath}`);
}

function handleFileChange(filename, content) {
  // 计算文件内容的 SHA-256 哈希值
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  // 获取旧的哈希值（如果存在）
  const fileData = fileHashes.get(filename) || { hash: "", content: "" };

  // 如果哈希值相同，说明内容没有实质变化，可以跳过处理
  if (fileData.hash === hash) {
    console.log(`文件 ${filename} 内容未发生实质变化`);
    return;
  }

  // 存储新的哈希值和内容
  fileHashes.set(filename, {
    hash,
    content,
  });

  console.log(`${filename} 的新哈希值: ${hash}`);

  try {
    // 这里可以添加具体的文件处理逻辑
    console.log(`Processing ${filename}...`);
    console.log(`File content length: ${content.length} bytes`);
  } catch (error) {
    console.error(`Error processing file ${filename}:`, error);
  }
}

function diffContent(oldContent, newContent) {
  // 创建行级别的差异
  const changes = diff.createPatch('file',
    oldContent,
    newContent,
    'old',
    'new'
  );
  return changes;
}

function applyDiff(oldContent, changes) {
  return diff.applyPatch(oldContent, changes);
}

// 使用示例：
/**/
const oldContent = `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10`;

const newContent = `line1
line2
line3
modified line4
line5
line6
line7
line8
modified line9
line10`;

const changes = diffContent(oldContent, newContent);
console.log(changes);


const reconstructed = applyDiff(oldContent, changes);
console.log(reconstructed === newContent); // true
