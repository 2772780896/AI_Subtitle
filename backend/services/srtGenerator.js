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
 * ASR 会忠实地识别所有声音，包括"嗯""啊""那个"等口头禅。
 * 这些词对理解内容没有帮助，出现在字幕里反而影响阅读体验。
 *
 * 正则说明：
 * - 用 \b 或 ^/$ 匹配词的边界，避免误删正常文字中的片段
 * - 中文没有词边界，所以直接匹配整词（语气词通常是独立的短词）
 */
const FILLER_WORDS = [
  '嗯', '啊', '呃', '哦', '噢', '嗯嗯',
  '那个', '就是说', '然后呢', '对吧', '是吧',
  '这个', '怎么说呢',
]

/**
 * 从文本中移除语气词
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 *
 * 实现方式：用正则把每个语气词替换为空字符串，然后清理多余空格
 */
function removeFillers(text) {
  // 构建正则：(嗯|啊|呃|...) 匹配任意一个语气词
  const pattern = new RegExp(FILLER_WORDS.join('|'), 'g')
  // 替换为空，然后去掉首尾空格和连续空格
  return text.replace(pattern, '').replace(/\s+/g, ' ').trim()
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
      // 太短了，合并到下一条：把文字加到下一条开头
      segments[i + 1].Text = seg.Text + segments[i + 1].Text
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
      const slice = remaining.slice(0, 20)
      let lastPunct = -1
      for (let i = slice.length - 1; i >= 0; i--) {
        if (PUNCTUATION.test(slice[i])) {
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
// 清洗规则 4：限制时长和行数
// ============================================================
/**
 * 确保每条字幕时长在 1~5 秒之间，文字不超过 2 行（每行 20 字）
 *
 * 为什么要限制时长：
 * - < 1 秒：观众来不及读（前面 mergeShort 已处理大部分）
 * - > 5 秒：画面可能已经换了内容，字幕还在，造成困惑
 *
 * 为什么要限制行数：
 * 字幕最多 2 行，每行最多 20 字。超过就显示不全或遮挡画面。
 *
 * @param {Array} segments - 片段数组
 * @returns {Array} 处理后的数组
 */
function enforceLimits(segments) {
  return segments
    // 过滤掉空文本（可能清洗后变成空字符串）
    .filter(seg => seg.Text.trim().length > 0)
    .map(seg => {
      let text = seg.Text

      // 如果超过 40 字（2 行 × 20 字），截断
      // 实际上 splitLong 已经处理了，这里是兜底
      if (text.length > 40) {
        text = text.slice(0, 40)
      }

      // 时长上限 5 秒
      let endTime = seg.EndTime
      if (endTime - seg.StartTime > 5) {
        endTime = seg.StartTime + 5
      }

      return { ...seg, Text: text, EndTime: endTime }
    })
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
 *   字幕文字（最多 2 行）
 *   空行（分隔符）
 *
 * 示例：
 *   1
 *   00:00:01,500 --> 00:00:03,200
 *   大家好，今天我们来聊一个话题
 *
 *   2
 *   00:00:03,500 --> 00:00:06,000
 *   这个话题是关于人工智能的
 *
 * @param {Array} segments - 清洗后的片段数组
 * @returns {string} SRT 格式文本
 */
function formatSrt(segments) {
  return segments.map((seg, i) => {
    const start = formatTime(seg.StartTime)
    const end = formatTime(seg.EndTime)

    // 文字分行：超过 20 字就分成两行
    let text = seg.Text
    if (text.length > 20) {
      // 在前 20 字里找标点断行
      const firstLine = findLineBreak(text, 20)
      text = firstLine + '\n' + text.slice(firstLine.length)
    }

    return `${i + 1}\n${start} --> ${end}\n${text}\n`
  }).join('\n')
}

/**
 * 秒数 → SRT 时间格式（HH:MM:SS,mmm）
 *
 * 例：65.123 → "00:01:05,123"
 *
 * @param {number} seconds - 秒数（浮点数，如 65.123）
 * @returns {string} SRT 时间字符串
 *
 * 注意 SRT 用逗号 , 分隔毫秒，不是小数点 .
 * 这是 SRT 标准格式，FFmpeg 也是按这个格式解析的
 */
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)

  // padStart(2, '0') 补零到 2 位，padStart(3, '0') 补到 3 位
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

/**
 * 在指定位置附近找标点作为换行点
 * @param {string} text - 文本
 * @param {number} maxLen - 最大行长度
 * @returns {string} 第一行文本
 */
function findLineBreak(text, maxLen) {
  const PUNCTUATION = /[，。！？；、,.\!\?]/
  // 从 maxLen 往前找标点
  for (let i = maxLen - 1; i >= 0; i--) {
    if (PUNCTUATION.test(text[i])) {
      return text.slice(0, i + 1)
    }
  }
  // 找不到标点就在 maxLen 处硬切
  return text.slice(0, maxLen)
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
function cleanAndGenerate(asrResult, baseName, log) {
  log.info(`[clean] 开始清洗，原始条数: ${asrResult.length}`)

  // 保存原始结果备份（清洗前的原文 + 时间戳）
  const rawContent = asrResult.map(seg =>
    `[${formatTime(seg.StartTime)} --> ${formatTime(seg.EndTime)}] ${seg.Text}`
  ).join('\n')
  const rawPath = path.join(__dirname, `../storage/output/${baseName}.raw.txt`)
  fs.writeFileSync(rawPath, rawContent, 'utf-8')

  // 按顺序执行清洗规则
  // 注意顺序很重要：去语气词 → 合并短句 → 拆长句 → 再合并一次（兜底拆分产生的残余）→ 限制时长
  let segments = [...asrResult]  // 浅拷贝，不修改原数据
  segments = removeFillers_batch(segments)
  segments = mergeShort(segments)
  segments = splitLong(segments)
  segments = mergeShort(segments)  // 拆分可能产生过短的尾部，再合并一次
  segments = enforceLimits(segments)

  log.info(`[clean] 清洗完成，最终条数: ${segments.length}`)

  // 生成 SRT 文件
  const srtContent = formatSrt(segments)
  const srtPath = path.join(__dirname, `../storage/output/${baseName}.srt`)
  fs.writeFileSync(srtPath, srtContent, 'utf-8')

  log.info(`[generateSrt] 已生成: ${baseName}.srt`)
  return { srtPath, rawPath }
}

/**
 * 批量去除语气词（对每条 segment 的 Text 字段调用 removeFillers）
 */
function removeFillers_batch(segments) {
  return segments.map(seg => ({
    ...seg,
    Text: removeFillers(seg.Text),
  }))
}

module.exports = { cleanAndGenerate }
