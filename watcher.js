const fs = require("fs");
const path = require("path");

const watchDir = "/Users/seanliu/workspace/projects/money-log/money-wx/pages"; // 替换为你的监控目录

fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
  if (!filename) return; // 忽略无法获取文件名的事件

  const filePath = path.join(watchDir, filename);
  console.log(`File changed: ${filePath} (${eventType})`);
});
