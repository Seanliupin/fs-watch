const fs = require("fs");
const path = require("path");

const watchDir = "/Users/seanliu/workspace/projects/money-log/money-wx/pages"; // 替换为你的监控目录

fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  console.log(`File changed: ${filename} (${eventType})`);

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
      console.log(`文件内容修改: ${filePath}`);
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
  console.log(`${filename} => ${content}`);

  try {
    // 这里可以添加具体的文件处理逻辑
    console.log(`Processing ${filename}...`);
    console.log(`File content length: ${content.length} bytes`);
  } catch (error) {
    console.error(`Error processing file ${filename}:`, error);
  }
}
