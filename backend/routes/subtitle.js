const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()

// multer 配置（上传文件存储）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../storage/input'))
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${uuidv4()}${ext}`)
  }
})

const upload = multer({ storage })

// 任务状态存储（内存，后续可换数据库）
const tasks = new Map()

// ============================================================
// POST /api/upload - 上传视频 + 样式配置
// ============================================================
router.post('/upload', upload.single('video'), (req, res) => {
  try {
    // 文件校验
    if (!req.file) {
      return res.status(400).json({ error: '请选择视频文件' })
    }

    const ext = path.extname(req.file.originalname).toLowerCase()
    if (ext !== '.mp4') {
      // 删除非 MP4 文件
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ error: '仅支持 MP4 格式视频' })
    }

    // 解析样式配置
    let style = {}
    if (req.body.style) {
      try {
        style = JSON.parse(req.body.style)
      } catch (e) {
        return res.status(400).json({ error: 'style 参数格式错误' })
      }
    }

    // 解析 ASR 配置（可选）
    let asrConfig = { engineType: '16k_zh', resTextFormat: 3 }
    if (req.body.asrConfig) {
      try {
        asrConfig = { ...asrConfig, ...JSON.parse(req.body.asrConfig) }
      } catch (e) {
        // 使用默认值
      }
    }

    // 创建任务
    const taskId = uuidv4().split('-')[0]
    const task = {
      taskId,
      status: 'uploading',
      progress: 0,
      errorMsg: '',
      videoUrl: null,
      srtUrl: null,
      rawUrl: null,
      // 内部数据
      _videoPath: req.file.path,
      _videoName: req.file.filename,
      _style: style,
      _asrConfig: asrConfig
    }
    tasks.set(taskId, task)

    console.log(`[${new Date().toISOString()}] 收到上传请求: ${req.file.originalname}`)
    console.log(`[${new Date().toISOString()}] 任务创建: ${taskId}`)

    // TODO: 启动后台处理流程
    // processVideo(taskId)

    // Mock: 模拟状态流转
    mockProcess(taskId)

    res.json({ taskId, status: 'uploading' })
  } catch (err) {
    console.error(`[${new Date().toISOString()}] 上传错误:`, err.message)
    res.status(500).json({ error: '上传失败' })
  }
})

// ============================================================
// GET /api/status/:taskId - 查询任务状态
// ============================================================
router.get('/status/:taskId', (req, res) => {
  const { taskId } = req.params
  const task = tasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任务不存在' })
  }

  res.json({
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    errorMsg: task.errorMsg,
    videoUrl: task.videoUrl,
    srtUrl: task.srtUrl,
    rawUrl: task.rawUrl
  })
})

// ============================================================
// GET /api/download/:taskId/video - 下载带字幕视频
// ============================================================
router.get('/download/:taskId/video', (req, res) => {
  const { taskId } = req.params
  const task = tasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任务不存在' })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ error: '任务未完成' })
  }

  const filePath = path.join(__dirname, '../storage/output', `${task._videoName}`)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '视频文件不存在' })
  }

  res.download(filePath)
})

// ============================================================
// GET /api/download/:taskId/srt - 下载字幕文件
// ============================================================
router.get('/download/:taskId/srt', (req, res) => {
  const { taskId } = req.params
  const task = tasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任务不存在' })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ error: '任务未完成' })
  }

  const srtName = task._videoName.replace('.mp4', '.srt')
  const filePath = path.join(__dirname, '../storage/output', srtName)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '字幕文件不存在' })
  }

  res.download(filePath)
})

// ============================================================
// GET /api/download/:taskId/raw - 下载原始识别结果（清洗前）
// ============================================================
router.get('/download/:taskId/raw', (req, res) => {
  const { taskId } = req.params
  const task = tasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任务不存在' })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ error: '任务未完成' })
  }

  const rawName = task._videoName.replace('.mp4', '.raw.txt')
  const filePath = path.join(__dirname, '../storage/output', rawName)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '原始识别文件不存在' })
  }

  res.download(filePath)
})

// ============================================================
// Mock: 模拟状态流转（后续替换为真实处理逻辑）
// ============================================================
function mockProcess(taskId) {
  const task = tasks.get(taskId)
  if (!task) return

  const steps = [
    { status: 'uploading', progress: 10, delay: 500 },
    { status: 'extracting', progress: 30, delay: 1000 },
    { status: 'recognizing', progress: 50, delay: 2000 },
    { status: 'cleaning', progress: 70, delay: 1000 },
    { status: 'generating', progress: 85, delay: 1000 },
    { status: 'rendering', progress: 95, delay: 1500 },
    { status: 'done', progress: 100, delay: 500 }
  ]

  let totalDelay = 0
  steps.forEach(step => {
    totalDelay += step.delay
    setTimeout(() => {
      if (tasks.has(taskId)) {
        const t = tasks.get(taskId)
        t.status = step.status
        t.progress = step.progress
        if (step.status === 'done') {
          t.videoUrl = `/api/download/${taskId}/video`
          t.srtUrl = `/api/download/${taskId}/srt`
          t.rawUrl = `/api/download/${taskId}/raw`
        }
        console.log(`[${new Date().toISOString()}] 任务 ${taskId}: ${step.status} (${step.progress}%)`)
      }
    }, totalDelay)
  })
}

module.exports = router
