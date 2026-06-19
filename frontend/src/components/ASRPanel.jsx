import { useState, useEffect, useRef } from "react"

// 状态展示文字
const STATUS_TEXT = {
  uploading: "上传中...",
  extracting: "提取音频中...",
  recognizing: "语音识别中...",
  cleaning: "数据清洗中...",
  generating: "生成字幕中...",
  rendering: "渲染视频中...",
  done: "处理完成",
  failed: "处理失败",
}

export default function ASRPanel() {
  // === 视频文件 ===
  const [videoFile, setVideoFile] = useState(null)
  const fileInputRef = useRef(null)

  // === 字幕样式 ===
  const [style, setStyle] = useState({
    fontName: "Microsoft YaHei",
    fontSize: 24,
    fontColor: "#FFFFFF",
    outlineColor: "#000000",
    outline: 2,
    alignment: 2,    // 2=底部 5=居中 8=顶部
    marginV: 30,
  })

  // === ASR 配置 ===
  const [asrConfig, setAsrConfig] = useState({
    engineType: "16k_zh",
    resTextFormat: 3,
  })

  // === 任务状态 ===
  const [taskId, setTaskId] = useState(null)
  const [taskStatus, setTaskStatus] = useState(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")
  const [videoUrl, setVideoUrl] = useState(null)
  const [srtUrl, setSrtUrl] = useState(null)
  const [rawUrl, setRawUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  // === 上传 + 开始处理 ===
  const handleUpload = async () => {
    if (!videoFile) return

    setLoading(true)
    setErrorMsg("")
    setTaskStatus(null)
    setProgress(0)
    setVideoUrl(null)
    setSrtUrl(null)
    setRawUrl(null)

    try {
      const formData = new FormData()
      formData.append("video", videoFile)
      formData.append("style", JSON.stringify(style))
      formData.append("asrConfig", JSON.stringify(asrConfig))

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "上传失败")
      }

      setTaskId(data.taskId)
      setTaskStatus("uploading")
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  // === 轮询状态 ===
  useEffect(() => {
    if (!taskId) return

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${taskId}`)
        const data = await res.json()

        setTaskStatus(data.status)
        setProgress(data.progress || 0)

        if (data.status === "done") {
          setVideoUrl(data.videoUrl)
          setSrtUrl(data.srtUrl)
          setRawUrl(data.rawUrl)
          clearInterval(timer)
        } else if (data.status === "failed") {
          setErrorMsg(data.errorMsg || "处理失败")
          clearInterval(timer)
        }
      } catch (err) {
        setErrorMsg(err.message)
        clearInterval(timer)
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [taskId])

  // === 重置 ===
  const handleReset = () => {
    setVideoFile(null)
    setTaskId(null)
    setTaskStatus(null)
    setProgress(0)
    setErrorMsg("")
    setVideoUrl(null)
    setSrtUrl(null)
    setRawUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const isProcessing = taskStatus && taskStatus !== "done" && taskStatus !== "failed"
  const canSubmit = !loading && videoFile && !isProcessing

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h2 className="text-2xl font-bold">AI 字幕生成系统</h2>

      {/* ============ 视频上传 ============ */}
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">1. 选择视频</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4"
          onChange={(e) => setVideoFile(e.target.files[0] || null)}
          disabled={isProcessing}
          className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700 disabled:opacity-50"
        />
        {videoFile && (
          <p className="text-sm text-gray-500">
            {videoFile.name}（{(videoFile.size / 1024 / 1024).toFixed(1)} MB）
          </p>
        )}
      </section>

      {/* ============ 字幕样式 ============ */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">2. 字幕样式</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>字体</span>
            <select
              value={style.fontName}
              onChange={(e) => setStyle({ ...style, fontName: e.target.value })}
              disabled={isProcessing}
              className="border rounded px-2 py-1.5 disabled:opacity-50"
            >
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Source Han Sans CN">思源黑体</option>
              <option value="SimHei">黑体</option>
              <option value="SimSun">宋体</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>字号：{style.fontSize}</span>
            <input
              type="range" min={16} max={36}
              value={style.fontSize}
              onChange={(e) => setStyle({ ...style, fontSize: Number(e.target.value) })}
              disabled={isProcessing}
              className="accent-blue-600"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>字体颜色</span>
            <input
              type="color"
              value={style.fontColor}
              onChange={(e) => setStyle({ ...style, fontColor: e.target.value })}
              disabled={isProcessing}
              className="h-8 w-16 cursor-pointer"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>描边颜色</span>
            <input
              type="color"
              value={style.outlineColor}
              onChange={(e) => setStyle({ ...style, outlineColor: e.target.value })}
              disabled={isProcessing}
              className="h-8 w-16 cursor-pointer"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>描边粗细：{style.outline}</span>
            <input
              type="range" min={0} max={5}
              value={style.outline}
              onChange={(e) => setStyle({ ...style, outline: Number(e.target.value) })}
              disabled={isProcessing}
              className="accent-blue-600"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>字幕位置</span>
            <select
              value={style.alignment}
              onChange={(e) => setStyle({ ...style, alignment: Number(e.target.value) })}
              disabled={isProcessing}
              className="border rounded px-2 py-1.5 disabled:opacity-50"
            >
              <option value={2}>底部</option>
              <option value={5}>居中</option>
              <option value={8}>顶部</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>距边缘：{style.marginV}px</span>
            <input
              type="range" min={10} max={100}
              value={style.marginV}
              onChange={(e) => setStyle({ ...style, marginV: Number(e.target.value) })}
              disabled={isProcessing}
              className="accent-blue-600"
            />
          </label>
        </div>
      </section>

      {/* ============ ASR 配置 ============ */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">3. ASR 识别配置</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>识别引擎</span>
            <select
              value={asrConfig.engineType}
              onChange={(e) => setAsrConfig({ ...asrConfig, engineType: e.target.value })}
              disabled={isProcessing}
              className="border rounded px-2 py-1.5 disabled:opacity-50"
            >
              <option value="16k_zh">中文普通话通用</option>
              <option value="16k_zh_en">普方英大模型</option>
              <option value="16k_en">英语</option>
              <option value="16k_ja">日语</option>
              <option value="16k_ko">韩语</option>
              <option value="16k_yue">粤语</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>结果格式</span>
            <select
              value={asrConfig.resTextFormat}
              onChange={(e) => setAsrConfig({ ...asrConfig, resTextFormat: Number(e.target.value) })}
              disabled={isProcessing}
              className="border rounded px-2 py-1.5 disabled:opacity-50"
            >
              <option value={0}>基础识别结果</option>
              <option value={1}>基础 + 词级时间戳</option>
              <option value={2}>基础 + 时间戳 + 标点</option>
              <option value={3}>按标点分段（字幕场景）</option>
            </select>
          </label>
        </div>
      </section>

      {/* ============ 操作按钮 ============ */}
      <section className="flex gap-3">
        <button
          onClick={handleUpload}
          disabled={!canSubmit}
          className={`px-6 py-2.5 rounded text-white font-medium transition-colors ${
            canSubmit
              ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
              : "bg-gray-300 cursor-not-allowed"
          }`}
        >
          {loading ? "上传中..." : "开始处理"}
        </button>

        {(taskStatus === "done" || taskStatus === "failed") && (
          <button
            onClick={handleReset}
            className="px-6 py-2.5 rounded border border-gray-300 hover:bg-gray-100 cursor-pointer transition-colors"
          >
            重新开始
          </button>
        )}
      </section>

      {/* ============ 进度展示 ============ */}
      {taskStatus && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">处理进度</h3>
          <div className="w-full bg-gray-200 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full rounded-full flex items-center justify-center text-white text-xs transition-all duration-300 ${
                taskStatus === "failed" ? "bg-red-500" : "bg-blue-600"
              }`}
              style={{ width: `${progress}%` }}
            >
              {progress > 10 ? `${progress}%` : ""}
            </div>
          </div>
          <p className={`text-sm ${taskStatus === "failed" ? "text-red-500" : "text-gray-700"}`}>
            {STATUS_TEXT[taskStatus] || taskStatus}
          </p>
        </section>
      )}

      {/* ============ 错误信息 ============ */}
      {errorMsg && (
        <section className="bg-red-50 border border-red-200 text-red-600 rounded p-3 text-sm">
          错误：{errorMsg}
        </section>
      )}

      {/* ============ 结果下载 ============ */}
      {taskStatus === "done" && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">处理结果</h3>
          <div className="flex flex-wrap gap-3">
            {videoUrl && (
              <a href={videoUrl} download className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                下载视频（带字幕）
              </a>
            )}
            {srtUrl && (
              <a href={srtUrl} download className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                下载字幕文件（.srt）
              </a>
            )}
            {rawUrl && (
              <a href={rawUrl} download className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors">
                下载原始识别结果
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
