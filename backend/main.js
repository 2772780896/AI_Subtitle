/**
 * CLI 入口：一键完成从识别到渲染的全流程
 *
 * 用法：node main.js <视频路径>
 * 示例：node main.js input.mp4
 *       node main.js ./videos/my-video.mp4
 */

const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

// 确保环境变量加载（.env 在项目根目录）
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

// 确保目录存在
const dirs = ['storage/input', 'storage/temp', 'storage/output', 'storage/logs']
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
})

const { tasks } = require('./services/store')
const { processVideo } = require('./services/processVideo')

async function main() {
  // 1. 获取命令行参数
  const inputPath = process.argv[2]

  if (!inputPath) {
    console.log(`
用法：node main.js <视频路径>

示例：
  node main.js input.mp4
  node main.js ./videos/my-video.mp4
`)
    process.exit(1)
  }

  // 2. 检查文件是否存在
  const absInputPath = path.resolve(inputPath)
  if (!fs.existsSync(absInputPath)) {
    console.error(`错误：文件不存在 - ${absInputPath}`)
    process.exit(1)
  }

  // 3. 检查是否是 MP4
  const ext = path.extname(absInputPath).toLowerCase()
  if (ext !== '.mp4') {
    console.error(`错误：仅支持 MP4 格式，当前为 ${ext}`)
    process.exit(1)
  }

  console.log(`\n========================================`)
  console.log(`AI 字幕生成系统 - CLI 模式`)
  console.log(`========================================`)
  console.log(`输入文件：${absInputPath}`)

  // 4. 复制文件到 storage/input
  const taskId = uuidv4().split('-')[0]
  const videoName = `${taskId}.mp4`
  const storagePath = path.join(__dirname, `storage/input/${videoName}`)

  fs.copyFileSync(absInputPath, storagePath)
  console.log(`任务 ID：${taskId}`)
  console.log(``)

  // 5. 创建任务（和 route.js 一样）
  const task = {
    taskId,
    status: 'uploading',
    progress: 0,
    errorMsg: '',
    videoUrl: null,
    srtUrl: null,
    rawUrl: null,
    _videoPath: storagePath,
    _videoName: videoName,
    _style: {
      fontName: 'Microsoft YaHei',
      fontSize: 24,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outline: 2,
      alignment: 2,
      marginV: 10,
    },
    _asrConfig: {
      engineType: '16k_zh',
      resTextFormat: 3,
    },
  }
  tasks.set(taskId, task)

  // 6. 执行处理（等待完成）
  console.log(`开始处理...\n`)

  try {
    await processVideo(taskId)

    // 7. 检查最终状态
    const finalTask = tasks.get(taskId)
    if (finalTask.status === 'done') {
      console.log(`\n========================================`)
      console.log(`处理完成！`)
      console.log(`========================================`)
      const outDir = path.join(__dirname, 'storage/output')
      const logDir = path.join(__dirname, 'storage/logs')
      console.log(`输出文件：`)
      console.log(`  带字幕视频：${path.join(outDir, videoName)}`)
      console.log(`  字幕文件：  ${path.join(outDir, `${taskId}.srt`)}`)
      console.log(`  原始识别：  ${path.join(outDir, `${taskId}.raw.txt`)}`)
      console.log(`  处理日志：  ${path.join(logDir, `${taskId}.log`)}`)
      console.log(``)
    } else {
      console.error(`\n处理失败：${finalTask.errorMsg}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`\n执行出错：${err.message}`)
    process.exit(1)
  }
}

main()
