const winston = require('winston')
const path = require('path')

// 控制台格式（所有日志都输出到控制台）
const consoleFormat = winston.format.printf(({ timestamp, level, message, taskId }) => {
  const prefix = taskId ? `[${taskId}] ` : ''
  return `${timestamp} ${level}: ${prefix}${message}`
})

// 文件格式（带 taskId 标签，方便 grep）
const fileFormat = winston.format.printf(({ timestamp, level, message, taskId }) => {
  return `${timestamp} [${taskId}] ${level}: ${message}`
})

// 应用级日志（启动、路由注册等，不带 taskId）
const appLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    consoleFormat
  ),
  transports: [new winston.transports.Console()]
})

// 任务级日志（同时写控制台 + 文件）
function createTaskLogger(taskId) {
  const logPath = path.join(__dirname, `../storage/output/${taskId}.log`)

  return winston.createLogger({
    level: 'info',
    defaultMeta: { taskId },
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    ),
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({ filename: logPath, format: fileFormat }),
    ]
  })
}

module.exports = { appLogger, createTaskLogger }
