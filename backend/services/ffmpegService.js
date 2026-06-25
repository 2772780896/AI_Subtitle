const { execFile } = require('child_process')
const path = require('path')

/**
 * ffmpegService.js - FFmpeg 命令封装
 *
 * 两个核心功能：
 * 1. extractAudio：从视频中提取音频（给 ASR 用）
 * 2. burnSubtitle：把 SRT 字幕烧录到视频中（最终输出）
 *
 * 底层都用 Node.js 的 child_process.execFile 来执行 FFmpeg 命令行。
 * execFile 比 exec 更安全（不经过 shell 解析，避免命令注入）。
 */

// ============================================================
// 工具函数：把 FFmpeg 命令行包装成 Promise
// ============================================================
/**
 * 执行 FFmpeg/FFprobe 命令，返回 Promise
 *
 * @param {string} cmd   - 命令名：'ffmpeg' 或 'ffprobe'
 * @param {string[]} args - 参数数组，如 ['-i', 'input.mp4', '-vn', ...]
 * @returns {Promise<string>} - resolve 返回 stdout，reject 返回错误信息
 *
 * 为什么用 execFile 而不是 exec：
 * - exec 会把命令字符串传给 shell 解析，有命令注入风险
 * - execFile 直接执行可执行文件 + 参数数组，更安全
 *
 * 为什么必须用 new Promise 包装（不能用 async 代替）：
 * - execFile 是回调式异步 API，结果藏在回调参数（stdout/stderr）里
 * - async 只能把同步的 return/throw 转成 resolve/reject，够不着回调里的值
 * - 只有 resolve/reject 才能充当"传值通道"，把回调里的值送到 Promise 外面
 * - 同时 Promise 也充当"信号线"：execFile 完成 → 触发回调 → 调 resolve
 *   → Promise 状态变化 → await 收到结果。没有 Promise，await 无从得知何时完成
 *
 * 为什么封装成 Promise：
 * - execFile 是回调风格，包装成 Promise 后可以用 async/await 控制执行顺序
 * - 否则多个命令会并发执行（如先提取音频再烧字幕，必须串行）
 */
function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) {
        // FFmpeg 的错误信息在 stderr 里（即使成功也会有 stderr 输出）
        reject(new Error(stderr || error.message))
      } else {
        // resolve 把 stdout 通过"传值通道"送到 Promise 外面，await 就能拿到
        resolve(stdout)
      }
    })
  })
}

// ============================================================
// 工具函数：获取视频分辨率（用于 marginV 百分比换算）
// ============================================================
/**
 * 用 ffprobe 读取视频的宽和高
 *
 * ffprobe 是 FFmpeg 自带的媒体信息工具，可以查询视频元数据。
 * 这里用 -show_entries 只取 width 和 height，-of csv=p=0 输出纯数字。
 *
 * @param {string} videoPath - 视频文件绝对路径
 * @returns {Promise<{width: number, height: number}>}
 *
 * 命令等价于：
 * ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 input.mp4
 * 输出示例：1920,1080
 */
async function getVideoResolution(videoPath) {
  const args = [
    '-v', 'error',           // 只输出错误，不要多余信息
    '-select_streams', 'v:0', // 只选第一个视频流（忽略音频流）
    '-show_entries', 'stream=width,height', // 只查宽和高
    '-of', 'csv=p=0',        // 输出格式：纯数字，逗号分隔，无字段名
    videoPath
  ]

  const stdout = await runCommand('ffprobe', args)
  const [width, height] = stdout.trim().split(',').map(Number)
  return { width, height }
}

// ============================================================
// 工具函数：颜色格式转换（HEX → ASS BGR）
// ============================================================
/**
 * 把前端传来的 HEX 颜色（#RRGGBB）转成 ASS 字幕的 BGR 格式（&H00BBGGRR）
 *
 * 为什么需要转换：
 * - 前端用标准 CSS 颜色格式：#RRGGBB（红绿蓝，如 #FFFFFF = 白色）
 * - ASS/SRT 字幕用 BGR 格式：&H00BBGGRR（蓝绿红，字节顺序反过来）
 * - 例如：#FFFFFF → &H00FFFFFF（白色），#FF0000 → &H000000FF（红色）
 *
 * @param {string} hex - HEX 颜色字符串，如 "#FFFFFF"
 * @returns {string} ASS BGR 颜色，如 "&H00FFFFFF"
 */
function hexToAssColor(hex) {
  // 去掉 # 号，拆成 R、G、B 三个分量
  const r = hex.slice(1, 3)  // "FF"
  const g = hex.slice(3, 5)  // "FF"
  const b = hex.slice(5, 7)  // "FF"
  // 拼接成 BGR 顺序，加上 &H00 前缀（00 是不透明度，始终不透明）
  return `&H00${b}${g}${r}`
}

// ============================================================
// 核心函数 1：提取音频
// ============================================================
/**
 * 从视频中提取音频，输出为 16kHz/16bit/单声道 WAV
 *
 * @param {string} inputPath  - 输入视频路径（storage/input/xxx.mp4）
 * @param {string} outputPath - 输出音频路径（storage/temp/xxx.wav）
 * @param {object} log        - Winston logger 实例（由 processVideo 传入）
 *
 * FFmpeg 命令拆解：
 * ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 output.wav
 *
 * 参数含义：
 * -i input.mp4     输入文件
 * -vn              不要视频流（video none），只要音频
 * -acodec pcm_s16le  音频编码为 16bit PCM（Pulse Code Modulation，无压缩）
 *                    pcm = PCM编码, s16 = signed 16bit, le = little-endian
 * -ar 16000        采样率 16kHz（ASR 要求的标准采样率）
 * -ac 1            单声道（mono），ASR 不需要立体声
 * output.wav       输出路径，FFmpeg 自动根据扩展名选择 WAV 容器格式
 *
 * 为什么这些参数是固定的：
 * 腾讯云 ASR 录音文件识别要求：16kHz、16bit、单声道 WAV。
 * 如果不转，ASR 可能识别不准或直接报错。
 */
async function extractAudio(inputPath, outputPath, log) {
  log.info(`[extractAudio] 开始: ${path.basename(inputPath)}`)

  const args = [
    '-i', inputPath,      // 输入视频
    '-vn',                 // 去掉视频流
    '-acodec', 'pcm_s16le', // 16bit PCM 编码
    '-ar', '16000',        // 采样率 16kHz
    '-ac', '1',            // 单声道
    '-y',                  // 覆盖已有文件，不询问确认
    outputPath             // 输出 WAV
  ]

  await runCommand('ffmpeg', args)

  log.info(`[extractAudio] 完成: ${path.basename(outputPath)}`)
  return outputPath
}

// ============================================================
// 核心函数 2：烧录字幕
// ============================================================
/**
 * 将 SRT 字幕烧录到视频上，输出带字幕的 MP4
 *
 * @param {string} videoPath  - 输入视频路径（storage/input/xxx.mp4）
 * @param {string} srtPath    - SRT 字幕路径（storage/output/xxx.srt）
 * @param {string} outputPath - 输出视频路径（storage/output/xxx.mp4）
 * @param {object} style      - 前端传来的样式配置对象
 * @param {object} log        - Winston logger 实例
 *
 * FFmpeg 命令拆解：
 * ffmpeg -i input.mp4 -vf "subtitles=xxx.srt:force_style='...'" -c:v libx264 -c:a aac output.mp4
 *
 * 参数含义：
 * -vf "subtitles=xxx.srt:force_style='...'"
 *     -vf = video filter（视频滤镜）
 *     subtitles 滤镜会读取 SRT 文件并按时间戳逐帧渲染字幕
 *     force_style 覆盖字幕样式（字体、颜色、描边、位置等）
 *
 * -c:v libx264    视频编码为 H.264（兼容性最好的编码）
 * -c:a aac        音频编码为 AAC（标准音频编码）
 * -y              覆盖已有文件
 *
 * force_style 参数说明：
 * FontName=微软雅黑       字体名称
 * FontSize=24            字号（像素）
 * PrimaryColour=&H00FFFFFF  字体颜色（BGR 格式）
 * OutlineColour=&H00000000  描边颜色
 * Outline=2              描边粗细（像素）
 * Alignment=2            对齐方式（2=底部居中）
 * MarginV=108            距底部距离（像素）
 */
async function burnSubtitle(videoPath, srtPath, outputPath, style, log) {
  log.info(`[burnSubtitle] 开始: ${path.basename(videoPath)}`)

  // 1. 获取视频分辨率，用于 marginV 百分比 → 像素换算
  const { height } = await getVideoResolution(videoPath)
  // marginV 是百分比（0~100），乘以视频高度 / 100 得到实际像素
  // 例：视频高 1080px，marginV=10% → 108 像素
  const marginVpx = Math.round(height * style.marginV / 100)

  // 2. 颜色转换：前端 HEX → ASS BGR 格式
  const primaryColour = hexToAssColor(style.fontColor)
  const outlineColour = hexToAssColor(style.outlineColor)

  // 3. 拼接 force_style 字符串
  // 每个参数用逗号分隔，整体用单引号包裹
  const forceStyle = [
    `FontName=${style.fontName}`,
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${primaryColour}`,
    `OutlineColour=${outlineColour}`,
    `Outline=${style.outline}`,
    `Alignment=${style.alignment}`,
    `MarginV=${marginVpx}`,
  ].join(',')

  // 4. SRT 路径处理
  // FFmpeg 的 subtitles 滤镜对 Windows 绝对路径（含驱动器号 C:、中文路径）解析有问题
  // 解决方式：转为相对于当前工作目录的相对路径，避免驱动器号和复杂转义
  const relativeSrt = path.relative(process.cwd(), srtPath)
    .replace(/\\/g, '/')    // Windows 反斜杠 → 正斜杠
    .replace(/:/g, '\\:')   // 冒号转义（以防万一）

  // 5. 构建 FFmpeg 参数
  const args = [
    '-i', videoPath,        // 输入视频
    '-vf', `subtitles='${relativeSrt}':force_style='${forceStyle}'`, // 字幕滤镜（路径加单引号保护）
    '-c:v', 'libx264',      // 视频编码 H.264
    '-c:a', 'aac',          // 音频编码 AAC
    '-y',                   // 覆盖已有文件
    outputPath              // 输出路径
  ]

  await runCommand('ffmpeg', args)

  log.info(`[burnSubtitle] 完成: ${path.basename(outputPath)} (MarginV=${marginVpx}px)`)
  return outputPath
}

module.exports = { extractAudio, burnSubtitle, getVideoResolution }
