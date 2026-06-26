require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const subtitleRoutes = require('./routes/route.js')

const app = express()
const PORT = process.env.PORT || 3000

// 中间件
app.use(cors())
app.use(express.json())

// 确保目录存在
const dirs = ['storage/input', 'storage/temp', 'storage/output', 'storage/logs']
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
})

// 路由
app.use('/api', subtitleRoutes)

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] 错误:`, err.message)
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 服务器启动: http://localhost:${PORT}`)
  console.log(`[${new Date().toISOString()}] 健康检查: http://localhost:${PORT}/health`)
})
