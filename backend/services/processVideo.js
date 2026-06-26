const fs = require('fs')
const path = require('path')
const { createTaskLogger } = require('./logger')
const { extractAudio, burnSubtitle } = require('./ffmpegService')
const { sendRequest } = require('./asrService')
const { cleanAndGenerate } = require('./srtGenerator')

// tasks Map 从独立的 store.js 导入（避免与 route.js 循环依赖）
const { tasks } = require('./store')

/**
 * processVideo.js - 主编排器
 *
 * 职责：接收 taskId，按顺序调用所有 service 完成视频处理。
 * route.js 故意不 await 本函数，立即返回响应，不阻塞 HTTP 请求。
 *
 * 调用链：
 *   route.js → processVideo(taskId) → 立即返回
 *                          ↓（异步执行）
 *   extractAudio → ASR 识别 → 轮询结果 → 清洗生成 SRT → 烧录字幕 → 完成
 */

/**
 * 更新任务状态（同时写 Map + 日志）
 * @param {string} taskId - 任务 ID
 * @param {object} updates - 要更新的字段，如 { status: 'extracting', progress: 30 }
 * @param {object} log - Winston logger
 *
 * 为什么单独抽一个函数：
 * 每个步骤都要更新状态，重复写 tasks.get(taskId) + Object.assign 很啰嗦，
 * 抽出来后一行搞定，还自带日志输出。
 */
function updateTask(taskId, updates, log) {
  const task = tasks.get(taskId)
  if (task) {
    // Object.assign 直接修改原对象，Map 里的引用不变但内容变了
    // 也可以用展开运算符：const updated = { ...task, ...updates }; tasks.set(taskId, updated)
    // 但那样更啰嗦，不如 Object.assign 直接
    Object.assign(task, updates)
  }
  // 有 status 变化时记一条日志
  if (updates.status) {
    log.info(`状态变更: ${updates.status} (${updates.progress || 0}%)`)
  }
}

/**
 * 主处理函数（异步，不阻塞调用方）
 *
 * @param {string} taskId - 任务 ID（route.js 创建任务后传入）
 *
 * 错误处理策略：
 * 整个函数包一个 try/catch，任意步骤失败 → 更新状态为 failed → 记录错误日志。
 * 不需要每步单独 catch，因为任何一步失败都应该停止后续步骤。
 */
async function processVideo(taskId) {
  const task = tasks.get(taskId)
  if (!task) return

  const log = createTaskLogger(taskId)
  log.info(`任务开始处理: ${task._videoName}`)

  // 文件路径准备
  const baseName = task._videoName.replace('.mp4', '')  // 去掉扩展名，用作各输出文件的基础名
  const videoPath = task._videoPath                      // 上传的视频：storage/input/xxx.mp4
  const wavPath = path.join(__dirname, `../storage/temp/${baseName}.wav`)  // 临时音频

  try {
    // ========== 第 1 步：提取音频 ==========
    updateTask(taskId, { status: 'extracting', progress: 15 }, log)
    await extractAudio(videoPath, wavPath, log)

    // ========== 第 2 步：调用 ASR 创建识别任务 ==========
    updateTask(taskId, { status: 'recognizing', progress: 30 }, log)

    // 读取音频文件并转 base64（腾讯云 ASR 要求 base64 编码传输音频）
    const audioData = (await fs.promises.readFile(wavPath)).toString('base64')

    // CreateRecTask 参数说明：
    // EngineModelType: 识别引擎（用户在前端选的，如 16k_zh = 中文普通话）
    // ChannelNum: 声道数（1 = 单声道，提取音频时已转成单声道）
    // ResTextFormat: 返回格式（0=纯文本 1=+词时间戳 2=+标点 3=按标点分段）
    // SourceType: 音频来源（1 = 本地音频 base64 编码）
    // Data: 音频数据的 base64 字符串
    // DataLen: 音频数据长度（字节数，原始 WAV 大小，不是 base64 后的长度）
    const asrConfig = task._asrConfig
    const createPayload = {
      EngineModelType: asrConfig.engineType || '16k_zh',
      ChannelNum: 1,
      ResTextFormat: asrConfig.resTextFormat ?? 3,
      SourceType: 1,
      Data: audioData,
      DataLen: fs.statSync(wavPath).size,
    }

    // 创建识别任务（带重试，最多 3 次）
    const createResult = await retryRequest('CreateRecTask', createPayload, log)

    // 腾讯云 API 错误统一检查（Response.Error 存在时表示请求失败）
    if (createResult.Response?.Error) {
      throw new Error(`ASR 创建任务失败: ${createResult.Response.Error.Message}`)
    }

    const asrTaskId = createResult.Response.Data.TaskId
    log.info(`ASR 任务已创建，TaskId: ${asrTaskId}`)

    // ========== 第 3 步：轮询 ASR 结果 ==========
    // 识别需要时间（通常 30 秒 ~ 3 分钟），每隔 5 秒查一次
    const asrData = await pollAsrResult(asrTaskId, log)
    updateTask(taskId, { status: 'recognizing', progress: 60 }, log)

    // ASR 返回的 ResultDetail 是分段时间轴数组
    // 每条格式：{ FinalSentence: "...", StartMs: 1980, EndMs: 3270, ... }
    // 转换为 srtGenerator 需要的格式：{ StartTime: 秒, EndTime: 秒, Text: 文字 }
    // 优化方向：让 srtGenerator 直接接收 ASR 格式，省去这次遍历转换
    const resultData = asrData.ResultDetail.map(item => ({
      StartTime: item.StartMs / 1000,  // 毫秒 → 秒
      EndTime: item.EndMs / 1000,
      Text: item.FinalSentence,
    }))
    log.info(`ASR 识别完成，共 ${resultData.length} 条结果`)

    // ========== 第 4 步：数据清洗 + SRT 生成 ==========
    updateTask(taskId, { status: 'cleaning', progress: 70 }, log)
    const { srtPath } = await cleanAndGenerate(resultData, baseName, log)
    updateTask(taskId, { status: 'generating', progress: 80 }, log)

    // ========== 第 5 步：FFmpeg 烧录字幕 ==========
    updateTask(taskId, { status: 'rendering', progress: 85 }, log)
    const outputPath = path.join(__dirname, `../storage/output/${baseName}.mp4`)
    await burnSubtitle(videoPath, srtPath, outputPath, task._style, log)

    // ========== 第 6 步：清理临时文件 + 设置下载链接 ==========
    // 删除临时 WAV 文件（已用完，占空间）
    if (fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath)
    }

    // 设置下载 URL（前端轮询拿到这些 URL 后显示下载按钮）
    updateTask(taskId, {
      status: 'done',
      progress: 100,
      videoUrl: `/api/download/${taskId}/video`,
      srtUrl: `/api/download/${taskId}/srt`,
      rawUrl: `/api/download/${taskId}/raw`,
    }, log)

    log.info(`任务处理完成`)

  } catch (err) {
    // 任意步骤失败都会到这里
    log.error(`任务失败: ${err.message}`)
    updateTask(taskId, {
      status: 'failed',
      errorMsg: err.message,
    }, log)
  }
}

/**
 * ASR API 重试封装
 *
 * 网络请求可能偶尔失败（超时、服务暂不可用），自动重试避免偶发错误导致整个任务失败。
 *
 * @param {string} action - 腾讯云 API 动作名（如 'CreateRecTask'）
 * @param {object} payload - 请求参数
 * @param {object} log - logger
 * @param {number} maxRetries - 最大重试次数（默认 3）
 * @returns {Promise<object>} API 响应
 */
async function retryRequest(action, payload, log, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sendRequest(action, payload)
    } catch (err) {
      log.error(`${action} 请求失败 (第 ${i + 1}/${maxRetries} 次): ${err.message}`)
      if (i === maxRetries - 1) throw err  // 最后一次还失败，抛出
      // 等待 2 秒后重试
      // setTimeout(resolve, 2000) 等价于 setTimeout(() => { resolve() }, 2000)
      // 直接把 resolve 函数传进去，2 秒后 setTimeout 调用它，Promise 完成
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

/**
 * 轮询 ASR 识别结果
 *
 * 腾讯云 ASR 是异步的：创建任务后不立即返回结果，需要反复查状态。
 *
 * @param {string} asrTaskId - ASR 返回的 TaskId
 * @param {object} log - logger
 * @returns {Promise<object>} Response.Data 对象（包含 Status, Result, ResultDetail）
 *
 * 状态码（Response.Data.Status）：
 * 0 - 初始状态
 * 1 - 处理中
 * 2 - 识别成功（Result 字段有数据）
 * 3 - 识别失败
 *
 * 轮询策略：每 5 秒查一次，最多等 5 分钟（60 次）
 */
async function pollAsrResult(asrTaskId, log) {
  const POLL_INTERVAL = 5000   // 5 秒
  const MAX_POLLS = 60          // 最多 60 次 = 5 分钟

  for (let i = 0; i < MAX_POLLS; i++) {
    // 等待 5 秒
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))

    // 查询状态
    const result = await sendRequest('DescribeTaskStatus', { TaskId: asrTaskId })

    if (result.Response?.Error) {
      throw new Error(`ASR 轮询失败: ${result.Response.Error.Message}`)
    }

    const status = result.Response.Data.Status
    log.info(`ASR 轮询: 状态=${status} (${i + 1}/${MAX_POLLS})`)

    if (status === 2) {
      // 识别成功，返回 Data 对象
      return result.Response.Data
    }
    if (status === 3) {
      throw new Error('ASR 识别失败（服务端返回 status=3）')
    }
    // status 0 或 1：还在处理中，继续轮询
  }

  throw new Error('ASR 识别超时（5 分钟内未完成）')
}

module.exports = { processVideo }
