// store.js - 全局任务状态存储
// 独立文件，避免 route.js 和 processVideo.js 之间的循环依赖
const tasks = new Map()
module.exports = { tasks }
