import { useState, useEffect } from "react"

// ASR 识别面板组件
export default function ASRPanel() {
  // 表单参数
  const [url, setUrl] = useState("")
  const [engineType, setEngineType] = useState("16k_zh")
  const [resTextFormat, setResTextFormat] = useState(3) // 默认字幕模式
  const [channelNum, setChannelNum] = useState(1)

  // 任务状态
  const [taskId, setTaskId] = useState(null)
  const [status, setStatus] = useState(null) // "waiting" | "doing" | "success" | "failed"
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState("")
  const [loading, setLoading] = useState(false)

  // 提交识别任务
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg("")
    setResult(null)
    setStatus(null)

    try {
      const res = await fetch("/api/create-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          EngineModelType: engineType,
          ChannelNum: Number(channelNum),
          ResTextFormat: Number(resTextFormat),
          SourceType: 0,
          Url: url,
        }),
      })
      const data = await res.json()

      if (data.Response?.Error) {
        throw new Error(data.Response.Error.Message)
      }

      setTaskId(data.Response.Data.TaskId)
      setStatus("waiting")
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 轮询任务结果（taskId 变化时启动）
  useEffect(() => {
    if (!taskId) return

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/task-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ TaskId: taskId }),
        })
        const data = await res.json()
        const taskData = data.Response?.Data

        if (!taskData) return

        setStatus(taskData.StatusStr)

        if (taskData.Status === 2) {
          // 成功
          setResult(taskData.Result)
          clearInterval(timer)
        } else if (taskData.Status === 3) {
          // 失败
          setErrorMsg(taskData.ErrorMsg)
          clearInterval(timer)
        }
      } catch (err) {
        setErrorMsg(err.message)
        clearInterval(timer)
      }
    }, 3000) // 每 3 秒轮询一次

    return () => clearInterval(timer) // 组件卸载时清理定时器
  }, [taskId])

  // 状态显示文字
  const statusText = {
    waiting: "⏳ 等待识别...",
    doing: "🔄 识别中...",
    success: "✅ 识别完成",
    failed: "❌ 识别失败",
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 20 }}>
      <h2>语音识别 - 字幕生成</h2>

      <form onSubmit={handleSubmit}>
        {/* 音频 URL */}
        <div style={{ marginBottom: 12 }}>
          <label>音频 URL：</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="输入音频文件 URL"
            required
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        {/* 引擎模型 */}
        <div style={{ marginBottom: 12 }}>
          <label>识别引擎：</label>
          <select value={engineType} onChange={(e) => setEngineType(e.target.value)}>
            <option value="16k_zh">中文普通话通用</option>
            <option value="16k_zh_en">普方英大模型</option>
            <option value="16k_en">英语</option>
            <option value="16k_ja">日语</option>
            <option value="16k_ko">韩语</option>
            <option value="16k_yue">粤语</option>
          </select>
        </div>

        {/* 返回格式 */}
        <div style={{ marginBottom: 12 }}>
          <label>结果格式：</label>
          <select value={resTextFormat} onChange={(e) => setResTextFormat(e.target.value)}>
            <option value={0}>基础识别结果</option>
            <option value={1}>基础 + 词级时间戳</option>
            <option value={2}>基础 + 时间戳 + 标点</option>
            <option value={3}>按标点分段（字幕场景）</option>
          </select>
        </div>

        {/* 声道数 */}
        <div style={{ marginBottom: 12 }}>
          <label>声道数：</label>
          <input
            type="number"
            min={1}
            max={2}
            value={channelNum}
            onChange={(e) => setChannelNum(e.target.value)}
          />
        </div>

        <button type="submit" disabled={loading || !url}>
          {loading ? "提交中..." : "开始识别"}
        </button>
      </form>

      {/* 状态显示 */}
      {status && <p style={{ marginTop: 20 }}>{statusText[status]}</p>}

      {/* 错误信息 */}
      {errorMsg && <p style={{ color: "red" }}>错误：{errorMsg}</p>}

      {/* 识别结果 */}
      {result && (
        <div style={{ marginTop: 20 }}>
          <h3>识别结果：</h3>
          <pre style={{ background: "#f5f5f5", padding: 12, whiteSpace: "pre-wrap" }}>
            {result}
          </pre>
        </div>
      )}
    </div>
  )
}
