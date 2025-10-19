#!/usr/bin/env node

/**
 * 自动为 build/index.js 添加 shebang 行
 * 这样用户可以直接通过 `12306-mcp` 命令运行
 */

const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../build/index.js');
const shebang = '#!/usr/bin/env node\n';

try {
  // 读取文件内容
  let content = fs.readFileSync(targetFile, 'utf8');
  
  // 检查是否已经有 shebang
  if (!content.startsWith('#!')) {
    console.log('Adding shebang to build/index.js...');
    content = shebang + content;
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('✅ Shebang added successfully!');
  } else {
    console.log('✅ Shebang already exists in build/index.js');
  }
  
  // 在 Unix 系统上添加执行权限
  if (process.platform !== 'win32') {
    fs.chmodSync(targetFile, '755');
    console.log('✅ Executable permission set');
  }
} catch (error) {
  console.error('❌ Failed to add shebang:', error.message);
  process.exit(1);
}