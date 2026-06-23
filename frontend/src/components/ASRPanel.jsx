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
  const [blobUrl, setBlobUrl] = useState(null)
  const fileInputRef = useRef(null)
  const videoContainerRef = useRef(null)
  const subtitleRef = useRef(null)
  const [aspectRatio, setAspectRatio] = useState('16/9')

  // === 字幕样式 ===
  const [style, setStyle] = useState({
    fontName: "Microsoft YaHei",
    fontSize: 24,
    fontColor: "#FFFFFF",
    outlineColor: "#000000",
    outline: 2,
    alignment: 2,
    marginV: 10,
  })

  // === ASR 配置 ===
  const [asrConfig, setAsrConfig] = useState({
    engineType: "16k_zh",
    resTextFormat: 3,
  })

  // === 任务状态（合并为对象，减少散落的 useState）===
  const [task, setTask] = useState({
    id: null, status: null, progress: 0, loading: false,
    errorMsg: '', videoUrl: null, srtUrl: null, rawUrl: null,
  })

  // === Blob URL 管理 ===
  useEffect(() => {
    if (!videoFile) {
      setBlobUrl(null)
      return
    }
    const url = URL.createObjectURL(videoFile)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [videoFile])

  // === 字幕拖拽 ===
  const startDrag = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startMargin = style.marginV
    const containerH = videoContainerRef.current?.clientHeight || 400

    const onMove = (e) => {
      const diffPx = startY - e.clientY
      const diffPct = (diffPx / containerH) * 100
      const newPct = Math.max(0, Math.min(100, startMargin + diffPct))
      setStyle(prev => ({ ...prev, marginV: Math.round(newPct) }))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // === 描边 CSS ===
  const outlineShadow = () => {
    const o = style.outline
    const c = style.outlineColor
    if (o === 0) return 'none'
    return [
      `-${o}px -${o}px 0 ${c}`, `${o}px -${o}px 0 ${c}`,
      `-${o}px  ${o}px 0 ${c}`, `${o}px  ${o}px 0 ${c}`,
    ].join(', ')
  }

  // === 上传 + 开始处理 ===
  const handleUpload = async () => {
    if (!videoFile) return

    setTask({ id: null, status: null, progress: 0, loading: true, errorMsg: '', videoUrl: null, srtUrl: null, rawUrl: null })

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

      setTask(prev => ({ ...prev, id: data.taskId, status: "uploading", loading: false }))
    } catch (err) {
      setTask(prev => ({ ...prev, loading: false, errorMsg: err.message }))
    }
  }

  // === 轮询状态 ===
  useEffect(() => {
    if (!task.id) return

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${task.id}`)
        const data = await res.json()

        setTask(prev => ({ ...prev, status: data.status, progress: data.progress || 0 }))

        if (data.status === "done") {
          setTask(prev => ({ ...prev, videoUrl: data.videoUrl, srtUrl: data.srtUrl, rawUrl: data.rawUrl }))
          clearInterval(timer)
        } else if (data.status === "failed") {
          setTask(prev => ({ ...prev, errorMsg: data.errorMsg || "处理失败" }))
          clearInterval(timer)
        }
      } catch (err) {
        setTask(prev => ({ ...prev, errorMsg: err.message }))
        clearInterval(timer)
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [task.id])

  // === 重置 ===
  const handleReset = () => {
    setVideoFile(null)
    setTask({ id: null, status: null, progress: 0, loading: false, errorMsg: '', videoUrl: null, srtUrl: null, rawUrl: null })
    if (fileInputRef.current) fileInputRef.current.value = ""
    setBlobUrl(null)
    setAspectRatio('16/9')
  }

  const isProcessing = task.status && task.status !== "done" && task.status !== "failed"
  const canSubmit = !task.loading && videoFile && !isProcessing

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

      {/* ============ 视频预览 + 字幕拖拽 ============ */}
      {blobUrl && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">字幕预览（可拖拽调整位置）</h3>
          <div
            ref={videoContainerRef}
            className="relative rounded-lg overflow-hidden select-none"
            style={{ aspectRatio }}
          >
            <video
              src={blobUrl}
              controls
              className="w-full h-full object-cover"
              onLoadedMetadata={(e) => {
                const { videoWidth, videoHeight } = e.target
                if (videoWidth && videoHeight) {
                  setAspectRatio(`${videoWidth}/${videoHeight}`)
                }
              }}
            />
            {/* 字幕预览层 */}
            <div
              ref={subtitleRef}
              onMouseDown={startDrag}
              className="absolute left-0 right-0 text-center cursor-grab active:cursor-grabbing"
              style={{
                bottom: `${style.marginV}%`,
                fontFamily: style.fontName,
                fontSize: `${style.fontSize}px`,
                color: style.fontColor,
                textShadow: outlineShadow(),
                lineHeight: 1.4,
                padding: '0 8px',
              }}
            >
              示例字幕文字 Hello World
            </div>
          </div>
          <p className="text-xs text-gray-400">上下拖拽字幕文字调整位置，样式修改实时生效</p>
        </section>
      )}

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
            <span>距边缘：{style.marginV}%</span>
            <input
              type="range" min={0} max={100}
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
          {task.loading ? "上传中..." : "开始处理"}
        </button>

        {(task.status === "done" || task.status === "failed") && (
          <button
            onClick={handleReset}
            className="px-6 py-2.5 rounded border border-gray-300 hover:bg-gray-100 cursor-pointer transition-colors"
          >
            重新开始
          </button>
        )}
      </section>

      {/* ============ 进度展示 ============ */}
      {task.status && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">处理进度</h3>
          <div className="w-full bg-gray-200 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full rounded-full flex items-center justify-center text-white text-xs transition-all duration-300 ${
                task.status === "failed" ? "bg-red-500" : "bg-blue-600"
              }`}
              style={{ width: `${task.progress}%` }}
            >
              {task.progress > 10 ? `${task.progress}%` : ""}
            </div>
          </div>
          <p className={`text-sm ${task.status === "failed" ? "text-red-500" : "text-gray-700"}`}>
            {STATUS_TEXT[task.status] || task.status}
          </p>
        </section>
      )}

      {/* ============ 错误信息 ============ */}
      {task.errorMsg && (
        <section className="bg-red-50 border border-red-200 text-red-600 rounded p-3 text-sm">
          错误：{task.errorMsg}
        </section>
      )}

      {/* ============ 结果下载 ============ */}
      {task.status === "done" && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">处理结果</h3>
          <div className="flex flex-wrap gap-3">
            {task.videoUrl && (
              <a href={task.videoUrl} download className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                下载视频（带字幕）
              </a>
            )}
            {task.srtUrl && (
              <a href={task.srtUrl} download className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                下载字幕文件（.srt）
              </a>
            )}
            {task.rawUrl && (
              <a href={task.rawUrl} download className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors">
                下载原始识别结果
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
