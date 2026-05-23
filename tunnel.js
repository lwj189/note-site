const localtunnel = require('localtunnel');

(async () => {
  console.log('正在创建隧道...');
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('\n========================================');
    console.log('  公网访问地址：' + tunnel.url);
    console.log('  上传管理页面：' + tunnel.url + '/upload-changeme123');
    console.log('========================================\n');
    console.log('按 Ctrl+C 停止\n');

    tunnel.on('close', () => {
      console.log('隧道已关闭');
      process.exit();
    });

    // Keep alive
    setInterval(() => {}, 10000);
  } catch (err) {
    console.error('隧道创建失败:', err.message);
    console.log('\n备选方案：试试 bore 隧道');
    console.log('  npx bore -l 3000 -t bore.pub\n');
    process.exit(1);
  }
})();
