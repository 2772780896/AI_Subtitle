// 腾讯云API签名v3实现示例
// 本代码基于腾讯云API签名v3文档实现: https://cloud.tencent.com/document/product/213/30654
// 请严格按照文档说明使用，不建议随意修改签名相关代码
const https = require("https")
const crypto = require("crypto")

const sendRequest = (action, payload) => {
  function sha256(message, secret = "", encoding) {
    const hmac = crypto.createHmac("sha256", secret)
    return hmac.update(message).digest(encoding)
  }
  function getHash(message, encoding = "hex") {
    const hash = crypto.createHash("sha256")
    return hash.update(message).digest(encoding)
  }
  function getDate(timestamp) {
    const date = new Date(timestamp * 1000)
    const year = date.getUTCFullYear()
    const month = ("0" + (date.getUTCMonth() + 1)).slice(-2)
    const day = ("0" + date.getUTCDate()).slice(-2)
    return `${year}-${month}-${day}`
  }

  // 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
  // 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
  // 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
  // 请参见：https://cloud.tencent.com/document/product/1278/85305
  // 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
  const SECRET_ID = process.env.TENCENTCLOUD_SECRET_ID
  const SECRET_KEY = process.env.TENCENTCLOUD_SECRET_KEY
  const TOKEN = ""

  const host = "asr.tencentcloudapi.com"
  const service = "asr"
  const region = ""
  const version = "2019-06-14"
  const timestamp = parseInt(String(new Date().getTime() / 1000))
  const date = getDate(timestamp)
  payload = JSON.stringify(payload)

  // ************* 步骤 1：拼接规范请求串 *************
  const signedHeaders = "content-type;host"
  const hashedRequestPayload = getHash(payload)
  const httpRequestMethod = "POST"
  const canonicalUri = "/"
  const canonicalQueryString = ""
  const canonicalHeaders =
    "content-type:application/json; charset=utf-8\n" + "host:" + host + "\n"

  const canonicalRequest =
    httpRequestMethod +
    "\n" +
    canonicalUri +
    "\n" +
    canonicalQueryString +
    "\n" +
    canonicalHeaders +
    "\n" +
    signedHeaders +
    "\n" +
    hashedRequestPayload

  // ************* 步骤 2：拼接待签名字符串 *************
  const algorithm = "TC3-HMAC-SHA256"
  const hashedCanonicalRequest = getHash(canonicalRequest)
  const credentialScope = date + "/" + service + "/" + "tc3_request"
  const stringToSign =
    algorithm +
    "\n" +
    timestamp +
    "\n" +
    credentialScope +
    "\n" +
    hashedCanonicalRequest

  // ************* 步骤 3：计算签名 *************
  const kDate = sha256(date, "TC3" + SECRET_KEY)
  const kService = sha256(service, kDate)
  const kSigning = sha256("tc3_request", kService)
  const signature = sha256(stringToSign, kSigning, "hex")

  // ************* 步骤 4：拼接 Authorization *************
  const authorization =
    algorithm +
    " " +
    "Credential=" +
    SECRET_ID +
    "/" +
    credentialScope +
    ", " +
    "SignedHeaders=" +
    signedHeaders +
    ", " +
    "Signature=" +
    signature

  // ************* 步骤 5：构造并发起请求（用 Promise 包装，让调用方能 await） *************
  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Timestamp": timestamp,
      "X-TC-Version": version,
    }

    if (region) {
      headers["X-TC-Region"] = region
    }
    if (TOKEN) {
      headers["X-TC-Token"] = TOKEN
    }

    const options = {
      hostname: host,
      method: httpRequestMethod,
      headers,
    }

    const req = https.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => {
        data += chunk
      })

      res.on("end", () => {
        resolve(JSON.parse(data))  // 数据回来 → resolve 给调用方
      })
    })

    req.on("error", (error) => {
      reject(error)  // 出错 → reject 给调用方
    })

    req.write(payload)
    req.end()
  })
}

module.exports = { sendRequest }
