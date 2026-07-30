// 檔名：prisma.config.js
export default {
  datasource: {
    url: process.env.DATABASE_URL || 'file:./dev.db' // 把連線字串移到這裡
  }
}
