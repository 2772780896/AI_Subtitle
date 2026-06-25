const fs = require('fs')
const path = require('path')

/**
 * srtGenerator.js - 数据清洗 + SRT 字幕生成
 *
 * 职责：接收 ASR 返回的原始识别结果 → 清洗 → 生成 SRT 文件
 *
 * 输入：ASR 返回的 Result 数组，每条包含：
 *   { StartTime: 0.5, EndTime: 2.3, Text: "大家好今天我们来聊..." }
 *   （StartTime/EndTime 单位是秒，Text 是识别出的文字）
 *
 * 输出：标准 SRT 字幕文件 + 原始识别结果备份文件
 *
 * 处理流程：
 *   ASR 原始结果 → removeFillers → mergeShort → splitLong → toSrt → 写文件
 */

// ============================================================
// 清洗规则 1：去除语气词
// ============================================================
/**
 * 去掉常见的无意义语气词和口头禅
 *
 * 为什么要去掉：
 * ASR 会忠实地识别所有声音，包括"嗯""啊"
 * 这些词对理解内容没有帮助，出现在字幕里反而影响阅读体验。
 *
 * 正则说明：
 * - 用 \b 或 ^/$ 匹配词的边界，避免误删正常文字中的片段
 * - 中文没有词边界，所以直接匹配整词（语气词通常是独立的短词）
 */
const FILLER_WORDS = [
  '嗯', '啊', '呃', '哦', '噢', '嗯嗯',
]

/**
 * 从文本中移除语气词
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 *
 * 实现方式：用正则把每个语气词替换为空字符串，然后清理多余空格
 */
function removeFillers(text) {
  // 构建正则表达式：
  // FILLER_WORDS.join('|') 把数组拼成字符串 '嗯|啊|呃|...'
  // | 在正则里是"或"的意思，匹配任意一个语气词
  // 'g' 标志表示全局匹配（替换所有出现，不只是第一个）
  // 等价于写死：/嗯|啊|呃|哦|噢|嗯嗯/g
  const pattern = new RegExp(FILLER_WORDS.join('|'), 'g')

  // 三步处理：
  return text
    .replace(pattern, '')    // ① 把语气词替换为空字符串（删除）
    .replace(/\s+/g, ' ')    // ② 把多个连续空格压成一个空格
    .trim()                  // ③ 去掉首尾的空格
}

// ============================================================
// 清洗规则 2：合并过短的句子
// ============================================================
/**
 * 时长 < 1 秒的句子合并到下一条
 *
 * 为什么要合并：
 * 如果一条字幕只显示 0.3 秒，观众根本来不及读。
 * 把它合并到下一条，变成一条更长的字幕，阅读体验更好。
 *
 * @param {Array} segments - 清洗后的片段数组
 * @returns {Array} 合并后的数组
 *
 * 合并逻辑：
 * - 遍历每条，如果时长 < 1 秒，把文字追加到下一条
 * - 下一条的 StartTime 不变（时间范围扩大了）
 * - 如果最后一条太短，合并到上一条
 */
function mergeShort(segments) {
  const result = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const duration = seg.EndTime - seg.StartTime

    if (duration < 1 && i < segments.length - 1) {
      // 太短了，合并到下一条：
      // ① 文字拼到下一条开头
      segments[i + 1].Text = seg.Text + segments[i + 1].Text
      // ② 时间范围扩大：下一条的 StartTime 改为当前的 StartTime
      segments[i + 1].StartTime = seg.StartTime
      // 不 push 当前这条，跳过它
    } else if (duration < 1 && result.length > 0) {
      // 最后一条太短，合并到上一条：把文字追加到上一条末尾
      result[result.length - 1].Text += seg.Text
      result[result.length - 1].EndTime = seg.EndTime
    } else {
      // 时长正常，直接保留
      result.push({ ...seg })
    }
  }

  return result
}

// ============================================================
// 清洗规则 3：拆分过长的句子
// ============================================================
/**
 * 超过 20 个字的句子按标点符号断开
 *
 * 为什么要拆分：
 * 一行字幕最多 20 个字（适配手机小屏），超了要断成多条。
 *
 * @param {Array} segments - 片段数组
 * @returns {Array} 拆分后的数组
 *
 * 拆分策略：
 * - 优先在标点处断开（，。！？；、）
 * - 如果找不到标点，在 20 字处硬切
 * - 拆分后每条的时间按比例分配
 */
function splitLong(segments) {
  const result = []
  // 中文标点，按优先级排序（句号 > 逗号 > 其他）
  const PUNCTUATION = /[，。！？；、,.\!\?]/

  for (const seg of segments) {
    if (seg.Text.length <= 20) {
      // 不需要拆分
      result.push(seg)
      continue
    }

    // 需要拆分：按标点切成多段
    const parts = []
    let remaining = seg.Text

    while (remaining.length > 0) {
      if (remaining.length <= 20) {
        // 剩下的不超过 20 字，直接拿走
        parts.push(remaining)
        break
      }

      // 在前 20 个字里找最后一个标点，作为断点
      const chunk = remaining.slice(0, 20)
      let lastPunct = -1
      for (let i = chunk.length - 1; i >= 0; i--) {
        if (PUNCTUATION.test(chunk[i])) {
          lastPunct = i
          break
        }
      }

      if (lastPunct > 0) {
        // 在标点处断开（包含标点本身）
        parts.push(remaining.slice(0, lastPunct + 1))
        remaining = remaining.slice(lastPunct + 1)
      } else {
        // 没找到标点，在 20 字处硬切
        parts.push(remaining.slice(0, 20))
        remaining = remaining.slice(20)
      }
    }

    // 按文字比例分配时间
    // 例：原文 40 字，3 秒，拆成 2 条各 20 字 → 每条 1.5 秒
    const totalChars = seg.Text.length
    const duration = seg.EndTime - seg.StartTime
    let currentTime = seg.StartTime

    for (const part of parts) {
      const partDuration = (part.length / totalChars) * duration
      result.push({
        StartTime: currentTime,
        EndTime: currentTime + partDuration,
        Text: part,
      })
      currentTime += partDuration
    }
  }

  return result
}

// ============================================================
// 验证：检查数据是否符合规范，打警告日志（不改数据）
// ============================================================
/**
 * 验证字幕数据，不符合规范时打警告日志
 *
 * 检查项：
 * - 文字长度 ≤ 20 字（单行字幕）
 * - 时长 1~5 秒
 *
 * @param {Array} segments - 片段数组
 * @param {object} log - Winston logger 实例
 * @returns {Array} 原样返回（不修改数据）
 */
function validate(segments, log) {
  segments.forEach((seg, i) => {
    const duration = seg.EndTime - seg.StartTime
    const num = i + 1

    if (seg.Text.length > 20) {
      log.warn(`[validate] 第 ${num} 条超过 20 字：${seg.Text.length} 字`)
    }
    if (duration < 1) {
      log.warn(`[validate] 第 ${num} 条时长不足 1 秒：${duration.toFixed(2)} 秒`)
    }
    if (duration > 5) {
      log.warn(`[validate] 第 ${num} 条时长超过 5 秒：${duration.toFixed(2)} 秒`)
    }
  })
  return segments
}

// ============================================================
// SRT 格式化
// ============================================================
/**
 * 将清洗后的片段数组转换为 SRT 格式的字符串
 *
 * SRT 格式说明：
 * 每条字幕由 4 部分组成：
 *   序号
 *   开始时间 --> 结束时间（格式：HH:MM:SS,mmm）
 *   字幕文字
 *   空行（分隔符）
 *
 * 时间格式化已内联，SRT 用逗号 , 分隔毫秒（不是小数点 .）
 *
 * @param {Array} segments - 清洗后的片段数组
 * @returns {string} SRT 格式文本
 */
function formatSrt(segments) {
  return segments.map((seg, i) => {
    // 时间格式化（内联，避免额外函数调用）
    const fmt = (seconds) => {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      const s = Math.floor(seconds % 60)
      const ms = Math.round((seconds % 1) * 1000)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
    }

    const start = fmt(seg.StartTime)
    const end = fmt(seg.EndTime)

    return `${i + 1}\n${start} --> ${end}\n${seg.Text}\n`
  }).join('\n')
}

// ============================================================
// 主函数：清洗 + 生成 SRT 文件
// ============================================================
/**
 * 接收 ASR 结果 → 清洗 → 生成 SRT 文件 + 原始备份
 *
 * @param {Array} asrResult - ASR 返回的识别结果数组
 *   每条格式：{ StartTime: 0.5, EndTime: 2.3, Text: "..." }
 * @param {string} baseName - 文件名基础（不含扩展名），如 "abc123"
 * @param {object} log - Winston logger 实例
 * @returns {{ srtPath: string, rawPath: string }}
 *
 * 输出两个文件：
 * 1. storage/output/{baseName}.srt      ← 清洗后的字幕（给 FFmpeg 用）
 * 2. storage/output/{baseName}.raw.txt  ← 原始识别结果（备份查验）
 */
async function cleanAndGenerate(asrResult, baseName, log) {
  log.info(`[clean] 开始清洗，原始条数: ${asrResult.length}`)

  // 复用 formatSrt 生成原始备份，格式统一，还能直接用播放器打开对比
  const rawContent = formatSrt(asrResult)
  const rawPath = path.join(__dirname, `../storage/output/${baseName}.raw.txt`)
  await fs.promises.writeFile(rawPath, rawContent, 'utf-8')

  // 按顺序执行清洗规则
  // 注意顺序很重要：去语气词 → 合并短句 → 拆长句 → 再合并一次（兜底拆分产生的残余）→ 过滤空文本 → 限制时长
  let segments = [...asrResult]  // 浅拷贝，不修改原数据
  segments = segments.map(seg => ({ ...seg, Text: removeFillers(seg.Text) }))  // 去语气词
  segments = mergeShort(segments)
  segments = splitLong(segments)
  segments = mergeShort(segments)  // 拆分可能产生过短的尾部，再合并一次

  // 功能操作：过滤空文本 + 限制时长上限 5 秒
  segments = segments.filter(seg => seg.Text.trim().length > 0)
  segments = segments.map(seg => ({
    ...seg,
    EndTime: seg.EndTime - seg.StartTime > 5 ? seg.StartTime + 5 : seg.EndTime
  }))

  // 验证：检查数据是否符合规范，打警告日志
  segments = validate(segments, log)

  log.info(`[clean] 清洗完成，最终条数: ${segments.length}`)

  // 生成 SRT 文件
  const srtContent = formatSrt(segments)
  const srtPath = path.join(__dirname, `../storage/output/${baseName}.srt`)
  await fs.promises.writeFile(srtPath, srtContent, 'utf-8')

  log.info(`[generateSrt] 已生成: ${baseName}.srt`)
  return { srtPath, rawPath }
}

module.exports = { cleanAndGenerate }
